import * as THREE from 'three/webgpu';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { WEST_EXPANSION_SURVEYS } from './ede-west-expansion-surveys.js';

const brick = 0x624f46;
const stone = 0xbfb397;
const glazing = 0x394647;

function rectangularBays(wall, count, lo, hi, windowWidth, settings, doorCenters = []) {
  const { base, width } = wall;
  for (let i = 0; i < count; i++) {
    const center = width * (i + 0.5) / count;
    if (doorCenters.some(u => Math.abs(u - center) < windowWidth / 2 + 0.97)) continue;
    surveyWindow(wall, center - windowWidth / 2, center + windowWidth / 2, base + lo, base + hi, settings);
  }
}

function millWall(wall) {
  const { a, base, b, high, low, normal, width } = wall;
  const east = (a.x + b.x) / 2;
  const south = (a.z + b.z) / 2;
  if (width < 1.2) return;
  const frame = { color: 0x374a55, frame: 0x8a8782, rows: 2 };

  if (low <= base + 0.1 && high >= base + 6.7 && (normal.x > 0.7 || normal.z > 0.75)) {
    const count = Math.max(1, Math.round(width / 3.3));
    const entrance = east > -6775 && normal.x > 0.9 && width > 6.5 && south > -70;
    const center = width * 0.52;
    rectangularBays(wall, count, 3.83, 6.42, Math.min(1.65, width * 0.55), frame);
    rectangularBays(wall, count, 0.67, 3.12, Math.min(1.67, width * 0.54), { ...frame, rows: 1 },
      entrance ? [center] : []);
    if (entrance) {
      // The shop entrance and its modest pale sign are visible below the tower.
      surveyWindow(wall, center - 0.93, center + 0.93, base + 1.02, base + 3.44,
        { color: 0x253235, frame: 0xa8a9a0, columns: 2, rows: 2 });
      surveyLabel(wall, center - 1.25, center + 1.25, base + 3.46, base + 3.78, 'INGANG', '#d9d5c9', '#263137');
      const heading = Math.atan2(normal.x, normal.z);
      for (let step = 0; step < 6; step++) {
        const rise = (step + 1) * 0.17;
        const depth = (6 - step) * 0.27;
        const [x, y, z] = wall.point(center, base + rise / 2, depth / 2);
        wall.trim.solid(new THREE.BoxGeometry(2.14, rise, depth).rotateY(heading).translate(x, y, z), 0x464a4c);
      }
    }
  }
  if (high > base + 16 && normal.z > 0.6 && width > 3) {
    rectangularBays(wall, Math.max(2, Math.round(width / 1.75)), high - base - 1.8, high - base - 0.80,
      0.74, { color: 0x384549, frame: 0x9d9581 });
    if (width > 8 && high < base + 22 && south < -77) {
      const inset = width * 0.28;
      for (const [i, text] of ['STEENBERGEN', 'SIERBETON b.v.', 'DE KLOMP'].entries()) {
        const top = base + 17.88 - i * 0.52;
        if (surveyOpeningFits(wall, inset, width - inset, top - 0.43, top)) {
          surveyLabel(wall, inset, width - inset, top - 0.43, top, text, '#715044', '#e4e5db');
        }
      }
    }
  }
  if (low <= base + 0.1 && high >= base + 6.7 && normal.z > 0.85 && east > -6782) {
    surveyPanel(wall, 0.15, width - 0.15, base + 6.71, base + 6.86, 0x404347);
  }
}

function farmWall(wall) {
  const { base, high, low, normal, width, a, b } = wall;
  if (low > base + 0.08 || width < 1.4) return;
  const color = { color: 0x383d3b, frame: 0xafa899, columns: 3 };
  if (width > 13 && high < base + 3.3 && Math.abs(normal.x) > 0.8) {
    // Under the long tile roof the stable has grouped, shallow windows and wide doors.
    const bays = Math.round(width / 3.85);
    const doors = normal.x < -0.8 ? [width * 0.28, width * 0.76] : [];
    rectangularBays(wall, bays, 1.50, 2.13, 2.08, { ...color, columns: 4 }, doors);
    for (const center of doors) {
      surveyWindow(wall, center - 0.92, center + 0.92, base + 0.07, base + 2.27,
        { color: 0x34382d, frame: 0x463e31, columns: 2 });
    }
  } else if (high > base + 3.5 && width > 5 && (a.z + b.z) / 2 > -94) {
    rectangularBays(wall, Math.round(width / 3.15), 0.80, 2.25, 1.36, { ...color, rows: 2 });
  }
}

function lineOnWall(wall, x1, y1, x2, y2, gauge, color, depth = 0.063) {
  const size = Math.hypot(x2 - x1, y2 - y1);
  const dx = -(y2 - y1) * gauge / (2 * size), dy = (x2 - x1) * gauge / (2 * size);
  wall.trim.quad(wall.point(x1 - dx, y1 - dy, depth), wall.point(x2 - dx, y2 - dy, depth),
    wall.point(x2 + dx, y2 + dy, depth), wall.point(x1 + dx, y1 + dy, depth), color);
}

function churchWindow(wall, center, lo, hi, windowWidth) {
  const left = center - windowWidth / 2, right = center + windowWidth / 2;
  if (!surveyWindow(wall, left, right, lo, hi, { color: glazing, frame: stone })) return;
  surveyPanel(wall, left - 0.055, right + 0.055, lo - 0.16, lo - 0.033, stone, 0.060);
  const u = left + 0.08, v = right - 0.08, bottom = lo + 0.08, top = hi - 0.08;
  const step = (top - bottom) / 4, run = (v - u) / 4;
  for (let i = 0; i < 4; i++) {
    lineOnWall(wall, u, bottom + i * step, v - i * run, top, 0.026, stone);
    lineOnWall(wall, v, bottom + i * step, u + i * run, top, 0.026, stone);
    if (i === 0) continue;
    lineOnWall(wall, u + i * run, bottom, v, top - i * step, 0.026, stone);
    lineOnWall(wall, v - i * run, bottom, u, top - i * step, 0.026, stone);
  }
}

function churchWall(wall) {
  const { a, b, base, high, low, normal, width } = wall;
  const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
  const height = high - base;
  if (height > 13 && width > 3.9 && normal.z > 0.92 && x > -6505) {
    // Bronze hour marks and hands sit directly against the southern brick pier.
    const center = width * 0.54, y = base + 11.35;
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      const dx = Math.sin(angle), dy = Math.cos(angle);
      lineOnWall(wall, center + dx * 0.66, y + dy * 0.66,
        center + dx * 0.84, y + dy * 0.84, 0.043, 0xb7a271);
    }
    for (const [dx, dy] of [[0.57, 0.34], [-0.34, 0.18]]) {
      lineOnWall(wall, center, y, center + dx, y + dy, 0.064, 0xc1ab7c);
    }
    return;
  }
  if (low > base + 0.07 || width < 2.12) return;
  if (height > 6.55 && height < 7.35 && Math.abs(normal.x) > 0.86 && x > -6523) {
    churchWindow(wall, width / 2, base + 3.11, base + 5.62, 1.81);
    return;
  }
  if (height < 5.95 && height > 2.7 && z < -1464 && x < -6520 && width > 4) {
    const count = Math.min(8, Math.round(width / 3.25));
    const sideEntrance = normal.z < -0.88 && width > 11;
    const center = width * 0.34;
    rectangularBays(wall, count, 0.84, Math.min(2.21, height - 0.30), 1.32,
      { color: 0x435453, frame: 0xad9f88, columns: 2 }, sideEntrance ? [center] : []);
    if (sideEntrance) {
      surveyWindow(wall, center - 0.85, center + 0.85, base + 0.07, base + 2.42,
        { color: 0x403935, frame: stone, columns: 2, rows: 2 });
    }
  }
  return x < -6527 ? 0x746255 : undefined;
}

function churchDetail({ trim }) {
  const deckOrientation = -0.20;
  function box(x, y, z, w, h, d, color) {
    trim.solid(new THREE.BoxGeometry(w, h, d).rotateY(deckOrientation).translate(x, y, z), color);
  }
  box(-6502.91, -11.40, -1450.28, 5.16, 0.17, 3.18, 0xb1aca0);
  box(-6502.66, -2.06, -1450.28, 3.56, 0.20, 2.98, 0x494c47);
  trim.solid(new THREE.CylinderGeometry(0.35, 0.56, 0.67, 12)
    .translate(-6502.3, -2.55, -1450.16), 0x3c3632);
  trim.solid(new THREE.CylinderGeometry(0.53, 0.57, 0.08, 12)
    .translate(-6502.3, -2.89, -1450.16), 0x443b35);
  trim.solid(new THREE.CylinderGeometry(0.028, 0.034, 3.5, 6)
    .translate(-6502.62, -0.18, -1450.24), 0x4d4c43);
  box(-6502.62, 1.45, -1450.24, 0.05, 0.40, 0.47, 0xb9a579);
  box(-6505.33, -13.19, -1450.81, 0.20, 2.9, 1.60, 0x3c302b);
  box(-6505.18, -13.19, -1450.81, 0.044, 2.9, 0.045, brick);
}

export const WEST_EXPANSION_LANDMARK_FACTORIES = {
  'de-klomp-maalderij': (_, site) => createSurveyLandmark(site, WEST_EXPANSION_SURVEYS[site.id],
    wall => wall.building.kind === 'mill' ? millWall(wall) : farmWall(wall)),
  'hervormde-kerk-ederveen': (_, site) => createSurveyLandmark(site, WEST_EXPANSION_SURVEYS[site.id], churchWall, churchDetail),
};
