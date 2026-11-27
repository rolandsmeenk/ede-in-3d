const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { pitches } = require('../assets/ede-sports.json');

const file = path => readFileSync(join(__dirname, '..', path));
const load = (name, imports, globals) => loadModule(file('js/' + name).toString(), { imports, globals, filename: name });
const middle = points => ({
  x: points.reduce((sum, { x }) => sum + x, 0) / points.length,
  z: points.reduce((sum, { z }) => sum + z, 0) / points.length,
});

test('football stands match their mapped pitches and provide seating, walkable steps and rain cover', async () => {
  const [three, tsl, terrainModule, grade, geometry, collision] = await Promise.all([
    import('../vendor/three/build/three.webgpu.js'), import('../vendor/three/build/three.tsl.js'),
    import('../js/terrain.js'), import('../js/ede-grade.js'), import('../js/ede-surface-geometry.js'),
    import('../js/building-collision.js'),
  ]);
  const packed = gunzipSync(file('assets/ede-terrain-tiles/collision.bin.gz'));
  const field = terrainModule.decodeTerrain(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));
  const terrain = { getTerrain: () => field, terrainHeightAt: (x, z) => terrainModule.sampleTerrain(field, x, z) };
  const context = { fillRect() {}, save() {}, translate() {}, restore() {}, fillText() {} };
  const document = { createElement: () => ({ getContext: () => context }) };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] }, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  }, { document });
  const standSites = await import('../js/ede-sport-stand-sites.js');
  const surveys = await import('../js/ede-sport-landmark-survey.js');
  const standModels = load('ede-sport-stands.js', {
    'three/webgpu': three, './ede-civic-landmarks.js': civic, './ede-geometry.js': geometry, './terrain.js': terrain,
  });
  const surveyBuilder = load('ede-survey-landmark.js', {
    './ede-civic-landmarks.js': civic, './terrain.js': terrain,
  });
  const { SPORT_LANDMARK_FACTORIES: factories } = load('ede-sport-landmarks.js', {
    'three/webgpu': three, './ede-survey-landmark.js': surveyBuilder, './ede-sport-landmark-survey.js': surveys,
    './ede-geometry.js': geometry, './ede-road-surfaces.js': {}, './tsl-materials.js': {},
    './ede-wvede-circuit-survey.js': {}, './terrain.js': terrain,
    './ede-sport-stands.js': standModels, './ede-sport-stand-sites.js': standSites,
  });
  const { EDE_MODELED_LANDMARKS, landmarkBagExclusions } = await import('../js/ede-landmark-sites.js');
  const assets = [
    ['blauw-geel-grandstand', 158, 'w583838464'],
    ['lunteren-grandstand', 300, 'w1444551351'],
  ];
  try {
    for (const [id, seats, pitchId] of assets) {
      const site = EDE_MODELED_LANDMARKS.find(site => site.id === id);
      const model = factories[id](null, site);
      const { platforms, weatherCovers, seatCount } = model.userData;
      const [roof] = weatherCovers;
      assert.equal(seatCount, seats);
      assert.equal(model.getObjectByName('Grandstand seats').geometry.attributes.position.count, seats * 108);
      assert.ok(model.children.every(mesh => mesh.geometry.attributes.position.array.every(Number.isFinite)));
      assert.equal(platforms.filter(row => row.id.includes('-row-')).length, 5);
      const pitch = { outer: geometry.edePoints(pitches.find(pitch => pitch.id === pitchId).ring), holes: [] };
      for (const { outer } of [...platforms, roof]) {
        assert.ok(outer.every(({ x, z }) => !collision.polygonContains(pitch, x, z)), id);
      }
      grade.setEdePlatforms(platforms);
      grade.setEdeStructureRoofs(weatherCovers);
      const row = platforms.find(row => row.id.endsWith('-row-5'));
      const { x, z } = middle(row.outer);
      const y = row.height(x, z);
      assert.equal(grade.gradeProfileAt(x, z, 'foot', undefined, y).id, row.id);
      assert.equal(grade.isUnderEdeRoof(x, y + 1.65, z), true);
      assert.equal(grade.isUnderEdeRoof(x, roof.height(x, z) + 0.1, z), false);
      assert.equal(grade.isUnderEdeRoof(roof.maxX + 1, y + 1.65, z), false);
      if (site.bagIds) {
        const { minX, minZ, maxX, maxZ } = roof;
        assert.ok(landmarkBagExclusions({ min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ } }).has(site.bagIds[0]));
      }
    }

    const dts = surveys.EDE_SPORT_LANDMARKS.find(site => site.id === 'dts-ede');
    const { weatherCovers } = factories[dts.id](null, dts).userData;
    assert.equal(weatherCovers.length, 1);
    grade.setEdeStructureRoofs(weatherCovers);
    const roof = weatherCovers[0], { x, z } = middle(roof.outer);
    assert.equal(grade.isUnderEdeRoof(x, roof.height(x, z) - 1, z), true);
  } finally {
    grade.setEdePlatforms([]);
    grade.setEdeStructureRoofs([]);
  }
});
