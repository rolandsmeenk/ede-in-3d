import { EDER_KUIL_TERRAIN } from './ede-kuil-terrain.js';

// PDOK AHN DTM samples on the existing Oude Kerk scene grid.
// The binary stores centimetres NAP. World Y is relative to the origin's NAP height.
let terrain = null, patches = [], expansion = null;

export function decodeTerrain(buffer) {
  const data = new DataView(buffer);
  const invalid = () => new Error('Invalid AHN terrain asset');
  if (data.byteLength < 28 || data.getUint32(0, true) !== 0x314e4841) throw invalid();
  const columns = data.getUint32(4, true), rows = data.getUint32(8, true);
  const minX = data.getFloat32(12, true), minZ = data.getFloat32(16, true);
  const step = data.getFloat32(20, true), napOrigin = data.getFloat32(24, true);
  if (columns < 2 || rows < 2 || step <= 0 || ![minX, minZ, step, napOrigin].every(Number.isFinite)
      || data.byteLength !== 28 + columns * rows * 2) throw invalid();
  const heights = new Float32Array(columns * rows);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const height = (data.getInt16(28 + i * 2, true) - Math.round(napOrigin * 100)) / 100;
    heights[i] = height;
    minY = Math.min(minY, height);
    maxY = Math.max(maxY, height);
  }
  return {
    columns, rows, minX, minZ, step, napOrigin, heights, minY, maxY,
    maxX: minX + (columns - 1) * step, maxZ: minZ + (rows - 1) * step
  };
}

const expansionDirectory = new URL('../assets/ede-terrain-tiles/', import.meta.url);
const GINKEL_BOUNDS = [4000, 1000, 4500, 1250];

async function loadGinkelDetail(load, tiles) {
  if (!tiles['250_4000_1000'] || !tiles['250_4250_1000']) return null;
  try {
    const detail = await load(new URL('ginkel-detail.bin', expansionDirectory));
    if (detail.step !== 1.25 || Math.abs(detail.napOrigin - 22.54) > 0.001
        || [detail.minX, detail.minZ, detail.maxX, detail.maxZ].some((value, i) => value !== GINKEL_BOUNDS[i])) {
      throw new Error('Invalid Ginkelse Heide terrain patch');
    }
    return detail;
  } catch (error) {
    console.warn('[AHN Ginkelse Heide] using the 5 m terrain grid:', error);
    return null;
  }
}

async function loadExpansion(load) {
  const response = await fetch(new URL('manifest.json', expansionDirectory));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Terrain manifest HTTP ${response.status}`);
  const manifest = await response.json();
  const bounds = value => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[0] < value[2] && value[1] < value[3];
  if (manifest.version !== 1 || !bounds(manifest.bounds) || manifest.napOrigin !== 22.54
      || !Array.isArray(manifest.roots) || !manifest.roots.length || !manifest.tiles) {
    throw new Error('Invalid terrain quadtree manifest');
  }
  const visited = new Set();
  const check = (id, parent) => {
    if (visited.has(id) || typeof id !== 'string' || !/^[-_a-zA-Z0-9]+$/.test(id)) return false;
    visited.add(id);
    const tile = manifest.tiles[id];
    if (!tile || !bounds(tile.bounds) || !Number.isFinite(tile.error) || tile.error < 0 || tile.bytes !== 51 * 51 * 5) return false;
    const [w, n, e, s] = tile.bounds;
    if (e - w !== s - n || ![250, 500, 1000, 2000, 4000].includes(e - w)) return false;
    if (parent && (w < parent[0] || n < parent[1] || e > parent[2] || s > parent[3]
        || (e - w) * 2 !== parent[2] - parent[0])) return false;
    return tile.children === undefined || (Array.isArray(tile.children) && tile.children.length <= 4
      && tile.children.every(child => check(child, tile.bounds)));
  };
  if (!manifest.roots.every(id => check(id))) throw new Error('Invalid terrain hierarchy');
  const [field, detail] = await Promise.all([
    load(new URL('collision.bin', expansionDirectory)),
    loadGinkelDetail(load, manifest.tiles),
  ]);
  if (field.step !== 5 || Math.abs(field.napOrigin - manifest.napOrigin) > 0.001
      || field.minX > manifest.bounds[0] || field.minZ > manifest.bounds[1]
      || field.maxX < manifest.bounds[2] || field.maxZ < manifest.bounds[3]) throw new Error('Invalid terrain collision field');
  if (detail) {
    // Restore the unrounded coarse interpolation at every shared edge vertex.
    for (let row = 0; row < detail.rows; row++) {
      const z = detail.minZ + row * detail.step;
      const full = row === 0 || row === detail.rows - 1;
      for (let col = 0; col < detail.columns; col += full ? 1 : detail.columns - 1) {
        detail.heights[row * detail.columns + col] = sampleTerrain(field, detail.minX + col * detail.step, z);
      }
    }
  }
  return { manifest, field, directory: expansionDirectory, detail };
}

export async function loadTerrain({ expanded = false } = {}) {
  const load = async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`AHN terrain request failed: ${response.status}`);
    return decodeTerrain(await response.arrayBuffer());
  };
  const optionalPatch = (file, label) => load(new URL(file, import.meta.url)).catch(error => {
    console.warn(`Using the town terrain grid for ${label}:`, error);
    return null;
  });
  const [town, embankment, cyclingCircuit, edition] = await Promise.all([
    load(new URL('../assets/ede-ahn.bin', import.meta.url)),
    optionalPatch('../assets/ede-a12-embankment.bin', 'the A12 embankment'),
    optionalPatch('../assets/ede-wvede-terrain.bin', 'the WVEde circuit'),
    expanded ? loadExpansion(load).catch(error => {
      console.warn('[AHN terrain tiles] using the Ede town grid:', error);
      return null;
    }) : null,
  ]);
  terrain = town;
  expansion = edition;
  patches = town.step === 12 ? [EDER_KUIL_TERRAIN, ...[embankment, cyclingCircuit].filter(Boolean)] : [];
  return terrain;
}

export const getTerrain = () => terrain;
export const getExpansionTerrain = () => expansion;

export function sampleTerrain(field, x, z) {
  if (!field) return 0;
  const { minX, minZ, step, columns, rows, heights } = field;
  const cx = Math.max(0, Math.min(columns - 1, (x - minX) / step));
  const cz = Math.max(0, Math.min(rows - 1, (z - minZ) / step));
  const col = Math.min(columns - 2, Math.floor(cx)), row = Math.min(rows - 2, Math.floor(cz));
  const u = cx - col, v = cz - row;
  const i = row * columns + col;
  const a = heights[i], b = heights[i + 1], c = heights[i + columns], d = heights[i + columns + 1];
  // Same diagonal as the terrain mesh, so physics and rendered ground coincide.
  if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export const getTerrainPatches = () => patches;

export function getTerrainPatch(x, z) {
  for (const patch of patches) {
    if (x >= patch.minX && x < patch.maxX && z >= patch.minZ && z < patch.maxZ) return patch;
  }
}

export function expansionSeamOffset(x, z) {
  const field = expansion?.field;
  if (!field) return 0;
  const edgeX = Math.max(terrain.minX, Math.min(terrain.maxX, x));
  const edgeZ = Math.max(terrain.minZ, Math.min(terrain.maxZ, z));
  const blend = Math.max(0, 1 - Math.hypot(x - edgeX, z - edgeZ) / 5);
  return blend ? blend * (sampleTerrain(terrain, edgeX, edgeZ) - sampleTerrain(field, edgeX, edgeZ)) : 0;
}

export function getExpansionTerrainPatch(x, z) {
  const detail = expansion?.detail;
  if (detail && x >= detail.minX && x < detail.maxX && z >= detail.minZ && z < detail.maxZ) return detail;
}

export function terrainHeightAt(x, z) {
  const field = expansion?.field;
  if (field && (x < terrain.minX || x > terrain.maxX || z < terrain.minZ || z > terrain.maxZ)) {
    const detail = getExpansionTerrainPatch(x, z);
    return detail ? sampleTerrain(detail, x, z) : sampleTerrain(field, x, z) + expansionSeamOffset(x, z);
  }
  return sampleTerrain(getTerrainPatch(x, z) ?? terrain, x, z);
}
