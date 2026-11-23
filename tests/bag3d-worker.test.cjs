const assert = require('node:assert/strict');
const test = require('node:test');
const { Worker: NodeWorker } = require('node:worker_threads');

test('BAG worker preserves geometry and façade atlas data and replaces cancelled work', async () => {
  const T = await import('../vendor/three/build/three.core.js');
  const { projectBagMesh, projectEcefToScene } = await import('../js/bag3d-projection.js');
  const { createBagWorker } = await import('../js/bag3d-worker-client.js');
  const originalWorker = globalThis.Worker;
  let workers = 0;
  globalThis.Worker = class {
    constructor(url) {
      workers++;
      this.worker = new NodeWorker(`
        const { parentPort, workerData } = require('node:worker_threads');
        globalThis.postMessage = (...args) => parentPort.postMessage(...args);
        import(workerData).then(() => parentPort.on('message', data => globalThis.onmessage({ data })));
      `, { eval: true, workerData: url.href });
      this.worker.on('message', data => this.onmessage({ data }));
      this.worker.on('error', error => this.onerror(error));
    }
    postMessage(...args) { this.worker.postMessage(...args); }
    terminate() { this.worker.terminate(); }
  };
  const projection = createBagWorker();
  try {
    const scene = new T.Scene(), geometry = new T.BufferGeometry();
    const verts = new T.InterleavedBuffer(new Int16Array([500, 800, 0, 200, 1200, 800, 200, 200]), 4);
    const position = new T.InterleavedBufferAttribute(verts, 3, 0);
    const feature = new T.InterleavedBufferAttribute(verts, 1, 3);
    const normal = new T.BufferAttribute(new Int8Array([0, 0, 127, 0, -127, 0]), 3, true);
    geometry.setAttribute('position', position);
    geometry.setAttribute('normal', normal);
    geometry.setAttribute('_feature_id_0', feature);
    const mesh = new T.Mesh(geometry);
    scene.add(mesh);
    mesh.position.set(1, 2, 3);
    const matrix = new T.Matrix4().makeTranslation(3900000, 360000, 5100000);
    const affine = { lon0: 5, lat0: 52, x: [0, 68000, 50], z: [0, -100, -111000] };

    const cancelled = projection.project(scene, matrix, affine, false);
    projection.cancel();
    assert.equal(await cancelled, undefined);
    const actual = await projection.project(scene, matrix, affine, false);
    assert.equal(workers, 2);
    const work = projectBagMesh(position, normal, feature, matrix.clone().multiply(mesh.matrixWorld),
      point => projectEcefToScene(affine, point), false);
    let expected = work.next();
    while (!expected.done) expected = work.next();
    assert.deepEqual(actual.get(mesh), expected.value);
    assert.equal(verts.array.byteLength, 16);
    assert.equal(normal.array.byteLength, 6);

    const { bakeFacadeMaskAtlas } = await import('../js/ede-facade-atlas.js');
    const wall = { a: [0, 0], b: [5, 0], height: 3, status: 'observed', openings: [
      { kind: 'window', x: 0.4, y: 1, width: 1.2, height: 1, arch: 'segmental' },
    ] };
    const walls = [wall, { ...wall, wallType: 'shared' }];
    const atlasWork = bakeFacadeMaskAtlas(walls);
    let baked = atlasWork.next();
    while (!baked.done) baked = atlasWork.next();
    const pendingAtlas = projection.bakeAtlas(walls);
    assert.equal(projection.bakeAtlas(walls), undefined);
    assert.deepEqual(await pendingAtlas, baked.value);
    assert.equal(await projection.bakeAtlas([]), null);
    assert.equal(workers, 2);

    const { matchBagCoverage } = await import('../js/bag3d-coverage.js');
    const surface = new T.PlaneGeometry(5, 5).rotateX(-Math.PI / 2).translate(2.5, 0, 2.5);
    const second = surface.toNonIndexed().translate(12, 0, 0);
    const ring = (x, z, size) => [
      { x, z }, { x: x + size, z }, { x: x + size, z: z + size }, { x, z: z + size },
    ];
    const footprint = (id, x, size, holes = []) => ({ id, minX: x, minZ: 0, maxX: x + size, maxZ: size,
      footprints: [{ pts: ring(x, 0, size), holes }] });
    const candidates = [footprint('present', 0, 5), footprint('gap', 6, 5), footprint('partial', 9, 5),
      footprint('second', 12, 5, [ring(13, 1, 2)])];
    const coverageWork = matchBagCoverage([surface, second], candidates);
    let expectedCoverage = coverageWork.next();
    while (!expectedCoverage.done) expectedCoverage = coverageWork.next();
    assert.deepEqual(expectedCoverage.value, ['present', 'second']);
    assert.deepEqual(await projection.matchCoverage([surface, second], candidates), expectedCoverage.value);
    assert.equal(surface.index.array.length, 6);
    assert.equal(second.attributes.position.array.length, 18);
    assert.equal(workers, 2);

    projection.dispose();
    assert.equal(await projection.project(scene, matrix, affine, false), undefined);
    globalThis.Worker = class { constructor() { throw new Error('disabled'); } };
    const fallback = createBagWorker();
    assert.equal(await fallback.project(scene, matrix, affine, false), undefined);
    assert.equal(await fallback.project(scene, matrix, affine, false), undefined);
  } finally {
    projection.dispose();
    globalThis.Worker = originalWorker;
  }
});

test('Meshopt replays pending buffers inline if the worker fails asynchronously', async () => {
  const { MeshoptDecoder } = await import('../vendor/three/examples/jsm/libs/meshopt_decoder.module.js');
  const originalWorker = globalThis.Worker;
  let worker;
  globalThis.Worker = class {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  try {
    MeshoptDecoder.useWorkers(1);
    const empty = new Uint8Array(33);
    empty[0] = 0xa0; // Meshopt v0 vertex stream header plus the empty stream tail.
    const good = MeshoptDecoder.decodeGltfBufferAsync(0, 4, empty, 'ATTRIBUTES', 'NONE');
    const bad = assert.rejects(MeshoptDecoder.decodeGltfBufferAsync(0, 4, new Uint8Array(), 'ATTRIBUTES', 'NONE'),
      /Malformed buffer data/);
    worker.onerror();
    assert.equal(worker.terminated, true);
    assert.deepEqual(await good, new Uint8Array());
    await bad;
    assert.deepEqual(await MeshoptDecoder.decodeGltfBufferAsync(0, 4, empty, 'ATTRIBUTES', 'NONE'), new Uint8Array());
  } finally {
    globalThis.Worker = originalWorker;
  }
});
