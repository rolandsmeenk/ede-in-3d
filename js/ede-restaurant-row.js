import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { EDE_RESTAURANT_ROW_LANDMARKS, RESTAURANT_ROW_SURVEYS } from './ede-restaurant-row-survey.js';

const cream = 0xe1dbcc;
const greyGlass = 0x4d626c;
const cornerGrey = 0x777b77;
const charcoal = 0x252625;
const forest = 0x24453a;
const bistroBlue = 0x1c3376;

function projection(wall, left, right, low, high, inside, outside, color) {
  const { point, trim } = wall;
  const a = point(left, low, outside), b = point(right, low, outside);
  const c = point(right, high, outside), d = point(left, high, outside);
  const e = point(left, low, inside), f = point(right, low, inside);
  const g = point(right, high, inside), h = point(left, high, inside);
  trim.quad(a, b, c, d, color);
  trim.quad(e, h, g, f, color);
  trim.quad(e, a, d, h, color);
  trim.quad(b, f, g, c, color);
  trim.quad(e, f, b, a, color);
  trim.quad(d, c, g, h, color);
}

function window(wall, left, right, low, high, frame, columns = 2, rows = 1, color = greyGlass) {
  return surveyWindow(wall, left, right, low, high, { frame, color, columns, rows });
}

function stripedAwning(wall, left, right, top, depth, first, second = first) {
  const { point, trim } = wall;
  const count = second === first ? 1 : Math.ceil((right - left) / 0.21);
  const fold = depth * 0.48;
  for (let i = 0; i < count; i++) {
    const a = left + (right - left) * i / count;
    const b = left + (right - left) * (i + 1) / count;
    const color = i % 2 ? second : first;
    trim.quad(point(a, top, 0.04), point(a, top - 0.16, fold),
      point(b, top - 0.16, fold), point(b, top, 0.04), color);
    trim.quad(point(a, top - 0.16, fold), point(a, top - 0.54, depth),
      point(b, top - 0.54, depth), point(b, top - 0.16, fold), color);
    trim.quad(point(a, top - 0.67, depth), point(b, top - 0.67, depth),
      point(b, top - 0.54, depth), point(a, top - 0.54, depth), color);
  }
  trim.triangle(point(left, top, 0.04), point(left, top - 0.54, 0.04),
    point(left, top - 0.54, depth), first);
  trim.triangle(point(right, top, 0.04), point(right, top - 0.54, depth),
    point(right, top - 0.54, 0.04), first);
}

function formerGea(wall) {
  const { faceIndex, width, base, high } = wall;
  if ([11, 12, 14, 25, 67].includes(faceIndex)) {
    const groundTop = base + 3.49;
    const left = 0.18, right = width - 0.18;
    surveyPanel(wall, 0, width, base, Math.min(high, groundTop), charcoal, 0.025);
    if (faceIndex === 25) {
      window(wall, left, 1.30, base + 0.12, groundTop - 0.16, cornerGrey, 1, 3);
      window(wall, 1.45, right, base + 0.57, groundTop - 0.16, 0x393b35, 2, 2);
    } else {
      window(wall, left, right, base + 0.61, groundTop - 0.16, cornerGrey,
        faceIndex === 67 ? 3 : 2, 2, 0x3b4948);
    }
    stripedAwning(wall, 0.09, width - 0.09, groundTop + 0.07, 0.79, charcoal);
    if (faceIndex === 67) {
      surveyLabel(wall, width * 0.5 - 1.08, width * 0.5 + 1.08, groundTop + 0.13, groundTop + 0.47,
        'STEAKHOUSE', '#272621', '#dfb6a2');
      for (const u of [0.57, 2.53, 4.37]) {
        window(wall, u, u + 0.95, 2.03, 4.04, cornerGrey);
        projection(wall, u - 0.06, u + 1.01, 1.97, 2.08, 0.02, 0.15, 0x807d74);
      }
    }
    if (faceIndex === 11 || faceIndex === 12 || faceIndex === 14) {
      const deck = Math.min(high, 1.92), y = deck + 1.03;
      projection(wall, 0, width, deck - 0.19, deck, -0.012, 0.12, cornerGrey);
      projection(wall, 0, width, deck + 0.08, deck + 0.12, 0.055, 0.095, charcoal);
      projection(wall, 0, width, y - 0.04, y, 0.04, 0.105, charcoal);
      const count = Math.ceil(width / 0.16);
      for (let i = 0; i <= count; i++) {
        const u = width * i / count;
        projection(wall, u - 0.017, u + 0.017, deck + 0.06, y, 0.055, 0.093, charcoal);
      }
    }
  }
  if (faceIndex === 25 || faceIndex === 52 || faceIndex === 9) {
    const u = width * 0.5;
    window(wall, u - 0.65, u + 0.65, 2.11, Math.min(5.03, high - 0.20), cornerGrey, 2, 3);
    projection(wall, u - 0.70, u + 0.70, 2.05, 2.12, 0.03, 0.16, 0x888781);
  }
  if ([9, 25, 52, 67].includes(faceIndex)) {
    projection(wall, 0, width, high - 0.16, high - 0.05, 0.015, 0.25, cornerGrey);
  }
  if (faceIndex === 58) window(wall, 0.15, width - 0.12, 5.89, 6.93, cornerGrey);
  if ([1, 10, 23, 56].includes(faceIndex)) return charcoal;
}

function continuousWall(wall, a, b, high) {
  const dx = b[0] - a[0], dz = b[1] - a[1], width = Math.hypot(dx, dz);
  const normal = { x: -dz / width, y: 0, z: dx / width };
  const point = (u, y, depth = 0) =>
    [a[0] + dx * u / width + normal.x * depth, y, a[1] + dz * u / width + normal.z * depth];
  return {
    ...wall, a: { x: a[0], z: a[1] }, b: { x: b[0], z: b[1] }, normal, width, point,
    rings: [[point(0, wall.base, 0), point(width, wall.base, 0), point(width, high, 0), point(0, high, 0)]],
  };
}

function oriel(wall, left, right, low, high) {
  const { trim, point } = wall;
  const edges = [[left, 0.045], [left + 0.43, 0.54], [right - 0.43, 0.54], [right, 0.045]];
  for (let i = 1; i < edges.length; i++) {
    const [a, da] = edges[i - 1], [b, db] = edges[i];
    const face = (u, y, shift = 0) => point(a + (b - a) * u, y, da + (db - da) * u + shift);
    trim.quad(face(0, low - 0.13), face(1, low - 0.13), face(1, high + 0.13), face(0, high + 0.13), cream);
    const count = i === 2 ? 3 : 1;
    for (let column = 0; column < count; column++) {
      const from = (column + 0.07) / count, to = (column + 0.93) / count;
      for (const [y, top, color] of [[low, high - 0.53, 0x455960], [high - 0.42, high, 0x53656b]]) {
        trim.quad(face(from, y, 0.017), face(to, y, 0.017), face(to, top, 0.017), face(from, top, 0.017),
          color, 0.78);
      }
    }
  }
  projection(wall, left - 0.05, right + 0.05, high + 0.12, high + 0.19, 0.025, 0.57, cream);
  for (const u of [left + 0.65, right - 0.65]) {
    projection(wall, u - 0.12, u + 0.12, low - 0.39, low - 0.12, 0, 0.34, cream);
  }
}

function shopHouse(wall) {
  const { faceIndex, width, base } = wall;
  if (faceIndex === 6) {
    const middle = width / 2;
    window(wall, middle - 0.81, middle + 0.81, base + 0.79, base + 2.78, cream);
    stripedAwning(wall, middle - 0.89, middle + 0.89, base + 3.08, 0.67, forest, cream);
    window(wall, middle - 0.67, middle + 0.67, 2.54, 4.51, cream);
    stripedAwning(wall, middle - 0.74, middle + 0.74, 4.61, 0.46, forest, cream);
    projection(wall, 0, width + 0.08, 5.35, 5.51, 0, 0.35, cream);
  }
  if (faceIndex !== 7) return;
  const front = continuousWall(wall, [-209.90, 527.60], [-208.80, 522.70], 7.88);
  const w = front.width;
  const left = 0.52, right = w - 0.39;
  window(front, left, left + 1.00, base + 0.12, base + 2.81, cream, 2, 3);
  window(front, left + 1.14, right, base + 0.54, base + 2.81, cream, 3, 2);
  surveyLabel(front, left + 0.30, right - 0.23, base + 3.17, base + 3.44, 'RISTORANTE', '#24453a', '#f0e8d6');
  stripedAwning(front, left - 0.08, right + 0.09, base + 3.14, 0.82, forest, cream);
  oriel(front, 0.64, w - 0.54, 2.10, 4.21);
  window(front, w * 0.5 - 0.40, w * 0.5 + 0.40, 5.83, 6.82, cream, 2, 3);
  const peak = Math.hypot(0.53, 2.34);
  for (const [end, y] of [[0, 5.39], [w, 5.2]]) {
    const p = front.point;
    const [a, b] = [[end, y - 0.02], [peak, 7.78]].sort(([u], [v]) => u - v);
    front.trim.quad(p(...a, 0.38), p(...b, 0.38),
      p(b[0], b[1] + 0.18, 0.38), p(a[0], a[1] + 0.18, 0.38), cream);
    front.trim.quad(p(...a, 0.38), p(...a, 0.02), p(...b, 0.02), p(...b, 0.38), cream);
    for (let step = 0; step < 5; step++) {
      const u = end + (peak - end) * (0.095 + step * 0.142);
      const top = y + 0.08 + step * 0.33;
      projection(front, u - 0.15, u + 0.15, top - 0.11, top, 0.02, 0.10, 0x5e3b32);
    }
  }
}

function blueBistro(wall) {
  const { faceIndex, width, base } = wall;
  if (faceIndex !== 0 && faceIndex !== 4) return;
  const front = faceIndex === 0;
  const beam = base + (front ? 3.45 : 3.18);
  surveyPanel(wall, 0, width, base, beam, bistroBlue, 0.027);
  projection(wall, 0, width, beam - 0.13, beam + 0.07, 0, 0.20, 0x1e2a56);
  const openings = front
    ? [[0.30, 1.52, 0.14, 2], [1.77, 4.35, 0.57, 4], [4.59, 7.14, 0.57, 4], [7.44, width - 0.24, 0.14, 2]]
    : [[0.28, width - 0.23, 0.16, 2]];
  for (const [left, right, sill, columns] of openings) {
    const frame = 0x2c478f;
    window(wall, left, right, base + sill, beam - 0.94, frame, columns, 3, 0x384961);
    window(wall, left, right, beam - 0.86, beam - 0.25, frame, columns, 1, 0x58626e);
    projection(wall, left - 0.06, right + 0.06, base + sill - 0.08, base + sill, 0.026, 0.14, bistroBlue);
  }
  if (!front) return;
  for (const u of [0.0, width - 1.16]) {
    projection(wall, u, u + 1.16, beam + 0.07, 4.96, 0.004, 0.19, 0x665d56);
    projection(wall, u - 0.04, u + 1.20, 4.93, 5.05, 0.006, 0.24, 0x544e49);
  }
  const left = 1.40, right = width - 1.38, bay = (right - left) / 4;
  for (let i = 0; i < 4; i++) {
    const u = left + i * bay;
    window(wall, u, u + bay - 0.08, 2.52, 4.52, cream, 2, 4);
  }
  projection(wall, left - 0.13, right + 0.13, 4.59, 4.79, 0, 0.34, cream);
  surveyLabel(wall, width - 1.74, width - 0.15, beam - 0.92, beam - 0.33, 'BISTRO', '#1c3376', '#ece6cc');
}

const details = {
  '0228100000003228': formerGea,
  '0228100000042576': shopHouse,
  '0228100000052503': blueBistro,
};

export const EDE_RESTAURANT_ROW_BUILDERS = {
  'stationsweg-restaurant-row': (_footprints, site = EDE_RESTAURANT_ROW_LANDMARKS[0]) =>
    createSurveyLandmark(site, site.bagIds.map(id => RESTAURANT_ROW_SURVEYS[id]),
      wall => details[wall.building.bagId](wall)),
};
