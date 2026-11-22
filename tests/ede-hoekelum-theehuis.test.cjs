const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const load = (name, imports) => loadModule(readFileSync(join(__dirname, '../js', name), 'utf8'), { imports, filename: name });

test('Theehuis Hoekelum uses the current footprint and leaves the old site clear', async () => {
  const { EDE_MODELED_LANDMARKS, landmarkBagExclusions, modeledLandmarkFootprints } = await import('../js/ede-landmark-sites.js');
  const { blockAt, nearestRoads, TELEPORT_LOCATIONS } = await import('../js/city-config.js');
  const site = EDE_MODELED_LANDMARKS.find(item => item.id === 'theehuis-hoekelum');
  const footprints = modeledLandmarkFootprints(site);
  assert.equal(footprints.length, 2);
  assert.equal(footprints[0].outer.length, 8);
  const exclusions = landmarkBagExclusions({ min: { x: 34, z: 3271 }, max: { x: 49, z: 3296 } });
  assert.deepEqual([...exclusions.keys()], ['0228100000027123', '0228100000062934']);
  assert.equal(site.osmId, 'w271471077');
  assert.deepEqual(site.annexOsmIds, ['w271471384']);

  const arrival = TELEPORT_LOCATIONS[site.id];
  const block = blockAt(arrival.x, arrival.z);
  assert.ok(!block || block.park || block.sidewalk);
  assert.ok(nearestRoads(arrival.x, arrival.z, 8).some(hit => hit.road.id === 'w1365938580'));
  assert.equal(arrival.focus.x, site.x);

  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const raw = readFileSync(join(__dirname, '../assets/ede-ahn.bin'));
  const field = decodeTerrain(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const terrain = { terrainHeightAt: (x, z) => sampleTerrain(field, x, z) };
  const surfaceTexture = { createFacadeSurfaceTexture: () => ({
    texture: new three.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
  }) };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {},
    './ede-facade-material.js': surfaceTexture,
  });
  const { createTheehuisHoekelum } = load('ede-estate-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './ede-civic-landmarks.js': civic, './ede-facade-material.js': surfaceTexture, './ede-estate-survey.js': {},
  });
  const model = createTheehuisHoekelum(footprints, site);
  const oldSite = { x: 56.6, z: 3290.4 };
  assert.ok(model.userData.colliders.every(c => oldSite.x > c.maxX || oldSite.z < c.minZ || oldSite.z > c.maxZ));
  assert.equal(model.userData.colliders.filter(c => c.polygon).length, 2);
  assert.equal(model.userData.platforms.length, 1);
  assert.equal(model.children.length, 2);
  assert.equal(model.children[1].castShadow, false);
  for (const mesh of model.children) assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
  const bounds = new three.Box3().setFromObject(model);
  const foundation = terrain.terrainHeightAt(site.x, site.z);
  assert.ok(bounds.min.y < foundation && bounds.max.y > foundation + 6);
  assert.ok(bounds.max.x < oldSite.x);
});
