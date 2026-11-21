import * as THREE from 'three/webgpu';
import { mix, mx_noise_float, normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { CivicBatch, polygonNormal } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { HORAPARK_VILLA_SURVEY as villa } from './ede-horapark-villa-survey.js';

const cream = 0xdcd6bb, glass = 0x36434a, timber = 0x383229, tile = 0xa05e43, brick = 0x986b52;

// Bay, gable and opening dimensions are fitted to the listing's exterior photographs.
const openings = {
  0: [[0.52, 0.63, 0.96, 2.47, 1, 2], [0.52, 0.66, 4.24, 5.50, 1, 2]],
  1: [[0.56, 0.94, 0.76, 2.43, 2, 2]],
  2: [[0.50, 3.44, 4.38, 5.53, 4, 2]],
  6: [[0.51, 0.62, 1.15, 2.06, 1, 2]],
  11: [[0.50, 1.86, 0.83, 2.04, 4, 2]],
  13: [[0.53, 1.86, 0.83, 2.04, 4, 2]],
  14: [[0.22, 0.42, 1.35, 1.99, 1, 1], [0.46, 0.46, 1.35, 1.99, 1, 1], [0.77, 1.04, 0.79, 2.45, 2, 3]],
  15: [[0.22, 0.62, 1.23, 1.95, 1, 1], [0.50, 0.62, 1.23, 1.95, 1, 1], [0.78, 0.62, 1.23, 1.95, 1, 1]],
  19: [[0.39, 1.12, 0.85, 2.36, 2, 3], [0.53, 2.12, 4.49, 5.97, 4, 2]],
  22: [[0.52, 0.77, 1.36, 2.01, 1, 1]],
  23: [[0.53, 0.78, 1.34, 2.03, 1, 1]],
  37: [[0.48, 2.23, 0.15, 2.63, 3, 3]],
  45: [[0.45, 0.85, 0.14, 2.24, 1, 3]],
  50: [[0.50, 0.48, 0.93, 2.41, 1, 2], [0.50, 0.49, 4.36, 5.49, 1, 2]],
  55: [[0.41, 0.73, 0.70, 2.19, 2, 2]],
  64: [[0.51, 1.22, 0.72, 2.53, 2, 2]],
  49: [[0.35, 0.71, 1.22, 1.94, 1, 1], [0.77, 0.69, 1.22, 1.94, 1, 1]],
};

function arch(batch, point, width, top, spring, bottom, edge, interior) {
  const ring = (half, lo, shoulder, rise, offset) => [
    point(-half, lo, offset), point(half, lo, offset),
    ...Array.from({ length: 13 }, (_, i) => {
      const a = i * Math.PI / 12;
      return point(half * Math.cos(a), shoulder + rise * Math.sin(a), offset);
    }),
  ];
  batch.polygon([ring(width / 2, bottom, spring, top - spring, 0.045)], edge);
  batch.polygon([ring(width / 2 - 0.061, bottom + 0.06, spring - 0.02, top - spring - 0.04, 0.056)], interior);
  batch.quad(point(-0.045, bottom, 0.063), point(0.045, bottom, 0.063), point(0.045, top - 0.04, 0.063),
    point(-0.045, top - 0.04, 0.063), edge);
}

function decorate(wall) {
  const { faceIndex, width, base, low, high, point, trim } = wall;
  const band = faceIndex === 19 || faceIndex === 14 || faceIndex === 45;
  if (low < base + 0.03 && width > 0.45) {
    surveyPanel(wall, 0, width, base + 0.01, base + 0.35, 0x6f5649, 0.011);
  }
  if (band) {
    const top = Math.min(...wall.rings[0].filter(p => p[1] > base + 0.03).map(p => p[1]));
    surveyPanel(wall, 0, width, base + 2.85, top, timber, 0.017);
    for (let y = base + 2.85; y + 0.04 < top; y += 0.181) {
      surveyPanel(wall, 0, width, y, y + 0.024, 0x241e18, 0.030);
    }
  }
  for (const [fraction, size, sill, head, columns, rows] of openings[faceIndex] ?? []) {
    const center = width * fraction;
    const u = center - size / 2, v = center + size / 2;
    if (surveyWindow(wall, u, v, base + sill, base + head, { frame: cream, color: glass, columns, rows })) {
      surveyPanel(wall, u - 0.03, v + 0.03, base + sill - 0.055, base + sill, 0x776453, 0.064);
    }
  }
  if (faceIndex === 2 || faceIndex === 7) {
    const center = width * (faceIndex === 2 ? 0.50 : 0.48);
    const rise = faceIndex === 2 ? 2.38 : 1.92;
    arch(trim, (u, y, offset) => point(center + u, y, offset),
      faceIndex === 2 ? 1.29 : 2.63, base + rise, base + rise - 0.23, base + 0.07, cream, glass);
  }
  if (faceIndex === 36) {
    surveyWindow(wall, 0.76, 3.11, base + 0.15, base + 2.45, { frame: cream, color: glass, columns: 3, rows: 3 });
  }
  if (faceIndex === 9) {
    // The projecting stair bay is the marker on the north elevation.
    surveyWindow(wall, width * 0.34, width * 0.84, base + 1.87, Math.min(high - 0.3, base + 5.33),
      { frame: cream, color: glass, columns: 2, rows: 4 });
  }
  return brick;
}

function outward(batch, ring, color, direction) {
  if (polygonNormal(ring).dot(direction) < 0) ring.reverse();
  batch.polygon([ring], color);
}

function caps(roof, batch, points) {
  for (let i = 1; i < points.length; i++) {
    const a = new THREE.Vector3(...points[i - 1]), b = new THREE.Vector3(...points[i]);
    const along = b.clone().sub(a), length = along.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize());
    const ox = -along.z * 0.31, oz = along.x * 0.31;
    const ridge = (p, sign) => [p.x + sign * ox, p.y - 0.47, p.z + sign * oz];
    const top = p => [p.x, p.y - 0.025, p.z];
    outward(roof, [ridge(a, -1), top(a), top(b), ridge(b, -1)], 0x71614e, new THREE.Vector3(0, 1, 0));
    outward(roof, [top(a), ridge(a, 1), ridge(b, 1), top(b)], 0x71614e, new THREE.Vector3(0, 1, 0));
    const count = Math.ceil(length / 0.31);
    for (let j = 0; j < count; j++) {
      const p = a.clone().lerp(b, (j + 0.50) / count);
      batch.solid(new THREE.CylinderGeometry(0.155, 0.155, length / count - 0.014, 8)
        .applyQuaternion(rotation).translate(p.x, p.y, p.z), j % 4 === 1 ? 0xb57151 : tile);
    }
  }
}

function dormer(roof, detail, { a, b, sill, top, depth, panes, eyebrow = false, tiledSill = false }) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  // Edges run clockwise as seen from above, so the normal points away from the roof.
  const normal = new THREE.Vector3(-dz / length, 0, dx / length);
  const up = new THREE.Vector3(0, 1, 0);
  const point = (t, y, offset = 0) => [a[0] + dx * t + normal.x * offset, y, a[1] + dz * t + normal.z * offset];
  const strip = (lo, hi, bottom, head, offset, color) => outward(detail, [
    point(lo, bottom, offset), point(hi, bottom, offset), point(hi, head, offset), point(lo, head, offset),
  ], color, normal);
  for (const t of [0, 1]) {
    const cheek = up.clone().cross(normal).multiplyScalar(t === 1 ? 1 : -1);
    outward(detail, [point(t, sill), point(t, top), point(t, top + 0.37, -depth)], timber, cheek);
  }
  strip(0, 1, sill - 0.07, top - (eyebrow ? 0.25 : 0), 0.015, timber);
  if (eyebrow) {
    arch(detail, (u, y, offset) => point(0.5 + u / length, y, offset),
      length * 0.83, top - 0.09, top - 0.31, sill + 0.035, cream, glass);
  } else {
    strip(0.035, 0.965, sill + 0.03, top - 0.055, 0.028, cream);
    strip(0.049, 0.951, sill + 0.085, top - 0.11, 0.039, glass);
    for (let i = 1; i < panes; i++) {
      const t = 0.049 + 0.902 * i / panes;
      strip(t - 0.035 / length, t + 0.035 / length, sill + 0.03, top - 0.055, 0.050, cream);
    }
  }
  if (tiledSill) {
    outward(detail, [point(-0.04, sill - 0.14, 0.17), point(1.04, sill - 0.14, 0.17),
      point(1.04, sill + 0.02), point(-0.04, sill + 0.02)], tile, up);
  }
  if (tiledSill && !eyebrow) {
    outward(roof, [
      point(-0.07, sill - 0.12, 0.15), point(1.07, sill - 0.12, 0.15),
      point(1.12, -0.58, 0.44), point(-0.12, -0.58, 0.44),
    ], 0x756654, up);
    outward(roof, [
      point(-0.12, -0.58, 0.44), point(1.12, -0.58, 0.44),
      point(1.12, -0.79, 0.40), point(-0.12, -0.79, 0.40),
    ], 0x605344, normal);
  }
  const rise = t => eyebrow ? 0.42 * Math.sin(Math.PI * Math.max(0, Math.min(t, 1))) : 0;
  const height = t => top - (eyebrow ? 0.30 : 0) + rise(t);
  for (let i = 0; i < 12; i++) {
    const first = i / 12 * 1.16 - 0.08, last = (i + 1) / 12 * 1.16 - 0.08;
    const near = t => point(t, height(t), 0.11);
    const far = t => point(t, height(t) + depth * 0.64, -depth);
    outward(roof, [near(first), near(last), far(last), far(first)], 0x756654, up);
    outward(roof, [near(first), point(first, height(first) - 0.17, 0.08),
      point(last, height(last) - 0.17, 0.08), near(last)], 0x675a4d, normal);
  }
}

function northPorch(trim) {
  const up = new THREE.Vector3(0, 1, 0), north = new THREE.Vector3(0, 0, -1);
  const [west, east, front, back] = [167.91, 169.28, 2910.52, 2911.65];
  const middle = (west + east) / 2, floor = villa.ground;
  outward(trim, [[east, floor, front], [west, floor, front], [west, -1.00, front],
    [middle, -0.54, front], [east, -1.00, front]], brick, north);
  arch(trim, (u, y, offset) => [middle - u, y, front - offset], 0.96, -1.08, -1.41, floor + 0.09, 0x8d6250, 0x4c342a);
  for (const [side, edge] of [[-1, west], [1, east]]) {
    const n = new THREE.Vector3(side, 0, 0);
    outward(trim, [[edge, floor, back], [edge, floor, front], [edge, -1.00, front], [edge, -0.52, back]], brick, n);
    outward(trim, [[edge + side * 0.12, -0.96, front - 0.10], [middle, -0.49, front - 0.10],
      [middle, 0.41, back], [edge + side * 0.12, -0.49, back]], 0x535c51, up);
  }
}

let masonry;
function createHoraparkVilla(_, site) {
  const roofBatch = new CivicBatch();
  const walls = { ...villa, faces: villa.faces.filter(([roof]) => !roof) };
  for (const [index, [roof, ...rings]] of villa.faces.entries()) {
    if (!roof) continue;
    if (index === 93) {
      walls.faces.push([0, ...rings]);
      continue;
    }
    roofBatch.polygon(rings.map(ring => ring.map(i => villa.points[i])), villa.roofColor);
  }

  return createSurveyLandmark(site, [walls], decorate, ({ group, trim }) => {
    masonry ??= createFacadeSurfaceTexture().texture;
    const across = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
    const joints = texture(masonry, vec2(across.div(1.1), positionWorld.y.div(0.70))).r;
    group.children[0].material.colorNode = vertexColor().mul(mix(0.76, 1.12, joints));

    // Local openings interrupt the thatch instead of sitting on the fascia.
    for (const feature of [
      { a: [162.53, 2919.20], b: [168.67, 2919.13], sill: 0.75, top: 1.65, depth: 1.79, panes: 7, tiledSill: true },
      { a: [174.22, 2918.25], b: [178.35, 2917.04], sill: 0.77, top: 1.68, depth: 1.62, panes: 5, tiledSill: true },
      { a: [166.58, 2912.92], b: [162.08, 2912.98], sill: 1.52, top: 2.32, depth: 1.28, panes: 5 },
      { a: [175.46, 2910.10], b: [171.88, 2911.23], sill: 0.94, top: 1.84, depth: 1.07, panes: 4 },
      { a: [181.32, 2912.93], b: [183.25, 2912.30], sill: 0.12, top: 0.97, depth: 1.14, eyebrow: true, tiledSill: true },
    ]) dormer(roofBatch, trim, feature);

    northPorch(trim);

    const bayPeak = [170.57, 5.01, 2917.99];
    const bayEaves = [[168.22, 2.20, 2919.29], [169.56, 2.33, 2920.27],
      [173.50, 2.23, 2919.63], [173.92, 2.27, 2918.13]];
    for (let i = 1; i < bayEaves.length; i++) {
      const a = bayEaves[i - 1], b = bayEaves[i];
      outward(roofBatch, [a, b, bayPeak], 0x756654, new THREE.Vector3(0, 1, 0));
      roofBatch.quad(b, a, [a[0], a[1] - 0.14, a[2]], [b[0], b[1] - 0.14, b[2]], 0x605344);
    }

    caps(roofBatch, trim, [[161.71, 5.163, 2915.77], [169.94, 5.115, 2915.72], [176.57, 5.02, 2913.54]]);
    caps(roofBatch, trim, [[177.83, 3.45, 2911.84], [181.82, 2.88, 2910.16]]);

    const box = (width, height, depth, [x, y, z], tone) => trim.solid(new THREE.BoxGeometry(width, height, depth)
      .rotateY(0.31).translate(x, y, z), tone);
    box(0.70, 1.60, 0.68, [169.92, 5.24, 2915.65], brick);
    box(0.82, 0.18, 0.80, [169.92, 6.03, 2915.65], 0x65574c);
    box(1.14, 0.20, 0.89, [177.09, 6.33, 2913.42], 0x68574a);
    box(0.32, 0.25, 0.32, [177.27, 6.52, 2913.41], 0x59554c);

    const roof = roofBatch.mesh();
    roof.name = 'Thatched roof';
    // Fine anisotropic grain follows the roof slope, with broader weathered patches.
    const streak = mx_noise_float(vec2(across.mul(46), positionWorld.y.mul(3.8)), 1, 0.5);
    const mottling = mx_noise_float(positionWorld.mul(1.8), 1, 0.5);
    roof.material.colorNode = vertexColor().mul(streak.mul(0.22).add(mottling.mul(0.26)).add(0.75));
    group.add(roof);
  });
}

export const HORAPARK_VILLA_FACTORIES = { 'horapark-villa': createHoraparkVilla };
