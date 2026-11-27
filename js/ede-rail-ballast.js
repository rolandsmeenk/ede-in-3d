import * as THREE from 'three/webgpu';
import { RAIL_BALLAST_TOP, RAIL_SLEEPER_SPACING } from './ede-grade.js';
import { containsPavingRing } from './ede-road-surfaces.js';
import { makeSurfaceGeometry } from './ede-surface-geometry.js';

const CELL = 64;
const DEFAULT_SHOULDER = 0.52;
const MAX_REACH = 3;

export function indexBallastFootprints(surfaces) {
  const cells = new Map();
  for (const { layer, polygons } of surfaces) {
    for (const [outer, ...holes] of polygons) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
        minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
      }
      const polygon = { outer, holes, minX, minZ, maxX, maxZ };
      for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
        for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
          const key = `${layer}/${x}/${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(polygon);
        }
      }
    }
  }
  return (x, z, layer) => {
    const candidates = cells.get(`${layer}/${Math.floor(x / CELL)}/${Math.floor(z / CELL)}`) ?? [];
    return candidates.find(({ outer, holes, minX, minZ, maxX, maxZ }) =>
      x >= minX && x <= maxX && z >= minZ && z <= maxZ &&
      containsPavingRing(outer, x, z) && !holes.some(ring => containsPavingRing(ring, x, z)));
  };
}

function edgeOfFootprint({ outer, holes }, x, z, nx, nz) {
  let reach = MAX_REACH;
  for (const ring of [outer, ...holes]) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const dx = ring[i] - ring[j], dz = ring[i + 1] - ring[j + 1];
      const det = nx * dz - nz * dx;
      if (Math.abs(det) < 1e-8) continue;
      const ax = ring[j] - x, az = ring[j + 1] - z;
      const edgeT = (ax * nz - az * nx) / det;
      const distance = (ax * dz - az * dx) / det;
      if (edgeT >= 0 && edgeT <= 1 && distance >= 0) reach = Math.min(reach, distance);
    }
  }
  return reach;
}

export function buildRailBallastGeometry(sections, layer, bridge, footprintAt, terrainAt, pavementAt) {
  const positions = [], uv = [], indices = [];
  let mappedSections = 0;
  let previous, previousMapped;

  function addRow(center) {
    const { x, y, z, left, right, distance } = center;
    const top = y + RAIL_BALLAST_TOP;
    const paved = pavementAt(x, z, layer);
    const footprint = !bridge && !paved && footprintAt(x, z, layer);
    function toe(crest) {
      const crestReach = Math.hypot(crest.x - x, crest.z - z);
      if (bridge || paved || crestReach < 1e-6) return [crest.x, top, crest.z];
      const nx = (crest.x - x) / crestReach, nz = (crest.z - z) / crestReach;
      const reach = footprint ? edgeOfFootprint(footprint, x, z, nx, nz) : crestReach + DEFAULT_SHOULDER;
      const tx = x + nx * reach, tz = z + nz * reach;
      if (reach <= crestReach || pavementAt(tx, tz, layer)) return [crest.x, top, crest.z];
      const ground = terrainAt(tx, tz);
      // Leave steep fills and cuts to the existing grade geometry.
      if (ground < top - 0.6) return [crest.x, top, crest.z];
      return [tx, Math.min(top - 0.015, ground - 0.015), tz];
    }
    positions.push(...toe(left), left.x, top, left.z, right.x, top, right.z, ...toe(right));
    const v = distance / RAIL_SLEEPER_SPACING + 0.5;
    uv.push(0, v, 0, v, 1, v, 1, v);
    return Boolean(footprint);
  }
  for (const { a, b } of sections) {
    const from = positions.length / 3 - (previous === a ? 4 : 0);
    const mappedA = previous === a ? previousMapped : addRow(a);
    const mappedB = addRow(b);
    mappedSections += Number(mappedA && mappedB);
    previous = b;
    // Adjacent sections reuse the same endpoint, including its measured toe.
    previousMapped = mappedB;
    for (let i = from; i < from + 3; i++) {
      indices.push(i, i + 1, i + 4, i + 1, i + 5, i + 4);
    }
  }
  const geometry = makeSurfaceGeometry(THREE, positions, indices, uv);
  geometry.userData.mappedSections = mappedSections;
  return geometry;
}
