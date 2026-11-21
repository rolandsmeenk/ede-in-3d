import { surveyLabel, surveyWindow } from './ede-survey-landmark.js';

const brick = 0x89594b;
const plaster = 0xd4d3c7;
const timber = 0x272b2c;
const stone = 0xb9ad92;
const sash = 0xd5d7d0;
const glass = 0x45565c;

const rectangle = (u, y, w, h) => [[u, y], [u + w, y], [u + w, y + h], [u, y + h]];
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

// The street elevations are split at roof seams in the survey. Draw in a common
// elevation and clip each detail to its original wall polygon.
function elevation(wall, start = 0, scale = 1) {
  const { a, base, normal, point, rings, trim } = wall;
  const boundary = rings[0].map(([x, y, z]) => [
    start + scale * ((x - a.x) * normal.z - (z - a.z) * normal.x), y - base,
  ]);
  const at = (u, y, depth = 0.058) => point((u - start) / scale, base + y, depth);
  function patch(shape, color, depth = 0.058, sheen = 0) {
    for (let index = 0; index < boundary.length && shape.length; index++) {
      const a = boundary[index], b = boundary[(index + 1) % boundary.length];
      const outside = shape;
      shape = [];
      for (let j = 0; j < outside.length; j++) {
        const p = outside[j], q = outside[(j + 1) % outside.length];
        const dp = cross(a, b, p), dq = cross(a, b, q);
        if (dp >= -0.0001) shape.push(p);
        if ((dp < -0.0001) !== (dq < -0.0001)) {
          const t = dp / (dp - dq);
          shape.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
    }
    if (shape.length < 3) return;
    const vertices = shape.map(([u, y]) => at(u, y, depth));
    for (let index = 1; index + 1 < vertices.length; index++) {
      trim.triangle(vertices[0], vertices[index], vertices[index + 1], color, sheen);
    }
  }
  return { patch, at, trim, rect: (u, y, w, h, ...style) => patch(rectangle(u, y, w, h), ...style) };
}

function stroke(face, u, y, v, top, width, color, depth) {
  const length = Math.hypot(v - u, top - y);
  const du = (top - y) * width / (2 * length), dy = (u - v) * width / (2 * length);
  face.patch([[u + du, y + dy], [v + du, top + dy], [v - du, top - dy], [u - du, y - dy]], color, depth);
}

function gridWindow(face, u, y, w, h, columns, { stained = false, frame = sash, rows = 1, transom = true } = {}) {
  face.rect(u - 0.035, y - 0.065, w + 0.07, 0.11, stone, 0.13);
  face.rect(u, y, w, h, timber, 0.068);
  face.rect(u + 0.055, y + 0.05, w - 0.11, h - 0.10, frame, 0.077);
  const cell = (w - 0.12) / columns;
  const fanHeight = transom ? h * 0.31 : 0;
  for (let j = 0; j < columns; j++) {
    const x = u + 0.07 + j * cell;
    for (let row = 0; row < rows; row++) {
      const step = (h - fanHeight - 0.14) / rows;
      face.rect(x, y + 0.075 + row * step, cell - 0.055, step - 0.045, glass, 0.088, 0.70);
    }
    if (!transom) continue;
    const colors = stained ? [0x859c96, 0xb0a578, 0x80999f, 0x9b8e84] : [0x64716e, 0x61706f];
    for (let pane = 0; pane < 3; pane++) for (let row = 0; row < 2; row++) {
      const pitch = (cell - 0.055) / 3;
      face.rect(x + pane * pitch, y + h - fanHeight + 0.018 + row * fanHeight * 0.41,
        pitch - 0.021, fanHeight * 0.40 - 0.019, colors[(j + pane + row * 2) % colors.length], 0.088, 0.75);
    }
  }
}

function roundHead(u, y, w, h, rise) {
  const spring = y + h - rise;
  const arc = Array.from({ length: 11 }, (_, j) => {
    const t = j * Math.PI / 10;
    return [u + w / 2 + Math.cos(t) * w / 2, spring + Math.sin(t) * rise];
  });
  return [[u, y], [u + w, y], ...arc];
}

function arch(face, u, y, w, h, { door = false, fan = false, band = stone } = {}) {
  const rise = w * 0.42;
  face.patch(roundHead(u - 0.11, y, w + 0.22, h + 0.14, rise + 0.14), band);
  face.patch(roundHead(u, y + 0.03, w, h, rise), timber, 0.071);
  face.patch(roundHead(u + 0.13, y + 0.11, w - 0.26, h - 0.16, rise - 0.12), sash, 0.081);
  face.patch(roundHead(u + 0.195, y + 0.16, w - 0.39, h - 0.23, rise - 0.17), glass, 0.092, 0.72);
  const spring = y + h - rise - 0.07;
  face.rect(u + 0.15, spring - 0.05, w - 0.30, 0.07, sash, 0.106);
  if (fan) {
    for (const angle of [Math.PI / 4, Math.PI / 2, Math.PI * 0.75]) {
      stroke(face, u + w / 2, spring, u + w / 2 + Math.cos(angle) * (w / 2 - 0.18),
        spring + Math.sin(angle) * (rise - 0.10), 0.055, sash, 0.105);
    }
  }
  if (door) {
    const middle = u + w / 2;
    face.rect(middle - 0.47, y, 0.94, spring - y, sash, 0.104);
    face.rect(middle - 0.41, y + 0.09, 0.82, spring - y - 0.17, 0x343d37, 0.116);
    face.rect(middle - 0.27, y + 0.84, 0.54, 0.62, glass, 0.123, 0.72);
  } else {
    face.rect(u + w / 2 - 0.038, y + 0.16, 0.076, spring - y - 0.12, sash, 0.103);
  }
}

function plasterBand(face, u, end, y, top, posts) {
  face.rect(u, y, end - u, top - y, plaster, 0.047);
  for (const h of [y, y + 0.92, top - 0.12]) face.rect(u, h, end - u, 0.13, timber, 0.064);
  for (const x of posts) face.rect(x, y, 0.16, top - y, timber, 0.063);
}

function balcony(face, u, v, level, depth, white = sash) {
  const { at, trim } = face;
  trim.quad(at(u, level, 0.04), at(u, level, depth), at(v, level, depth), at(v, level, 0.04), stone);
  face.rect(u, level - 0.19, v - u, 0.19, stone, depth);
  face.rect(u, level + 0.73, v - u, 0.12, white, depth);
  const count = Math.max(2, Math.round((v - u) / 0.29));
  for (let i = 0; i <= count; i++) {
    face.rect(u + i * (v - u) / count - 0.035, level, 0.07, 0.8, white, depth);
  }
  for (const x of [u, v]) {
    const a = at(x, level + 0.74, 0.04), b = at(x, level + 0.74, depth);
    const c = at(x, level + 0.84, depth), d = at(x, level + 0.84, 0.04);
    trim.quad(a, b, c, d, white);
    trim.quad(d, c, b, a, white);
  }
}

function plaque(wall, localCenter, y, text, width = 1.65) {
  surveyLabel(wall, localCenter - width / 2, localCenter + width / 2, wall.base + y, wall.base + y + 0.35,
    text, '#d8d6ca', '#2d3030');
}

function secondaryWindows(wall, frame = sash) {
  const { width, base, low, high } = wall;
  if (width < 1.45 || low > base + 0.1) return;
  const count = Math.max(1, Math.min(4, Math.round(width / 2.5)));
  for (const y of [1.05, 4.48]) for (let index = 0; index < count; index++) {
    const center = width * (index + 0.5) / count, half = Math.min(0.61, width * 0.34 / count);
    if (base + y + 1.39 <= high) {
      surveyWindow(wall, center - half, center + half, base + y, base + y + 1.39,
        { frame, color: glass, rows: 2, columns: width > 2 ? 2 : 1 });
    }
  }
}

function regina(wall) {
  const front = { 38: [0], 12: [0.52], 11: [3.84, 0.60], 14: [4.55], 0: [7.34, 0.66] }[wall.faceIndex];
  if (!front) {
    if (wall.normal.z < -0.84 || wall.normal.x > 0.84) secondaryWindows(wall);
    return brick;
  }
  const face = elevation(wall, ...front);
  plasterBand(face, 0.20, 8.34, 8.06, 12.48, [0.23, 1.75, 3.36, 4.17, 5.33, 6.79, 8.18]);
  stroke(face, 0.25, 9.88, 1.73, 9.08, 0.15, timber, 0.073);
  stroke(face, 6.78, 9.08, 8.23, 9.90, 0.15, timber, 0.073);
  gridWindow(face, 2.47, 8.77, 3.33, 2.52, 3, { stained: true, rows: 5, transom: false });
  arch(face, 0.65, 0.24, 2.55, 3.32, { door: true, fan: true, band: 0x63463f });
  gridWindow(face, 1.05, 4.57, 1.95, 1.87, 2, { stained: true });
  gridWindow(face, 4.75, 0.56, 2.47, 2.40, 3, { stained: true });
  gridWindow(face, 4.84, 4.27, 2.51, 2.17, 3, { stained: true });
  face.rect(0.0, 3.73, 8.34, 0.13, stone, 0.105);
  if (wall.faceIndex === 14) {
    balcony(face, 4.64, 7.28, 4.04, 0.60);
    plaque(wall, 1.44, 3.36, 'REGINA', 1.72);
  }
  return brick;
}

function sonnevanck(wall) {
  const front = { 16: [0], 11: [1.68], 10: [3.44, 0.72], 15: [4.50] }[wall.faceIndex];
  if (!front) {
    if (wall.normal.x > 0.84) secondaryWindows(wall);
    return 0x88584a;
  }
  const face = elevation(wall, ...front);
  plasterBand(face, 0, 3.48, 7.01, 12.31, [0.09, 0.82, 1.63, 2.56, 3.31]);
  for (let u = 0.62; u < 3.03; u += 0.25) face.rect(u, 11.76, 0.08, 1.33, timber, 0.071);
  plasterBand(face, 4.5, 7.29, 7.15, 8.20, [4.57, 5.35, 6.84]);
  gridWindow(face, 0.40, 0.68, 2.69, 2.28, 3, { stained: true });
  gridWindow(face, 0.40, 4.34, 2.69, 2.48, 3, { stained: true });
  gridWindow(face, 0.92, 7.90, 1.58, 2.23, 2, { stained: true });
  gridWindow(face, 0.94, 10.70, 1.55, 0.62, 2, { stained: true, rows: 2, transom: false });
  gridWindow(face, 3.48, 0.92, 0.59, 1.90, 1, { stained: true });
  gridWindow(face, 3.48, 4.38, 0.59, 2.23, 1, { stained: true });
  arch(face, 4.74, 0.22, 2.32, 3.33, { door: true, fan: true, band: 0x69473e });
  arch(face, 4.75, 4.19, 2.30, 2.72, { band: 0x9c6d57 });
  if (wall.faceIndex === 16) plaque(wall, 1.70, 3.47, 'SONNEVANCK', 1.73);
  return 0x88584a;
}

function zuiderhoek(wall) {
  const front = { 70: [0], 69: [3.48, 0.64], 74: [4.2], 73: [4.62] }[wall.faceIndex];
  if (!front) {
    if (wall.normal.x > 0.86 || wall.normal.z > 0.92) secondaryWindows(wall);
    return 0x865b4d;
  }
  const face = elevation(wall, ...front);
  plasterBand(face, 0, 3.89, 7.04, 11.50, [0.09, 0.85, 2.62, 3.34]);
  plasterBand(face, 4.18, 7.51, 7.85, 8.90, [4.25, 5.44, 7.02]);
  gridWindow(face, 0.42, 0.63, 2.57, 2.41, 3, { stained: true });
  gridWindow(face, 0.45, 4.39, 2.54, 2.64, 3, { stained: true });
  gridWindow(face, 0.84, 7.81, 1.77, 2.54, 2, { stained: true });
  arch(face, 4.87, 0.24, 2.44, 3.26, { door: true, fan: true, band: 0x6d4c3f });
  arch(face, 4.85, 4.22, 2.45, 2.86, { band: 0x9c7059 });
  if (wall.faceIndex === 70) plaque(wall, 1.65, 3.40, 'ZUIDERHOEK', 1.81);
  return 0x865b4d;
}

function byHonck(wall) {
  const front = { 55: [0], 6: [0.12, 0.88], 56: [3.15, 0.88], 11: [4.70], 57: [6.64], 44: [8.49] }[wall.faceIndex];
  const stoneLine = 0xbaab90;
  if (!front) {
    if (wall.normal.z > 0.80 || wall.normal.z < -0.86 || wall.normal.x > 0.85) secondaryWindows(wall, 0xaead99);
    if (wall.faceIndex === 18 || wall.faceIndex === 12) {
      const face = elevation(wall);
      face.rect(0, 10.48, wall.width, 0.15, stoneLine);
      face.rect(0, 11.27, wall.width, 0.11, stoneLine);
    }
    return 0x976755;
  }
  const face = elevation(wall, ...front);
  gridWindow(face, 0.24, 0.76, 3.96, 2.66, 5, { stained: true, frame: 0xbec4b3 });
  gridWindow(face, 0.92, 4.54, 2.20, 2.61, 2, { stained: true });
  gridWindow(face, 4.92, 0.50, 2.57, 2.97, 2, { stained: true, frame: 0xb6b8a7 });
  gridWindow(face, 5.21, 4.10, 2.09, 2.56, 2, { stained: true });
  arch(face, 5.62, 7.37, 1.29, 1.37, { fan: true });
  arch(face, 8.61, 0.21, 1.07, 3.38, { door: true, band: 0xa18d73 });
  arch(face, 8.53, 4.36, 1.21, 2.71, { band: 0xa18d73 });
  gridWindow(face, 8.61, 9.32, 1.0, 1.16, 2, { rows: 1, transom: false });
  for (const y of [3.71, 6.80, 8.95, 10.63]) face.rect(0, y, 9.82, 0.105, stoneLine, 0.074);
  if (wall.faceIndex === 6) balcony(face, 0.95, 2.94, 4.40, 0.72);
  if (wall.faceIndex === 11) plaque(wall, 1.19, 3.55, 'BY HONCK', 1.58);
  return 0x976755;
}

function moniAlendo(wall) {
  const front = { 20: [-2.97], 4: [0], 27: [2.71], 23: [5.97], 8: [9.31], 12: [12.12] }[wall.faceIndex];
  if (!front) {
    if (wall.faceIndex === 7 || wall.faceIndex === 3) {
      const face = elevation(wall);
      const peak = wall.faceIndex === 7 ? wall.width - 0.12 : 0.12;
      const eave = wall.faceIndex === 7 ? 0.08 : wall.width - 0.08;
      stroke(face, eave, 4.26, peak, 11.45, 0.19, sash, 0.105);
      gridWindow(face, wall.faceIndex === 7 ? 2.28 : 0.70, 4.76, 1.46, 1.70, 2, { rows: 1 });
    } else if (wall.normal.x > 0.85 || wall.normal.z > 0.80 || wall.normal.z < -0.80) {
      secondaryWindows(wall);
    }
    return 0x73584c;
  }
  const face = elevation(wall, ...front);
  face.rect(-3.03, 0.06, 18.61, 0.42, 0x493d35, 0.053);
  face.rect(-2.83, 3.25, 5.55, 0.15, sash, 0.104);
  face.rect(7.87, 3.25, 7.48, 0.15, sash, 0.104);
  gridWindow(face, 0.25, 1.02, 2.05, 1.88, 2, { rows: 1 });
  gridWindow(face, 8.03, 0.91, 3.13, 1.97, 3, { rows: 1 });
  gridWindow(face, 12.42, 1.16, 2.00, 1.60, 2, { rows: 1 });
  gridWindow(face, 4.91, 4.87, 2.1, 1.34, 2, { rows: 2, transom: false });
  gridWindow(face, 5.81, 7.63, 0.34, 1.03, 1, { transom: false });
  arch(face, 5.18, 2.92, 1.57, 1.01, { fan: true, band: sash });
  face.rect(5.36, 0.26, 1.16, 2.76, sash, 0.076);
  face.rect(5.45, 0.31, 0.99, 2.60, 0x854328, 0.092);
  stroke(face, 2.78, 4.27, 5.96, 9.25, 0.19, sash, 0.100);
  stroke(face, 5.96, 9.25, 9.28, 4.26, 0.19, sash, 0.100);
  if (wall.faceIndex === 27) {
    plaque(wall, 3.24, 6.61, 'MONI ALENDO', 1.67);
    const { at, trim } = face;
    trim.quad(at(4.35, 3.02, 0.08), at(4.35, 3.02, 0.64), at(7.51, 3.02, 0.64), at(7.51, 3.02, 0.08), sash);
    trim.quad(at(4.35, 2.91, 0.64), at(7.51, 2.91, 0.64), at(7.51, 3.02, 0.64), at(4.35, 3.02, 0.64), sash);
  }
  return 0x73584c;
}

export const STATIONSWEG_NORTH_VILLAS = {
  '0228100000075195': byHonck,
  '0228100000047496': regina,
  '0228100000059489': sonnevanck,
  '0228100000060688': zuiderhoek,
  '0228100000048033': moniAlendo,
};
