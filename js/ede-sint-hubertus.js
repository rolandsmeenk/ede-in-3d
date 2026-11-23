import * as THREE from 'three/webgpu';
import { abs, mix, normalGeometry, smoothstep, texture, uv, vertexColor } from 'three/tsl';
import { CivicBatch, wallColliders } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { HUBERTUS_SHELLS } from './ede-sint-hubertus-survey.js';
import { terrainHeightAt } from './terrain.js';

const glass = 0x485653, stone = 0xc6ae89, iron = 0x343d35;
// Opening counts and spacing fitted to the photographed elevations, in wall-local metres NAP relative to Oude Kerk.
const lakeWindows = {
  0: [2, 17.94, 19.76], 4: [2, 17.94, 19.76], 16: [1, 17.83, 19.74],
  114: [1, 17.93, 19.77], 144: [7, 21.33, 22.93], 257: [4, 17.96, 19.84],
};
const wingWindows = {
  25: [2, 20.91, 22.53], 49: [3, 18.19, 19.69], 91: [4, 18.49, 20.51],
  100: [3, 18.18, 19.80], 174: [3, 18.04, 19.81], 200: [4, 19.02, 20.46],
  213: [3, 18.11, 19.79], 237: [3, 18.14, 19.70], 245: [1, 21.01, 22.98],
  329: [3, 18.30, 19.76], 331: [2, 18.12, 19.86], 355: [3, 18.10, 19.72],
};
const towerFaces = new Set([17, 139, 148, 184, 185, 265, 357, 360]);

function glazing(wall, count, low, high, frame = stone, spread = 0.72) {
  const spacing = wall.width / count;
  for (let i = 0; i < count; i++) {
    const center = spacing * (i + 0.5), half = spacing * spread / 2;
    if (surveyWindow(wall, center - half, center + half, low, high, { color: glass, frame, rows: 2 })) {
      surveyPanel(wall, center - half - 0.04, center + half + 0.04, low - 0.07, low, stone, 0.079);
    }
  }
}

function boxOnWall(wall, u, y, depth, width, height, length, color) {
  const { a, b, point, trim } = wall;
  const angle = -Math.atan2(b.z - a.z, b.x - a.x);
  trim.solid(new THREE.BoxGeometry(width, height, length).rotateY(angle).translate(...point(u, y, depth)), color);
}

function pergola(wall) {
  const { width } = wall, timber = 0x655044, y = 20.15;
  boxOnWall(wall, width / 2, y, 1.89, width * 0.74, 0.16, 0.15, timber);
  for (let i = 0; i < 10; i++) {
    const u = width * (0.15 + i * 0.70 / 9);
    boxOnWall(wall, u, y + 0.10, 1.03, 0.095, 0.11, 2.08, timber);
  }
  for (const u of [0.15, 0.85]) {
    boxOnWall(wall, width * u, (y + 17.17) / 2, 1.89, 0.13, y - 17.17, 0.13, timber);
  }
}

function portal(wall) {
  const { width, base, point, trim } = wall;
  const center = width / 2;
  function arch(half, spring, rise, offset, color) {
    const outline = [point(center - half, base + 0.11, offset), point(center + half, base + 0.11, offset)];
    for (let i = 0; i <= 8; i++) {
      const angle = i * Math.PI / 8;
      outline.push(point(center + half * Math.cos(angle), base + spring + rise * Math.sin(angle), offset));
    }
    trim.polygon([outline], color);
  }
  arch(0.96, 2.30, 0.56, 0.048, 0xb58059);
  arch(0.84, 2.24, 0.48, 0.056, 0x86573e);
  arch(0.73, 2.13, 0.44, 0.064, 0x704c37);
  surveyPanel(wall, center - 0.66, center + 0.66, base + 0.12, base + 2.18, 0x25332b, 0.071, 0.25);
  surveyPanel(wall, center - 0.017, center + 0.017, base + 0.14, base + 2.15, 0x523e2c, 0.08);
  for (const side of [-1, 1]) {
    const hexagon = Array.from({ length: 6 }, (_, i) => {
      const angle = i * Math.PI / 3;
      return point(center + side * 0.34 + Math.cos(angle) * 0.117,
        base + 1.60 + Math.sin(angle) * 0.117, 0.084);
    });
    trim.polygon([hexagon], 0xc9ac72);
  }

  // Green iron glazing bars and translucent-looking glass blocks above the courtyard door.
  const canopyY = base + 2.91;
  const beam = (u, y, depth, w, h, d, color) =>
    boxOnWall(wall, u, y, depth, w, h, d, color);
  beam(center, canopyY, 0.78, width, 0.065, 1.56, 0x9ba6a0);
  for (const depth of [0.09, 0.55, 1.02, 1.52]) beam(center, canopyY + 0.027, depth, width, 0.055, 0.05, iron);
  for (const u of [0.08, center, width - 0.08]) beam(u, canopyY + 0.028, 0.79, 0.058, 0.055, 1.55, iron);
}

function antler(wall) {
  const center = wall.width / 2, y = 49.40, colour = 0xa89976;
  const stroke = (u, lo, v, hi, width = 0.043) => wall.trim.polygon([[
    wall.point(u - width, lo, 0.062), wall.point(u + width, lo, 0.062),
    wall.point(v + width, hi, 0.062), wall.point(v - width, hi, 0.062),
  ]], colour);
  surveyPanel(wall, center - 0.035, center + 0.035, y + 0.20, y + 0.98, colour, 0.065);
  surveyPanel(wall, center - 0.23, center + 0.23, y + 0.65, y + 0.72, colour, 0.067);
  for (const sign of [-1, 1]) {
    const u = center + sign * 0.32;
    stroke(center + sign * 0.07, y, u, y + 0.36);
    stroke(u, y + 0.30, u + sign * 0.07, y + 0.66, 0.026);
    stroke(u - sign * 0.13, y + 0.18, u - sign * 0.14, y + 0.52, 0.021);
  }
}

function dressWall(wall) {
  const { buildingIndex, faceIndex, width, low, high, base } = wall;
  if (buildingIndex >= 2) {
    // Round pavilions with a glazed band above their brick plinth.
    if (width > 0.44 && low < base + 1.55 && high > base + 2.9) {
      glazing(wall, Math.max(1, Math.round(width / 0.95)), base + 1.42, Math.min(base + 3.46, high - 0.1), iron, 0.88);
    }
    return;
  }
  if (buildingIndex === 1) {
    if (width > 1.4 && low < base + 0.2 && high > base + 2.3) {
      glazing(wall, Math.max(1, Math.round(width / 3.3)), base + 0.88, base + 2.16, iron, 0.58);
    }
    return;
  }
  const row = lakeWindows[faceIndex] ?? wingWindows[faceIndex];
  if (row) glazing(wall, ...row);
  if (faceIndex === 144) pergola(wall);
  if (faceIndex === 339) portal(wall);
  if (towerFaces.has(faceIndex)) glazing(wall, Math.max(1, Math.round(width / 1.2)), 46.55, 47.46, iron, 0.75);
  if (faceIndex === 184 || faceIndex === 185) {
    for (const [lo, hi] of [[30.65, 35.6], [35.85, 40.65], [40.90, 45.5]]) {
      surveyPanel(wall, width * 0.46, width * 0.63, lo, hi, 0x554633, 0.035);
    }
  }
  if (faceIndex === 184) antler(wall);
}

function finish({ group, colliders }) {
  const lodge = group.children[0], { position, normal } = lodge.geometry.attributes;
  const coords = [];
  for (let i = 0; i < position.count; i++) {
    coords.push(((position.getX(i) - 11040) * normal.getZ(i) - (position.getZ(i) + 8404) * normal.getX(i)) / 0.92,
      position.getY(i) / 0.50);
  }
  lodge.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  const { texture: surface } = createFacadeSurfaceTexture();
  const brick = smoothstep(0.12, 0.62, abs(normalGeometry.y)).oneMinus();
  lodge.material.colorNode = vertexColor().mul(mix(1, texture(surface, uv()).r.mul(0.64).add(0.50), brick));

  // Landside paths stay open. The two low waterside walls follow the orthophoto and the east BGT bank outline.
  const terrace = new CivicBatch();
  for (const [p, q] of [
    [[11004.85, -8435.17], [11022.88, -8416.90]],
    [[11047.16, -8389.58], [11070.43, -8369.78]],
  ]) {
    const [x, z] = p, [xx, zz] = q;
    const bottom = Math.min(terrainHeightAt(x, z), terrainHeightAt(xx, zz), 15.1) - 0.17;
    const angle = -Math.atan2(zz - z, xx - x), cx = (x + xx) / 2, cz = (z + zz) / 2;
    const top = Math.max(16.72, terrainHeightAt(cx, cz) + 0.32);
    const length = Math.hypot(xx - x, zz - z);
    terrace.solid(new THREE.BoxGeometry(length, top - bottom, 0.44).rotateY(angle).translate(cx, (top + bottom) / 2, cz), 0x986246);
    terrace.solid(new THREE.BoxGeometry(length, 0.10, 0.51).rotateY(angle).translate(cx, top + 0.05, cz), 0x59616a);
    colliders.push(...wallColliders({ x, z }, { x: xx, z: zz }, bottom, top + 0.10, 0.51));
  }
  const mesh = terrace.mesh();
  mesh.name = 'Sint Hubertus lakeside walls';
  group.add(mesh);
}

export function createSintHubertus(_footprints, site) {
  return createSurveyLandmark(site, HUBERTUS_SHELLS, dressWall, finish);
}
