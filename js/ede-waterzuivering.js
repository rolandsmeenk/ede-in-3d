import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';

const concrete = 0xa6a299;
const weathered = 0x918f85;
const steel = 0x748485;
const darkSteel = 0x465055;
const angle = -0.36;
const basinAngle = -0.018;

// The post-move positions and the treatment tanks follow PDOK 2026 imagery.
const plant = {
  pump: [-3504.52, 899.87],
  tower: [-3516.31, 905.68],
  aeration: [-3459.5, 622.4],
  clarifiers: [
    [-3522.33, 543.36, 22.4, 0.89],
    [-3475.68, 543.01, 22.4, -2.34],
    [-3429.78, 542.66, 22.4, -2.31],
    [-3382.62, 541.56, 22.4, -0.73],
    [-3496.40, 701.78, 22.4, -2.30],
    [-3450.00, 701.18, 22.8, -2.28],
    [-3403.84, 699.83, 22.4, 0.19],
    [-3356.94, 699.23, 22.4, 2.34],
  ],
  covered: [[-3364.15, 747.4, 20.9], [-3361.52, 805.03, 16.7]],
};

function box(batch, x, y, z, width, height, depth, color, yaw = 0) {
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(-yaw).translate(x, y, z), color);
}

function cylinder(batch, x, y, z, top, bottom, height, color, sides = 48, open = false) {
  batch.solid(new THREE.CylinderGeometry(top, bottom, height, sides, 1, open).translate(x, y, z), color);
}

function point(x, z, yaw, u, v) {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return [x + u * cos - v * sin, z + u * sin + v * cos];
}

function collider(colliders, points, minY, maxY) {
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  colliders.push({
    minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
    minY, maxY, polygon: { outer: points.map(([x, z]) => ({ x, z })), holes: [] },
  });
}

function rectCollider(colliders, x, z, yaw, u0, u1, v0, v1, minY, maxY) {
  const points = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => point(x, z, yaw, u, v));
  collider(colliders, points, minY, maxY);
}

function circleCollider(colliders, x, z, radius, minY, maxY) {
  const points = Array.from({ length: 32 }, (_, i) => point(x, z, i * Math.PI / 16, radius, 0));
  collider(colliders, points, minY, maxY);
}

function pumpMonument(batch, colliders) {
  const [x, z] = plant.pump, y = terrainHeightAt(x, z);
  const world = (u, h, v) => {
    const [wx, wz] = point(x, z, angle, u, v);
    return [wx, y + h, wz];
  };
  const block = (u, h, v, w, t, d, color) => {
    const [wx, wy, wz] = world(u, h, v);
    box(batch, wx, wy, wz, w, t, d, color, angle);
  };
  const profile = (outline, v0, v1, color) => {
    const area = outline.reduce((sum, [u, h], i) => {
      const [nextU, nextH] = outline[(i + 1) % outline.length];
      return sum + u * nextH - nextU * h;
    }, 0);
    const ordered = area > 0 ? outline : [...outline].reverse();
    const near = ordered.map(([u, h]) => world(u, h, v0));
    const far = ordered.map(([u, h]) => world(u, h, v1));
    batch.polygon([[...near].reverse()], color);
    batch.polygon([far], color);
    for (let i = 0; i < near.length; i++) {
      const j = (i + 1) % near.length;
      batch.quad(near[i], near[j], far[j], far[i], color);
    }
  };

  // The Bouwarchief Ede elevation sets the ridge at 19.65 m NAP and grade at 9.50 m.
  const ramp = [[15.7, -0.28], [11.5, -0.28], [4.8, 3.95], [-1.42, 3.95], [-3.74, -0.28],
    [-5.91, -0.28], [-2.67, 5.62], [3, 7.38]];
  for (const v of [-4.4, -1.45, 1.45, 4.4]) profile(ramp, v - 0.27, v + 0.27, weathered);
  profile([[15.5, -0.22], [2.8, 7.24], [2.8, 6.72], [15.5, -0.65]], -4.42, 4.42, concrete);
  profile([[12.1, -0.28], [8.15, -0.28], [8.15, 2.07]], -3.99, 3.99, 0x887967);
  profile([[-2.35, 3.95], [4.85, 3.95], [3, 5.62], [-2.65, 5.62]], -4.55, 4.55, concrete);
  profile([[0, 5.6], [3.05, 5.6], [3.05, 8.11], [-0.35, 10.01], [-3, 5.6]], -4.65, 4.65, concrete);
  profile([[-3.09, 5.62], [0.53, 5.62], [0.53, 8.43], [-3.09, 8.43]], -3.84, 3.84, concrete);
  profile([[3.23, 8.11], [-0.39, 10.15], [-3.08, 5.64], [-2.94, 5.6], [-0.34, 10.07], [3.17, 7.97]],
    -4.73, 4.73, darkSteel);

  block(-3.115, 7.07, 0, 0.09, 1.91, 6.38, 0x354c54);
  for (let i = -3; i <= 3; i++) block(-3.19, 7.07, i * 1.03, 0.10, 1.96, 0.07, 0x889695);
  block(-3.19, 7.04, 0, 0.11, 0.07, 6.42, 0x889695);
  block(-3.36, 5.68, 0, 0.68, 0.20, 7.2, concrete);
  block(-3.68, 6.7, 0, 0.07, 0.06, 7.2, steel);
  for (let i = -12; i <= 12; i++) block(-3.68, 6.21, i * 0.29, 0.055, 0.96, 0.055, steel);

  block(18.65, 0.38, 0, 7.6, 1.16, 8.8, weathered);
  for (let step = 0; step < 4; step++) {
    block(18.6 + step * 0.31, (step + 1) * 0.12, 4.57, 0.31, (step + 1) * 0.24, 1.7, concrete);
  }
  profile([[-5.22, -0.25], [-6.36, -0.25], [-8.94, 2.61], [-8.09, 2.61]], -2.28, -1.82, weathered);
  block(-6.5, 2.58, -1.85, 5.63, 0.38, 2.05, concrete);

  const [tx, tz] = plant.tower, ty = terrainHeightAt(tx, tz);
  cylinder(batch, tx, ty + 1.25, tz, 2.25, 2.25, 3.0, weathered, 12);
  cylinder(batch, tx, ty + 3.96, tz, 3.30, 2.32, 2.43, concrete, 32, true);
  batch.solid(new THREE.CylinderGeometry(3.11, 2.09, 2.14, 32, 1, true)
    .scale(-1, 1, 1).translate(tx, ty + 3.86, tz), 0x757268);
  cylinder(batch, tx, ty + 3.09, tz, 2.58, 2.58, 0.17, 0x51594e, 32);
  batch.solid(new THREE.RingGeometry(3.07, 3.31, 32).rotateX(-Math.PI / 2).translate(tx, ty + 5.18, tz), weathered);

  rectCollider(colliders, x, z, angle, 14.8, 22.45, -4.4, 4.4, y - 0.25, y + 0.96);
  rectCollider(colliders, x, z, angle, 8, 15.7, -4.4, 4.4, y - 0.5, y + 2.5);
  rectCollider(colliders, x, z, angle, -5.91, -3.7, -4.68, 4.68, y - 0.5, y + 2.9);
  rectCollider(colliders, x, z, angle, -3.68, 4.8, -4.7, 4.7, y + 3.95, y + 10.15);
  circleCollider(colliders, tx, tz, 2.3, ty - 0.25, ty + 2.75);
  circleCollider(colliders, tx, tz, 3.3, ty + 2.75, ty + 5.18);
}

function clarifier(batch, colliders, x, z, radius, heading, index) {
  const ground = terrainHeightAt(x, z);
  const top = ground + 1.45;
  const surface = top - 0.33;
  const outside = new THREE.CylinderGeometry(radius, radius, 2.48, 64, 1, true)
    .translate(x, top - 1.24, z);
  const inside = new THREE.CylinderGeometry(radius - 0.55, radius - 0.55, 0.39, 64, 1, true)
    .scale(-1, 1, 1).translate(x, top - 0.195, z);
  batch.solid(outside, weathered);
  batch.solid(inside, 0x7c7b70);
  batch.solid(new THREE.RingGeometry(radius - 0.55, radius, 64).rotateX(-Math.PI / 2)
    .translate(x, top, z), concrete);
  batch.solid(new THREE.CircleGeometry(radius - 0.54, 64).rotateX(-Math.PI / 2)
    .translate(x, surface, z), [0x303932, 0x393d34, 0x343c36, 0x424439][index % 4]);
  cylinder(batch, x, surface + 0.31, z, 2.15, 2.15, 0.61, 0x777b71, 24);
  const [bx, bz] = point(x, z, heading, radius * 0.43, 0);
  const span = radius * 1.09;
  box(batch, bx, surface + 0.48, bz, span, 0.18, 1.42, steel, heading);
  for (const side of [-0.69, 0.69]) {
    const [rx, rz] = point(bx, bz, heading, 0, side);
    box(batch, rx, surface + 1.34, rz, span, 0.065, 0.065, steel, heading);
    for (let i = 0; i <= 8; i++) {
      const [px, pz] = point(bx, bz, heading, span * (i / 8 - 0.5), side);
      box(batch, px, surface + 0.92, pz, 0.055, 0.88, 0.055, steel, heading);
    }
  }
  circleCollider(colliders, x, z, radius, top - 2.48, top + 0.12);
}

function coveredTank(batch, colliders, x, z, radius) {
  const ground = terrainHeightAt(x, z), top = ground + 1.42;
  cylinder(batch, x, top - 1.24, z, radius, radius, 2.48, weathered);
  cylinder(batch, x, top + 0.37, z, radius - 0.36, radius - 0.05, 0.74, 0x788988);
  for (let offset = -radius + 0.9; offset < radius - 0.42; offset += 1.05) {
    const length = 2 * Math.sqrt((radius - 0.42) ** 2 - offset ** 2);
    const [px, pz] = point(x, z, basinAngle, 0, offset);
    box(batch, px, top + 0.77, pz, length, 0.11, 0.19, 0x839492, basinAngle);
  }
  for (const offset of [-0.51, -0.17, 0.17, 0.51]) {
    const u = offset * radius;
    const length = 2 * Math.sqrt((radius - 0.48) ** 2 - u ** 2);
    const [px, pz] = point(x, z, basinAngle, u, 0);
    box(batch, px, top + 0.92, pz, 0.77, 0.27, length, darkSteel, basinAngle);
  }
  circleCollider(colliders, x, z, radius, top - 2.48, top + 1.06);
}

function aerationBasins(batch, colliders) {
  const [x, z] = plant.aeration;
  let ground = -Infinity;
  for (let u = -70; u <= 70; u += 7) {
    for (let v = -42; v <= 42; v += 7) {
      ground = Math.max(ground, terrainHeightAt(...point(x, z, basinAngle, u, v)));
    }
  }
  const top = ground + 0.28;
  const part = (u, v, width, depth, height, h, color) => {
    const [px, pz] = point(x, z, basinAngle, u, v);
    box(batch, px, top + h, pz, width, height, depth, color, basinAngle);
  };
  part(0, 0, 144.4, 89.8, 3.1, -1.55, weathered);
  for (let row = 0; row < 4; row++) {
    const v = (row - 1.5) * 21.9;
    part(-3, v, 105, 20.8, 0.015, 0.01, row % 2 ? 0x41443a : 0x4b4b3f);
    for (const u of [55, 63]) part(u, v, 6.9, 20.8, 0.015, 0.01, 0x363f3b);
  }
  for (const u of [-55, -27, 3, 33, 50.5, 69]) part(u, 0, 1.23, 88.1, 0.37, 0.18, concrete);
  for (const u of [-70.8, 71.5]) part(u, 0, 1.25, 89.8, 0.47, 0.23, concrete);
  for (const v of [-44.1, -21.9, 0, 21.9, 44.1]) part(0, v, 144.2, 1.1, 0.42, 0.21, concrete);
  rectCollider(colliders, x, z, basinAngle, -72.2, 72.2, -44.9, 44.9, top - 3.1, top + 0.45);
}

export function createWaterzuivering() {
  const batch = new CivicBatch(), colliders = [];
  pumpMonument(batch, colliders);
  plant.clarifiers.forEach(([x, z, radius, heading], index) => clarifier(batch, colliders, x, z, radius, heading, index));
  plant.covered.forEach(([x, z, radius]) => coveredTank(batch, colliders, x, z, radius));
  aerationBasins(batch, colliders);
  return makeGroup('Rioolwaterzuivering Ede · Vijzelgemaal', batch, colliders);
}
