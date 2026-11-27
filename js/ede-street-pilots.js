import * as THREE from 'three/webgpu';
import { CivicBatch, civicSigns, facePanel, polygonNormal, roofSlice } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyWindow } from './ede-survey-landmark.js';
import { terrainHeightAt } from './terrain.js';
import { DORPSSTRAAT_BUILDINGS } from './ede-dorpsstraat-survey.js';
import { GROTESTRAAT_SHOPS } from './ede-grotestraat-sites.js';

const goodsColors = [0xa75042, 0xd7ae56, 0x558580, 0x65718b, 0xd6c1a1, 0x794969];
const storefrontGlass = 0x879a9d;
// The offline footprint renderer places the face of its 0.44 m wall box outside the survey plane.
const storefrontMount = 0.185;

export function buildGrotestraatShopfronts(heightAt = terrainHeightAt) {
  const group = new THREE.Group();
  group.name = 'Grotestraat · Shopfronts';
  const detail = new CivicBatch(), glass = new CivicBatch(), labels = [];
  for (const [index, shop] of GROTESTRAAT_SHOPS.entries()) {
    const [ax, az] = shop.a, [bx, bz] = shop.b;
    const span = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / span, uz = (bz - az) / span;
    const normal = { x: -uz, z: ux };
    const from = { x: ax, z: az }, to = { x: bx, z: bz };
    const yaw = Math.atan2(-uz, ux);
    const base = heightAt((ax + bx) / 2 + normal.x * 0.35, (az + bz) / 2 + normal.z * 0.35) + 0.045;
    const point = (u, y, depth) => [ax + ux * u + normal.x * (depth + storefrontMount),
      base + y, az + uz * u + normal.z * (depth + storefrontMount)];
    const edge = (u, depth) => {
      const [x, , z] = point(u, 0, depth);
      return { x, z };
    };
    const box = (u, y, depth, w, h, d, color) => detail.solid(new THREE.BoxGeometry(w, h, d)
      .rotateY(yaw).translate(...point(u, y, depth)), color);
    const panel = (batch, a, b, low, high, color, offset, sheen = 0) =>
      facePanel(batch, from, to, normal, a / span, b / span, base + low, base + high, color, offset + storefrontMount, sheen);
    const margin = 0.071;
    const lintel = shop.name === 'HEMA' ? 2.57 : 2.68;
    const frame = shop.frame ?? '#373839';
    const doorWidth = Math.min(span * 0.39, span > 7 ? 1.9 : 1.53);
    const cut = span * (shop.door ?? 0.5);
    const leftDoor = cut - doorWidth / 2, rightDoor = cut + doorWidth / 2;
    panel(detail, margin, span - margin, 0.01, lintel, 0x463e35, 0.071);
    box(span / 2, lintel + 0.269, 0.14 - storefrontMount / 2,
      span - 2 * margin, 0.54, 0.19 + storefrontMount, shop.fascia);
    box(span / 2, lintel + 0.013, 0.18, span - 2 * margin, 0.037, 0.245, frame);
    for (const u of [margin + 0.054, span - margin - 0.054]) {
      box(u, lintel / 2, 0.18 - storefrontMount / 2, 0.108, lintel, 0.25 + storefrontMount, shop.fascia);
    }
    const labelWidth = Math.min(span * 0.81, 1.10 + shop.name.length * 0.27);
    labels.push({ text: shop.name, textColor: shop.text, color: shop.fascia,
      a: edge((span + labelWidth) / 2, 0.237), b: edge((span - labelWidth) / 2, 0.237),
      lo: base + lintel + 0.11, hi: base + lintel + 0.46 });

    // Set the entrance glazing behind the shop windows and join it with real jambs.
    const outer = 0.319, doorGlass = 0.112;
    for (const u of [leftDoor, rightDoor]) box(u, lintel / 2, (outer + doorGlass) / 2, 0.064, lintel, outer - doorGlass, frame);
    box(cut, 0.033, (outer + doorGlass) / 2, doorWidth, 0.065, outer - doorGlass + 0.035, 0x6f685d);
    panel(detail, leftDoor + 0.035, rightDoor - 0.035, 0.067, lintel - 0.046, 0x565653, doorGlass, 0.7);
    box(cut, lintel / 2, doorGlass + 0.022, 0.048, lintel - 0.088, 0.035, frame);
    for (const side of [-1, 1]) box(cut + side * 0.115, 1.11, doorGlass + 0.05, 0.032, 0.28, 0.052, 0xb7b4a9);

    for (const [left, right] of [[margin + 0.1, leftDoor - 0.035], [rightDoor + 0.035, span - margin - 0.1]]) {
      const width = right - left;
      if (width < 0.25) continue;
      const centre = (left + right) / 2;
      box(centre, 0.161, 0.193, width, 0.29, 0.232, shop.fascia);
      box(centre, 0.332, 0.223, width, 0.073, 0.172, 0xb3a48d);
      panel(glass, left, right, 0.337, lintel - 0.024, storefrontGlass, outer, 1);
      const panes = Math.max(1, Math.round(width / 1.55));
      for (let i = 1; i < panes; i++) box(left + width * i / panes, (lintel + 0.337) / 2, outer,
        0.043, lintel - 0.337, 0.049, frame);
      const displays = Math.max(1, Math.floor(width / 0.61));
      const shelf = ['shelves', 'tech', 'toys', 'food', 'optics'].includes(shop.display);
      if (shelf) {
        for (const height of [0.68, 1.12, 1.56]) {
          box(centre, height - 0.022, 0.174, width * 0.83, 0.045, 0.147, 0xb5a288);
          for (let i = 0; i < displays; i++) {
            const u = left + width * (i + 0.5) / displays;
            const color = goodsColors[(i + index + Math.round(height * 4)) % goodsColors.length];
            const w = Math.min(0.23, width / displays * 0.72);
            if (shop.display === 'food') {
              detail.solid(new THREE.CylinderGeometry(w / 2, w / 2, 0.074, 8).translate(...point(u, height + 0.04, 0.19)), 0xe2ad54);
            } else box(u, height + 0.083, 0.191, w, 0.166, 0.096, color);
          }
        }
      } else {
        for (let i = 0; i < displays; i++) {
          const u = left + width * (i + 0.5) / displays;
          const w = Math.min(width / displays * 0.67, 0.24);
          const color = goodsColors[(i + index) % goodsColors.length];
          box(u, 0.45, 0.196, w * 1.2, 0.17, 0.155, 0xa1927b);
          box(u, 0.91, 0.174, w * 0.67, 0.77, 0.078, 0x37343a);
          detail.solid(new THREE.CylinderGeometry(w / 2, w * 0.34, 0.49, 6)
            .rotateY(yaw).translate(...point(u, 1.47, 0.196)), color);
          detail.solid(new THREE.SphereGeometry(w * 0.35, 6, 4)
            .scale(0.85, 1.25, 0.63).translate(...point(u, 1.82, 0.195)), 0xc2b29d);
        }
      }
      box(centre, lintel - 0.145, 0.202, width * 0.85, 0.043, 0.098, 0xe5cb96);
    }

    if (shop.awning) {
      const low = lintel - 0.02, high = lintel + 0.065, projection = shop.awning;
      const start = 0.13, end = span - 0.13;
      detail.quad(point(start, high, 0.21), point(start, low, projection),
        point(end, low, projection), point(end, high, 0.21), shop.fascia);
      detail.quad(point(start, low - 0.025, projection), point(start, high - 0.025, 0.21),
        point(end, high - 0.025, 0.21), point(end, low - 0.025, projection), 0x60584b);
      box(span / 2, low - 0.053, projection, end - start, 0.117, 0.058, shop.fascia);
    }
  }
  const fronts = detail.mesh();
  fronts.name = 'Shopfront trim, canopies and window displays';
  fronts.userData.nearDetail = 105;
  fronts.castShadow = false;
  const panes = glass.mesh();
  panes.name = 'Shopfront glass';
  panes.material.transparent = true;
  panes.material.opacity = 0.26;
  panes.material.depthWrite = false;
  panes.castShadow = false;
  panes.userData.nearDetail = 105;
  group.add(fronts, panes);
  const signs = civicSigns(labels, { wide: true });
  if (signs) {
    signs.name = 'Fitted shop signs';
    signs.userData.nearDetail = 135;
    group.add(signs);
  }
  group.userData.shopCount = labels.length;
  return group;
}

function beam(batch, a, b, width, color, rounded = false) {
  const direction = new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
  const length = direction.length();
  const shape = rounded ? new THREE.CylinderGeometry(width / 2, width / 2, length, 7)
    : new THREE.BoxGeometry(width, length, width);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.divideScalar(length));
  batch.solid(shape.applyQuaternion(rotation).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), color);
}

const roofPlane = (building, index) => building.faces[index][1].map(i => building.points[i]);

function planeHeight(ring) {
  const normal = polygonNormal(ring), [x0, y0, z0] = ring[0];
  return (x, z) => y0 - ((x - x0) * normal.x + (z - z0) * normal.z) / normal.y;
}

// PDOK 2026 imagery shows both module banks on the low terrace roof.
const solarBanks = [
  [[-3544.9, -4451.5], [-3538.35, -4454.74], [-3537.17, -4451.97], [-3543.72, -4448.73]],
  [[-3543.12, -4447.08], [-3536.55, -4450.28], [-3535.4, -4447.6], [-3541.97, -4444.4]],
];

function addSolarPanels(batch, ring) {
  const seat = planeHeight(ring);
  for (const [a, b, c, d] of solarBanks) {
    const panel = (u, v, offset = 0) => {
      const blend = i => THREE.MathUtils.lerp(THREE.MathUtils.lerp(a[i], b[i], u), THREE.MathUtils.lerp(d[i], c[i], u), v);
      const x = blend(0), z = blend(1);
      return [x, seat(x, z) + 0.08 + v * 0.22 + offset, z];
    };
    for (const u of [0.06, 0.48, 0.94]) beam(batch, panel(u, 0, -0.027), panel(u, 1, -0.027), 0.045, 0x656b6d);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) {
      const [left, right] = [(col + 0.025) / 6, (col + 0.975) / 6];
      const [bottom, top] = [(row + 0.025) / 2, (row + 0.975) / 2];
      batch.quad(panel(left, bottom), panel(left, top), panel(right, top), panel(right, bottom), 0x737c82);
      batch.quad(panel(left + 0.005, bottom + 0.008, 0.012), panel(left + 0.005, top - 0.008, 0.012),
        panel(right - 0.005, top - 0.008, 0.012), panel(right - 0.005, bottom + 0.008, 0.012), 0x2e455f, 0.8);
      beam(batch, panel(left + 0.003, (bottom + top) / 2, 0.014),
        panel(right - 0.003, (bottom + top) / 2, 0.014), 0.008, 0x748590);
    }
  }
}

function addChimney(batch, ring, x, z, yaw) {
  const y = planeHeight(ring)(x, z);
  for (const [h, w, d, bottom, color] of [
    [0.95, 0.55, 0.47, -0.37, 0x795244],
    [0.085, 0.65, 0.56, 0.56, 0x8b8074],
  ]) batch.solid(new THREE.BoxGeometry(w, h, d).rotateY(yaw).translate(x, y + bottom + h / 2, z), color);
  batch.solid(new THREE.CylinderGeometry(0.096, 0.115, 0.22, 7).translate(x, y + 0.73, z), 0x595252);
}

// Exposed street eaves picked from the survey, keeping gutters away from the party roofs.
const gutters = [
  [[-3553.78, -1.82, -4434.03], [-3550.37, -1.88, -4425.6]],
  [[-3548.78, -1.58, -4421.56], [-3544.95, -1.59, -4411.71]],
  [[-3536.93, -2.20, -4430.61], [-3539.08, -2.27, -4434.83]],
  [[-3534.09, -2.44, -4425.06], [-3536.93, -2.33, -4430.61]],
];

export function buildDorpsstraatRoofs() {
  const site = { name: 'Dorpsstraat · Roofscape' };
  const model = createSurveyLandmark(site, DORPSSTRAAT_BUILDINGS, wall => {
    if (wall.buildingIndex === 4 && wall.faceIndex === 26) {
      surveyWindow(wall, wall.width * 0.22, wall.width * 0.75, wall.high - 0.40, wall.high - 0.065,
        { frame: 0xada394, color: 0x4c5a60, columns: 2 });
    }
    if (wall.low > wall.base + 0.4 || wall.width < 3.1 || Math.abs(wall.normal.x) < 0.53) return;
    const [x, , z] = wall.point(wall.width / 2, wall.base);
    const toStreet = -3544 + (z + 4425) * 0.36 - x;
    if (Math.abs(toStreet) > 14 || toStreet * wall.normal.x <= 0.05) return;
    const bays = Math.max(1, Math.round(wall.width / 2.75));
    for (let i = 0; i < bays; i++) {
      const center = (i + 0.5) * wall.width / bays, radius = Math.min(wall.width / bays * 0.32, 0.90);
      surveyWindow(wall, center - radius, center + radius, wall.base + 0.76, wall.base + 2.29,
        { frame: 0x61574e, color: 0x495559, columns: 2 });
      surveyWindow(wall, center - radius * 0.71, center + radius * 0.71, wall.base + 3.47, wall.base + 4.75,
        { columns: 2 });
    }
  }, ({ trim, group }) => {
    for (const building of DORPSSTRAAT_BUILDINGS) {
      const tiles = new THREE.Color(building.roofColor).multiplyScalar(0.82);
      for (const [roof, face, ...holes] of building.faces) {
        if (!roof || holes.length) continue;
        const ring = face.map(i => building.points[i]);
        const normal = polygonNormal(ring);
        const low = Math.min(...ring.map(p => p[1])), high = Math.max(...ring.map(p => p[1]));
        if (normal.y < 0.43 || normal.y > 0.95 || high - low < 0.8) continue;
        // The variable rise keeps the tile spacing consistent on different pitches.
        const rise = 0.33 * Math.hypot(normal.x, normal.z);
        for (let h = low + rise; h < high - 0.015; h += rise) {
          const strip = roofSlice(roofSlice(ring, h, true), h + 0.035, false);
          if (strip.length > 2) trim.polygon([strip.map(([x, y, z]) => [x, y + 0.022, z])], tiles);
        }
      }
    }
    for (const [a, b] of gutters) {
      const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
      const offset = (p, y) => [p[0] + dz / length * 0.075, y, p[2] - dx / length * 0.075];
      beam(trim, offset(a, a[1] - 0.062), offset(b, b[1] - 0.062), 0.14, 0x656666, true);
      const [x, , z] = offset(a, a[1]);
      beam(trim, offset(a, a[1] - 0.092), offset(a, Math.min(a[1] - 1, terrainHeightAt(x, z) + 0.17)), 0.088, 0x616462, true);
    }
    addSolarPanels(trim, roofPlane(DORPSSTRAAT_BUILDINGS[1], 100));
    addChimney(trim, roofPlane(DORPSSTRAAT_BUILDINGS[2], 42), -3533.16, -4435.01, 0.44);
    addChimney(trim, roofPlane(DORPSSTRAAT_BUILDINGS[4], 34), -3551.86, -4412.42, -0.38);
    group.userData.roofCount = DORPSSTRAAT_BUILDINGS.length;
    group.userData.solarPanelCount = solarBanks.length * 12;
  });
  return model;
}
