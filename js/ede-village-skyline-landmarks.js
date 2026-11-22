import * as THREE from 'three/webgpu';
import { CivicBatch } from './ede-civic-landmarks.js';
import { addClockDetails, addRoundClock } from './ede-clock-model.js';
import { VILLAGE_SKYLINE_SURVEYS } from './ede-village-skyline-survey.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';

const brownBrick = 0x795044;
const paleBand = 0xd5cdc0;
const silver = 0xaaada8;
const frame = 0x3e4544;
const glazing = [0x4b6067, 0x58707a, 0x647781, 0x384750];

function prism(ring, low, high, ground, wallColor, roofColor, style, outline = []) {
  const [x0, z0] = ring[0];
  const area = ring.reduce((sum, [x, z], i) => {
    const [nextX, nextZ] = ring[(i + 1) % ring.length];
    return sum + (x - x0) * (nextZ - z0) - (nextX - x0) * (z - z0);
  }, 0);
  const ordered = area > 0 ? [...ring].reverse() : ring;
  const points = [low, high].flatMap(y => ordered.map(([x, z]) => [x, y, z]));
  const n = ordered.length;
  const faces = ordered.map((_, i) => {
    const j = (i + 1) % n;
    return [0, [i, j, j + n, i + n]];
  });
  faces.push([1, ordered.map((_, i) => i + n)]);
  return { points, faces, ground, wallColor, roofColor, style, outline };
}

function boxOnWall(wall, u, y, offset, width, height, depth, color) {
  const [x, , z] = wall.point(u, y, offset);
  const heading = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  wall.shell.solid(new THREE.BoxGeometry(width, height, depth).rotateY(heading).translate(x, y, z), color);
}

// Lage Valkseweg frontage and its perpendicular, fitted to the BAG south wall.
const millU = [0.826, 0.564], millV = [0.564, -0.826];
const millPoint = (u, v) => [3218.96 + u * millU[0] + v * millV[0], -7598.5 + u * millU[1] + v * millV[1]];
const millPlan = (u0, v0, u1, v1) => [millPoint(u0, v0), millPoint(u1, v0), millPoint(u1, v1), millPoint(u0, v1)];
// The supermarket roof follows the rear parcel's slightly different alignment.
const rearPoint = (u, v) => millPoint(u, v + (u + 57) * 0.115);
const rearPlan = [rearPoint(-57, 34), rearPoint(11.4, 34), rearPoint(11.4, 50.1), rearPoint(-57, 50.1)];

function maalderijFacade(wall) {
  const { width, low, high, base, building, normal, shell } = wall;
  if (width < 0.85) return;
  const surface = { ...wall, trim: shell };
  const streetFace = normal.x * millV[0] + normal.z * millV[1] < -0.86;

  if (building.style === 'stair') {
    if (!streetFace) return;
    surveyPanel(surface, 0.78, width - 0.78, low + 0.20, high - 0.48, 0x31434c, 0.055, 0.72);
    for (let i = 1; i < 5; i++) {
      const u = 0.78 + (width - 1.56) * i / 5;
      surveyPanel(wall, u - 0.037, u + 0.037, low + 0.18, high - 0.46, frame, 0.067);
    }
    for (let y = low + 0.7; y < high - 0.7; y += 0.91) {
      surveyPanel(wall, 0.78, width - 0.78, y, y + 0.068, frame, 0.067);
    }
    return;
  }
  if (building.style === 'crown' || building.style === 'west-crown') {
    const windows = building.style === 'west-crown' && width > 16
      ? Array.from({ length: Math.floor(width / 2.8) }, (_, i) => (i + 0.35) * 2.8)
      : [2.7, 5.2, 10.2, 12.7];
    if (width > 7) for (const u of windows) {
      surveyWindow(wall, u, u + 0.91, low + 0.56, high - 0.48, { color: glazing[0], frame });
    }
    for (let u = 0.25; u < width - 0.12; u += 0.34) {
      surveyPanel(wall, u, u + 0.031, low + 0.13, high - 0.12, 0x8c938f, 0.024);
    }
    return;
  }

  const groundFloor = building.style === 'retail';
  const tall = building.style === 'tower';
  const rear = building.style === 'rear' || building.style === 'service';
  const bays = Math.max(1, Math.round(width / (groundFloor ? 3.35 : tall ? 4.0 : rear ? 5.0 : 2.68)));
  const bay = width / bays;
  const pitch = tall ? 3.42 : 3.24;
  const balcony = building.style === 'west-wing' && !streetFace && width > 14;
  for (let y = low + 0.08, level = 0; y + 1.9 < high; y += pitch, level++) {
    const concreteY = groundFloor ? high - 0.37 : y - 0.015;
    if (!rear) surveyPanel(surface, 0.018, width - 0.018, concreteY, concreteY + 0.26, paleBand, 0.024);
    if (balcony) {
      boxOnWall(wall, width / 2, y + 0.02, 0.47, width - 0.36, 0.21, 1.0, paleBand);
      surveyPanel(surface, 0.22, width - 0.22, y + 0.89, y + 0.96, frame, 0.96);
      for (let u = 0.24; u < width - 0.22; u += 0.28) {
        surveyPanel(wall, u, u + 0.027, y + 0.05, y + 0.95, frame, 0.96);
      }
    }
    for (let i = 0; i < bays; i++) {
      const u = bay * (i + 0.5), half = Math.min(bay * (tall ? 0.18 : 0.41), 1.42);
      const windowBottom = y + (groundFloor ? 0.21 : tall ? 1.23 : 0.48);
      const windowTop = Math.min(y + (groundFloor ? 3.11 : tall ? 2.75 : 2.98), high - 0.16);
      surveyWindow(wall, u - half, u + half, windowBottom, windowTop,
        { color: glazing[(i + level * 3) % glazing.length], frame, columns: tall ? 1 : 2, rows: groundFloor || rear ? 3 : 2 });
    }
    if (groundFloor) break;
  }
  if (groundFloor && width > 8 && width < 16 && streetFace) {
    surveyLabel(wall, width * 0.17, width * 0.83, base + 3.28, base + 3.98, 'Albert Heijn', '#3a4b51', '#75c9f6');
  }
  if (!rear) surveyPanel(surface, 0.018, width - 0.018, high - 0.22, high - 0.06, paleBand, 0.024);
}

function createMaalderij(_footprints, site) {
  const { ground, outline } = VILLAGE_SKYLINE_SURVEYS[site.id];
  const roof = 0x6b6b64;
  const part = (style, plan, low, high, color = brownBrick, roofColor = roof) =>
    prism(plan, ground + low, ground + high, ground, color, roofColor, style);
  const buildings = [
    prism(outline[0], ground, ground + 4.25, ground, brownBrick, roof, 'retail', outline),
    part('west-wing', millPlan(-39.6, 4.8, -6.8, 23.3), 4.25, 15.0),
    part('west-crown', millPlan(-37.2, 7.1, -6.96, 20.9), 15.0, 18.1, silver),
    part('east-wing', millPlan(0.0, 4.35, 13.0, 34.0), 4.25, 14.35, 0x81584a),
    part('tower', millPlan(-6.76, 0.08, 0.0, 24.4), 4.25, 28.0),
    part('crown', millPlan(-6.76, 0.08, 0.0, 20.05), 28.0, 32.0, silver),
    part('stair', millPlan(-6.88, -0.06, 0.08, 0.77), 2.85, 32.0, silver),
    part('rear', rearPlan, 4.25, 7.1, 0x696861),
    part('service', millPlan(-59.4, 46.6, -40.6, 59.9), 4.25, 6.2, 0x6f736a),
    part('service', millPlan(-9.8, 50.3, 10.45, 61.15), 4.25, 6.9, 0x676b64),
  ];
  return createSurveyLandmark(site, buildings, maalderijFacade, ({ group, trim, colliders }) => {
    const roofBatch = new CivicBatch();
    const roofY = ground + 7.07, ridgeY = ground + 9.15;
    const left = -57, right = 11.4, start = 34, end = 50.1, middle = (start + end) / 2;
    const p = (u, v, y) => { const [x, z] = rearPoint(u, v); return [x, y, z]; };
    roofBatch.polygon([[p(left, start, roofY), p(right, start, roofY), p(right, middle, ridgeY), p(left, middle, ridgeY)]], 0x4c5050);
    roofBatch.polygon([[p(left, middle, ridgeY), p(right, middle, ridgeY), p(right, end, roofY), p(left, end, roofY)]], 0x515656);
    roofBatch.polygon([[p(left, start, roofY), p(left, middle, ridgeY), p(left, end, roofY)]], 0x696861);
    roofBatch.polygon([[p(right, end, roofY), p(right, middle, ridgeY), p(right, start, roofY)]], 0x696861);
    group.add(roofBatch.mesh());
    for (let v = start + 1.25; v < end - 1; v += 2.05) {
      for (const u of [-40.2, -5.6]) {
        const [x, z] = rearPoint(u, v);
        const y = roofY + (ridgeY - roofY) * (1 - Math.abs(v - middle) / (middle - start));
        const pitch = Math.atan2(ridgeY - roofY, middle - start) * (v < middle ? 1 : -1);
        trim.solid(new THREE.BoxGeometry(28.1, 0.12, 1.62).rotateX(pitch)
          .rotateY(-Math.atan2(millU[1] + 0.115 * millV[1], millU[0] + 0.115 * millV[0]))
          .translate(x, y + 0.1, z), 0x3e4b50);
      }
    }
    for (const building of buildings.slice(1)) {
      const ring = building.points.slice(0, 4);
      const outer = ring.map(([x, , z]) => ({ x, z }));
      colliders.push({
        minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
        minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
        minY: ring[0][1], maxY: building.style === 'rear' ? ridgeY : building.points.at(-1)[1],
        polygon: { outer, holes: [] },
      });
    }
  });
}

function clockDial(wall, y, radius, dial, marks) {
  return addRoundClock(wall.shell, (u, v, d) => wall.point(wall.width / 2 + u, y + v, 0.064 + d),
    radius, dial, marks);
}

function createWekeromChurch(_footprints, site) {
  const survey = VILLAGE_SKYLINE_SURVEYS[site.id], clocks = [];
  const { ground } = survey;
  const west = [[3064.98,-7396.98], [3065.48,-7397.13], [3064.17,-7401.65], [3063.66,-7401.50]];
  const east = [[3067.82,-7398.77], [3068.2,-7399.12], [3066.94,-7402.23], [3066.41,-7402.08]];
  const brick = 0x9d7459;
  const towers = [[west, 14.05], [east, 13.55]].map(([ring, top]) =>
    prism(ring, ground, top, ground, brick, 0x747266, 'tower', [ring]));
  return createSurveyLandmark(site,
    [{ ...survey, wallColor: brick, roofColor: 0x383b3a }, ...towers], wall => {
      const { width, base, low, high, building, buildingIndex, normal, shell } = wall;
      if (building.style === 'tower') {
        if (width > 3 && buildingIndex === 1 && Math.abs(normal.x) > 0.5) {
          clocks.push(clockDial(wall, 7.65, 0.72, 0x536961, 0xd8cfaa));
        }
        surveyPanel({ ...wall, trim: shell }, 0.016, width - 0.016, high - 0.12, high - 0.015, 0x6c695d, 0.025);
        return width > 2.0 ? 0xa68165 : brick;
      }
      if (width > 8 && high > base + 4.5) {
        for (let u = 1.0; u + 1.27 < width; u += 3.18) {
          surveyWindow(wall, u, u + 1.27, base + 2.03, base + 4.8,
            { color: glazing[1], frame: 0xadb0a1, columns: 3, rows: 4 });
        }
      } else if (width > 2.25 && low < base + 0.1) {
        surveyWindow(wall, width * 0.29, width * 0.71, base + 0.18, Math.min(base + 2.62, high - 0.15),
          { color: 0x526262, frame: 0x848977, columns: 2, rows: 3 });
      }
      return brick;
    }, ({ group }) => {
      addClockDetails(group, clocks);
      const top = new CivicBatch(), x = 3064.15, z = -7400.20;
      top.solid(new THREE.CylinderGeometry(0.038, 0.038, 0.92, 8).translate(x, 14.43, z), 0x585449);
      top.solid(new THREE.BoxGeometry(0.56, 0.075, 0.07).translate(x, 14.77, z), 0xa38a57);
      top.solid(new THREE.BoxGeometry(2.8, 0.21, 0.23).rotateY(0.52).translate(3065.37, 12.86, -7400.28), 0x494943);
      const bell = [[0.06, 0.57], [0.24, 0.51], [0.25, 0.32], [0.31, 0.10], [0.39, 0.05]]
        .reverse().map(([r, y]) => new THREE.Vector2(r, y));
      top.solid(new THREE.LatheGeometry(bell, 12).translate(3065.37, 12.16, -7400.28), 0x675542);
      group.add(top.mesh());
    });
}

function lancet(wall, u, width, low, height, brick) {
  const shoulder = low + height * 0.73;
  if (!surveyOpeningFits(wall, u - width / 2, u + width / 2, low, shoulder)) return;
  const window = (w, s, t, depth) => [
    wall.point(u - w / 2, s, depth), wall.point(u + w / 2, s, depth),
    wall.point(u + w / 2, shoulder, depth), wall.point(u + w * 0.34, shoulder + (t - shoulder) * 0.49, depth),
    wall.point(u, t, depth), wall.point(u - w * 0.34, shoulder + (t - shoulder) * 0.49, depth),
    wall.point(u - w / 2, shoulder, depth),
  ];
  wall.trim.polygon([window(width + 0.22, low - 0.085, low + height + 0.12, 0.035)], brick);
  wall.trim.polygon([window(width, low, low + height, 0.049)], 0x394142);
  surveyPanel(wall, u - 0.026, u + 0.026, low, low + height * 0.9, 0x857c6b, 0.061);
  surveyPanel(wall, u - width * 0.49, u + width * 0.49, shoulder - 0.30, shoulder - 0.27, 0x857c6b, 0.061);
}

function createOtterloChurch(_footprints, site) {
  const survey = VILLAGE_SKYLINE_SURVEYS[site.id], clocks = [];
  const { ground } = survey;
  const brick = 0x916b54, slate = 0x4c5657, eaves = 21.82;
  const shaft = [[6965.80,-6102.45], [6969.49,-6102.51], [6969.43,-6099.18], [6965.76,-6099.13]];
  const tower = prism(shaft, ground, eaves, ground, brick, slate, 'tower', [shaft]);
  return createSurveyLandmark(site,
    [{ ...survey, wallColor: brick, roofColor: slate }, tower], wall => {
      const { base, low, high, width, building, shell } = wall;
      if (building.style === 'tower') {
        clocks.push(clockDial(wall, 20.35, 0.55, 0x483d31, 0xcbb075));
        for (const shift of [-0.43, 0.43]) lancet(wall, width / 2 + shift, 0.47, 17.4, 2.03, 0xa98567);
        for (let i = 0; i < 6; i++) {
          const u = width * (i + 0.5) / 6;
          surveyPanel({ ...wall, trim: shell }, u - 0.083, u + 0.083, 14.97, 15.48, 0x9b7a63, 0.06);
        }
        surveyPanel({ ...wall, trim: shell }, 0.03, width - 0.03, 15.43, 15.62, 0xa17e63, 0.075);
        return brick;
      }
      if (low < base + 0.2 && width > 2.3 && high > base + 4.05) {
        const count = Math.max(1, Math.round(width / 4.55));
        for (let i = 0; i < count; i++) {
          const u = width * (i + 0.51) / count;
          const tall = (wall.a.x + wall.b.x) / 2 > 6983;
          lancet(wall, u, tall ? 0.89 : 0.65, base + 1.78, tall ? 3.25 : 2.34, 0xa17c5e);
        }
      }
      return brick;
    }, ({ group, colliders }) => {
      addClockDetails(group, clocks);
      const roof = new CivicBatch(), x = 6967.60, z = -6100.82, tip = 32.10;
      const ring = (radius, y) => Array.from({ length: 4 }, (_, i) => {
        const a = Math.PI / 4 + i * Math.PI / 2;
        return [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius];
      });
      const lower = ring(2.64, eaves), upper = ring(1.45, 23.13);
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        roof.quad(lower[i], upper[i], upper[next], lower[next], 0x606664);
        const mid = upper[i].map((value, axis) => (value + upper[next][axis]) / 2);
        roof.triangle(upper[i], [x, tip, z], mid, [0x464e52, 0x51595c, 0x4a5052, 0x525b5e][i]);
        roof.triangle(mid, [x, tip, z], upper[next], [0x4b5558, 0x4d565a, 0x464d4e, 0x575e61][i]);
      }
      roof.solid(new THREE.CylinderGeometry(0.033, 0.033, 0.70, 8).translate(x, tip + 0.29, z), 0x483e32);
      roof.solid(new THREE.SphereGeometry(0.105, 8, 6).translate(x, tip + 0.26, z), 0x86694a);
      group.add(roof.mesh());
      colliders.at(-1).maxY = tip;
    });
}

export const EDE_VILLAGE_SKYLINE_LANDMARK_FACTORIES = {
  'de-maalderij-wekerom': createMaalderij,
  'hervormde-kerk-wekerom': createWekeromChurch,
  'oude-kerk-otterlo': createOtterloChurch,
};
