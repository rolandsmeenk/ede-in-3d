import * as THREE from 'three/webgpu';
import { CivicBatch } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { BARRACKS_HERITAGE_SURVEY } from './ede-barracks-heritage-survey.js';
import { getTerrain, terrainHeightAt } from './terrain.js';
import { createMemorialPlaque } from './ede-memorial-plaque.js';
import { addClockDetails, clockFace } from './ede-clock-model.js';

const { barracks, enka } = BARRACKS_HERITAGE_SURVEY;
const cream = 0xd1bf97, barracksGlass = 0x324347, brownBrick = 0x745047;
const white = 0xdfdfd7, enkaFrame = 0x9ba9a9, enkaGlass = 0x56676b;

export { EDE_BARRACKS_HERITAGE_LANDMARKS } from './ede-barracks-heritage-survey.js';

function box(batch, [x, y, z], w, h, d, color, yaw = 0) {
  batch.solid(new THREE.BoxGeometry(w, h, d).rotateY(yaw).translate(x, y, z), color);
}

function trimBand(wall, y, h, color, offset) {
  surveyPanel(wall, 0, wall.width, y, y + h, color, offset);
}

function decorateBarracks(wall) {
  const { faceIndex, base, low, high, width, trim } = wall;
  if (low > base + 0.05) {
    if ([17, 28, 60, 62, 68].includes(faceIndex)) {
      surveyWindow(wall, 0.13, width - 0.13, low + 0.10, Math.min(low + 0.98, high - 0.06),
        { color: barracksGlass, frame: cream, columns: Math.max(2, Math.round(width / 0.85)) });
    }
    return 0x626263;
  }

  trimBand(wall, base + 0.02, 0.60, brownBrick, 0.026);
  trimBand(wall, base + 0.62, 0.11, 0x99907d, 0.051);
  trimBand(wall, Math.min(high - 0.15, base + 7.68), 0.14, cream, 0.055);
  if ([9, 10].includes(faceIndex)) {
    surveyWindow(wall, 0.18, width - 0.18, base + 0.73, base + 7.57,
      { color: barracksGlass, frame: 0x373c3b, columns: 4, rows: 14 });
    return;
  }

  const front = faceIndex === 5;
  const count = front ? 11 : Math.round(width / 2.75);
  for (let i = 0; i < count; i++) {
    const u = width * (i + 0.5) / count;
    for (const [sill, top] of [[1.02, 3.13], [4.96, 7.30]]) {
      if (front && i === 5 && sill < 4) continue;
      if (!surveyWindow(wall, u - 0.62, u + 0.62, base + sill, base + top,
        { color: barracksGlass, frame: cream, columns: 2, rows: 3 })) continue;
      surveyPanel(wall, u - 0.19, u + 0.19, base + sill + 0.04, base + top - 0.04, barracksGlass, 0.057, 0.65);
      surveyPanel(wall, u - 0.69, u + 0.69, base + sill - 0.09, base + sill, 0xa09b88, 0.09);
    }
  }
  if (front) {
    const u = width / 2;
    surveyWindow(wall, u - 1.02, u + 1.02, base + 0.05, base + 2.68, { color: 0x432a25, frame: 0x675d53, columns: 2 });
    surveyLabel(wall, u - 4.58, u + 4.58, base + 3.78, base + 4.42, 'P.L. BERGANSIUS KAZERNE', '#826254', '#302b26');
    const yaw = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
    box(trim, wall.point(u, base + 2.94, 0.92), 4.12, 0.17, 1.94, 0xc5bdae, yaw);
    for (const side of [-1, 1]) box(trim, wall.point(u + side * 1.90, base + 1.44, 1.72), 0.07, 2.86, 0.07, 0x696762, yaw);
  }
}

function finishBarracks({ group }) {
  const tower = new CivicBatch();
  const x = 308.30, y = 22.74, z = 1366.02, yaw = 0.068;
  box(tower, [x, y + 0.50, z], 1.69, 1.22, 1.33, 0x4a4b4e, yaw);
  box(tower, [x, y + 1.18, z], 1.36, 0.21, 1.16, 0x55565a, yaw);
  box(tower, [x, y + 2.25, z], 0.56, 2.08, 0.53, 0x4b4c50, yaw);
  for (let h = y + 1.29; h < y + 3.22; h += 0.185) {
    box(tower, [x, h, z], 0.58, 0.04, 0.55, 0x35383b, yaw);
  }
  const clock = new THREE.CircleGeometry(0.40, 36).translate(0, 0, 0.685).rotateY(yaw).translate(x, y + 0.64, z);
  tower.solid(clock, 0xdcdad2);
  const clockOnTower = (u, h, d) => new THREE.Vector3(u, h, 0.722 + d)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, y + 0.64, z));
  addClockDetails(group, [clockFace(clockOnTower, 0.40, 0x343537)]);
  for (const [u, width] of [[-4.10, 3.80], [0, 2.5], [3.95, 3.50]]) {
    const dormerX = x + u * Math.cos(yaw), dormerZ = z + 3.21 - u * Math.sin(yaw);
    box(tower, [dormerX, 20.83, dormerZ], width, 1.40, 1.52, 0x626160, yaw);
    box(tower, [dormerX, 21.61, dormerZ + 0.08], width + 0.28, 0.12, 1.83, cream, yaw);
    const count = Math.round(width / 0.92);
    for (let i = 0; i < count; i++) {
      const offset = width * ((i + 0.5) / count - 0.5);
      box(tower, [dormerX + offset * Math.cos(yaw), 21.12, dormerZ + 0.77 - offset * Math.sin(yaw)],
        width / count - 0.10, 0.65, 0.045, barracksGlass, yaw);
    }
  }
  group.add(tower.mesh());
}

const roundedEnkaWalls = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 22, 23, 24, 28]);

function enkaEntrance(wall, u) {
  const { base, point, trim, a, b } = wall;
  const yaw = -Math.atan2(b.z - a.z, b.x - a.x);
  for (let i = 0; i < 2; i++) {
    box(trim, point(u, base + 0.10 + i * 0.14, 0.59 - i * 0.14), 2.18 - i * 0.12, 0.15, 1.18 - i * 0.28, 0xb8b3a3, yaw);
  }
}

function decorateEnka(wall) {
  const { faceIndex, base, low, high, width } = wall;
  const rounded = roundedEnkaWalls.has(faceIndex);
  if (low > base + 0.03) return 0xd5d4ca;
  trimBand(wall, high - 0.20, 0.20, white, 0.06);
  if (rounded) {
    const arc = faceIndex !== 24 && faceIndex !== 28;
    const lo = base + (faceIndex === 15 ? 0.30 : 0.56);
    const hi = base + 3.17;
    if (arc) {
      surveyWindow(wall, 0.035, width - 0.035, lo, hi, { color: enkaGlass, frame: enkaFrame, rows: 3, columns: width > 1.4 ? 3 : 1 });
      if ([7, 10, 13, 15, 22].includes(faceIndex)) surveyPanel(wall, 0, 0.11, base + 0.05, high, white, 0.085);
    } else {
      const count = faceIndex === 28 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const u = width * i / count, v = width * (i + 1) / count;
        surveyWindow(wall, u + 0.15, v - 0.15, lo, hi, { color: enkaGlass, frame: enkaFrame, rows: 3, columns: 3 });
      }
    }
    if (faceIndex === 15) enkaEntrance(wall, width * 0.52);
    return white;
  }

  if (width >= 2.5) {
    const count = Math.max(1, Math.round(width / 3.45));
    for (let i = 0; i < count; i++) {
      const u = width * (i + 0.5) / count;
      const broad = faceIndex === 34 || faceIndex === 3;
      const size = broad && i % 3 !== 1 ? 2.24 : 1.15;
      const lo = base + (broad ? 0.88 : 1.20);
      const hi = Math.min(high - 0.39, base + (broad ? 3.75 : 3.13));
      surveyWindow(wall, u - size / 2, u + size / 2, lo, hi,
        { color: enkaGlass, frame: white, rows: 3, columns: broad ? 3 : 2 });
      surveyPanel(wall, u - size / 2 - 0.06, u + size / 2 + 0.06, lo - 0.08, lo, white, 0.08);
    }
  }
}

function finishEnka({ group, labels, colliders }) {
  const scene = new CivicBatch();
  const yaw = -0.32;
  const ground = (x, z) => getTerrain() ? terrainHeightAt(x, z) : enka.ground;
  // The open pier just beyond the first window on the surveyed long east wall.
  const [east, north] = [[410.51, 2351.41], [418, 2329.28]];
  const fraction = 1 / 7;
  const plaqueX = east[0] + (north[0] - east[0]) * fraction + 0.07;
  const plaqueZ = east[1] + (north[1] - east[1]) * fraction + 0.024;
  const workers = [
    '27-12   M. KROON   1944', '20-3   D.V. GESTEL   1945', '5-2   G.V. DREVEN   1943',
    '17-9   M.V. MANEN   1944', '13-10   G.G. DERKSEN   1944', '22-12   G.J. VROEGOP   1944',
    '27-12   H. ARENDSEN   1944', '10-2   L. VEENBRINK   1945', '23-2   J.J.W. VERWEIJ   1945',
    '27-12   W. SNETSELAAR   1944', '16-9   W. ZITTERSTEIJN   1944', 'J. RIPPE',
  ];
  group.add(createMemorialPlaque({
    name: 'ENKA-monument', x: plaqueX, y: ground(plaqueX, plaqueZ) + 0.87, z: plaqueZ, heading: 1.245,
    width: 0.77, height: 1.38, base: '#d6d3c1', ink: '#363a36',
    outline: [[0.44,0], [0.55,0], [0.81,0.35], [0.94,0.37], [1,0.96], [0.71,0.97],
      [0.71,1], [0.21,1], [0.21,0.97], [0,0.96], [0.06,0.37], [0.19,0.35]],
    lines: [
      ...['AAN', 'HEN', 'DIE', 'VIELEN', '1940–1945'].map((line, i) => [line, 0.14 + i * 0.047, 0.035]),
      ...workers.map((line, i) => [line, 0.43 + i * 0.046, 0.027]),
    ],
  }));
  const solarRows = [
    [411.05, 4.69, 2337.00, 3, 9], [407.50, 3.77, 2326.48, 1, 5],
    [401.97, 3.77, 2337.73, 1, 5], [399.95, 4.68, 2354.31, 3, 4], [410.92, 3.78, 2356.95, 3, 3],
  ];
  for (const [x, y, z, columns, rows] of solarRows) {
    for (let row = 0; row < rows; row++) {
      const v = (row + 0.5 - rows / 2) * 1.75;
      for (let column = 0; column < columns; column++) {
        const u = (column + 0.5 - columns / 2) * 1.06;
        const px = x + u * Math.cos(yaw) + v * Math.sin(yaw);
        const pz = z - u * Math.sin(yaw) + v * Math.cos(yaw);
        box(scene, [px, y, pz], 1.0, 0.07, 1.67, 0x303a45, yaw);
      }
    }
  }
  const fountain = { x: 425.96, z: 2347.64 };
  const basin = ground(fountain.x, fountain.z);
  const stone = 0x8e8b72, pool = 0x566955, ceramic = 0x728175;
  const plazaPoint = (center, u, y, v) => [
    center.x + u * Math.cos(yaw) + v * Math.sin(yaw), y,
    center.z - u * Math.sin(yaw) + v * Math.cos(yaw),
  ];
  box(scene, plazaPoint(fountain, 0, basin + 0.075, 0), 3.95, 0.13, 3.85, pool, yaw);
  for (const side of [-1, 1]) {
    box(scene, plazaPoint(fountain, side * 1.98, basin + 0.135, 0), 0.20, 0.27, 4.04, stone, yaw);
    box(scene, plazaPoint(fountain, 0, basin + 0.135, side * 1.91), 3.83, 0.27, 0.20, stone, yaw);
  }
  const fountainCylinder = (upper, lower, height, elevation, color, scaleX = 1) => {
    scene.solid(new THREE.CylinderGeometry(upper, lower, height, 24).scale(scaleX, 1, 1)
      .rotateY(yaw).translate(fountain.x, basin + elevation, fountain.z), color);
  };
  fountainCylinder(0.81, 0.78, 0.82, 0.54, 0x814f42, 0.70);
  fountainCylinder(0.85, 0.85, 0.11, 1.00, stone, 0.70);
  box(scene, plazaPoint(fountain, 0, basin + 1.39, 0), 0.37, 0.75, 0.40, 0x86554a, yaw);
  for (const s of [-1, 1]) {
    scene.solid(new THREE.CylinderGeometry(0.12, 0.33, 0.71, 12).scale(0.6, 1, 0.8)
      .translate(...plazaPoint(fountain, 0, basin + 1.38, s * 0.30)), ceramic);
  }
  fountainCylinder(0.19, 0.20, 0.10, 1.82, stone);
  fountainCylinder(0.14, 0.20, 0.13, 1.93, ceramic);
  fountainCylinder(0.028, 0.028, 0.15, 2.02, 0x88928c);

  const bench = { x: 432.09, z: 2348.62 };
  const g = ground(bench.x, bench.z);
  const sandstone = 0xae987e, wood = 0x613d33;
  box(scene, plazaPoint(bench, 0.16, g + 0.75, 0), 0.31, 0.96, 3.25, sandstone, yaw);
  box(scene, plazaPoint(bench, -0.24, g + 0.45, 0), 0.66, 0.10, 3.04, wood, yaw);
  box(scene, plazaPoint(bench, -0.004, g + 0.79, 0), 0.04, 0.56, 0.82, 0x527d75, yaw);
  for (let i = -1; i <= 1; i++) {
    box(scene, plazaPoint(bench, -0.03, g + 0.21, i * 0.92), 0.52, 0.42, 0.32, 0x8d7360, yaw);
  }
  for (const s of [-1, 1]) {
    scene.solid(new THREE.CylinderGeometry(0.26, 0.33, 0.91, 16)
      .translate(...plazaPoint(bench, -0.08, g + 0.47, s * 1.70)), sandstone);
    scene.solid(new THREE.CylinderGeometry(0.30, 0.30, 0.08, 16)
      .translate(...plazaPoint(bench, -0.08, g + 0.94, s * 1.70)), sandstone);
  }
  group.add(scene.mesh());
  colliders.push(
    { minX: fountain.x - 0.80, maxX: fountain.x + 0.80, minZ: fountain.z - 0.86, maxZ: fountain.z + 0.86, minY: basin, maxY: basin + 2.10 },
    { minX: bench.x - 0.50, maxX: bench.x + 0.50, minZ: bench.z - 1.98, maxZ: bench.z + 1.98, minY: g, maxY: g + 1.25 },
  );
  labels.push({
    text: 'DE PROEFZAAK', a: { x: 414.91, z: 2355.35 }, b: { x: 416.82, z: 2359.72 },
    lo: 3.67, hi: 4.15, color: 'transparent', textColor: '#e5e5dc',
  });
}

export const BARRACKS_HERITAGE_FACTORIES = {
  bergansiuskazerne: (_footprints, site) => createSurveyLandmark(site, [barracks], decorateBarracks, finishBarracks),
  'enka-ehbo': (_footprints, site) => {
    const group = createSurveyLandmark(site, [enka], decorateEnka, finishEnka);
    const sign = group.children.find(mesh => mesh.name !== 'ENKA-monument' && mesh.material.map?.isCanvasTexture);
    if (sign) sign.material.alphaTest = 0.45;
    return group;
  },
};
