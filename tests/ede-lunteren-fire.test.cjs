const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('Lunteren fire station keeps its surveyed silhouette, grounded collider and open approach', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const { EDE_DATA, pointInPoly, nearestRoads, sidewalkAt, waterAt } = await import('../js/city-config.js');
  const sites = await import('../js/ede-lunteren-fire-sites.js');
  const site = sites.EDE_LUNTEREN_FIRE_SITE;
  const packed = readFileSync(join(__dirname, '../assets/ede-terrain-tiles/collision.bin'));
  const field = decodeTerrain(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));
  const terrain = { getTerrain: () => field, terrainHeightAt: (x, z) => sampleTerrain(field, x, z) };
  const load = (name, imports) => loadModule(readFileSync(join(__dirname, '../js', name), 'utf8'),
    { imports, filename: name });
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const survey = load('ede-survey-landmark.js', { './ede-civic-landmarks.js': civic, './terrain.js': terrain });
  const { createLunterenFireStation } = load('ede-lunteren-fire.js', {
    'three/webgpu': three, './ede-survey-landmark.js': survey, './ede-lunteren-fire-sites.js': sites,
  });
  const model = createLunterenFireStation(site.surveyFootprints, site);
  const bounds = new three.Box3().setFromObject(model);
  assert.ok(Math.abs(bounds.max.y - sites.LUNTEREN_FIRE_SURVEY.ground - site.height) < .001);
  assert.ok(bounds.min.y < terrain.terrainHeightAt(site.x, site.z) - .08);
  assert.equal(model.userData.colliders.length, 1);
  assert.equal(JSON.stringify(model.userData.colliders[0].polygon), JSON.stringify(site.surveyFootprints[0]));
  assert.ok(EDE_DATA.buildings.some(r => r.id === site.osmId));
  const { x, z } = site.approach;
  assert.ok(!pointInPoly(site.surveyFootprints[0].outer, x, z));
  assert.ok(!waterAt(x, z) && sidewalkAt(x, z)?.sidewalk);
  assert.ok(nearestRoads(x, z, 8).some(({ road }) => road.id === 'w673077543'));

  const [shell, trim] = model.children;
  assert.equal(model.children.length, 2);
  assert.equal(trim.userData.nearDetail, true);
  assert.equal(trim.castShadow, false);
  for (const detail of [shell, trim]) assert.ok(detail.geometry.attributes.position.array.every(Number.isFinite));
  const glass = new three.Color(0x3d5157);
  const { array } = trim.geometry.attributes.color;
  assert.ok(array.some((r, i) => i % 3 === 0 && Math.abs(r - glass.r) < 1e-7 &&
    Math.abs(array[i + 1] - glass.g) < 1e-7 && Math.abs(array[i + 2] - glass.b) < 1e-7));
});
