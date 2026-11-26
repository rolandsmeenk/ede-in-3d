import * as THREE from 'three/webgpu';

const PAGE_SIZE = 2048;
const GUTTER = 16;
const WHITE = '#fff';
const RED = '#c81921';
const BLUE = '#003DA5';
const GREEN = '#006B3F';
const YELLOW = '#ffd334';
const INK = '#171717';
const SIGN_FONT = '"DIN Alternate", "DIN 2014", "Arial Narrow", Arial, sans-serif';

const RVV_SIZES = {
  J02: [128, 112, 0.85], J03: [128, 112, 0.85], J04: [128, 112, 0.85], J05: [128, 112, 0.85],
  BB01: [176, 64, 1.45], BB02: [176, 64, 1.45], BB14: [64, 92, 0.3], BB15: [176, 72, 1.45],
  BB07: [72, 168, 0.28], BB08: [72, 168, 0.28], BB09: [72, 168, 0.28], BB10: [160, 100, 1.35],
  L08: [112, 112, 0.6], L09: [112, 112, 0.6],
};

function signText(ctx, label, x, y, size, maxWidth, color = WHITE, align = 'center') {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${size}px ${SIGN_FONT}`;
  ctx.fillText(label, x, y, maxWidth);
}

function polygon(ctx, color, points) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fill();
}

function plate(ctx, width, height, fill, border = 4) {
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = border;
  ctx.beginPath();
  ctx.roundRect(border * 1.5, border * 1.5, width - 3 * border, height - 3 * border, border * 1.5);
  ctx.stroke();
}

function shield(ctx, label, x, y, w, h) {
  const provincial = label.startsWith('N');
  ctx.fillStyle = provincial ? YELLOW : RED;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h * 0.16);
  ctx.fill();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2;
  ctx.stroke();
  signText(ctx, label, x + w / 2, y + h * 0.54, Math.floor(h * 0.73), Math.max(1, w - 8), provincial ? INK : WHITE);
}

function paintHecto(ctx, { road, value, ramp, side, roadLetter, badge, pixelWidth, pixelHeight }) {
  const top = badge ? 60 : 0;
  ctx.save();
  ctx.translate(0, top);
  plate(ctx, pixelWidth, pixelHeight - top, GREEN);
  if (road) shield(ctx, road, 17, 16, 70, 34);
  if (side) signText(ctx, side, roadLetter || ramp ? 111 : 142, 34, 25, 44);
  if (roadLetter && roadLetter !== ramp) signText(ctx, roadLetter, ramp ? 136 : 167, 34, 19, 21);
  if (ramp) {
    polygon(ctx, YELLOW, [[142, 8], [182, 8], [182, 60]]);
    signText(ctx, ramp, 172, 21, 20, 18, INK);
  }
  signText(ctx, value, 96, 86, 58, 158);
  ctx.restore();

  if (badge) {
    ctx.fillStyle = WHITE;
    ctx.fillRect(59, 42, 74, 18);
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(96, 28, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(96, 28, 21, 0, Math.PI * 2);
    ctx.fill();
    signText(ctx, '100', 96, 29, 22, 39, INK);
    signText(ctx, '6-19h', 96, 52, 13, 67, INK);
  }
}

function paintCurve(ctx, code) {
  polygon(ctx, RED, [[64, 2], [126, 110], [2, 110]]);
  polygon(ctx, WHITE, [[64, 22], [111, 101], [17, 101]]);
  const left = code === 'J03' || code === 'J05';
  const double = code === 'J04' || code === 'J05';
  ctx.save();
  if (left) {
    ctx.translate(128, 0);
    ctx.scale(-1, 1);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(double ? 52 : 48, 91);
  if (double) {
    ctx.bezierCurveTo(74, 78, 77, 68, 65, 62);
    ctx.quadraticCurveTo(55, 55, 59, 43);
  } else {
    ctx.bezierCurveTo(47, 67, 59, 56, 78, 55);
  }
  ctx.stroke();
  ctx.restore();
}

function arrow(ctx, x, y, length, width, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  polygon(ctx, WHITE, [
    [0, -length / 2], [width / 2, 0], [width * 0.19, 0], [width * 0.19, length / 2],
    [-width * 0.19, length / 2], [-width * 0.19, 0], [-width / 2, 0],
  ]);
  ctx.restore();
}

function paintRvv(ctx, { code, left, pixelWidth: w, pixelHeight: h }) {
  if (code.startsWith('J')) {
    paintCurve(ctx, code);
    return;
  }

  if (/^BB(?:01|02|14|15)$/.test(code)) {
    ctx.fillStyle = WHITE;
    if (code === 'BB15') {
      for (const y of [3, 40]) {
        ctx.fillStyle = WHITE;
        ctx.fillRect(0, y, w, 29);
        ctx.fillStyle = RED;
        for (let i = 0; i < 6; i += 2) ctx.fillRect((i + (left ? 1 : 0)) * w / 6, y, w / 6, 29);
      }
      return;
    }
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    if (left) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    const count = code === 'BB14' ? 1 : code === 'BB02' ? 3 : 2;
    const step = (w - 12) / count;
    for (let i = 0; i < count; i++) {
      const x = 6 + i * step;
      polygon(ctx, RED, [
        [x, 7], [x + step * 0.48, 7], [x + step * 0.96, h / 2],
        [x + step * 0.48, h - 7], [x, h - 7], [x + step * 0.48, h / 2],
      ]);
    }
    ctx.restore();
    return;
  }

  plate(ctx, w, h, BLUE, 3);
  if (/^BB0[789]$/.test(code)) {
    const count = 10 - Number(code.at(-1));
    for (let i = 0; i < count; i++) {
      const y = (i - (count - 1) / 2) * 40 + h / 2;
      const tilt = left ? -23 : 23;
      polygon(ctx, WHITE, [[7, y + tilt / 2 - 9], [w - 7, y - tilt / 2 - 9],
        [w - 7, y - tilt / 2 + 9], [7, y + tilt / 2 + 9]]);
    }
  } else if (code === 'BB10') {
    signText(ctx, 'UIT', 56, 51, 46, 85);
    arrow(ctx, 120, 49, 54, 39, Math.PI / 4);
  } else {
    ctx.fillStyle = WHITE;
    if (code === 'L09') {
      ctx.fillRect(48, 68, 16, 32);
      ctx.fillRect(22, 60, 68, 13);
      ctx.fillRect(left ? 24 : 73, 39, 15, 23);
    } else {
      ctx.fillRect(46, 35, 20, 60);
    }
    ctx.fillStyle = RED;
    ctx.fillRect(code === 'L09' ? (left ? 16 : 65) : 29, 26, code === 'L09' ? 31 : 54, 16);
  }
}

function paintExit(ctx, { exit, destinations, shields, gantry, laneCount, pixelWidth: w, pixelHeight: h }) {
  plate(ctx, w, h, BLUE, 6);
  if (exit) {
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.roundRect(w - 138, 21, 112, 52, 7);
    ctx.fill();
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w - 122, 59);
    ctx.lineTo(w - 108, 33);
    ctx.moveTo(w - 117, 51);
    ctx.lineTo(w - 98, 40);
    ctx.stroke();
    polygon(ctx, BLUE, [[w - 96, 37], [w - 107, 38], [w - 99, 47]]);
    signText(ctx, exit, w - 65, 48, 34, 60, BLUE);
  }

  const shieldSlot = Math.min(83, (w - (exit ? 166 : 46)) / Math.max(shields.length, 1));
  const shieldWidth = shieldSlot - Math.min(7, shieldSlot * 0.2);
  shields.forEach((road, index) => shield(ctx, road, 25 + shieldSlot * index, 27, shieldWidth, 40));

  const spacing = (h - 92 - (gantry ? 61 : 12)) / Math.max(destinations.length, 1);
  const maxText = w - (gantry ? 52 : 120);
  destinations.forEach((destination, i) => {
    signText(ctx, destination, 26, 92 + (i + 0.5) * spacing, Math.min(44, spacing * 0.85), maxText, WHITE, 'left');
  });
  if (gantry) {
    for (let lane = 1; lane <= laneCount; lane++) {
      arrow(ctx, w * lane / (laneCount + 1), h - 38, 48, 42, Math.PI);
    }
  } else {
    arrow(ctx, w - 61, h - 54, 55, 48, Math.PI / 4);
  }
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function describeFace(feature) {
  const { type } = feature;
  if (type === 'hecto') {
    const road = text(feature.wegnummer).toUpperCase();
    const value = text(feature.hectometer).replace('.', ',');
    const ramp = /^[a-z]$/i.test(text(feature.weglet)) ? text(feature.weglet).toLowerCase() : '';
    const roadLetter = text(feature.hecto_lttr).replace('#', '').toLowerCase();
    const sideValue = text(feature.pos_tv_wol).toUpperCase();
    const side = /^L(I)?$/.test(sideValue) ? 'Li' : /^R(E)?$/.test(sideValue) ? 'Re' : '';
    const badge = Boolean(feature.daytimeBadge);
    return {
      key: JSON.stringify([type, road, value, ramp, side, roadLetter, badge]),
      road, value, ramp, side, roadLetter, badge, pixelWidth: 192, pixelHeight: badge ? 188 : 128,
      width: 0.34, paint: paintHecto,
    };
  }

  if (type === 'rvv') {
    const rawCode = text(feature.rvvCode).toUpperCase().replace(/^([JL])(\d)(?!\d)/, (_, prefix, digit) => prefix + '0' + digit);
    const code = /^([A-Z]+\d{2})/.exec(rawCode)?.[1];
    if (!Object.hasOwn(RVV_SIZES, code)) return;
    const [pixelWidth, pixelHeight, width] = RVV_SIZES[code];
    const left = /(?:L|LI|LEFT|LINKS)$/.test(text(feature.direction).toUpperCase() || rawCode);
    return { key: JSON.stringify([type, code, left]), code, left, pixelWidth, pixelHeight, width, paint: paintRvv };
  }

  if (type === 'exit') {
    const exit = text(feature.exitNumber);
    const destinations = (feature.destinations || []).map(text).filter(Boolean);
    const shields = (feature.roadShields || []).map(text).filter(Boolean).map(road => road.toUpperCase());
    const gantry = Boolean(feature.isOverheadGantry);
    const laneCount = gantry ? Math.min(6, Math.max(1, Math.trunc(feature.laneCount) || 2)) : 0;
    const longest = Math.max(0, ...destinations.map(destination => destination.length));
    const pixelWidth = Math.min(768, Math.max(352, longest * 24 + (gantry ? 58 : 125), (exit ? 166 : 46) + shields.length * 83));
    const pixelHeight = Math.min(704, Math.max(210, 92 + destinations.length * 52 + (gantry ? 69 : 22)));
    return {
      key: JSON.stringify([type, exit, destinations, shields, gantry, laneCount]),
      exit, destinations, shields, gantry, laneCount, pixelWidth, pixelHeight,
      width: pixelWidth / (gantry ? 90 : 120), paint: paintExit,
    };
  }
}

function padFaces(ctx, canvas, tiles) {
  // Copy gutters in one readback. Self-blitting the atlas for each edge can stall WebKit's canvas process.
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, width * height);
  for (const { tile: { pixelWidth: w, pixelHeight: h }, x, y } of tiles) {
    for (let row = y; row < y + h; row++) {
      const start = row * width + x;
      const end = start + w;
      pixels.fill(pixels[start], start - GUTTER, start);
      pixels.fill(pixels[end - 1], end, end + GUTTER);
    }
    const top = y * width + x - GUTTER;
    const bottom = (y + h - 1) * width + x - GUTTER;
    const rowWidth = w + 2 * GUTTER;
    for (let gap = 1; gap <= GUTTER; gap++) {
      pixels.copyWithin(top - gap * width, top, top + rowWidth);
      pixels.copyWithin(bottom + gap * width, bottom, bottom + rowWidth);
    }
  }
  ctx.putImageData(image, 0, 0);
}

function paintPage(tiles, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = 2 ** Math.ceil(Math.log2(width));
  canvas.height = 2 ** Math.ceil(Math.log2(height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  for (const { tile, x, y } of tiles) {
    const { pixelWidth: w, pixelHeight: h } = tile;
    ctx.save();
    ctx.translate(x, y);
    tile.paint(ctx, tile);
    ctx.restore();
    tile.face = {
      texture,
      uv: [(x + 0.5) / canvas.width, 1 - (y + h - 0.5) / canvas.height,
        (w - 1) / canvas.width, (h - 1) / canvas.height],
      width: tile.width,
      height: tile.width * h / w,
    };
  }
  padFaces(ctx, canvas, tiles);
  return texture;
}

export function createRoadFurnitureAtlases(features) {
  const unique = new Map();
  const faceTiles = new Map();
  for (const feature of features) {
    const tile = describeFace(feature);
    if (!tile) continue;
    if (!unique.has(tile.key)) unique.set(tile.key, tile);
    faceTiles.set(feature.id, unique.get(tile.key));
  }

  const ordered = [...unique.values()].sort((a, b) =>
    b.pixelHeight - a.pixelHeight || b.pixelWidth - a.pixelWidth || (a.key < b.key ? -1 : 1));
  const textures = [];
  let tiles = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const tile of ordered) {
    const w = tile.pixelWidth + 2 * GUTTER;
    const h = tile.pixelHeight + 2 * GUTTER;
    if (x + w > PAGE_SIZE) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    if (y + h > PAGE_SIZE) {
      textures.push(paintPage(tiles, width, y));
      tiles = [];
      y = 0;
      width = 0;
    }
    tiles.push({ tile, x: x + GUTTER, y: y + GUTTER });
    x += w;
    width = Math.max(width, x);
    rowHeight = Math.max(rowHeight, h);
  }
  if (tiles.length) textures.push(paintPage(tiles, width, y + rowHeight));
  return { faces: new Map([...faceTiles].map(([id, tile]) => [id, tile.face])), textures };
}
