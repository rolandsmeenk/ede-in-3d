import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup, polygonNormal, wallColliders } from './ede-civic-landmarks.js';
import { KEUENKLEP_BENCH, LUNTEREN_MEANDER, LUNTEREN_TILE_PANELS, LUNTEREN_WATERLINE } from './ede-lunteren-art-sites.js';
import { terrainHeightAt } from './terrain.js';

const bronze = 0x393b31;
const verdigris = 0x46574e;
const steel = 0xa8b1b4;
const corten = 0x80503b;
const wood = 0x826b57;
const granite = 0x777676;

function box(batch, x, y, z, width, height, depth, color, rotation = 0) {
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(rotation).translate(x, y, z), color);
}

function oval(batch, x, y, z, width, height, depth, color, rotation = 0) {
  batch.solid(new THREE.SphereGeometry(1, 12, 8).scale(width / 2, height / 2, depth / 2)
    .rotateZ(rotation).translate(x, y, z), color);
}

function rod(batch, a, b, radius, color, endRadius = radius) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  batch.solid(new THREE.CylinderGeometry(endRadius, radius, delta.length(), 8).applyQuaternion(rotation)
    .translate(...start.lerp(end, 0.5)), color);
}

function slab(batch, top, bottomY, color, side = color, sheen = 0) {
  const ring = polygonNormal(top).y < 0 ? [...top].reverse() : top;
  const normal = polygonNormal(ring);
  const axis = Math.abs(normal.y) > Math.abs(normal.z) ? 1 : 2;
  const points = ring.map(p => new THREE.Vector2(p[0], p[axis === 1 ? 2 : 1]));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(points, [])) {
    const face = [ring[i], ring[j], ring[k]];
    if (polygonNormal(face).dot(normal) < 0) face.reverse();
    batch.triangle(...face, color, sheen);
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    batch.quad(a, [a[0], bottomY, a[2]], [b[0], bottomY, b[2]], b, side, sheen);
  }
}

function lettering(labels) {
  if (!labels.length || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256 * labels.length;
  const ctx = canvas.getContext('2d');
  const positions = [], uv = [];
  labels.forEach(({ lines, x, y, z, w, h, tilt = 0, color = '#eee9d6' }, index) => {
    const step = Math.min(76, 200 / lines.length);
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.floor(step * 0.74)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, row) => ctx.fillText(line, 256, index * 256 + 128 + (row - (lines.length - 1) / 2) * step, 460));
    const dy = Math.cos(tilt) * h / 2, dz = Math.sin(tilt) * h / 2;
    const bottom = 1 - (index + 1) / labels.length, top = 1 - index / labels.length;
    const corners = [[x - w / 2, y - dy, z + dz], [x + w / 2, y - dy, z + dz],
      [x + w / 2, y + dy, z - dz], [x - w / 2, y + dy, z - dz]];
    const texCoords = [[0, bottom], [1, bottom], [1, top], [0, top]];
    for (const vertex of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[vertex]);
      uv.push(...texCoords[vertex]);
    }
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map, alphaTest: 0.45, roughness: 0.83, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  mesh.userData.nearDetail = 32;
  return mesh;
}

function makeProp(site, draw) {
  const batch = new CivicBatch(), labels = [], colliders = [];
  const ground = terrainHeightAt(site.x, site.z);
  const cs = Math.cos(site.heading), sn = Math.sin(site.heading);
  const world = (x, z) => ({ x: site.x + x * cs + z * sn, z: site.z - x * sn + z * cs });
  const block = (x, z, width, depth, height) => colliders.push(...wallColliders(
    world(x - width / 2, z), world(x + width / 2, z), ground - 0.08, ground + height, depth));
  draw(batch, labels, block, world, ground);
  const group = makeGroup(site.name, batch, colliders);
  group.position.set(site.x, ground, site.z);
  group.rotation.y = site.heading;
  const detail = lettering(labels);
  if (detail) group.add(detail);
  return group;
}

function diTengahOmbak(batch, labels, block) {
  box(batch, 0, 0.54, 0, 1.64, 1.17, 0.83, 0x3c3c38);
  box(batch, 0, 1.14, 0, 1.69, 0.07, 0.87, 0x494944);
  box(batch, 0, 1.20, 0, 1.53, 0.06, 0.76, 0x383b34);
  labels.push({ lines: ['DI TENGAH OMBAK'], x: 0, y: 1.2, z: 0.381, w: 1.29, h: 0.065, color: '#b6a389' });
  const waves = [
    [-0.56, -0.19, 0.39, 0.23], [-0.08, 0.20, 0.48, 0.22], [0.47, 0.17, 0.45, 0.24],
    [0.56, -0.23, 0.34, 0.19], [-0.42, 0.23, 0.35, 0.20], [0.12, -0.28, 0.32, 0.17],
  ];
  waves.forEach(([x, z, w, h], i) => {
    const rock = new THREE.IcosahedronGeometry(1, 2).scale(w / 2, h / 2, 0.14)
      .rotateZ(i % 2 ? -0.37 : 0.45).translate(x, 1.25 + h * 0.12, z);
    batch.solid(rock, i % 2 ? bronze : verdigris);
  });

  const sections = [[-0.91, 1.48, 0.012], [-0.72, 1.38, 0.10], [-0.34, 1.36, 0.15],
    [0.15, 1.39, 0.14], [0.59, 1.47, 0.095], [0.92, 1.62, 0.008]];
  for (let i = 1; i < sections.length; i++) {
    const [x, y, w] = sections[i - 1], [ex, ey, ew] = sections[i];
    for (const side of [-1, 1]) {
      const a = [x, y, side * w], b = [ex, ey, side * ew];
      const face = [a, [x, y - 0.08, side * w * 0.37], [ex, ey - 0.08, side * ew * 0.37], b];
      if (side < 0) face.reverse();
      batch.quad(...face, bronze, 0.45);
      rod(batch, a, b, 0.012, 0x525044);
    }
    batch.quad([ex, ey - 0.03, -ew], [x, y - 0.03, -w], [x, y - 0.03, w], [ex, ey - 0.03, ew], 0x272b24);
  }
  rod(batch, [-0.63, 1.34, 0.35], [0.61, 1.37, 0.36], 0.027, bronze, 0.013);
  for (const x of [-0.35, 0.35]) rod(batch, [x, 1.43, 0.07], [x, 1.36, 0.37], 0.013, bronze);
  oval(batch, -0.53, 1.48, 0, 0.11, 0.21, 0.11, bronze, -0.23);
  oval(batch, -0.56, 1.62, 0, 0.086, 0.097, 0.08, bronze);
  rod(batch, [-0.54, 1.54, 0.043], [-0.45, 1.49, 0.13], 0.023, bronze, 0.016);
  rod(batch, [-0.44, 1.61, 0.10], [-0.38, 1.28, 0.27], 0.011, bronze);
  oval(batch, -0.38, 1.30, 0.25, 0.052, 0.14, 0.018, verdigris, -0.18);
  block(0, 0, 1.65, 0.85, 1.20);
}

function luntersVrouwtje(batch, _labels, block) {
  box(batch, 0, 0.05, 0, 0.83, 0.20, 0.70, 0x767367);
  batch.solid(new THREE.BoxGeometry(0.55, 0.70, 0.52).translate(0, 0.42, 0), 0x958c7c);
  for (let i = 0; i < 88; i++) {
    const edge = i % 4, r = Math.sin(i * 85.71) * 0.49;
    const x = edge % 2 ? (edge === 1 ? -0.272 : 0.272) : r * 0.52;
    const z = edge % 2 ? r * 0.49 : (edge === 0 ? -0.258 : 0.258);
    const y = 0.11 + (i + 0.5) / 88 * 0.63;
    batch.solid(new THREE.IcosahedronGeometry(1, 0).scale(0.016, 0.011, 0.013).translate(x, y, z),
      [0xaaa28e, 0x6c6a63, 0xc0b6a4][i % 3]);
  }
  const skirt = [[0.17, 0.84], [0.18, 0.87], [0.148, 1.02], [0.13, 1.23], [0.105, 1.37]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  batch.solid(new THREE.LatheGeometry(skirt, 20).scale(1, 1, 0.72), bronze);
  for (const x of [-0.064, 0.063]) oval(batch, x, 0.815, 0.049, 0.09, 0.09, 0.15, bronze);
  oval(batch, 0, 1.45, -0.016, 0.239, 0.328, 0.165, bronze, 0.065);
  oval(batch, -0.024, 1.698, 0.0, 0.156, 0.193, 0.155, 0x4a4b40);
  oval(batch, -0.025, 1.685, 0.047, 0.107, 0.145, 0.126, bronze);
  oval(batch, -0.027, 1.677, 0.108, 0.034, 0.036, 0.045, bronze);
  rod(batch, [-0.08, 1.52, -0.015], [-0.135, 1.37, 0.015], 0.059, bronze, 0.04);
  rod(batch, [-0.135, 1.37, 0.015], [-0.106, 1.26, 0.071], 0.042, bronze, 0.031);
  rod(batch, [0.085, 1.52, -0.017], [0.135, 1.40, 0.014], 0.052, bronze, 0.04);
  rod(batch, [0.135, 1.40, 0.014], [0.066, 1.433, 0.091], 0.038, bronze, 0.029);
  box(batch, 0.059, 1.405, 0.09, 0.105, 0.142, 0.039, 0x252922, 0.21);
  block(0, 0, 0.82, 0.69, 1.80);
}

function goudsbergArrow(batch, labels, block, world, ground) {
  const rim = [[-0.82, 0.17, 0.61], [0.82, 0.17, 0.61], [0, 0.46, -0.96]];
  slab(batch, rim, -0.07, corten, 0x653a2b);
  labels.push({ lines: ['2462 M', 'MIDDELPUNT', 'VAN NEDERLAND'],
    x: 0, y: 0.28, z: 0.09, w: 1.08, h: 0.71, tilt: 1.388, color: '#33281f' });
  block(0, 0.2, 1.25, 1.15, 0.36);
  const viewer = world(0.22, -2.7), base = terrainHeightAt(viewer.x, viewer.z) - ground;
  for (const x of [-0.35, 0.35]) rod(batch, [x + 0.22, base - 0.04, -2.70], [0.22 + x * 0.24, base + 1.39, -2.70], 0.024, corten);
  box(batch, 0.22, base + 1.48, -2.72, 0.26, 0.36, 0.23, corten);
  oval(batch, 0.22, base + 1.52, -2.593, 0.103, 0.103, 0.014, 0x35342c);
  block(0.22, -2.7, 0.43, 0.32, base + 1.68);
}

function deBron(batch, labels, block, world, ground) {
  const phrases = ['KLEIN DE DRUPPEL', 'VERBORGEN IN LAGEN VAN TIJD', 'OPWELLEND HET WATER', 'ONMISBAAR VOOR DE MENSHEID'];
  for (let i = 0; i < 4; i++) {
    const center = (i - 1.5) * 1.39;
    const section = [];
    for (let j = 0; j <= 22; j++) {
      const t = j / 22;
      const x = (t - 0.5) * (2.28 + i * 0.055);
      const z = center + Math.sin(t * Math.PI * 2 + i * 0.24) * 0.31;
      const point = world(x, z);
      const y = terrainHeightAt(point.x, point.z) - ground + 0.18 + 0.16 * Math.sin(t * Math.PI);
      const width = 0.013 + 0.29 * Math.sin(t * Math.PI);
      section.push([[x, y, z - width], [x, y, z + width]]);
    }
    for (let j = 1; j < section.length; j++) {
      const [a, b] = section[j - 1], [c, d] = section[j];
      const [p, q] = [a, b].map(([x, , z]) => {
        const point = world(x, z);
        return [x, terrainHeightAt(point.x, point.z) - ground - 0.04, z];
      });
      const [r, s] = [c, d].map(([x, , z]) => {
        const point = world(x, z);
        return [x, terrainHeightAt(point.x, point.z) - ground - 0.04, z];
      });
      batch.quad(a, b, d, c, steel, 0.96);
      batch.quad(a, c, r, p, 0x899599, 0.82);
      batch.quad(b, q, s, d, 0x899599, 0.82);
    }
    const [a, b] = section[11];
    labels.push({ lines: [phrases[i]], x: a[0], y: a[1] + 0.013, z: (a[2] + b[2]) / 2,
      w: 0.94, h: 0.16, tilt: Math.PI / 2, color: '#4e5557' });
  }
  block(0, 0, 2.45, 4.92, 0.35);
}

function surfaceQuad(batch, corners, color, sheen = 0) {
  const [a, b, c, d] = corners.map(({ x, z, lift }) => [x, terrainHeightAt(x, z) + lift, z]);
  if (polygonNormal([a, b, c]).y > 0) batch.quad(a, b, c, d, color, sheen);
  else batch.quad(d, c, b, a, color, sheen);
}

function deMeander(site) {
  const batch = new CivicBatch();
  const path = new THREE.CatmullRomCurve3(LUNTEREN_MEANDER.map(({ x, z }) => new THREE.Vector3(x, 0, z)));
  const ribbon = (t, side, lift) => {
    const p = path.getPointAt(t), d = path.getTangentAt(t);
    return { x: p.x - d.z * side, z: p.z + d.x * side, lift };
  };
  for (let i = 0; i < 48; i++) {
    const t = i / 48, next = (i + 1) / 48;
    surfaceQuad(batch, [ribbon(t, -0.32, 0.069), ribbon(t, 0.32, 0.069),
      ribbon(next, 0.32, 0.069), ribbon(next, -0.32, 0.069)], i % 3 ? 0x3a627f : 0x426b85);
    if (i % 5 === 0) surfaceQuad(batch, [ribbon(t, -0.07, 0.072), ribbon(t, 0.07, 0.072),
      ribbon(t + 0.008, 0.1, 0.072), ribbon(t + 0.01, -0.065, 0.072)], steel, 0.97);
  }
  for (let i = 1; i < LUNTEREN_WATERLINE.length; i++) {
    const a = LUNTEREN_WATERLINE[i - 1], b = LUNTEREN_WATERLINE[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz), count = Math.max(1, Math.round(length / 1.28));
    for (let j = 0; j < count; j++) {
      const t = (j + 0.5) / count;
      const offset = Math.sin((i * 14 + j) * 1.14) * 0.14;
      const x = a.x + dx * t - dz / length * offset;
      const z = a.z + dz * t + dx / length * offset;
      const corners = [[-0.09, -0.042], [0.085, -0.033], [0.105, 0.033], [-0.066, 0.052]]
        .map(([u, v]) => ({ x: x + (u * dx - v * dz) / length, z: z + (u * dz + v * dx) / length, lift: 0.070 }));
      surfaceQuad(batch, corners, steel, 0.92);
    }
  }
  const group = makeGroup(site.name, batch, []);
  group.children[0].castShadow = false;
  for (const [t, text] of [[0.56, 'SMAL DE GEUL'], [0.79, 'WATER VAN VELUW’ TOT VALLEI']]) {
    const p = path.getPointAt(t), d = path.getTangentAt(t);
    const label = lettering([{ lines: [text], x: 0, y: 0, z: 0, w: 1.5, h: 0.22,
      tilt: Math.PI / 2, color: '#b9c4c7' }]);
    if (!label) continue;
    label.position.set(p.x, terrainHeightAt(p.x, p.z) + 0.079, p.z);
    label.rotation.y = Math.atan2(-d.z, d.x);
    group.add(label);
  }
  return group;
}

function liberationBench(batch, labels, block) {
  const iron = 0x303d36;
  box(batch, 0, 0.21, -0.06, 2.60, 0.48, 0.42, 0x755344);
  for (const x of [-1.51, 1.51]) {
    box(batch, x, 0.38, 0, 0.49, 0.84, 0.59, 0x7e5c4a);
    for (let y = 0.075; y < 0.79; y += 0.069) box(batch, x, y, 0, 0.495, 0.006, 0.595, 0x9b9282);
  }
  box(batch, -1.51, 0.37, 0.299, 0.50, 0.50, 0.014, granite);
  labels.push({ lines: ['1945 · 1995', '50 JAAR BEVRIJDING', 'LUNTEREN 16 APRIL 1945', '5 CANADIAN ARMOURED DIVISION'],
    x: -1.51, y: 0.37, z: 0.307, w: 0.455, h: 0.35, color: '#383735' });
  for (const z of [-0.14, 0.012, 0.16]) box(batch, 0, 0.461, z, 2.58, 0.046, 0.145, wood);
  const arch = [];
  for (let i = 0; i <= 20; i++) {
    const x = (i - 10) * 0.205;
    const dome = Math.sqrt(Math.max(0, 1 - (x / 2.08) ** 2));
    arch.push(new THREE.Vector3(x, 0.23 + dome * 1.35, -0.33 - 0.07 * dome));
    if (i === 0 || i === 20 || i === 10) continue;
    const top = 0.36 + dome * 1.08;
    const slant = Math.sign(x) * 0.34 * (1 - Math.abs(x) / 3);
    const z = -0.33 - 0.07 * dome;
    batch.quad([x - 0.097 + slant, 0.49, z + 0.17], [x + 0.097 + slant, 0.49, z + 0.17],
      [x + 0.097, top, z], [x - 0.097, top, z], i % 2 ? 0x8e7f6d : wood);
  }
  batch.solid(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arch), 38, 0.037, 8, false), iron);
  batch.quad([-0.085, 0.65, -0.286], [0.085, 0.65, -0.286], [0.22, 1.46, -0.392], [-0.22, 1.46, -0.392], iron);
  const leaf = [[0, 0.14], [0.033, 0.055], [0.083, 0.076], [0.071, 0.02], [0.135, 0.03],
    [0.104, -0.026], [0.12, -0.046], [0.009, -0.061], [0.008, -0.11], [-0.008, -0.11],
    [-0.009, -0.061], [-0.12, -0.046], [-0.104, -0.026], [-0.135, 0.03], [-0.071, 0.02],
    [-0.083, 0.076], [-0.033, 0.055]];
  batch.polygon([leaf.map(([x, y]) => [x, 1.22 + y, -0.354 - y * 0.13]).reverse()], 0xc6b5a3);
  block(0, 0, 3.49, 0.63, 0.9);
}

function liberationTile(batch, labels, block) {
  const tilt = Math.atan2(0.30, 0.42);
  const cs = Math.cos(tilt), sn = Math.sin(tilt);
  slab(batch, [[-0.21, 0.7, 0.15], [0.21, 0.7, 0.15], [0.21, 1.12, -0.15], [-0.21, 1.12, -0.15]],
    -0.05, 0x976753, 0x7e503e);
  const ceramic = (x, u, width, height, color, relief = 0) => batch.solid(
    new THREE.BoxGeometry(width, height, 0.012).rotateX(-tilt)
      .translate(x, 0.91 + u * cs, 0.012 - u * sn + relief), color);
  ceramic(0, 0, 0.355, 0.435, 0x363e40);
  for (const [u, color] of [[0.114, 0xa84a45], [0.045, 0xe2d5bd], [-0.025, 0x6290a2]]) {
    ceramic(0, u, 0.259, 0.073, color, 0.008);
  }
  for (const x of [-0.149, 0.149]) ceramic(x, 0, 0.042, 0.37, 0xcbaa76, 0.008);
  ceramic(-0.022, -0.015, 0.077, 0.224, 0xd8cbb2, 0.018);
  ceramic(-0.021, 0.069, 0.016, 0.173, 0x5b685f, 0.023);
  ceramic(0.031, -0.111, 0.139, 0.064, 0x455b50, 0.017);
  ceramic(0.005, -0.17, 0.232, 0.045, 0xd2b787, 0.011);
  labels.push({ lines: ['BEVRIJDING'], x: 0.005, y: 0.91 - 0.17 * cs,
    z: 0.034 + 0.17 * sn, w: 0.205, h: 0.047, tilt, color: '#333632' });
  batch.solid(new THREE.IcosahedronGeometry(1, 2).scale(0.45, 0.39, 0.33)
    .rotateZ(-0.14).translate(-0.52, 0.27, -0.39), 0x777265);
  block(0, 0, 0.42, 0.30, 1.13);
  block(-0.52, -0.39, 0.87, 0.65, 0.64);
}

function rock(batch, points, depth, color, base = 0) {
  const rim = points.map(([x, y]) => [x, y + base, depth / 2]);
  const face = points.map(([x, y]) => [x * 0.86, y * 0.92 + base, depth * 0.72]);
  const back = points.map(([x, y]) => [x * 0.77, y * 0.91 + base, -depth * 0.65]);
  batch.polygon([face], color[0]);
  batch.polygon([[...back].reverse()], color[2]);
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    batch.quad(face[i], rim[i], rim[j], face[j], color[1 + i % 2]);
    batch.quad(rim[i], back[i], back[j], rim[j], color[1 + i % 2]);
  }
}

function cemeteryStone(batch, labels, block) {
  box(batch, 0, 0.06, 0.13, 1.57, 0.20, 0.84, 0x8a8275);
  box(batch, 0, 0.16, -0.04, 0.98, 0.20, 0.44, 0x756a65);
  rock(batch, [[-0.38, 0], [0.4, 0.01], [0.42, 0.24], [0.34, 0.75], [0.08, 0.94], [-0.09, 0.96],
    [-0.35, 0.73], [-0.42, 0.30]], 0.16, [0x7c706d, 0x6c615a, 0x8b7c72], 0.22);
  labels.push({ lines: ['1940–1945', 'LATEN WIJ HET', 'NIET VERGETEN'], x: 0, y: 0.73, z: 0.118, w: 0.62, h: 0.33 });
  for (let i = 0; i < 55; i++) {
    const x = ((i * 23) % 55 / 54 - 0.5) * 1.48;
    const z = 0.23 + Math.sin(i * 94.9) * 0.25;
    batch.solid(new THREE.IcosahedronGeometry(1, 0).scale(0.05, 0.019, 0.0325).translate(x, 0.163, z),
      [0x938877, 0x786e65, 0xa69c8e][i % 3]);
  }
  block(0, 0.08, 1.56, 0.84, 1.18);
}

function keuenklepStone(batch, labels, block) {
  const points = [[-0.69, -0.045], [0.73, -0.045], [0.77, 0.29], [0.62, 0.82], [0.33, 1.19],
    [-0.13, 1.28], [-0.51, 1.15], [-0.72, 0.63], [-0.78, 0.28]];
  const bottom = points.map(([x, y]) => [x * 0.85, y * 0.87, -0.48]);
  const back = points.map(([x, y], i) => [x * 1.08, y * (i > 3 ? 1.02 : 0.87), -0.20]);
  const face = points.map(([x, y]) => [x * 0.88, y, 0.57 - y * 0.455]);
  batch.polygon([face], 0x8f8072);
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    batch.quad(face[i], back[i], back[j], face[j], i % 2 ? 0x786e62 : 0x9c8b75);
    batch.quad(back[i], bottom[i], bottom[j], back[j], 0x6e6255);
  }
  batch.polygon([[...bottom].reverse()], 0x70655a);
  labels.push({ lines: ['DE FATALE WAPENDROPPING', '8 OP 9 MAART 1945', 'DE KEUENKLEP', 'BEN VERDUIJN'], x: 0, y: 0.75,
    z: 0.232, w: 0.83, h: 0.54, tilt: Math.atan(0.455) });
  block(0, 0, 1.48, 1.09, 1.27);
}

function keuenklepBench(batch, labels, block) {
  const green = 0x485743;
  for (const x of [-0.71, 0.71]) {
    box(batch, x, 0.19, 0, 0.15, 0.52, 0.48, green);
    box(batch, x, 0.67, -0.21, 0.12, 0.62, 0.10, green);
  }
  for (const z of [-0.12, 0.023, 0.16]) box(batch, 0, 0.46, z, 1.79, 0.078, 0.126, green);
  box(batch, 0, 0.83, -0.19, 1.78, 0.24, 0.078, green);
  box(batch, 0.63, 0.818, -0.148, 0.22, 0.093, 0.012, 0x897549);
  labels.push({ lines: ['DE KEUENKLEP'], x: -0.13, y: 0.838, z: -0.15, w: 1.05, h: 0.135, color: '#b4b08e' });
  block(0, 0, 1.78, 0.5, 0.94);
}

function ceramicPanel(batch, style) {
  const dark = 0x283f46, white = 0xe3dac0, green = 0x496158, red = 0x9d5045;
  box(batch, 0, 1.61, 0, 0.65, 0.66, 0.038, style === 'landleven' ? dark : red);
  if (style === 'landleven') {
    for (const [x, y, w, h] of [[0, 1.62, 0.37, 0.335], [0, 1.875, 0.17, 0.15],
      [0, 1.36, 0.17, 0.14], [-0.249, 1.62, 0.15, 0.149], [0.249, 1.62, 0.15, 0.149],
      [0, 1.885, 0.59, 0.043], [0, 1.375, 0.59, 0.032]]) box(batch, x, y, 0.023, w, h, 0.013, white);
    batch.polygon([[[0, 1.77, 0.034], [-0.10, 1.69, 0.034], [-0.12, 1.48, 0.034], [-0.02, 1.52, 0.034],
      [0, 1.68, 0.034], [0.02, 1.52, 0.034], [0.12, 1.48, 0.034], [0.10, 1.69, 0.034]]], dark);
    for (const [x, y] of [[0, 1.86], [0, 1.34], [-0.25, 1.62], [0.25, 1.62]]) {
      oval(batch, x, y, 0.032, 0.070, 0.080, 0.012, dark);
      for (const side of [-1, 1]) oval(batch, x + side * 0.044, y + 0.024, 0.033, 0.04, 0.020, 0.013, dark, side * -0.6);
    }
  } else {
    for (const x of [-0.234, 0, 0.234]) {
      const w = x ? 0.175 : 0.27;
      for (const [y, h, color] of [[1.825, 0.135, x ? green : white], [1.61, 0.282, white],
        [1.408, 0.108, x ? green : white], [1.32, 0.052, x ? 0xc8a24f : white]]) {
        box(batch, x, y, 0.024, w, h, 0.014, color);
      }
    }
    oval(batch, 0, 1.829, 0.034, 0.109, 0.124, 0.014, dark);
    for (const x of [-0.232, -0.065, 0.061, 0.231]) {
      const y = 1.55 + Math.abs(x) * 0.28;
      rod(batch, [x, y - 0.065, 0.036], [x + 0.015, y + 0.07, 0.036], 0.005, green);
      for (const [u, v] of [[0, 0.066], [0.016, 0.082], [0.034, 0.068], [0.016, 0.051]]) {
        oval(batch, x + u, y + v, 0.036, 0.032, 0.026, 0.008, Math.abs(x) > 0.1 ? 0xcbb05f : red);
      }
    }
  }
}

function tegelroute(site) {
  const group = new THREE.Group();
  group.userData.colliders = [];
  for (const panel of LUNTEREN_TILE_PANELS) {
    group.add(makeProp({ ...site, ...panel }, (batch, labels) => {
      ceramicPanel(batch, panel.style);
      if (panel.style === 'hugo-de-vries') labels.push({
        lines: ['HUGO DE VRIES'], x: 0, y: 1.32, z: 0.032, w: 0.27, h: 0.057, color: '#303e43',
      });
    }));
  }
  return group;
}

export const EDE_LUNTEREN_ART_LANDMARK_FACTORIES = {
  'di-tengah-ombak': (_, site) => makeProp(site, diTengahOmbak),
  'lunters-vrouwtje': (_, site) => makeProp(site, luntersVrouwtje),
  'goudsberg-pijlpunt-nieuwe-erf': (_, site) => makeProp(site, goudsbergArrow),
  'de-bron-lunteren': (_, site) => makeProp(site, deBron),
  'de-meander-lunteren': (_, site) => deMeander(site),
  'lunteren-centraal-monument': (_, site) => makeProp(site, liberationBench),
  'lunteren-bevrijdingstegel': (_, site) => makeProp(site, liberationTile),
  'lunteren-gedenksteen-kerkhoflaan': (_, site) => makeProp(site, cemeteryStone),
  'de-keuenklep': (_, site) => {
    const model = makeProp(site, keuenklepStone);
    const bench = makeProp({ ...site, ...KEUENKLEP_BENCH }, keuenklepBench);
    // The two memorials have independent ground elevations.
    const group = new THREE.Group();
    group.add(model, bench);
    group.userData.colliders = [...model.userData.colliders, ...bench.userData.colliders];
    return group;
  },
  'lunteren-tegelroute': (_, site) => tegelroute(site),
};
