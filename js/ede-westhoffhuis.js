import * as THREE from 'three/webgpu';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { WESTHOFFHUIS_SURVEY } from './ede-westhoffhuis-survey.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

// The horizontal axes follow the frontage and point toward Meester Scheepstraplein.
const A = 0.6701, B = Math.sqrt(1 - A * A);
const X = -3333, Z = -4151, wallPlane = 4.11;
const front = (t, y, u = wallPlane) => [X + A * t - B * u, y, Z + B * t + A * u];
const white = 0xe2e0d3, brick = 0x995d50, zinc = 0x42494e, glass = 0x354750;
const stone = 0x949c9f, frame = 0x555952;
const mainFacade = new Set([124, 190, 191]);
const zincReturns = new Set([44, 89, 91, 94, 126, 132, 152, 153, 156, 198, 205, 219]);

function box(batch, t, y, u, width, height, depth, color) {
  batch.solid(new THREE.BoxGeometry(width, height, depth)
    .rotateY(-Math.atan2(B, A)).translate(...front(t, y, u)), color);
}

function panel(batch, a, b, low, high, u, color, sheen = 0) {
  batch.quad(front(a, low, u), front(b, low, u), front(b, high, u), front(a, high, u), color, sheen);
}

function glazedBay(batch, a, b, low, high, u, trim, double = false) {
  panel(batch, a, b, low, high, u, trim);
  panel(batch, a + 0.065, b - 0.065, low + 0.065, high - 0.065, u + 0.012, glass, 0.79);
  if (double) panel(batch, (a + b) / 2 - 0.029, (a + b) / 2 + 0.029, low, high, u + 0.019, trim);
}

function label(labels, text, min, max, lo, hi, u, color) {
  const [ax, , az] = front(max, 0, u), [bx, , bz] = front(min, 0, u);
  labels.push({ text, a: { x: ax, z: az }, b: { x: bx, z: bz }, lo, hi, color, textColor: '#f4ecdc' });
}

function approachHeight() {
  if (!getTerrain()) return -6.34;
  return Math.max(-6.50, ...[-7.4, -5.2, -3.2, -1.2, 0, 2.5, 5.3].map(t => {
    const [x, , z] = front(t, 0, wallPlane + 0.68);
    return terrainHeightAt(x, z);
  })) + 0.14;
}

function entrance({ trim, shell, labels }, threshold) {
  for (const t of [-5.92, -3.48, -1.04, 1.40, 3.84]) {
    glazedBay(trim, t - 0.70, t + 0.70, threshold + 0.02, -2.24, wallPlane + 0.052, frame, t === -1.04);
    glazedBay(trim, t - 0.70, t + 0.70, -0.73, 1.36, wallPlane + 0.052, frame);
    box(trim, t, -0.81, wallPlane + 0.13, 1.48, 0.08, 0.22, stone);
    box(trim, t, -0.51, wallPlane + 0.17, 1.48, 0.043, 0.045, stone);
  }
  for (const t of [-7.12, -4.70, -2.26, 0.18, 2.62, 5.03]) {
    box(trim, t, -0.98, wallPlane + 0.094, 0.25, 8.54, 0.20, brick);
  }
  box(shell, -1.04, 3.28, wallPlane + 0.097, 12.55, 0.14, 0.25, white);
  label(labels, 'W e s t h o f f h u i s', -4.92, 2.84, -1.99, -1.34, wallPlane + 0.082, '#995d50');

  // The residential terrace has an open white frame above the central brick block.
  const face = wallPlane - 0.68, back = wallPlane - 3.25, top = 6.49;
  for (const t of [-6.84, -4.47, -2.13, 0.23, 2.57, 4.91]) {
    for (const u of [face, back]) box(shell, t, 5.19, u, 0.18, 2.61, 0.17, white);
    box(shell, t, top, (face + back) / 2, 0.15, 0.16, face - back, white);
  }
  for (const u of [face, back]) box(shell, -0.97, top, u, 11.91, 0.17, 0.16, white);
}

function library({ trim, labels }, threshold) {
  const u = 1.47, low = threshold - 0.39, top = -2.20;
  for (let t = 5.40; t < 25.16; t += 2.46) {
    glazedBay(trim, t, Math.min(t + 2.28, 25.29), low, top, u + 0.04, zinc, true);
    box(trim, t - 0.03, (low + top) / 2, u + 0.82, 0.22, top - low + 0.35, 0.23, white);
  }
  box(trim, 15.24, top + 0.11, u + 0.48, 19.80, 0.20, 0.93, white);
  label(labels, 'Cultura', 7.62, 10.06, -3.16, -2.79, u + 0.071, '#354750');
}

function stairs({ trim, platforms }, threshold) {
  const sill = wallPlane + 0.07, toe = wallPlane + 3.2;
  const rows = 4, columns = 9, run = (toe - sill) / rows;
  const point2 = (t, u) => {
    const [x, , z] = front(t, 0, u);
    return { x, z };
  };
  const sections = Array.from({ length: columns + 1 }, (_, i) => {
    const t = -7.14 + 12.3 * i / columns;
    const { x, z } = point2(t, toe);
    const y = getTerrain() ? Math.min(terrainHeightAt(x, z) + 0.02, threshold) : threshold - 0.60;
    return { t, y };
  });

  for (let row = 0; row < rows; row++) {
    const outside = toe - run * row, inside = outside - run;
    const level = (section, step) => THREE.MathUtils.lerp(section.y, threshold, step / rows);
    for (let i = 0; i < columns; i++) {
      const a = sections[i], b = sections[i + 1];
      const topA = level(a, row + 1), topB = level(b, row + 1);
      trim.quad(front(a.t, topA, outside), front(b.t, topB, outside),
        front(b.t, topB, inside), front(a.t, topA, inside), stone);
      trim.quad(front(a.t, level(a, row), outside), front(b.t, level(b, row), outside),
        front(b.t, topB, outside), front(a.t, topA, outside), 0x7e898f);
      platforms.push({
        id: ['westhoffhuis-steps', row, i].join('-'), holes: [],
        outer: [point2(a.t, outside), point2(b.t, outside), point2(b.t, inside), point2(a.t, inside)],
        height(x, z) {
          const t = (x - X) * A + (z - Z) * B;
          return THREE.MathUtils.lerp(topA, topB, THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1));
        },
      });
    }
  }
  for (const t of [-0.95, 5.08]) {
    for (const u of [sill + 0.19, toe - 0.28]) box(trim, t, threshold + 0.23, u, 0.039, 1.10, 0.039, 0x6c777a);
    const a = new THREE.Vector3(...front(t, threshold + 0.94, sill + 0.1));
    const b = new THREE.Vector3(...front(t, threshold + 0.64, toe - 0.1));
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    trim.solid(new THREE.CylinderGeometry(0.024, 0.024, a.distanceTo(b), 7)
      .applyQuaternion(rotation).translate(...a.lerp(b, 0.5).toArray()), 0x727d7e);
  }
}

function decorate(wall, threshold) {
  const { faceIndex, width, low, high, a, b, normal } = wall;
  if (faceIndex === 191) entrance(wall, threshold);
  if (mainFacade.has(faceIndex)) return brick;
  const metal = zincReturns.has(faceIndex);
  if (width >= 1.35) {
    const centerT = ((a.x + b.x) / 2 - X) * A + ((a.z + b.z) / 2 - Z) * B;
    const west = normal.x < -0.52 && normal.z > 0.50;
    const count = Math.max(1, Math.round(width / (west ? 2.75 : 3.45)));
    for (let i = 0; i < count; i++) {
      const center = width * (i + 0.5) / count;
      const half = Math.min(0.64, width / count * 0.31);
      for (const [bottom, top] of [[-1.40, 0.40], [1.78, 3.51]]) {
        if (high < top || low > bottom) continue;
        if (surveyWindow(wall, center - half, center + half, bottom, top, { frame: metal ? zinc : 0xb4ada4 })) {
          surveyPanel(wall, center - half - 0.03, center + half + 0.03, bottom - 0.08, bottom - 0.02, stone, 0.09);
        }
      }
      if (!(west && centerT > 5.2)) {
        surveyWindow(wall, center - half, center + half, threshold - 0.30, -2.30, { frame, columns: 2 });
      }
    }
  }
  return metal ? zinc : undefined;
}

export function createWesthoffhuis(_footprints, site) {
  const threshold = approachHeight();
  return createSurveyLandmark(site, [WESTHOFFHUIS_SURVEY], wall => decorate(wall, threshold), details => {
    library(details, threshold);
    stairs(details, threshold);
  });
}
