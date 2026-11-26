import * as THREE from 'three/webgpu';

// Power-of-two atlas dimensions for clean mipmapping on WebGPU.
export const MSI_ATLAS_SIZE = 1024;
export const MSI_ATLAS_COLS = 4;
export const MSI_ATLAS_ROWS = 4;
export const MSI_CELL_PX = MSI_ATLAS_SIZE / MSI_ATLAS_COLS; // 256

export const VRI_ATLAS_WIDTH = 1024;
export const VRI_ATLAS_HEIGHT = 512;
export const VRI_ATLAS_COLS = 8;
export const VRI_ATLAS_ROWS = 4;
export const VRI_CELL_PX = VRI_ATLAS_WIDTH / VRI_ATLAS_COLS; // 128

export const MSI_LEGEND_CODES = Object.freeze([
  'BLANK',
  'A01-50',
  'A01-70',
  'A01-80',
  'A01-90',
  'A01-100',
  'F01',
  'F02-L',
  'F02-R',
  'F08',
  'J33',
]);

export const MSI_DEFAULT_FLASHER_MASK = Object.freeze({
  BLANK: 0,
  'A01-50': 0,
  'A01-70': 0,
  'A01-80': 0,
  'A01-90': 0,
  'A01-100': 0,
  F01: 1,
  'F02-L': 1,
  'F02-R': 1,
  F08: 0,
  J33: 1,
});

export const MSI_SPEED_LIMIT_KMH = Object.freeze({
  'A01-50': 50,
  'A01-70': 70,
  'A01-80': 80,
  'A01-90': 90,
  'A01-100': 100,
});

function buildUvRects(codes, cols, rows) {
  const du = 1 / cols;
  const dv = 1 / rows;
  const map = {};
  for (let i = 0; i < codes.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // CanvasTexture uses flipY = true, so canvas row 0 is at UV v = 1 - dv.
    const u = col * du;
    const v = 1 - (row + 1) * dv;
    map[codes[i]] = Object.freeze([u, v, du, dv]);
  }
  return Object.freeze(map);
}

export const MSI_UV_RECTS = buildUvRects(MSI_LEGEND_CODES, MSI_ATLAS_COLS, MSI_ATLAS_ROWS);

export const VRI_ASPECT_CODES = Object.freeze([
  'DARK',
  'RED',
  'AMBER',
  'GREEN',
  'RED_LEFT',
  'AMBER_LEFT',
  'GREEN_LEFT',
  'RED_STRAIGHT',
  'AMBER_STRAIGHT',
  'GREEN_STRAIGHT',
  'RED_RIGHT',
  'AMBER_RIGHT',
  'GREEN_RIGHT',
  'CYCLIST_RED',
  'CYCLIST_AMBER',
  'CYCLIST_GREEN',
  'PED_RED',
  'PED_GREEN',
]);

export const VRI_UV_RECTS = buildUvRects(VRI_ASPECT_CODES, VRI_ATLAS_COLS, VRI_ATLAS_ROWS);

const MSI_CODE_SET = new Set(MSI_LEGEND_CODES);

/**
 * Parse raw NDW / RVV matrix sign legend code into canonical code, atlas UV rect,
 * flasher mask, and traffic semantics.
 */
export function parseMsiLegendCode(rawCode, directionHint = '') {
  let code = 'BLANK';
  if (rawCode != null) {
    const norm = String(rawCode).trim().toUpperCase().replace(/[_\s]+/g, '-');
    if (MSI_CODE_SET.has(norm)) {
      code = norm;
    } else if (/^(50|70|80|90|100)$/.test(norm)) {
      code = `A01-${norm}`;
    } else if (/^A0?1-(50|70|80|90|100)$/.test(norm)) {
      code = `A01-${norm.split('-')[1]}`;
    } else if (norm === 'F1' || norm === 'X' || norm === 'CROSS' || norm === 'RED-CROSS' || norm === 'LANE-CLOSED') {
      code = 'F01';
    } else if (norm === 'F02' || norm === 'F2' || norm.startsWith('F02-') || norm === 'MERGE' || norm === 'ARROW-LEFT' || norm === 'ARROW-RIGHT') {
      const hint = `${norm} ${String(directionHint ?? '').toUpperCase()}`;
      code = hint.includes('LEFT') || hint.includes('-L') ? 'F02-L' : 'F02-R';
    } else if (norm === 'F8' || norm === 'END-RESTRICTIONS' || norm === 'ALL-CLEAR') {
      code = 'F08';
    } else if (norm === 'J33' || norm === 'QUEUE' || norm === 'CONGESTION' || norm === 'FILE' || norm === 'TRAFFIC-JAM') {
      code = 'J33';
    }
  }
  const uvRect = MSI_UV_RECTS[code];
  const flasherMask = MSI_DEFAULT_FLASHER_MASK[code] ?? 0;
  const speedLimitKmh = MSI_SPEED_LIMIT_KMH[code] ?? null;
  const laneClosed = code === 'F01';
  const mergeDirection = code === 'F02-L' ? 'left' : code === 'F02-R' ? 'right' : null;
  return { code, uvRect, flasherMask, speedLimitKmh, laneClosed, mergeDirection };
}

function makeCanvas(width, height, canvasFactory) {
  if (typeof canvasFactory === 'function') return canvasFactory(width, height);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  return null;
}

function paintMsiHousingBackground(ctx, size) {
  ctx.fillStyle = '#0A0C0E';
  ctx.fillRect(0, 0, size, size);

  // Subtle unlit LED matrix grid for physical depth.
  const grid = 32;
  const step = size / grid;
  ctx.fillStyle = '#12161A';
  for (let gx = 0; gx < grid; gx++) {
    for (let gy = 0; gy < grid; gy++) {
      ctx.beginPath();
      ctx.arc((gx + 0.5) * step, (gy + 0.5) * step, step * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Top-left and top-right unlit amber flasher lens bezels.
  for (const fx of [size * 0.16, size * 0.84]) {
    ctx.fillStyle = '#1B1914';
    ctx.beginPath();
    ctx.arc(fx, size * 0.14, size * 0.068, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#25292E';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function dotMaskPass(ctx, size, paintSymbol) {
  // Rasterize crisp vector legend on an offscreen scratch canvas, then sample into circular LED dots.
  const scratch = makeCanvas(size, size);
  if (!scratch) {
    paintSymbol(ctx, size);
    return;
  }
  const sctx = scratch.getContext('2d');
  sctx.clearRect(0, 0, size, size);
  paintSymbol(sctx, size);
  const img = sctx.getImageData(0, 0, size, size).data;

  const grid = 32;
  const step = size / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const px = Math.min(size - 1, Math.floor((gx + 0.5) * step));
      const py = Math.min(size - 1, Math.floor((gy + 0.5) * step));
      const idx = (py * size + px) * 4;
      const a = img[idx + 3];
      if (a < 40) continue;
      const r = img[idx], g = img[idx + 1], b = img[idx + 2];
      const cx = (gx + 0.5) * step;
      const cy = (gy + 0.5) * step;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(cx, cy, step * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintMsiCell(ctx, code, size) {
  paintMsiHousingBackground(ctx, size);
  if (code === 'BLANK') return;

  const cx = size * 0.5;
  const cy = size * 0.54;
  dotMaskPass(ctx, size, (sctx, s) => {
    if (code.startsWith('A01-')) {
      const speed = code.split('-')[1];
      // Crisp red LED ring.
      sctx.strokeStyle = '#FF2222';
      sctx.lineWidth = s * 0.085;
      sctx.beginPath();
      sctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
      sctx.stroke();

      // High-contrast white LED digits.
      sctx.fillStyle = '#FFFFFF';
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      const fontSize = speed.length >= 3 ? Math.round(s * 0.25) : Math.round(s * 0.32);
      sctx.font = `900 ${fontSize}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
      sctx.fillText(speed, cx, cy + s * 0.015);
    } else if (code === 'F01') {
      // Red cross (X).
      sctx.strokeStyle = '#FF1F1F';
      sctx.lineWidth = s * 0.11;
      sctx.lineCap = 'square';
      const r = s * 0.28;
      sctx.beginPath();
      sctx.moveTo(cx - r, cy - r);
      sctx.lineTo(cx + r, cy + r);
      sctx.moveTo(cx + r, cy - r);
      sctx.lineTo(cx - r, cy + r);
      sctx.stroke();
    } else if (code === 'F02-L' || code === 'F02-R') {
      // Diagonal amber-white merge arrow.
      const dir = code === 'F02-R' ? 1 : -1;
      sctx.save();
      sctx.translate(cx, cy);
      sctx.rotate(dir * -Math.PI * 0.25);
      sctx.fillStyle = '#FFE8B0';
      const w = s * 0.095;
      const h = s * 0.32;
      // Shaft + downward-diagonal arrowhead.
      sctx.beginPath();
      sctx.moveTo(-w * 0.55, -h);
      sctx.lineTo(w * 0.55, -h);
      sctx.lineTo(w * 0.55, h * 0.12);
      sctx.lineTo(w * 1.8, h * 0.12);
      sctx.lineTo(0, h);
      sctx.lineTo(-w * 1.8, h * 0.12);
      sctx.lineTo(-w * 0.55, h * 0.12);
      sctx.closePath();
      sctx.fill();
      sctx.restore();
    } else if (code === 'F08') {
      // White end-of-all-restrictions circle with diagonal slash.
      sctx.strokeStyle = '#F5F7FA';
      sctx.lineWidth = s * 0.075;
      sctx.beginPath();
      sctx.arc(cx, cy, s * 0.31, 0, Math.PI * 2);
      sctx.stroke();
      sctx.beginPath();
      sctx.moveTo(cx - s * 0.22, cy + s * 0.22);
      sctx.lineTo(cx + s * 0.22, cy - s * 0.22);
      sctx.stroke();
    } else if (code === 'J33') {
      // Red warning triangle with white queue silhouettes.
      sctx.strokeStyle = '#FF2222';
      sctx.lineWidth = s * 0.075;
      sctx.lineJoin = 'round';
      sctx.beginPath();
      sctx.moveTo(cx, cy - s * 0.31);
      sctx.lineTo(cx + s * 0.33, cy + s * 0.26);
      sctx.lineTo(cx - s * 0.33, cy + s * 0.26);
      sctx.closePath();
      sctx.stroke();

      // Queue bars inside triangle.
      sctx.fillStyle = '#FFFFFF';
      for (const [dx, dy, bw] of [[-0.08, 0.12, 0.09], [0.06, 0.12, 0.09], [0.0, 0.0, 0.11]]) {
        sctx.fillRect(cx + dx * s - bw * s * 0.5, cy + dy * s, bw * s, s * 0.06);
      }
    }
  });
}

function paintVriCell(ctx, code, size) {
  ctx.fillStyle = '#0D0F12';
  ctx.fillRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.5;
  const r = size * 0.42;

  // Dark unlit lens base.
  ctx.fillStyle = '#141618';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  if (code === 'DARK') {
    ctx.strokeStyle = '#202429';
    ctx.lineWidth = 3;
    ctx.stroke();
    return;
  }

  const isRed = code.includes('RED');
  const isAmber = code.includes('AMBER');
  const coreHex = isRed ? '#FF2A24' : isAmber ? '#FFAA14' : '#18FF6C';
  const rimHex = isRed ? '#B01210' : isAmber ? '#B36B00' : '#0AA046';

  const grad = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
  grad.addColorStop(0, '#FFFFFF');
  grad.addColorStop(0.28, coreHex);
  grad.addColorStop(0.82, rimHex);
  grad.addColorStop(1, '#141618');

  const isArrow = code.endsWith('_LEFT') || code.endsWith('_STRAIGHT') || code.endsWith('_RIGHT');
  const isCyclist = code.startsWith('CYCLIST_');
  const isPed = code.startsWith('PED_');

  if (!isArrow && !isCyclist && !isPed) {
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.save();
  ctx.fillStyle = grad;
  ctx.strokeStyle = coreHex;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (isArrow) {
    ctx.translate(cx, cy);
    if (code.endsWith('_LEFT')) ctx.rotate(-Math.PI / 2);
    else if (code.endsWith('_RIGHT')) ctx.rotate(Math.PI / 2);
    const w = r * 0.28;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.72);
    ctx.lineTo(r * 0.56, -r * 0.1);
    ctx.lineTo(w, -r * 0.1);
    ctx.lineTo(w, r * 0.68);
    ctx.lineTo(-w, r * 0.68);
    ctx.lineTo(-w, -r * 0.1);
    ctx.lineTo(-r * 0.56, -r * 0.1);
    ctx.closePath();
    ctx.fill();
  } else if (isCyclist) {
    // Stylized Dutch fiets pictogram.
    ctx.lineWidth = size * 0.055;
    const wr = r * 0.28;
    ctx.beginPath();
    ctx.arc(cx - r * 0.36, cy + r * 0.22, wr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.36, cy + r * 0.22, wr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.36, cy + r * 0.22);
    ctx.lineTo(cx - r * 0.04, cy - r * 0.18);
    ctx.lineTo(cx + r * 0.28, cy - r * 0.18);
    ctx.lineTo(cx + r * 0.36, cy + r * 0.22);
    ctx.moveTo(cx - r * 0.04, cy - r * 0.18);
    ctx.lineTo(cx + r * 0.02, cy + r * 0.22);
    ctx.stroke();
  } else if (isPed) {
    // Stylized Dutch voetganger pictogram (standing red vs walking green).
    ctx.fillStyle = coreHex;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.44, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = size * 0.075;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.26);
    ctx.lineTo(cx, cy + r * 0.12);
    if (code === 'PED_GREEN') {
      ctx.moveTo(cx - r * 0.26, cy - r * 0.06);
      ctx.lineTo(cx, cy - r * 0.18);
      ctx.lineTo(cx + r * 0.28, cy + r * 0.02);
      ctx.moveTo(cx, cy + r * 0.12);
      ctx.lineTo(cx - r * 0.24, cy + r * 0.56);
      ctx.moveTo(cx, cy + r * 0.12);
      ctx.lineTo(cx + r * 0.28, cy + r * 0.52);
    } else {
      ctx.moveTo(cx - r * 0.2, cy + r * 0.08);
      ctx.lineTo(cx, cy - r * 0.18);
      ctx.lineTo(cx + r * 0.2, cy + r * 0.08);
      ctx.moveTo(cx - r * 0.1, cy + r * 0.12);
      ctx.lineTo(cx - r * 0.1, cy + r * 0.58);
      ctx.moveTo(cx + r * 0.1, cy + r * 0.12);
      ctx.lineTo(cx + r * 0.1, cy + r * 0.58);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function configureAtlasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function createMsiSignalAtlas({ canvasFactory } = {}) {
  const canvas = makeCanvas(MSI_ATLAS_SIZE, MSI_ATLAS_SIZE, canvasFactory);
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0A0C0E';
    ctx.fillRect(0, 0, MSI_ATLAS_SIZE, MSI_ATLAS_SIZE);
    for (let i = 0; i < MSI_LEGEND_CODES.length; i++) {
      const code = MSI_LEGEND_CODES[i];
      const col = i % MSI_ATLAS_COLS;
      const row = Math.floor(i / MSI_ATLAS_COLS);
      ctx.save();
      ctx.translate(col * MSI_CELL_PX, row * MSI_CELL_PX);
      paintMsiCell(ctx, code, MSI_CELL_PX);
      ctx.restore();
    }
  }
  const texture = canvas ? configureAtlasTexture(canvas) : null;
  return {
    texture,
    uvRects: MSI_UV_RECTS,
    flasherMasks: MSI_DEFAULT_FLASHER_MASK,
    width: MSI_ATLAS_SIZE,
    height: MSI_ATLAS_SIZE,
    dispose() {
      texture?.dispose();
    },
  };
}

export function createVriSignalAtlas({ canvasFactory } = {}) {
  const canvas = makeCanvas(VRI_ATLAS_WIDTH, VRI_ATLAS_HEIGHT, canvasFactory);
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0D0F12';
    ctx.fillRect(0, 0, VRI_ATLAS_WIDTH, VRI_ATLAS_HEIGHT);
    for (let i = 0; i < VRI_ASPECT_CODES.length; i++) {
      const code = VRI_ASPECT_CODES[i];
      const col = i % VRI_ATLAS_COLS;
      const row = Math.floor(i / VRI_ATLAS_COLS);
      ctx.save();
      ctx.translate(col * VRI_CELL_PX, row * VRI_CELL_PX);
      paintVriCell(ctx, code, VRI_CELL_PX);
      ctx.restore();
    }
  }
  const texture = canvas ? configureAtlasTexture(canvas) : null;
  return {
    texture,
    uvRects: VRI_UV_RECTS,
    width: VRI_ATLAS_WIDTH,
    height: VRI_ATLAS_HEIGHT,
    dispose() {
      texture?.dispose();
    },
  };
}
