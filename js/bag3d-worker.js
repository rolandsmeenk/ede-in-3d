// Workers do not inherit the document import map.
import {
  BufferAttribute, Float16BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Matrix4
} from '../vendor/three/build/three.core.js';
import { projectBagMesh, projectEcefToScene } from './bag3d-projection.js';
import { bakeFacadeMaskAtlas } from './ede-facade-atlas.js';
import { matchBagCoverage } from './bag3d-coverage.js?v=20261127-holes-fix';

function attribute(data) {
  if (!data) return;
  const { array, itemSize, normalized, stride, offset, halfFloat } = data;
  if (stride) return new InterleavedBufferAttribute(new InterleavedBuffer(array, stride), itemSize, offset, normalized);
  return halfFloat ? new Float16BufferAttribute(array, itemSize, normalized) : new BufferAttribute(array, itemSize, normalized);
}

function finish(work) {
  let result = work.next();
  while (!result.done) result = work.next();
  return result.value;
}

globalThis.onmessage = ({ data: { affine, limitToMunicipality, matrix, primitives, walls, coverage } }) => {
  try {
    if (walls) {
      const atlas = finish(bakeFacadeMaskAtlas(walls));
      globalThis.postMessage(atlas, atlas ? [atlas.data.buffer, atlas.paletteData.buffer] : []);
      return;
    }
    if (coverage) {
      const geometries = coverage.meshes.map(({ positions, indices }) => ({
        attributes: { position: new BufferAttribute(positions, 3) },
        index: indices && new BufferAttribute(indices, 1),
      }));
      globalThis.postMessage(finish(matchBagCoverage(geometries, coverage.footprints)));
      return;
    }
    const tile = new Matrix4().fromArray(matrix);
    const project = point => projectEcefToScene(affine, point);
    const transfers = [];
    const projected = primitives.map(({ world, position, normal, feature }) => {
      const full = new Matrix4().multiplyMatrices(tile, new Matrix4().fromArray(world));
      const work = projectBagMesh(attribute(position), attribute(normal), attribute(feature), full, project, limitToMunicipality);
      const result = finish(work);
      const { positions, normals, colors } = result;
      transfers.push(positions.buffer, normals.buffer, colors.buffer);
      return result;
    });
    globalThis.postMessage(projected, transfers);
  } catch {
    globalThis.postMessage(undefined);
  }
};
