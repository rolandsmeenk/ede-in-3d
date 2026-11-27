import { containsPavingRing, getEdeRoadSurfaces, osmRoadMaterial } from './ede-road-surfaces.js';
import { nearestRoads } from './city-config.js';

const SOUND_SURFACE = {
  brick: 'klinkers', block: 'klinkers', wood: 'timber', sand: 'sand', gravel: 'sand',
};
const timberWays = new Set(['w35629643', 'w1070687304', 'w1174301132']);
const pavingCell = 40;
const pavingKey = (x, z) => Math.floor(x / pavingCell) * 100000 + Math.floor(z / pavingCell);

function indexPaving(surfaces) {
  const index = new Map();
  for (const { polygons, material, layer = 0 } of surfaces) {
    const sound = SOUND_SURFACE[material] || 'hard';
    for (const [outer, ...holes] of polygons) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        const x = outer[i], z = outer[i + 1];
        x0 = Math.min(x0, x); z0 = Math.min(z0, z);
        x1 = Math.max(x1, x); z1 = Math.max(z1, z);
      }
      const entry = { outer, holes, layer, sound };
      for (let x = Math.floor(x0 / pavingCell); x <= Math.floor(x1 / pavingCell); x++) {
        for (let z = Math.floor(z0 / pavingCell); z <= Math.floor(z1 / pavingCell); z++) {
          const key = x * 100000 + z;
          const list = index.get(key);
          if (list) list.push(entry);
          else index.set(key, [entry]);
        }
      }
    }
  }
  return index;
}

export function createFootstepSampler(habitatAt, getSurfaces = getEdeRoadSurfaces, nearbyRoads = nearestRoads) {
  let surfaces, index;
  return (x, z) => {
    const mapped = getSurfaces().surfaces;
    if (mapped !== surfaces) {
      surfaces = mapped;
      index = indexPaving(surfaces);
    }
    const { road } = nearbyRoads(x, z, 6).find(({ road, dist }) => dist <= road.w / 2) ?? {};
    // The local boardwalks are tagged as footbridges in the map and confirmed as planks on site guides.
    if (road?.surface === 'wood' || timberWays.has(road?.id)) return 'timber';
    const paving = index.get(pavingKey(x, z))?.find(({ outer, holes, layer }) =>
      layer === (road?.layer || 0) && containsPavingRing(outer, x, z) &&
      !holes.some(hole => containsPavingRing(hole, x, z)));
    if (paving) return paving.sound;
    const material = road && osmRoadMaterial(road);
    if (material) return SOUND_SURFACE[material] || 'hard';
    const habitat = habitatAt?.(x, z);
    return habitat === 'dry-heath' || habitat === 'damp-heath' || habitat === 'sand' ? 'sand' : 'hard';
  };
}

// Along the surveyed Kreelse Plas shoreline, beside OSM boardwalk w1070687304.
export const KREELSE_PLAS_SOUNDS = [
  { kind: 'pondLap', x: 3223.2, z: -409.7, height: 0.17, range: 58, ref: 8, seed: 341.11 },
  { kind: 'reeds', x: 3215.7, z: -423.5, height: 0.9, range: 43, ref: 7, seed: 323.57 },
];

export function decodeEdeAmbientNoise(buffer) {
  const headerSize = 24;
  if (buffer.byteLength < headerSize) throw new Error('Invalid ambient-noise map header');
  const header = new DataView(buffer);
  const width = header.getUint32(4, true), height = header.getUint32(8, true);
  const x0 = header.getFloat32(12, true), z0 = header.getFloat32(16, true);
  const step = header.getFloat32(20, true);
  if (header.getUint32(0) !== 0x454e4131 || width < 2 || height < 2 ||
      ![x0, z0, step].every(Number.isFinite) || step <= 0 ||
      buffer.byteLength !== headerSize + 2 * width * height) throw new Error('Invalid ambient-noise map');
  const cells = new Uint8Array(buffer, headerSize);
  return (x, z, levels) => {
    const u = (x - x0) / step, v = (z - z0) / step;
    if (!(u >= 0 && v >= 0 && u <= width - 1 && v <= height - 1)) return false;
    const col = Math.min(width - 2, Math.floor(u)), row = Math.min(height - 2, Math.floor(v));
    const dx = u - col, dz = v - row, idx = (row * width + col) * 2;
    const mix = i => (cells[i] * (1 - dx) + cells[i + 2] * dx) * (1 - dz)
      + (cells[i + width * 2] * (1 - dx) + cells[i + width * 2 + 2] * dx) * dz;
    levels.road = ldenGain(mix(idx));
    levels.rail = ldenGain(mix(idx + 1));
    return true;
  };
}

function ldenGain(db) {
  return Math.min(1, Math.max(0, (db - 40) / 32)) ** 1.4;
}

export async function loadEdeAmbientNoise() {
  const response = await fetch(new URL('../assets/ede-ambient-noise.bin.gz', import.meta.url));
  if (!response.ok) throw new Error(`Ede ambient-noise map HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const gzip = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  const buffer = gzip[0] === 31 && gzip[1] === 139
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : bytes;
  return decodeEdeAmbientNoise(buffer);
}
