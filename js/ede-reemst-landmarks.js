import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { REEMST_BUILDINGS, REEMST_SCREEN } from './ede-reemst-landmark-survey.js';
import { terrainHeightAt } from './terrain.js';

const CREAM = 0xd1c7a8, GREEN = 0x22382b, GLASS = 0x344953, TIMBER = 0x514436;

function beam(batch, [ax, ay, az], [bx, by, bz], thickness, depth, color) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const delta = b.clone().sub(a);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), delta.clone().normalize());
  const center = a.addScaledVector(delta, 0.5);
  batch.solid(new THREE.BoxGeometry(delta.length(), thickness, depth)
    .applyQuaternion(rotation).translate(center.x, center.y, center.z), color);
}

function archedFrame(batch, point, width, base, straight, rise, frame, inset) {
  const shape = (w, floor, shoulder, crown, lift) => [
    point(-w / 2, floor, lift), point(w / 2, floor, lift),
    ...Array.from({ length: 11 }, (_, i) => {
      const angle = Math.PI * i / 10;
      return point(Math.cos(angle) * w / 2, shoulder + Math.sin(angle) * crown, lift);
    }),
  ].reverse();
  batch.polygon([shape(width, base, straight, rise, 0.04)], frame);
  batch.polygon([shape(width - 0.12, base + 0.06, straight - 0.035, rise - 0.035, 0.055)], inset);
}

function houseWall(wall) {
  const { normal, buildingIndex, width, base, high, low } = wall;
  if (low > base + 0.06 || width < 1.2) return;
  if (buildingIndex === 1) {
    const highEnough = high > base + 3.2;
    if (normal.z > 0.56 && highEnough) {
      const middle = width / 2;
      surveyPanel(wall, 0.06, width - 0.06, base + 0.12, base + 0.65, 0x75523a);
      surveyPanel(wall, middle - 0.78, middle + 0.78, base + 0.04, base + 2.23, 0x302b22);
      for (const hinge of [0.52, 1.72]) {
        surveyPanel(wall, middle - 0.72, middle - 0.39, base + hinge, base + hinge + 0.06, 0x837d65, 0.055);
        surveyPanel(wall, middle + 0.39, middle + 0.72, base + hinge, base + hinge + 0.06, 0x837d65, 0.055);
      }
    }
    for (let y = base + 0.66; y < Math.min(high - 0.14, base + 2.05); y += 0.19) {
      surveyPanel(wall, 0.05, width - 0.05, y, y + 0.026, 0x524030, 0.028);
    }
    return;
  }
  if (normal.x > 0.7 && width > 10) {
    const center = fraction => wall.a.z > wall.b.z ? fraction * width : (1 - fraction) * width;
    for (const [fraction, w, sill, h] of [[0.15, 0.96, 0.86, 1.03], [0.49, 0.95, 0.86, 1],
      [0.76, 0.78, 0.93, 0.59], [0.91, 0.71, 0.93, 0.59]]) {
      const u = center(fraction);
      surveyWindow(wall, u - w / 2, u + w / 2, base + sill, base + sill + h,
        { frame: CREAM, color: GLASS, columns: 2, rows: 2 });
      surveyPanel(wall, u - w / 2 - 0.04, u + w / 2 + 0.04, base + sill - 0.06, base + sill, 0x8c8777, 0.08);
    }
    const door = center(0.35);
    surveyPanel(wall, door - 0.53, door + 0.53, base + 0.15, base + 2.18, CREAM);
    surveyPanel(wall, door - 0.44, door + 0.44, base + 0.2, base + 2.09, GREEN, 0.055);
    surveyPanel(wall, door - 0.31, door + 0.31, base + 1.36, base + 2.01, GLASS, 0.071, 0.75);
    return;
  }
  if (normal.z > 0.65 && width > 2.5) {
    const u = width / 2;
    surveyWindow(wall, u - 0.39, u + 0.39, base + 0.8, base + 1.91,
      { frame: CREAM, color: GLASS, columns: 2, rows: 2 });
    if (high > base + 4.9) surveyWindow(wall, u - 0.41, u + 0.41, base + 3.17, base + 4.23,
      { frame: CREAM, color: GLASS, columns: 2 });
  }
}

function farmhouse(_, site) {
  return createSurveyLandmark(site, REEMST_BUILDINGS, houseWall, ({ trim }) => {
    const porch = (u, y, offset) => [7029.8 + 0.986 * u, y, 71.09 - 0.169 * u - offset];
    archedFrame(trim, porch, 2.18, 13.25, 15.20, 0.36, CREAM, GLASS);
    archedFrame(trim, (u, y, offset) => porch(u, y + 3.14, offset), 1.25, 13.3, 14.41, 0.22, CREAM, GLASS);
    // Dark board shutters frame the patio doors and the arched upper window.
    for (const [left, right, lo, hi] of [[-1.77, -1.10, 13.25, 15.4], [1.10, 1.77, 13.25, 15.4],
      [-1.13, -0.64, 16.44, 17.80], [0.64, 1.13, 16.44, 17.80]]) {
      trim.quad(porch(right, lo, 0.08), porch(left, lo, 0.08), porch(left, hi, 0.08), porch(right, hi, 0.08), 0x373028);
    }
    // The shallow eyebrow in the east thatch is below the surveyed ridge.
    const eyebrow = (u, y, offset) => [7033.9 + offset, y, 76.0 + u];
    archedFrame(trim, eyebrow, 1.92, 17.69, 17.79, 0.61, CREAM, GLASS);
    for (let i = 0; i < 10; i++) {
      const t = Math.PI * i / 10, n = Math.PI * (i + 1) / 10;
      const edge = angle => [7033.99, 17.77 + Math.sin(angle) * 0.77, 76 + Math.cos(angle) * 1.08];
      trim.triangle(edge(t), edge(n), [7032.14, 19.07, 76], 0x665c4e);
    }
    beam(trim, [7029.59, 20.54, 71.12], [7031.89, 20.52, 82], 0.14, 0.20, 0x864c38);
    trim.solid(new THREE.BoxGeometry(0.63, 0.87, 0.64).translate(7031.09, 20.43, 72.95), 0x79584b);
  });
}

function wildlifeScreen(_, site) {
  const batch = new CivicBatch(), colliders = [];
  const point = ([x, z], lift = 0) => [x, terrainHeightAt(x, z) + lift, z];
  const { fence, stairs, benches } = REEMST_SCREEN;
  for (let i = 1; i < fence.length; i++) {
    const a = fence[i - 1], b = fence[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const panels = Math.ceil(length / 2.15);
    for (let j = 0; j < panels; j++) {
      const first = j / panels, last = (j + 1) / panels;
      const left = along(first), right = along(last);
      beam(batch, point(left, 0.54), point(right, 0.54), 1.08, 0.11, TIMBER);
      beam(batch, point(left, 1.54), point(right, 1.54), 0.26, 0.11, 0x554637);
      const post = point(left, 0.82);
      batch.solid(new THREE.BoxGeometry(0.13, 1.8, 0.13).translate(...post), 0x3a3026);
      if (j === panels - 1 && i === fence.length - 1) {
        batch.solid(new THREE.BoxGeometry(0.13, 1.8, 0.13).translate(...point(right, 0.82)), 0x3a3026);
      }
    }
    colliders.push(...wallColliders({ x: a[0], z: a[1] }, { x: b[0], z: b[1] },
      Math.min(point(a)[1], point(b)[1]) - 0.12, Math.max(point(a)[1], point(b)[1]) + 1.7, 0.15));
  }
  for (const [x, z] of benches) {
    const y = terrainHeightAt(x, z);
    batch.solid(new THREE.BoxGeometry(1.45, 0.095, 0.39).rotateY(-0.23).translate(x, y + 0.47, z), TIMBER);
    for (const end of [-1, 1]) {
      batch.solid(new THREE.BoxGeometry(0.15, 0.46, 0.26)
        .translate(x + end * 0.53, y + 0.23, z + end * 0.12), 0x43392d);
    }
  }

  const [[ax, az], [bx, bz]] = stairs;
  const length = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / length, uz = (bz - az) / length;
  const rise = (x, z) => THREE.MathUtils.clamp((x - ax) * ux + (z - az) * uz, 0, length) / length;
  const startY = terrainHeightAt(ax, az), endY = terrainHeightAt(bx, bz);
  const height = (x, z) => Math.max(terrainHeightAt(x, z) + 0.035,
    THREE.MathUtils.lerp(startY, endY, Math.ceil(rise(x, z) * 7) / 7) + 0.035);
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7, x = THREE.MathUtils.lerp(ax, bx, t), z = THREE.MathUtils.lerp(az, bz, t);
    batch.solid(new THREE.BoxGeometry(length / 7 + 0.015, 0.13, 1.32)
      .rotateY(-Math.atan2(uz, ux)).translate(x, height(x, z) - 0.065, z), 0x6a5841);
  }
  const edge = (x, z, side) => ({ x: x - side * uz * 0.66, z: z + side * ux * 0.66 });
  const lowerRail = edge(ax, az, -1), upperRail = edge(bx, bz, -1);
  beam(batch, point([lowerRail.x, lowerRail.z], 0.88), point([upperRail.x, upperRail.z], 0.88), 0.1, 0.11, TIMBER);
  for (const { x, z } of [lowerRail, upperRail]) {
    batch.solid(new THREE.BoxGeometry(0.1, 1.03, 0.1).translate(x, terrainHeightAt(x, z) + 0.42, z), TIMBER);
  }

  const group = makeGroup(site.name, batch, colliders);
  group.userData.platforms = [{ id: site.id + '-steps', outer: [lowerRail, upperRail, edge(bx, bz, 1), edge(ax, az, 1)], holes: [], height }];
  return group;
}

export const REEMST_LANDMARK_FACTORIES = {
  'nieuw-reemst': farmhouse,
  'wildkijkscherm-nieuw-reemst': wildlifeScreen,
};
