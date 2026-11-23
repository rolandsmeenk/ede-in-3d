// Byte RGB from the orthophoto is sRGB; the mesh attributes are linear.
export const aerialLinear = Float32Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});
export function samplePavingGround(ground, expansion, x, z, out) {
  if (!ground) return false;
  let u = (x - ground.minX) / ground.step, v = (z - ground.minZ) / ground.step;
  if (expansion && !(u >= 0 && v >= 0 && u <= ground.width - 1 && v <= ground.height - 1)) {
    ground = expansion;
    u = (x - ground.minX) / ground.step;
    v = (z - ground.minZ) / ground.step;
  }
  const { width, height, data } = ground;
  if (!(u >= 0 && v >= 0 && u <= width - 1 && v <= height - 1)) return false;
  const col = Math.min(width - 2, Math.floor(u)), row = Math.min(height - 2, Math.floor(v));
  const dx = u - col, dz = v - row;
  const stride = (ground.sampleWidth ?? width) * 4;
  const i = (row - (ground.rowOffset ?? 0)) * stride + (col - (ground.columnOffset ?? 0)) * 4;
  for (let j = 0; j < 3; j++) {
    const top = aerialLinear[data[i + j]] * (1 - dx) + aerialLinear[data[i + 4 + j]] * dx;
    const bottom = aerialLinear[data[i + stride + j]] * (1 - dx) + aerialLinear[data[i + stride + 4 + j]] * dx;
    out[j] = top * (1 - dz) + bottom * dz;
  }
  return true;
}

export function captureGroundColor(ground, { minX, minZ, maxX, maxZ }) {
  if (!ground) return null;
  const { width, height, step } = ground;
  const limit = (n, max) => Math.max(0, Math.min(max, n));
  const col = limit(Math.floor((minX - ground.minX) / step), width - 2);
  const row = limit(Math.floor((minZ - ground.minZ) / step), height - 2);
  const sampleWidth = limit(Math.ceil((maxX - ground.minX) / step) + 1, width - 1) - col + 1;
  const sampleHeight = limit(Math.ceil((maxZ - ground.minZ) / step) + 1, height - 1) - row + 1;
  const data = new Uint8ClampedArray(sampleWidth * sampleHeight * 4);
  for (let j = 0; j < sampleHeight; j++) {
    const first = ((row + j) * width + col) * 4;
    data.set(ground.data.subarray(first, first + sampleWidth * 4), j * sampleWidth * 4);
  }
  return { width, height, minX: ground.minX, minZ: ground.minZ, step, sampleWidth, rowOffset: row, columnOffset: col, data };
}
