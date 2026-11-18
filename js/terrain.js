// PDOK AHN DTM samples on the existing Oude Kerk scene grid.
// The binary stores centimetres NAP. World Y is relative to the origin's NAP height.
let terrain = null;

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

export async function loadTerrain() {
  const response = await fetch(new URL('../assets/ede-ahn.bin', import.meta.url));
  if (!response.ok) throw new Error(`AHN terrain request failed: ${response.status}`);
  terrain = decodeTerrain(await response.arrayBuffer());
  return terrain;
}

export const getTerrain = () => terrain;

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

export function terrainHeightAt(x, z) {
  return sampleTerrain(terrain, x, z);
}
