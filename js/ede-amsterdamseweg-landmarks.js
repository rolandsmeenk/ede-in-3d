import { polygonNormal, wallExtent } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { AMSTERDAMSEWEG_SURVEYS } from './ede-amsterdamseweg-survey.js';

const cream = 0xe8dabc;
const white = 0xe3e0d0;
const glass = 0x485657;
const black = 0x232729;
const slate = 0x46515a;
const bunteEntrance = 25.2;

function raised(wall, u, v, lo, hi, depth, color, back = 0) {
  const point = (x, y, offset = depth) => wall.point(x, y, offset);
  const a = point(u, lo), b = point(v, lo), c = point(v, hi), d = point(u, hi);
  const e = point(u, lo, back), f = point(v, lo, back), g = point(v, hi, back), h = point(u, hi, back);
  wall.trim.quad(a, b, c, d, color);
  wall.trim.quad(d, c, g, h, color);
  wall.trim.quad(e, f, b, a, color);
  wall.trim.quad(e, a, d, h, color);
  wall.trim.quad(b, f, g, c, color);
}

function sash(wall, center, width, lo, hi, { frame = white, columns = 2, rows = 2, shutters = false } = {}) {
  const u = center - width / 2, v = center + width / 2;
  if (!surveyWindow(wall, u, v, lo, hi, { color: glass, frame, columns, rows })) return;
  raised(wall, u - 0.06, v + 0.06, lo - 0.055, lo + 0.01, 0.15, frame);
  if (!shutters) return;
  const shutter = Math.min(width * 0.39, 0.46, u - 0.04, wall.width - v - 0.04);
  if (shutter < 0.13) return;
  for (const edge of [u - shutter, v]) {
    raised(wall, edge, edge + shutter, lo, hi, 0.075, black);
    for (let y = lo + 0.10; y < hi - 0.08; y += 0.12) {
      surveyPanel(wall, edge + 0.035, edge + shutter - 0.035, y, y + 0.018, 0x353d41, 0.078);
    }
  }
}

function insetShape(wall, center, lo, shape, frame, fill, inset = 0.06) {
  const outer = shape.map(([u, y]) => wall.point(center + u, lo + y, 0.071));
  const inner = shape.map(([u, y]) => wall.point(center + u * (1 - inset), lo + y * (1 - inset), 0.084));
  wall.trim.polygon([outer], frame);
  wall.trim.polygon([inner], fill);
}

function diagonal(wall, a, b, width, color, offset) {
  const du = b[0] - a[0], dy = b[1] - a[1];
  const scale = width / (2 * Math.hypot(du, dy));
  const edge = ([u, y], side) => wall.point(u - dy * scale * side, y + du * scale * side, offset);
  wall.trim.quad(edge(a, -1), edge(b, -1), edge(b, 1), edge(a, 1), color);
}

function brickCourses(wall, bottom, top, color, profile) {
  for (let row = 0, y = bottom; y < top; row++, y += 0.125) {
    let u = 0.014, v = wall.width - 0.014;
    if (profile) {
      const edges = profile.slice(0, -1).flatMap(([x, h], i) => {
        const [next, height] = profile[i + 1];
        return (h > y) === (height > y) ? [] : [x + (next - x) * (y - h) / (height - h)];
      });
      if (edges.length === 1) {
        if (y > profile[0][1]) u = edges[0] + 0.04;
        else v = edges[0] - 0.04;
      } else if (edges.length === 2) {
        [u, v] = edges;
        u += 0.04;
        v -= 0.04;
      }
    }
    surveyPanel(wall, u, v, y, y + 0.009, color, 0.018);
    for (let joint = u + (row % 2 ? 0.21 : 0.42); joint < v - 0.15; joint += 0.42) {
      surveyPanel(wall, joint, joint + 0.008, y + 0.009, y + 0.125, color, 0.018);
    }
  }
}

function lintel(wall, center, half, spring, rise, color, jointWidth = 0.048) {
  // Five splayed joints mark the voussoirs in the street elevation.
  for (let i = -2; i <= 2; i++) {
    const t = i / 2;
    const y = spring + rise * (1 - t * t);
    diagonal(wall, [center + half * t, y], [center + (half + 0.12) * t, y + 0.16], jointWidth, color, 0.096);
  }
}

function offsetWall(wall, depth) {
  const point = (u, y, offset = 0) => wall.point(u, y, offset + depth);
  const [ax, , az] = point(0, 0), [bx, , bz] = point(wall.width, 0);
  return { ...wall, a: { x: ax, z: az }, b: { x: bx, z: bz }, point };
}

function dormer(wall, center, width, lo, hi, inset, depth, frame, cap = frame) {
  const u = center - width / 2, v = center + width / 2;
  const front = offsetWall(wall, -inset);
  raised(front, u, v, lo - 0.18, hi + 0.12, 0, slate, -depth);
  raised(front, u + 0.11, v - 0.11, lo, hi, 0.034, frame);
  surveyPanel(front, u + 0.18, center - 0.028, lo + 0.065, hi - 0.065, glass, 0.042, 0.8);
  surveyPanel(front, center + 0.028, v - 0.18, lo + 0.065, hi - 0.065, glass, 0.042, 0.8);
  raised(front, u - 0.10, v + 0.10, hi + 0.09, hi + 0.20, 0.13, cap, -depth);
}

function shopFacade(wall) {
  if (wall.faceIndex === 16) {
    // The survey divides the single street gable at the roof breaks.
    const a = { x: -167.65, z: -328.93 }, b = { x: -159.78, z: -329.84 };
    const width = Math.hypot(b.x - a.x, b.z - a.z);
    const normal = { x: (a.z - b.z) / width, z: (b.x - a.x) / width };
    const point = (u, y, offset = 0) => [a.x + (b.x - a.x) * u / width + normal.x * offset,
      y, a.z + (b.z - a.z) * u / width + normal.z * offset];
    const profile = [[0, 0.63], [1.54, 2.66], [4.13, 4.31], [6.80, 2.50], [width, 0.99]];
    const front = { ...wall, a, b, width, normal, point,
      rings: [[point(0, wall.base), point(width, wall.base), ...profile.toReversed().map(([u, y]) => point(u, y))]] };
    raised(front, 0, width, wall.base - 0.16, wall.base + 0.38, 0.06, 0x373635);
    brickCourses(front, wall.base + 0.44, 4.25, 0x92776d, profile);
    for (const [i, p] of profile.entries()) {
      const q = profile[i + 1];
      if (!q) break;
      diagonal(front, p, q, 0.20, cream, 0.16);
      diagonal(front, [p[0], p[1] + 0.10], [q[0], q[1] + 0.10], 0.045, 0x50433d, 0.168);
      front.trim.quad(point(p[0], p[1] + 0.10, 0.16), point(q[0], q[1] + 0.10, 0.16),
        point(q[0], q[1] + 0.10), point(p[0], p[1] + 0.10), 0x50433d);
    }
    for (const center of [1.91, 6.12]) {
      sash(front, center, 1.23, -1.83, 0.39, { frame: cream, columns: 1, rows: 1, shutters: true });
      surveyPanel(front, center - 0.59, center + 0.59, -0.35, -0.29, cream, 0.056);
      surveyPanel(front, center - 0.025, center + 0.025, -1.79, -0.35, cream, 0.056);
      lintel(front, center, 0.66, 0.47, 0.02, 0xa68372, 0.025);
    }
    const door = 4.22;
    raised(front, door - 0.52, door + 0.52, wall.base + 0.04, 0.42, 0.045, cream);
    surveyPanel(front, door - 0.44, door + 0.44, wall.base + 0.09, -0.33, black, 0.056);
    surveyPanel(front, door - 0.38, door + 0.38, -1.94, -0.41, 0x222a29, 0.062, 0.65);
    surveyPanel(front, door - 0.027, door + 0.027, -1.94, -0.41, black, 0.066);
    surveyLabel(front, door - 0.42, door + 0.42, -0.28, 0.35, 'LH. v.d. BOSPOORT', '#211f1b', '#eee0b1');
    lintel(front, door, 0.53, 0.50, 0.03, 0xa68372, 0.025);
    insetShape(front, 4.17, 2.30, [[-0.44, -0.60], [0.44, -0.60], [0.44, 0.40],
      [0, 0.65], [-0.44, 0.40]], cream, glass, 0.11);
    surveyPanel(front, 4.14, 4.20, 1.75, 2.89, cream, 0.095);
    surveyPanel(front, 3.79, 4.55, 2.23, 2.28, cream, 0.095);
    raised(front, 3.67, 4.67, 1.65, 1.72, 0.11, black);
    raised(front, 3.28, 3.38, -0.75, -0.62, 0.15, black);
    insetShape(front, 3.33, -0.40, [[-0.06, -0.22], [0.06, -0.22], [0.13, 0.08],
      [0, 0.18], [-0.13, 0.08]], black, 0x8b785f, 0.33);
  }
  if ([14, 17].includes(wall.faceIndex)) {
    raised(wall, 0, wall.width, wall.base - 0.10, wall.base + 0.34, 0.06, 0x373635);
    for (const center of [3.6, 7.9, 11.5]) {
      sash(wall, center, 0.95, -1.72, -0.21, { frame: cream });
    }
  }
  if (wall.faceIndex === 8) return 0x684a41;
}

function oldenhoeckFacade(wall) {
  const { faceIndex, width, low, high, base } = wall;
  const doorway = 0x63412b;
  if ([2, 5, 25, 46, 63].includes(faceIndex)) {
    brickCourses(wall, Math.max(low + 0.05, base + 0.51), faceIndex === 25 ? 2.30 : high - 0.18, 0xa26551);
  }
  if (faceIndex === 2) {
    raised(wall, 0.41, 1.47, base + 0.04, -0.38, 0.065, white);
    surveyPanel(wall, 0.50, 1.38, base + 0.09, -0.46, doorway, 0.082);
    raised(wall, 0.15, 1.74, -0.42, -0.29, 0.78, white);
    raised(wall, 0.92, 0.99, -1.52, -1.47, 0.11, black);
    const radius = 0.28, center = 0.96, y = 1.72;
    const circle = Array.from({ length: 16 }, (_, i) => [
      radius * Math.cos(i * Math.PI / 8), radius * Math.sin(i * Math.PI / 8),
    ]);
    insetShape(wall, center, y, circle, white, glass, 0.16);
    for (const sign of [-1, 1]) {
      diagonal(wall, [center - 0.16, y - 0.16 * sign], [center + 0.16, y + 0.16 * sign], 0.036, white, 0.096);
    }
  } else if (faceIndex === 5) {
    sash(wall, 1.63, 1.76, base + 0.11, -0.34, { rows: 1 });
    sash(wall, 1.65, 1.77, 1.16, 2.66, { columns: 4, rows: 3 });
    dormer(wall, 3.64, 2.03, 4.62, 5.58, 1.20, 2.10, white);
  } else if (faceIndex === 25) {
    sash(wall, 1.78, 1.64, 1.06, 2.27, { columns: 4, rows: 3 });
    diagonal(wall, [0, 2.70], [width, 2.34], 0.15, white, 0.26);
  } else if (faceIndex === 63) {
    sash(wall, 1.69, 2.82, -1.45, -0.76, { columns: 6, rows: 1 });
  } else if ([4, 34, 46, 50, 57].includes(faceIndex)) {
    const count = Math.max(1, Math.round(width / 3.4));
    for (let i = 0; i < count; i++) {
      const center = width * (i + 0.5) / count;
      sash(wall, center, Math.min(1.52, width - 0.4), -1.83, -0.44, { columns: 3, rows: 2 });
      sash(wall, center, Math.min(1.56, width - 0.4), 0.89, 2.45, { columns: 4, rows: 3 });
    }
  } else if (low < base + 0.03 && width < 0.68 && high < -0.26 &&
      wall.a.x < -356.7 && wall.a.z < -327.1) {
    // Narrow coplanar facets of the rounded bay wrap its glazed openings and cornice.
    surveyPanel(wall, 0, width, high - 0.14, high, white, 0.13);
    surveyPanel(wall, 0, width, -2.14, -2.07, white, 0.075);
    surveyPanel(wall, 0, width, -2.07, high - 0.18, white, 0.046);
    surveyPanel(wall, 0.014, width - 0.014, -2.01, high - 0.22, glass, 0.056, 0.75);
    surveyPanel(wall, 0, width, -1.11, -1.07, white, 0.061);
  }
  if ([2, 4, 5, 34, 46, 50, 51, 56, 57, 59, 63].includes(faceIndex)) {
    raised(wall, -0.04, width + 0.04, high - 0.16, high - 0.025, 0.28, white);
    raised(wall, -0.10, width + 0.10, high - 0.055, high + 0.015, 0.36, white);
    surveyPanel(wall, 0, width, base + 0.05, base + 0.49, 0x67483f, 0.029);
  }
  if ([3, 40, 45, 67].includes(faceIndex)) {
    sash(wall, width / 2, width * 0.70, low + 0.13, Math.min(low + 0.93, high - 0.20), { rows: 1 });
    return slate;
  }
}

function bunteFacade(wall) {
  const { faceIndex, width, base, low, high } = wall;
  const stone = 0xdfd8c2;
  if ([1, 2, 3, 47, 68].includes(faceIndex)) {
    brickCourses(wall, base + 0.12, high - 0.20, 0xae9976);
  }
  if (faceIndex === 3) {
    for (const center of [3.3, 6.4, 9.4, 17.2, 20.2, 22.9, 26.1]) {
      sash(wall, center, 1.27, 1.60, 3.44, { frame: stone, shutters: true });
    }
    for (const center of [3.3, 6.4, 9.4, 17.2, 20.2]) {
      sash(wall, center, 1.29, -1.56, 0.38, { frame: stone, shutters: true });
      lintel(wall, center, 0.64, 0.49, 0.035, stone);
    }
    sash(wall, 13.33, 1.78, 0.92, 3.39, { frame: stone });
    raised(wall, 12.38, 14.28, 0.90, 0.99, 0.29, stone);
    raised(wall, 12.46, 14.20, 1.48, 1.52, 0.23, black);
    for (let u = 12.49; u <= 14.20; u += 0.13) {
      raised(wall, u, u + 0.024, 0.99, 1.48, 0.22, black, 0.19);
    }
    raised(wall, 12.04, 14.62, -1.83, 0.31, 0.47, stone);
    const bay = offsetWall(wall, 0.47);
    sash(bay, 13.33, 2.29, -1.69, 0.16, { frame: stone, columns: 4 });
    wall.trim.quad(wall.point(11.93, 0.32, 0.53), wall.point(14.73, 0.32, 0.53),
      wall.point(14.36, 0.84), wall.point(12.30, 0.84), 0x6c8a81);
    const entry = bunteEntrance;
    const arch = [[-0.76, -1.45], [0.76, -1.45], [0.76, 0.68],
      [0.57, 0.84], [0.30, 0.97], [0, 1.04], [-0.30, 0.97], [-0.57, 0.84], [-0.76, 0.68]];
    insetShape(wall, entry, -0.15, arch, stone, 0x262e30, 0.17);
    surveyPanel(wall, entry - 0.62, entry + 0.62, 0.46, 0.51, stone, 0.091);
    for (const side of [-1, 1]) {
      for (let y = -1.31; y < 0.27; y += 0.51) {
        diagonal(wall, [entry, y], [entry + side * 0.54, y + 0.25], 0.035, stone, 0.094);
        diagonal(wall, [entry + side * 0.54, y + 0.25], [entry, y + 0.51], 0.035, stone, 0.094);
      }
      const x = entry + side * 1.03;
      raised(wall, x - 0.13, x + 0.13, -0.05, 0.43, 0.17, black);
      surveyPanel(wall, x - 0.09, x + 0.09, 0.01, 0.35, 0x97623d, 0.176);
    }
    surveyLabel(wall, entry - 0.84, entry + 0.84, 1.13, 1.53, 'De Bunte', '#a38758', '#392d21');
    sash(wall, 22.98, 0.49, -0.42, 0.36, { frame: stone, columns: 1, rows: 1 });
    for (const center of [5.25, 13.25, 17.58]) {
      dormer(wall, center, 1.56, 5.30, 6.37, 1.04, 1.82, stone, slate);
    }
    raised(wall, -0.02, width, 3.96, 4.16, 0.26, stone);
    for (let u = 0.22; u < width - 0.10; u += 0.49) {
      raised(wall, u - 0.04, u + 0.04, 3.87, 4.0, 0.22, stone);
    }
  } else if ([2, 47, 68].includes(faceIndex)) {
    const center = width / 2;
    const arch = [[-0.27, -0.71], [0.27, -0.71], [0.27, 0.59], [0.18, 0.69], [0, 0.73],
      [-0.18, 0.69], [-0.27, 0.59]];
    insetShape(wall, center, 1.29, arch, stone, glass, 0.14);
    surveyPanel(wall, center - 0.24, center + 0.24, 1.21, 1.25, stone, 0.096);
    sash(wall, center, Math.min(width - 0.18, 0.59), 4.72, 5.39, { frame: stone, columns: 1, rows: 1 });
    raised(wall, 0, width, 6.12, 6.29, 0.13, stone);
    if (faceIndex === 68) bunteTurret(wall.shell, wall.building);
  } else if ([97, 98].includes(faceIndex)) {
    sash(wall, width * 0.52, 1.10, low + 0.53, high - 0.23, { frame: stone, rows: 1 });
    return slate;
  } else if ([7, 11, 46, 52, 67, 96].includes(faceIndex)) {
    return slate;
  } else if ([1, 6, 8, 14, 20, 57, 79, 89, 94, 108].includes(faceIndex)) {
    const count = Math.max(1, Math.round(width / 3.4));
    const tall = high - base > 5.8;
    for (let i = 0; i < count; i++) {
      const center = width * (i + 0.5) / count;
      sash(wall, center, Math.min(tall ? 1.35 : 1.76, width - 0.35), Math.max(low + 0.08, base + 0.69),
        Math.min(base + 2.70, high - 0.26), { frame: stone, columns: 2, shutters: faceIndex === 1 });
      if (tall) sash(wall, center, 1.20, high - 2.13, high - 0.51, { frame: stone, columns: 2 });
    }
  }
}

function bunteSteps({ trim, platforms }, building) {
  const ring = building.faces[3][1].map(i => building.points[i]);
  const normal = polygonNormal(ring);
  const { a, b, width } = wallExtent(ring, normal);
  const point = (u, y, offset = 0) => [
    a.x + (b.x - a.x) * u / width + normal.x * offset,
    y, a.z + (b.z - a.z) * u / width + normal.z * offset,
  ];
  const u = bunteEntrance - 1.02, v = bunteEntrance + 1.02;
  for (let step = 0; step < 5; step++) {
    const height = building.ground + 0.21 * (step + 1);
    const depth = 1.64 - step * 0.28, back = step === 4 ? 0 : depth - 0.28;
    raised({ trim, point }, u, v, building.ground - 0.10, height, depth, 0x9c8a6e, back);
    const outer = [point(u, height, back), point(v, height, back), point(v, height, depth),
      point(u, height, depth)].map(([x, , z]) => ({ x, z }));
    platforms.push({ id: `de-bunte-entry-${step}`, outer, holes: [], height: () => height });
  }
}

function bunteTurret(shell, building) {
  const ring = building.faces[127][1].map(index => building.points[index]);
  const center = [-348.91, 9.26, -387.30];
  const stand = [center[0], 9.42, center[2]];
  for (const [i, p] of ring.entries()) {
    const q = ring[(i + 1) % ring.length];
    const a = [p[0] + (p[0] - center[0]) * 0.04, p[1] + 0.02, p[2] + (p[2] - center[2]) * 0.04];
    const b = [q[0] + (q[0] - center[0]) * 0.04, q[1] + 0.02, q[2] + (q[2] - center[2]) * 0.04];
    shell.triangle(a, b, center, i % 3 === 0 ? 0x769e94 : 0x699087);
    const finial = [center[0] + (p[0] - center[0]) * 0.065, center[1] - 0.02,
      center[2] + (p[2] - center[2]) * 0.065];
    const next = [center[0] + (q[0] - center[0]) * 0.065, center[1] - 0.02,
      center[2] + (q[2] - center[2]) * 0.065];
    shell.triangle(finial, next, stand, 0x586560);
  }
}

export const AMSTERDAMSEWEG_LANDMARK_FACTORIES = {
  'het-winkeltje': (_footprints, site) => createSurveyLandmark(site, AMSTERDAMSEWEG_SURVEYS[site.id], shopFacade),
  'villa-de-oldenhoeck': (_footprints, site) => createSurveyLandmark(site, AMSTERDAMSEWEG_SURVEYS[site.id], oldenhoeckFacade),
  'landhuis-de-bunte': (_footprints, site) => {
    const buildings = AMSTERDAMSEWEG_SURVEYS[site.id];
    return createSurveyLandmark(site, buildings, bunteFacade, context => bunteSteps(context, buildings[0]));
  },
};
