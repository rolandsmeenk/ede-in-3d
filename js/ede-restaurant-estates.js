import * as THREE from 'three/webgpu';
import { wallColliders } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { EDE_RESTAURANT_ESTATE_LANDMARKS, RESTAURANT_ESTATE_SURVEYS } from './ede-restaurant-estate-survey.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const green = 0x293d35;
const cream = 0xd5c9af;
const pane = 0x425654;
const porchFrame = 0x3c4740;

function wallLine(context, a, b) {
  const width = Math.hypot(b.x - a.x, b.z - a.z);
  const dx = (b.x - a.x) / width, dz = (b.z - a.z) / width;
  const normal = { x: -dz, z: dx };
  return { ...context, a, b, width, normal, point: (u, y, n = 0) =>
    [a.x + dx * u + normal.x * n, y, a.z + dz * u + normal.z * n] };
}

function wallShape(wall, ring, color, offset = 0.05) {
  wall.trim.polygon([ring.map(([u, y]) => wall.point(u, y, offset))], color);
}

function segmentArch(center, width, base, spring, rise) {
  const arch = Array.from({ length: 11 }, (_, i) => {
    const angle = i * Math.PI / 10;
    return [center + width / 2 * Math.cos(angle), spring + rise * Math.sin(angle)];
  });
  return [[center - width / 2, base], [center + width / 2, base], ...arch];
}

function archedDoor(wall, center, width, base, spring, rise, glass = false) {
  wallShape(wall, segmentArch(center, width + 0.32, base, spring + 0.04, rise + 0.12), 0x9b725b, 0.035);
  wallShape(wall, segmentArch(center, width, base, spring, rise), green, 0.065);
  if (glass) {
    wallShape(wall, segmentArch(center, width - 0.18, base + 0.55, spring - 0.08, rise - 0.04), pane, 0.075);
    surveyPanel(wall, center - width / 2 + 0.10, center + width / 2 - 0.10,
      spring - 0.21, spring - 0.145, cream, 0.088);
  }
  surveyPanel(wall, center - 0.025, center + 0.025, base + 0.06, spring - 0.04, 0x1f2d27, 0.089);
}

function roundVent(wall, u, y) {
  const rim = radius => Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6;
    return [u + Math.cos(angle) * radius, y + Math.sin(angle) * radius];
  });
  wallShape(wall, rim(0.30), 0xa0775e, 0.045);
  wallShape(wall, rim(0.22), 0x3d3b32, 0.058);
  surveyPanel(wall, u - 0.15, u + 0.15, y - 0.025, y + 0.025, 0x8b7b64, 0.068);
  surveyPanel(wall, u - 0.025, u + 0.025, y - 0.15, y + 0.15, 0x8b7b64, 0.068);
}

function koffiekamerGable(context) {
  // The 3DBAG gable has two coplanar halves. Lay out the entrance across both.
  const wall = wallLine(context, { x: 438.33, z: 3520.35 }, { x: 448.96, z: 3516.32 });
  const w = wall.width, center = w / 2, base = context.base;
  surveyPanel(wall, 0.03, w - 0.03, base + 0.02, base + 0.51, 0x918272, 0.034);
  archedDoor(wall, center, 2.72, base + 0.15, base + 2.62, 0.57, true);
  for (const side of [-1, 1]) {
    const u = center + 2.10 * side;
    wallShape(wall, [[u - 0.57, base + 0.11], [u + 0.57, base + 0.11],
      [u + 0.57, base + 2.81 + 0.22 * side], [u - 0.57, base + 2.81 - 0.22 * side]], green);
    wallShape(wall, segmentArch(center + 4.13 * side, 0.60, base + 1.02, base + 1.67, 0.09), 0x302f2b);
    roundVent(wall, center + 1.75 * side, base + 5.78);
  }
  archedDoor(wall, center, 1.12, base + 3.51, base + 4.74, 0.15);
  // The wide pale timber bargeboard is a prominent part of this elevation.
  wallShape(wall, [[0.06, 0.72], [center + 0.06, 3.78], [w - 0.06, 0.78],
    [w - 0.68, 0.72], [center + 0.06, 3.11], [0.68, 0.67]].reverse(), cream, 0.093);
  surveyLabel(wall, center - 0.75, center + 0.75, base + 2.65, base + 2.93, 'KOFFIE · LUNCH', '#2d362f', '#d9bb88');
}

function hoekelumWall(wall) {
  const { buildingIndex, faceIndex, base, width } = wall;
  if (buildingIndex === 0) {
    if (faceIndex === 21) koffiekamerGable(wall);
    if (faceIndex === 46) {
      archedDoor(wall, 5.45, 2.20, base + 0.18, base + 2.35, 0.37, true);
      for (const u of [1.60, 9.28, 12.42, 15.49]) {
        surveyWindow(wall, u - 0.57, u + 0.57, base + 1.02, base + 2.60, { frame: green, columns: 2, rows: 2 });
      }
    }
    if ([3, 9, 15, 39].includes(faceIndex)) {
      const count = faceIndex === 39 ? 5 : faceIndex === 9 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const u = width * (i + 0.5) / count;
        surveyWindow(wall, u - 0.40, u + 0.40, base + 1.02, base + 2.00, { frame: cream, rows: 2 });
      }
    }
    if (faceIndex === 39) return 0x3e4841;
  } else if (buildingIndex === 1) {
    if ([14, 16].includes(faceIndex)) {
      const u = faceIndex === 14 ? width - 0.58 : 0.57;
      surveyWindow(wall, u - 0.38, u + 0.38, base + 1.05, base + 2.12, { frame: green, columns: 2 });
    }
    if ([17, 42, 53, 54].includes(faceIndex)) {
      const count = Math.round(width / 3.0);
      for (let i = 0; i < count; i++) {
        const center = width * (i + 0.5) / count;
        surveyWindow(wall, center - 0.46, center + 0.46, base + 0.84, base + 1.83, { frame: green, rows: 2 });
      }
    }
  } else if (faceIndex === 0) {
    surveyPanel(wall, 1.22, 3.38, base + 0.08, base + 2.24, 0x2e322c, 0.045);
    surveyPanel(wall, 2.28, 2.33, base + 0.12, base + 2.19, 0x61594a, 0.055);
  }
}

function groundAt(x, z, base) {
  return getTerrain() ? terrainHeightAt(x, z) : base;
}

function box(trim, x, y, z, width, height, depth, color, angle = 0) {
  trim.solid(new THREE.BoxGeometry(width, height, depth).rotateY(angle).translate(x, y, z), color);
}

function round(trim, x, y, z, top, bottom, height, color, sides = 8) {
  trim.solid(new THREE.CylinderGeometry(top, bottom, height, sides).translate(x, y, z), color);
}

function terraceTable(trim, x, z, base, wood) {
  const y = groundAt(x, z, base);
  round(trim, x, y + 0.38, z, 0.026, 0.050, 0.72, 0x353634, 6);
  round(trim, x, y + 0.76, z, 0.49, 0.49, 0.055, wood, 10);
  for (const side of [-1, 1]) {
    const cz = z + 0.71 * side;
    box(trim, x, y + 0.43, cz, 0.40, 0.05, 0.41, wood);
    box(trim, x, y + 0.66, cz + side * 0.18, 0.40, 0.43, 0.055, wood);
    for (const lx of [-0.155, 0.155]) for (const lz of [-0.155, 0.155]) {
      box(trim, x + lx, y + 0.212, cz + lz, 0.032, 0.424, 0.032, 0x44433b);
    }
  }
}

function umbrella(trim, x, z, span, base, canvas, angle) {
  const y = groundAt(x, z, base);
  round(trim, x, y + 1.35, z, 0.032, 0.047, 2.70, 0x4b4034, 6);
  const turn = ([dx, dz]) => [x + dx * Math.cos(angle) - dz * Math.sin(angle), y + 2.34,
    z + dx * Math.sin(angle) + dz * Math.cos(angle)];
  const corners = [[-span, -span], [span, -span], [span, span], [-span, span]].map(turn);
  const crown = [x, y + 2.86, z], underside = [x, y + 2.81, z];
  for (const [i, p] of corners.entries()) {
    const q = corners[(i + 1) % corners.length];
    trim.triangle(p, crown, q, canvas);
    trim.triangle(p, q, underside, 0x82765c);
    trim.quad(p, q, [q[0], q[1] - 0.15, q[2]], [p[0], p[1] - 0.15, p[2]], canvas);
  }
}

function hoekelumTerrace({ trim, labels }) {
  for (const [x, z] of [[441.6, 3523.0], [446.0, 3522.6], [450.6, 3520.6], [453.5, 3525.2]]) {
    umbrella(trim, x, z, 1.72, -4.81, 0xc3b493, -0.36);
  }
  for (const [x, z] of [[442.0, 3523.1], [446.3, 3523.3], [450.9, 3520.8], [453.8, 3525.1],
    [456.2, 3519.5], [460.2, 3520.1], [462.0, 3525.0], [457.9, 3525.8]]) {
    terraceTable(trim, x, z, -4.81, 0x957657);
  }
  for (const [x, z] of [[438.9, 3520.95], [449.2, 3517.14]]) {
    const y = groundAt(x, z, -4.81);
    round(trim, x, y + 0.25, z, 0.24, 0.18, 0.5, 0x65574b);
    round(trim, x, y + 0.54, z, 0.14, 0.23, 0.33, 0x536042);
  }
  const x = 440.84, z = 3519.97, y = groundAt(x, z, -4.81);
  for (const dx of [-0.27, 0.27]) box(trim, x + dx, y + 0.42, z, 0.05, 0.84, 0.07, 0x82684e);
  box(trim, x, y + 0.52, z, 0.51, 0.60, 0.07, 0x444034);
  surveyLabel(wallLine({ trim, labels }, { x: x - 0.25, z: z - 0.061 }, { x: x + 0.25, z: z - 0.061 }),
    0, 0.5, y + 0.22, y + 0.82, 'MENU', '#34342f', '#d8caae');
}

function langenbergWall(wall) {
  const { faceIndex, base, low, high, width } = wall;
  if (faceIndex === 33) {
    for (const center of [width * 0.22, width * 0.72]) {
      surveyWindow(wall, center - 0.96, center + 0.96, low + 0.57, low + 2.43,
        { frame: 0xa3a693, color: 0x424d48, columns: 3 });
      surveyPanel(wall, center - 1.03, center + 1.03, low + 0.48, low + 0.56, 0x817568);
    }
  } else if ([0, 1, 2, 11, 14, 15, 16, 20, 25, 28, 39].includes(faceIndex)) {
    const count = Math.max(1, Math.round(width / 3.0));
    const lo = low + (low > base + 1.0 ? 0.60 : 0.65);
    const hi = Math.min(high - 0.17, lo + 1.50);
    for (let i = 0; i < count; i++) {
      const u = width * (i + 0.5) / count;
      if (!surveyOpeningFits(wall, u - 0.52, u + 0.52, lo, hi)) continue;
      surveyWindow(wall, u - 0.52, u + 0.52, lo, hi, { frame: 0x9fa493, color: pane, columns: 2 });
    }
  }
}

function roofWindow(trim, roof, u, v) {
  const [a, b, c, d] = roof;
  const at = (t, s, lift) => a.map((n, axis) => {
    const p = n + (b[axis] - n) * t;
    const q = d[axis] + (c[axis] - d[axis]) * t;
    return p + (q - p) * s + (axis === 1 ? lift : 0);
  });
  const tile = (start, end, left, right, lift, color, sheen = 0) =>
    trim.quad(at(start, left, lift), at(end, left, lift), at(end, right, lift), at(start, right, lift), color, sheen);
  tile(u - 0.103, u + 0.103, v - 0.23, v + 0.21, 0.067, 0x4b504a);
  tile(u - 0.091, u + 0.091, v - 0.207, v + 0.186, 0.078, 0x415761, 0.35);
}

function langenbergTerrace({ trim, labels, colliders }) {
  const front = wallLine({ trim, labels }, { x: 1374.52, z: 526.62 }, { x: 1356.85, z: 523.44 });
  const a = front.a, b = front.b;
  const rearEast = { x: 1373.90, z: 532.27 }, rearWest = { x: 1356.08, z: 529.53 };
  const rail = 26.27, rise = 26.72;
  const glazingBase = 24.18;
  const glassTop = rail - 0.13;
  const roofLayers = [a, b, rearWest, rearEast];
  const w = front.width;

  // The north terrace footprint and its six roof bays follow the PDOK aerial.
  const p = (point, y) => [point.x, y, point.z];
  const roof = (n, m, y1, y2, color) => {
    const v = (a, b, t, y) => [a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t];
    const points = [v(a, b, n, y1), v(a, b, m, y1), v(rearEast, rearWest, m, y2), v(rearEast, rearWest, n, y2)];
    trim.quad(...points, color);
    trim.quad(...points.slice().reverse(), 0x6d6d60);
  };
  for (let i = 0; i < 6; i++) {
    roof(i / 6, (i + 0.992) / 6, rail, rise, i % 2 ? 0xc6c2ad : 0xd0cbba);
  }
  const sides = [
    front,
    wallLine({ trim, labels }, rearEast, a),
    wallLine({ trim, labels }, b, rearWest),
  ];
  for (const [i, edge] of sides.entries()) {
    const count = i === 0 ? 9 : 3;
    const bay = edge.width / count;
    surveyPanel(edge, 0, edge.width, rail - 0.135, rail + 0.045, porchFrame, 0.04);
    for (let j = 0; j < count; j++) {
      const u = j * bay;
      const tint = [0x465a57, 0x465450, 0x364541][j % 3];
      const door = i === 0 && j === 1;
      const bottom = door ? 23.72 : glazingBase;
      surveyPanel(edge, u, u + bay, 23.43, bottom, 0x756255, 0.022);
      surveyPanel(edge, u, u + 0.09, bottom, glassTop, porchFrame, 0.047);
      surveyPanel(edge, u + 0.09, u + bay, bottom, glassTop, tint, 0.029, 0.80);
      surveyPanel(edge, u + 0.075, u + bay, 24.93, 24.99, porchFrame, 0.034);
      if (door) {
        surveyPanel(edge, u + bay / 2 - 0.026, u + bay / 2 + 0.026, bottom, glassTop, porchFrame, 0.048);
        surveyPanel(edge, u + bay / 2 - 0.19, u + bay / 2 + 0.19, 24.63, 24.67, 0xc6ba9e, 0.055);
      }
    }
    colliders.push(...wallColliders(edge.a, edge.b, 23.52, rail));
  }
  const top = roofLayers.map((point, i) => p(point, (i < 2 ? rail : rise) - 0.025));
  trim.quad(top[0], top[3], p(rearEast, rail - 0.135), p(a, rail - 0.135), porchFrame);
  trim.quad(p(b, rail - 0.135), p(rearWest, rail - 0.135), top[2], top[1], porchFrame);
  surveyLabel(front, w * 0.18, w * 0.81, rail + 0.03, rail + 0.45, 'PANNENKOEKENHUIS', '#353b36', '#e8dfd0');

  const roofNorth = [[1370.63, 29.97, 535.06], [1362.66, 29.96, 533.71], [1363.07, 32.63, 534.72], [1369.66, 32.60, 535.83]];
  for (const t of [0.22, 0.72]) roofWindow(trim, roofNorth, t, 0.41);

  for (const [x, z] of [[1363.0, 520.6], [1365.9, 520.9], [1370.3, 521.9],
    [1362.2, 518.4], [1367.7, 519.0], [1372.2, 521.0]]) {
    terraceTable(trim, x, z, 23.57, 0x886c51);
  }
  for (const [x, z, span] of [[1362.35, 517.60, 4.5], [1366.8, 518.37, 4.5], [1372.1, 519.30, 2.4]]) {
    const y = groundAt(x, z, 23.57);
    box(trim, x, y + 0.19, z, span, 0.51, 0.27, 0x79574c, -0.174);
    box(trim, x, y + 0.458, z, span, 0.057, 0.32, 0x887263, -0.174);
  }
  for (const [x, z] of [[1360.2, 517.20], [1364.6, 517.98], [1369.0, 518.75], [1373.4, 519.53]]) {
    const y = groundAt(x, z, 23.57);
    box(trim, x, y + 0.24, z, 0.93, 0.48, 0.38, 0x7c624d, -0.174);
    box(trim, x, y + 0.53, z, 0.85, 0.25, 0.33, 0x596148, -0.174);
  }
}

function buildEstate(_footprints, site) {
  const farm = site.id === 'boerderij-hoekelum';
  return createSurveyLandmark(site, RESTAURANT_ESTATE_SURVEYS[site.id],
    farm ? hoekelumWall : langenbergWall, farm ? hoekelumTerrace : langenbergTerrace);
}

export const EDE_RESTAURANT_ESTATE_BUILDERS = Object.fromEntries(
  EDE_RESTAURANT_ESTATE_LANDMARKS.map(({ id }) => [id, buildEstate]),
);
