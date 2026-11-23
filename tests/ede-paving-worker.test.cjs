const assert = require('node:assert/strict');
const test = require('node:test');

test('paving jobs preserve fitted grade cuts, asphalt lanes and aerial vertex colors', async () => {
  const THREE = await import('../vendor/three/build/three.core.js');
  const { buildPavingTile } = await import('../js/ede-paving-worker.js');
  const { createTerrainSampler } = await import('../js/terrain.js');
  const { drapeSurface, polygonGeometry } = await import('../js/ede-surface-geometry.js');
  const { clipEdeGround } = await import('../js/ede-grade-query.js');
  const { applyAsphaltLanes } = await import('../js/ede-asphalt-attributes.js');

  const town = { minX: 0, minZ: 0, maxX: 20, maxZ: 20, step: 10, columns: 3, rows: 3,
    heights: new Float32Array([0, 2, 3, 1, 3, 4, 2, 4, 5]) };
  const context = { terrain: town, patches: [], expansion: null };
  const a = { x: 2, z: 5 }, b = { x: 8, z: 5 };
  const lane = { a, b, ux: 1, uz: 0, len: 6, width: 6, road: { layer: 0 },
    band: { origin: -1.5, width: 3, count: 2, startJunction: true, endJunction: false } };
  const cuts = [{ minX: 5, maxX: 6, minZ: 4, maxZ: 6,
    planes: [[1, 0, 5], [-1, 0, -6], [0, 1, 4], [0, -1, -6]] }];
  const outer = [2, 2, 8, 2, 8, 8, 2, 8];
  const points = [{ x: 2, z: 2 }, { x: 8, z: 2 }, { x: 8, z: 8 }, { x: 2, z: 8 }];
  const terrain = createTerrainSampler(context);
  const draped = drapeSurface(THREE, terrain, { gradeCuts: () => cuts, clipEdeGround, localGradeSurface: () => null },
    polygonGeometry(THREE, points, [], 0.065), true, undefined, true);
  const expected = applyAsphaltLanes(THREE, draped, null, 0, () => lane, section => section.band);
  const [tile] = buildPavingTile({
    context, jobs: [{ outer, holes: [], rise: 0.065, material: 'asphalt', layer: 0, cuts,
      roadColor: [0.25, 0.5, 0.3] }],
    roads: new Map([['0/0', [lane]]]), ground: [{}, null],
  });
  for (const [name, array] of tile.attributes) {
    if (name === 'color') assert.deepEqual([...array.slice(0, 4)], [64, 92, 77, 255]);
    else assert.deepEqual(array, expected.attributes[name].array, name);
  }
  assert.equal(tile.index, null);
  assert.ok(tile.attributes.find(([name]) => name === 'asphaltLanes')[1].some(value => value > 0));
});

test('paving discards a stale worker result and stages bounded mesh batches', async () => {
  const THREE = await import('../vendor/three/build/three.core.js');
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { loadModule } = require('./helpers/module.cjs');
  const source = readFileSync(join(__dirname, '../js/ede-paving-tiles.js'), 'utf8');
  const { createPavingTiles } = loadModule(source, { imports: { 'three/webgpu': THREE }, globals: { performance } });
  const scene = new THREE.Scene();
  const requests = [];
  const cancelled = [];
  const material = new THREE.MeshBasicMaterial();
  const stream = createPavingTiles(scene, () => assert.fail('worker tiles should use transferred geometry'), undefined, tile => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    requests.push(resolve);
    return { promise, cancel: () => cancelled.push(tile.minX) };
  }, { asphalt: material });
  const here = { x: 0, z: 0 }, there = { x: 2000, z: 0 };
  for (const { x } of [here, there]) stream.add({ minX: x, minZ: 0, maxX: x + 1, maxZ: 1 }, null, {});
  stream.update(here);
  stream.update(there);
  assert.deepEqual(cancelled, [0]);
  const positions = new Float32Array(3 * 3 * 290000);
  const chunk = { material: 'asphalt', attributes: [['position', positions, 3, false]], index: null,
    sphere: [2000, 0, 0, 2], bytes: positions.byteLength };
  requests[0]([chunk]);
  requests[1]([chunk, chunk]);
  await stream.pendingWork();
  stream.update(there);
  assert.equal(stream.stats.frameUploadBytes, chunk.bytes);
  assert.equal(stream.stats.resident, 0);
  stream.update(there);
  assert.equal(stream.stats.frameUploadBytes, chunk.bytes);
  assert.equal(stream.stats.workerTiles, 1);
  assert.equal(scene.children[0].children.length, 1);
});
