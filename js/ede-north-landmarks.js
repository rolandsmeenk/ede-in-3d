import * as THREE from 'three/webgpu';
import { color, mix, smoothstep } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { terrainHeightAt } from './terrain.js';
import { addWindmillSailcloth, createWindmillRig } from './ede-windmill.js';
import {
  CivicBatch, along, offsetEdge, facePanel, wallExtent, wallColliders, makeGroup, civicSigns, polygonNormal,
} from './ede-civic-landmarks.js';
import { KEETMOLEN_MOUND, PEPPEL_POOL, PEPPEL_HALL } from './ede-north-landmark-survey.js';

const up = new THREE.Vector3(0, 1, 0);

function beam(batch, a, b, width, depth, color) {
  const origin = new THREE.Vector3(...a), target = new THREE.Vector3(...b);
  const direction = target.clone().sub(origin);
  const length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(up, direction.divideScalar(length));
  batch.solid(new THREE.BoxGeometry(width, length, depth)
    .applyQuaternion(rotation).translate(...origin.lerp(target, 0.5).toArray()), color);
}

function flatBox(batch, a, b, low, high, depth, color) {
  const dx = b.x - a.x, dz = b.z - a.z;
  batch.solid(new THREE.BoxGeometry(Math.hypot(dx, dz), high - low, depth)
    .rotateY(-Math.atan2(dz, dx)).translate((a.x + b.x) / 2, (low + high) / 2, (a.z + b.z) / 2), color);
}

function keetmolenMound(batch) {
  const { x, z, step, columns, rows, heights: survey } = KEETMOLEN_MOUND;
  const maxX = x + (columns - 1) * step, maxZ = z + (rows - 1) * step;
  const ground = survey.map((_, i) => terrainHeightAt(x + i % columns * step, z + Math.floor(i / columns) * step));
  const heights = survey.map((y, i) => {
    if (y === null) return ground[i];
    const px = x + i % columns * step, pz = z + Math.floor(i / columns) * step;
    const radius = Math.hypot((px + 77.8) / 15.35, (pz - 1809.5) / 16.15);
    const fade = 1 - THREE.MathUtils.smoothstep(radius, 0.8, 1);
    return ground[i] + Math.max(y / 100 - ground[i], 0) * fade;
  });
  const point = i => [x + i % columns * step, heights[i] + 0.008, z + Math.floor(i / columns) * step];
  for (let v = 0; v < rows - 1; v++) for (let u = 0; u < columns - 1; u++) {
    const a = v * columns + u, b = a + 1, c = a + columns, d = c + 1;
    const tint = [0x667449, 0x657344, 0x677448][(u * 17 + v * 29) % 3];
    if ([a, b, c].some(i => heights[i] > ground[i] + 0.02)) batch.triangle(point(a), point(c), point(b), tint);
    if ([b, c, d].some(i => heights[i] > ground[i] + 0.02)) batch.triangle(point(b), point(c), point(d), tint);
  }
  return {
    id: 'keetmolen-mound', outer: [{ x, z }, { x: maxX, z }, { x: maxX, z: maxZ }, { x, z: maxZ }], holes: [],
    height(px, pz) {
      const u = (px - x) / step, v = (pz - z) / step;
      const col = Math.max(0, Math.min(columns - 2, Math.floor(u)));
      const row = Math.max(0, Math.min(rows - 2, Math.floor(v)));
      const du = u - col, dv = v - row, i = row * columns + col;
      const [a, b, c, d] = [heights[i], heights[i + 1], heights[i + columns], heights[i + columns + 1]];
      return du + dv <= 1 ? a + (b - a) * du + (c - a) * dv : d + (c - d) * (1 - du) + (b - d) * (1 - dv);
    },
  };
}

export function createKeetmolen() {
  const batch = new CivicBatch(), colliders = [];
  const mound = keetmolenMound(batch);
  // Leave room for the full sweep above the fitted earth mound.
  const x = -77.55, z = 1808.70, hub = 14.80, hubOffset = 4.16, yaw = -0.085;
  const tower = new THREE.Group();
  tower.position.set(x, 0, z);
  tower.rotation.y = yaw;
  const { cap: rotatingCap, sails } = createWindmillRig(tower, hub, hubOffset, 0.13);
  const capBatch = new CivicBatch(), sailBatch = new CivicBatch();
  const green = 0x31453b, wood = 0x3c3830, ivory = 0xe7e0cf, brick = 0x776558, cap = 0x373830;
  const timber = (a, b, w, d, color) => beam(capBatch, a, b, w, d, color);
  const sailBeam = (a, b, w, d, color) => beam(sailBatch, a, b, w, d, color);
  const trim = (w, h, d, a, r, y, color) => {
    batch.solid(new THREE.BoxGeometry(w, h, d).translate(0, y, r).rotateY(a)
      .translate(x, 0, z), color);
  };
  const ring = (top, bottom, low, high, color) => batch.solid(
    new THREE.CylinderGeometry(top, bottom, high - low, 8).rotateY(0.517)
      .translate(x, (low + high) / 2, z), color);
  const point = (theta, r, y) => [x + r * Math.sin(theta), y, z + r * Math.cos(theta)];
  const base = 1.75, shoulder = 12.10;
  for (let side = 0; side < 8; side++) {
    const a = 0.517 + side * Math.PI / 4, b = a + Math.PI / 4;
    const tint = [0x776759, 0x74665a, 0x7c6f60, 0x6f6255][side % 4];
    batch.quad(point(a, 4.54, base), point(b, 4.54, base),
      point(b, 2.66, shoulder), point(a, 2.66, shoulder), tint);
    const angle = a + Math.PI / 8;
    for (let band = 0; band < 21; band++) {
      const t = (band + 1) / 22, y = base + (shoulder - base) * t;
      const radius = (4.54 + (2.66 - 4.54) * t) * Math.cos(Math.PI / 8);
      trim(radius * 0.80, 0.022, 0.016, angle, radius + 0.013, y,
        band % 4 === 0 ? 0x918171 : brick);
    }
    if ((side % 2) === 0) for (const [y, height] of [[4.45, 0.82], [7.55, 0.98], [10.26, 0.75]]) {
      const radius = (4.54 + (2.66 - 4.54) * (y - base) / (shoulder - base)) * Math.cos(Math.PI / 8);
      // The trim follows the raked brick face so it stays in front at both sill and head.
      const window = (w, h, d, shift, face, color) =>
        batch.solid(new THREE.BoxGeometry(w, h, d).rotateX(-0.165)
          .translate(0, y + shift, radius + face).rotateY(angle).translate(x, 0, z), color);
      window(0.65, height + 0.14, 0.115, 0, 0.035, 0xa38b71);
      window(0.52, height, 0.10, 0, 0.103, ivory);
      window(0.42, height - 0.11, 0.057, 0, 0.15, 0x263231);
      window(0.062, height - 0.10, 0.060, 0, 0.175, ivory);
      window(0.50, 0.065, 0.084, -height * 0.48, 0.17, ivory);
    }
  }
  ring(2.75, 2.72, shoulder - 0.15, shoulder + 0.05, 0xb8ae99);
  ring(2.90, 2.83, shoulder + 0.05, shoulder + 0.28, 0x3c463c);
  const roof = [[2.88, 12.35], [3.02, 12.66], [2.95, 13.03], [2.64, 13.96], [2.25, 14.65],
    [1.65, 15.43], [0.85, 16.11], [0, 16.46]].map(([radius, y]) => new THREE.Vector2(radius, y));
  capBatch.solid(new THREE.LatheGeometry(roof, 20), cap);
  timber([0, 16.1, 0], [0, 16.67, 0], 0.09, 0.09, ivory);
  capBatch.solid(new THREE.BoxGeometry(2.48, 2.02, 0.89).translate(0, 13.84, 2.57), green);
  for (const d of [-1, 1]) {
    timber([d * 1.23, 12.74, 3.03], [d * 1.23, 14.47, 3.03], 0.10, 0.09, ivory);
    timber([d * 1.35, 14.42, 3.03], [0, 14.42, 3.03], 0.11, 0.11, ivory);
    timber([d * 1.13, 12.78, 3.08], [d * 0.18, 12.78, 3.08], 0.09, 0.09, ivory);
  }
  timber([0, hub - 0.19, 2.74], [0, hub, hubOffset], 0.47, 0.41, 0x555753);
  // The biotope survey gives a 24.75 m sail span. Build the sails in the windshaft's local plane.
  const sailAngle = 0.08, span = 12.375;
  for (let i = 0; i < 4; i++) {
    const a = sailAngle + i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    const sail = (r, w) => [r * c - w * s, r * s + w * c, 0];
    sailBeam(sail(0, 0), sail(span, 0), 0.234, 0.205, wood);
    sailBeam(sail(1.95, -0.31), sail(span, -0.29), 0.24, 0.15, ivory);
    sailBeam(sail(2.10, 0.92), sail(span, 1.25), 0.067, 0.061, wood);
    sailBeam(sail(2.10, 0.43), sail(span, 0.64), 0.058, 0.054, wood);
    sailBeam(sail(span - 0.045, 0), sail(span - 0.045, 1.25), 0.08, 0.07, wood);
    for (let row = 0; row < 23; row++) {
      const t = row / 22, r = 2.12 + t * (span - 2.20);
      sailBeam(sail(r, -0.13), sail(r, 0.92 + 0.33 * t), 0.057, 0.05, wood);
    }
  }

  const tailLength = 8.8;
  const tailY = mound.height(x - tailLength * Math.sin(yaw), z - tailLength * Math.cos(yaw)) + 0.57;
  timber([0, 13.64, -2.62], [0, tailY, -8.80], 0.27, 0.24, wood);
  for (const d of [-1, 1]) {
    timber([d * 3.82, 13.11, -1.98], [0, tailY + 0.57, -8.55], 0.12, 0.13, ivory);
    timber([d * 2.73, 10.22, -2.60], [0, tailY + 0.31, -8.69], 0.11, 0.11, ivory);
    timber([d * 3.82, 13.11, -1.98], [0, 13.11, -1.98], 0.12, 0.12, ivory);
  }
  const footprint = Array.from({ length: 8 }, (_, i) => {
    const [px, , pz] = point(0.517 + i * Math.PI / 4, 4.54, base);
    return { x: px, z: pz };
  });
  for (let i = 0; i < footprint.length; i++) {
    colliders.push(...wallColliders(footprint[i], footprint[(i + 1) % 8], base - 0.3, shoulder + 0.1));
  }
  const group = makeGroup('De Keetmolen', batch, colliders);
  rotatingCap.add(capBatch.mesh());
  sails.add(sailBatch.mesh());
  addWindmillSailcloth(sails, { angle: sailAngle, radii: [span], root: 2.10, innerWidth: 0.92, outerWidth: 1.25 });
  // The annual Christmas star hangs from the upper sail while the rotor is parked.
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 ? 0.60 : 1.34;
    return new THREE.Vector2(radius * Math.cos(angle), radius * Math.sin(angle));
  });
  const shape = new THREE.Shape(points);
  shape.holes.push(new THREE.Path(points.map(point => point.clone().multiplyScalar(0.76)).reverse()));
  const starMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  starMaterial.colorNode = mix(color(0x635b48), color(0xffdc93).mul(3.4),
    smoothstep(0.8, 1.36, cityUniforms.uInteriorGlow));
  const star = new THREE.Mesh(new THREE.ShapeGeometry(shape), starMaterial);
  star.name = 'Keetmolen Christmas star';
  star.position.set(-Math.sin(sailAngle) * (span - 0.82), Math.cos(sailAngle) * (span - 0.82), 0.27);
  star.rotation.z = sailAngle;
  star.visible = false;
  sails.add(star);
  group.userData.setMillLighting = ({ keetStar }) => {
    star.visible = keetStar;
    sails.userData.parkAngle = keetStar ? -sailAngle : undefined;
  };
  group.add(tower);
  group.userData.platforms = [mound];
  return group;
}

const poolBrick = 0xb6ae98, hallBrick = 0x867166, trim = 0xbac0bc;
const panelBlue = [0x536781, 0x798aa5, 0x9aa5b4, 0xa4abae, 0x2e4766];
const glassTints = [0x526c70, 0x445e62, 0x3c5257];
const solarRoofs = new Set([211, 213, 216, 221, 223]);

function roofPanels(batch, rings, n) {
  const [outer, ...holes] = rings;
  const a = outer[0], b = outer[1], length = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (length < 0.3 || Math.abs(n.y) < 0.96) return;
  const hx = (b[0] - a[0]) / length, hz = (b[2] - a[2]) / length;
  const flatten = ([x,,z]) => [(x - a[0]) * hx + (z - a[2]) * hz, (z - a[2]) * hx - (x - a[0]) * hz];
  const edges = outer.map(flatten), voids = holes.map(r => r.map(flatten));
  function contains(points, x, z) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, az] = points[i], [bx, bz] = points[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    }
    return inside;
  }
  function at(u, v) {
    const dx = hx * u - hz * v, dz = hz * u + hx * v;
    return [a[0] + dx, a[1] - (n.x * dx + n.z * dz) / n.y + 0.13, a[2] + dz];
  }
  const us = edges.map(p => p[0]), vs = edges.map(p => p[1]);
  for (let v = Math.min(...vs) + 1.65; v < Math.max(...vs) - 2.6; v += 2.28) {
    for (let u = Math.min(...us) + 1.8; u < Math.max(...us) - 1.9; u += 1.95) {
      const xy = [[u, v], [u, v + 1.64], [u + 1.76, v + 1.64], [u + 1.76, v]];
      if (!xy.every(([x, z]) => contains(edges, x, z) && !voids.some(hole => contains(hole, x, z)))) continue;
      batch.quad(...xy.map(p => at(...p)), 0x344557, 0.14);
      batch.quad(at(u, v), at(u, v + 0.043), at(u + 1.76, v + 0.043), at(u + 1.76, v), 0x798991, 0.14);
    }
  }
}

function glazing(batch, { a, b, n, width }, u0, u1, low, high, bays, rows = 2, border = trim) {
  if (high <= low) return;
  facePanel(batch, a, b, n, u0, u1, low, high, border, 0.035);
  const frame = 0.085 / width;
  for (let i = 0; i < bays; i++) {
    const left = u0 + (u1 - u0) * i / bays, right = u0 + (u1 - u0) * (i + 1) / bays;
    if (right - left < frame * 3) continue;
    for (let j = 0; j < rows; j++) {
      const bottom = low + (high - low) * j / rows + 0.045;
      const top = low + (high - low) * (j + 1) / rows - 0.045;
      facePanel(batch, a, b, n, left + frame, right - frame, bottom, top,
        glassTints[(i * 2 + j) % glassTints.length], 0.048, 0.78);
    }
  }
}

function surveyShell(batch, colliders, { points, faces }, hall) {
  const wallByIndex = new Map();
  for (const [index, roof, ...face] of faces) {
    const rings = face.map(r => r.map(i => points[i]));
    const p = rings[0], n = polygonNormal(p);
    if (n.lengthSq() === 0) continue;
    if (roof) {
      batch.polygon(rings, hall ? 0x545c61 : 0x62686a);
      if (hall ? index === 118 : solarRoofs.has(index)) roofPanels(batch, rings, n);
      continue;
    }
    const ext = wallExtent(p, n), { a, b, width } = ext;
    if (!a || !b || width < 0.06) continue;
    const low = Math.min(...p.map(pt => pt[1])), high = Math.max(...p.map(pt => pt[1]));
    const mid = along(a, b, 0.5), base = terrainHeightAt(mid.x, mid.z);
    const highHall = hall && mid.x < -1932 && low < 0.5 && high > 3.9;
    const color = highHall ? 0x8e9eae : hall ? hallBrick : mid.z > 1126 && n.x > 0.3 ? 0xb89e5c : poolBrick;
    batch.polygon(rings, color);
    if (high > Math.max(base - 0.53, low) + 0.11) colliders.push(...wallColliders(a, b, Math.max(base - 0.53, low), high));
    wallByIndex.set(index, { ...ext, n, low, high, base });
    if (highHall && width > 2.6) {
      const panels = Math.max(2, Math.round(width / 1.75));
      for (let i = 0; i < panels; i++) {
        for (let j = 0; j < 3; j++) {
          const bottom = Math.max(low + 0.02, -4.18) + j * (high + 4.16) / 3;
          const top = bottom + (high + 4.16) / 3 - 0.045;
          const gap = 0.027 / width;
          facePanel(batch, a, b, n, i / panels + gap, (i + 1) / panels - gap,
            bottom, Math.min(top, high - 0.045), panelBlue[(Math.floor(i / 2) * 7 + i + j + index) % panelBlue.length], 0.014);
        }
      }
    }
  }
  return wallByIndex;
}

function signOnEdge(labels, wall, text, u0, u1, lo, hi, color, textColor, offset = 0.065) {
  const { a, b, n } = wall;
  const [p, q] = offsetEdge(along(a, b, u0), along(a, b, u1), n, offset);
  labels.push({ text, a: q, b: p, lo, hi, color, textColor });
}

function poolEntrance(batch, colliders, labels, walls) {
  const signWall = walls.get(120), entry = walls.get(23);
  glazing(batch, signWall, 0.10, 0.97, signWall.base + 0.49, signWall.base + 2.63, 9);
  signOnEdge(labels, signWall, 'DE PEPPEL ZWEMBAD', 0.41, 0.97,
    signWall.base + 3.42, signWall.base + 5.34, 'transparent', '#234e79');
  const { a, b, n, width, base, high } = entry;
  glazing(batch, entry, 0.02, 0.98, base + 0.06, high - 0.36, 8, 3);
  const u = 0.40, v = 0.55;
  glazing(batch, entry, u, v, base + 0.03, base + 2.3, 2, 1, 0x355c88);
  signOnEdge(labels, entry, 'INGANG', u - 0.03, v + 0.03, base + 2.36, base + 2.93, 'transparent', '#174368');
  const front = offsetEdge(a, b, n, 3.4);
  const roofY = high + 0.58;
  const point = (p, y) => [p.x, y, p.z];
  beam(batch, point(a, roofY), point(b, roofY), 0.15, 0.19, 0x254171);
  beam(batch, point(front[0], roofY), point(front[1], roofY), 0.16, 0.26, 0x294477);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, p = along(a, b, t), q = along(...front, t);
    beam(batch, point(p, roofY), point(q, roofY), 0.13, 0.14, 0x294477);
  }
  for (const t of [0.015, 0.34, 0.69, 0.985]) {
    const q = along(...front, t);
    const lower = along(...front, t + (t > 0.9 ? -0.019 : 0.019));
    const ground = terrainHeightAt(lower.x, lower.z);
    beam(batch, point(lower, ground - 0.06), point(q, roofY), 0.19, 0.20, 0x26406c);
    colliders.push({ minX: lower.x - 0.16, maxX: lower.x + 0.16, minZ: lower.z - 0.16,
      maxZ: lower.z + 0.16, minY: ground - 0.06, maxY: roofY });
  }
  for (let i = 0; i < 32; i++) {
    const t = i / 32, u = (i + 1) / 32;
    const wave = k => roofY + 0.67 + Math.sin(k * Math.PI * 6 - 0.4) * 0.32;
    beam(batch, point(along(...front, t), wave(t)), point(along(...front, u), wave(u)), 0.105, 0.098, 0x3271a2);
    if (i % 4 === 0) {
      const p = along(...front, t);
      beam(batch, point(p, roofY - 0.03), point(p, wave(t)), 0.052, 0.062, 0x386285);
    }
  }
  if (width > 8) {
    const left = along(...front, 0.034), right = along(...front, 0.27);
    const back = [along(a, b, 0.034), along(a, b, 0.27)];
    const polygon = [point(left, roofY + 0.077), point(right, roofY + 0.077),
      point(back[1], roofY + 0.077), point(back[0], roofY + 0.077)];
    if (polygonNormal(polygon).y < 0) polygon.reverse();
    batch.quad(...polygon, 0xa5a69d);
  }
}

function hallEntrance(batch, labels, walls) {
  const main = walls.get(106), cafe = walls.get(41), right = walls.get(32);
  signOnEdge(labels, main, 'Sporthal De Peppel', 0.32, 0.91, 1.27, 3.94, 'transparent', '#c9ad6e', 0.052);
  function arch(i) {
    const t = i / 18, p = along(main.a, main.b, 0.55 + t * 0.205);
    return [p.x + main.n.x * 0.08, 2.72 + Math.sin(t * Math.PI) * 1.61 + 0.14 * t, p.z + main.n.z * 0.08];
  }
  for (let i = 0; i < 18; i++) beam(batch, arch(i), arch(i + 1), 0.060, 0.070, 0xbcaa78);
  const { a, b, n, base, high } = cafe;
  // The white-framed sports café cantilevers above the recessed double doors.
  const [frontA, frontB] = offsetEdge(a, b, n, 0.97);
  flatBox(batch, frontA, frontB, high - 3.06, high + 0.10, 1.96, 0xc7c3b5);
  const [ga, gb] = offsetEdge(frontA, frontB, n, 1.00);
  const glazed = { ...cafe, a: ga, b: gb };
  glazing(batch, glazed, 0.047, 0.953, high - 2.71, high - 0.26, 7, 2, 0x303a3e);
  signOnEdge(labels, glazed, 'S P O R T C A F É', 0.14, 0.86, high - 1.72, high - 0.58, 'transparent', '#ece9db', 0.063);
  glazing(batch, cafe, 0.33, 0.65, base + 0.035, base + 2.38, 2, 1, 0x2b4862);
  glazing(batch, right, 0.09, 0.90, right.base + 4.65, right.high - 0.85, 11, 1, 0x797f7e);
  facePanel(batch, right.a, right.b, right.n, 0.09, 0.90, right.high - 0.87, right.high - 0.14, 0x28618b, 0.058);
}

export function createDePeppel() {
  const batch = new CivicBatch(), colliders = [], labels = [];
  poolEntrance(batch, colliders, labels, surveyShell(batch, colliders, PEPPEL_POOL, false));
  hallEntrance(batch, labels, surveyShell(batch, colliders, PEPPEL_HALL, true));
  const group = makeGroup('Zwembad en Sporthal De Peppel', batch, colliders);
  const signs = civicSigns(labels);
  if (signs) {
    const map = signs.material.map, canvas = map.image;
    const cellWidth = 512;
    canvas.width = labels.length * cellWidth;
    canvas.height = 128;
    const uv = signs.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 8 / labels.length);
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 91px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach(({ text, textColor }, i) => {
      const scale = Math.min(1, (cellWidth - 48) / ctx.measureText(text).width);
      ctx.save();
      ctx.translate(cellWidth * (i + 0.5), 67);
      ctx.scale(scale, 1);
      ctx.fillStyle = textColor;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    });
    map.needsUpdate = true;
    signs.material.alphaTest = 0.30;
    group.add(signs);
  }
  return group;
}
