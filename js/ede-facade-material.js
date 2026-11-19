import * as THREE from 'three/webgpu';
import { attribute, color, float, fract, mix, mx_noise_float, normalWorld, positionView, positionWorld,
  smoothstep, step, texture, vertexColor } from 'three/tsl';
import { bumpNormal } from './tsl-materials.js';

const PADDING = 6;
const MAX_SIDE = 2048;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const powerOfTwo = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
const wallWidth = ({ a, b }) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// Shared RGBA channels contain glass, doors, frames and sills. Coverage is exact per texel.
function fillOpening(data, stride, tile, opening) {
  const { x, y, width, height, kind } = opening;
  const fx = (m) => m * tile.width / tile.metres;
  const fy = (m) => m * tile.height / tile.wall.height;
  const left = fx(x), right = fx(x + width), bottom = fy(y), top = fy(y + height);
  const frame = clamp(opening.frame ?? 0.055, 0, Math.min(width, height) * 0.24);
  const sill = kind === 'door' ? 0 : clamp(opening.sill ?? 0, 0, 0.25);
  const frameX = fx(frame), frameY = fy(frame);
  const sillBottom = bottom - fy(sill), sillLeft = left - (sill ? fx(0.055) : 0), sillRight = right + (sill ? fx(0.055) : 0);
  const coverage = (l, b, r, t, px, py) =>
    Math.max(0, Math.min(px + 1, r) - Math.max(px, l)) * Math.max(0, Math.min(py + 1, t) - Math.max(py, b));
  const channel = kind === 'door' ? 1 : 0;
  for (let py = Math.max(0, Math.floor(sillBottom)); py < Math.min(tile.height, Math.ceil(top)); py++) {
    for (let px = Math.max(0, Math.floor(sillLeft)); px < Math.min(tile.width, Math.ceil(sillRight)); px++) {
      const outer = coverage(left, bottom, right, top, px, py);
      const inner = coverage(left + frameX, bottom + frameY, right - frameX, top - frameY, px, py);
      const ledge = coverage(sillLeft, sillBottom, sillRight, bottom, px, py);
      const index = 4 * ((tile.y + py) * stride + tile.x + px);
      data[index + channel] = Math.max(data[index + channel], Math.round(inner * 255));
      data[index + 2] = Math.max(data[index + 2], Math.round((outer - inner) * 255));
      data[index + 3] = Math.max(data[index + 3], Math.round(ledge * 255));
    }
  }
}

function pack(walls, density) {
  const tiles = walls.map((wall) => {
    const metres = wallWidth(wall);
    const scale = wall.status === 'inferred' ? density * 0.6 : density;
    return { wall, metres, width: clamp(Math.ceil(metres * scale), 2, 512),
      height: clamp(Math.ceil(wall.height * scale), 2, 512) };
  }).sort((a, b) => b.height - a.height);
  const widest = tiles.reduce((max, tile) => Math.max(max, tile.width + 2 * PADDING), 32);
  let packed;
  for (let width = powerOfTwo(widest); width <= MAX_SIDE; width *= 2) {
    let x = 0, y = PADDING, rowHeight = 0;
    const placed = tiles.map(tile => {
      const stepX = tile.width + 2 * PADDING;
      if (x + stepX > width) {
        y += rowHeight;
        x = 0;
        rowHeight = 0;
      }
      const slot = { ...tile, x: x + PADDING, y: y + PADDING };
      x += stepX;
      rowHeight = Math.max(rowHeight, tile.height + 2 * PADDING);
      return slot;
    });
    const height = y + rowHeight;
    if (height <= MAX_SIDE && (!packed || width * height < packed.width * packed.height)) {
      packed = { tiles: placed, width, height };
    }
  }
  return packed;
}

function* bakeFacadeMaskAtlas(walls) {
  const candidates = walls.filter(wall => Number.isFinite(wall.height) && wall.height > 0
    && Array.isArray(wall.a) && Array.isArray(wall.b) && wallWidth(wall) > 0 && Array.isArray(wall.openings));
  if (!candidates.length) return null;
  const detailed = candidates.filter(wall => wall.wallType !== 'shared' && wall.layoutMeasured !== false && wall.openings.length);
  let atlas;
  for (const density of [20, 14, 10, 6, 3]) {
    atlas = pack(detailed, density);
    if (atlas) break;
  }
  if (!atlas) {
    console.warn('[facades] mask atlas exceeds the texture budget, using procedural materials');
    return null;
  }
  const { width, height } = atlas;
  const data = new Uint8Array(width * height * 4);
  const blank = [0.5 / width, 0.5 / height, 0, 0];
  const rects = new Map(candidates.map(wall => [wall, blank]));
  for (const tile of atlas.tiles) {
    for (const opening of tile.wall.openings) {
      if (!['window', 'door', 'storefront'].includes(opening.kind) ||
          ![opening.x, opening.y, opening.width, opening.height].every(Number.isFinite) ||
          opening.width <= 0 || opening.height <= 0) continue;
      fillOpening(data, width, tile, opening);
      yield;
    }
    rects.set(tile.wall, [tile.x / width, tile.y / height, tile.width / width, tile.height / height]);
  }
  const atlasTexture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  atlasTexture.name = 'EdeFacadeMaskAtlas';
  atlasTexture.generateMipmaps = true;
  atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.colorSpace = THREE.NoColorSpace;
  atlasTexture.needsUpdate = true;
  let byteLength = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    byteLength += w * h * 4;
    if (w === 1 && h === 1) break;
  }
  return { texture: atlasTexture, rects, byteLength };
}

export function buildFacadeMaskAtlas(walls) {
  const bake = bakeFacadeMaskAtlas(walls);
  let step;
  do step = bake.next(); while (!step.done);
  return step.value;
}

async function buildFacadeMaskAtlasIncrementally(walls, stillWanted) {
  const bake = bakeFacadeMaskAtlas(walls);
  let start = performance.now();
  let step;
  while (!(step = bake.next()).done) {
    if (performance.now() - start < 5) continue;
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!stillWanted()) return null;
    start = performance.now();
  }
  return step.value;
}

export { buildFacadeMaskAtlasIncrementally };

export function projectFacadeUv(wall, rect, x, y, z, bottomY = wall.minY) {
  const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1];
  const u = ((x - wall.a[0]) * dx + (z - wall.a[1]) * dz) / (dx * dx + dz * dz);
  const v = (y - bottomY) / wall.height;
  const assigned = wall.layoutMeasured !== false || wall.wallType === 'shared' ? 1 : 0;
  return [rect[0] + clamp(u, 0, 1) * rect[2], rect[1] + clamp(v, 0, 1) * rect[3], assigned];
}

export function createBagFacadeMaterial(maskTexture = null) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const grain = mx_noise_float(positionWorld.mul(0.7)).mul(0.1).add(0.95);
  const masonry = vertexColor().mul(grain);
  const wall = step(normalWorld.y.abs(), 0.35);
  const along = positionWorld.x.mul(normalWorld.z.abs()).add(positionWorld.z.mul(normalWorld.x.abs()));
  const height = attribute('buildingHeight', 'float');
  const u = fract(along.div(3.1)), v = fract(height.div(3.2));
  const above = step(2.6, height);
  const win = smoothstep(0.18, 0.22, u).mul(smoothstep(0.82, 0.78, u)).mul(smoothstep(0.34, 0.38, v)).mul(smoothstep(0.82, 0.78, v));
  const procedural = masonry.mul(float(1).sub(win.mul(wall).mul(above).mul(0.55)));
  material.colorNode = procedural;
  if (!maskTexture) return material;

  const atlasUv = attribute('facadeUv', 'vec3');
  const assigned = step(0.5, atlasUv.z);
  const near = float(1).sub(smoothstep(100, 220, positionView.z.negate()));
  const masks = texture(maskTexture, atlasUv.xy).mul(assigned.mul(near));
  const door = masks.g;
  const glass = masks.r.min(float(1).sub(door));
  const frame = masks.b.min(float(1).sub(glass.add(door)).max(0));
  const sill = masks.a.min(float(1).sub(glass.add(door).add(frame)).max(0));
  const bare = float(1).sub(glass.add(door).add(frame).add(sill)).max(0);
  const wallRgb = mix(procedural, masonry, assigned).mul(bare);
  material.colorNode = wallRgb.add(color(0x344959).mul(glass)).add(color(0x4f3b32).mul(door))
    .add(color(0xc6beb0).mul(frame)).add(color(0xa69d91).mul(sill));
  material.roughnessNode = bare.mul(0.92).add(glass.mul(0.2)).add(door.mul(0.59))
    .add(frame.mul(0.45)).add(sill.mul(0.67));
  material.metalnessNode = glass.mul(0.20).add(frame.mul(0.06));
  const close = float(1).sub(smoothstep(8, 35, positionView.z.negate()));
  material.normalNode = bumpNormal(frame.mul(0.012).add(sill.mul(0.026)).mul(close));
  return material;
}
