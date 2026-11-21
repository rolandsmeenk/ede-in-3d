import { BoxGeometry, CylinderGeometry } from 'three/webgpu';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { POMPHUIS_SHELL } from './ede-pomphuis-survey.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const white = 0xe0dfd4, frame = 0xd7cdb6, glass = 0x333d41;
const clinker = 0x514237, roof = 0x3d3b39, plinth = 0x716b60;
const curvedBayFaces = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 25, 35, 41, 42]);

function renderWall(wall) {
  const { faceIndex, width, low, high, base } = wall;
  if (low <= base + 0.03) surveyPanel(wall, 0, width, base, base + 0.44, plinth, 0.012);
  if (curvedBayFaces.has(faceIndex)) {
    const mullion = [5, 10, 15, 41].includes(faceIndex);
    surveyPanel(wall, 0, width, 3.61, 4.96, frame, 0.033);
    if (!mullion) {
      surveyPanel(wall, 0, width, 3.67, 4.18, glass, 0.048, 0.65);
      surveyPanel(wall, 0, width, 4.23, 4.90, glass, 0.048, 0.65);
    }
    surveyPanel(wall, 0, width, 3.53, 3.62, clinker, 0.060);
    surveyPanel(wall, 0, width, 5.02, high + 0.02, roof, 0.077);
  }
  if (faceIndex === 47) {
    for (const f of [0.17, 0.48, 0.79]) {
      surveyWindow(wall, width * f, width * (f + 0.20), 3.48, 5.22, { frame, color: glass, rows: 4 });
    }
  }
  if ([29, 34, 62].includes(faceIndex)) {
    const spans = faceIndex === 62 ? [0.22, 0.50, 0.78] : [0.20, 0.46, 0.71, 0.88];
    for (const f of spans) {
      const gardenDoor = faceIndex === 62 && f === 0.50;
      surveyWindow(wall, width * f - 0.7, width * f + 0.7, gardenDoor ? 2.78 : 3.44,
        Math.min(4.93, high - 0.25), { frame, color: glass, columns: 2, rows: 3 });
    }
  }
}

function facadeLine(trim, labels, [ax, az], [bx, bz]) {
  const width = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / width, uz = (bz - az) / width;
  const normal = { x: -uz, z: ux };
  const point = (u, y, depth = 0) => [ax + u * ux + normal.x * depth, y, az + u * uz + normal.z * depth];
  return { trim, labels, width, normal, point, a: { x: ax, z: az }, b: { x: bx, z: bz } };
}

function gable(wall, crown, tablet, bays) {
  const { trim, point, width } = wall;
  const middle = width / 2, shoulder = crown - 0.76;
  const edge = [[0, shoulder], [0.27, shoulder], [middle - 0.52, crown - 0.07], [middle - 0.52, crown + 0.60],
    [middle + 0.52, crown + 0.60], [middle + 0.52, crown - 0.07],
    [width - 0.27, shoulder], [width, shoulder]];
  for (let i = 1; i < edge.length; i++) {
    const [a, lo] = edge[i - 1], [b, hi] = edge[i];
    if (b > a) trim.quad(point(a, 6.36, 0.056), point(b, 6.36, 0.056),
      point(b, hi - 0.15, 0.056), point(a, lo - 0.15, 0.056), white);
    trim.quad(point(a, lo - 0.19, 0.087), point(b, hi - 0.19, 0.087),
      point(b, hi, 0.087), point(a, lo, 0.087), clinker);
  }
  for (const u of [0, width - 0.48]) {
    for (let i = 0; i < 6; i++) {
      const step = i * 0.065;
      const offset = u === 0 ? step : -step;
      surveyPanel(wall, Math.max(0, u + offset), Math.min(width, u + offset + 0.48),
        shoulder - 0.64 + i * 0.09, shoulder - 0.55 + i * 0.09, white, 0.11 + i * 0.015);
    }
  }
  surveyPanel(wall, middle - 0.52, middle + 0.52, crown - 0.06, crown + 0.60, clinker, 0.09);
  surveyLabel(wall, middle - 0.45, middle + 0.45, crown + 0.02, crown + 0.49, tablet, '#e6e3d7', '#272526');
  for (const [u, v] of bays) {
    surveyPanel(wall, u, v, 3.98, 5.31, frame, 0.035);
    surveyPanel(wall, u + 0.06, v - 0.06, 4.04, 5.25, glass, 0.051, 0.65);
    surveyPanel(wall, (u + v) / 2 - 0.026, (u + v) / 2 + 0.026, 4.04, 5.25, frame, 0.060);
    surveyPanel(wall, u, v, 4.55, 4.59, frame, 0.060);
    surveyPanel(wall, u - 0.065, v + 0.065, 3.91, 3.99, clinker, 0.082);
  }
}

function windowAwning(wall, center, half, rise) {
  const { trim, point } = wall;
  const steps = 12, low = 4.89;
  const arc = (i, depth, height) => {
    const t = i * Math.PI / steps;
    return point(center - half * Math.cos(t), low + height * Math.sin(t), depth * Math.sin(t));
  };
  for (let i = 0; i < steps; i++) {
    trim.quad(arc(i, 0.90, 0.11), arc(i + 1, 0.90, 0.11),
      arc(i + 1, 0.05, rise), arc(i, 0.05, rise), roof);
    trim.quad(arc(i, 0.90, -0.12), arc(i + 1, 0.90, -0.12),
      arc(i + 1, 0.90, 0.11), arc(i, 0.90, 0.11), 0x282827);
  }
}

function porch(wall) {
  const { trim, point, width } = wall;
  const near = 5.03, high = 5.59, depth = 0.97;
  trim.quad(point(0, near, depth), point(width, near, depth), point(width, high), point(0, high), roof);
  surveyPanel(wall, 0, width, near - 0.1, near, roof, depth);
  surveyPanel(wall, 0.45, 1.51, 2.81, 4.70, 0x262c2b, 0.10);
  surveyPanel(wall, 0.55, 1.39, 3.69, 4.58, glass, 0.114, 0.65);
  surveyPanel(wall, 0.95, 0.99, 3.69, 4.58, frame, 0.121);
  for (const u of [0.13, width - 0.13]) {
    const [x, , z] = point(u, near, depth - 0.12);
    trim.solid(new BoxGeometry(0.13, near - 2.77, 0.13).translate(x, (near + 2.77) / 2, z), roof);
  }
}

function insetArch(wall) {
  const { trim, point, width } = wall;
  const spring = 4.39, lo = spring - 0.97, radius = width * 0.39, middle = width / 2;
  const arc = (i, depth) => {
    const t = i * Math.PI / 12;
    return point(middle - Math.cos(t) * radius, spring + Math.sin(t) * 0.74, depth);
  };
  for (let i = 0; i < 12; i++) {
    const a = arc(i, 0.37), b = arc(i + 1, 0.37);
    trim.quad(a, b, [b[0], 5.49, b[2]], [a[0], 5.49, a[2]], white);
    trim.quad(arc(i + 1, 0.035), arc(i, 0.035), a, b, 0xb6b2a5);
  }
  surveyPanel(wall, 0, middle - radius, lo, 5.49, white, 0.37);
  surveyPanel(wall, middle + radius, width, lo, 5.49, white, 0.37);
}

function garden(trim) {
  const ground = (x, z) => getTerrain() ? terrainHeightAt(x, z) : POMPHUIS_SHELL.ground;
  const corner = (x, z) => [x, ground(x, z) + 0.035, z];
  trim.quad(corner(41.3, 671.5), corner(41.3, 684.9), corner(51.9, 684.9), corner(51.9, 671.5), 0x979184);
  for (const [x, z, sx, sz] of [[51.7, 678.2, 0.38, 13.2], [46.5, 684.9, 10.5, 0.38]]) {
    trim.solid(new BoxGeometry(sx, 0.90, sz).translate(x, ground(x, z) + 0.43, z), 0x3d4b29);
  }
  for (const [x, z] of [[43.1, 674.4], [47.9, 675.0], [43.4, 680.9], [48.0, 681.9]]) {
    const y = ground(x, z);
    trim.solid(new CylinderGeometry(0.55, 0.55, 0.065, 10).translate(x, y + 0.76, z), 0x836b53);
    trim.solid(new CylinderGeometry(0.055, 0.055, 0.76, 6).translate(x, y + 0.38, z), 0x494540);
    for (const side of [-1, 1]) {
      const cx = x + side * 0.79;
      trim.solid(new BoxGeometry(0.42, 0.065, 0.41).translate(cx, y + 0.46, z), 0x8b6747);
      trim.solid(new BoxGeometry(0.052, 0.37, 0.41).translate(cx + side * 0.19, y + 0.67, z), 0x8b6747);
    }
    if (x < 45) {
      trim.solid(new CylinderGeometry(0.026, 0.026, 2.40, 6).translate(x, y + 1.2, z), 0x676259);
      trim.solid(new CylinderGeometry(0.05, 1.35, 0.33, 8).translate(x, y + 2.32, z), 0xe0d8c4);
    }
  }
}

export function createPomphuis(_footprints, site) {
  return createSurveyLandmark(site, [POMPHUIS_SHELL], renderWall, ({ trim, labels }) => {
    const north = facadeLine(trim, labels, [21.56, 666.17], [20.43, 670.47]);
    const south = facadeLine(trim, labels, [19.58, 673.76], [18.26, 678.69]);
    gable(north, 7.37, 'GW', [[0.42, 1.25], [1.71, 2.54], [3.02, 3.85]]);
    gable(south, 7.30, '1915', [[0.79, 2.15]]);
    windowAwning(north, north.width / 2, 1.68, 0.93);
    windowAwning(south, 1.45, 0.80, 0.62);
    insetArch(facadeLine(trim, labels, [21.60, 670.77], [20.62, 674.22]));
    porch(facadeLine(trim, labels, [20.30, 680.00], [20.11, 682.25]));
    garden(trim);
  });
}
