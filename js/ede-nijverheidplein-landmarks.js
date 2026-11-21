import * as THREE from 'three/webgpu';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { getTerrain, terrainHeightAt } from './terrain.js';
import { EDE_NIJVERHEIDPLEIN_LANDMARKS, NIJVERHEIDPLEIN_SURVEYS } from './ede-nijverheidplein-survey.js';

export { EDE_NIJVERHEIDPLEIN_LANDMARKS };

const cream = 0xe4ded0;
const blue = 0x24496f;
const creamFrame = 0xd6cfba;
const darkGlass = 0x49616a;
const greenDoor = 0x273b35;
const brickPlinth = 0x59433e;
const zinc = 0x999d97;

function ledge(wall, from, to, bottom, top, depth, color) {
  const [x, y, z] = wall.point((from + to) / 2, (bottom + top) / 2, depth / 2);
  wall.trim.solid(new THREE.BoxGeometry(to - from, top - bottom, depth + 0.03)
    .rotateY(Math.atan2(wall.normal.x, wall.normal.z)).translate(x, y, z), color);
}

function masonryCourses(wall, height, color) {
  const course = 0.156;
  for (let y = wall.base + course; y < height; y += course) {
    surveyPanel(wall, 0, wall.width, y, y + 0.012, color, 0.012);
  }
}

function railing(wall, start, end, nearHeight, farHeight, depth) {
  const a = wall.point(start, nearHeight, depth), b = wall.point(end, farHeight, depth);
  const direction = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const axis = direction.clone().normalize();
  for (const height of [0.16, 0.94]) {
    const rail = new THREE.CylinderGeometry(0.023, 0.023, direction.length(), 6);
    rail.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis));
    rail.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + height, (a[2] + b[2]) / 2);
    wall.trim.solid(rail, zinc);
  }
  const count = Math.ceil((end - start) / 0.24);
  for (let i = 0; i <= count; i++) {
    const progress = i / count;
    const size = i % 5 ? 0.018 : 0.035;
    const [x, y, z] = wall.point(start + (end - start) * progress,
      nearHeight + (farHeight - nearHeight) * progress + 0.47, depth);
    wall.trim.solid(new THREE.BoxGeometry(size, 0.94, size).translate(x, y, z), zinc);
  }
}

function accessPlatform(wall, id, from, to, inside, outside, height) {
  const position = (u, depth) => {
    const [x, , z] = wall.point(u, 0, depth);
    return { x, z };
  };
  return {
    id, holes: [], outer: [position(from, inside), position(to, inside),
      position(to, outside), position(from, outside)],
    height(x, z) {
      return height((x - wall.a.x) * wall.normal.z - (z - wall.a.z) * wall.normal.x);
    },
  };
}

function meerpaalRamp(wall, platforms) {
  const start = 0.34, end = wall.width - 0.35, depth = 3.65, width = 1.35;
  const [x, , z] = wall.point(start, wall.base, depth);
  const low = getTerrain() ? terrainHeightAt(x, z) + 0.12 : wall.base + 0.22;
  const top = -5.20;
  const rises = [[start, low], [start + 1.4, low], [end - 2.2, top], [end, top]];
  const [ax, , az] = wall.point(end, top, depth);
  const foot = getTerrain() ? Math.min(low, terrainHeightAt(ax, az)) - 0.10 : wall.base - 0.10;
  for (let i = 1; i < rises.length; i++) {
    const [left, ly] = rises[i - 1], [right, ry] = rises[i];
    const a = wall.point(left, ly, depth), b = wall.point(right, ry, depth);
    const c = wall.point(right, ry, depth - width), d = wall.point(left, ly, depth - width);
    wall.trim.polygon([[a, b, c, d]], 0x8b8274);
    platforms.push(accessPlatform(wall, `meerpaal-ramp-${i}`, left, right, depth - width, depth,
      u => ly + (ry - ly) * (u - left) / (right - left)));
    wall.trim.quad(a, [a[0], foot, a[2]], [b[0], foot, b[2]], b, 0x736654);
    wall.trim.quad(d, c, [c[0], foot, c[2]], [d[0], foot, d[2]], 0x736654);
    railing(wall, left, right, ly, ry, depth);
  }
  ledge(wall, 11.6, end, top - 0.19, top, depth - width, 0x8b8274);
  platforms.push(accessPlatform(wall, 'meerpaal-landing', 11.6, end, 0, depth - width, () => top));
  const upper = 11.6, lower = 7.9, steps = 12;
  const step = (upper - lower) / steps;
  const stairHeight = i => low + (top - low) * ((i + 1) / steps);
  for (let i = 0; i < steps; i++) {
    const high = stairHeight(i);
    ledge(wall, lower + i * step, lower + (i + 1) * step, low - 0.08, high, 1.72, 0x777064);
  }
  platforms.push(accessPlatform(wall, 'meerpaal-steps', lower, upper, 0, 1.72,
    u => stairHeight(Math.min(steps - 1, Math.max(0, Math.floor((u - lower) / step))))));
  railing(wall, lower, upper, low, top, 1.72);
  railing(wall, upper, end - 2.2, top, top, 1.72);
}

function meerpaalWindow(wall, from, to, bottom, columns = 1) {
  if (surveyWindow(wall, from, to, bottom, -2.72, { color: darkGlass, frame: creamFrame, columns })) {
    surveyPanel(wall, from, to, -3.19, -2.70, blue, 0.055);
    surveyPanel(wall, from + 0.045, to - 0.045, -3.10, -2.77, 0x3c484c, 0.061, 0.75);
    ledge(wall, from - 0.045, to + 0.045, bottom - 0.09, bottom + 0.01, 0.11, 0xb5ac98);
  }
}

// Industrielaan entrance and fascia from the photographed street elevation.
// https://www.edestad.nl/lokaal/maatschappelijk/749454/jeugd-moeilijk-te-bereiken-voor-buurt-en-dorpshuizen
function decorateMeerpaal(wall) {
  if (wall.low > wall.base + 0.1) return;
  const { faceIndex, width } = wall;
  if (width > 1.5 || faceIndex === 15) {
    masonryCourses(wall, -2.74, 0xa69477);
    ledge(wall, 0, width, -2.72, -2.09, 0.19, blue);
    ledge(wall, 0, width, -2.10, -2.046, 0.23, 0xc0beb1);
  }
  if (faceIndex === 9) {
    meerpaalWindow(wall, 0.39, 2.89, -5.03);
    surveyLabel(wall, 3.31, 8.9, -3.60, -2.73, 'de meerpaal', 'transparent', '#e2e2d8');
    meerpaalWindow(wall, 9.18, 11.91, -5.18, 2);
    surveyWindow(wall, 12.13, 14.08, -5.18, -3.08, { frame: blue, color: 0x263b48, columns: 2 });
    for (const [from, to] of [[14.28, 16.15], [16.29, 18.11], [18.25, 19.78]]) {
      meerpaalWindow(wall, from, to, -5.18);
      surveyPanel(wall, from, to, -4.98, -4.79, blue, 0.065);
    }
  } else if (faceIndex === 14 || faceIndex === 5 || faceIndex === 1 || faceIndex === 13 || faceIndex === 3) {
    const count = Math.round(width / 4.25);
    for (let i = 0; i < count; i++) {
      const cellWidth = width / count;
      const left = i * cellWidth + 0.43, right = (i + 1) * cellWidth - 0.43;
      meerpaalWindow(wall, left, right, -5.07, 2);
      surveyWindow(wall, left + 0.19, right - 0.19, -7.18, -6.33, { frame: creamFrame, columns: 2 });
    }
  }
}

// Projecting front bays and their mirrored entrance panels face the square.
// https://www.funda.nl/detail/koop/ede/huis-nijverheidplein-7/44590364/
// https://www.pararius.nl/huis-te-koop/ede/fb7d94d5/nijverheidplein
const terraceFaces = {
  7: { bay: 6, entry: 4, garage: 15, side: 18 },
  9: { bay: 3, entry: 1 },
  11: { bay: 2, entry: 4 },
  13: { bay: 2, entry: 15, garage: 16, side: 14 },
};

function terraceWindow(wall, left, right, low, high, columns, transom = false) {
  if (!surveyWindow(wall, left, right, low, high, { frame: cream, color: darkGlass, columns })) return;
  if (transom) surveyPanel(wall, left, right, high - 0.34, high - 0.27, cream, 0.057);
  ledge(wall, left - 0.055, right + 0.055, low - 0.065, low + 0.01, 0.12, 0xa9a08f);
}

function decorateTerrace(wall) {
  const { building, faceIndex, width, low, high, base, normal } = wall;
  const { bay, entry, garage, side } = terraceFaces[building.address];
  if (faceIndex === garage) {
    surveyWindow(wall, 0.15, width - 0.15, base + 0.08, high - 0.58, { frame: cream, color: greenDoor });
    ledge(wall, 0, width, high - 0.40, high - 0.18, 0.25, cream);
    return;
  }
  if (faceIndex === bay || faceIndex === entry || faceIndex === side) {
    masonryCourses(wall, Math.min(high - 0.37, base + 5.4), 0x9c7166);
    surveyPanel(wall, 0, width, base, base + 0.76, brickPlinth, 0.019);
    ledge(wall, 0, width, high - 0.28, high - 0.025, 0.30, cream);
    ledge(wall, 0, width, high - 0.042, high + 0.027, 0.35, 0x77736c);
    terraceWindow(wall, 0.34, width - 0.35, base + 4.04, Math.min(high - 0.29, base + 5.23), 2, true);
    if (faceIndex === bay) {
      terraceWindow(wall, 0.09, width - 0.09, base + 0.98, base + 2.84, 3, true);
      ledge(wall, -0.09, width + 0.085, base + 2.89, base + 3.06, 0.24, cream);
      ledge(wall, -0.09, width + 0.085, base + 3.06, base + 3.105, 0.29, 0x5c5a55);
    } else if (faceIndex === entry) {
      const left = building.address === 7 || building.address === 11 ? width - 1.38 : 0.17;
      surveyWindow(wall, left, left + 1.20, base + 0.12, base + 2.53,
        { frame: cream, color: greenDoor });
      surveyWindow(wall, left, left + 1.20, base + 2.57, base + 2.84,
        { frame: cream, color: darkGlass, columns: 2 });
      surveyPanel(wall, left + 0.13, left + 0.35, base + 0.30, base + 2.36, darkGlass, 0.061, 0.7);
      ledge(wall, Math.max(0, left - 0.12), Math.min(width, left + 1.41), base + 2.89, base + 3.08, 0.48, cream);
    } else if (width > 3.4) {
      terraceWindow(wall, 0.55, 1.96, base + 1.02, base + 2.67, 2, true);
    }
  } else if (normal.z > 0.85 && width > 1.35) {
    if (low <= base + 0.05 && high > base + 5.5) {
      terraceWindow(wall, 0.22, width - 0.23, base + 3.82, base + 5.23, 2);
      terraceWindow(wall, 0.23, width - 0.23, base + 0.28, base + 2.54, 2);
    } else if (low > base + 4 && high - low > 1.5) {
      terraceWindow(wall, 0.11, width - 0.11, low + 0.27, high - 0.20, 2);
    }
  }
}

function terraceRoofing(building) {
  const roofColors = {};
  for (const [index, [roof, outer]] of building.faces.entries()) {
    if (!roof) continue;
    const peak = Math.max(...outer.map(point => building.points[point][1]));
    if (peak < building.ground + 4) roofColors[index] = 0x484641;
  }
  return { ...building, roofColors };
}

function createMeerpaal(_footprints, site) {
  let entrance;
  const group = createSurveyLandmark(site, NIJVERHEIDPLEIN_SURVEYS[site.id], wall => {
    if (wall.faceIndex === 9) entrance = wall;
    return decorateMeerpaal(wall);
  }, ({ platforms }) => meerpaalRamp(entrance, platforms));
  const sign = group.children.find(child => child.material?.map);
  if (sign) sign.material.alphaTest = 0.35;
  return group;
}

export const NIJVERHEIDPLEIN_LANDMARK_FACTORIES = {
  'de-meerpaal': createMeerpaal,
  'nijverheidplein-terraces': (_footprints, site) =>
    createSurveyLandmark(site, NIJVERHEIDPLEIN_SURVEYS[site.id].map(terraceRoofing), decorateTerrace),
};
