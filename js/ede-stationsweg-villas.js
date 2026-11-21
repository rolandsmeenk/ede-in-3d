import { facePanel, wallColliders } from './ede-civic-landmarks.js';
import { surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { terrainHeightAt } from './terrain.js';

const cream = 0xe0d9ca;
const glass = 0x3b555f;
const timber = 0x343733;

function sash(wall, center, width, sill, height, frame, shutters = false) {
  const u = center - width / 2, v = center + width / 2;
  if (!surveyWindow(wall, u, v, sill, sill + height, { color: glass, frame, columns: 2, rows: 2 })) return;
  surveyPanel(wall, u - 0.07, v + 0.07, sill - 0.08, sill, frame, 0.074);
  if (!shutters || u - 0.29 < 0 || v + 0.29 > wall.width) return;
  surveyPanel(wall, u - 0.29, u - 0.035, sill, sill + height, timber, 0.058);
  surveyPanel(wall, v + 0.035, v + 0.29, sill, sill + height, timber, 0.058);
}

function timberLine(wall, a, b, size, color = timber) {
  const du = b[0] - a[0], dy = b[1] - a[1];
  const scale = size / (2 * Math.hypot(du, dy));
  const offset = [-dy * scale, du * scale];
  const p = (end, sign) => wall.point(end[0] + sign * offset[0], end[1] + sign * offset[1], 0.065);
  wall.trim.polygon([[p(a, -1), p(b, -1), p(b, 1), p(a, 1)]], color);
}

function caIraFacade(wall) {
  const { faceIndex, width, high, low, base, rings } = wall;
  if (low <= base + 0.05 && high > base + 0.36) {
    surveyPanel(wall, 0, width, base + 0.02, base + 0.30, 0x47403a, 0.026);
  }
  if ([4, 38, 39, 61].includes(faceIndex)) {
    const head = Math.min(high - 0.23, 3.59);
    surveyWindow(wall, 0.08, width - 0.08, 1.01, head, {
      color: 0x3e4642, frame: cream, columns: Math.round(width / 0.83), rows: 2,
    });
    surveyPanel(wall, 0.07, width - 0.07, head - 0.36, head, 0xad8450, 0.048, 0.45);
    const postCount = Math.max(2, Math.round(width / 0.21));
    for (let i = 0; i <= postCount; i++) {
      const u = 0.06 + (width - 0.12) * i / postCount;
      surveyPanel(wall, u - 0.019, u + 0.019, 4.20, 4.95, cream, -0.18);
    }
    surveyPanel(wall, 0.04, width - 0.04, 4.92, 5.01, timber, -0.175);
    return cream;
  }
  if ([24, 31, 59].includes(faceIndex)) {
    // 3DBAG divides the front gable into three wall planes at the bay.
    const bottom = 6.96;
    const along = ([x, , z]) => ((x - wall.a.x) * (wall.b.x - wall.a.x) + (z - wall.a.z) * (wall.b.z - wall.a.z)) / width;
    for (let i = 0; i < rings[0].length; i++) {
      let a = rings[0][i], b = rings[0][(i + 1) % rings[0].length];
      if (a[1] > b[1]) [a, b] = [b, a];
      if (b[1] < bottom || Math.abs(b[1] - a[1]) < 0.18 || Math.abs(along(a) - along(b)) < 0.2) continue;
      const t = a[1] < bottom ? (bottom - a[1]) / (b[1] - a[1]) : 0;
      timberLine(wall, [along(a) + (along(b) - along(a)) * t, Math.max(bottom, a[1])],
        [along(b), b[1]], 0.16);
    }
    if (faceIndex === 24) {
      surveyPanel(wall, 0.42, width - 0.03, 6.98, 7.13, timber);
      surveyPanel(wall, 1.12, width - 0.03, 7.68, 7.82, timber);
      for (const [u, top] of [[0.95, 7.60], [1.36, 8.07], [1.79, 8.57], [2.55, 9.37]]) {
        timberLine(wall, [u, 7.03], [u, top], 0.095);
      }
      sash(wall, width * 0.77, 0.54, 7.92, 0.78, cream);
      sash(wall, width * 0.46, 1.17, 4.40, 1.94, cream, true);
    }
    if (faceIndex === 31) {
      surveyPanel(wall, 0.01, width - 0.07, 6.98, 7.13, timber);
      surveyPanel(wall, 0.01, width - 0.18, 7.68, 7.82, timber);
      timberLine(wall, [0.28, 7.04], [0.28, 9.24], 0.10);
      timberLine(wall, [0.80, 7.04], [0.80, 8.57], 0.095);
      sash(wall, width * 0.51, 0.94, 5.19, 1.58, cream);
    }
    return cream;
  }
  if ([10, 14, 18, 58, 62, 2, 12].includes(faceIndex)) {
    const count = Math.max(1, Math.round(width / 2.22));
    for (let i = 0; i < count; i++) {
      const center = (i + 0.5) * width / count;
      sash(wall, center, 1.02, 1.24, 1.70, cream, true);
      sash(wall, center, 1.00, 4.21, 1.73, cream, true);
    }
  } else if ([5, 16, 28, 41, 55].includes(faceIndex)) {
    sash(wall, width * 0.5, Math.min(width - 0.3, 1.17), low + 0.45, 1.38, cream, true);
  }
  return cream;
}

function caIraGarden({ trim, colliders }) {
  // Fence line follows the street and the low curved garden boundary in the PDOK view.
  const line = [[-170.47, 983.36], [-167.30, 999.25], [-166.18, 1002.03], [-163.57, 1003.31], [-160.0, 1002.99]];
  for (let i = 1; i < line.length; i++) {
    const [x0, z0] = line[i - 1], [x1, z1] = line[i];
    const a = { x: x0, z: z0 }, b = { x: x1, z: z1 };
    const length = Math.hypot(x1 - x0, z1 - z0);
    const normal = { x: -(z1 - z0) / length, z: (x1 - x0) / length };
    const y = terrainHeightAt((x0 + x1) / 2, (z0 + z1) / 2);
    for (const side of [-1, 1]) {
      const n = { x: normal.x * side, z: normal.z * side };
      facePanel(trim, a, b, n, 0, 1, y - 0.15, y + 0.23, 0x65554b, 0.095);
      facePanel(trim, a, b, n, 0, 1, y + 0.78, y + 0.83, timber, 0.004);
      const count = Math.ceil(length / 0.28);
      for (let j = 0; j < count; j++) {
        const u = (j + 0.5) / count, half = 0.013 / length;
        facePanel(trim, a, b, n, u - half, u + half, y + 0.22, y + 0.85, timber, 0.008);
      }
    }
    const corner = (x, z, side) => [x + normal.x * side * 0.10, y + 0.23, z + normal.z * side * 0.10];
    trim.polygon([[corner(x0, z0, 1), corner(x1, z1, 1), corner(x1, z1, -1), corner(x0, z0, -1)]], 0x75675c);
    colliders.push(...wallColliders(a, b, y - 0.15, y + 0.85, 0.20));
  }
}

const richmondBands = 0x8f4c45;
const richmondFrame = 0x414f4c;

function richmondFacade(wall) {
  const { faceIndex, width, low, high, a, b } = wall;
  const east = (a.x + b.x) / 2 - 0.17 * ((a.z + b.z) / 2 - 1589);
  const rear = east < -106.4 && ![17, 18, 31, 39, 90, 141].includes(faceIndex);
  if (rear) {
    if (width >= 1.80 && high - low > 4) {
      const bays = Math.max(1, Math.round(width / 3.15));
      for (let i = 0; i < bays; i++) {
        const center = (i + 0.5) * width / bays;
        for (const sill of [0.12, 3.56, 7.23, 10.15]) {
          sash(wall, center, Math.min(width / bays - 0.42, 2.31), sill, sill < 3 ? 2.20 : 1.86, richmondFrame);
        }
      }
    }
    return 0x655d59;
  }
  if ([14, 55, 57, 16, 21].includes(faceIndex)) {
    const sill = low < 0 ? 0.37 : low + 0.32;
    surveyWindow(wall, 0.07, width - 0.07, sill, Math.min(high - 0.27, sill + 2.66), {
      color: glass, frame: cream, columns: Math.max(1, Math.round(width / 0.75)), rows: 2,
    });
    if (faceIndex === 14) surveyPanel(wall, 0.05, width - 0.05, 0.04, 0.33, cream, 0.047);
    return cream;
  }
  if (width >= 0.9 && low < 1.3) {
    surveyPanel(wall, 0, width, low + 0.02, 0.34, 0x46484b, 0.028);
  }
  if (width >= 1.1 && low < 1.4 && high > 8) {
    for (const y of [3.06, 7.25]) surveyPanel(wall, 0, width, y, y + 0.13, richmondBands, 0.032);
  }

  if ([19, 20].includes(faceIndex)) {
    const ridge = wall.rings[0].filter(point => point[1] > 8.90);
    if (ridge.length === 2) {
      const [u, v] = ridge.map(([x, , z]) =>
        ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / width);
      timberLine(wall, [u, ridge[0][1] - 0.05], [v, ridge[1][1] - 0.05], 0.15, richmondFrame);
    }
    if (faceIndex === 20) sash(wall, width * 0.53, 0.74, 9.13, 1.38, richmondFrame);
  }
  if (faceIndex === 19) {
    sash(wall, width * 0.49, 0.70, 9.16, 1.34, richmondFrame);
    surveyLabel(wall, 0.11, width - 0.11, 8.61, 8.98, 'RICHMOND', '#e0d9ca', '#35423c');
    // The oriel projects beyond the surveyed facade; the jambs taper back at each side.
    const u = 0.57, v = width - 0.57, sill = 4.80, head = 7.40;
    for (const [x0, x1, d0, d1] of [[u, u + 0.27, 0.03, 0.51], [u + 0.27, v - 0.27, 0.51, 0.51], [v - 0.27, v, 0.51, 0.03]]) {
      wall.trim.polygon([[wall.point(x0, sill, d0), wall.point(x1, sill, d1),
        wall.point(x1, head, d1), wall.point(x0, head, d0)]], richmondFrame);
      const p = (t, y) => wall.point(x0 + (x1 - x0) * t, y, d0 + (d1 - d0) * t + 0.016);
      wall.trim.polygon([[p(0.08, sill + 0.12), p(0.92, sill + 0.12), p(0.92, head - 0.11), p(0.08, head - 0.11)]], glass);
    }
    wall.trim.polygon([[wall.point(u - 0.20, head + 0.11), wall.point(u - 0.20, head - 0.02, 0.58),
      wall.point(v + 0.20, head - 0.02, 0.58), wall.point(v + 0.20, head + 0.11)]], 0x73483d);
  }
  if (faceIndex === 132) {
    surveyPanel(wall, 0.39, width - 0.40, 0.08, 2.62, 0x69403c, 0.052);
  } else if (low < 1.0 && width >= 1.45 && high > 3) {
    const count = Math.max(1, Math.round(width / 2.05));
    for (let i = 0; i < count; i++) {
      const center = (i + 0.5) * width / count;
      const size = Math.min(width / count - 0.24, 1.24);
      sash(wall, center, size, 0.62, 1.94, richmondFrame);
      if (faceIndex !== 19) sash(wall, center, size * 0.87, 4.95, 1.78, richmondFrame);
    }
  }
  return cream;
}

export const STATIONSWEG_VILLAS = {
  '0228100000057108': { decorate: caIraFacade, finish: caIraGarden },
  '0228100000036785': richmondFacade,
};
