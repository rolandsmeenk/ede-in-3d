import { archRise, isCorridorFacade, openingTop } from './ede-facades.js';

const PADDING = 6;
const MAX_SIDE = 1024;
const MAX_PIXELS = 512 * 512;
const MAX_PHYSICAL_OPENINGS = 160;
const SURFACE_CODES = { brick: 1, stone: 2, block: 2, timber: 3, metal: 4, panel: 5, corten: 6, concrete: 2, stucco: 0, plaster: 0 };
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
  const channel = kind === 'door' ? 1 : kind === 'panel' ? 2 : 0;
  const polygon = kind === 'panel' && opening.points?.map(([u, v]) => [fx(u), fy(v)]);
  function inside(x, y) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [a, b] = polygon[i], [c, d] = polygon[j];
      if ((b > y) !== (d > y) && x < a + (c - a) * (y - b) / (d - b)) hit = !hit;
    }
    return hit;
  }
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
      const index = 4 * ((tile.y + py) * stride + tile.x + px);
      if (kind === 'panel') {
        const amount = polygon ? (Number(inside(px + 0.25, py + 0.25)) + Number(inside(px + 0.75, py + 0.25))
          + Number(inside(px + 0.25, py + 0.75)) + Number(inside(px + 0.75, py + 0.75))) / 4 : outer;
        data[index + 2] = Math.max(data[index + 2], Math.round(amount * 255));
        continue;
      }
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
      data[index + channel] = Math.max(data[index + channel], Math.round(inner * 255));
      data[index + 2] = Math.max(data[index + 2], Math.round((outer - inner) * 255));
      data[index + 3] = Math.max(data[index + 3], Math.round(ledge * 255));
    }
  }
}

function pack(walls, density, measuredMinimum = 12) {
  const tiles = walls.map((wall) => {
    const metres = wallWidth(wall);
    const target = wall.status === 'inferred' ? density * 0.55 : Math.max(density, measuredMinimum);
    // The reviewed rail walls are often visible at walking distance from platforms and paths.
    const corridor = isCorridorFacade(wall);
    const railDetail = wall.rail && wall.status === 'observed';
    const scale = corridor ? Math.min(measuredMinimum * (railDetail ? 0.5 : 0.25), target) : target;
    return { wall, metres, width: clamp(Math.ceil(metres * scale), 2, railDetail ? 256 : corridor ? 192 : 512),
      height: clamp(Math.ceil(wall.height * scale), 2, railDetail ? 96 : corridor ? 56 : 512) };
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

export function mipBytes(width, height) {
  let bytes = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    bytes += w * h * 4;
    if (w === 1 && h === 1) return bytes;
  }
}

function buildPalette(walls, indices) {
  // Several walls share the same surface, frame, sill and entry finishes.
  const values = [], rows = new Map(), styles = new Map();
  for (const wall of walls) {
    const samples = Object.entries(COLOR_SLOTS).map(([name, fallback]) => {
      const value = wall[name] ?? wall.openings.find(opening => opening[name])?.[name];
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : fallback;
    });
    const surface = (SURFACE_CODES[wall.wallMaterial ?? wall.masonry] ?? 1) + (isCorridorFacade(wall) ? 16 : 0);
    const key = `${samples.join('/')}/${surface}`;
    if (!styles.has(key)) {
      styles.set(key, values.length / 16);
      for (const hex of samples) {
        const channels = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
        const linear = channels.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        values.push(...linear.map(c => Math.round(c * 255)), surface);
      }
    }
    rows.set(indices.get(wall), styles.get(key));
  }
  const height = styles.size;
  for (const [wall, row] of rows) rows.set(wall, (row + 0.5) / height);
  const data = new Uint8Array(values);
  return { paletteData: data, paletteHeight: height, rows };
}

function* bakeFacadeMaskAtlas(walls) {
  const indices = new Map(walls.map((wall, index) => [wall, index]));
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
    const measured = detailed.filter(wall => wall.status === 'observed');
    // Reduce mask resolution before dropping measured openings from a crowded tile.
    const measuredMinimum = [12, 8, 6, 4].find(density => pack(measured, 3, density)) ?? 4;
    let low = 0, high = detailed.length;
    while (low < high) {
      const count = Math.ceil((low + high) / 2);
      if (pack(detailed.slice(0, count), 3, measuredMinimum)) low = count;
      else high = count - 1;
    }
    atlas = pack(detailed.slice(0, low), 3, measuredMinimum);
  }
  const { width, height } = atlas;
  const data = new Uint8Array(width * height * 4);
  const blank = [0.5 / width, 0.5 / height, 0, 0];
  const rects = new Map(candidates.map(wall => [indices.get(wall), blank]));
  for (const tile of atlas.tiles) {
    for (const opening of tile.wall.openings) {
      if (!['window', 'door', 'storefront', 'panel'].includes(opening.kind) ||
          ![opening.x, opening.y, opening.width, opening.height].every(Number.isFinite) ||
          opening.width <= 0 || opening.height <= 0) continue;
      fillOpening(data, width, tile, opening);
      yield;
    }
    rects.set(indices.get(tile.wall), [tile.x / width, tile.y / height, tile.width / width, tile.height / height]);
  }
  const physical = new Set();
  let remaining = MAX_PHYSICAL_OPENINGS;
  const measured = atlas.tiles.map(tile => tile.wall).filter(wall => wall.status === 'observed')
    .sort((a, b) => Number(Boolean(b.detail)) - Number(Boolean(a.detail)) || b.confidence - a.confidence);
  for (const wall of measured) {
    if (remaining < Math.min(32, wall.openings.length)) break;
    remaining -= Math.min(32, wall.openings.length);
    physical.add(indices.get(wall));
  }
  const palette = buildPalette(candidates, indices);
  return { ...palette, data, width, height,
    rects, physical, motorway: candidates.some(isCorridorFacade),
    metal: candidates.some(wall => (SURFACE_CODES[wall.wallMaterial ?? wall.masonry] ?? 0) >= 4),
    byteLength: mipBytes(width, height) + palette.paletteData.byteLength };
}

export { bakeFacadeMaskAtlas };
