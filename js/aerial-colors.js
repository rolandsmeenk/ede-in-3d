import { aerialLinear, samplePavingGround } from './ede-aerial-sampling.js';
import { getExpansionTerrain } from './terrain.js';
import { EDE_AERIAL_INPUTS } from './ede-geodata.js';

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

export async function loadExpansionGroundColors() {
  const expansion = getExpansionTerrain();
  if (!aerial || !expansion?.manifest.ground) return;
  try {
    const response = await fetch(new URL('ground.jpg', expansion.directory));
    if (!response.ok) throw new Error(`PDOK overview HTTP ${response.status}`);
    aerial.expansion = await decodeGround(expansion.manifest.ground, await response.blob());
  } catch (error) {
    console.warn('[aerial] expansion overview unavailable:', error);
  }
}

export async function loadAerialColors() {
  const [metadata, photo, palette] = await Promise.all([
    requestAsset('ede-aerial.json').then((response) => response.json()),
    requestAsset('ede-aerial-ground.jpg').then((response) => response.blob()),
    requestAsset('ede-aerial-colors.bin').then((response) => response.arrayBuffer()),
  ]);
  const ground = await decodeGround(metadata, photo);
  const { buildings, roads } = EDE_AERIAL_INPUTS;
  aerial = { ground, ...decodeAerialPalette(palette, buildings, roads) };
  return aerial;
}

export const getAerialColors = () => aerial;

function samplePalette(index, out) {
  if (index === undefined) return false;
  const offset = index * 3;
  const { colors } = aerial;
  if (!(colors[offset] || colors[offset + 1] || colors[offset + 2])) return false;
  for (let i = 0; i < 3; i++) out[i] = aerialLinear[colors[offset + i]];
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
  return samplePavingGround(aerial?.ground, aerial?.expansion, x, z, out);
}
