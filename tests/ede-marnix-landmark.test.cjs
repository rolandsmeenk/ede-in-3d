const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const file = path => readFileSync(join(__dirname, '..', path));
const load = (name, imports) => loadModule(file('js/' + name).toString(), { imports, filename: name });

test('Marnix College follows the main-building survey and leaves its public approach clear', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const { EDE_DATA, blockAt, nearestRoads, pointInPoly } = await import('../js/city-config.js');
  const packed = file('assets/ede-ahn.bin');
  const field = decodeTerrain(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));
  const terrainHeightAt = (x, z) => sampleTerrain(field, x, z);
  const terrain = { getTerrain: () => field, terrainHeightAt };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] }, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const surveyModule = load('ede-marnix-survey.js');
  const { MARNIX_COLLEGE_SITE: site, MARNIX_COLLEGE_SURVEY: shell } = surveyModule;
  const survey = load('ede-survey-landmark.js', { './ede-civic-landmarks.js': civic, './terrain.js': terrain });
  const { createMarnixCollege } = load('ede-marnix-landmark.js', {
    './ede-survey-landmark.js': survey, './ede-marnix-survey.js': surveyModule,
  });

  assert.equal(site.bagIds.join(), '0228100000004719');
  assert.equal(site.osmId, 'w271510315');
  assert.ok(EDE_DATA.buildings.some(building => building.id === site.osmId));
  const model = createMarnixCollege(site.surveyFootprints, site);
  assert.equal(model.children.length, 2);
  assert.ok(model.children[1].userData.nearDetail);
  assert.equal(model.children[1].castShadow, false);
  assert.equal(model.userData.colliders.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(model.userData.colliders[0].polygon)),
    JSON.parse(JSON.stringify(site.surveyFootprints[0])));
  const box = new three.Box3().setFromObject(model);
  assert.ok(box.min.y <= terrainHeightAt(site.x, site.z));
  assert.ok(Math.abs(box.max.y - shell.ground - site.height) < .01);
  model.traverse(object => {
    if (object.isMesh) assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
  });

  assert.ok(nearestRoads(site.approach.x, site.approach.z, 15).some(({ road }) => road.name === site.road));
  for (let t = 0; t <= .87; t += .04) {
    const x = site.approach.x + (site.x - site.approach.x) * t;
    const z = site.approach.z + (site.z - site.approach.z) * t;
    assert.ok(!pointInPoly(site.surveyFootprints[0].outer, x, z));
    assert.ok(!blockAt(x, z, false) || blockAt(x, z, false).park);
    assert.ok(Number.isFinite(terrainHeightAt(x, z)));
  }
});
