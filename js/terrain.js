import { EDER_KUIL_TERRAIN } from './ede-kuil-terrain.js';

// PDOK AHN DTM samples on the existing Oude Kerk scene grid.
// The binary stores centimetres NAP. World Y is relative to the origin's NAP height.
let terrain = null, patches = [], expansion = null;

export function decodeTerrain(buffer, compact = false) {
  const data = new DataView(buffer);
  const invalid = () => new Error('Invalid AHN terrain asset');
  if (data.byteLength < 28) throw invalid();
  const magic = data.getUint32(0, true), delta = magic === 0x324e4841;
  if (magic !== 0x314e4841 && !delta) throw invalid();
  const columns = data.getUint32(4, true), rows = data.getUint32(8, true);
  const minX = data.getFloat32(12, true), minZ = data.getFloat32(16, true);
  const step = data.getFloat32(20, true), napOrigin = data.getFloat32(24, true);
  if (columns < 2 || rows < 2 || step <= 0 || ![minX, minZ, step, napOrigin].every(Number.isFinite)
      || data.byteLength !== 28 + columns * rows * 2) throw invalid();
  const heights = compact ? new Int16Array(columns * rows) : new Float32Array(columns * rows);
  const datum = Math.round(napOrigin * 100);
  let minY = Infinity, maxY = -Infinity, raw = 0;
  for (let row = 0, i = 0; row < rows; row++) for (let column = 0; column < columns; column++, i++) {
    const value = data.getInt16(28 + i * 2, true);
    raw = delta && column > 0 ? ((raw + value) << 16) >> 16 : value;
    const height = (raw - datum) / 100;
    heights[i] = compact ? raw : height;
    minY = Math.min(minY, height);
    maxY = Math.max(maxY, height);
  }
  return {
    columns, rows, minX, minZ, step, napOrigin, heights, minY, maxY, datum: compact ? datum : undefined,
    maxX: minX + (columns - 1) * step, maxZ: minZ + (rows - 1) * step
  };
}

const expansionDirectory = new URL('../assets/ede-terrain-tiles/', import.meta.url);
const GINKEL_BOUNDS = [4000, 1000, 4500, 1250];

async function loadGinkelDetail(load, tiles) {
  if (!tiles['250_4000_1000'] || !tiles['250_4250_1000']) return null;
  try {
    const detail = await load(new URL('ginkel-detail.bin?v=20261123-municipal', expansionDirectory));
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
  const response = await fetch(new URL('manifest.json?v=20261123-municipal', expansionDirectory));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Terrain manifest HTTP ${response.status}`);
  const manifest = await response.json();
  const bounds = value => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[0] < value[2] && value[1] < value[3];
  if (![1, 2].includes(manifest.version) || !bounds(manifest.bounds) || manifest.napOrigin !== 22.54
      || !Array.isArray(manifest.roots) || !manifest.roots.length || !manifest.tiles) {
    throw new Error('Invalid terrain quadtree manifest');
  }
  const buffered = manifest.version === 2;
  const visited = new Set();
  const check = (id, parent) => {
    if (visited.has(id) || typeof id !== 'string' || !/^[-_a-zA-Z0-9]+$/.test(id)) return false;
    visited.add(id);
    const tile = manifest.tiles[id];
    if (!tile || !bounds(tile.bounds) || !Number.isFinite(tile.error) || tile.error < 0 || tile.bytes !== 51 * 51 * 5) return false;
    if (buffered && (!Array.isArray(tile.range) || tile.range.length !== 2
        || !tile.range.every(Number.isInteger) || tile.range[0] > tile.range[1]
        || (!parent && !(Number.isFinite(tile.overviewError) && tile.overviewError >= 0)))) return false;
    const [w, n, e, s] = tile.bounds;
    if (e - w !== s - n || ![250, 500, 1000, 2000, 4000].includes(e - w)) return false;
    if (parent && (w < parent[0] || n < parent[1] || e > parent[2] || s > parent[3]
        || (e - w) * 2 !== parent[2] - parent[0])) return false;
    return tile.children === undefined || (Array.isArray(tile.children) && tile.children.length <= 4
      && tile.children.every(child => check(child, tile.bounds)));
  };
  if (!manifest.roots.every(id => check(id))) throw new Error('Invalid terrain hierarchy');
  const collisionBounds = buffered ? manifest.collisionBounds : manifest.bounds;
  if (!bounds(collisionBounds) || buffered && manifest.collisionFile !== 'collision.bin.gz') {
    throw new Error('Invalid terrain collision bounds');
  }
  const [field, detail, overviewField, rootSamples] = await Promise.all([
    load(new URL(buffered ? manifest.collisionFile : 'collision.bin', expansionDirectory), buffered),
    loadGinkelDetail(load, manifest.tiles),
    buffered && load(new URL('overview.bin?v=20261123-municipal', expansionDirectory), true),
    buffered && fetch(new URL('roots.bin?v=20261123-municipal', expansionDirectory)).then(response => {
      if (!response.ok) throw new Error(`Terrain root overview HTTP ${response.status}`);
      return response.arrayBuffer();
    }),
  ]);
  if (field.step !== 5 || Math.abs(field.napOrigin - manifest.napOrigin) > 0.001
      || !coversBounds(field, collisionBounds)) throw new Error('Invalid terrain collision field');
  if (buffered && (!coversBounds(overviewField, manifest.bounds)
      || Math.abs(overviewField.napOrigin - field.napOrigin) > 0.001
      || rootSamples.byteLength !== manifest.roots.length * 13 ** 2 * 2)) {
    throw new Error('Invalid terrain overview');
  }
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
  return { manifest, field, directory: expansionDirectory, detail, overviewField, rootSamples };
}

export async function loadTerrain({ expanded = false } = {}) {
  const load = async (url, compact = false) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`AHN terrain request failed: ${response.status}`);
    let buffer = await response.arrayBuffer();
    if (url.pathname.endsWith('.gz') && buffer.byteLength >= 2 && new DataView(buffer).getUint16(0) === 0x1f8b) {
      const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      buffer = await new Response(stream).arrayBuffer();
    }
    return decodeTerrain(buffer, compact);
  };
  const optionalPatch = (file, label) => load(new URL(file, import.meta.url)).catch(error => {
    console.warn(`Using the town terrain grid for ${label}:`, error);
    return null;
  });
  const [town, edition, ...localPatches] = await Promise.all([
    load(new URL('../assets/ede-ahn.bin', import.meta.url)),
    expanded ? loadExpansion(load).catch(error => {
      console.warn('[AHN terrain tiles] using the Ede town grid:', error);
      return null;
    }) : null,
    optionalPatch('../assets/ede-a12-embankment.bin', 'the A12 embankment'),
    optionalPatch('../assets/ede-wvede-terrain.bin', 'the WVEde circuit'),
    optionalPatch('../assets/ede-a12-lukkien.bin', 'the A12 at Lukkien'),
    ...['maanderbroek', 'a30-galvanistraat', 'a12-ede-east', 'a12-wageningen'].map(site =>
      optionalPatch(`../assets/ede-motorway-${site}.bin.gz`, site)),
  ]);
  terrain = town;
  expansion = edition;
  patches = town.step === 12 ? [EDER_KUIL_TERRAIN, ...localPatches.filter(Boolean)] : [];
  return terrain;
}

export const getTerrain = () => terrain;
export const getExpansionTerrain = () => expansion;

function coversBounds(field, [w, n, e, s]) {
  return field.minX <= w && field.minZ <= n && field.maxX >= e && field.maxZ >= s;
}

export function sampleTerrain(field, x, z) {
  if (!field) return 0;
  const { minX, minZ, step, columns, rows, heights } = field;
  const cx = Math.max(0, Math.min(columns - 1, (x - minX) / step));
  const cz = Math.max(0, Math.min(rows - 1, (z - minZ) / step));
  const col = Math.min(columns - 2, Math.floor(cx)), row = Math.min(rows - 2, Math.floor(cz));
  const u = cx - col, v = cz - row;
  const stride = field.stride ?? columns;
  const i = (row - (field.rowOffset ?? 0)) * stride + col - (field.columnOffset ?? 0);
  const a = heights[i], b = heights[i + 1], c = heights[i + stride], d = heights[i + stride + 1];
  // Same diagonal as the terrain mesh, so physics and rendered ground coincide.
  const height = u + v <= 1 ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  return field.datum === undefined ? height : (height - field.datum) / 100;
}

export const getTerrainPatches = () => patches;

export function getTerrainPatch(x, z, candidates = patches) {
  for (const patch of candidates) {
    if (x >= patch.minX && x < patch.maxX && z >= patch.minZ && z < patch.maxZ) return patch;
  }
}

export function expansionSeamOffset(x, z, town = terrain, field = expansion?.field) {
  if (!field) return 0;
  const edgeX = Math.max(town.minX, Math.min(town.maxX, x));
  const edgeZ = Math.max(town.minZ, Math.min(town.maxZ, z));
  const blend = Math.max(0, 1 - Math.hypot(x - edgeX, z - edgeZ) / 5);
  return blend ? blend * (sampleTerrain(town, edgeX, edgeZ) - sampleTerrain(field, edgeX, edgeZ)) : 0;
}

export function getExpansionTerrainPatch(x, z, detail = expansion?.detail) {
  if (detail && x >= detail.minX && x < detail.maxX && z >= detail.minZ && z < detail.maxZ) return detail;
}

export function terrainHeightAt(x, z, context) {
  const town = context ? context.terrain : terrain;
  const localPatches = context ? context.patches : patches;
  const localExpansion = context ? context.expansion : expansion;
  const field = localExpansion?.field;
  if (field && (x < town.minX || x > town.maxX || z < town.minZ || z > town.maxZ)) {
    const detail = getExpansionTerrainPatch(x, z, localExpansion.detail ?? null);
    if (detail) return sampleTerrain(detail, x, z);
    const sampler = localExpansion.overviewField && !coversBounds(field, [x, z, x, z]) ? localExpansion.overviewField : field;
    return sampleTerrain(sampler, x, z) + expansionSeamOffset(x, z, town, field);
  }
  return sampleTerrain(getTerrainPatch(x, z, localPatches) ?? town, x, z);
}

function cropTerrain(field, [west, north, east, south]) {
  if (!field) return null;
  const { columns, rows, minX, minZ, step, heights } = field;
  const start = (value, origin, count) => Math.min(count - 2, Math.max(0, Math.floor((value - origin) / step)));
  const end = (value, origin, count) => start(value, origin, count) + 1;
  const columnOffset = start(west, minX, columns), rowOffset = start(north, minZ, rows);
  const columnEnd = end(east, minX, columns), rowEnd = end(south, minZ, rows);
  const stride = columnEnd - columnOffset + 1;
  const plain = Array.isArray(heights);
  const HeightArray = plain ? Float64Array : heights.constructor;
  const local = new HeightArray(stride * (rowEnd - rowOffset + 1));
  for (let row = rowOffset; row <= rowEnd; row++) {
    const index = row * columns + columnOffset;
    const samples = plain ? heights.slice(index, index + stride) : heights.subarray(index, index + stride);
    local.set(samples, (row - rowOffset) * stride);
  }
  return { ...field, columnOffset, rowOffset, stride, heights: local };
}

export function captureTerrainContext(bounds) {
  const [west, north, east, south] = bounds;
  const seamBounds = [west - 5, north - 5, east + 5, south + 5];
  const overlaps = field => field && field.minX <= east && field.maxX >= west && field.minZ <= south && field.maxZ >= north;
  return {
    terrain: cropTerrain(terrain, seamBounds),
    patches: patches.filter(overlaps).map(patch => cropTerrain(patch, bounds)),
    expansion: expansion ? {
      field: cropTerrain(expansion.field, seamBounds),
      detail: overlaps(expansion.detail) ? cropTerrain(expansion.detail, bounds) : null,
      overviewField: cropTerrain(expansion.overviewField, bounds),
    } : null,
  };
}

export function createTerrainSampler(context) {
  const { terrain: town, patches: localPatches, expansion: localExpansion } = context;
  return {
    getTerrain: () => town,
    getExpansionTerrain: () => localExpansion,
    getTerrainPatch: (x, z) => getTerrainPatch(x, z, localPatches),
    getExpansionTerrainPatch: (x, z) => getExpansionTerrainPatch(x, z, localExpansion?.detail ?? null),
    terrainHeightAt: (x, z) => terrainHeightAt(x, z, context),
    expansionSeamOffset: (x, z) => expansionSeamOffset(x, z, town, localExpansion?.field ?? null),
  };
}
