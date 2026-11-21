import * as THREE from 'three/webgpu';
import { mix, normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { facePanel } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { sampleRoofColor } from './aerial-colors.js';
import { getTerrain, terrainHeightAt } from './terrain.js';
import { KERNHEM_NEIGHBORHOOD_SURVEYS } from './ede-kernhem-neighborhood-survey.js';

const charcoal = 0x303033;
const glass = 0x485a62;
const paleConcrete = 0xb3ae9f;
const rail = 0x737b7b;
const balconyGlass = 0x96acac;

const PARKWEIDE_STOREFRONTS = [
  {
    7: { bays: 4, signs: [[3, 'Albert Heijn', '#704039', '#28a9e3', 4.4]] },
    25: { bays: 8, signs: [[0, 'Kruidvat', '#ab272c', '#fff5ea'], [3, 'Etos', '#007b51', '#f1f1e8'],
      [4, 'AMI Kappers', '#343535', '#e7e7df']] },
    35: { bays: 2 },
    36: { bays: 1 },
    39: { bays: 2, signs: [[0, 'Gall & Gall', '#702031', '#f1ebe5']] },
  },
  {
    9: { bays: 6, signs: [[0, 'Bakhuus Parkweide', '#54392c', '#f3dfb7'],
      [4, 'ALDI', '#24324e', '#59b6e9', 2.8]] },
    13: { bays: 4, signs: [[0, 'Avablooms', '#4a454b', '#f2dde4'],
      [1, 'De Koopman', '#665847', '#fff0d3'], [2, 'Mr. Fillet', '#633738', '#f7e0be'],
      [3, 'Bakkerij Van Voorthuizen', '#583925', '#f2deb9', 5.5]] },
    19: { bays: 1 },
    24: { bays: 2 },
  },
];

const WATERZOOM_LAYOUTS = {
  0: { windows: [0.12, 0.40, 0.61, 0.87], balconies: [0.26, 0.74] },
  1: { windows: [0.23, 0.49, 0.82], entrance: true },
  3: { windows: [0.10, 0.29, 0.79], balconies: [0.54] },
  4: { windows: [0.81], recess: [0.07, 0.62] },
  5: { windows: [0.10, 0.30, 0.61, 0.81, 0.93], balconies: [0.46] },
  6: { windows: [0.18, 0.80], balconies: [0.54], raised: true },
  9: { windows: [0.14, 0.52, 0.83], balconies: [0.35, 0.69], raised: true },
  10: { windows: [0.10, 0.29, 0.79], balconies: [0.54] },
  11: { windows: [0.81], recess: [0.07, 0.62] },
  12: { windows: [0.10, 0.30, 0.61, 0.81, 0.93], balconies: [0.46] },
  13: { windows: [0.18, 0.80], balconies: [0.54] },
  16: { windows: [0.16, 0.80], balconies: [0.51] },
  17: { windows: [0.25, 0.78] },
  18: { windows: [0.11, 0.38, 0.68, 0.86], balconies: [0.51] },
};
const WATERZOOM_FLOORS = [-11.60, -8.78, -5.96, -3.14, -0.32];

function wallBox(wall, u, v, low, high, depth, color, offset = 0, batch = wall.trim) {
  const [x, y, z] = wall.point((u + v) / 2, (low + high) / 2, offset + depth / 2);
  const yaw = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  batch.solid(new THREE.BoxGeometry(v - u, high - low, depth).rotateY(yaw).translate(x, y, z), color);
}

function parkweideFacade(wall) {
  const { buildingIndex, faceIndex, width, low, high, point } = wall;
  if (high - low < 4.5 || width < 2.0) return;
  const [x, , z] = point(width / 2, 0);
  const ground = getTerrain() ? terrainHeightAt(x, z) : -8.2;
  const bottom = Math.max(low + 0.13, ground + 0.10);
  const lintel = Math.min(high - 1.0, -4.77);
  for (const y of [-3.83, -3.55]) {
    if (high > y + 0.14) wallBox(wall, 0.07, width - 0.07, y, y + 0.11, 0.075, paleConcrete);
  }

  const layout = PARKWEIDE_STOREFRONTS[buildingIndex][faceIndex];
  if (!layout) {
    if (width < 45 && width > 8) {
      const u = width * 0.56, head = bottom + 2.75;
      surveyWindow(wall, u - 1.28, u + 1.28, bottom, head, { color: 0x575858, frame: 0x343434 });
      for (let y = bottom + 0.22; y < head - 0.1; y += 0.18) {
        surveyPanel(wall, u - 1.21, u + 1.21, y, y + 0.015, 0x494949, 0.052);
      }
    }
    return;
  }
  const pitch = width / layout.bays;
  for (let bay = 0; bay < layout.bays; bay++) {
    const u = bay * pitch + 0.30, v = (bay + 1) * pitch - 0.30;
    const sign = layout.signs?.find(([slot]) => slot === bay);
    if (surveyWindow(wall, u, v, bottom, lintel, { columns: sign ? 4 : 3, rows: 2, color: glass, frame: charcoal })) {
      const mullion = (u + v) / 2;
      const handleHeight = bottom + 1.10;
      if (sign) {
        surveyPanel(wall, mullion - 0.52, mullion + 0.52, bottom + 0.15, lintel - 0.05, 0x303a41, 0.059, 0.78);
        for (const du of [-0.14, 0.14]) {
          wallBox(wall, mullion + du - 0.021, mullion + du + 0.021, handleHeight - 0.12,
            handleHeight + 0.12, 0.026, 0x8e9498, 0.065);
        }
      }
      surveyPanel(wall, u, v, lintel - 0.64, lintel - 0.55, charcoal, 0.063);
      surveyPanel(wall, u, v, bottom + 0.09, bottom + 0.16, charcoal, 0.063);
    }
    if (bay) {
      const pier = bay * pitch;
      wallBox(wall, pier - 0.23, pier + 0.23, bottom, lintel + 0.63, 0.16, charcoal);
      wallBox(wall, pier - 0.28, pier + 0.28, lintel + 0.63, lintel + 0.77, 0.20, paleConcrete);
    }
    if (sign) {
      const [, name, background, text, size = 3.25] = sign;
      const half = Math.min((v - u) * 0.49, size / 2);
      const center = (u + v) / 2;
      surveyLabel(wall, center - half, center + half, lintel + 0.14, lintel + 0.72, name, background, text);
      if (name === 'Albert Heijn' || name === 'ALDI') {
        wallBox(wall, u, v, high - 0.05, high + 0.08, 0.30, paleConcrete, -0.05);
      }
    }
  }
}

function balcony(wall, u, v, floor, depth) {
  wallBox(wall, u, v, floor - 0.17, floor, depth, paleConcrete);
  const recess = depth - 0.055;
  surveyPanel(wall, u + 0.045, v - 0.045, floor + 0.04, floor + 0.96, balconyGlass, recess, 0.60);
  wallBox(wall, u + 0.035, v - 0.035, floor + 0.96, floor + 1.00, 0.05, rail, recess);
  for (const t of [0.025, 0.34, 0.66, 0.975]) {
    const p = u + (v - u) * t;
    wallBox(wall, p - 0.022, p + 0.022, floor + 0.04, floor + 0.96, 0.046, rail, recess);
  }
  for (const edge of [u + 0.045, v - 0.045]) {
    wallBox(wall, edge - 0.025, edge + 0.025, floor + 0.04, floor + 0.96, recess, balconyGlass, 0.023);
    wallBox(wall, edge - 0.027, edge + 0.027, floor + 0.96, floor + 1.00, recess, rail, 0.023);
  }
}

function recessedBalcony(wall, u, v, floor) {
  const high = floor + 2.34, recess = 1.32;
  if (!surveyOpeningFits(wall, u, v, floor, high)) return;
  const { point, rings, shell, a, b, normal, width } = wall;
  const front = [point(u, floor), point(v, floor), point(v, high), point(u, high)];
  const back = [point(u, floor, -recess), point(v, floor, -recess), point(v, high, -recess), point(u, high, -recess)];
  rings.push(front);
  shell.quad(front[1], back[1], back[0], front[0], 0x847c70);
  shell.quad(back[3], back[2], front[2], front[3], 0x8c8273);
  shell.quad(back[0], back[3], front[3], front[0], 0x817362);
  shell.quad(front[2], back[2], back[1], front[1], 0x817362);
  facePanel(shell, a, b, normal, u / width, v / width, floor, high, 0x554b42, -recess);
  surveyPanel(wall, u + 0.18, v - 0.18, floor + 0.10, high - 0.13, charcoal, -recess + 0.015);
  for (const [left, right] of [[0.24, 0.43], [0.455, 0.66], [0.685, 0.82]]) {
    surveyPanel(wall, u + (v - u) * left, u + (v - u) * right, floor + 0.14, high - 0.19, glass, -recess + 0.024, 0.72);
  }
  surveyPanel(wall, u + 0.04, v - 0.04, floor + 0.04, floor + 0.96, balconyGlass, -0.085, 0.60);
  wallBox(wall, u, v, floor + 0.96, floor + 1.00, 0.046, rail, -0.11);
  for (const offset of [0.08, (v - u) * 0.5, v - u - 0.08]) {
    wallBox(wall, u + offset - 0.022, u + offset + 0.022, floor + 0.04, floor + 0.96, 0.045, rail, -0.10);
  }
}

function waterzoomFacade(wall) {
  const { faceIndex, width, low, high } = wall;
  if (width < 1.8) return;
  if (low < -12.0) {
    facePanel(wall.shell, wall.a, wall.b, wall.normal, 0, 1, low - 0.10,
      WATERZOOM_FLOORS[0] - 0.06, 0x515152, 0.018);
  }
  const layout = WATERZOOM_LAYOUTS[faceIndex];
  if (!layout) return;
  for (const [level, elevation] of WATERZOOM_FLOORS.entries()) {
    if (elevation < low - 0.30) continue;
    const floor = Math.max(elevation, low + 0.025);
    if (floor + 2.42 > high) continue;
    const windowTop = floor + 2.41;
    if (layout.entrance && level === 0) {
      const u = width * 0.28, v = width * 0.90;
      surveyWindow(wall, u, v, floor + 0.04, windowTop, { frame: charcoal, color: glass, columns: 4 });
      surveyPanel(wall, width * 0.46, width * 0.68, floor + 0.22, windowTop - 0.10, 0x493d34, 0.051);
      continue;
    }
    for (const center of layout.windows) {
      const u = width * center;
      const half = Math.min(width * 0.078, 0.87);
      const sill = floor + (layout.raised && level === 0 ? 0.92 : 0.46);
      surveyWindow(wall, u - half, u + half, sill, windowTop, { frame: charcoal, color: glass, columns: 2 });
      surveyPanel(wall, u - half - 0.045, u + half + 0.045, sill - 0.07, sill, 0x776d60, 0.061);
    }
    for (const center of layout.balconies ?? []) {
      const u = width * center, half = Math.min(width * 0.13, 1.95);
      if (layout.raised && level === 0) continue;
      if (surveyWindow(wall, u - half + 0.10, u + half - 0.10, floor + 0.05, windowTop,
        { frame: charcoal, color: glass, columns: 3 }) && (level > 0 || faceIndex === 0 || faceIndex === 5)) {
        balcony(wall, u - half, u + half, floor, faceIndex === 0 || faceIndex === 9 ? 1.85 : 1.42);
      }
    }
    if (layout.recess) {
      const [u, v] = layout.recess.map(t => t * width);
      recessedBalcony(wall, u, v, floor);
    }
  }
}

let masonry;
function finishMasonry(group) {
  masonry ??= createFacadeSurfaceTexture().texture;
  const across = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
  const mortar = texture(masonry, vec2(across.div(1.03), positionWorld.y.div(0.57))).r;
  const side = normalWorld.y.abs().lessThan(0.10).toFloat();
  group.children[0].material.colorNode = vertexColor().mul(mix(1, mix(0.81, 1.08, mortar), side));
}

export function buildEdeKernhemNeighborhoodLandmark(site) {
  const water = site.id === 'waterzoom-kernhem';
  const ids = [site.osmId, ...site.annexOsmIds];
  const buildings = KERNHEM_NEIGHBORHOOD_SURVEYS[site.id].map((building, index) => {
    const sample = [0, 0, 0];
    const roofColor = sampleRoofColor(ids[index], sample) ? new THREE.Color(...sample) : building.roofColor;
    return { ...building, roofColor, roofColors: water ? { 21: 0x686d59 } : undefined };
  });
  return createSurveyLandmark(site, buildings, water ? waterzoomFacade : parkweideFacade,
    ({ group }) => finishMasonry(group));
}
