// Tile streaming schedules one build at a time. Keep one worker and no separate queue.
export function createBagWorker() {
  let worker, pending, unavailable = typeof Worker !== 'function';

  function finish(result) {
    if (!pending) return;
    const { resolve, timer } = pending;
    pending = null;
    clearTimeout(timer);
    resolve(result);
  }

  function cancel() {
    if (!pending) return;
    worker?.terminate();
    worker = null;
    finish();
  }

  function fail() {
    unavailable = true;
    cancel();
  }

  function submit(message, transfers = []) {
    if (unavailable || pending) return;
    try {
      if (!worker) {
        worker = new Worker(new URL('./bag3d-worker.js?v=20261127-holes-fix', import.meta.url), { type: 'module' });
        const instance = worker;
        worker.onerror = worker.onmessageerror = () => {
          if (worker === instance) fail();
        };
        worker.onmessage = ({ data }) => {
          if (worker !== instance || !pending) return;
          if (data === undefined) {
            fail();
            return;
          }
          finish(data);
        };
      }
      return new Promise(resolve => {
        pending = { resolve, timer: setTimeout(fail, 12000) };
        try {
          worker.postMessage(message, transfers);
        } catch {
          fail();
        }
      });
    } catch {
      fail();
    }
  }

  async function project(scene, matrix, affine, limitToMunicipality) {
    if (unavailable || pending) return;
    const arrays = new Map(), meshes = [], primitives = [];
    const attributeData = attribute => {
      if (!attribute) return;
      const { itemSize, normalized } = attribute;
      const { array, stride } = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
      if (!arrays.has(array)) arrays.set(array, array.slice());
      return { array: arrays.get(array), itemSize, normalized, stride, offset: attribute.offset,
        halfFloat: attribute.isFloat16BufferAttribute };
    };
    try {
      scene.updateMatrixWorld(true);
      scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        const { position, normal, _feature_id_0: feature } = mesh.geometry.attributes;
        meshes.push(mesh);
        primitives.push({
          world: mesh.matrixWorld.toArray(),
          position: attributeData(position), normal: attributeData(normal), feature: attributeData(feature),
        });
      });
      const data = await submit({ affine, limitToMunicipality, matrix: matrix.toArray(), primitives },
        [...arrays.values()].map(array => array.buffer));
      if (Array.isArray(data) && data.length === meshes.length) return new Map(meshes.map((mesh, i) => [mesh, data[i]]));
    } catch {
      fail();
    }
  }

  function bakeAtlas(walls) {
    return submit({ walls });
  }

  function matchCoverage(geometries, candidates) {
    if (unavailable || pending) return;
    try {
      const transfers = [];
      const meshes = geometries.map(({ attributes: { position }, index }) => {
        // Baked positions and indices are packed and still needed for rendering.
        const positions = position.array.slice(), indices = index?.array.slice();
        transfers.push(positions.buffer);
        if (indices) transfers.push(indices.buffer);
        return { positions, indices };
      });
      const footprints = candidates.map(({ id, minX, minZ, maxX, maxZ, footprints: [{ pts, holes }] }) =>
        ({ id, minX, minZ, maxX, maxZ, footprints: [{ pts, holes }] }));
      return submit({ coverage: { meshes, footprints } }, transfers);
    } catch {
      fail();
    }
  }

  function dispose() {
    cancel();
    worker?.terminate();
    worker = null;
    unavailable = true;
  }

  return { project, bakeAtlas, matchCoverage, cancel, dispose };
}
