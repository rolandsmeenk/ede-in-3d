const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');
const { loadModule } = require('./helpers/module.cjs');

const file = path => readFileSync(join(__dirname, '..', path));
const load = (name, imports) => loadModule(file('js/' + name).toString(), { imports, filename: name });

test('Lunteren school models retain their surveyed envelopes and safe exterior viewpoints', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const terrainModule = await import('../js/terrain.js');
  const packed = file('assets/ede-terrain-tiles/collision.bin');
  const field = terrainModule.decodeTerrain(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));
  const terrainHeightAt = (x, z) => terrainModule.sampleTerrain(field, x, z);
  const terrain = { getTerrain: () => field, terrainHeightAt };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] }, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const sitesModule = load('ede-lunteren-school-sites.js');
  const survey = load('ede-survey-landmark.js', { './ede-civic-landmarks.js': civic, './terrain.js': terrain });
  const { LUNTEREN_SCHOOL_LANDMARK_FACTORIES: build } = load('ede-lunteren-school-models.js', {
    './ede-survey-landmark.js': survey, './ede-lunteren-school-sites.js': sitesModule,
  });
  const { bounds, buildings } = JSON.parse(gunzipSync(file('assets/ede-north-v1.json.gz')));
  const { EDE_LUNTEREN_SCHOOL_LANDMARKS: sites, LUNTEREN_SCHOOL_SURVEYS: shells } = sitesModule;
  assert.equal(sites.length, 5);
  assert.equal(new Set(sites.flatMap(site => site.bagIds)).size, sites.length);
  assert.deepEqual(Object.keys(build).sort(), [...sites].map(site => site.id).sort());
  for (const site of sites) {
    const model = build[site.id](site.surveyFootprints, site);
    const [collision] = model.userData.colliders;
    const box = new three.Box3().setFromObject(model);
    assert.ok(containsPosition(box, site.x, site.z), site.id);
    assert.ok(box.min.y <= terrainHeightAt(site.x, site.z) + 0.2, site.id);
    assert.ok(Math.abs(box.max.y - shells[site.id].ground - site.height) < 0.01, site.id);
    assert.equal(model.userData.colliders.length, 1);
    assert.equal(JSON.stringify(collision.polygon), JSON.stringify(site.surveyFootprints[0]));
    const { x, z } = site.approach;
    assert.ok(x > bounds[0] && x < bounds[2] && z > bounds[1] && z < bounds[3]);
    assert.ok(!containsPosition(box, x, z), site.id);
    for (const p of sites) assert.ok(!pointInRing(p.surveyFootprints[0].outer, x, z), site.id);
    for (const b of buildings) {
      const ring = [];
      for (let i = 0; i < b.ring.length; i += 2) ring.push({ x: b.ring[i], z: b.ring[i + 1] });
      assert.ok(!pointInRing(ring, x, z), site.id + ' approaches ' + b.id);
    }
    if (site.id !== 'lunteren-nederwoud') assert.ok(buildings.some(row => row.id === site.osmId));
    assert.equal(model.children.filter(object => object.userData.nearDetail).length, 1);
    model.traverse(object => {
      if (object.isMesh) assert.ok(object.geometry.attributes.position.array.every(Number.isFinite), site.id);
    });
  }
});

function containsPosition(box, x, z) {
  return x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}
