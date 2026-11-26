import * as THREE from 'three/webgpu';
import { CivicBatch, facePanel } from './ede-civic-landmarks.js';
import { RURAL_LANDMARK_SURVEYS } from './ede-rural-landmark-survey.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { addWindmillSailcloth, createWindmillRig } from './ede-windmill.js';

const cream = 0xd8d0b7;
const green = 0x314437;

function shutteredWindow(wall, center, width, bottom, top, shutter = green) {
  const lo = center - width / 2, hi = center + width / 2;
  if (!surveyWindow(wall, lo, hi, bottom, top, { frame: cream, columns: 2, rows: 3 })) return;
  surveyPanel(wall, lo - width * 0.42, lo - 0.035, bottom, top, shutter, 0.048);
  surveyPanel(wall, hi + 0.035, hi + width * 0.42, bottom, top, shutter, 0.048);
}

function gatehouseWall(wall) {
  const { base, high, low, width, normal, point, trim } = wall;
  if (low > base + 0.1 || width < 3) return;
  surveyPanel(wall, 0.03, width - 0.03, base + 0.04, base + 0.60, 0x98907d);
  const eave = high - 0.26;
  surveyPanel(wall, 0.03, width - 0.03, eave, eave + 0.10, 0x493631, 0.065);
  for (let u = 0.13; u < width - 0.15; u += 0.27) {
    surveyPanel(wall, u, u + 0.13, eave - 0.085, eave, 0x4e352f, 0.085);
  }

  if (normal.x < -0.9 && width > 12) {
    // The old passage survives as a blind arch in the roadside brickwork.
    const center = width * 0.53, spring = base + 2.3, radius = 1.46;
    surveyPanel(wall, center - radius, center + radius, base + 0.6, spring, 0x865b48, 0.043);
    const arc = (angle, r, offset) => point(center + r * Math.cos(angle), spring + r * Math.sin(angle), offset);
    const infill = Array.from({ length: 17 }, (_, i) => arc(i * Math.PI / 16, radius, 0.043));
    trim.polygon([infill], 0x865b48);
    for (let i = 0; i < 12; i++) {
      const a = (i + 0.06) * Math.PI / 12, b = (i + 0.94) * Math.PI / 12;
      trim.quad(arc(a, radius, 0.071), arc(a, radius + 0.19, 0.071),
        arc(b, radius + 0.19, 0.071), arc(b, radius, 0.071), i % 2 ? 0xbaa78b : 0xaa9479);
    }
    for (const side of [-1, 1]) {
      const inner = center + side * radius, outer = inner + side * 0.19;
      for (let y = base + 0.63; y < spring; y += 0.30) {
        surveyPanel(wall, Math.min(inner, outer), Math.max(inner, outer), y, Math.min(y + 0.26, spring), 0xaa9479, 0.071);
      }
    }
    shutteredWindow(wall, center, 0.95, base + 1.45, base + 2.92);
    shutteredWindow(wall, width * 0.18, 0.84, base + 1.58, base + 2.81);
  } else if (width < 7) {
    shutteredWindow(wall, width * 0.48, 0.96, base + 1.55, base + 2.88);
  } else {
    for (const fraction of [0.25, 0.68, 0.85]) {
      shutteredWindow(wall, width * fraction, 0.90, base + 1.37, base + 2.60);
    }
  }
}

function schoolWall(wall) {
  const { base, high, low, width, faceIndex, normal } = wall;
  const frame = 0x414a50;
  if (width < 1.25) return;
  const upperOnly = low > base + 3.7;
  const lowWindow = upperOnly ? low + 0.15 : base + (normal.z > 0.8 ? 0.52 : 0.36);
  const highWindow = upperOnly ? Math.min(low + 1.43, high - 0.2) : base + 2.94;
  const count = Math.max(1, Math.round(width / 3.25));
  const bay = width / count;
  for (let i = 0; i < count; i++) {
    const u = (i + 0.16) * bay, v = (i + 0.82) * bay;
    const entrance = faceIndex === 1 && i === 1;
    surveyWindow(wall, u, v, entrance ? base + 0.06 : lowWindow, highWindow, {
      frame, columns: entrance || normal.z < -0.6 ? 3 : 2,
      color: i % 4 === 1 ? 0x53626a : 0x394c55,
    });
    if (faceIndex === 1 && !entrance) {
      surveyWindow(wall, u, v, base + 5.58, base + 7.11, { frame, columns: 2, color: 0x677175 });
    }
    if (entrance && surveyOpeningFits(wall, u, v, base + 3.2, base + 3.86)) {
      surveyLabel(wall, u, v, base + 3.2, base + 3.86, 'Ruitenbeekschool', '#303c44', '#b3d6ee');
    }
  }

  const strip = base + (normal.z < -0.5 ? 5.18 : 4.87);
  if (!upperOnly && surveyOpeningFits(wall, 0.12, width - 0.12, strip, strip + 0.31)) {
    surveyPanel(wall, 0.10, width - 0.10, strip, strip + 0.31, 0x29383f, 0.060);
  }
  if (upperOnly && normal.z < -0.6) return 0x3a454a;
}

function altenaWall(wall) {
  const { base, high, low, width, buildingIndex, normal } = wall;
  if (low > base + 0.12 || width < 1.7) return;
  const farmhouse = buildingIndex === 0;
  const frontGable = farmhouse && normal.z < -0.8;
  const woodGable = farmhouse && normal.z > 0.8;
  if (farmhouse) {
    surveyPanel(wall, 0.10, width - 0.10, base + 0.04, base + 0.44, 0x807d73);
  }
  if (woodGable || buildingIndex > 0) {
    const middle = width * 0.5, half = Math.min(width * 0.36, 1.30);
    const top = Math.min(base + 2.45, high - 0.20);
    if (surveyOpeningFits(wall, middle - half, middle + half, base + 0.08, top)) {
      surveyPanel(wall, middle - half, middle + half, base + 0.08, top, 0x3e3a30);
      for (let u = middle - half + 0.10; u < middle + half - 0.03; u += 0.16) {
        surveyPanel(wall, u, u + 0.018, base + 0.10, top, 0x292a25, 0.043);
      }
    }
    if (!farmhouse && width > 5) {
      surveyWindow(wall, width * 0.81, width * 0.91, base + 0.80, base + 1.42,
        { frame: 0x292a26, columns: 2 });
    }
    if (woodGable) return 0x4f4538;
    return;
  }
  if (frontGable) {
    for (const fraction of [0.23, 0.50, 0.77]) {
      shutteredWindow(wall, width * fraction, Math.min(width * 0.14, 1.04), base + 0.96, base + 2.40);
    }
    surveyWindow(wall, width * 0.45, width * 0.55, base + 2.84, base + 3.72, { frame: cream });
  } else {
    for (const fraction of [0.23, 0.55, 0.82]) {
      shutteredWindow(wall, width * fraction, 0.80, base + 0.62, base + 1.63);
    }
  }
}

function beam(batch, a, b, width, height, color) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.clone().normalize());
  batch.solid(new THREE.BoxGeometry(direction.length(), height, width)
    .applyQuaternion(rotation).translate(...start.lerp(end, 0.5)), color);
}

function walderveenseMolen([footprint], site) {
  const group = new THREE.Group();
  const tower = new CivicBatch(), gallery = new CivicBatch(), hood = new CivicBatch(), lattice = new CivicBatch();
  const stage = 5.4, bodyTop = site.height - 3.25;
  const ring = footprint.outer.map(p => [p.x - site.x, p.z - site.z]);
  const corner = (index, y, scale) => [ring[index][0] * scale, y, ring[index][1] * scale];
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const lowA = corner(i, -0.42, 1), lowB = corner(j, -0.42, 1);
    const stageA = corner(i, stage, 0.97), stageB = corner(j, stage, 0.97);
    tower.quad(lowA, lowB, stageB, stageA, i % 2 ? 0x7b5140 : 0x734b3c);
    tower.quad(stageA, stageB, corner(j, bodyTop, 0.57), corner(i, bodyTop, 0.57),
      i % 2 ? 0x71624a : 0x6e5e46);
    tower.quad(stageA, corner(i, stage, 1.41), corner(j, stage, 1.41), stageB, 0x675744);

    const a = { x: lowA[0], z: lowA[2] }, b = { x: lowB[0], z: lowB[2] };
    const normal = { x: a.z - b.z, z: b.x - a.x };
    const length = Math.hypot(normal.x, normal.z);
    normal.x /= length;
    normal.z /= length;
    if (normal.x > 0.95) {
      facePanel(tower, a, b, normal, 0.30, 0.70, 0.12, 2.48, 0xbdb29a, 0.045);
      facePanel(tower, a, b, normal, 0.34, 0.66, 0.12, 2.36, green, 0.060);
    } else if (normal.x > 0.72) {
      facePanel(tower, a, b, normal, 0.38, 0.62, 1.48, 2.53, cream, 0.045);
      facePanel(tower, a, b, normal, 0.42, 0.58, 1.55, 2.47, 0x384746, 0.060);
    }
    beam(gallery, corner(i, stage - 1.8, 0.98), corner(i, stage - 0.08, 1.40), 0.15, 0.15, 0x4f4735);
    beam(gallery, corner(i, stage - 0.04, 1.40), corner(i, stage + 1.02, 1.40), 0.095, 0.095, cream);
    for (const h of [0.29, 0.60, 0.96]) {
      beam(gallery, corner(i, stage + h, 1.40), corner(j, stage + h, 1.40), 0.085, 0.075, cream);
    }
  }
  group.add(tower.mesh(), gallery.mesh());

  const { cap, sails } = createWindmillRig(group, 17.15, 4.07, 0.17);
  cap.rotation.y = Math.PI * 0.42;
  sails.rotation.z = 0.40;
  hood.solid(new THREE.SphereGeometry(1, 20, 7, 0, 2 * Math.PI, 0, Math.PI / 2)
    .scale(2.74, 3.25, 3.32).translate(0, bodyTop, 0), 0x6d5e45);
  hood.solid(new THREE.CylinderGeometry(1, 1, 0.22, 20)
    .scale(2.74, 1, 3.32).translate(0, bodyTop + 0.02, 0), 0x4a4134);
  hood.solid(new THREE.BoxGeometry(1.94, 1.08, 0.30).translate(0, 16.56, 3.31), green);
  hood.solid(new THREE.BoxGeometry(1.64, 0.13, 0.10).translate(0, 16.51, 3.48), cream);
  hood.solid(new THREE.BoxGeometry(0.38, 0.38, 0.62).translate(0, 17.15, 3.84), 0x754c38);
  beam(hood, [-2.84, 16.4, -2.01], [2.84, 16.4, -2.01], 0.17, 0.17, 0x635847);
  beam(hood, [0, 16.4, -2.01], [0, stage + 0.22, -5.78], 0.22, 0.24, 0x67594a);
  for (const side of [-1, 1]) {
    beam(hood, [side * 2.68, 16.4, -2.01], [0, stage + 1.1, -5.42], 0.11, 0.13, 0x736554);
  }
  cap.add(hood.mesh());

  const radius = 11.1;
  for (let arm = 0; arm < 4; arm++) {
    const angle = arm * Math.PI / 2;
    const strut = (u, r, width, height, depth, color) => {
      const x = u * Math.cos(angle) - r * Math.sin(angle);
      const y = u * Math.sin(angle) + r * Math.cos(angle);
      lattice.solid(new THREE.BoxGeometry(width, height, depth).rotateZ(angle).translate(x, y, 0), color);
    };
    strut(0, radius / 2, 0.16, radius, 0.17, 0x594a3b);
    strut(-1.22, 6.48, 0.10, 9.20, 0.075, 0xd9d2b9);
    for (let r = 1.9; r < radius; r += 0.48) {
      strut(-0.60, r, 1.24, 0.050, 0.060, 0x958671);
    }
  }
  sails.add(lattice.mesh());
  addWindmillSailcloth(sails, { angle: Math.PI / 2, radii: [radius], root: 1.9, innerWidth: 1.27, outerWidth: 1.27 });
  return group;
}

export const RURAL_LANDMARK_FACTORIES = {
  'harselo-gatehouse': (_, site) => createSurveyLandmark(site, RURAL_LANDMARK_SURVEYS[site.id], gatehouseWall),
  ruitenbeekschool: (_, site) => createSurveyLandmark(site, RURAL_LANDMARK_SURVEYS[site.id], schoolWall),
  'klein-altena': (_, site) => createSurveyLandmark(site, RURAL_LANDMARK_SURVEYS[site.id], altenaWall),
  'walderveense-molen': walderveenseMolen,
};
