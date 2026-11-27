import * as THREE from 'three/webgpu';
import { CivicBatch, along, makeGroup, polygonNormal, wallColliders } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { LUNTEREN_STRUCTURES as structures, LUNTEREN_SURVEYS as surveys } from './ede-lunteren-survey.js';
import { EDE_NORTH_RAIL } from './ede-north-rail-data.js';
import { addWindmillSailcloth, createWindmillRig } from './ede-windmill.js';
import { terrainHeightAt } from './terrain.js';
import { addClockDetails, clockFace } from './ede-clock-model.js';

const cream = 0xd0c6ad;
const zinc = 0x50585c;
const darkGlass = 0x3b4c52;
const pine = 0x314039;

function box(batch, x, y, z, w, h, d, color, angle = 0) {
  batch.solid(new THREE.BoxGeometry(w, h, d).rotateY(angle).translate(x, y, z), color);
}

function beam(batch, a, b, width, color, depth = width) {
  const direction = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const size = direction.length();
  if (size < 0.01) return;
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.divideScalar(size));
  batch.solid(new THREE.BoxGeometry(width, size, depth).applyQuaternion(rotation)
    .translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), color);
}

function point([x, z], y) {
  return [x, y, z];
}

function elevationRing(ring, height) {
  return ring.map(({ x, z }) => [x, height, z]);
}

function roof(batch, ring, color) {
  batch.polygon([polygonNormal(ring).y < 0 ? [...ring].reverse() : ring], color);
}

function trimLine(wall, u, y, v, top, size, color, depth = 0.083) {
  beam(wall.trim, wall.point(u, y, depth), wall.point(v, top, depth), size, color, size * 0.55);
}

function opening(wall, center, width, bottom, top, options = {}) {
  const { base } = wall;
  const a = center - width / 2, b = center + width / 2, lo = base + bottom, hi = base + top;
  if (!surveyWindow(wall, a, b, lo, hi, options)) return false;
  if (bottom > 0.34) surveyPanel(wall, a - 0.04, b + 0.04, lo - 0.11, lo - 0.015, options.frame ?? cream, 0.088);
  return true;
}

function arches(wall, center, width, bottom, top, frame, glazing = darkGlass, pointed = false) {
  const radius = width / 2, spring = top - radius * (pointed ? 1.24 : 0.87);
  if (!opening(wall, center, width, bottom, spring + 0.03, { color: glazing, frame, columns: 2, rows: 2 })
      || !surveyOpeningFits(wall, center - radius * 0.5, center + radius * 0.5, wall.base + spring, wall.base + top)) return;
  const archRing = (r, h, depth) => {
    const out = [wall.point(center - r, wall.base + spring, depth), wall.point(center + r, wall.base + spring, depth)];
    for (let i = 1; i < 10; i++) {
      const angle = i * Math.PI / 10;
      out.push(wall.point(center + Math.cos(angle) * r,
        wall.base + spring + Math.sin(angle) ** (pointed ? 1.8 : 1) * h, depth));
    }
    return out;
  };
  const rise = top - spring;
  wall.trim.polygon([archRing(radius, rise, 0.046)], frame);
  wall.trim.polygon([archRing(radius - 0.068, rise - 0.065, 0.057)], glazing);
  trimLine(wall, center, wall.base + spring, center, wall.base + top - 0.07, 0.034, frame);
}

function windowRows(wall, spacing, rows, style, skip = []) {
  const count = Math.max(1, Math.round(wall.width / spacing));
  for (let i = 0; i < count; i++) {
    const center = wall.width * (i + 0.5) / count;
    if (skip.some(pos => Math.abs(center - pos) < 1.12)) continue;
    for (const [width, lo, hi] of rows) opening(wall, center, Math.min(width, wall.width / count * 0.73), lo, hi, style);
  }
}

function stationWall(wall) {
  const { base, high, low, normal, width, faceIndex } = wall;
  if (low > base + 0.10 || width < 1.25) return;
  const wing = high < base + 7;
  const door = width * 0.5;
  const creamStone = 0xb89c7b;
  for (const y of [0.49, 1.12, 3.35, 4.52]) {
    if (surveyOpeningFits(wall, 0.08, width - 0.08, base + y - 0.085, base + y + 0.085)) {
      surveyPanel(wall, 0.06, width - 0.06, base + y - 0.031, base + y + 0.031, 0xb09473);
    }
  }
  const count = Math.max(1, Math.round(width / (wing ? 3.45 : 2.85)));
  for (let i = 0; i < count; i++) {
    const center = width * (i + 0.5) / count;
    if (faceIndex !== 13) {
      const doorway = (faceIndex === 8 && i % 2 === 1) || ([26, 28].includes(faceIndex) && normal.x < 0);
      arches(wall, center, Math.min(doorway ? 1.30 : 1.46, width / count * 0.70),
        doorway ? 0.10 : 0.95, doorway ? 2.96 : 3.04, creamStone, doorway ? pine : darkGlass);
    }
    if (!wing) arches(wall, center, Math.min(1.20, width * 0.63 / count), 5.02, 7.57, creamStone);
  }
  if (faceIndex === 8) surveyLabel(wall, door - 1.7, door + 1.7, base + 4.26, base + 4.64, 'Lunteren', '#173a73', '#ffffff');
}

function stationCanopy({ group, colliders, labels, trim }) {
  const { stationCanopy: ring } = structures;
  const canopy = new CivicBatch();
  const [a, b] = ring.map(([x, z]) => ({ x, z }));
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const side = [(b.z - a.z) / length, -(b.x - a.x) / length];
  const [[sx, sz, low], [tx, tz, high]] = EDE_NORTH_RAIL.platforms.find(p => p.number === '1').slope;
  const platformHeight = ([x, z]) => {
    const t = THREE.MathUtils.clamp(((x - sx) * (tx - sx) + (z - sz) * (tz - sz))
      / ((tx - sx) ** 2 + (tz - sz) ** 2), 0, 1);
    return THREE.MathUtils.lerp(low, high, t);
  };
  const outerEave = platformHeight(ring[0]) + 2.87;
  const eave = ([x, z]) => outerEave - ((x - a.x) * side[0] + (z - a.z) * side[1]) * 0.17;
  roof(canopy, ring.map(p => point(p, eave(p))), zinc);
  for (const [i, p] of ring.entries()) {
    const q = ring[(i + 1) % ring.length];
    beam(canopy, point(p, eave(p) - 0.10), point(q, eave(q) - 0.10), 0.16, cream);
  }
  for (let i = 0; i < 7; i++) {
    const p = along(a, b, (i + 0.42) / 7);
    const column = [p.x - side[0] * 0.27, p.z - side[1] * 0.27];
    const platform = platformHeight(column);
    const bottom = point(column, platform - 0.04), top = point(column, eave(column) - 0.12);
    beam(canopy, bottom, top, 0.19, pine);
    colliders.push({
      minX: bottom[0] - 0.095, maxX: bottom[0] + 0.095,
      minZ: bottom[2] - 0.095, maxZ: bottom[2] + 0.095,
      minY: platform - 0.04, maxY: top[1],
    });
    for (const dir of [-1, 1]) {
      const strut = [column[0] - dir * side[1] * 0.79, column[1] + dir * side[0] * 0.79];
      beam(trim, point(column, top[1] - 0.75), point(strut, eave(strut) - 0.10), 0.09, pine);
    }
    const back = [column[0] - side[0] * 3.14, column[1] - side[1] * 3.14];
    beam(trim, point(column, top[1]), point(back, eave(back) - 0.12), 0.11, pine);
  }
  const signA = along(a, b, 0.15), signB = along(a, b, 0.23);
  labels.push({ text: 'Lunteren', a: signB, b: signA, lo: outerEave - 0.55, hi: outerEave - 0.23,
    color: '#194081', textColor: '#ffffff' });
  group.add(canopy.mesh());
  group.userData.treeClearance = [outlineCollider(ring.map(([x, z]) => ({ x, z })), platformHeight(ring[0]) - 0.2, outerEave)];
}

function churchWall(wall) {
  const { a, b, base, high, low, normal, width } = wall;
  const height = high - base, center = width * 0.5;
  if (height > 18 && width > 2.5 && (a.x + b.x) / 2 < -3423) {
    for (const y of [4.15, 9.76, 15.45]) {
      if (surveyOpeningFits(wall, 0.08, width - 0.08, base + y - 0.08, base + y + 0.08))
        surveyPanel(wall, 0.01, width - 0.01, base + y - 0.08, base + y + 0.08, 0x9a9385, 0.10);
    }
    arches(wall, center, Math.min(1.55, width * 0.68), 10.15, 14.48, 0x9a735d, 0x413c38, true);
    if (normal.x < -0.72) arches(wall, center, 1.48, 0.12, 3.35, 0x8d7967, 0x3a322b, true);
    else arches(wall, center, 1.18, 0.82, 3.42, 0xa99b87, darkGlass, true);
    return 0x896d5e;
  }
  if (low > base + 0.07 || height < 4.6 || height > 8.5 || width < 2.5) return;
  const count = width > 7.1 ? 2 : 1;
  for (let i = 0; i < count; i++) arches(wall, width * (i + 0.5) / count,
    Math.min(1.64, width / count * 0.64), 1.30, Math.min(5.40, height - 0.29), 0xa79a84, 0x465458, true);
}

function churchDetails({ group, trim }) {
  // The survey tower shell stops near the slate spire base. The original photographs show
  // the narrow spire and clocks on the lower roof slope, above the square brick tower.
  const cone = new CivicBatch();
  const x = -3427.53, z = -4206.75, y = 12.48, top = 30.98;
  const baseRadius = 3.49, tipRadius = 0.04;
  cone.solid(new THREE.CylinderGeometry(tipRadius, baseRadius, top - y, 8).rotateY(Math.PI / 8)
    .translate(x, (y + top) / 2, z), 0x4d555c);
  group.add(cone.mesh());
  const clocks = [];
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const onDial = (side, height, reveal) => {
      const localY = 2.33 + height;
      const radius = THREE.MathUtils.lerp(baseRadius, tipRadius, localY / (top - y)) * Math.cos(Math.PI / 8) + reveal;
      return [x + dx * radius + dz * side, y + localY, z + dz * radius - dx * side];
    };
    const clockPoint = (i, steps, length, reveal) => {
      const angle = i * 2 * Math.PI / steps;
      return onDial(Math.sin(angle) * length, Math.cos(angle) * length, reveal);
    };
    trim.polygon([Array.from({ length: 16 }, (_, i) => clockPoint(15 - i, 16, 0.71, 0.03))], 0x414850);
    clocks.push(clockFace((u, h, d) => onDial(u, h, 0.088 + d), 0.70, 0xcbb67f));
  }
  addClockDetails(group, clocks);
  trim.solid(new THREE.SphereGeometry(0.123, 8, 6).translate(x, top + 0.05, z), 0xc3a36d);
  beam(trim, [x, top, z], [x, top + 0.81, z], 0.051, 0x464642);
  beam(trim, [x - 0.16, top + 0.63, z], [x + 0.16, top + 0.63, z], 0.044, 0x464642);
}

function museumWall(wall) {
  const { base, high, low, normal, width, faceIndex } = wall;
  if (low > base + 0.09 || width < 1.25 || normal.x < 0.65) return;
  const height = high - base;
  const north = (wall.a.z + wall.b.z) * 0.5 < -4228.4;
  if ([2, 40].includes(faceIndex)) {
    surveyPanel(wall, 0.05, width - 0.05, base + 0.04, base + 7.51, 0x282b2c);
    for (const [bottom, top] of [[0.17, 2.87], [3.39, 7.34]])
      opening(wall, width / 2, width - 0.26, bottom, top, { color: 0x68818b, frame: 0x292d2e });
    if (faceIndex === 40)
      surveyLabel(wall, 0.11, width - 0.11, base + 2.94, base + 3.36, 'MUSEUM LUNTEREN', '#302c2a', '#f3eee0');
    return 0x373235;
  }
  windowRows(wall, 1.85, [[1.18, 0.46, 2.42], [0.67, 3.86, 5.94]], { frame: cream, columns: 2, rows: 2 });
  if (height > 6.3 && !north) {
    surveyPanel(wall, 0.15, width - 0.15, base + 2.66, base + 2.79, cream, 0.060);
  }
}

function koepelWall(wall) {
  const { base, low, high, normal, width } = wall;
  if (width < 1.6 || high < base + 18 || low > base + 0.19) return;
  for (const y of [3.9, 7.45, 11.05, 14.5, 18.9]) {
    const band = y > 14 ? 0x6b5442 : 0x9e7862;
    surveyPanel(wall, 0.04, width - 0.04, base + y, base + y + 0.16, band, 0.086);
  }
  const entry = normal.x > 0.90 && wall.a.z > -4110;
  if (entry) arches(wall, width / 2, Math.min(1.36, width * 0.68), 0.02, 3.13, 0xb6977c, pine);
  for (const [level, widthFactor] of [[4.20, 0.45], [8.0, 0.48], [11.68, 0.55], [15.45, 0.65]]) {
    arches(wall, width / 2, Math.min(1.38, width * widthFactor), level, level + 2.06, 0x97715e);
  }

}

function koepel(_, site) {
  const surveyed = surveys[site.id], floor = 42.26, canopy = 44.83;
  const tower = {
    ...surveyed,
    points: surveyed.points.map(([x, y, z]) => [x, Math.min(y, floor), z]),
    faces: surveyed.faces.filter(([roof, indices]) =>
      !roof || indices.some(i => surveyed.points[i][1] < floor)),
  };
  return createSurveyLandmark(site, [tower], koepelWall, ({ group, trim }) => {
    // The surveyed roof loses the open observation gallery. Fit the shell to the
    // photo-derived gallery section and retain the DSM roof envelope.
    const { x, z } = site, gallery = new CivicBatch();
    const ring = horizontalRing(x, z, 4.28, 8);
    roof(gallery, elevationRing(ring, floor), 0x71604f);
    gallery.solid(new THREE.CylinderGeometry(0.64, 4.33, 0.70, 8)
      .translate(x, canopy + 0.35, z), 0x4b5352);
    gallery.solid(new THREE.CylinderGeometry(1.16, 1.16, canopy - floor, 8)
      .translate(x, (floor + canopy) / 2, z), 0x49423a);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      beam(gallery, [a.x, floor, a.z], [a.x, canopy, a.z], 0.17, 0x353936);
      beam(gallery, [a.x, canopy, a.z], [b.x, canopy, b.z], 0.135, cream);
      beam(gallery, [a.x, floor, a.z], [b.x, floor, b.z], 0.18, 0x7e6e59);
      beam(trim, [a.x, floor + 0.75, a.z], [b.x, floor + 0.75, b.z], 0.058, pine);
      for (let j = 1; j <= 8; j++) {
        const { x, z } = along(a, b, j / 9);
        beam(trim, [x, floor, z], [x, floor + 0.75, z], 0.034, pine);
      }
    }
    group.add(gallery.mesh());
  });
}

function dennenhorstWall(wall) {
  const { base, low, high, width, faceIndex, normal } = wall;
  if (width < 1.25 || low > base + 0.09) return;
  const mainGable = [13, 15].includes(faceIndex);
  const sidingTop = mainGable ? 5.20 : Math.min(4.95, high - base - 0.10);
  for (let y = 0.27; y < sidingTop; y += 0.23)
    surveyPanel(wall, 0.075, width - 0.075, base + y, base + y + 0.026, 0x665648);
  const styles = { frame: 0xd5d0bb, color: 0x374540, columns: 3, rows: 4 };
  const count = Math.max(1, Math.round(width / 2.4));
  for (let i = 0; i < count; i++) {
    const center = width * (i + 0.5) / count, windowWidth = Math.min(1.15, width / count * 0.6);
    if (opening(wall, center, windowWidth, 0.81, 2.63, styles)) {
      for (const side of [-1, 1]) {
        const u = center + side * (windowWidth / 2 + 0.24);
        surveyPanel(wall, u - 0.18, u + 0.18, base + 0.84, base + 2.59, pine, 0.055);
        surveyPanel(wall, u - 0.15, u + 0.15, base + 0.90, base + 2.52, cream, 0.061);
        wall.trim.triangle(wall.point(u - 0.15, base + 0.90, 0.067),
          wall.point(u + 0.15, base + 0.90, 0.067), wall.point(u + 0.15 * side, base + 2.52, 0.067), 0x983227);
      }
    }
  }
  if (mainGable || [4, 5, 10, 16, 23].includes(faceIndex)) {
    const center = width * 0.53;
    for (const [x, y, z] of wall.rings[0]) {
      if (y < base + 5.42) continue;
      const u = (x - wall.a.x) * normal.z - (z - wall.a.z) * normal.x;
      if (u < 0.07 || u > width - 0.07) continue;
      trimLine(wall, center, base + 5.32, u, y, 0.073, 0xd5ccae);
    }
    opening(wall, center, Math.min(1.39, width * 0.5), 3.85, 5.42, styles);
    if (faceIndex === 10 && surveyOpeningFits(wall, 0.25, width - 0.25, base + 5.59, base + 5.95))
      surveyLabel(wall, 0.25, width - 0.25, base + 5.59, base + 5.95, 'DENNENHORST', '#d6cbb3', '#313c35');
  }
}

function wormshoefWall(wall) {
  const { base, low, high, normal, width, faceIndex } = wall;
  if (width < 1.55) return;
  const height = high - base;
  const street = normal.x < -0.75;
  const style = { frame: 0xb39a74, color: 0x394247, columns: 2, rows: 3 };
  if (low <= base + 0.08 && height >= 2.65) {
    const entrance = street && faceIndex === 33;
    const center = width * 0.5;
    if (faceIndex === 65) {
      windowRows(wall, 1.50, [[1.32, 0.28, 2.40]], { ...style, frame: pine, rows: 1 });
      surveyLabel(wall, width * 0.27, width * 0.73, base + 2.40, base + 2.75, 'HOTEL  ·  EETHUYS', '#7b2926', '#eee2bb');
      return 0x3d4b43;
    }
    windowRows(wall, street ? 2.19 : 3.31, [[street ? 1.26 : 0.95, 0.65, Math.min(2.31, height - 0.20)]], style, entrance ? [center] : []);
    if (entrance) {
      opening(wall, center, 1.73, 0.08, 2.65, { ...style, color: 0x344236 });
      surveyLabel(wall, center - 0.57, center + 0.57, base + 2.84, base + 3.20, '1909', '#ccc3ad', '#493a31');
    }
  }
  if (height > 5.7 && low < base + 5.9) {
    const lower = Math.max(low - base + 0.16, 3.66);
    windowRows(wall, 2.7, [[1.11, lower, Math.min(lower + 1.74, height - 0.22)]], style);
    if (height > 8.4) opening(wall, width / 2, Math.min(0.96, width * 0.53), 6.25, 7.91, style);
  }
  if (faceIndex === 63) surveyLabel(wall, 0.23, width - 0.23, base + 5.63, base + 6.04,
    'Wormshoef', '#4b4540', '#e5d0a4');
}

function eekhorstWall(wall) {
  const { base, low, high, normal, width, faceIndex } = wall;
  const plaster = 0xd9d6cb, lintel = 0x906451;
  const street = normal.x < -0.65;
  if (width < 1.4) return street ? plaster : undefined;
  const height = high - base;
  const style = { frame: 0xe4dcbe, color: 0x34423d, columns: 4, rows: 4 };
  if (low < base + 0.08 && height >= 2.85) {
    const count = Math.max(1, Math.round(width / 2.56)), center = width * 0.5;
    const entrance = faceIndex === 29;
    for (let i = 0; i < count; i++) {
      const u = width * (i + 0.5) / count;
      if (entrance && Math.abs(u - center) < 0.94) continue;
      const bottom = 0.82, top = Math.min(2.59, height - 0.22);
      if (!opening(wall, u, 1.13, bottom, top, style) || !street) continue;
      for (const side of [-1, 1]) {
        const shutter = u + side * 0.79;
        surveyPanel(wall, shutter - 0.19, shutter + 0.19, base + bottom, base + top, 0x282f2b, 0.082);
      }
      surveyPanel(wall, u - 0.68, u + 0.68, base + top + 0.16, base + top + 0.34, lintel, 0.051);
    }
    if (entrance) arches(wall, center, 1.08, 0.05, 2.73, cream, pine);
    if (street) surveyPanel(wall, 0.02, width - 0.02, base + 0.02, base + 0.56, lintel, 0.033);
  }
  if (height >= 5.5 && low <= base + 4.4 && (street || faceIndex === 12 || faceIndex === 17)) {
    opening(wall, width / 2, Math.min(1.38, width * 0.68), 4.25, 6.1, style);
    const u = width / 2, y = base + Math.min(6.43, height - 0.51);
    if (surveyOpeningFits(wall, u - 0.48, u + 0.48, y - 0.22, y + 0.22)) {
      surveyLabel(wall, u - 0.49, u + 0.49, y - 0.13, y + 0.12, 'D’EEKHORST', '#d9d6cb', '#3b3a34');
      const tree = y + 0.35;
      trimLine(wall, u, tree - 0.15, u, tree + 0.09, 0.032, 0x474e41);
      for (const side of [-1, 1]) {
        trimLine(wall, u, tree - 0.09, u + side * 0.16, tree + 0.03, 0.032, 0x474e41);
      }
    }
  }
  return street ? plaster : undefined;
}

function millWall(wall) {
  if (wall.width < 1 || wall.low > wall.base + 3) return;
  const { base, width } = wall;
  if (wall.low < base + 0.08) surveyPanel(wall, 0.05, width - 0.05, base + 0.02, base + 2.35, 0xd2c8ae, 0.047);
  if (wall.normal.x < -0.65) opening(wall, width / 2, 1.24, 0.10, 2.22, { frame: 0x963e35, color: 0x442e25 });
  else if (wall.normal.z > 0.65) opening(wall, width / 2, 0.66, 1.14, 2.14, { frame: 0x963e35, columns: 2, rows: 2 });
}

function millRig(site, { group }) {
  const tower = new THREE.Group();
  const base = surveys[site.id].ground;
  tower.position.set(site.x, base, site.z);
  tower.rotation.y = -1.03;
  group.add(tower);
  const radius = 12; // Documented 24 m span, fitted in October 2025.
  const { sails } = createWindmillRig(tower, 12.60, 3.32, 0.115);
  sails.rotation.z = 0.35;
  const lattice = new CivicBatch();
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const member = (offset, radius, w, length, d, color) => lattice.solid(
      new THREE.BoxGeometry(w, length, d).rotateZ(angle)
        .translate(c * offset - s * radius, s * offset + c * radius, 0), color);
    member(0, 6, 0.16, 12, 0.17, 0x52433b);
    member(0.17, 6.66, 0.30, 10.36, 0.13, 0x54656e);
    member(-1.13, 6.91, 0.07, 9.92, 0.08, 0x454346);
    for (let i = 0; i < 19; i++) member(-0.57, 2.08 + i * 0.53, 1.11, 0.05, 0.07, 0x756254);
  }
  sails.add(lattice.mesh());
  addWindmillSailcloth(sails, { angle: Math.PI / 2, radii: [radius], root: 1.95, innerWidth: 1.15, outerWidth: 1.15 });
}

function horizontalRing(x, z, radius, segments = 24) {
  return Array.from({ length: segments }, (_, i) => {
    const angle = i * 2 * Math.PI / segments;
    return { x: x + Math.sin(angle) * radius, z: z + Math.cos(angle) * radius };
  });
}

function outlineCollider(outer, minY, maxY) {
  return {
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY, maxY, polygon: { outer, holes: [] },
  };
}

function addNear(group, batch, range = 85) {
  const detail = batch.mesh();
  detail.castShadow = false;
  detail.userData.nearDetail = range;
  group.add(detail);
}

function hessenhut(_, site) {
  const deck = new CivicBatch(), detail = new CivicBatch(), colliders = [], platforms = [];
  const wood = 0x827765, metal = 0x536062;
  const [cx, cz] = structures.hessenDeck;
  const lowerRadius = 3.65, topRadius = 2.06;
  const positions = structures.hessenWalk.map(([x, z]) => ({ x, z }));
  const start = positions[0];
  const startY = terrainHeightAt(start.x, start.z) + 0.035;
  const lower = Math.max(startY + 2.5, 19.06);
  const top = lower + 2.19;
  const heights = [startY, Math.min(lower - 0.87, Math.max(startY + 0.48, 17.65)), lower, lower, top];
  const last = positions.at(-1);
  const entrance = Math.atan2(last.x - cx, last.z - cz);
  const inwardLength = Math.hypot(last.x - cx, last.z - cz);
  // Carry the last tread into the deck so its walking surface has no horizontal gap.
  positions[positions.length - 1] = {
    x: cx + (last.x - cx) * (topRadius - 0.13) / inwardLength,
    z: cz + (last.z - cz) * (topRadius - 0.13) / inwardLength,
  };
  const vec = (p, y) => [p.x, y, p.z];
  // Use one cross-section normal through the surveyed, nearly straight approach.
  const dir = [start.x - cx, start.z - cz], size = Math.hypot(...dir);
  const section = p => [-0.59, 0.59].map(offset => ({
    x: p.x + dir[1] / size * offset, z: p.z - dir[0] / size * offset,
  }));
  for (let i = 1; i < positions.length; i++) {
    const a = positions[i - 1], b = positions[i], y0 = heights[i - 1], y1 = heights[i];
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    const ea = section(a), eb = section(b), outer = [ea[0], ea[1], eb[1], eb[0]];
    platforms.push({ id: `hessenhut-walk-${i}`, outer, holes: [], height(x, z) {
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / length ** 2, 0, 1);
      return THREE.MathUtils.lerp(y0, y1, t);
    } });
    const count = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 0.17));
    for (let step = 0; step < count; step++) {
      const first = step / count, end = (step + 1) / count;
      const y = THREE.MathUtils.lerp(y0, y1, end);
      const p = ea.map((edge, j) => vec(along(edge, eb[j], first), y));
      const q = ea.map((edge, j) => vec(along(edge, eb[j], end), y));
      roof(deck, [p[0], q[0], q[1], p[1]], i === 4 ? metal : wood);
      beam(detail, p[0], p[1], 0.039, 0x4c4c43);
    }
    for (const j of [0, 1]) {
      beam(deck, vec(ea[j], y0 - 0.08), vec(eb[j], y1 - 0.08), 0.125, metal);
      beam(deck, vec(ea[j], y0 + 0.92), vec(eb[j], y1 + 0.92), 0.075, metal);
      for (const t of [0, 0.5, 1]) {
        const pos = along(ea[j], eb[j], t), y = THREE.MathUtils.lerp(y0, y1, t);
        beam(deck, vec(pos, y), vec(pos, y + 0.92), 0.056, metal);
      }
      colliders.push(...wallColliders(ea[j], eb[j], Math.min(y0, y1) - 0.05, Math.max(y0, y1) + 0.90, 0.10));
    }
  }

  function circleDeck(id, radius, y, holeRadius, railHeight) {
    const segments = 32, outer = horizontalRing(cx, cz, radius, segments);
    const inner = horizontalRing(cx, cz, holeRadius, segments);
    deck.polygon([elevationRing(outer, y), elevationRing([...inner].reverse(), y)], wood);
    platforms.push({ id, outer, holes: [inner], height: () => y });
    for (let i = 0; i < segments; i++) {
      const p = outer[i], q = outer[(i + 1) % segments];
      const angle = (i + 0.5) * 2 * Math.PI / segments;
      const gap = Math.abs(Math.atan2(Math.sin(angle - entrance), Math.cos(angle - entrance)));
      beam(deck, vec(p, y - 0.14), vec(q, y - 0.14), 0.18, metal);
      if (gap > (radius === topRadius ? 0.34 : 0.22)) {
        deck.quad(vec(p, y), vec(p, y + railHeight), vec(q, y + railHeight), vec(q, y), wood);
        deck.quad(vec(q, y), vec(q, y + railHeight), vec(p, y + railHeight), vec(p, y), wood);
        beam(deck, vec(p, y + railHeight), vec(q, y + railHeight), 0.075, metal);
        colliders.push(...wallColliders(p, q, y - 0.04, y + railHeight, 0.12));
      }
      const [a, b] = [inner[i], inner[(i + 1) % segments]];
      beam(detail, vec(a, y + 1.09), vec(b, y + 1.09), 0.047, metal);
      beam(detail, vec(a, y - 0.10), vec(a, y + 1.09), 0.035, metal);
      colliders.push(...wallColliders(a, b, y, y + 0.95, 0.085));
      if (i % 4 === 0) {
        const foot = { x: (a.x + cx) * 0.5, z: (a.z + cz) * 0.5 };
        const floor = terrainHeightAt(foot.x, foot.z) - 0.11;
        beam(deck, vec(foot, floor), vec(p, y - 0.16), 0.12, metal);
      }
    }
  }
  circleDeck('hessenhut-lower-landing', lowerRadius, lower, 0.87, 0.79);
  circleDeck('hessenhut-upper-deck', topRadius, top, 0.79, 0.95);
  const group = makeGroup(site.name, deck, colliders);
  group.userData.platforms = platforms;
  group.userData.treeClearance = platforms.slice(0, 4).map(({ outer }, index) =>
    outlineCollider(outer, heights[index] - 0.5, heights[index + 1] + 2.1));
  addNear(group, detail, 70);
  return group;
}

function ironAgeFarm(_, site) {
  const shape = new CivicBatch(), detail = new CivicBatch(), colliders = [];
  const wood = 0x6c543d, straw = 0x8d7a5b, wall = 0x8c7758;
  for (const [index, ring] of structures.farm.entries()) {
    const outer = ring.map(([x, z]) => ({ x, z }));
    const [a, b, c, d] = outer;
    const x = outer.reduce((sum, p) => sum + p.x, 0) / outer.length;
    const z = outer.reduce((sum, p) => sum + p.z, 0) / outer.length;
    const base = terrainHeightAt(x, z);
    const hayloft = index === 1;
    const eave = base + (hayloft ? 2.74 : 0.58), top = base + (hayloft ? 4.03 : 5.15);
    const walls = outer.map(p => along(p, { x, z }, hayloft ? 0.12 : 0.14));
    const support = hayloft ? base + 0.83 : base + 0.08;
    for (const [i, p] of walls.entries()) {
      const q = walls[(i + 1) % walls.length];
      const ground = terrainHeightAt(p.x, p.z) - 0.12;
      beam(shape, [p.x, ground, p.z], [p.x, eave + 0.12, p.z], hayloft ? 0.19 : 0.16, wood);
      if (hayloft) {
        shape.quad([q.x, support, q.z], [p.x, support, p.z], [p.x, eave, p.z], [q.x, eave, q.z], wood);
        for (let s = 1; s < 7; s++) {
          const { x, z } = along(p, q, s / 7);
          beam(detail, [x, support, z], [x, eave, z], 0.022, 0x594a3c);
        }
      }
    }
    if (hayloft) {
      for (const [i, p] of outer.entries()) {
        const q = outer[(i + 1) % outer.length];
        roof(shape, [[p.x, eave, p.z], [q.x, eave, q.z], [x, top, z]], straw);
      }
    } else {
      // The saddle of the hipped thatch leaves both end walls sheltered by the eaves.
      const p = along(along(a, b, 0.5), along(c, d, 0.5), 0.13);
      const q = along(along(a, b, 0.5), along(c, d, 0.5), 0.87);
      const v = (p, y) => [p.x, y, p.z];
      roof(shape, [v(a, eave), v(b, eave), v(p, top)], straw);
      roof(shape, [v(c, eave), v(d, eave), v(q, top)], straw);
      roof(shape, [v(d, eave), v(a, eave), v(p, top), v(q, top)], straw);
      const doorLeft = 0.43, doorRight = 0.57, doorHeight = base + 2.36;
      for (const [from, to, cut] of [[0, doorLeft, false], [doorLeft, doorRight, true], [doorRight, 1, false]]) {
        const u = along(b, c, from), v0 = along(b, c, to);
        const upper = along(p, q, from), upperEnd = along(p, q, to);
        const t = cut ? (doorHeight - eave) / (top - eave) : 0;
        roof(shape, [v(along(u, upper, t), cut ? doorHeight : eave),
          v(along(v0, upperEnd, t), cut ? doorHeight : eave), v(upperEnd, top), v(upper, top)], straw);
      }
      const entrance = along(along(b, c, 0.5), { x, z }, 0.17);
      const dx = c.x - b.x, dz = c.z - b.z;
      box(detail, entrance.x, base + 1.12, entrance.z, 1.60, 2.24, 0.08, 0x44352a, Math.atan2(-dz, dx));
      beam(shape, v(p, top + 0.014), v(q, top + 0.014), 0.12, 0x695740);
      for (const [i, post] of walls.entries()) {
        const next = walls[(i + 1) % walls.length];
        beam(detail, v(post, eave - 0.14), v(next, eave - 0.14), 0.11, wall);
      }
      for (let t = 0; t <= 1; t += 0.10) {
        const rail = along(p, q, t);
        beam(detail, v(along(along(b, c, t), rail, 0.9), top - 0.24), v(rail, top + 0.07), 0.052, wood);
      }
    }
    colliders.push(outlineCollider(walls, Math.min(base, ...walls.map(p => terrainHeightAt(p.x, p.z))), top));
  }
  const group = makeGroup(site.name, shape, colliders);
  addNear(group, detail, 75);
  return group;
}

function middelpuntStoneTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const width = canvas.width = 1024, height = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const hash = (x, y) => {
    const bits = Math.imul(x + 71, 374761393) ^ Math.imul(y + 29, 668265263);
    return (Math.imul(bits ^ (bits >>> 13), 1274126177) >>> 0) / 4294967296;
  };
  const fade = t => t * t * (3 - 2 * t);
  const noise = (x, y, size) => {
    const ix = Math.floor(x / size), iy = Math.floor(y / size);
    const next = (ix + 1) % (width / size);
    const fx = fade((x % size) / size), fy = fade((y % size) / size);
    const top = THREE.MathUtils.lerp(hash(ix, iy), hash(next, iy), fx);
    const bottom = THREE.MathUtils.lerp(hash(ix, iy + 1), hash(next, iy + 1), fx);
    return THREE.MathUtils.lerp(top, bottom, fy);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const coarse = noise(x, y, 64) - 0.5;
    const mineral = noise(x, y, 16) - 0.5;
    const grain = noise(x, y, 4) - 0.5;
    const shade = 127 + 28 * coarse + 26 * mineral + 34 * grain + 29 * (hash(x, y) - 0.5);
    const i = (y * width + x) * 4;
    image.data[i] = shade + 5;
    image.data[i + 1] = shade + 3;
    image.data[i + 2] = shade - 5;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  // The front of the rounded stone is at u = 1/4.
  ctx.translate(width / 4, 0);
  ctx.lineCap = 'round';
  const fissures = [
    [12, [[-91, 405], [-77, 380], [-61, 363], [-54, 346], [-38, 325], [-30, 303]]],
    [8, [[-53, 427], [-43, 402], [-26, 380], [-19, 356], [-7, 336]]],
    [7, [[59, 303], [54, 330], [58, 349], [50, 365], [47, 389]]],
    [6, [[-86, 164], [-68, 154], [-52, 152], [-41, 142]]],
  ];
  for (const [width, points] of fissures) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
    ctx.filter = 'blur(2px)';
    ctx.strokeStyle = '#514e4370';
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.filter = 'blur(0.55px)';
    ctx.strokeStyle = '#514d438c';
    ctx.lineWidth = Math.max(1, width * 0.20);
    ctx.stroke();
  }
  ctx.filter = 'none';
  ctx.font = '30px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [text, y, maxWidth] of [['MIDDELPUNT', 147, 137], ['VAN', 183, 42], ['NEDERLAND', 222, 131]]) {
    ctx.fillStyle = '#e4dfca94';
    ctx.fillText(text, 0, y + 1.7, maxWidth);
    ctx.fillStyle = '#3b382fe0';
    ctx.fillText(text, 0, y, maxWidth);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function middelpuntBoulder(x, y, z, facing) {
  const geometry = new THREE.SphereGeometry(1, 80, 48);
  const vertices = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const rounded = value => Math.sign(value) * Math.abs(value) ** 0.77;
  for (let i = 0; i < vertices.count; i++) {
    const nx = vertices.getX(i), ny = vertices.getY(i), nz = vertices.getZ(i);
    const height = (ny + 1) * 0.5;
    const circle = Math.hypot(nx, nz) || 1;
    const relief = 0.024 * Math.sin(8 * nx + 2 * ny) * Math.cos(7 * nz - 3 * ny)
      + 0.013 * Math.sin(16 * nx + 11 * ny + 3 * nz);
    const radius = Math.max(0, 1 - ny * ny) ** 0.36 * (1 + relief);
    const side = (0.74 - 0.12 * height) * radius * rounded(nx / circle)
      + 0.23 * height * height - 0.065 * (1 - height);
    const depth = (0.54 - 0.055 * height) * radius * rounded(nz / circle);
    const rise = Math.max(-0.035, 0.61 + ny * 0.65 + 0.019 * nx + 0.018 * Math.sin(10 * nx + 4 * nz));
    vertices.setXYZ(i, side, rise, depth);
    const u = uv.getX(i);
    const frontEdge = THREE.MathUtils.smoothstep(Math.abs(u - 0.25), 0.12, 0.23);
    const frontU = 0.25 + (side - 0.08) / 4.4;
    uv.setXY(i, THREE.MathUtils.lerp(frontU, u, frontEdge), (rise + 0.04) / 1.34);
  }
  geometry.computeVertexNormals();
  const map = middelpuntStoneTexture();
  const material = new THREE.MeshStandardNodeMaterial({
    color: map ? 0xffffff : 0x928f82, map, bumpMap: map, bumpScale: 0.019, roughness: 0.94,
  });
  const rock = new THREE.Mesh(geometry, material);
  rock.name = 'Middelpunt inscription boulder';
  rock.position.set(x, y, z);
  rock.rotation.y = facing;
  rock.castShadow = rock.receiveShadow = true;
  return rock;
}

function middelpunt(_, site) {
  const shape = new CivicBatch(), colliders = [], platforms = [];
  const [cx, cz] = structures.middelpuntRing;
  const rust = 0x573329, turf = 0x54643e, wood = 0x73604d;
  const floor = terrainHeightAt(cx, cz);
  const polar = (radius, angle) => ({ x: cx + Math.sin(angle) * radius, z: cz + Math.cos(angle) * radius });

  // The three cuts line up with the mapped south, east and northwest paths.
  const radius = [8.60, 9.60, 12.60];
  for (const [index, [first, last]] of [[9.8, 87.3], [98.2, 209.8], [218.7, 360.8]].entries()) {
    const segments = Math.ceil((last - first) / 4.5);
    const edges = radius.map(r => Array.from({ length: segments + 1 }, (_, i) =>
      polar(r, THREE.MathUtils.degToRad(THREE.MathUtils.lerp(first, last, i / segments)))));
    const bases = edges.map(ring => ring.map(p => terrainHeightAt(p.x, p.z) - 0.12));
    // The coarse AHN field already contains parts of the berm.
    const lower = Math.max(floor + 0.40, ...edges.slice(0, 2).flat().map(p => terrainHeightAt(p.x, p.z) + 0.08));
    const upper = Math.max(floor + 0.79, lower + 0.32, ...edges[2].map(p => terrainHeightAt(p.x, p.z) + 0.08));
    const heights = [lower, upper];
    for (let tier = 0; tier < heights.length; tier++) {
      const [inner, outer] = edges.slice(tier, tier + 2);
      const height = heights[tier];
      const id = `middelpunt-berm-${index}-${tier}`;
      platforms.push({ id, outer: [...inner, ...outer.slice().reverse()], holes: [], height: () => height });

      for (let i = 0; i < segments; i++) {
        const a = inner[i], b = inner[i + 1], c = outer[i + 1], d = outer[i];
        roof(shape, elevationRing([a, b, c, d], height), turf);
        const lowA = tier ? heights[tier - 1] : bases[tier][i];
        const lowB = tier ? heights[tier - 1] : bases[tier][i + 1];
        const face = [[a.x, lowA, a.z], [b.x, lowB, b.z], ...elevationRing([b, a], height)];
        // These points run clockwise, looking down on the grass.
        shape.quad(face[3], face[2], face[1], face[0], rust);
        colliders.push(...wallColliders(a, b, Math.min(lowA, lowB), height, 0.075));
        if (tier !== 1) continue;
        shape.quad([d.x, bases[2][i], d.z], [c.x, bases[2][i + 1], c.z],
          ...elevationRing([c, d], height), rust);
        colliders.push(...wallColliders(d, c, Math.min(bases[2][i], bases[2][i + 1]), height, 0.075));
      }

      for (const j of [0, segments]) {
        const a = inner[j], b = outer[j];
        const low = Math.min(bases[tier][j], bases[tier + 1][j]);
        const face = [...elevationRing([a, b], low), ...elevationRing([b, a], height)];
        if (j === segments) face.reverse();
        shape.quad(...face, rust);
        colliders.push(...wallColliders(a, b, low, height, 0.075));
      }
    }
  }

  const [sx, sz] = structures.middelpuntStone;
  const stoneY = terrainHeightAt(sx, sz);
  const facing = Math.atan2(site.approach.x - sx, site.approach.z - sz);
  colliders.push(outlineCollider(horizontalRing(sx, sz, 0.74, 12), stoneY, stoneY + 1.26));

  for (const [[x, z], width, height, depth, color] of [
    [structures.middelpuntBoulders[0], 1.55, 0.88, 1.25, 0x77756a],
    [structures.middelpuntBoulders[1], 1.36, 0.63, 1.09, 0x898075],
  ]) {
    const y = terrainHeightAt(x, z);
    shape.solid(new THREE.IcosahedronGeometry(1, 1).scale(width / 2, height * 0.59, depth / 2)
      .rotateY(0.45).translate(x, y + height * 0.41, z), color);
    colliders.push(outlineCollider(horizontalRing(x, z, depth * 0.48, 8), y, y + height));
  }

  const [tx, tz] = structures.middelpuntLime;
  const benchY = terrainHeightAt(tx, tz);
  const circle = (radius, theta) => [tx + Math.sin(theta) * radius, tz + Math.cos(theta) * radius];
  const benchSegments = 20;
  for (let i = 0; i < benchSegments; i++) {
    const a = i * Math.PI * 2 / benchSegments, b = (i + 1) * Math.PI * 2 / benchSegments;
    for (const r of [0.85, 1.00, 1.15]) {
      const [x, z] = circle(r, a), [u, v] = circle(r, b);
      beam(shape, [x, benchY + 0.42, z], [u, benchY + 0.42, v], 0.126, wood, 0.062);
    }
    const [x0, z0] = circle(1.0, a), [x1, z1] = circle(1.0, b);
    colliders.push(...wallColliders({ x: x0, z: z0 }, { x: x1, z: z1 }, benchY, benchY + 0.49, 0.36));
    if (i % 5 === 0) {
      const [x, z] = circle(1.0, a);
      box(shape, x, benchY + 0.18, z, 0.15, 0.40, 0.17, rust);
    }
  }

  const group = makeGroup(site.name, shape, colliders);
  group.userData.platforms = platforms;
  group.add(middelpuntBoulder(sx, stoneY, sz, facing));
  return group;
}

export const LUNTEREN_LANDMARK_FACTORIES = {
  'station-lunteren': (_, site) => createSurveyLandmark(site, [surveys[site.id]], stationWall, stationCanopy),
  'de-koepel': koepel,
  'oude-kerk-lunteren': (_, site) => createSurveyLandmark(site, [surveys[site.id]], churchWall, churchDetails),
  'molen-de-hoop': (_, site) => createSurveyLandmark(site, [surveys[site.id]], millWall, finish => millRig(site, finish)),
  'museum-lunteren': (_, site) => createSurveyLandmark(site, [surveys[site.id]], museumWall),
  dennenhorst: (_, site) => createSurveyLandmark(site, [surveys[site.id]], dennenhorstWall),
  'de-wormshoef': (_, site) => createSurveyLandmark(site, [surveys[site.id]], wormshoefWall),
  'de-eekhorst': (_, site) => createSurveyLandmark(site, [surveys[site.id]], eekhorstWall),
  hessenhut,
  ijzertijdboerderij: ironAgeFarm,
  'middelpunt-van-nederland': middelpunt,
};
