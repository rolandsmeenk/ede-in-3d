import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv, vertexColor } from 'three/tsl';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { STREET_HERITAGE_SURVEYS } from './ede-street-heritage-survey.js';

const plaster = 0xe9e5d7, cream = 0xd9cbb0, stone = 0xa7a198, blueStone = 0x555c60;
const joinery = 0x263635, glass = 0x49616a, brick = 0x805042, slate = 0x364245;
const yellowBrick = 0xb39a61;
let farmRoofSurface;

function frontage({ trim, labels }, [ax, az], [bx, bz], low, high) {
  const dx = bx - ax, dz = bz - az, width = Math.hypot(dx, dz);
  const normal = { x: -dz / width, y: 0, z: dx / width };
  const point = (u, y, d = 0) => [ax + dx * u / width + normal.x * d, y,
    az + dz * u / width + normal.z * d];
  const rings = [[point(0, low), point(width, low), point(width, high), point(0, high)]];
  return { a: { x: ax, z: az }, b: { x: bx, z: bz }, width, low, high, normal, rings, point, trim, labels };
}

function profile(wall, vertices, color, depth = 0.07) {
  wall.trim.polygon([vertices.map(([u, y]) => wall.point(u, y, depth))], color);
}

function block(wall, left, right, low, high, projection, color, back = 0.012) {
  const { trim, point } = wall;
  if (right <= left) return;
  surveyPanel(wall, left, right, low, high, color, projection);
  trim.quad(point(left, high, projection), point(right, high, projection), point(right, high, back),
    point(left, high, back), color);
  trim.quad(point(left, low, back), point(right, low, back), point(right, low, projection),
    point(left, low, projection), color);
  trim.quad(point(left, low, projection), point(left, high, projection), point(left, high, back),
    point(left, low, back), color);
  trim.quad(point(right, low, back), point(right, high, back), point(right, high, projection),
    point(right, low, projection), color);
}

function window(wall, u, width, bottom, top, { casing = cream, frame = joinery, columns = 2, rows = 3 } = {}) {
  const l = u - width / 2, r = u + width / 2;
  if (!surveyWindow(wall, l, r, bottom, top, { frame, color: glass, columns, rows })) return;
  surveyPanel(wall, l - 0.07, l, bottom, top, casing, 0.05);
  surveyPanel(wall, r, r + 0.07, bottom, top, casing, 0.05);
  surveyPanel(wall, l - 0.08, r + 0.08, top, top + 0.075, casing, 0.05);
  block(wall, l - 0.1, r + 0.1, bottom - 0.075, bottom, 0.112, stone);
}

function shutters(wall, u, width, bottom, top) {
  for (const side of [-1, 1]) {
    const mid = u + side * (width * 0.75 + 0.08);
    const left = mid - width * 0.23, right = mid + width * 0.23;
    block(wall, left, right, bottom, top, 0.077, joinery);
    for (const y of [bottom + 0.10, top - 0.14]) surveyPanel(wall, left, right, y, y + 0.06, 0x3f4b4b, 0.085);
  }
}

function door(wall, u, width, bottom, top, { casing = cream, paneled = true } = {}) {
  const l = u - width / 2, r = u + width / 2;
  surveyPanel(wall, l - 0.1, r + 0.1, bottom, top + 0.12, casing, 0.027);
  surveyPanel(wall, l, r, bottom, top - 0.55, joinery, 0.053);
  surveyWindow(wall, l, r, top - 0.54, top, { columns: 2, rows: 2, color: glass, frame: joinery });
  if (paneled) {
    for (const y of [bottom + 0.18, bottom + 1.10]) {
      surveyPanel(wall, l + 0.15, r - 0.15, y, Math.min(y + 0.65, top - 0.69), 0x37423c, 0.064);
    }
  }
  surveyPanel(wall, r - 0.19, r - 0.12, bottom + 1.02, bottom + 1.08, 0xc1a676, 0.080);
}

function arch(wall, u, radius, bottom, spring, band, color, depth = 0.086) {
  const curve = (r, step) => [u + Math.cos(step * Math.PI / 12) * r, spring + Math.sin(step * Math.PI / 12) * r];
  profile(wall, [[u - radius, bottom], [u + radius, bottom],
    ...Array.from({ length: 13 }, (_, i) => curve(radius, i))], color, depth);
  for (let i = 0; i < 12; i++) {
    profile(wall, [curve(radius, i), curve(radius + band, i), curve(radius + band, i + 1),
      curve(radius, i + 1)], i % 3 ? cream : stone, depth + 0.007);
  }
  for (const sign of [-1, 1]) {
    const end = u + sign * radius;
    surveyPanel(wall, end + (sign < 0 ? -band : 0), end + (sign < 0 ? 0 : band), bottom, spring, cream, depth + 0.007);
  }
}

function ridge(batch, start, end, radius, color) {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a), middle = a.lerp(b, 0.5);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  batch.solid(new THREE.CylinderGeometry(radius, radius, direction.length(), 8)
    .applyQuaternion(rotation).translate(middle.x, middle.y, middle.z), color);
}

function roofCap(wall, u, size, eaves, peak, center, color) {
  const { point, trim } = wall;
  const box = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([dx, dz]) =>
    point(u + dx * size / 2, eaves, center + dz * size / 2));
  for (let i = 0; i < 4; i++) trim.triangle(box[i], box[(i + 1) % 4], point(u, peak, center), color);
  ridge(trim, point(u, peak - 0.04, center), point(u, peak + 0.48, center), 0.047, 0x414b43);
}

function finishFischer(detail) {
  const frontagePoints = [
    [[-141.35, -232.55], [-143.50, -244.88]],
    [[-143.42, -245.83], [-145.07, -255.46]],
    [[-145.34, -257.64], [-146.97, -266.66]],
  ];

  for (const [index, [a, b]] of frontagePoints.entries()) {
    const lower = -2.45, centerHouse = index === 1, edge = centerHouse ? 2.60 : 2.18;
    const wall = frontage(detail, a, b, lower - 0.1, 4.65);
    const { width } = wall;
    const open = width * (centerHouse ? 0.51 : 0.22);
    surveyPanel(wall, 0.02, width - 0.02, lower, edge, plaster, 0.049);
    block(wall, 0.015, width - 0.015, lower, lower + 0.37, 0.080, blueStone, 0.054);
    for (let y = -1.85; y < edge; y += 0.40) surveyPanel(wall, 0.03, width - 0.03, y, y + 0.012, 0xccc4b3, 0.056);
    // The fitted plaster plane sits just in front of the split survey faces.
    const details = { ...wall, point: (u, y, d = 0) => wall.point(u, y, d + 0.053),
      a: { x: wall.a.x + wall.normal.x * 0.053, z: wall.a.z + wall.normal.z * 0.053 },
      b: { x: wall.b.x + wall.normal.x * 0.053, z: wall.b.z + wall.normal.z * 0.053 } };
    door(details, open, 1.22, lower + 0.04, 0.56);
    for (const u of (centerHouse ? [1.75, width - 1.75] : [width * 0.47, width * 0.77])) {
      window(details, u, 1.12, lower + 0.51, 0.52, { rows: 4 });
      shutters(details, u, 1.12, lower + 0.58, 0.38);
    }
    if (centerHouse) {
      for (const dx of [-0.77, 0.77]) block(wall, open + dx - 0.115, open + dx + 0.115, lower, 0.80, 0.19, cream, 0.056);
      block(wall, open - 1.01, open + 1.01, 0.74, 0.94, 0.21, cream, 0.053);
      surveyLabel(details, open - 1.73, open + 1.73, 1.01, 1.31, 'FISCHERS HUIS', '#e9e5d7', '#263635');
      window(details, open, 1.24, 1.45, 2.29, { rows: 2 });
      const top = Array.from({ length: 17 }, (_, i) => {
        const a = i * Math.PI / 16;
        return [open + Math.cos(a) * 2.45, edge + Math.sin(a) * 1.46];
      });
      profile(wall, [[open - 2.45, edge - 0.06], [open + 2.45, edge - 0.06], ...top], plaster, 0.057);
      for (let i = 1; i < top.length; i++) {
        const [u, y] = top[i - 1], [v, h] = top[i];
        profile(wall, [[u, y], [v, h], [v, h - 0.16], [u, y - 0.16]], cream, 0.114);
      }
      window(details, open, 0.58, edge + 0.22, edge + 0.95, { rows: 1, columns: 1 });
    }
    block(wall, 0.025, width - 0.025, edge - 0.16, edge + 0.035, 0.16, centerHouse ? cream : blueStone, 0.054);
    block(wall, open - 0.77, open + 0.77, lower - 0.04, lower + 0.045, 0.35, stone);
    for (const u of [open - 0.83, open + 0.83]) {
      block(wall, u - 0.10, u + 0.10, lower, lower + 0.59, 0.87, stone, 0.68);
      ridge(detail.trim, wall.point(u, lower + 0.59, 0.77), wall.point(u, lower + 0.68, 0.77), 0.079, blueStone);
    }
  }
}

function decorateFarm(wall) {
  const { buildingIndex, faceIndex, base, width } = wall;
  if (buildingIndex === 0) {
    if ([3, 5, 6, 8].includes(faceIndex)) return plaster;
    if ([1, 2].includes(faceIndex)) {
      block(wall, 0.02, width - 0.02, base, base + 0.31, 0.055, blueStone);
      for (const center of [width * 0.20, width * 0.68]) {
        window(wall, center, 0.57, base + 0.49, base + 1.21, { columns: 2, rows: 2 });
      }
    }
    if (faceIndex === 4) door(wall, width / 2, 2.33, base + 0.03, base + 2.83, { casing: 0x685b47 });
  } else if ([2, 5].includes(faceIndex)) {
    window(wall, width * 0.55, 0.67, base + 0.55, base + 1.45, { columns: 2, rows: 2 });
  }
}

function getFarmRoofSurface() {
  if (farmRoofSurface) return farmRoofSurface;
  const side = 128, pixels = new Uint8Array(side * side * 4);
  const noise = (x, y) => {
    const state = Math.imul(x + 1379, 374761393) ^ Math.imul(y + 429, 668265263);
    return ((Math.imul(state ^ (state >>> 13), 1274126177) >>> 16) & 65535) / 65535;
  };
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const i = (y * side + x) * 4;
      const row = y >> 4, tileX = (x + ((row & 1) ? 8 : 0)) & 15;
      pixels[i] = 138 + 49 * noise(x, 7) + 42 * noise(x, y >> 3) + 24 * noise(x, y);
      pixels[i + 1] = !(y & 15) || tileX === 0 ? 148 : 186 + 30 * noise((x + 8 * (row & 1)) >> 4, row)
        + (y & 15) * 1.8 + 10 * noise(x, y);
      pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    }
  }
  farmRoofSurface = new THREE.DataTexture(pixels, side, side);
  farmRoofSurface.name = 'DriehoekTileableRoof';
  farmRoofSurface.wrapS = farmRoofSurface.wrapT = THREE.RepeatWrapping;
  farmRoofSurface.generateMipmaps = true;
  farmRoofSurface.minFilter = THREE.LinearMipmapLinearFilter;
  farmRoofSurface.magFilter = THREE.LinearFilter;
  farmRoofSurface.anisotropy = 4;
  farmRoofSurface.needsUpdate = true;
  return farmRoofSurface;
}

function shadeFarmRoof(mesh) {
  const { position, normal } = mesh.geometry.attributes;
  const coords = [], roof = [], tile = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const onRoof = normal.getY(i) > 0.18;
    const tri = i - i % 3;
    const eaves = Math.max(position.getY(tri), position.getY(tri + 1), position.getY(tri + 2)) <= 6.551;
    coords.push((x * 0.526 + z * 0.85) / 1.41, y / 1.35);
    roof.push(onRoof ? 1 : 0);
    tile.push(onRoof && eaves ? 1 : 0);
  }
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  mesh.geometry.setAttribute('farmRoof', new THREE.Float32BufferAttribute(roof, 1));
  mesh.geometry.setAttribute('farmTile', new THREE.Float32BufferAttribute(tile, 1));
  const finish = texture(getFarmRoofSurface(), uv());
  const variation = mix(finish.r.mul(0.99).add(0.18), finish.g.mul(0.86).add(0.26),
    attribute('farmTile', 'float'));
  mesh.material.colorNode = vertexColor().mul(mix(1, variation, attribute('farmRoof', 'float')));
}

function finishFarm(detail) {
  shadeFarmRoof(detail.group.children[0]);
  const gable = frontage(detail, [134.66, -47.42], [144.64, -53.36], 2.0, 7.2);
  const bakehouse = frontage(detail, [137.25, -42.56], [139.34, -39.22], 2.65, 6.35);
  surveyPanel(gable, 0.07, gable.width - 0.06, 2.04, 2.35, blueStone, 0.054);
  door(gable, 2.72, 1.15, 2.08, 4.32);
  surveyLabel(gable, 3.48, 3.78, 3.18, 3.46, '32', '#e9e5d7', '#263635');
  window(gable, 1.28, 0.46, 2.65, 3.41, { columns: 2, rows: 2 });
  for (const [u, top] of [[5.39, 5.37], [8.05, 5.54]]) {
    window(gable, u, 1.19, 2.62, top, { frame: cream, columns: 5, rows: 8 });
    shutters(gable, u, 1.19, 2.69, 3.93);
  }
  window(gable, 6.91, 0.54, 5.82, 6.47, { columns: 1, rows: 1 });
  for (const u of [4.05, 6.76, 9.15]) {
    surveyPanel(gable, u - 0.022, u + 0.022, 5.56, 5.96, joinery, 0.07);
    surveyPanel(gable, u - 0.10, u + 0.10, 5.74, 5.79, joinery, 0.07);
  }
  window(bakehouse, bakehouse.width / 2, 1.16, 2.98, 5.00, { frame: cream, columns: 3, rows: 4 });
  shutters(bakehouse, bakehouse.width / 2, 1.16, 3.02, 4.95);

  ridge(detail.trim, [134.32, 9.86, -59.13], [138.43, 10.12, -52.50], 0.11, 0x796653);
  for (const [x, y, z, w, h, d] of [[136.08, 9.85, -55.95, 0.57, 1.27, 0.66], [141.4, 5.95, -42.43, 0.48, 0.96, 0.46]]) {
    detail.trim.solid(new THREE.BoxGeometry(w, h, d).rotateY(0.53).translate(x, y, z), brick);
    detail.trim.solid(new THREE.BoxGeometry(w + 0.14, 0.10, d + 0.14).rotateY(0.53)
      .translate(x, y + h / 2, z), blueStone);
  }
}

function displayFront(wall, lo, hi, frame = 0x3d3b33) {
  const { width } = wall;
  const count = Math.max(1, Math.round(width / 1.65));
  for (let i = 0; i < count; i++) {
    const left = width * i / count + 0.095, right = width * (i + 1) / count - 0.095;
    surveyWindow(wall, left, right, lo, hi, { frame, color: glass, rows: 2 });
  }
  block(wall, 0.025, width - 0.025, hi + 0.06, hi + 0.40, 0.16, frame);
}

function shopLabel(wall, center, width, y, text) {
  const [ax, , az] = wall.point(center - width / 2, y, 0.075);
  const [bx, , bz] = wall.point(center + width / 2, y, 0.075);
  const sign = frontage(wall, [ax, az], [bx, bz], y, y + 0.22);
  surveyLabel(sign, 0, width, y, y + 0.22, text, '#393f3b', '#eee9d9');
}

function decorateShop(wall) {
  const { buildingIndex, faceIndex, width } = wall;
  if (buildingIndex === 0 && [9, 10, 27].includes(faceIndex)) {
    displayFront(wall, -1.18, 1.65, 0x343732);
    const count = Math.max(1, Math.round(width / 2.15));
    for (let i = 0; i < count; i++) {
      window(wall, (i + 0.5) * width / count, 1.03, 2.91, 5.35, { frame: cream, rows: 3 });
    }
    for (const y of [2.2, 2.37, 5.88, 6.64]) surveyPanel(wall, 0.015, width - 0.015, y, y + 0.08, cream, 0.045);
  }
  if (buildingIndex === 3 && faceIndex === 6) {
    displayFront(wall, -1.78, 1.03, 0x393f3b);
    shopLabel(wall, width * 0.50, 3.57, 1.15, 'KAPSALON RE-STYLE');
    window(wall, width * 0.44, 1.33, 2.52, 5.37, { rows: 3 });
    window(wall, width * 0.44, 1.29, 5.62, 6.39, { rows: 1 });
  }
}

function arcBay(wall, u, width, base, top, depth, color) {
  const { point, trim } = wall;
  const curve = Array.from({ length: 9 }, (_, i) => {
    const stage = i * Math.PI / 8;
    return [u - Math.cos(stage) * width / 2, depth * Math.sin(stage)];
  });
  const cap = [];
  for (let i = 0; i < curve.length; i++) {
    const [x, d] = curve[i];
    cap.push(point(x, top, d));
    if (!i) continue;
    const [prev, previousDepth] = curve[i - 1];
    trim.quad(point(prev, base, previousDepth), point(x, base, d), point(x, top, d), point(prev, top, previousDepth), color);
  }
  trim.polygon([cap], slate);
}

function finishShops(detail) {
  const corner = frontage(detail, [-119.48, 237.02], [-117.57, 236.05], -1.28, 7.51);
  const u = corner.width / 2;
  arch(corner, u, 0.72, -1.16, 1.16, 0.22, joinery);
  arch(corner, u, 0.68, 3.12, 5.09, 0.24, glass);
  surveyPanel(corner, u - 0.024, u + 0.024, 3.17, 5.49, cream, 0.106);
  surveyPanel(corner, u - 0.58, u + 0.58, 4.80, 4.845, cream, 0.107);
  block(corner, u - 0.78, u + 0.78, 3.02, 3.18, 0.64, stone);
  block(corner, u - 0.77, u + 0.77, 3.71, 3.81, 0.65, brick, 0.48);
  for (let i = -3; i <= 3; i++) block(corner, u + i * 0.218 - 0.061, u + i * 0.218 + 0.061,
    3.16, 3.72, 0.64, brick, 0.54);
  block(corner, 0.05, corner.width - 0.05, 6.73, 7.14, 0.06, brick, -0.41);
  block(corner, -0.14, corner.width + 0.14, 7.10, 7.26, 0.16, cream, -2.12);
  roofCap(corner, u, 2.5, 7.24, 10.64, -1.03, slate);

  const toes = frontage(detail, [-153.91, 375.27], [-158.95, 389.06], -1.90, 5.37);
  displayFront(toes, -1.73, 1.29, 0x393f3b);
  shopLabel(toes, toes.width * 0.23, 4.2, 1.40, 'TOES HERENMODE');
  block(toes, -0.06, toes.width + 0.06, 1.66, 1.88, 0.72, 0x929a99);
  block(toes, -0.08, toes.width + 0.08, 1.89, 1.96, 0.80, slate);
  for (const [t, d, top] of [[0.13, 0.34, 4.63], [0.36, 0.23, 5.02], [0.65, 0.25, 5.16], [0.87, 0.42, 4.78]]) {
    const center = toes.width * t;
    arcBay(toes, center, 2.88, 1.98, top, d, yellowBrick);
    const left = toes.point(center - 0.57, 0, d + 0.02), right = toes.point(center + 0.57, 0, d + 0.02);
    const front = frontage(detail, [left[0], left[2]], [right[0], right[2]], 2.19, top - 0.12);
    window(front, front.width / 2, 0.91, 2.27, 4.16, { frame: cream, rows: 2 });
  }
  const bayStart = toes.width * 0.433, bayEnd = toes.width * 0.569;
  surveyWindow(toes, bayStart, bayEnd, 2.49, 4.11, { frame: cream, columns: 3, rows: 2 });
  block(toes, bayStart - 0.25, bayEnd + 0.25, 4.30, 4.46, 0.75, slate);
  block(toes, bayStart - 0.17, bayEnd + 0.17, 2.03, 2.30, 0.56, stone);

  const east = frontage(detail, [-174.74, 401.19], [-173.05, 396.24], -1.92, 8.70);
  displayFront(east, -1.76, 0.99);
  const w = east.width, bay = w * 0.36;
  arcBay(east, bay, 2.78, 1.46, 5.16, 0.63, 0xb18b5b);
  const p = east.point(bay - 0.62, 0, 0.63), q = east.point(bay + 0.62, 0, 0.63);
  const bowFront = frontage(detail, [p[0], p[2]], [q[0], q[2]], 1.58, 5.09);
  window(bowFront, bowFront.width / 2, 0.93, 2.13, 4.66, { rows: 3, frame: cream });
  block(east, bay - 1.40, bay + 1.40, 5.08, 5.25, 0.72, stone);
  block(east, bay - 1.41, bay + 1.41, 5.87, 5.93, 0.69, joinery, 0.63);
  for (let i = 0; i < 12; i++) {
    const x = bay + (i - 5.5) * 0.23;
    block(east, x - 0.016, x + 0.016, 5.25, 5.89, 0.68, joinery, 0.63);
  }
  const tower = w * 0.80;
  block(east, tower - 0.72, tower + 0.72, 1.94, 8.04, 0.23, 0xb88c57);
  const l = east.point(tower - 0.73, 0, 0.255), h = east.point(tower + 0.73, 0, 0.255);
  const towerFront = frontage(detail, [l[0], l[2]], [h[0], h[2]], 1.95, 8.12);
  window(towerFront, towerFront.width / 2, 0.79, 2.65, 4.10, { rows: 1, columns: 2 });
  window(towerFront, towerFront.width / 2, 0.74, 5.44, 6.85, { rows: 1, columns: 1 });
  arch(towerFront, towerFront.width / 2, 0.38, 7.26, 7.35, 0.09, slate, 0.045);
  block(east, tower - 0.89, tower + 0.89, 7.94, 8.13, 0.39, slate, -1.65);
  roofCap(east, tower, 1.82, 8.13, 9.55, -0.64, 0x394a3d);
}

export const STREET_HERITAGE_FACTORIES = {
  fischerhuis: (_footprints, site) => createSurveyLandmark(site, STREET_HERITAGE_SURVEYS[site.id], null, finishFischer),
  'boerderij-de-driehoek': (_footprints, site) =>
    createSurveyLandmark(site, STREET_HERITAGE_SURVEYS[site.id], decorateFarm, finishFarm),
  'historische-winkelpuien': (_footprints, site) =>
    createSurveyLandmark(site, STREET_HERITAGE_SURVEYS[site.id], decorateShop, finishShops),
};
