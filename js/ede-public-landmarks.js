import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { CivicBatch } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { EDE_PUBLIC_LANDMARKS, PUBLIC_LANDMARK_SURVEYS } from './ede-public-survey.js';

export { EDE_PUBLIC_LANDMARKS };

const glass = 0x455c67;
const cream = 0xd5d3c5;
const brick = 0x9a654c;
const copper = 0x568882;

function bays(wall, count, levels, { edge = 0.35, gap = 0.4, ...finish } = {}) {
  const pitch = (wall.width - 2 * edge) / count;
  for (let i = 0; i < count; i++) {
    const a = edge + pitch * i + gap / 2;
    const b = a + pitch - gap;
    for (const [lo, hi] of levels) surveyWindow(wall, a, b, lo, hi, finish);
  }
}

function prism(wall, u, v, lo, hi, inner, outer, color) {
  const p = wall.point;
  const a = p(u, lo, outer), b = p(v, lo, outer), c = p(v, hi, outer), d = p(u, hi, outer);
  const e = p(u, lo, inner), f = p(v, lo, inner), g = p(v, hi, inner), h = p(u, hi, inner);
  const { trim } = wall;
  trim.quad(a, b, c, d, color);
  trim.quad(e, h, g, f, color);
  trim.quad(e, a, d, h, color);
  trim.quad(b, f, g, c, color);
  trim.quad(e, f, b, a, color);
  trim.quad(d, c, g, h, color);
}

function doelen(wall) {
  const { faceIndex, width, high, low, a, b } = wall;
  if ([5, 7, 13].includes(faceIndex)) {
    const plazaEnd = faceIndex === 7;
    const count = plazaEnd ? 5 : 15;
    bays(wall, count, [[6.0, 7.45], [9.1, 10.55], [12.2, 13.62]], {
      gap: 0.2, frame: 0xafc4c0, color: 0x547379,
    });
    bays(wall, plazaEnd ? 4 : 11, [[1.25, 4.72]], {
      edge: 0.32, gap: 0.16, frame: 0xb9c1b8, color: 0x384e50, rows: 2,
    });
    for (const elevation of [4.95, 5.55, 7.75, 8.35, 10.85, 11.45, 13.95, 14.55]) {
      surveyPanel(wall, 0.02, width - 0.02, elevation, elevation + 0.035, 0x42726c);
    }
    if (plazaEnd) {
      prism(wall, 2.62, 6.97, 4.51, 4.74, 0, 0.65, 0x809d98);
      surveyLabel(wall, 2.1, 7.5, 4.8, 5.2, 'DE DOELEN', '#568882', '#e5ece6');
    }
    return copper;
  }
  if ([1, 2, 22, 63].includes(faceIndex)) {
    const floor = faceIndex === 63 ? 3.05 : (a.x + b.x) / 130 + 0.2;
    const count = Math.round(width / 2.65);
    bays(wall, count, [[floor + 0.2, 5.14], [6.06, 8.78], [9.43, 12.78]], {
      gap: 0.63, frame: cream, color: glass, columns: 2, rows: 2,
    });
    surveyPanel(wall, 0.015, width - 0.015, 5.38, 5.56, 0xbcb3a0);
    surveyPanel(wall, 0.015, width - 0.015, high - 0.53, high - 0.36, 0xd2c9b6);
    return brick;
  }
  if ([9, 18, 61].includes(faceIndex)) {
    bays(wall, 1, [[low + 1.1, high - 0.7]], {
      edge: 0.17, gap: 0.16, frame: 0xa9babb, color: 0x426065, columns: 2, rows: 7,
    });
    return 0x899797;
  }
  if (Math.max(a.x, b.x) < 76.6 && low > 12.5) return 0x898982;
}

function police(wall) {
  const { faceIndex, width, high } = wall;
  const blue = 0x243e70;
  if (faceIndex === 83) {
    const bottom = -0.86, top = high - 0.35;
    for (const [start, end] of [[0.9, 2.77], [5.0, 6.90], [9.13, 10.42]]) {
      surveyWindow(wall, width - end, width - start, bottom + 0.17, top - 0.44, {
        color: 0x354e5c, frame: 0x242e34, rows: 10,
      });
    }
    const door = width - 2.77, jamb = width - 0.9;
    surveyPanel(wall, door, jamb, bottom + 0.16, bottom + 2.55, 0x283633, 0.062);
    surveyPanel(wall, (door + jamb) / 2 - 0.03, (door + jamb) / 2 + 0.03,
      bottom + 0.16, bottom + 2.55, 0x56605c, 0.072);
    for (const u of [1.85, 5.2, 8.7, 12.5, width + 0.73]) {
      prism(wall, u, u + 0.15, bottom, top, 0.39, 0.56, blue);
    }
    prism(wall, -0.3, width + 1.05, top - 0.04, top + 0.38, 0.03, 1.00, 0x373b41);
    for (const y of [2.1, 5.25]) prism(wall, 0.25, 6.1, y, y + 0.14, 0.02, 0.21, 0x655a55);
    surveyLabel(wall, width - 4.36, width - 3.0, 2.96, 3.68, 'POLITIE', '#243e70', '#f4efda');
    return 0x885044;
  }
  if ([9, 17, 54, 103, 107].includes(faceIndex)) {
    bays(wall, Math.round(width / 2.45), [[3.15, 4.77], [6.48, 8.36]], {
      gap: 0.24, frame: 0xb5b8b4, columns: 2,
    });
    return 0x989a95;
  }
}

const stationRed = 0xa43d31;
const fireMastBase = 13.05;
const fireSurvey = PUBLIC_LANDMARK_SURVEYS['brandweerkazerne-ede'][0];
// The survey solid encloses the metal lattice and aerial. Keep the surveyed position and height.
const fireShell = {
  ...fireSurvey,
  points: fireSurvey.points.map(([x, y, z]) => [x, Math.min(y, fireMastBase), z]),
};
const fireMastHeight = Math.max(...fireSurvey.points.map(p => p[1]));

function fireStation(wall) {
  const { faceIndex, width, high, a, b } = wall;
  if (high >= fireMastBase - 0.02) return stationRed;
  if (faceIndex === 91) {
    const pitch = width / 5;
    const low = 2.16, top = 6.48;
    for (let bay = 0; bay < 5; bay++) {
      const start = bay * pitch + 0.72, end = (bay + 1) * pitch - 0.72;
      const middle = (start + end) / 2;
      surveyPanel(wall, start - 0.1, end + 0.1, low, top + 0.1, 0x5d5141);
      prism(wall, start - 0.11, end + 0.11, top, top + 0.11, 0.025, 0.23, 0xafaba0);
      for (const [u, v] of [[start, middle - 0.06], [middle + 0.06, end]]) {
        surveyPanel(wall, u, v, low + 0.025, top, 0xc4ad75, 0.053);
        for (let y = low + 0.55; y < top; y += 0.52) {
          surveyPanel(wall, u, v, y, y + 0.026, 0x9f8d61, 0.060);
        }
        const pane = (v - u) / 4;
        for (const y of [low + 1.76, low + 2.26]) for (let i = 0; i < 4; i++) {
          const center = u + pane * (i + 0.5);
          surveyPanel(wall, center - 0.23, center + 0.23, y, y + 0.29, 0x394445, 0.067, 0.46);
        }
      }
    }
    surveyPanel(wall, 0.02, width - 0.02, high - 0.15, high - 0.03, stationRed);
    return 0x8f816e;
  }
  if ([18, 28, 34, 39, 46, 55, 63, 99, 112].includes(faceIndex)) {
    bays(wall, Math.max(2, Math.round(width / 2.9)), [[4.38, 6.24], [7.28, 8.77]], {
      gap: 0.38, frame: 0xc4b9a9, columns: 2,
    });
    if ([28, 34, 39, 55, 99, 112].includes(faceIndex)) {
      surveyPanel(wall, 0.04, width - 0.04, 9.04, 9.95, 0x9e4138);
      if (faceIndex === 55) surveyLabel(wall, 2.5, 14.9, 3.3, 4.06, 'BRANDWEER', '#9d8571', '#f4e7d9');
      return 0x977b70;
    }
  }
  if (a.z > 610 && b.z > 610) return 0x938879;
}

function fireMast({ group }) {
  const batch = new CivicBatch(), matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
  function member(from, to, radius, color) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const delta = b.clone().sub(a);
    rotation.setFromUnitVectors(up, delta.clone().normalize());
    matrix.compose(a.addScaledVector(delta, 0.5), rotation, scale);
    batch.solid(new THREE.CylinderGeometry(radius, radius, delta.length(), 5).applyMatrix4(matrix), color);
  }
  const corners = [[-39.94, 608.83], [-38.74, 607.79], [-38.55, 609.43]];
  const top = fireMastHeight - 6.5;
  for (const [i, [x, z]] of corners.entries()) {
    member([x, fireMastBase, z], [x, top, z], 0.062, stationRed);
    const [nx, nz] = corners[(i + 1) % corners.length];
    for (let cell = 0; cell < 8; cell++) {
      const low = fireMastBase + (top - fireMastBase) * cell / 8;
      const high = fireMastBase + (top - fireMastBase) * (cell + 1) / 8;
      member([x, low, z], [nx, low, nz], 0.035, stationRed);
      member([x, low, z], [nx, high, nz], 0.026, stationRed);
    }
  }
  member([-39.08, top - 1, 608.68], [-39.08, fireMastHeight, 608.68], 0.055, stationRed);
  const mast = batch.mesh();
  mast.name = 'Brandweer radio mast';
  mast.castShadow = false;
  group.add(mast);
}

function kernhuis(wall) {
  const { faceIndex, width, low, high } = wall;
  if ([2, 4, 5].includes(faceIndex)) {
    const front = faceIndex === 4;
    bays(wall, front ? 8 : Math.round(width / 3.8), [
      [low + (front ? 0.23 : 1.08), low + 2.52],
      [low + 2.74, low + (front ? 6.43 : 5.8)],
    ], { edge: 0.4, gap: front ? 1.46 : 1.6, frame: 0xc3c5c7, color: 0x516a78, columns: 2, rows: 2 });
  }
  if (faceIndex === 9) {
    surveyWindow(wall, 3.87, 5.51, low + 0.16, low + 5.83,
      { frame: 0xc7c9c9, color: 0x37484e, columns: 2, rows: 3 });
    surveyWindow(wall, 0.93, 2.31, low + 0.69, low + 2.93,
      { frame: 0xcccdca, color: 0x40565c });
    surveyLabel(wall, 0.21, 1.34, low + 4.37, low + 4.96, 'Het', '#774238', '#f0eeeb');
    surveyLabel(wall, 2.34, 3.81, low + 4.37, low + 4.96, 'Kernhuis', '#774238', '#f0eeeb');
    const center = 1.84, y = low + 4.66, radius = 0.47;
    const colors = [0x92bf73, 0xb6bd64, 0xe6ab67, 0xb45f83, 0x976e9c, 0x5e96b7];
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
      wall.trim.polygon([[wall.point(center, y, 0.077),
        wall.point(center + radius * Math.cos(a), y + radius * Math.sin(a), 0.077),
        wall.point(center + radius * Math.cos(b), y + radius * Math.sin(b), 0.077)]], colors[Math.floor(i / 4)]);
    }
    return 0x774238;
  }
  if ([2, 3, 4, 5, 6, 8].includes(faceIndex)) {
    surveyPanel(wall, 0.01, width - 0.01, high - 0.21, high - 0.05, 0xbfc0c1);
  }
  if (faceIndex === 4) {
    for (const u of [0.02, width - 0.13]) {
      surveyPanel(wall, u, u + 0.11, low + 0.03, high - 0.11, 0xb7b8ba);
    }
    return 0x94463e;
  }
}

let masonryTexture;
const masonryColors = [
  brick, 0x885044, 0x9d604e, 0x8f816e, 0x9d8571, 0x977b70, 0x938879, 0x87483e, 0x774238, 0x94463e,
].map(value => new THREE.Color(value));

function buildExterior(site, buildings, decorate, finish) {
  const model = createSurveyLandmark(site, buildings, decorate, finish);
  const mesh = model.children[0];
  const { position, normal, color } = mesh.geometry.attributes;
  const coords = [], masonry = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const nx = normal.getX(i), nz = normal.getZ(i);
    coords.push((x * nz - z * nx) / 1.02, y / 0.62);
    masonry.push(Number(Math.abs(normal.getY(i)) < 0.12 && masonryColors.some(tint =>
      Math.abs(color.getX(i) - tint.r) + Math.abs(color.getY(i) - tint.g) + Math.abs(color.getZ(i) - tint.b) < 1e-5)));
  }
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  mesh.geometry.setAttribute('civicMasonry', new THREE.Float32BufferAttribute(masonry, 1));
  masonryTexture ??= createFacadeSurfaceTexture().texture;
  const grain = texture(masonryTexture, uv()).r;
  mesh.material.colorNode = mix(1, grain.mul(0.67).add(0.39), attribute('civicMasonry', 'float'));
  return model;
}

export const PUBLIC_LANDMARK_FACTORIES = {
  'stadskantoor-de-doelen': (_footprints, site) => buildExterior(site, PUBLIC_LANDMARK_SURVEYS[site.id], doelen),
  'politiebureau-ede': (_footprints, site) => buildExterior(site, PUBLIC_LANDMARK_SURVEYS[site.id], police),
  'brandweerkazerne-ede': (_footprints, site) => buildExterior(site, [fireShell], fireStation, fireMast),
  'het-kernhuis': (_footprints, site) => buildExterior(site, PUBLIC_LANDMARK_SURVEYS[site.id], kernhuis),
};
