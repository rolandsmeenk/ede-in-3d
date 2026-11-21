import * as THREE from 'three/webgpu';
import { CivicBatch, civicSigns, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { ZONNEOORD_SURVEYS } from './ede-zonneoord-surveys.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const ivory = 0xe4e2d4, sash = 0xd4d4c8, sill = 0xa39f8c, glazing = 0x45555c;
const charcoal = 0x363b38, cedar = 0x99734d, lead = 0x545759;
const frontage = { x: -1159.15, z: -2047.8, ground: -2.4, angle: 0.459 };
const directions = angle => {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return { ux: cosine, uz: -sine, nx: sine, nz: cosine };
};
const siteAxes = directions(frontage.angle);

function projected(point, angle, u, y, depth) {
  const { ux, uz, nx, nz } = angle;
  return [point.x + u * ux + depth * nx, y, point.z + u * uz + depth * nz];
}

function box(batch, x, y, z, width, height, depth, color, heading = frontage.angle) {
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(heading).translate(x, y, z), color);
}

function buildingWall(wall) {
  const { buildingIndex, base, width, low, high, a, b, normal, trim } = wall;
  if (width < 1.3 || high - low < 1) return;
  if (buildingIndex) {
    if (width < 6) return charcoal;
    const count = Math.round(width / 1.58), bay = width / count;
    const height = high - base;
    const levels = height > 10 ? 3 : 2;
    for (let row = 0; row < levels; row++) {
      const floor = base + height * row / levels;
      const lo = Math.max(base + 1.0, floor + 0.48);
      const hi = floor + height / levels - 0.25;
      for (let i = 0; i < count; i++) {
        const u = i * bay;
        if (surveyWindow(wall, u + 0.11, u + bay - 0.11, lo, hi, {
          color: [0x485c60, 0x385154, 0x4c6163][(i + row) % 3], frame: charcoal, columns: 2, rows: 2,
        }) && normal.z < 0.8 && (i + row) % 3 !== 1) {
          for (const offset of [0.29, 0.73]) {
            const [x, y, z] = wall.point(u + bay * offset, (lo + hi) / 2, 0.14);
            box(trim, x, y, z, 0.065, hi - lo, 0.19, cedar, Math.atan2(normal.x, normal.z));
          }
        }
      }
      surveyPanel(wall, 0.04, width - 0.04, floor + 0.03, floor + 0.27, charcoal);
    }
    return 0x6b6254;
  }

  const front = normal.z > 0.83;
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const entrance = front && Math.hypot(mx + 1158.3, mz + 2046.6) < 3.8 && high < 3;
  if (entrance) {
    surveyWindow(wall, 0.20, width - 0.20, -2.13, 0.51, {
      color: 0x435351, frame: 0xaaa068, columns: 3, rows: 2,
    });
    return ivory;
  }

  const floors = low > 4.75 ? [[5.72, 6.95]] : [[-1.46, -0.02], [2.10, 3.61]];
  const bays = Math.max(1, Math.round(width / (front ? 2.15 : 2.85)));
  for (const [bottom, top] of floors) {
    const screen = front ? sash : 0xb7b7aa;
    for (let i = 0; i < bays; i++) {
      const u = width * (i + 0.5) / bays;
      const half = Math.min(0.93, width * 0.43 / bays);
      if (surveyWindow(wall, u - half, u + half, bottom, top, { color: glazing, frame: screen, columns: 2 })) {
        surveyPanel(wall, u - half - 0.06, u + half + 0.06, bottom - 0.07, bottom + 0.016, sill, 0.059);
      }
    }
    if (width > 3 && surveyOpeningFits(wall, 0.1, width - 0.1, bottom - 0.21, bottom - 0.16)) {
      surveyPanel(wall, 0.1, width - 0.1, bottom - 0.21, bottom - 0.16, 0xbdb8a8, 0.03);
    }
  }
  return ivory;
}

function solarArray(batch, part) {
  const hull = part.outline[0];
  const roof = Math.max(...part.points.map(p => p[1]));
  const u = hull.map(([x, z]) => x * siteAxes.ux + z * siteAxes.uz);
  const v = hull.map(([x, z]) => x * siteAxes.nx + z * siteAxes.nz);
  const centerU = (Math.min(...u) + Math.max(...u)) / 2;
  const centerV = (Math.min(...v) + Math.max(...v)) / 2;
  const panel = (u, v, w, d, color, lift = 0.115) => {
    const point = (x, z) => projected({ x: 0, z: 0 }, siteAxes, centerU + x, roof + lift, centerV + z);
    batch.quad(point(u, v), point(u, v + d), point(u + w, v + d), point(u + w, v), color, 0.4);
  };
  panel(-6, -5.7, 12, 11.4, 0x747d7c, 0.095);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 9; i++) {
      const tint = [0x435566, 0x34485e, 0x4c5f70][(i + j * 2) % 3];
      panel(-5.92 + i * 1.32, -5.63 + j * 1.41, 1.27, 1.36, tint);
    }
  }
}

function finishEstate({ trim, labels, colliders }) {
  const point = (u, y, depth) => projected(frontage, siteAxes, u, y, depth);
  const shades = [0xdd4d26, 0xeb7624, 0xe99426, 0xe9ba32, 0xe2cf45, 0xaac75e, 0x8bb955];
  const depth = 3.9 / shades.length;
  const elevation = v => 2.15 + v * 0.19;
  for (let i = 0; i < shades.length; i++) {
    const near = i * depth, far = (i + 1) * depth;
    const a = point(-2.55, elevation(near), near);
    const b = point(-2.55, elevation(far), far);
    const c = point(2.55, elevation(far), far);
    const d = point(2.55, elevation(near), near);
    trim.quad(a, b, c, d, shades[i], 0.75);
    trim.quad(d, c, b, a, shades[i], 0.75);
    box(trim, ...point(0, elevation(far), far), 5.15, 0.045, 0.045, lead);
  }
  for (const u of [-2.48, 2.48]) {
    const [x, , z] = point(u, 0, 3.8);
    const ground = getTerrain() ? terrainHeightAt(x, z) : frontage.ground;
    const roof = elevation(3.8);
    box(trim, x, (ground + roof) / 2, z, 0.105, roof - ground, 0.105, lead);
    colliders.push(...wallColliders({ x, z: z - 0.05 }, { x, z: z + 0.05 }, ground, roof, 0.105));
  }
  const brace = (a, b) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    trim.solid(new THREE.BoxGeometry(0.058, delta.length(), 0.064)
      .applyQuaternion(rotation).translate(...start.lerp(end, 0.5)), lead);
  };
  for (const u of [-2.53, 0, 2.53]) {
    brace(point(u, elevation(0), 0), point(u, elevation(3.9), 3.9));
  }
  surveyLabel({ labels, point: (u, y) => point(u, y, 0.12) }, -2.37, 2.37, 2.34, 2.75,
    'GROOT – ZONNEOORD', '#dddcd0', '#514a35');
  for (const part of ZONNEOORD_SURVEYS.slice(1)) solarArray(trim, part);
}

function createHilgersMonument(_, site) {
  const base = getTerrain() ? terrainHeightAt(site.x, site.z) : 15.1;
  const angle = Math.atan2(site.approach.x - site.x, site.approach.z - site.z);
  const axes = directions(angle);
  const point = (u, y, depth = 0) => projected(site, axes, u, base + y, depth);
  const batch = new CivicBatch();
  const concrete = 0xb3b2a0;
  box(batch, ...point(0, 0.08, 0.13), 1.07, 0.28, 0.76, concrete, angle);
  box(batch, ...point(0, -0.025, 0.18), 1.20, 0.10, 0.88, 0x888d7f, angle);
  const section = new THREE.Shape();
  section.moveTo(-0.26, 0.16);
  section.lineTo(-0.215, 1.9);
  section.quadraticCurveTo(-0.21, 2.2, -0.06, 2.22);
  section.quadraticCurveTo(0.085, 2.24, 0.123, 1.99);
  section.lineTo(0.21, 0.16);
  section.closePath();
  batch.solid(new THREE.ExtrudeGeometry(section, {
    depth: 0.19, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 1, curveSegments: 6,
  }).translate(0, 0, -0.1).rotateY(angle).translate(site.x, base, site.z), concrete);
  const slate = 0x373e43;
  batch.quad(point(-0.48, 0.046, 0.615), point(0.48, 0.046, 0.615),
    point(0.48, 0.264, 0.46), point(-0.48, 0.264, 0.46), slate);
  const [ax, , az] = point(-0.535, 0, 0.17), [bx, , bz] = point(0.535, 0, 0.17);
  const [lx, , lz] = point(-0.23, 0), [rx, , rz] = point(0.17, 0);
  const group = makeGroup(site.name, batch, [
    ...wallColliders({ x: ax, z: az }, { x: bx, z: bz }, base - 0.10, base + 0.28, 0.80),
    ...wallColliders({ x: lx, z: lz }, { x: rx, z: rz }, base + 0.19, base + 2.21, 0.22),
  ]);
  const plate = position => {
    const [x, , z] = point(position, 0, 0.623);
    return { x, z };
  };
  const texts = ['J.W.E.L. HILGERS · 29 JULI 1910', 'EERSTE MOTORVLUCHT VAN EEN', 'NEDERLANDER BOVEN NEDERLAND'];
  const labels = texts.map((text, i) => ({
    text, a: plate(0.47), b: plate(-0.47), lo: base + 0.065 + i * 0.058, hi: base + 0.123 + i * 0.058,
    color: '#373e43', textColor: '#ded5be',
  }));
  const sign = civicSigns(labels, { wide: true });
  if (sign) {
    const vertices = sign.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const offset = (vertices.getY(i) - base - 0.046) * 0.155 / 0.218;
      vertices.setX(i, vertices.getX(i) - axes.nx * offset);
      vertices.setZ(i, vertices.getZ(i) - axes.nz * offset);
    }
    sign.geometry.computeVertexNormals();
    sign.userData.nearDetail = 30;
    group.add(sign);
  }
  return group;
}

export const ZONNEOORD_LANDMARK_FACTORIES = {
  'groot-zonneoord': (_, site) => createSurveyLandmark(site, ZONNEOORD_SURVEYS, buildingWall, finishEstate),
  'jan-hilgers-monument': createHilgersMonument,
};
