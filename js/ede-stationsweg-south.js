import { surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { wallColliders } from './ede-civic-landmarks.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const cream = 0xe0dbca;
const ivory = 0xe8e4d6;
const timber = 0x383a32;
const iron = 0x343e35;
const glass = 0x5b7279;
const lead = 0x45483f;

function arch(u, v, lo, hi, rise) {
  const spring = hi - rise;
  const middle = (u + v) / 2;
  return [[u, lo], [v, lo], ...Array.from({ length: 9 }, (_, i) => {
    const angle = i * Math.PI / 8;
    return [middle + (v - u) / 2 * Math.cos(angle), spring + rise * Math.sin(angle)];
  })];
}

function archedWindow(wall, u, v, lo, hi, { color = glass, frame = timber, rise = 0.24, depth = 0 } = {}) {
  if (depth) {
    const rim = arch(u, v, lo, hi, rise).map(([x, y]) => wall.point(x, y));
    const back = arch(u, v, lo, hi, rise).map(([x, y]) => wall.point(x, y, -depth));
    wall.rings.push(rim.slice().reverse());
    for (let i = 0; i < rim.length; i++) {
      const next = (i + 1) % rim.length;
      wall.trim.quad(rim[next], rim[i], back[i], back[next], 0x797669);
    }
  }
  wall.trim.polygon([arch(u, v, lo, hi, rise).map(([x, y]) => wall.point(x, y, 0.032 - depth))], frame);
  wall.trim.polygon([arch(u + 0.075, v - 0.075, lo + 0.075, hi - 0.075, rise * 0.94)
    .map(([x, y]) => wall.point(x, y, 0.045 - depth))], color);
  surveyPanel(wall, (u + v) / 2 - 0.022, (u + v) / 2 + 0.022,
    lo + 0.03, hi - 0.14, frame, 0.053 - depth);
  surveyPanel(wall, u, v, hi - rise - 0.12, hi - rise - 0.06, frame, 0.053 - depth);
}

function sash(wall, u, v, lo, hi, frame = timber, color = glass) {
  if (surveyWindow(wall, u, v, lo, hi, { frame, color, columns: 2, rows: 2 })) {
    surveyPanel(wall, u - 0.07, v + 0.07, lo - 0.06, lo + 0.02, 0xaba696, 0.077);
  }
}

function roofEdge(wall, u, v, y0, y1, reach) {
  const p = wall.point;
  wall.trim.quad(p(u, y0, 0.02), p(u, y0, reach), p(v, y1, reach), p(v, y1, 0.02), 0x47494e);
  wall.trim.quad(p(u, y0 - 0.14, reach), p(v, y1 - 0.14, reach),
    p(v, y1, reach), p(u, y0, reach), timber);
  wall.trim.quad(p(v, y1 - 0.14, 0.02), p(v, y1 - 0.14, reach),
    p(u, y0 - 0.14, reach), p(u, y0 - 0.14, 0.02), 0xb0a68e);
  const x = u + (v - u) * 0.44, y = y0 + (y1 - y0) * 0.44 - 0.13;
  wall.trim.quad(p(x - 0.043, y - 0.55, 0.02), p(x + 0.043, y - 0.55, 0.02),
    p(x + 0.043, y, reach), p(x - 0.043, y, reach), timber);
}

function balconyRail(wall, from, to, y, reach) {
  for (const height of [0.14, 0.74]) {
    surveyPanel(wall, from, to, y + height - 0.045, y + height, timber, reach);
  }
  const count = Math.max(1, Math.round((to - from) / 0.19));
  for (let i = 0; i <= count; i++) {
    const x = from + (to - from) * i / count;
    surveyPanel(wall, x - 0.027, x + 0.027, y + 0.12, y + 0.76, timber, reach + 0.005);
  }
}

function bergEnDal(wall) {
  const { faceIndex: id, width: w, low, high, base } = wall;
  if (id === 1 || id === 14) {
    const x = w * (id === 1 ? 0.54 : 0.48);
    archedWindow(wall, x - 0.64, x + 0.64, base + 0.86, base + 3.18);
    sash(wall, x - 0.53, x + 0.53, base + 4.22, base + 6.57);
    const attic = w * (id === 1 ? 0.84 : 0.16);
    archedWindow(wall, attic - 0.34, attic + 0.34, base + 7.58, base + 9.22);
    roofEdge(wall, 0, w, id === 1 ? 9.64 : 14.08, id === 1 ? 14.08 : 10.18, 0.43);
    if (id === 1) surveyLabel(wall, w - 1.30, w + 0.60, 8.74, 9.00, 'BERG EN DAL', '#e0dbca', '#39352d');
  } else if (id === 41) {
    archedWindow(wall, 0.52, w - 0.44, 5.52, 8.84, { rise: 0.80, frame: 0x827c6c, color: 0x334244, depth: 0.30 });
    balconyRail(wall, 0.50, w - 0.42, 5.43, 0.02);
    for (const u of [0.34, w - 0.32]) {
      wall.trim.quad(wall.point(u - 0.075, 5.22, 0.075), wall.point(u + 0.075, 5.22, 0.075),
        wall.point(u + 0.075, 5.49, 0.42), wall.point(u - 0.075, 5.49, 0.42), timber);
    }
  } else if ([18, 19, 20].includes(id)) {
    const count = id === 19 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const from = w * i / count + 0.095;
      const to = w * (i + 1) / count - 0.095;
      archedWindow(wall, from, to, base + 0.65, 4.92, { frame: 0x3a483e, rise: 0.21 });
      surveyPanel(wall, from, to, base + 0.28, base + 0.68, 0x53594a, 0.055);
    }
    surveyPanel(wall, 0, w, 5.13, 5.31, timber, 0.15);
  } else if (low <= base + 0.05 && w > 2.26 && high > base + 6.0 && id !== 43) {
    const count = w > 4.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const x = w * (i + 0.5) / count;
      sash(wall, x - 0.50, x + 0.50, base + 1.02, base + 3.18);
      sash(wall, x - 0.46, x + 0.46, base + 4.16, base + 6.22);
    }
  }
  return cream;
}

function bergEnDalFence({ trim, colliders }) {
  const a = { x: -155.78, z: 1125.42 }, b = { x: -152.83, z: 1141.58 };
  const at = (t, height) => {
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    return [x, (getTerrain() ? terrainHeightAt(x, z) : 1.22) + height, z];
  };
  const panel = (t, u, lo, hi) => {
    const vertices = [at(t, lo), at(u, lo), at(u, hi), at(t, hi)];
    trim.quad(...vertices, iron);
    trim.quad(...vertices.reverse(), iron);
  };
  const spans = 8, pickets = spans * 8;
  for (const height of [0.28, 0.99]) panel(0, 1, height, height + 0.035);
  for (let i = 0; i <= pickets; i++) {
    const t = i / pickets;
    const post = i % 8 === 0;
    const half = (post ? 0.034 : 0.013) / 16.4;
    panel(t - half, t + half, 0.04, post ? 1.28 : 1.16);
  }
  colliders.push(...wallColliders(a, b, Math.min(at(0, 0)[1], at(1, 0)[1]), Math.max(at(0, 1.22)[1], at(1, 1.22)[1]), 0.07));
}

function leadedGlass(wall, u, v, lo, hi) {
  surveyPanel(wall, u, v, lo, hi, timber);
  const h = hi - lo, w = v - u;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const x = u + w * (col + 0.5) / 3, y = lo + h * (row + 0.5) / 5;
      const dx = w * 0.16, dy = h * 0.094;
      const base = row === 0 || row === 4 ? 0x787151 : 0x8a7656;
      const tone = row === 2 && col === 1 ? 0x546966 : base;
      wall.trim.quad(wall.point(x - dx, y, 0.050), wall.point(x, y - dy, 0.050),
        wall.point(x + dx, y, 0.050), wall.point(x, y + dy, 0.050), tone, 0.62);
    }
    surveyPanel(wall, u + 0.03, v - 0.03, lo + h * row / 5, lo + h * row / 5 + 0.017, lead, 0.058);
  }
  for (let col = 1; col < 3; col++) {
    const x = u + w * col / 3;
    surveyPanel(wall, x - 0.008, x + 0.008, lo + 0.028, hi - 0.028, lead, 0.058);
  }
}

function bergOord(wall) {
  const { faceIndex: id, width: w, low, high, base } = wall;
  if ([9, 13, 15].includes(id)) {
    sash(wall, 0.16, w - 0.16, 2.17, 4.10);
    leadedGlass(wall, 0.19, w - 0.19, 3.44, 4.14);
    surveyPanel(wall, 0, w, 5.22, 5.47, timber, 0.13);
    balconyRail(wall, 0.05, w - 0.05, 5.47, 0.14);
  } else if (id === 41) {
    surveyPanel(wall, 0.55, 1.66, 1.51, 4.59, timber, 0.048);
    leadedGlass(wall, 0.22, 0.55, 2.03, 4.59);
    leadedGlass(wall, 1.66, 2.11, 2.03, 4.59);
    leadedGlass(wall, 0.61, 1.60, 3.82, 4.58);
    archedWindow(wall, 0.68, 1.54, 2.69, 3.75, { frame: timber, color: 0x9a7d51, rise: 0.10 });
    sash(wall, 0.55, 1.79, 5.70, 8.15);
  } else if (id === 10) {
    surveyPanel(wall, 0.19, 2.37, 5.58, 8.32, timber);
    sash(wall, 0.31, 2.25, 5.65, 8.25);
    sash(wall, 1.39, 2.22, 9.27, 10.49);
    surveyLabel(wall, 1.05, 2.55, 8.91, 9.16, 'BERG-OORD', '#e8e4d6', '#30322e');
    roofEdge(wall, 0, w, 9.94, 12.39, 0.34);
    for (let i = 0; i < 7; i++) {
      const x = 1.10 + i * 0.20;
      const y = 9.94 + (12.39 - 9.94) * x / w;
      surveyPanel(wall, x, x + 0.17, 11.0, y - 0.09, timber, 0.031);
    }
  } else if (id === 16) {
    roofEdge(wall, 0, w, 12.39, 11.51, 0.34);
    for (let i = 0; i < 4; i++) {
      const x = i * 0.20;
      surveyPanel(wall, x, x + 0.17, 11.0, 12.29 - x, timber, 0.031);
    }
  } else if (id === 40) {
    roofEdge(wall, 0, w, 11.51, 11.02, 0.31);
  } else if (low <= base + 0.06 && w > 1.9) {
    const count = w > 7 ? 3 : w > 4.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const x = w * (i + 0.5) / count;
      sash(wall, x - 0.47, x + 0.47, base + 0.85, base + 2.58);
      if (high > 7.4) sash(wall, x - 0.43, x + 0.43, base + 4.3, base + 6.42);
    }
  }
  if (low <= base + 0.06) surveyPanel(wall, 0, w, base, base + 0.27, 0x484b49);
  return ivory;
}

function millSash(wall, u, v, lo, hi) {
  const shutter = 0x3e4b43;
  surveyPanel(wall, u - 0.07, v + 0.07, lo - 0.06, hi + 0.08, 0xded9c5);
  surveyPanel(wall, u, v, lo, hi, glass, 0.048, 0.64);
  for (const y of [lo + (hi - lo) / 3, hi - (hi - lo) / 3]) {
    surveyPanel(wall, u, v, y - 0.018, y + 0.018, 0xe8e4d8, 0.056);
  }
  surveyPanel(wall, (u + v) / 2 - 0.021, (u + v) / 2 + 0.021, lo, hi, 0xe8e4d8, 0.056);
  for (const [a, b] of [[u - 0.44, u - 0.08], [v + 0.08, v + 0.44]]) {
    surveyPanel(wall, a, b, lo - 0.05, hi + 0.045, shutter, 0.066);
    for (const y of [lo + 0.24, hi - 0.24]) {
      surveyPanel(wall, a, b, y - 0.023, y + 0.023, 0x596457, 0.079);
    }
  }
}

function molenaarswoning(wall) {
  const { faceIndex: id, width: w, base } = wall;
  if (id === 6) {
    for (const fraction of [0.23, 0.66, 0.87]) {
      const x = fraction * w;
      millSash(wall, x - 0.40, x + 0.40, base + 0.91, base + 2.68);
    }
    surveyPanel(wall, 0, w, 1.93, 2.04, timber, 0.078);
  } else if (id === 9) {
    millSash(wall, -0.49, 0.52, base + 1.06, base + 2.89);
    sash(wall, 0.22, 0.98, 2.64, 3.82, 0xe8e4d8);
    roofEdge(wall, 0, w, 5.16, 0.91, 0.105);
  } else if (id === 8) {
    roofEdge(wall, 0, w, 2.05, 5.16, 0.105);
  } else if (id === 1) {
    surveyPanel(wall, w * 0.48, w * 0.72, base + 0.15, base + 2.12, 0x475044, 0.058);
  } else if (id === 2 || id === 7) {
    const x = w * 0.48;
    millSash(wall, x - 0.38, x + 0.38, base + 0.85, base + 2.46);
  }
  if ([1, 2, 6, 7, 8, 9].includes(id)) surveyPanel(wall, 0, w, base, base + 0.22, 0x4c4a44);
  return 0xeeebdf;
}

export const STATIONSWEG_SOUTH = {
  '0228100000018265': { decorate: bergEnDal, finish: bergEnDalFence },
  '0228100000046222': bergOord,
  '0228100000010632': molenaarswoning,
};
