const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const file = path => readFileSync(join(__dirname, '..', path));
const load = (name, imports) => loadModule(file('js/' + name).toString(), { imports, filename: name });

test('Westhoffhuis keeps its exact building collision and usable approach treads', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const packed = file('assets/ede-terrain-tiles/collision.bin');
  const field = decodeTerrain(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));
  const terrainHeightAt = (x, z) => sampleTerrain(field, x, z);
  const terrain = { terrainHeightAt, getTerrain: () => field };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const survey = await import('../js/ede-westhoffhuis-survey.js');
  const { WESTHOFFHUIS_SURVEY, EDE_WESTHOFFHUIS_LANDMARK: site } = survey;
  const { createWesthoffhuis } = load('ede-westhoffhuis.js', {
    'three/webgpu': three, './terrain.js': terrain, './ede-westhoffhuis-survey.js': survey,
    './ede-survey-landmark.js': load('ede-survey-landmark.js', {
      './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    }),
  });
  const model = createWesthoffhuis(site.surveyFootprints, site);
  model.updateMatrixWorld(true);
  assert.equal(site.osmId, 'w271720127');
  assert.deepEqual(site.bagIds, ['0228100000075047']);
  assert.equal(model.userData.colliders.length, 1);
  const [collider] = model.userData.colliders;
  assert.deepEqual(JSON.parse(JSON.stringify(collider.polygon)), site.surveyFootprints[0]);
  const bounds = new three.Box3().setFromObject(model);
  assert.ok(bounds.min.y <= WESTHOFFHUIS_SURVEY.ground);
  assert.ok(Math.abs(bounds.max.y - WESTHOFFHUIS_SURVEY.ground - site.height) < 0.01);
  assert.ok(site.approach.x < bounds.min.x);

  const surfaces = model.userData.platforms;
  assert.equal(surfaces.length, 36);
  assert.equal(model.children.length, 2);
  for (const { outer, height } of surfaces) {
    const x = outer.reduce((sum, p) => sum + p.x, 0) / outer.length;
    const z = outer.reduce((sum, p) => sum + p.z, 0) / outer.length;
    const expected = height(x, z);
    const ray = new three.Raycaster(new three.Vector3(x, expected + 0.65, z), new three.Vector3(0, -1, 0));
    assert.ok(ray.intersectObject(model, true).some(hit => Math.abs(hit.point.y - expected) < 0.004));
    assert.ok(expected > terrainHeightAt(x, z) - 0.15);
  }
});
