import * as THREE from 'three/webgpu';
import { attribute, texture, uv, vertexColor } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { INDUSTRIAL_HERITAGE_SURVEYS } from './ede-industrial-heritage-survey.js';
import { terrainHeightAt } from './terrain.js';

const stone = 0xb3a897, loftFrame = 0xc0bdb4, canopySteel = 0x653634;
const barracksStone = 0xc9ba9f, eavesPaint = 0xd9cbb0, greenSash = 0x324541;
const darkSteel = 0x3e4546;
let brickTexture;

function addBrickSurface(model) {
  const mesh = model.children[0];
  const { position, normal } = mesh.geometry.attributes;
  const coordinates = [], masonry = [];
  for (let i = 0; i < position.count; i++) {
    coordinates.push((position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 0.89,
      position.getY(i) / 0.58);
    masonry.push(Math.abs(normal.getY(i)) < 0.15 ? 1 : 0);
  }
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
  mesh.geometry.setAttribute('industrialMasonry', new THREE.Float32BufferAttribute(masonry, 1));
  brickTexture ??= createFacadeSurfaceTexture().texture;
  const brick = texture(brickTexture, uv()).r.mul(0.69).sub(0.58);
  mesh.material.colorNode = vertexColor().mul(brick.mul(attribute('industrialMasonry', 'float')).add(1));
  return model;
}

function beam(batch, from, to, size, color) {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length < 0.01) return;
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.divideScalar(length));
  const center = start.add(end).multiplyScalar(0.5);
  batch.solid(new THREE.BoxGeometry(size, length, size)
    .applyQuaternion(rotation).translate(center.x, center.y, center.z), color);
}

// Anchor platforms, canopies and trim to the surveyed wall plane.
function slab(wall, left, right, inner, outer, highInner, highOuter, thickness, color) {
  const { point, trim } = wall;
  const top = [point(left, highInner, inner), point(left, highOuter, outer),
    point(right, highOuter, outer), point(right, highInner, inner)];
  const bottom = top.map(([x, y, z]) => [x, y - thickness, z]);
  trim.quad(...top, color);
  trim.quad(...bottom.slice().reverse(), color);
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    trim.quad(top[i], bottom[i], bottom[next], top[next], color);
  }
  return top;
}

function loadingPlatform(wall, left, right, platforms) {
  const { point, normal, trim, faceIndex, base } = wall;
  const deckY = base + 0.92;
  const roofNear = base + 4.47, roofFar = roofNear - 0.22;
  const deck = slab(wall, left, right, 0, 1.55, deckY, deckY, 0.19, stone);
  const addPlatform = (id, top, height) => platforms.push({
    id: `bitterzoutloods-${faceIndex}-${id}`, outer: top.map(([x, , z]) => ({ x, z })), holes: [], height: () => height,
  });
  addPlatform('deck', deck, deckY);
  slab(wall, left, right, 0, 1.83, roofNear, roofFar, 0.14, 0x999b94);
  slab(wall, left, right, 1.79, 1.86, roofFar + 0.05, roofFar + 0.05, 0.17, 0xbbb9af);
  beam(trim, point(left, roofFar - 0.17, 1.73), point(right, roofFar - 0.17, 1.73), 0.09, canopySteel);
  if (normal.z < 0) return;
  const supports = faceIndex === 4 ? 14 : 1;
  const bay = wall.width / supports;
  for (let i = 0; i < supports; i++) {
    const middle = (i + 0.5) * bay;
    const [x, , z] = point(middle, deckY, 2.53);
    const grade = Math.min(deckY - 0.43, Math.max(base - 0.32, terrainHeightAt(x, z)));
    for (let j = 0; j < 3; j++) {
      const level = grade + (deckY - grade) * (j + 1) / 4;
      const edge = 2.48 - j * 0.31;
      const tread = slab(wall, middle - 0.52, middle + 0.52, edge - 0.31, edge, level, level, 0.075, darkSteel);
      addPlatform(`step-${i}-${j}`, tread, level);
    }
    for (const side of [-0.58, 0.58]) {
      const u = middle + side;
      beam(trim, point(u, grade + 0.10, 2.49), point(u, deckY, 1.52), 0.058, darkSteel);
      beam(trim, point(u, grade + 0.81, 2.49), point(u, deckY + 0.77, 1.52), 0.044, darkSteel);
      beam(trim, point(u, grade + 0.18, 2.49), point(u, grade + 0.81, 2.49), 0.030, darkSteel);
      beam(trim, point(u, deckY - 0.11, 1.52), point(u, deckY + 0.77, 1.52), 0.044, darkSteel);
    }
  }
}

function decorateWarehouse(wall, platforms) {
  const { low, high, width, faceIndex, point, trim, base } = wall;
  if (high - low < 7 || width < 0.45) return;
  surveyPanel(wall, 0, width, high - 0.18, high + 0.04, stone, 0.072);
  if (width <= 1.1) return;
  const loadingSide = [4, 11, 20].includes(faceIndex);
  const count = faceIndex === 4 ? 14 : faceIndex === 20 ? 15 : faceIndex === 11 ? 1 : 3;
  const bay = width / count;
  if (loadingSide) loadingPlatform(wall, faceIndex === 11 ? 0 : 0.15, faceIndex === 4 ? width : width - 0.16, platforms);
  for (let i = 0; i < count; i++) {
    const center = (i + 0.5) * bay, left = i * bay, right = left + bay;
    if (i > 0) {
      surveyPanel(wall, left - 0.18, left + 0.18, base + 0.03, high, 0x7e6b5a, 0.113);
      slab(wall, left - 0.33, left + 0.33, -0.01, 0.21, high + 0.08, high + 0.08, 0.17, stone);
    }
    for (let u = left + 0.40; u < right - 0.31; u += 0.28) {
      surveyPanel(wall, u, u + 0.13, high - 0.66, high - 0.38, 0x655549, 0.065);
    }
    if (loadingSide) {
      for (const x of [center - 1.05, center + 1.05]) {
        surveyWindow(wall, x - 0.69, x + 0.69, base + 5.15, base + 7.25,
          { color: x < center ? 0x506067 : 0x5a6970, frame: loftFrame, columns: 3, rows: 4 });
        surveyPanel(wall, x - 0.77, x + 0.77, base + 5.08, base + 5.17, stone, 0.077);
      }
      const front = wall.normal.z > 0;
      const opening = front ? 0.93 : 1.31;
      surveyWindow(wall, center - opening, center + opening, base + 0.92, base + 4.00,
        { color: 0x354447, frame: darkSteel, columns: 2, rows: front ? 2 : 1 });
      surveyPanel(wall, center - 1.50, center + 1.50, base + 4.07, base + 4.16, stone, 0.065);
      if (front) for (const side of [-1, 1]) {
        const shutter = center + side * 1.28;
        surveyPanel(wall, shutter - 0.29, shutter + 0.29, base + 0.93, base + 3.98, loftFrame, 0.060);
        for (const y of [1.37, 2.50, 3.66]) {
          surveyPanel(wall, shutter - 0.23, shutter + 0.23, base + y, base + y + 0.035, 0x9d9a91, 0.068);
        }
      }
      const u = Math.min(right - 0.24, center + 1.72);
      beam(trim, point(u, base + 3.17, 0.04), point(u, base + 4.13, 1.75), 0.065, canopySteel);
      beam(trim, point(u, base + 4.28, 0), point(u, base + 4.07, 1.80), 0.08, canopySteel);
    } else {
      for (const x of [center - 1.0, center + 1.0]) {
        if (faceIndex === 6 && i === 2 && x > center) continue;
        for (const y of [base + 1.14, base + 5.15]) {
          surveyWindow(wall, x - 0.65, x + 0.65, y, y + 2.12,
            { color: 0x546468, frame: loftFrame, columns: 3, rows: 4 });
          surveyPanel(wall, x - 0.72, x + 0.72, y - 0.08, y + 0.02, stone, 0.077);
        }
      }
    }
  }
}

function warehouseRoof({ trim }) {
  const start = new THREE.Vector3(290.83, 8.83, 2472.87), end = new THREE.Vector3(365.78, 8.83, 2497.87);
  const direction = end.clone().sub(start).normalize();
  const depth = new THREE.Vector3(-direction.z, 0, direction.x);
  const pitch = -Math.atan2(direction.z, direction.x);
  for (const [x, z] of [[290.27, 2472.99], [285.48, 2487.30], [361.40, 2512.70], [366.29, 2498.33]]) {
    trim.solid(new THREE.BoxGeometry(1.16, 0.23, 1.16).rotateY(pitch).translate(x, 8.93, z), stone);
  }
  const point = (u, v, y) => [start.x + direction.x * u + depth.x * v,
    start.y + y, start.z + direction.z * u + depth.z * v];
  for (let bay = 0; bay < 15; bay++) {
    const u = 2.5 + 5.27 * bay;
    const skylight = 4.55 + (bay % 4) * 1.39;
    for (const [v, w, d] of [[skylight, 1.33, 2.18], [bay % 3 ? 11.5 : 2.0, 2.10, 1.14]]) {
      trim.quad(point(u - w / 2 - 0.10, v + d + 0.08, 0.04), point(u + w / 2 + 0.10, v + d + 0.08, 0.04),
        point(u + w / 2 + 0.10, v - 0.08, 0.04), point(u - w / 2 - 0.10, v - 0.08, 0.04), 0x99a0a0);
      trim.quad(point(u - w / 2, v + d, 0.076), point(u + w / 2, v + d, 0.076),
        point(u + w / 2, v, 0.076), point(u - w / 2, v, 0.076), 0x405261, 0.54);
    }
  }
}

function barracksOpening(wall, center, width, low, high, door = false) {
  const left = center - width / 2, right = center + width / 2;
  if (!surveyOpeningFits(wall, left - 0.10, right + 0.10, low - 0.08, high + 0.12)) return false;
  surveyPanel(wall, left - 0.12, right + 0.12, low - 0.045, high + 0.11, barracksStone, 0.025);
  if (door) {
    const transom = high - 0.76;
    surveyPanel(wall, left, right, low, transom, 0xa15a34, 0.046);
    surveyPanel(wall, center - 0.10, center + 0.10, low + 0.53, transom - 0.14, 0x3c4b49, 0.055, 0.4);
    surveyWindow(wall, left, right, transom, high, { frame: greenSash, columns: 2, rows: 2 });
  } else {
    surveyWindow(wall, left, right, low, high, { color: 0x53696c, frame: greenSash, columns: 2, rows: 4 });
    surveyPanel(wall, left - 0.13, right + 0.13, low - 0.09, low + 0.018, barracksStone, 0.110);
  }
  return true;
}

function balcony(wall, center, y) {
  const { trim, point } = wall;
  const left = center - 1.48, right = center + 1.48;
  slab(wall, left, right, 0.008, 1.19, y, y, 0.16, darkSteel);
  slab(wall, left, right, 1.12, 1.18, y + 0.65, y + 0.65, 0.64, 0x505655);
  for (let u = left + 0.05; u < right; u += 0.17) {
    beam(trim, point(u, y + 0.62, 1.15), point(u, y + 0.96, 1.15), 0.034, darkSteel);
  }
  beam(trim, point(left, y + 0.98, 1.15), point(right, y + 0.98, 1.15), 0.051, darkSteel);
  for (const u of [left + 0.024, right - 0.024]) {
    for (const h of [y + 0.07, y + 0.97]) beam(trim, point(u, h, 0.02), point(u, h, 1.15), 0.045, darkSteel);
    for (let d = 0.16; d < 1.16; d += 0.17) beam(trim, point(u, y + 0.07, d), point(u, y + 0.97, d), 0.038, darkSteel);
  }
}

const chaletGables = new Set([18, 26, 57, 64, 65, 90, 105, 115, 129, 131, 168, 210]);

function chaletGable(wall) {
  const { a, b, building, rings, point, trim, width } = wall;
  const topAt = endpoint => Math.max(...rings[0].filter(([x, , z]) => Math.hypot(x - endpoint.x, z - endpoint.z) < 0.13).map(p => p[1]));
  const from = topAt(a), to = topAt(b);
  if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(from - to) < 1.3) return;
  const direction = from > to ? 1 : -1, tip = from > to ? 0 : width;
  const ridge = Math.max(from, to), shoulder = Math.min(from, to);
  trim.quad(point(0, from + 0.068, 0.003), point(0, from + 0.068, 0.45),
    point(width, to + 0.068, 0.45), point(width, to + 0.068, 0.003), building.roofColor);
  beam(trim, point(0, from, 0.44), point(width, to, 0.44), 0.176, eavesPaint);
  const tie = shoulder + (ridge - shoulder) * 0.48, span = width * 0.52 * direction;
  beam(trim, point(tip, tie, 0.36), point(tip + span, tie, 0.36), 0.10, eavesPaint);
  beam(trim, point(tip + span, tie, 0.36), point(tip + span * 1.24, tie - 0.43, 0.035), 0.087, eavesPaint);
  if (direction > 0) beam(trim, point(tip, tie - 0.19, 0.45), point(tip, ridge + 0.41, 0.45), 0.115, eavesPaint);
}

function decorateBarracks(wall) {
  const { buildingIndex, faceIndex, width, low, high, base, normal, point, trim, a, b } = wall;
  if (width < 0.44 || high - low < 0.55) return;
  const stable = buildingIndex === 1;
  const groundWall = low < base + 0.045;
  if (groundWall) {
    const bands = stable ? [0.45, 4.00, 6.65] : [0.53, 3.98, 7.06, 9.15];
    for (const y of bands) {
      if (base + y > high - 0.18) continue;
      const inset = width > 0.8 ? 0.04 : 0.014;
      if (surveyOpeningFits(wall, inset, width - inset, base + y - 0.070, base + y + 0.111)) {
        surveyPanel(wall, 0, width, base + y - 0.07, base + y + 0.11, barracksStone, 0.018);
      }
    }
  }
  if (!stable && chaletGables.has(faceIndex)) {
    chaletGable(wall);
    if (![90, 105, 115, 210].includes(faceIndex)) return;
  }
  if (width < 1.45) return;
  const outside = Math.abs(normal.x) > 0.82 && (a.x + b.x < 819 || a.x + b.x > 939);
  const bays = Math.max(1, Math.round(width / (stable ? 4.80 : 4.82)));
  const pitch = width / bays;
  if (!stable && groundWall && width > 8.0 && [5, 7, 23, 29, 55, 88, 102, 130, 161].includes(faceIndex)) {
    const eave = high - 0.13;
    trim.quad(point(0, high + 0.013, 0.005), point(0, eave + 0.055, 0.49),
      point(width, eave + 0.055, 0.49), point(width, high + 0.013, 0.005), wall.building.roofColor);
    beam(trim, point(0, eave, 0.49), point(width, eave, 0.49), 0.13, eavesPaint);
    for (let u = 0.57; u < width - 0.23; u += 0.92) {
      beam(trim, point(u, eave - 0.74, 0.04), point(u, eave - 0.043, 0.51), 0.076, eavesPaint);
    }
  }
  for (let bay = 0; bay < bays; bay++) {
    const middle = (bay + 0.5) * pitch;
    const wide = pitch > 3.42;
    const spaces = wide ? [-0.99, 0.99] : [0];
    for (const [i, position] of spaces.entries()) {
      const u = middle + position;
      const entry = groundWall && wide && (i === 1) && bay % 2 === 0 && !stable;
      const groundLow = entry ? base + 0.25 : base + (stable ? 0.83 : 1.03);
      const groundHigh = base + (stable ? 3.67 : 3.81);
      if (groundWall) barracksOpening(wall, u, 1.18, groundLow, groundHigh, entry);
      const upperLow = base + (stable ? 4.78 : outside ? 4.24 : 4.88);
      const upperHigh = Math.min(base + (stable ? 6.30 : 7.00), high - 0.35);
      if (upperHigh - upperLow > 1.12) barracksOpening(wall, u, 1.19, upperLow, upperHigh);
      if (!stable && high > base + 9.50
        && surveyOpeningFits(wall, u - 0.55, u + 0.55, base + 7.45, base + 8.90)) {
        barracksOpening(wall, u, 1.10, base + 7.46, base + 8.90);
      }
    }
    if (!stable && outside && width > 12 && wide && high > base + 6.8
      && surveyOpeningFits(wall, middle - 1.47, middle + 1.47, base + 4.15, base + 5.36)) {
      balcony(wall, middle, base + 4.25);
    }
  }
}

function stableSolarRoof({ trim }) {
  // The 2025 orthophoto shows a solar array over the stable's long single-pitch roof.
  const a = [409.64, 24.26, 1195.10], b = [457.47, 24.23, 1191.85];
  const c = [410.58, 18.48, 1208.85];
  const point = (u, v, lift) => a.map((value, i) => value + u * (b[i] - value) + v * (c[i] - value) + (i === 1 ? lift : 0));
  for (let row = 0; row < 6; row++) for (let column = 0; column < 34; column++) {
    if (row >= 4 && (column === 12 || column === 22)) continue;
    const u = 0.063 + column * 0.026, v = 0.13 + row * 0.109;
    const w = 0.024, d = 0.101;
    trim.quad(point(u, v, 0.10), point(u, v + d, 0.10), point(u + w, v + d, 0.10), point(u + w, v, 0.10), 0x999fa0);
    trim.quad(point(u + 0.00075, v + 0.003, 0.106), point(u + 0.00075, v + d - 0.003, 0.106),
      point(u + w - 0.00075, v + d - 0.003, 0.106), point(u + w - 0.00075, v + 0.003, 0.106),
      (row + column) % 6 ? 0x4d6078 : 0x576b82, 0.58);
  }
}

function createWarehouse(site) {
  const paths = [];
  return createSurveyLandmark(site, INDUSTRIAL_HERITAGE_SURVEYS[site.id], wall => decorateWarehouse(wall, paths),
    parts => {
      parts.platforms.push(...paths);
      warehouseRoof(parts);
    });
}

export const INDUSTRIAL_HERITAGE_FACTORIES = {
  'enka-bitterzoutloods': (_footprints, site) => addBrickSurface(createWarehouse(site)),
  'van-essenkazerne': (_footprints, site) => addBrickSurface(createSurveyLandmark(
    site, INDUSTRIAL_HERITAGE_SURVEYS[site.id], decorateBarracks, stableSolarRoof)),
};
