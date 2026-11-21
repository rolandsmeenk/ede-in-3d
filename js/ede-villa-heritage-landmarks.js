import { polygonNormal, wallExtent } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { terrainHeightAt } from './terrain.js';
import { VILLA_HERITAGE_SURVEYS } from './ede-villa-heritage-survey.js';

const stucco = 0xe2ddd0, quoin = 0xcdc5b3, casing = 0xd3bf94;
const villaEntryHeight = 10.05;
const eaves = 0x292d29, sill = 0x928f7e, sash = 0x38443f, glass = 0x506164;

function villaWindow(wall, center, width, low, high, entry = false) {
  const left = center - width / 2, right = center + width / 2;
  if (!surveyOpeningFits(wall, left, right, low, high)) return;
  surveyPanel(wall, left - 0.12, right + 0.12, low - 0.1, high + 0.12, casing, 0.046);
  surveyPanel(wall, left - 0.20, right + 0.20, low - 0.14, low, sill, 0.074);
  surveyPanel(wall, left - 0.19, right + 0.19, high + 0.12, high + 0.22, quoin, 0.068);
  const transom = low + (high - low) * 0.68;
  if (entry) {
    surveyPanel(wall, left + 0.10, right - 0.10, low, transom, 0x23382e, 0.070);
    surveyPanel(wall, center - 0.028, center + 0.028, low, transom, 0x718078, 0.074);
    for (const x of [center - width * 0.21, center + width * 0.21]) {
      for (let y = low + 0.22; y + 0.20 < transom; y += 0.32) {
        wall.trim.polygon([[wall.point(x - 0.20, y + 0.15, 0.076), wall.point(x + 0.20, y + 0.15, 0.076),
          wall.point(x, y, 0.076)]], 0x5d6f63);
      }
    }
  } else {
    surveyPanel(wall, left + 0.08, right - 0.08, low, transom, sash, 0.062);
    surveyPanel(wall, left + 0.125, center - 0.035, low + 0.06, transom - 0.045, glass, 0.070, 0.55);
    surveyPanel(wall, center + 0.035, right - 0.125, low + 0.06, transom - 0.045, glass, 0.070, 0.55);
  }
  surveyPanel(wall, left + 0.08, right - 0.08, transom, high, sash, 0.062);
  surveyPanel(wall, left + 0.125, center - 0.035, transom + 0.055, high - 0.055, glass, 0.070, 0.55);
  surveyPanel(wall, center + 0.035, right - 0.125, transom + 0.055, high - 0.055, glass, 0.070, 0.55);
}

function decorateVilla(wall) {
  const { faceIndex, width, low, high } = wall;
  if (faceIndex === 71 || faceIndex === 1) {
    const front = faceIndex === 71;
    const count = 5;
    const ground = front ? 10.76 : 10.98;
    for (let i = 0; i < count; i++) {
      const center = (i + 0.5) / count * width;
      const entry = front && i === 2;
      villaWindow(wall, center, entry ? 1.68 : 1.28, entry ? villaEntryHeight : ground, 14.94, entry);
      villaWindow(wall, center, 1.28, 15.78, 18.02);
    }
    surveyPanel(wall, 0.01, width - 0.01, 18.43, 18.58, eaves, 0.10);
    for (const edge of [0, width - 0.39]) {
      surveyPanel(wall, edge, edge + 0.39, 11.20, 18.42, quoin, 0.050);
      for (let y = 11.45; y < 18.40; y += 0.32) {
        surveyPanel(wall, edge, edge + 0.39, y, y + 0.016, sill, 0.053);
      }
    }
    if (front) {
      surveyLabel(wall, width / 2 - 1.60, width / 2 + 1.60, 18.08, 18.41,
        'STERRENBERG', '#e2ddd0', '#363c37');
    }
  } else if (width > 4 && low < 10 && high > 13.8) {
    const count = Math.max(1, Math.round(width / 3.25));
    for (let i = 0; i < count; i++) {
      villaWindow(wall, (i + 0.5) / count * width, 1.15, 11.15, Math.min(14.09, high - 0.30));
    }
  }
  return low > 14 && high > 20.6 && faceIndex !== 1 && faceIndex !== 71 ? 0x534b47 : stucco;
}

function finishVilla({ trim, platforms }) {
  const building = VILLA_HERITAGE_SURVEYS['villa-sterrenberg'];
  const front = building.faces[71][1].map(index => building.points[index]);
  const normal = polygonNormal(front);
  const { a, b } = wallExtent(front, normal);
  const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
  const point = (u, d, y) => [x + normal.z * u + normal.x * d, y, z - normal.x * u + normal.z * d];
  const left = -1.21, right = 1.21, landing = 1.36, stepDepth = 0.36, count = 6;
  const far = landing + stepDepth * count;
  const [footX, , footZ] = point(0, far, 0);
  const base = Math.max(villaEntryHeight - 1.45, Math.min(villaEntryHeight - 0.60, terrainHeightAt(footX, footZ)));
  const brick = 0x806257, stone = 0xa59786;

  // Tread platforms meet exactly from the pavement to the door threshold.
  for (let i = 0; i <= count; i++) {
    const outerEdge = far - i * stepDepth;
    const innerEdge = i === count ? 0 : outerEdge - stepDepth;
    const lower = base + (villaEntryHeight - base) * i / (count + 1);
    const upper = base + (villaEntryHeight - base) * (i + 1) / (count + 1);
    const surface = [point(left, innerEdge, upper), point(left, outerEdge, upper),
      point(right, outerEdge, upper), point(right, innerEdge, upper)];
    trim.quad(...surface, stone);
    trim.quad(point(left, outerEdge, lower), point(right, outerEdge, lower),
      point(right, outerEdge, upper), point(left, outerEdge, upper), brick);
    for (const side of [-1, 1]) {
      const edge = side * right;
      const outer = edge + side * 0.25;
      const nearCap = upper + 0.28, farCap = upper + (i === count ? 0.28 : 0.12);
      const cap = [point(outer, innerEdge, nearCap), point(outer, outerEdge, farCap),
        point(edge, outerEdge, farCap), point(edge, innerEdge, nearCap)];
      trim.quad(...(side === -1 ? cap : cap.reverse()), brick);
      const cheek = [point(outer, innerEdge, nearCap), point(outer, innerEdge, base - 0.12),
        point(outer, outerEdge, base - 0.12), point(outer, outerEdge, farCap)];
      trim.quad(...(side === -1 ? cheek : cheek.reverse()), brick);
      const inside = [point(edge, outerEdge, farCap), point(edge, outerEdge, upper),
        point(edge, innerEdge, upper), point(edge, innerEdge, nearCap)];
      trim.quad(...(side === -1 ? inside : inside.reverse()), brick);
    }
    platforms.push({ id: `villa-sterrenberg-entry-${i}`, outer: surface.map(([x, , z]) => ({ x, z })),
      holes: [], height: () => upper });
  }
}

const smoke = 0x76605d, gold = 0xbfa254, concrete = 0xa7a9a3, penthouse = 0x333e48;

function decorateApartments(wall) {
  const { a, b, normal, width, low, high } = wall;
  const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
  const south = z > 2226 || x < 21 || x > 48;
  const darkBay = south && low > 8.3 && high > 11.6 && high - low < 3.35;
  if (width < 1.05 || high - low < 1.35 || Math.abs(normal.y) > 0.035) return;
  const levels = [-1.8, 1.0, 3.78, 6.65, 9.48, 12.08];
  const count = Math.max(1, Math.round(width / (darkBay ? 1.12 : south ? 2.2 : 2.85)));
  for (let i = 0; i < count; i++) {
    const center = (i + 0.5) * width / count;
    const half = Math.min(width / count * 0.37, south && !darkBay ? 0.88 : 0.55);
    const bayInset = Math.max(0.15, width / count * 0.10);
    const bayLeft = i * width / count + bayInset;
    const bayRight = (i + 1) * width / count - bayInset;
    const upperBay = z > 2227 && x > 25 && x < 48 && normal.z > 0.35
      && surveyOpeningFits(wall, bayLeft, bayRight, 11.80, 14.35);
    if (upperBay) {
      surveyPanel(wall, bayLeft, bayRight, 11.80, 14.35, penthouse, 0.031);
    }
    for (const y of levels) {
      if (y + 1.65 > high || y < low) continue;
      surveyWindow(wall, center - half, center + half, y, y + 1.65,
        { color: 0x586573, frame: darkBay || (upperBay && y > 11.8) ? 0x252d35 : 0xc7c0ad, columns: darkBay ? 1 : 2, rows: 1 });
    }
  }
  return darkBay ? penthouse : undefined;
}

// South-side railing traces follow the outer edges of the surveyed terraces.
const terraces = [
  [-0.12, [[14.8,2233.2], [18.8,2238.3], [23.2,2242.9], [32.8,2244.2], [42.1,2245.0],
    [47.8,2241.9], [53.0,2238.0], [55.7,2229.9], [57.8,2222.3], [60.2,2214.1]]],
  [2.65, [[17.1,2233.6], [21.2,2237.8], [25.0,2241.4], [33.0,2242.3], [42.1,2243.4],
    [47.6,2240.1], [51.7,2236.9], [54.3,2229.2], [56.4,2221.8], [59.0,2213.1]]],
  [5.45, [[18.6,2232.7], [22.0,2236.6], [25.5,2239.0], [33.1,2240.5], [41.4,2241.1],
    [46.7,2238.0], [50.5,2234.7], [53.1,2228.1], [55.4,2221.1], [57.9,2212.5]]],
  [8.30, [[20.6,2231.9], [23.0,2234.4], [26.3,2236.7], [33.9,2239.2], [41.6,2239.2],
    [45.7,2236.8], [49.5,2233.1], [51.7,2227.7], [54.0,2220.1], [56.8,2211.8]]],
  [11.12, [[26.5,2236.7], [33.9,2239.3], [41.2,2238.2], [45.1,2236.5], [48.3,2233.2],
    [50.4,2228.7], [52.1,2222.9]]],
];

function finishApartments({ trim }) {
  function ribbon(path, yLow, yHigh, color, lip = 0) {
    const point = ([x, z], y, inset) => {
      const distance = Math.hypot(37.3 - x, 2223 - z);
      return [x + inset * (37.3 - x) / distance, y, z + inset * (2223 - z) / distance];
    };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const face = [point(a, yLow, 0), point(b, yLow, 0), point(b, yHigh, lip), point(a, yHigh, lip)];
      trim.polygon([face], color);
    }
  }
  for (const [height, path] of terraces) {
    ribbon(path, height - 0.31, height + 0.16, concrete, 0.12);
    ribbon(path, height + 0.16, height + 0.80, smoke, 0.22);
    ribbon(path, height + 0.79, height + 0.84, gold, 0.025);
  }

}

export const VILLA_HERITAGE_FACTORIES = {
  oranjestaete: (_footprints, site) => createSurveyLandmark(site, [VILLA_HERITAGE_SURVEYS[site.id]],
    decorateApartments, finishApartments),
  'villa-sterrenberg': (_footprints, site) => createSurveyLandmark(site, [VILLA_HERITAGE_SURVEYS[site.id]],
    decorateVilla, finishVilla),
};
