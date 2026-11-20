import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, color, float, floor, fract, fwidth, length, mix, mx_noise_float,
  normalGeometry, normalWorld, positionGeometry, positionView, positionWorld, smoothstep, step, texture,
  vec2, vec3, vec4, vertexColor } from 'three/tsl';
import { bumpNormal, filteredPulse, WALL_KINDS } from './tsl-materials.js';
import { archRise, openingTop } from './ede-facades.js';

const PADDING = 6;
const MAX_SIDE = 1024;
const MAX_PIXELS = 512 * 512;
const MAX_PHYSICAL_OPENINGS = 160;
const SURFACE_CODES = { brick: 1, stone: 2, block: 2, timber: 3, metal: 3, panel: 3, concrete: 2, stucco: 0, plaster: 0 };
const COLOR_SLOTS = { glazingColor: '344959', doorColor: '4f3b32', frameColor: 'c6beb0', sillColor: 'a69d91' };
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
  const arch = archRise(opening);
  const crown = px => fy(openingTop(opening, px / tile.width * tile.metres));
  const panes = clamp(Math.round(Number(opening.panes ?? opening.mullions + 1) || 1), 1, 8);
  const hasTransom = Number.isFinite(opening.transom) && opening.transom > 0.1 && opening.transom < 0.95;
  const transom = bottom + (top - bottom) * (hasTransom ? opening.transom : 0);
  const frameBar = frameY * 0.65;
  for (let py = Math.max(0, Math.floor(sillBottom)); py < Math.min(tile.height, Math.ceil(top)); py++) {
    for (let px = Math.max(0, Math.floor(sillLeft)); px < Math.min(tile.width, Math.ceil(sillRight)); px++) {
      const crownY = arch ? crown(px + 0.5) : top;
      const outer = coverage(left, bottom, right, crownY, px, py);
      let inner = coverage(left + frameX, bottom + frameY, right - frameX, crownY - frameY, px, py);
      for (let pane = 1; pane < panes && inner > 0; pane++) {
        const u = left + (right - left) * pane / panes;
        inner = Math.max(0, inner - coverage(u - frameX * 0.48, bottom + frameY, u + frameX * 0.48,
          crownY - frameY, px, py));
      }
      if (hasTransom) inner = Math.max(0, inner - coverage(left + frameX, transom - frameBar, right - frameX,
        Math.min(crownY - frameY, transom + frameBar), px, py));
      if (opening.tracery && arch && inner > 0) {
        const paneX = (px + 0.5 - left) * panes / (right - left);
        const fromCentre = Math.abs((paneX - Math.floor(paneX)) * 2 - 1);
        const peak = top - fy(arch) * (0.32 + fromCentre ** 1.4 * 0.50);
        inner = Math.max(0, inner - coverage(left + frameX, peak - frameBar, right - frameX,
          Math.min(crownY - frameY, peak + frameBar), px, py));
      }
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
    const scale = wall.status === 'inferred' ? density * 0.55 : Math.max(density, 12);
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
    if (height <= MAX_SIDE && width * height <= MAX_PIXELS && (!packed || width * height < packed.width * packed.height)) {
      packed = { tiles: placed, width, height };
    }
  }
  return packed;
}

function makeTexture(data, width, height, name, mipmaps = false) {
  const result = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  result.name = name;
  result.generateMipmaps = mipmaps;
  result.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  result.magFilter = mipmaps ? THREE.LinearFilter : THREE.NearestFilter;
  result.colorSpace = THREE.NoColorSpace;
  result.needsUpdate = true;
  return result;
}

function mipBytes(width, height) {
  let bytes = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    bytes += w * h * 4;
    if (w === 1 && h === 1) return bytes;
  }
}

export function createFacadeSurfaceTexture() {
  const side = 64, data = new Uint8Array(side * side * 4);
  const noise = (i, j) => ((Math.imul(i + 1262, 374761393) ^ Math.imul(j + 254, 668265263)) >>> 16) / 65535;
  const mod = (value, divisor) => value % divisor;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const row = y >> 3, brick = mod(x + (row % 2) * 8, 16), stone = mod(x + (row % 4) * 8, 32);
    const grain = noise(x, y);
    const i = (y * side + x) * 4;
    data[i] = mod(y, 8) === 0 || brick === 0 ? 146 : 213 + 27 * noise((x + (row % 2) * 8) >> 4, row) + 14 * grain;
    data[i + 1] = mod(y, 16) === 0 || stone === 0 ? 155 : 215 + 23 * noise((x + (row % 4) * 8) >> 5, row >> 1) + 13 * grain;
    data[i + 2] = mod(y, 8) === 0 ? 160 : 221 + 33 * noise(x >> 3, row);
    data[i + 3] = 224 + 30 * grain;
  }
  const surface = makeTexture(data, side, side, 'EdeTileableMasonry', true);
  surface.wrapS = surface.wrapT = THREE.RepeatWrapping;
  return { texture: surface, byteLength: mipBytes(side, side) };
}

function buildPalette(walls) {
  // Several walls share the same surface, frame, sill and entry finishes.
  const values = [], rows = new Map(), styles = new Map();
  for (const wall of walls) {
    const samples = Object.entries(COLOR_SLOTS).map(([name, fallback]) => {
      const value = wall[name] ?? wall.openings.find(opening => opening[name])?.[name];
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : fallback;
    });
    const surface = SURFACE_CODES[wall.wallMaterial ?? wall.masonry] ?? 1;
    const key = `${samples.join('/')}/${surface}`;
    if (!styles.has(key)) {
      styles.set(key, values.length / 16);
      for (const hex of samples) {
        const channels = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
        const linear = channels.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        values.push(...linear.map(c => Math.round(c * 255)), surface);
      }
    }
    rows.set(wall, styles.get(key));
  }
  const height = styles.size;
  for (const [wall, row] of rows) rows.set(wall, (row + 0.5) / height);
  const data = new Uint8Array(values);
  return { palette: makeTexture(data, 4, height, 'EdeFacadeFinishes'), rows, byteLength: data.byteLength };
}

function* bakeFacadeMaskAtlas(walls) {
  const candidates = walls.filter(wall => Number.isFinite(wall.height) && wall.height > 0
    && Array.isArray(wall.a) && Array.isArray(wall.b) && wallWidth(wall) > 0 && Array.isArray(wall.openings));
  if (!candidates.length) return null;
  let detailed = candidates.filter(wall => wall.wallType !== 'shared' && wall.layoutMeasured !== false && wall.openings.length);
  let atlas;
  for (const density of [20, 14, 10, 6, 3]) {
    atlas = pack(detailed, density);
    if (atlas) break;
  }
  if (!atlas) {
    // Keep landmarks and measurements when a dense tile exceeds its mask budget.
    detailed = detailed.sort((a, b) => (Number(Boolean(b.detail)) - Number(Boolean(a.detail)))
      || Number(b.status === 'observed') - Number(a.status === 'observed')
      || b.confidence - a.confidence);
    let low = 0, high = detailed.length;
    while (low < high) {
      const count = Math.ceil((low + high) / 2);
      if (pack(detailed.slice(0, count), 3)) low = count;
      else high = count - 1;
    }
    atlas = pack(detailed.slice(0, low), 3);
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
  const physical = new Set();
  let remaining = MAX_PHYSICAL_OPENINGS;
  const measured = atlas.tiles.map(tile => tile.wall).filter(wall => wall.status === 'observed')
    .sort((a, b) => Number(Boolean(b.detail)) - Number(Boolean(a.detail)) || b.confidence - a.confidence);
  for (const wall of measured) {
    if (remaining < Math.min(32, wall.openings.length)) break;
    remaining -= Math.min(32, wall.openings.length);
    physical.add(wall);
  }
  const palette = buildPalette(candidates);
  return { ...palette, texture: makeTexture(data, width, height, 'EdeFacadeMaskAtlas', true),
    rects, physical, byteLength: mipBytes(width, height) + palette.byteLength };
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
  const assigned = wall.wallType === 'shared' || wall.layoutMeasured !== false && (!wall.openings.length || rect[2] > 0) ? 1 : 0;
  return [rect[0] + clamp(u, 0, 1) * rect[2], rect[1] + clamp(v, 0, 1) * rect[3], assigned];
}

// Use the same window proportions and finishes for streamed BAG and fallback footprints.
function neighbourhoodWindows(masonry, layout, u, v, visible, entrance = float(0), eaves = float(1e6)) {
  const x = fract(u), y = fract(v);
  const depth = positionView.z.negate();
  const brickNear = float(1).sub(smoothstep(16, 48, depth)).mul(visible);
  const course = v.mul(layout.y).div(0.078);
  const brick = u.mul(layout.x).div(0.218).add(floor(course).mul(0.5));
  const joints = float(1).sub(filteredPulse(fract(course), 0.07, 0.93, fwidth(course))
    .mul(filteredPulse(fract(brick), 0.025, 0.975, fwidth(u).mul(layout.x).div(0.218))));
  const tone = mx_noise_float(vec3(floor(brick), floor(course), 3)).mul(0.14).add(1);
  const brickwork = mix(masonry.mul(tone), mix(masonry, color(0x9c8d7e), 0.5), joints.mul(0.55));
  const base = mix(masonry, brickwork, brickNear);
  const fw = fwidth(u), fh = fwidth(v);
  const left = float(0.5).sub(layout.z.mul(0.5)), right = float(1).sub(left);
  const top = layout.w.mul(0.5).add(0.53), bottom = float(1.06).sub(top);
  const near = float(1).sub(smoothstep(80, 180, depth)).mul(visible);
  const fitsUnderRoof = step(floor(v).add(top).mul(layout.y).add(0.12), eaves);
  const opening = filteredPulse(x, left, right, fw).mul(filteredPulse(y, bottom, top, fh))
    .mul(step(0.01, layout.z)).mul(float(1).sub(entrance)).mul(fitsUnderRoof).mul(near);
  const glass = filteredPulse(x, left.add(0.022), right.sub(0.022), fw)
    .mul(filteredPulse(y, bottom.add(0.022), top.sub(0.022), fh))
    .mul(float(1).sub(filteredPulse(x, 0.491, 0.509, fw))).mul(opening);
  const band = filteredPulse(y, 0.14, 0.22, fh).mul(step(0.8, layout.z)).mul(near);
  const door = filteredPulse(x, 0.32, 0.68, fw).mul(filteredPulse(y, 0, 0.77, fh)).mul(entrance).mul(near);
  const walls = mix(base, color(0xbbb5a9), band.mul(0.68));
  const frames = mix(walls, color(0xcec8b7), opening);
  return mix(mix(frames, color(0x354652), glass), color(0x42423c), door);
}

export function createEdeFacadeBoxMaterial({ layout, shed }) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.91 });
  const box = attribute('box', 'vec4'), faces = attribute('faces', 'vec4');
  const appearance = attribute('facadeAppearance', 'vec4');
  const kind = mix(faces.z, faces.w, step(0, normalGeometry.z));
  const visible = step(0.5, normalGeometry.z.abs()).mul(step(kind, WALL_KINDS.rear));
  const pier = box.x.mul(0.2).min(0.38);
  const width = box.x.sub(pier.mul(2));
  const bays = shed ? float(1) : floor(width.div(layout[0]).add(0.5)).max(1);
  const along = positionGeometry.x.add(0.5).mul(box.x).sub(pier);
  const u = along.div(width).mul(bays);
  const nominalHeight = mix(layout[1], appearance.w, step(0.1, appearance.w));
  const storeys = floor(box.y.div(nominalHeight).add(0.4)).max(1);
  const v = positionGeometry.y.add(0.5).mul(storeys);
  const entrance = step(kind.sub(WALL_KINDS.entry).abs(), 0.1).mul(step(u, 1)).mul(step(v, 1));
  const grain = mx_noise_float(positionWorld.mul(0.7)).mul(0.1).add(0.95);
  material.colorNode = neighbourhoodWindows(appearance.xyz.mul(grain), vec4(...layout), u, v,
    visible.mul(step(0, along)).mul(step(along, width)), shed || layout[2] > 0 ? entrance : float(0));
  return material;
}

export function createBagFacadeMaterial(atlas = null, surfaceTexture = null) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const grain = mx_noise_float(positionWorld.mul(0.7)).mul(0.1).add(0.95);
  const masonry = vertexColor().mul(grain);
  const wall = step(normalWorld.y.abs(), 0.35);
  const along = positionWorld.x.mul(normalWorld.z.abs()).add(positionWorld.z.mul(normalWorld.x.abs()));
  const height = attribute('buildingHeight', 'float');
  const u = fract(along.div(3.1)), v = fract(height.div(3.2));
  const above = step(2.6, height);
  const win = smoothstep(0.18, 0.22, u).mul(smoothstep(0.82, 0.78, u)).mul(smoothstep(0.34, 0.38, v)).mul(smoothstep(0.82, 0.78, v));
  const generic = masonry.mul(float(1).sub(win.mul(wall).mul(above).mul(0.55)));
  const layout = attribute('edeFacadeLayout', 'vec4');
  const bay = attribute('edeFacadeBay', 'vec2');
  const local = neighbourhoodWindows(masonry, layout, bay.x,
    height.div(layout.y.max(0.1)), wall.mul(step(0.15, height)), float(0), bay.y);
  const procedural = mix(generic, local, step(0.1, layout.x));
  material.colorNode = procedural;
  if (!atlas) return material;

  const atlasUv = attribute('facadeUv', 'vec3');
  const style = attribute('facadeStyle', 'vec3');
  const relief = attribute('facadeRelief', 'vec2');
  const distance = length(positionGeometry.sub(cameraPosition));
  const shape = float(1).sub(smoothstep(18, 42, distance));
  material.positionNode = positionGeometry.add(vec3(relief.x, 0, relief.y).mul(shape));

  const viewDistance = positionView.z.negate();
  const assigned = step(0.5, atlasUv.z);
  const masked = assigned.mul(float(1).sub(step(1.5, atlasUv.z)));
  const trim = step(2.5, atlasUv.z);
  material.maskNode = trim.lessThan(0.5).or(viewDistance.lessThan(37));
  const near = float(1).sub(smoothstep(100, 220, viewDistance));
  const masks = texture(atlas.texture, atlasUv.xy).mul(masked.mul(near));
  const door = masks.g;
  const glass = masks.r.min(float(1).sub(door));
  const frame = masks.b.min(float(1).sub(glass.add(door)).max(0));
  const sill = masks.a.min(float(1).sub(glass.add(door).add(frame)).max(0));
  const bare = float(1).sub(glass.add(door).add(frame).add(sill)).max(0);
  const finish = index => texture(atlas.palette, vec2((index + 0.5) / 4, style.z));
  const glazing = finish(0), masonryCode = glazing.a.mul(255);
  const pattern = texture(surfaceTexture, style.xy.mul(vec2(1 / 1.04, 1 / 0.64)));
  const brick = step(0.5, masonryCode).mul(float(1).sub(step(1.5, masonryCode)));
  const stone = step(1.5, masonryCode).mul(float(1).sub(step(2.5, masonryCode)));
  const cladding = step(2.5, masonryCode);
  const textureGrain = pattern.a.mul(float(1).sub(brick.add(stone).add(cladding)))
    .add(pattern.r.mul(brick)).add(pattern.g.mul(stone)).add(pattern.b.mul(cladding));
  const materialRange = float(1).sub(smoothstep(35, 95, viewDistance)).mul(assigned).mul(float(1).sub(trim));
  const wallRgb = mix(procedural, masonry, assigned).mul(mix(1, textureGrain.mul(0.32).add(0.72), materialRange)).mul(bare);
  material.colorNode = wallRgb.add(glazing.rgb.mul(glass)).add(finish(1).rgb.mul(door))
    .add(finish(2).rgb.mul(frame).mul(0.82)).add(finish(3).rgb.mul(sill));
  material.roughnessNode = bare.mul(0.92).add(glass.mul(0.2)).add(door.mul(0.59))
    .add(frame.mul(0.62)).add(sill.mul(0.67));
  material.metalnessNode = glass.mul(0.20).add(frame.mul(0.02));
  const close = float(1).sub(smoothstep(8, 35, viewDistance));
  material.normalNode = bumpNormal(frame.mul(0.003).add(sill.mul(0.007))
    .add(textureGrain.sub(0.9).mul(materialRange).mul(bare).mul(0.003)).mul(close));
  return material;
}
