const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports, globals) {
  return loadModule(readFileSync(join(__dirname, '../js', name), 'utf8'), { imports, globals, filename: name });
}

function inside(x, z, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z)) hit = !hit;
  }
  return hit;
}

test('Waterzoom recesses and both Parkweide shop blocks fit the surveyed exteriors', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const terrainData = await import('../js/terrain.js');
  const bytes = readFileSync(join(__dirname, '../assets/ede-ahn.bin'));
  const field = terrainData.decodeTerrain(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const terrain = { getTerrain: () => field, terrainHeightAt: (x, z) => terrainData.sampleTerrain(field, x, z) };
  const signs = [];
  const context = { fillRect() {}, save() {}, translate() {}, restore() {}, fillText(text) { signs.push(text); } };
  const document = { createElement: () => ({ getContext: () => context }) };
  const civic = load('ede-civic-landmarks.js', { 'three/webgpu': THREE, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {} }, { document });
  const survey = load('ede-kernhem-neighborhood-survey.js');
  const surveyBuilder = load('ede-survey-landmark.js', { './ede-civic-landmarks.js': civic, './terrain.js': terrain });
  const { buildEdeKernhemNeighborhoodLandmark: build } = load('ede-kernhem-neighborhood-landmarks.js', {
    'three/webgpu': THREE, 'three/tsl': tsl, './ede-civic-landmarks.js': civic,
    './ede-facade-material.js': { createFacadeSurfaceTexture: () => ({ texture: new THREE.Texture() }) },
    './ede-survey-landmark.js': surveyBuilder, './aerial-colors.js': { sampleRoofColor: () => false },
    './terrain.js': terrain, './ede-kernhem-neighborhood-survey.js': survey,
  });
  for (const site of survey.EDE_KERNHEM_NEIGHBORHOOD_LANDMARKS) {
    const model = build(site);
    const colliders = model.userData.colliders;
    assert.equal(colliders.length, site.bagIds.length, site.name);
    assert.ok(colliders.every(c => !inside(site.approach.x, site.approach.z, c.polygon.outer)), site.name);
    assert.ok(model.children.length <= 3, site.name);
    model.traverse(({ geometry }) => {
      if (geometry) assert.ok(geometry.getAttribute('position').array.every(Number.isFinite), site.name);
    });
    if (site.id === 'waterzoom-kernhem') {
      const shell = model.children[0];
      const { points, faces } = survey.KERNHEM_NEIGHBORHOOD_SURVEYS[site.id][0];
      const wall = faces[4][1].map(i => points[i]);
      const normal = civic.polygonNormal(wall);
      const { a, b, width } = civic.wallExtent(wall, normal);
      const from = (t, y) => new THREE.Vector3(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t)
        .addScaledVector(normal, 2);
      const depth = (t, y) => new THREE.Raycaster(from(t, y), normal.clone().negate()).intersectObject(shell)[0]?.distance;
      assert.ok(width > 9.9);
      assert.ok(Math.abs(depth(0.34, -7.2) - 3.32) < 0.003, 'the balcony has a modeled recess');
      assert.ok(Math.abs(depth(0.83, -7.2) - 2.00) < 0.003, 'the adjacent bay retains the outer wall');
      assert.ok(Math.abs(depth(0.34, 1.10) - 3.32) < 0.003, 'the recess continues up to the fifth storey');
    } else {
      const passage = [[-1907.5, -548], [-1905, -540], [-1901, -530], [-1896, -520], [-1892, -510], [-1889, -500]];
      assert.ok(passage.every(([x, z]) => colliders.every(c => !inside(x, z, c.polygon.outer))),
        'the pedestrian passage is open from both approaches');
    }
  }
  assert.deepEqual(signs.sort(), ['ALDI', 'AMI Kappers', 'Albert Heijn', 'Avablooms', 'Bakkerij Van Voorthuizen',
    'Bakhuus Parkweide', 'De Koopman', 'Etos', 'Gall & Gall', 'Kruidvat', 'Mr. Fillet'].sort());
});
