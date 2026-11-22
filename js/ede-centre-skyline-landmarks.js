import * as THREE from 'three/webgpu';
import { CENTRE_SKYLINE_SHELLS, EDE_CENTRE_SKYLINE_LANDMARKS } from './ede-centre-skyline-survey.js';
import { createSurveyLandmark, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';

const glass = [0x45565a, 0x52646c, 0x627075, 0x3b4d55];
const timber = 0x9c634b;
const palettes = {
  'de-griek':          { wall: 0x77716a, roof: 0x4e4d4b, frame: 0xaeb0a8, edge: 0xa7a6a0, rail: 0x899b9e },
  'de-halte-gelria':   { wall: 0x834c44, roof: 0x585451, frame: 0xd6d1c3, edge: 0x9c837b, rail: 0xc4cac4 },
  kleefsehof:          { wall: 0xa29481, roof: 0x675d5a, frame: 0xc6c7bc, edge: 0xaab0a5, rail: 0xa4b6b3 },
  'de-witte-hinde':    { wall: 0xc7bd9f, roof: 0x686766, frame: 0xe1ddd0, edge: 0xb9b5a3, rail: 0x94afaf },
};

function facadeBox(batch, wall, u, y, offset, width, height, depth, color, slope = 0) {
  const [x, , z] = wall.point(u, y, offset);
  const heading = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateX(slope).rotateY(heading).translate(x, y, z), color);
}

function balcony(wall, u, v, y, depth, edge, rail) {
  const mid = (u + v) / 2;
  facadeBox(wall.trim, wall, mid, y, depth / 2, v - u, 0.21, depth, edge);
  surveyPanel(wall, u + 0.06, v - 0.06, y + 0.14, y + 0.91, rail, depth - 0.035, 0.24);
  facadeBox(wall.trim, wall, mid, y + 0.93, depth - 0.035, v - u, 0.07, 0.075, edge);
  for (const at of [u + 0.04, v - 0.04]) {
    facadeBox(wall.trim, wall, at, y + 0.51, depth / 2, 0.07, 0.78, depth, edge);
  }
}

function storefront(wall, theme, gelria) {
  const { width, base, low, normal } = wall;
  if (width < 3.2 || low > base + 0.25) return;
  const count = Math.max(1, Math.round(width / (gelria ? 4.6 : 3.1)));
  const span = width / count;
  for (let i = 0; i < count; i++) {
    const u = span * i + 0.20, v = span * (i + 1) - 0.20;
    surveyWindow(wall, u, v, base + 0.36, base + (gelria ? 4.28 : 3.12), {
      color: gelria && normal.z < -0.45 ? 0x577b82 : glass[i % glass.length],
      frame: theme.frame, columns: 2, rows: 2,
    });
  }
  if (gelria && normal.z < -0.45 && surveyOpeningFits(wall, 0.24, width - 0.24, base + 4.2, base + 4.6)) {
    surveyPanel({ ...wall, trim: wall.shell }, 0.24, width - 0.24, base + 4.22, base + 4.53, 0x4d7775);
  }
}

function dressFacade(wall, id, theme) {
  const { width, normal, base, low, high, buildingIndex, faceIndex } = wall;
  const griek = id === 'de-griek', gelria = id === 'de-halte-gelria';
  const kleef = id === 'kleefsehof', hinde = id === 'de-witte-hinde';
  const plasteredRecess = griek && (faceIndex === 13 || faceIndex === 29 || faceIndex === 25);
  const innerGallery = gelria && normal.z > 0.72 && high < base + 16;
  const tone = plasteredRecess ? 0xb88646 : innerGallery ? timber : theme.wall;
  if ((griek || gelria) && low < base + 0.3) storefront(wall, theme, gelria);
  if (width < 2 || high - low < 1.9) return tone;

  const primarySide = Math.abs(normal.x) > 0.72;
  const courtyardSide = kleef && (buildingIndex === 0 ? normal.z < -0.72 : buildingIndex === 1 ? normal.x < -0.72 : normal.x > 0.72);
  const bayCount = Math.max(1, Math.round(width / (griek ? 3.22 : gelria ? 4.0 : kleef ? 3.32 : 3.08)));
  const span = width / bayCount;
  const first = base + (gelria ? 4.72 : griek ? 3.34 : 0.28);
  const pitch = griek ? 2.94 : gelria ? 2.83 : kleef ? 2.78 : 2.85;
  for (let floor = 0; first + floor * pitch + 2.06 < high + 0.08; floor++) {
    const y = first + floor * pitch;
    if (y + 0.53 < low) continue;
    if ((hinde || innerGallery || kleef) && width > 5.5 && surveyOpeningFits(wall, 0.18, width - 0.18, y + 0.06, y + 0.37)) {
      surveyPanel({ ...wall, trim: wall.shell }, 0.20, width - 0.20, y + 0.07, y + 0.34, theme.edge, 0.042);
    }
    for (let i = 0; i < bayCount; i++) {
      const u = i * span + Math.max(0.19, span * (griek ? 0.16 : 0.10));
      const v = (i + 1) * span - Math.max(0.19, span * (griek ? 0.17 : 0.13));
      const projecting = !plasteredRecess && ((griek && width > 6 && (normal.x < -0.72 || normal.z > 0.82) && (floor + i) % 4 !== 0) ||
        (hinde && primarySide && floor > 0 && width > 3.8 && (floor + i + faceIndex) % 3 !== 0) ||
        (kleef && floor > 0 && courtyardSide && width > 5.2 && i % 2 === 0) ||
        (gelria && width > 5 && !innerGallery && (high > base + 18 ? i % 2 === 0 : normal.z < -0.72 && (i + floor) % 3 === 0)));
      const fits = surveyWindow(wall, u, v, y + (projecting ? 0.50 : 0.82), y + 2.10 + (projecting ? 0.07 : 0),
        { color: glass[(i + floor + faceIndex) % glass.length], frame: theme.frame, columns: span > 2.7 ? 2 : 1 });
      if (!fits) continue;
      if (projecting) {
        const depth = griek ? 0.96 : hinde ? 0.55 : kleef ? 0.71 : 0.45;
        balcony(wall, u - 0.10, v + 0.10, y + 0.32, depth, theme.edge, theme.rail);
        if ((hinde || kleef) && (i * 3 + floor + faceIndex) % 9 === 2) {
          facadeBox(wall.trim, wall, (u + v) / 2, y + 2.10, 0.37, v - u + 0.12, 0.045, 0.76,
            hinde ? 0x9ea258 : 0xa55d3b, 0.23);
        }
      }
    }
  }
  return tone;
}

function solarPanels({ trim }) {
  for (const z0 of [1903.2, 1916.6]) {
    for (let i = 0; i < 3; i++) {
      const z = z0 + i * 1.43;
      for (let j = 0; j < 4; j++) {
        const x = -46.92 + j * 2.85;
        trim.solid(new THREE.BoxGeometry(2.18, 0.12, 1.10).rotateX(0.17).rotateY(0.05)
          .translate(x, 18.27, z), 0x303f4b);
      }
    }
  }
}

function createCentreSkyline(site) {
  const theme = palettes[site.id];
  const shells = CENTRE_SKYLINE_SHELLS[site.id].map(part => ({ ...part, wallColor: theme.wall, roofColor: theme.roof }));
  const model = createSurveyLandmark(site, shells, wall => dressFacade(wall, site.id, theme),
    site.id === 'de-witte-hinde' ? solarPanels : undefined);
  for (const detail of model.children) {
    if (detail.userData.nearDetail) detail.userData.nearDetail = 205;
  }
  return model;
}

export const EDE_CENTRE_SKYLINE_LANDMARK_FACTORIES = Object.fromEntries(EDE_CENTRE_SKYLINE_LANDMARKS.map(({ id }) =>
  [id, (_footprints, site) => createCentreSkyline(site)]));
