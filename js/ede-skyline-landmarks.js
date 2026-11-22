import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup } from './ede-civic-landmarks.js';
import { EDE_SKYLINE_LANDMARKS, SKYLINE_SHELLS } from './ede-skyline-survey.js';
import { createSurveyLandmark, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const concrete = 0xbcb6a9;
const glazing = [0x405258, 0x4c5f62, 0x52636a, 0x627172];
const galleryColors = {
  mariendaal: [0xcfc7b4, 0xa79d84, 0x7b6253],
  langenhorst: [0xd6d4c7, 0xb6b5ac, 0x71817b],
  'valkestein-west': [0xc8beb0, 0xa6a7a2, 0x716961],
  'valkestein-midden': [0xc8bca8, 0x9fa5a3, 0x735f51],
  'valkestein-oost': [0xcdc1ad, 0xaab0ae, 0x755f52],
  'weerdestein-flat': [0xc2bdb0, 0xa7a6a2, 0x846e5c],
  'groot-derxsgoed': [0xb8b0a4, 0xa89584, 0x8a6256],
  'de-brugge-flat': [0xc4b7a7, 0xa5a19a, 0xa46b5d],
  'groot-haversteeg': [0xbcbaa9, 0xaca89f, 0x9e7668],
  'de-elskamp': [0xc3b5a6, 0xb6aca1, 0xa77360],
  'willem-marisflat': [0xc8c0af, 0xa9aaa0, 0x7c8a83],
  stroombergflat: [0xbbb4a2, 0xa6a196, 0x8f6859],
  merlijnflat: [0xbab3a6, 0xa8a097, 0xa07562],
};
const steniColors = [0xcfccbc, 0xaab2a4, 0x7f9992, 0xb1a24e, 0xad7759, 0x88928f];

function surveyedBox(batch, wall, u, y, offset, width, height, depth, color) {
  const [x, , z] = wall.point(u, y, offset);
  const heading = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(heading).translate(x, y, z), color);
}

function housingFacade(wall, site) {
  const [body, deck, accent] = galleryColors[site.id] ?? [0xc4bcaa, 0xb1a99c, 0x928578];
  const { width, base, high, low, normal, a, b, shell, trim } = wall;
  const pointBlock = site.style === 'point';
  const longFace = width > (pointBlock ? 7.3 : 13.2);
  const plinth = base + 2.45;
  const pitch = site.style === 'langenhorst' ? 2.83 : 2.78;
  const tint = high < plinth + 0.08 ? accent : body;
  if (!longFace && !pointBlock) return tint;
  if (low > base + 7 || high < plinth + 2.2) return tint;

  const balconySide = pointBlock || (site.id === 'mariendaal' ? normal.x < 0 : Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? normal.z > 0 : normal.x > 0);
  const bayCount = Math.max(1, Math.round(width / (pointBlock ? 3.7 : 4.35)));
  const bay = width / bayCount;
  if (bay < 1.2) return tint;
  for (let course = 0; plinth + course * pitch + 2.22 < high; course++) {
    const floor = plinth + course * pitch;
    const start = 0.17, end = width - 0.17;
    if (!surveyOpeningFits(wall, start, end, floor + 0.06, floor + 0.72)) continue;
    surveyPanel({ ...wall, trim: shell }, start, end, floor + 0.07, floor + 0.42, deck, 0.027);
    if (balconySide) {
      const depth = pointBlock ? 0.78 : 0.63;
      surveyedBox(trim, wall, width / 2, floor - 0.02, depth / 2, width - 0.28, 0.18, depth, deck);
      surveyPanel(wall, start, end, floor + 0.09, floor + 0.93, accent, depth, 0.19);
      surveyPanel(wall, start, end, floor + 0.89, floor + 0.96, deck, depth + 0.012);
    }
    for (let i = 0; i < bayCount; i++) {
      const u = bay * i;
      const colored = site.style === 'langenhorst' ? steniColors[(i + Math.floor(course / 3) * 3) % steniColors.length] : accent;
      surveyWindow(wall, u + bay * 0.12, u + bay * (balconySide ? 0.83 : 0.70), floor + (balconySide ? 0.53 : 0.80),
        floor + 2.20, { color: glazing[(i + course * 3) % glazing.length], frame: 0xd3cec0, columns: 2 });
      if (balconySide) {
        surveyPanel(wall, u + bay * 0.89, u + bay * 0.96, floor + 0.97, floor + 2.20, colored, 0.041);
        surveyPanel(wall, u + bay * 0.95, u + bay * 0.97, floor + 0.11, floor + 0.92, deck, (pointBlock ? 0.78 : 0.63) + 0.024);
      } else {
        surveyPanel(wall, u + bay * 0.74, u + bay * 0.93, floor + 0.62, floor + 2.28, colored, 0.038);
      }
    }
  }
  if (width > 12 && high > plinth + 5) {
    const mid = width / 2;
    surveyWindow(wall, mid - 1.65, mid + 1.65, base + 0.24, base + 2.23,
      { color: 0x394d53, frame: 0x888b83, columns: 3, rows: 2 });
  }
  return tint;
}

function housing(site) {
  const shells = SKYLINE_SHELLS[site.id].map(part => ({ ...part, wallColor: concrete, roofColor: 0x5c5d5c }));
  const model = createSurveyLandmark(site, shells, wall => housingFacade(wall, site));
  for (const mesh of model.children) {
    if (mesh.userData.nearDetail) mesh.userData.nearDetail = 240;
  }
  return model;
}

const timber = 0x966e4f, limestone = 0xa79c89, mullion = 0x5d584c;

function terraceFrame(part) {
  const ring = part.outline[0];
  const edges = ring.map(([x, z], i) => [ring[(i + 1) % ring.length][0] - x, ring[(i + 1) % ring.length][1] - z]);
  const [dx, dz] = edges.reduce((a, b) => Math.hypot(...a) > Math.hypot(...b) ? a : b);
  const heading = -Math.atan2(dz, dx), cos = Math.cos(heading), sin = Math.sin(heading);
  const us = ring.map(([x, z]) => cos * x - sin * z), vs = ring.map(([x, z]) => sin * x + cos * z);
  const centerU = (Math.min(...us) + Math.max(...us)) / 2, centerV = (Math.min(...vs) + Math.max(...vs)) / 2;
  const width = Math.max(...us) - Math.min(...us), depth = Math.max(...vs) - Math.min(...vs);
  const at = (u, v) => [cos * (centerU + u) + sin * (centerV + v), -sin * (centerU + u) + cos * (centerV + v)];
  function box(batch, w, h, d, u, y, v, color) {
    const [x, z] = at(u, v);
    batch.solid(new THREE.BoxGeometry(w, h, d).rotateY(heading).translate(x, y, z), color);
  }
  return { width, depth, at, box };
}

function proeftuin(site) {
  const common = new CivicBatch(), close = new CivicBatch(), colliders = [];
  for (const [partIndex, part] of SKYLINE_SHELLS[site.id].entries()) {
    const { width, depth, at, box } = terraceFrame(part);
    const base = part.ground, top = base + part.height, tall = partIndex === 0;
    const support = getTerrain() ? Math.min(base, ...part.outline[0].map(([x, z]) => terrainHeightAt(x, z) - 0.18)) : base;
    const plinth = Math.min(top - 4, base + (tall ? 2.2 : 1.05));
    const floorHeight = (top - plinth - 0.42) / part.stories;
    box(common, width - 0.6, plinth - support, depth - 0.30, 0, (support + plinth) / 2, 0, limestone);
    for (let floor = 0; floor < part.stories; floor++) {
      const y = plinth + floor * floorHeight;
      const inset = tall && floor >= part.stories - 2 ? 0.79 : 0;
      const w = width - 2 * inset, d = depth - 0.92 * inset;
      const coreW = w - (tall ? 2.9 : 1.8), coreD = d - (tall ? 3.25 : 2.2);
      box(common, coreW, floorHeight - 0.14, coreD, 0, y + floorHeight / 2, 0, limestone);
      box(common, w - 0.05, 0.25, d - 0.08, 0, y + 0.09, 0, timber);
      for (const side of [-1, 1]) {
        const v = side * coreD / 2, length = Math.round(coreW / 3.65);
        const span = coreW / length;
        for (let i = 0; i < length; i++) {
          const u = -coreW / 2 + (i + 0.5) * span;
          box(close, span * 0.80, floorHeight * 0.74, 0.085, u, y + floorHeight * 0.49, v, glazing[(i + floor) % glazing.length]);
          box(close, 0.09, floorHeight * 0.74, 0.11, u, y + floorHeight * 0.49, v + side * 0.025, mullion);
        }
        for (const u of [-1, 1]) {
          const end = u * (w / 2 - 0.30), edge = side * (d / 2 - 0.23);
          const terrace = tall ? 5.2 + (floor % 3) * 0.6 : 4.4;
          box(close, terrace, 0.72, 0.06, end - u * terrace / 2, y + 0.60, edge, 0x778b84);
          box(close, terrace, 0.06, 0.10, end - u * terrace / 2, y + 0.98, edge, 0xbfb9a6);
          box(close, 0.08, 0.73, d * 0.27, end, y + 0.61, edge - side * d * 0.135, 0x73847d);
          box(close, 0.13, floorHeight - 0.18, 0.13, end, y + floorHeight * 0.5, edge, timber);
          box(close, 2.15, 0.54, 0.47, end - u * 1.63, y + 0.37, edge - side * 0.41, 0x6a6553);
          for (let plant = 0; plant < 3; plant++) {
            const [x, z] = at(end - u * (0.94 + plant * 0.64), edge - side * 0.43);
            const radius = 0.34 + ((plant + floor) % 3) * 0.10;
            close.solid(new THREE.IcosahedronGeometry(radius, 0).scale(1.22, 0.8, 0.78)
              .translate(x, y + 0.69 + radius * 0.36, z), [0x5d7540, 0x62763f, 0x395439][plant]);
          }
          for (let i = 1; i < 4; i++) {
            box(close, 0.075, floorHeight * 0.80, 0.10, end - u * (2.8 + i * 0.32), y + floorHeight * 0.51, v, timber);
          }
          box(close, 0.07, floorHeight * 0.74, coreD * 0.34, u * coreW / 2, y + floorHeight * 0.50,
            side * coreD * 0.22, glazing[(floor + partIndex) % glazing.length]);
        }
      }
    }
    box(common, width - (tall ? 1.58 : 0.06), 0.42, depth - (tall ? 0.73 : 0.09), 0, top - 0.21, 0, timber);
    box(common, width - 2.1, 0.10, depth - 1.2, 0, top - 0.05, 0, 0x5b5e52);
    const polygon = site.surveyFootprints[partIndex];
    const { outer } = polygon;
    colliders.push({ minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
      minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)), minY: support, maxY: top, polygon });
  }
  const model = makeGroup(site.name, common, colliders);
  const detail = close.mesh();
  detail.userData.nearDetail = 220;
  detail.castShadow = false;
  model.add(detail);
  return model;
}

// Public BGT tank centers and radii, with AHN top elevations in scene metres.
const millTanks = [
  [-6353.37, -2183.57, 1.40, -9.34], [-6353.25, -2180.32, 1.40, -4.86], [-6352.94, -2176.87, 1.40, -4.74],
];

function mill(site) {
  const shells = SKYLINE_SHELLS[site.id].map(part => ({ ...part, wallColor: 0xb9b9b1, roofColor: 0x585c59,
    roofColors: part.faces.map(([roof, indices]) => roof && indices.length > 5 && indices.every(i => part.points[i][1] > 15)
      ? 0x985f58 : 0x565a57) }));
  const model = createSurveyLandmark(site, shells, wall => {
    const { width, high, low, base } = wall;
    if (width > 3.2 && low < base + 0.1 && high > base + 4.25) {
      surveyWindow(wall, width * 0.25, width * 0.75, base + 0.27, base + 4.05, { color: 0x5d625f, frame: 0xa8aaa2, rows: 4 });
    }
    if (width > 1.5 && high > base + 6) {
      for (let u = 0.18; u < width - 0.10; u += 0.51) {
        if (surveyOpeningFits(wall, u, u + 0.17, Math.max(low, base + 4.4) + 0.1, high - 0.15)) {
          surveyPanel(wall, u, u + 0.039, Math.max(low, base + 4.4) + 0.1, high - 0.15, 0xa2a49c, 0.019);
        }
      }
    }
    return high < base + 4 ? 0x8a8980 : 0xd1d1c8;
  }, ({ group, colliders }) => {
    const equipment = new CivicBatch();
    for (const [x, z, radius, top] of millTanks) {
      const y = getTerrain() ? Math.min(-14.17, terrainHeightAt(x, z) - 0.12) : -14.17;
      const rim = top - 0.3;
      equipment.solid(new THREE.CylinderGeometry(radius, radius, rim - y, 14).translate(x, (rim + y) / 2, z), 0x9ba29f);
      equipment.solid(new THREE.CylinderGeometry(radius * 0.61, radius, top - rim, 14).translate(x, (top + rim) / 2, z), 0xaab2ae);
      const outer = Array.from({ length: 14 }, (_, i) => {
        const angle = 2 * Math.PI * i / 14;
        return { x: x + radius * Math.cos(angle), z: z + radius * Math.sin(angle) };
      });
      colliders.push({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius,
        minY: y, maxY: top, polygon: { outer, holes: [] } });
    }
    for (const [x, z, bottom, top] of [[-6378.84, -2179.52, 12.1, 20.72], [-6377.75, -2179.11, 12.1, 20.42]]) {
      equipment.solid(new THREE.CylinderGeometry(0.33, 0.35, top - bottom, 12).translate(x, (bottom + top) / 2, z), 0xbfc5c1);
      equipment.solid(new THREE.CylinderGeometry(0.49, 0.44, 0.19, 12).translate(x, top - 0.09, z), 0x858d8b);
    }
    group.add(equipment.mesh());
  });
  return model;
}

const byStyle = { terraces: proeftuin, mill };
export const EDE_SKYLINE_LANDMARK_FACTORIES = Object.fromEntries(EDE_SKYLINE_LANDMARKS.map(site => {
  const build = byStyle[site.style] ?? housing;
  return [site.id, (_footprints, site) => build(site)];
}));
