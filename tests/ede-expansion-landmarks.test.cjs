const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports, globals) {
  return loadModule(readFileSync(join(__dirname, '../js/', name), 'utf8'), { imports, globals, filename: name });
}

test('expansion landmarks build finite meshes in the surveyed frame', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const captions = [];
  const context = {
    fillRect() {}, save() {}, translate() {}, restore() {},
    fillText(text) { captions.push(text); },
  };
  const document = { createElement: () => ({ getContext: () => context }) };
  const terrain = { getTerrain: () => true, terrainHeightAt: () => 0 };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] }, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  }, { document });
  const surveys = load('ede-expansion-landmark-surveys.js');
  const surveyBuilder = load('ede-survey-landmark.js', {
    './ede-civic-landmarks.js': civic, './terrain.js': terrain,
  });
  const { EXPANSION_LANDMARK_FACTORIES: factories } = load('ede-expansion-landmarks.js', {
    'three/webgpu': three, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    './ede-grade.js': { nearbyRailHeightAt: () => undefined, RAIL_TOP: 0.13 },
    './ede-expansion-landmark-surveys.js': surveys, './ede-survey-landmark.js': surveyBuilder,
  });
  const { EDE_EXPANSION_LANDMARKS: sites } = surveys;
  for (const site of sites) {
    const model = factories[site.id](site.surveyFootprints, site);
    if (!site.worldSpace) model.position.set(site.x, 0, site.z);
    const bounds = new three.Box3().setFromObject(model);
    assert.ok(!bounds.isEmpty(), site.id);
    assert.ok(bounds.min.x <= site.x && bounds.max.x >= site.x, site.id);
    assert.ok(bounds.min.z <= site.z && bounds.max.z >= site.z, site.id);
    model.traverse(({ geometry }) => {
      if (geometry) assert.ok(geometry.attributes.position.array.every(Number.isFinite), site.id);
    });
    if (site.bagIds) {
      const buildingColliders = model.userData.colliders.filter(collider => collider.polygon);
      assert.equal(buildingColliders.length, site.bagIds.length, site.id);
    }
    if (site.id === 'veenendaal-de-klomp') assert.equal(model.userData.platforms.length, 2);
    if (site.id === 'schaapskooi-ginkelse-heide') assert.ok(model.userData.colliders.some(collider => collider.obb));
  }
  const folds = sites.find(site => site.id === 'schaapskooi-ginkelse-heide');
  assert.equal(folds.surveyFootprints.length, 2);
  assert.deepEqual(captions.sort(), ['BOERDERIJ MOSSEL', 'RESTAURANT', 'RESTAURANT', 'Veenendaal-De Klomp']);
});
