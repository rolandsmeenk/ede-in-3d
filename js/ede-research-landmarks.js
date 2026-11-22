import * as THREE from 'three/webgpu';
import { CivicBatch, along, facePanel, offsetEdge, polygonNormal, wallColliders, wallExtent } from './ede-civic-landmarks.js';
import { NIZO_SURVEY, GELDERSE_VALLEI_SURVEY } from './ede-research-survey.js';
import { createNizoNorthLandmark } from "./ede-industrial-skyline-landmarks.js";
import { terrainHeightAt } from './terrain.js';

const buff = 0xbeb39a;
const paleConcrete = 0xd3cfc1;
const nizoBrick = 0x927962;
const pinkShade = 0xb35462;
const glass = 0x405966;
const glassDark = 0x344650;
const zinc = 0x606969;
const hospitalBrick = 0xa07968;
const hospitalWhite = 0xd7d8d4;

function prism(batch, a, b, low, high, depth, color) {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length <= 0 || high <= low) return;
  const geometry = new THREE.BoxGeometry(length, high - low, depth)
    .rotateY(-Math.atan2(b.z - a.z, b.x - a.x)).translate((a.x + b.x) / 2, (low + high) / 2, (a.z + b.z) / 2);
  batch.solid(geometry, color);
}

function beam(batch, a, b, width, color) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const direction = to.clone().sub(from);
  const center = from.add(to).multiplyScalar(0.5);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  batch.solid(new THREE.BoxGeometry(width, direction.length(), width)
    .applyQuaternion(rotation).translate(center.x, center.y, center.z), color);
}

function plaque(label, a, b, y, h, tint = '#143840', ink = '#ffffff') {
  if (typeof document === 'undefined') return null;
  const width = Math.hypot(b.x - a.x, b.z - a.z);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.min(384, Math.max(64, Math.round(512 * h / width)));
  const context = canvas.getContext('2d');
  if (!context) return null;
  if (tint) {
    context.fillStyle = tint;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.fillStyle = ink;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lines = label.split('\n');
  lines.forEach((line, i) => {
    const size = lines.length === 1 ? 0.67 : i ? 0.65 : 0.27;
    context.font = `bold ${Math.round(canvas.height * size)}px sans-serif`;
    const baseline = lines.length === 1 ? 0.5 : i ? 0.67 : 0.22;
    context.fillText(line, canvas.width / 2, canvas.height * baseline, 478);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.86, transparent: !tint }));
  mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
  mesh.name = label;
  return mesh;
}

function surfaceInfo(rings, index, roof) {
  const points = rings[0];
  const normal = polygonNormal(points);
  const { a, b, width } = wallExtent(points, normal);
  const low = Math.min(...points.map(p => p[1]));
  const high = Math.max(...points.map(p => p[1]));
  return { a, b, width, normal, low, high, index, roof,
    center: along(a, b, 0.5) };
}

function campuses(name, survey, decorate) {
  const group = new THREE.Group(), fine = new THREE.Group();
  group.name = name;
  fine.name = name + ' entrance details';
  fine.userData.nearDetail = true;
  const base = new CivicBatch(), detail = new CivicBatch(), colliders = [];
  group.userData.colliders = colliders;
  for (const volume of survey) {
    for (const [index, face] of volume.surfaces.entries()) {
      if (!face) continue;
      const [roof, ...ids] = face;
      const rings = ids.map(ring => ring.map(vertex => volume.vertices[vertex]));
      const wall = surfaceInfo(rings, index, roof);
      if (!wall.a || wall.normal.lengthSq() === 0) continue;
      const { normal, low, high, width, a, b, center } = wall;
      decorate(group, fine, base, detail, volume, wall, rings);
      if (roof || Math.abs(normal.y) > 0.17 || high - low < 0.4 || width < 0.3) continue;
      const ground = terrainHeightAt(center.x, center.z);
      // Extend only full-height walls where the modeled slab misses the local DTM.
      const touchesGrade = low - ground < 1.4;
      const foundation = Math.min(low, terrainHeightAt(a.x, a.z) - 0.09, terrainHeightAt(b.x, b.z) - 0.09);
      if (touchesGrade && foundation < low - 0.05)
        facePanel(base, a, b, normal, 0, 1, foundation, low + 0.005, 0x8c8981, 0);
      colliders.push(...wallColliders(a, b, touchesGrade ? foundation : low, high));
    }
  }
  group.add(base.mesh());
  if (detail.vertices.length) fine.add(detail.mesh());
  if (fine.children.length) group.add(fine);
  return group;
}

function glazing(batch, detail, wall, u0, u1, low, high, columns, rows = 1) {
  const { a, b, normal, width } = wall;
  if (high - low < 0.10 || width * (u1 - u0) < 0.3) return;
  facePanel(batch, a, b, normal, u0, u1, low, high, glass, 0.027, 1);
  const half = 0.036 / width;
  for (let i = 0; i <= columns; i++) {
    const at = u0 + (u1 - u0) * i / columns;
    facePanel(detail, a, b, normal, Math.max(u0, at - half), Math.min(u1, at + half), low, high, paleConcrete, 0.06);
  }
  for (let i = 0; i <= rows; i++) {
    const at = low + (high - low) * i / rows;
    facePanel(detail, a, b, normal, u0, u1, Math.max(low, at - 0.036), Math.min(high, at + 0.036), paleConcrete, 0.061);
  }
}

function insetRows(batch, detail, wall, masonry, rows) {
  const { a, b, normal, low, high, width } = wall;
  const point = (u, y, offset = 0) => {
    const p = along(a, b, u);
    return [p.x + normal.x * offset, y, p.z + normal.z * offset];
  };
  const rect = (l, r, bottom, top, offset = 0) =>
    [point(l, bottom, offset), point(r, bottom, offset), point(r, top, offset), point(l, top, offset)];
  const outer = rect(0, 1, low, high);
  const holes = rows.flatMap(row => row.map(([l, r, bottom, top]) => rect(l, r, bottom, top)));
  batch.polygon([outer, ...holes], masonry);
  for (const row of rows) for (const [l, r, bottom, top] of row) {
    const outside = rect(l, r, bottom, top), reveal = rect(l, r, bottom, top, -0.17);
    batch.quad(...reveal, glassDark, 1);
    for (let k = 0; k < 4; k++) {
      const next = (k + 1) % 4;
      batch.quad(outside[k], outside[next], reveal[next], reveal[k], 0xa8a18f);
    }
    const half = 0.03 / width;
    const midpoint = (l + r) / 2;
    facePanel(detail, a, b, normal, midpoint - half, midpoint + half, bottom, top, paleConcrete, -0.14);
  }
}

function nizoFacade(base, detail, wall, rings) {
  const { a, b, normal, low, high, width } = wall;
  const count = Math.round(width / 1.9);
  const rows = [[-1.75, -0.1], [1.08, 3.18], [4.88, 6.9]].map(([bottom, top]) =>
    Array.from({ length: count }, (_, i) => [(i + 0.14) / count, (i + 0.86) / count, bottom, top]));
  insetRows(base, detail, wall, buff, rows);
  for (let i = 0; i <= count; i++) {
    const at = i / count;
    const [p, q] = offsetEdge(along(a, b, Math.max(0, at - 0.075 / width)),
      along(a, b, Math.min(1, at + 0.075 / width)), normal, 0.09);
    prism(detail, p, q, Math.max(low, -2.25), high - 0.18, 0.19, paleConcrete);
  }
  for (const floor of rows.slice(1)) for (const [l, r, , top] of floor) {
    const p = along(a, b, l), q = along(a, b, r);
    const [frontP, frontQ] = offsetEdge(p, q, normal, 0.74);
    detail.quad([p.x, top + 0.48, p.z], [frontP.x, top - 0.23, frontP.z],
      [frontQ.x, top - 0.23, frontQ.z], [q.x, top + 0.48, q.z], pinkShade);
    facePanel(detail, a, b, normal, l, r, top - 0.37, top - 0.22, pinkShade, 0.738);
  }
  // The thin roof rim is distinct even with the near-view mullions culled.
  facePanel(base, a, b, normal, 0, 1, high - 0.36, high - 0.02, 0x434643);
  // The LoD survey carries a small roof slope. Keep its cap above the planar insert.
  if (rings[0].some(p => p[1] < high - 0.08 && p[1] > high - 0.5))
    facePanel(base, a, b, normal, 0, 1, high - 0.44, high - 0.17, nizoBrick);
}

function nizoEntrance(group, fine, base, detail, wall) {
  const { a, b, normal } = wall;
  const vestibule = { a: { x: -622.17, z: -664.28 }, b: { x: -614.70, z: -663.87 },
    normal: { x: -0.055, y: 0, z: 0.998 }, width: 7.48 };
  const { a: nearA, b: nearB, normal: n } = vestibule;
  const grade = terrainHeightAt(-618.4, -659.8);
  const floor = grade + 0.43;
  prism(base, nearA, nearB, grade - 0.50, floor, 1.30, 0x605c56);
  prism(base, nearA, nearB, grade - 0.44, grade + 0.20, 2.44, 0x74716a);
  group.userData.colliders.push(...wallColliders(nearA, nearB, grade, 8.11, 0.22));
  group.userData.platforms = [[0, 0.65, floor], [0.65, 1.22, grade + 0.20]].map(([inner, outer, y], i) => {
    const [a, b] = offsetEdge(nearA, nearB, n, inner);
    const [c, d] = offsetEdge(nearA, nearB, n, outer);
    return { id: `nizo-entrance-${i}`, outer: [a, b, d, c], holes: [], height: () => y };
  });
  facePanel(base, nearA, nearB, n, 0, 1, floor, 8.11, nizoBrick);
  glazing(base, detail, vestibule, 0.09, 0.91, floor + 2.72, 7.71, 6, 5);
  glazing(base, detail, vestibule, 0.19, 0.81, floor, floor + 2.59, 4, 1);
  for (const f of [0.04, 0.96])
    facePanel(detail, nearA, nearB, n, f - 0.02, f + 0.02, floor, 8.10, paleConcrete, 0.15);
  for (const x of [-620.6, -616.0]) beam(detail, [x, floor, -662.52], [x, floor + 2.97, -662.52], 0.10, zinc);
  const [canopyA, canopyB] = offsetEdge(nearA, nearB, n, 0.73);
  prism(base, canopyA, canopyB, floor + 2.76, floor + 2.96, 1.62, zinc);
  const [signA, signB] = offsetEdge(along(nearA, nearB, 0.25), along(nearA, nearB, 0.75), n, 0.17);
  const sign = plaque('NIZO', signA, signB, 8.43, 0.77, '#373b37');
  if (sign) fine.add(sign);
  facePanel(base, a, b, normal, 0, 1, wall.low, wall.high, nizoBrick, 0.03);
  group.userData.entrance = { x: -618.4, z: -659.8 };
}

function spiral(fine) {
  const batch = new CivicBatch();
  // The apartment-side recess between CityJSON walls 9 and 10 on building F.
  const x = -655.84, z = -791.92;
  const grade = terrainHeightAt(x, z);
  const start = -0.59, turns = 3, steps = 48;
  const inner = 0.24, outer = 1.48, rise = 3.03;
  const radial = (angle, radius, y) => [x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius];
  const angle = i => start + Math.PI * 2 * turns * i / steps;
  const height = i => grade + rise * turns * i / steps;
  beam(batch, [x, grade, z], [x, height(steps) + 0.33, z], 0.20, 0x3b4446);
  for (let i = 0; i < steps; i++) {
    const y = height(i), p = angle(i), q = angle(i + 1);
    const tread = level => [radial(p, inner, level), radial(q, inner, level),
      radial(q, outer, level), radial(p, outer, level)];
    const top = tread(y), underside = tread(y - 0.065).reverse();
    batch.quad(...top, 0x3b4649);
    batch.quad(...underside, 0x414b4e);
    batch.quad(top[3], top[0], underside[3], underside[0], 0x3b4649);
    const nextY = height(i + 1);
    batch.quad(radial(q, outer, nextY), radial(p, outer, y), radial(p, outer, y + 0.92),
      radial(q, outer, nextY + 0.92), 0x899799);
  }
  const landing = [{ x: x - 0.1, z: z - 0.45 }, { x: -656.3, z: -794.15 }];
  for (const level of [1, 2, 3]) {
    const y = grade + level * rise;
    prism(batch, ...landing, y - 0.18, y, 0.84, 0x596266);
  }
  fine.add(batch.mesh());
}

function decorateNizo(group, fine, base, detail, volume, wall, rings) {
  const main = volume.id === NIZO_SURVEY[0].id;
  const masonry = main ? nizoBrick : volume.id === '0228100000033892' ? 0xa37c69 : 0xb9ae98;
  const { a, b, normal, width, low, high, index, roof, center } = wall;
  if (roof) {
    base.polygon(rings, main ? 0x4a4941 : 0x555958);
    return;
  }
  if (main && (index === 259 || index === 324)) {
    nizoFacade(base, detail, wall, rings);
    return;
  }
  base.polygon(rings, masonry);
  if (main && index === 30) nizoEntrance(group, fine, base, detail, wall);
  if (Math.abs(normal.y) > 0.12 || width < 6 || high - low < 3.3) return;
  if (!main && volume.id === '0228100000033892' && (index === 9 || index === 10)) return;
  const ground = terrainHeightAt(center.x, center.z);
  for (let floor = Math.max(low + 0.32, ground + 1.0); floor + 0.9 < high - 0.28; floor += 3.55)
    glazing(base, detail, wall, 0.075, 0.925, floor, floor + 0.81, Math.max(3, Math.round(width / 2.5)));
  facePanel(base, a, b, normal, 0, 1, high - 0.26, high, 0xacaaa0);
}

export function createNizoLandmark() {
  const model = campuses('NIZO Food Research', NIZO_SURVEY, decorateNizo);
  const fine = model.children.find(child => child.userData.nearDetail);
  spiral(fine);
  const north = createNizoNorthLandmark();
  model.add(north);
  model.userData.colliders.push(...north.userData.colliders);
  return model;
}

function hospitalEntrance(group, fine, base, detail, wall) {
  const { a, b, normal, high } = wall;
  const threshold = terrainHeightAt(-1754.5, 2645.8) + 0.06;
  const glazedTop = high - 0.24;
  glazing(base, detail, wall, 0.015, 0.985, threshold + 0.03, glazedTop, 19, 4);
  const [canopyA, canopyB] = offsetEdge(a, b, normal, 0.84);
  prism(base, canopyA, canopyB, glazedTop - 0.32, glazedTop + 0.32, 1.74, 0x3b4746);
  for (let i = 0; i <= 9; i++) {
    const p = along(canopyA, canopyB, i / 9);
    beam(detail, [p.x, threshold, p.z], [p.x, glazedTop - 0.1, p.z], 0.07, zinc);
  }
  const [doorA, doorB] = offsetEdge(along(a, b, 0.37), along(a, b, 0.57), normal, 0.11);
  prism(base, doorA, doorB, threshold + 0.12, threshold + 2.92, 0.13, 0x304d51);
  for (const at of [0, 0.34, 0.67, 1]) {
    const p = along(doorA, doorB, at);
    beam(detail, [p.x, threshold, p.z], [p.x, threshold + 2.93, p.z], 0.09, zinc);
  }
  group.userData.entrance = { x: -1757.53, z: 2644.05 };
}

function emergencyEntrance(group, fine, base, detail, wall) {
  const { a, b, normal } = wall;
  const threshold = terrainHeightAt(-1846.8, 2607.9);
  glazing(base, detail, wall, 0.08, 0.92, threshold + 0.06, threshold + 2.6, 7, 1);
  const [awningA, awningB] = offsetEdge(along(a, b, 0.05), along(a, b, 0.95), normal, 1.1);
  prism(base, awningA, awningB, threshold + 2.8, threshold + 3.17, 2.2, 0xa5a9a6);
  const [signA, signB] = offsetEdge(along(a, b, 0.09), along(a, b, 0.88), normal, 2.23);
  const sign = plaque('SPOEDPOST', signA, signB, threshold + 3.17, 0.49, '#dddcd6', '#82292a');
  if (sign) fine.add(sign);
  group.userData.emergencyEntrance = { x: -1847.17, z: 2607.90 };
}

function decorateHospital(group, fine, base, detail, volume, wall, rings) {
  const { a, b, normal, width, low, high, center, index, roof } = wall;
  if (roof) {
    const atrium = center.x >= -1807 && center.x <= -1741 && center.z >= 2575 && center.z <= 2631
      && high < 4.9;
    base.polygon(rings, atrium && Math.abs(normal.y) < 0.995 ? 0x788b8a : 0x616460);
    return;
  }
  const newWing = center.x > -1758 && center.z > 2666;
  base.polygon(rings, newWing ? hospitalWhite : hospitalBrick);
  // The green hospital lettering is mounted high on the main wing behind the atrium.
  if (index === 371) {
    facePanel(base, a, b, normal, 0, 1, low, high, hospitalWhite, 0.012);
    const [signA, signB] = offsetEdge(along(a, b, 0.18), along(a, b, 0.91), normal, 0.037);
    const sign = plaque('ZIEKENHUIS\nGELDERSE VALLEI', signA, signB, high - 0.8, 1.16, null, '#17583b');
    if (sign) fine.add(sign);
  }
  if (index === 467) {
    hospitalEntrance(group, fine, base, detail, wall);
    return;
  }
  if (index === 230) {
    emergencyEntrance(group, fine, base, detail, wall);
    return;
  }
  if (Math.abs(normal.y) > 0.15 || high - low < 2.3 || width < 2.8) return;
  const ground = terrainHeightAt(center.x, center.z);
  if (newWing) {
    for (let floor = Math.max(ground + 0.75, low + 0.25); floor + 0.8 < high - 0.32; floor += 3.57)
      glazing(base, detail, wall, 0.06, 0.94, floor, floor + 0.97, Math.max(3, Math.round(width / 1.8)));
    facePanel(base, a, b, normal, 0, 1, high - 0.23, high, 0x989b96);
  } else {
    const columns = Math.max(1, Math.round(width / 3.0));
    // Simple low-cost window bands on the remaining surveyed wings.
    for (let floor = Math.max(ground + 1.2, low + 0.32); floor + 1.0 < high - 0.35; floor += 3.62) {
      if (normal.x > 0.46 && center.x > -1757) {
        for (let i = 0; i < columns; i++) {
          const l = (i + 0.14) / columns, r = (i + 0.86) / columns;
          facePanel(base, a, b, normal, l, r, floor, floor + 1.17, glassDark, 0.018, 1);
        }
      } else facePanel(base, a, b, normal, 0.04, 0.96, floor + 0.1, floor + 0.95, glassDark, 0.02, 1);
    }
  }
}

export function createGelderseValleiLandmark() {
  return campuses('Ziekenhuis Gelderse Vallei', GELDERSE_VALLEI_SURVEY, decorateHospital);
}
