import { EDE_DATA } from './ede-geodata.js';

// Byte RGB from the orthophoto is sRGB; the mesh attributes are linear.
const linear = Float32Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});
let aerial = null;

export function decodeAerialPalette(buffer, buildings, roads) {
  const header = new DataView(buffer);
  const roofIndices = new Map(buildings.map(({ id }, index) => [id, index]));
  const roadIndices = new Map();
  let segmentCount = 0;
  for (const { id, pts } of roads) {
    const count = pts.length / 2 - 1;
    roadIndices.set(id, { offset: buildings.length + segmentCount, count });
    segmentCount += count;
  }
  if (buffer.byteLength !== 12 + (buildings.length + segmentCount) * 3
      || header.getUint32(0, true) !== 0x31434145
      || header.getUint32(4, true) !== buildings.length
      || header.getUint32(8, true) !== segmentCount) throw new Error('Invalid Ede aerial palette');
  return { colors: new Uint8Array(buffer, 12), roofIndices, roadIndices };
}

async function requestAsset(name) {
  const response = await fetch(new URL(`../assets/${name}`, import.meta.url));
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  return response;
}

async function decodeGround({ width, height, minX, minZ, step }, blob) {
  if (![width, height].every((size) => Number.isInteger(size) && size >= 2)
      || ![minX, minZ, step].every(Number.isFinite) || step <= 0) {
    throw new Error('Invalid Ede aerial ground grid');
  }
  const image = await createImageBitmap(blob);
  try {
    if (image.width !== width || image.height !== height) throw new Error('Ede aerial image dimensions differ from grid');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    return { width, height, minX, minZ, step, data };
  } finally {
    image.close();
  }
}

export async function loadAerialColors() {
  const [metadata, photo, palette] = await Promise.all([
    requestAsset('ede-aerial.json').then((response) => response.json()),
    requestAsset('ede-aerial-ground.jpg').then((response) => response.blob()),
    requestAsset('ede-aerial-colors.bin').then((response) => response.arrayBuffer()),
  ]);
  const ground = await decodeGround(metadata, photo);
  aerial = { ground, ...decodeAerialPalette(palette, EDE_DATA.buildings, EDE_DATA.roads) };
  return aerial;
}

export const getAerialColors = () => aerial;

function samplePalette(index, out) {
  if (index === undefined) return false;
  const offset = index * 3;
  const { colors } = aerial;
  if (!(colors[offset] || colors[offset + 1] || colors[offset + 2])) return false;
  for (let i = 0; i < 3; i++) out[i] = linear[colors[offset + i]];
  return true;
}

export function sampleRoofColor(buildingId, out) {
  return samplePalette(aerial?.roofIndices.get(buildingId), out);
}

export function sampleRoadColor(roadId, segmentIndex, out) {
  const road = aerial?.roadIndices.get(roadId);
  return !!road && Number.isInteger(segmentIndex) && segmentIndex >= 0 && segmentIndex < road.count
    && samplePalette(road.offset + segmentIndex, out);
}

export function sampleGroundColor(x, z, out) {
  if (!aerial) return false;
  const { width, height, minX, minZ, step, data } = aerial.ground;
  const u = (x - minX) / step, v = (z - minZ) / step;
  if (!(u >= 0 && v >= 0 && u <= width - 1 && v <= height - 1)) return false;
  const col = Math.min(width - 2, Math.floor(u)), row = Math.min(height - 2, Math.floor(v));
  const dx = u - col, dz = v - row;
  const i = (row * width + col) * 4, stride = width * 4;
  for (let j = 0; j < 3; j++) {
    const top = linear[data[i + j]] * (1 - dx) + linear[data[i + 4 + j]] * dx;
    const bottom = linear[data[i + stride + j]] * (1 - dx) + linear[data[i + stride + 4 + j]] * dx;
    out[j] = top * (1 - dz) + bottom * dz;
  }
  return true;
}
