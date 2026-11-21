import * as THREE from 'three/webgpu';
import { mix, normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { polygonNormal } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { HORA_SANATORIUM_SURVEY } from './ede-hora-sanatorium-survey.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const cream = 0xd7d2c5;
const frame = 0xeeece0;
const roof = 0xa36346;
const fascia = 0x54564b;
const terraceFaces = new Set([31, 106, 119]);
const entranceFaces = new Set([36, 39, 153]);
const westPavilionFaces = new Set([105, 136, 138, 248, 250]);
// Opening rhythm on the photographed wings and their visible returns.
const historicBays = {
  0: 1, 1: 3, 11: 2, 13: 5, 40: 1, 41: 2, 46: 8, 89: 2, 97: 1,
  110: 1, 120: 1, 165: 2, 167: 1, 187: 1, 207: 1, 213: 1, 214: 1, 218: 4, 290: 7, 292: 2,
};
const glass = [0x455555, 0x536565, 0x586a68, 0x4d5d5e];

const { points, faces } = HORA_SANATORIUM_SURVEY;
const shellPoints = [...points];
// The glazed vestibule ends at its flat roof. Run the tiled eave behind it, along the main wing.
const vestibuleJoin = shellPoints.push([1317.27, 21.28, 2765.61]) - 1;
const adjustedFaces = faces.map((face, i) => {
  if (i === 40) return [0, [123, 124, 125, vestibuleJoin]];
  if (i === 72) return [0, [43, 42, vestibuleJoin, 126]];
  if (i === 125) return [1, [42, 216, vestibuleJoin]];
  if (i === 314) return [1, face[1].filter(index => index !== 215 && index !== 122)];
  if (!terraceFaces.has(i)) return face;
  return [0, face[1].map(index => {
    const [x, y, z] = points[index];
    shellPoints.push([x, Math.max(21.16, y), z]);
    return shellPoints.length - 1;
  })];
});
const roofColors = {};
for (const [i, [isRoof, ring]] of faces.entries()) {
  if (!isRoof) continue;
  const normal = polygonNormal(ring.map(index => points[index]));
  roofColors[i] = Math.abs(normal.y) < 0.96 ? roof : 0x5d5f55;
}
Object.assign(roofColors, {
  125: 0x464943, 313: 0x464943, 319: 0x464943, 324: 0x77776d, 325: 0x6b6b61, 328: 0xa5a6a1,
  331: 0x75766c, 332: 0x8a8b83, 338: 0x5c5c53, 339: 0x66655a, 340: 0x62645a,
});
const [footprint] = HORA_SANATORIUM_SURVEY.outline;
// Use the back of the open veranda for the building collision boundary.
const collisionOutline = [[...footprint.slice(0, 29), [1307.75, 2739.79], [1304.76, 2752.06], ...footprint.slice(32)]];
const shellSurvey = {
  ...HORA_SANATORIUM_SURVEY, outline: collisionOutline, points: shellPoints, faces: adjustedFaces, roofColors,
};

function wallBox(wall, u, y, offset, width, height, depth, color, batch = wall.trim) {
  const angle = Math.atan2(wall.a.z - wall.b.z, wall.b.x - wall.a.x);
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(angle)
    .translate(...wall.point(u, y, offset)), color);
}

function ribbon(wall, bottom, top, color, offset = 0.04) {
  surveyPanel(wall, 0.015, wall.width - 0.015, bottom, top, color, offset);
}

function opening(wall, u, half, bottom, top, pane, columns = 2, rows = 2) {
  const left = u - half, right = u + half;
  if (!surveyWindow(wall, left, right, bottom, top, { frame, color: pane, columns, rows })) return;
  surveyPanel(wall, left - 0.045, right + 0.045, bottom - 0.10, bottom, 0xa5a599, 0.071);
}

function terrace(wall) {
  const { width, faceIndex } = wall;
  const deck = 18.29, underside = 21.16;
  const bayCount = Math.max(2, Math.round(width / 1.54));
  wallBox(wall, width * 0.5, underside - 0.055, -0.72, width, 0.11, 1.50, fascia, wall.shell);
  for (let i = 0; i <= bayCount; i++) {
    const u = 0.10 + i * (width - 0.20) / bayCount;
    wallBox(wall, u, (deck + underside) / 2, -0.17, 0.105, underside - deck, 0.14, frame, wall.shell);
  }
  if (faceIndex === 31) {
    wallBox(wall, width * 0.5, deck - 0.30, -1.18, width, 0.60, 2.39, 0x817c6d, wall.shell);
    ribbon(wall, deck + 0.21, underside - 0.10, 0x3e4b49, -2.44);
    for (let i = 1; i < bayCount; i++) {
      const u = i * width / bayCount;
      surveyPanel(wall, u - 0.035, u + 0.035, deck + 0.21, underside - 0.10, frame, -2.43);
    }
  }
  return fascia;
}

function entrance(wall) {
  const { width, faceIndex } = wall;
  const start = 18.48;
  const count = faceIndex === 39 ? 3 : Math.round(width / 1.45);
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) * width / count;
    const half = width / count * 0.47;
    surveyWindow(wall, u - half, u + half, start, 20.91,
      { frame, color: glass[i % glass.length], columns: faceIndex === 39 ? 1 : 2, rows: 2 });
    if (faceIndex === 39 && i === 1) {
      for (const side of [-1, 1]) {
        surveyPanel(wall, u + side * 0.12 - 0.016, u + side * 0.12 + 0.016,
          start + 0.92, start + 1.28, 0xa0a29d, 0.084);
      }
    }
  }
  ribbon(wall, 20.96, 21.22, fascia, 0.057);
  if (faceIndex === 39) {
    const [x, , z] = wall.point(width * 0.5, 0, 0.61);
    const ground = getTerrain() ? terrainHeightAt(x, z) : 18.30;
    wallBox(wall, width * 0.5, ground + 0.035, 0.38, width - 0.12, 0.15, 0.83, 0xa9a497);
  }
  return 0x96998f;
}

function decorate(wall) {
  const { faceIndex, width, high, low, base, a, b } = wall;
  if (terraceFaces.has(faceIndex)) return terrace(wall);
  if (entranceFaces.has(faceIndex)) return entrance(wall);
  if (width < 1.1 || high - low < 1.2) return;
  const annex = (a.x + b.x) / 2 > 1361;
  if (westPavilionFaces.has(faceIndex) || historicBays[faceIndex]) {
    const count = historicBays[faceIndex] ?? 1;
    const half = Math.min(0.78, width / count * 0.37);
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) * width / count;
      const pane = glass[(faceIndex + i) % glass.length];
      opening(wall, u, half, 23.12, 25.71, pane);
      if (low < 20) opening(wall, u, half, 19.20, 21.84, pane);
    }
    if (low < 21.9 && high > 22.6) ribbon(wall, 22.31, 22.47, 0xbcb8aa);
    return cream;
  }
  if (width > 2.5 && low <= base + 0.02 && high > 20.9) {
    const count = Math.round(width / (annex ? 3.25 : 2.9));
    for (let i = 0; i < count; i++) {
      const center = (i + 0.5) * width / count;
      const half = Math.min(1.05, width / count * 0.40);
      opening(wall, center, half, 19.52, 20.95, glass[i % glass.length], 2, 1);
      if (high > 24) opening(wall, center, half, 22.28, 23.69, glass[(i + 1) % glass.length], 2, 1);
    }
    if (annex) ribbon(wall, high - 0.46, high - 0.22, 0x949283);
  }
  if (annex) return 0xa9a699;
  if (low > 26 && high < 32) return 0xb8b5a6;
}

// Dormer fronts are spaced along the observed tiled roof planes. Depths run into the survey roof.
const dormerRows = [
  [[1307.16, 2741.96], [1304.97, 2750.00], 28.10, [0.23, 0.74], 1.42],
  [[1304.84, 2751.91], [1310.72, 2753.59], 27.95, [0.50], 1.63],
  [[1311.74, 2755.79], [1319.67, 2769.46], 28.02, [0.07, 0.22, 0.38, 0.55, 0.72, 0.89], 1.54],
  [[1320.93, 2774.66], [1330.81, 2777.46], 26.49, [0.27, 0.63], 1.50],
  [[1334.22, 2774.48], [1349.77, 2765.47], 27.84, [0.09, 0.24, 0.40, 0.57, 0.74, 0.90], 1.44],
  [[1351.58, 2764.34], [1358.73, 2766.38], 26.68, [0.34, 0.71], 1.45],
];

function finish({ group, trim }) {
  const masonry = createFacadeSurfaceTexture().texture;
  const color = vertexColor();
  const across = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
  const wallJoint = texture(masonry, vec2(across.div(1.00), positionWorld.y.div(0.68))).r;
  const tileJoint = texture(masonry, vec2(across.div(1.16), positionWorld.y.div(1.33))).r;
  const wall = normalWorld.y.abs().lessThan(0.12);
  const tile = normalWorld.y.abs().greaterThan(0.19).and(normalWorld.y.abs().lessThan(0.96));
  group.children[0].material.colorNode = color.mul(mix(mix(1, tileJoint.mul(0.32).add(0.72), tile),
    wallJoint.mul(0.18).add(0.85), wall));

  for (const [a, b, sill, centers, width] of dormerRows) {
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(dx, dz), angle = -Math.atan2(dz, dx);
    const inwardX = dz / length, inwardZ = -dx / length;
    for (const fraction of centers) {
      const x = a[0] + dx * fraction, z = a[1] + dz * fraction;
      const box = (w, h, d, y, inward, tint) => trim.solid(new THREE.BoxGeometry(w, h, d).rotateY(angle)
        .translate(x + inward * inwardX, y, z + inward * inwardZ), tint);
      box(width, 1.32, 1.32, sill + 0.56, 0.56, 0xd9d4c5);
      box(width + 0.17, 0.13, 1.42, sill + 1.26, 0.56, 0x685e51);
      box(width - 0.19, 0.99, 0.045, sill + 0.59, -0.116, 0x435555);
      box(0.065, 1.01, 0.055, sill + 0.59, -0.137, frame);
      box(width + 0.04, 0.087, 0.17, sill + 0.071, -0.087, 0xb6b3a7);
    }
  }
}

export const HORA_SANATORIUM_FACTORIES = {
  'hora-sanatorium': (_footprints, site) => createSurveyLandmark(site, [shellSurvey], decorate, finish),
};
