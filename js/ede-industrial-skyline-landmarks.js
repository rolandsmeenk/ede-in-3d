import * as THREE from 'three/webgpu';
import { INDUSTRIAL_SKYLINE_SHELLS, NIZO_NORTH_SITE } from './ede-industrial-skyline-survey.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';

const glazing = [0x43555b, 0x4d6469, 0x3a5059, 0x566970];
const paleConcrete = 0xbfc0b9;

function facadeBox(batch, wall, u, y, offset, width, height, depth, color) {
  const [x, , z] = wall.point(u, y, offset);
  const angle = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(angle).translate(x, y, z), color);
}

function plinth(wall, top, color) {
  if (wall.high < top + 0.16) return color;
  if (wall.low < top) {
    const lo = wall.low + 0.025;
    if (surveyOpeningFits(wall, 0.08, wall.width - 0.08, lo, top))
      surveyPanel({ ...wall, trim: wall.shell }, 0.015, wall.width - 0.015, lo, top, color, 0.026);
  }
}

function nizoFacade(wall) {
  const { width, low, high, base, normal, a, b } = wall;
  const eastTower = Math.min(a.x, b.x) > -485 && high > base + 17;
  const body = eastTower ? 0xb8b9b2 : high < base + 5 ? 0x9b8b78 : 0xa7a79f;
  if (width < 4 || high - low < 1.4) return body;
  const skirting = plinth(wall, base + 1.1, 0x87847c);
  if (skirting !== undefined) return skirting;
  const y = eastTower ? base + 4.65 : base + 3.0;
  const rows = eastTower ? 2 : 1;
  const bays = Math.max(1, Math.floor(width / 3.2));
  const span = width / bays;
  for (let floor = 0; floor < rows; floor++) {
    const bottom = y + floor * 6.7;
    for (let bay = 0; bay < bays; bay++) {
      const u = span * bay;
      if (eastTower && (bay % 3 !== 1 || normal.z < -0.5)) continue;
      surveyWindow(wall, u + span * 0.18, u + span * 0.80, bottom, bottom + (eastTower ? 1.4 : 1.02),
        { color: glazing[bay % glazing.length], frame: 0x848a85, columns: 2 });
    }
  }
  return body;
}

function petiFacade(wall) {
  const { width, low, high, base, a, b, normal } = wall;
  const office = Math.max(a.x, b.x) < -6121 && Math.min(a.z, b.z) > 385;
  if (office && high - low > 3.0) {
    if (width > 14 && normal.x < -0.6) {
      const lo = base + 0.72, hi = high - 2.22;
      surveyWindow(wall, 1.3, width - 1.3, lo, hi,
        { color: 0x35464a, frame: 0x282e2e, columns: Math.round(width / 2.35), rows: 3 });
      if (surveyOpeningFits(wall, 1.3, width - 1.3, hi - 0.05, hi + 0.30)) {
        facadeBox(wall.shell, wall, width / 2, hi + 0.25, 0.72, width - 2, 0.15, 1.42, 0x373b3a);
        for (let at = 2; at < width - 1.5; at += 2)
          facadeBox(wall.trim, wall, at, hi + 0.11, 0.73, 0.08, 0.20, 1.48, 0x464948);
      }
    }
    if (width > 6 && width < 14 && high > base + 8)
      surveyWindow(wall, 1.4, width - 1.0, Math.max(low + 0.26, base + 2.2), high - 3.0,
        { color: glazing[0], frame: 0x343332, columns: 3, rows: 2 });
    return 0x805f48;
  }

  const cladding = high > base + 19 ? 0x676b69 : 0x5b605e;
  if (width < 1.5 || high - low < 1) return cladding;
  const skirting = plinth(wall, base + 4.15, 0xb0b0a7);
  if (skirting !== undefined) return skirting;
  if (high > base + 23 && low < high - 4 && width > 10 && Math.abs(normal.z) > 0.8) {
    if (surveyOpeningFits(wall, 0.70, width - 0.70, high - 4.1, high - 1.65))
      surveyLabel(wall, 0.70, width - 0.70, high - 4.1, high - 1.65, 'Peti protein', '#777b77', '#252824');
  }
  if (width > 16 && low < base + 0.1 && high < base + 16 && (normal.z > 0.4 || normal.x > 0.6)) {
    const center = width * 0.60;
    surveyWindow(wall, center - 1.7, center + 1.7, base + 0.3, base + 3.9,
      { color: 0x555955, frame: 0x494c48, rows: 4 });
  }
  return cladding;
}

function formerOfficesFacade(wall) {
  const { width, base, high, low, buildingIndex } = wall;
  const shortBlock = buildingIndex === 1;
  const body = shortBlock ? 0xb8a291 : 0x987567;
  const frame = shortBlock ? 0x7c473d : 0xb8b4ad;
  if (width < 5 || high - low < 1.45) return body;
  if (!shortBlock && low > base + 11) {
    const u = width * 0.02, lo = low + 0.46, hi = Math.min(high - 0.48, low + 2.22);
    surveyWindow(wall, u, width - u, lo, hi,
      { color: glazing[1], frame: 0xbfc1bf, columns: Math.ceil(width / 2.4) });
    return 0xc8c9c0;
  }

  const bays = Math.max(1, Math.round(width / (shortBlock ? 4.8 : 4.35)));
  const span = width / bays;
  for (let floor = 0; floor < 4; floor++) {
    const sill = base + 0.58 + floor * 3.23;
    for (let bay = 0; bay < bays; bay++) {
      const u = bay * span, balcony = floor > 0 && bay % 3 === (shortBlock ? 1 : 2);
      const left = u + span * 0.18, right = u + span * (balcony ? 0.86 : 0.65);
      const lo = sill + (balcony ? 0.13 : 0.48);
      if (!surveyWindow(wall, left, right, lo, sill + 2.38,
          { color: glazing[(bay + floor) % glazing.length], frame, columns: 2, rows: 2 })) continue;
      if (balcony) {
        facadeBox(wall.shell, wall, (left + right) / 2, sill, 0.66, right - left + 0.24, 0.20, 1.28, paleConcrete);
        surveyPanel(wall, left - 0.08, right + 0.08, sill + 0.12, sill + 0.92, 0x778d8b, 1.30, 0.31);
        surveyPanel(wall, left - 0.08, right + 0.08, sill + 0.92, sill + 0.99, 0x4b5755, 1.32);
      }
    }
    if (surveyOpeningFits(wall, 0.10, width - 0.10, sill - 0.45, sill - 0.28))
      surveyPanel(wall, 0.08, width - 0.08, sill - 0.45, sill - 0.28, shortBlock ? 0xaa9488 : 0x85675d);
  }
  if (shortBlock) {
    const lo = high - 1.92, hi = high - 0.45;
    surveyWindow(wall, 0.15, width - 0.15, lo, hi,
      { color: glazing[3], frame, columns: Math.max(1, Math.round(width / 1.2)) });
    if (surveyOpeningFits(wall, 0.07, width - 0.07, hi, high - 0.06))
      facadeBox(wall.shell, wall, width / 2, high - 0.23, 0.10, width + 0.07, 0.46, 0.27, 0x724f43);
  }
  return body;
}

function parkTowerFacade(wall) {
  const { width, base, low, normal } = wall;
  const penthouse = low > base + 26;
  const pitch = 2.94, first = base + 0.33;
  const bays = Math.round(width / (penthouse ? 3.85 : 3.30));
  const span = width / bays;
  const parkSide = normal.z > 0.4;
  const frame = 0x313b39;
  const brick = parkSide ? 0xa2876d : 0xb29a80;
  for (let floor = penthouse ? 9 : parkSide ? 0 : 1; floor < (penthouse ? 10 : 9); floor++) {
    const y = penthouse ? low + 0.10 : first + floor * pitch;
    if (floor % 2 === 1 || penthouse)
      facadeBox(wall.shell, wall, width / 2, y, 0.075, width + 0.16, 0.30, 0.28, paleConcrete);
    for (let bay = 0; bay < bays; bay++) {
      const u = bay * span;
      const corner = !penthouse && (bay === 0 || bay === bays - 1) && floor > 0;
      const narrow = bay % 3 === 1;
      const left = u + span * (corner ? 0.06 : 0.19);
      const right = u + span * (corner ? 0.94 : narrow ? 0.54 : 0.81);
      if (!surveyWindow(wall, left, right, y + 0.33, y + 2.47,
          { color: glazing[(bay + floor) % glazing.length], frame, columns: narrow ? 1 : 2, rows: 2 })) continue;
      if (narrow)
        surveyPanel(wall, u + span * 0.55, u + span * 0.79, y + 0.34, y + 2.46, 0x9a7255);
      if (corner) {
        facadeBox(wall.shell, wall, (left + right) / 2, y + 0.10, 0.47, right - left + 0.16, 0.27, 0.96, paleConcrete);
        surveyPanel(wall, left, right, y + 0.25, y + 1.02, 0x729195, 0.94, 0.52);
        surveyPanel(wall, left, right, y + 1.01, y + 1.08, frame, 0.96);
      }
    }
  }
  return brick;
}

function parkTowerTerraces(building, shell) {
  const ring = building.outline[0];
  const roof = building.ground + 27.1;
  for (const i of [0, 2]) {
    const [x, z] = ring[i], [endX, endZ] = ring[(i + 1) % ring.length];
    const width = Math.hypot(endX - x, endZ - z);
    const angle = -Math.atan2(endZ - z, endX - x);
    shell.solid(new THREE.BoxGeometry(width, 0.26, 0.25).rotateY(angle)
      .translate((x + endX) / 2, roof - 0.10, (z + endZ) / 2), paleConcrete);
    for (let post = 0; post <= 9; post++) {
      const t = post / 9;
      shell.solid(new THREE.BoxGeometry(0.065, 0.88, 0.065)
        .translate(x + (endX - x) * t, roof + 0.44, z + (endZ - z) * t), 0x444d49);
    }
    shell.solid(new THREE.BoxGeometry(width, 0.075, 0.078).rotateY(angle)
      .translate((x + endX) / 2, roof + 0.85, (z + endZ) / 2), 0x444d49);
  }
}

function createLandmark(site, decorate, roofColor, finish) {
  const buildings = INDUSTRIAL_SKYLINE_SHELLS[site.id].map(building => ({ ...building, wallColor: 0xa6a397, roofColor }));
  const model = createSurveyLandmark(site, buildings, decorate, finish);
  for (const child of model.children) {
    if (child.userData.nearDetail) child.userData.nearDetail = 235;
  }
  return model;
}

export function createNizoNorthLandmark() {
  return createLandmark(NIZO_NORTH_SITE, nizoFacade, 0x606661);
}

export const EDE_INDUSTRIAL_SKYLINE_LANDMARK_FACTORIES = {
  'peti-protein': (_, site) => createLandmark(site, petiFacade, 0x8c8e89),
  'victoria-vesta': (_, site) => createLandmark(site, formerOfficesFacade, 0x646764),
  'victoria-veste': (_, site) => createLandmark(site, parkTowerFacade, 0x636765, ({ trim }) => {
    parkTowerTerraces(INDUSTRIAL_SKYLINE_SHELLS[site.id][0], trim);
  }),
};
