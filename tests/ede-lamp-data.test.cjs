const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { gunzipSync } = require('node:zlib');
const { loadModule } = require('./helpers/module.cjs');

test('the checked-in BGT lamp posts cover the Ede scene and reject an incomplete asset', async () => {
  const { decodeEdeLamps } = await import('../js/ede-lamp-data.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { createCoverageIndex, edeCoverage } = await import('../js/ede-coverage.js');
  const playable = createCoverageIndex(edeCoverage.buildingBoundary);
  const municipality = createCoverageIndex(edeCoverage.playableBoundary);
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const bytes = gunzipSync(readFileSync(join(__dirname, '../assets/ede-lamps.bin.gz')));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const lamps = decodeEdeLamps(buffer);
  assert.ok(lamps.length > 22000);
  assert.ok(lamps.every(({ x, z }) => playable.contains(x, z)));
  assert.ok(lamps.some(({ x, z }) => !municipality.contains(x, z)));
  assert.ok(lamps.some(({ x, z }) => Math.max(Math.abs(x), Math.abs(z)) > 6553.4));
  const lunteren = lamps.filter(({ x, z }) => x >= -3900 && x <= -2850 && z >= -5300 && z <= -3900);
  assert.ok(lunteren.length > 700);
  const field = decodeTerrain(Uint8Array.from(gunzipSync(readFileSync(join(__dirname, '../assets/ede-terrain-tiles/collision.bin.gz')))).buffer);
  for (const { x, z, baseY } of lunteren.filter(lamp => !lamp.surveyed && !lamp.fitted).slice(0, 20)) {
    assert.ok(Math.abs(baseY - sampleTerrain(field, x, z)) < 0.15);
  }
  assert.ok(lamps.filter(({ x, z }) => Math.hypot(x, z) < 350).length > 300);
  assert.ok(lamps.every(lamp => lamp.height >= 3 && lamp.height <= 20 &&
    Math.abs(Math.hypot(lamp.nx, lamp.nz) - 1) < 1e-12));
  assert.throws(() => decodeEdeLamps(buffer.slice(0, -4)), /asset length/);
  const doubleArm = lamps.filter(lamp => lamp.doubleArm);
  const [west, north, east, south] = EDE_DATA.meta.baseBounds;
  assert.equal(doubleArm.filter(({ x, z }) => x >= west && x <= east && z >= north && z <= south).length, 93);
  assert.ok(doubleArm.length > 93);
  assert.ok(doubleArm.every(lamp => lamp.surveyed));
  assert.ok(doubleArm.some(lamp => lamp.layer === 1 && lamp.fitted));

  const upper = lamps.filter(({ x, z, layer }) => layer === 1 && x >= -1460 && x <= -1360 && z >= 3400 && z <= 3610);
  assert.equal(upper.length, 35);
  assert.equal(upper.filter(lamp => lamp.surveyed).length, 25);
  assert.ok(upper.every(lamp => lamp.fitted && lamp.baseY > -4.6 && Math.abs(lamp.targetY - lamp.baseY) < 0.7));
  const corrected = upper.find(lamp => Math.hypot(lamp.x + 1395.17, lamp.z - 3489.69) < 0.15);
  assert.ok(corrected && Math.abs(corrected.baseY - (19.14 - 22.54)) < 0.03);
  for (const [x, z] of [[-1418.45, 3529.93], [-1445.24, 3529.76]]) {
    const under = lamps.filter(lamp => lamp.layer === 0 && Math.hypot(lamp.x - x, lamp.z - z) < 0.15);
    assert.equal(under.length, 1);
    assert.ok(under[0].baseY < -8);
  }
});

test('the lamp decoder still accepts coordinate-only EDL1 data', async () => {
  const { decodeEdeLamps } = await import('../js/ede-lamp-data.js');
  const bytes = Buffer.from([69, 68, 76, 49, 1, 0, 0, 0, 10, 0, 15, 0]);
  assert.deepEqual(decodeEdeLamps(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    [{ x: 2, z: 3 }]);
});

test('an explicit lamp cutoff chunks and culls even a small glowing lens batch', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const { setupSceneCulling, updateSceneCulling } = loadModule(
    readFileSync(join(__dirname, '../js/scene-culling.js'), 'utf8'),
    { imports: { 'three/webgpu': THREE } },
  );
  const scene = new THREE.Scene(), group = new THREE.Group();
  const lenses = new THREE.InstancedMesh(new THREE.CircleGeometry(0.6), new THREE.MeshBasicNodeMaterial(), 2);
  lenses.userData.cullDistance = 740;
  lenses.setMatrixAt(0, new THREE.Matrix4());
  lenses.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1200, 0, 0));
  group.add(lenses);
  scene.add(group);

  setupSceneCulling(scene, [group]);
  assert.equal(group.children.length, 2);
  updateSceneCulling({ x: 0, y: 0, z: 739 });
  assert.deepEqual(group.children.map(mesh => mesh.visible), [true, false]);
  updateSceneCulling({ x: 0, y: 0, z: 742 });
  assert.deepEqual(group.children.map(mesh => mesh.visible), [false, false]);
  updateSceneCulling({ x: 1200, y: 0, z: 0 });
  assert.deepEqual(group.children.map(mesh => mesh.visible), [false, true]);
});
