import { CivicBatch, polygonNormal } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { SCHOOL_SURVEYS } from './ede-school-survey.js';
import { ENKA_PORTAL_SOFFIT } from './ede-grade.js';

export { EDE_SCHOOL_LANDMARKS } from './ede-school-survey.js';

const glass = 0x42535b, darkFrame = 0x272b2b, concrete = 0xbcb5a7;
const enkaSoffit = 6.12;

function bays(wall, pitch, draw, from = 0, to = wall.width) {
  const count = Math.max(1, Math.round((to - from) / pitch));
  const step = (to - from) / count;
  for (let i = 0; i < count; i++) draw(from + i * step, from + (i + 1) * step, i);
}

function glazedBand(wall, pitch, lo, hi, trim, inset = 0.04, from = 0.08, to = wall.width - 0.08) {
  if (hi <= lo || to - from < 0.4) return;
  bays(wall, pitch, (a, b, index) => {
    surveyWindow(wall, a + inset, b - inset, lo, hi, {
      frame: trim, color: index % 3 === 1 ? 0x495a63 : glass,
    });
  }, from, to);
}

function dulonFacade(wall) {
  const { faceIndex, width, low, high, base } = wall;
  if (width < 3 || high - low < 4) return;
  const bronze = 0xa48a69;
  if ([19, 40, 181].includes(faceIndex)) {
    glazedBand(wall, 1.45, low + 0.18, high - 0.35, darkFrame);
    return bronze;
  }
  if (low > base + 0.05) return;
  const main = faceIndex === 202;
  const roadSide = faceIndex === 125;
  const tall = main ? [[14.2, 22.5], [63.2, 71.25]] : roadSide ? [[19.8, 27.4]] : [];
  const slots = [0.24, ...tall.flat(), width - 0.24];
  glazedBand(wall, 1.45, base + 0.42, base + 3.2, darkFrame, 0.035, 0.24, width - 0.24);
  for (let i = 0; i < slots.length; i += 2) {
    for (const [lo, hi] of [[base + 4.65, base + 6.38], [base + 8.05, base + 9.7]]) {
      glazedBand(wall, 1.45, lo, hi, darkFrame, 0.035, slots[i], slots[i + 1]);
    }
  }
  for (const [from, to] of tall) {
    glazedBand(wall, 1.45, base + 4.65, base + 9.7, darkFrame, 0.035, from, to);
  }
  if (main || roadSide) {
    const u = main ? 46.2 : 13.7, y = base + (main ? 2.2 : 8.2);
    const logoColor = main ? 0xe5d7bb : darkFrame;
    const logoRing = radius => Array.from({ length: 24 }, (_, i) => {
      const angle = i * Math.PI * 2 / 24;
      const edge = radius > 0.9 && i % 3 === 1 ? radius * 0.92 : radius;
      return wall.point(u + edge * Math.cos(angle), y + edge * Math.sin(angle), 0.08);
    });
    wall.trim.polygon([logoRing(1.07), logoRing(0.7).reverse()], logoColor);
    wall.trim.polygon([logoRing(0.48), logoRing(0.25).reverse()], logoColor);
    surveyLabel(wall, u + 1.6, u + 6.35, y - 0.52, y + 0.5,
      'Dulon', main ? '#2c2927' : '#a48a69', main ? '#e5d7bb' : '#272b2b');
  }
  for (const [lo, hi] of [[base + 3.25, base + 4.56], [base + 6.45, base + 7.96], [base + 9.76, high - 0.1]]) {
    for (let u = 0.33; u < width - 0.12; u += 0.52) {
      if (lo < base + 6 || !tall.some(([from, to]) => u > from && u < to)) {
        surveyPanel(wall, u, u + 0.028, lo, hi, 0x786451, 0.019);
      }
    }
  }
  return bronze;
}

function insideRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, , az] = ring[i], [bx, , bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
  }
  return inside;
}

// Six photographed rooftop fields, measured in metres along and across Dulon's west façade.
const dulonSolarFields = [
  [1.9, 31.6, 1.9, 16.8], [32.1, 64.8, 2.1, 13.5], [65.1, 102.9, 2.0, 15.4],
  [17.2, 31.5, 39.5, 67.1], [51.9, 66.7, 40.0, 67.1], [90.9, 103.4, 48.9, 76.0],
];

function dulonSolar({ group }) {
  const batch = new CivicBatch();
  const [building] = SCHOOL_SURVEYS['dulon-college'];
  const roof = building.faces.filter(([isRoof]) => isRoof).map(([, ...indices]) => {
    const rings = indices.map(ring => ring.map(index => building.points[index]));
    return { rings, normal: polygonNormal(rings[0]) };
  }).filter(({ rings, normal }) => normal.y > 0.97 && rings[0][0][1] > 4.1 && rings[0][0][1] < 5.6);
  for (const [start, end, near, far] of dulonSolarFields) {
    for (let v = start; v + 1.62 < end; v += 1.88) {
      for (let u = near; u + 1.03 < far; u += 1.15) {
        const corners = [[u, v], [u, v + 1.62], [u + 1.03, v + 1.62], [u + 1.03, v]]
          .map(([across, along]) => [-644.04 + 0.987 * across + 0.162 * along, 2751.8 - 0.162 * across + 0.987 * along]);
        const plane = roof.find(({ rings }) => corners.every(([x, z]) => insideRing(x, z, rings[0])
          && !rings.slice(1).some(ring => insideRing(x, z, ring))));
        if (!plane) continue;
        const { normal, rings: [[[x0, y0, z0]]] } = plane;
        const vertices = corners.map(([x, z], index) => [x,
          y0 - (normal.x * (x - x0) + normal.z * (z - z0)) / normal.y + (index < 2 ? 0.17 : 0.27), z]);
        batch.quad(...vertices, 0x2d3b48, 0.36);
      }
    }
  }
  if (batch.vertices.length) {
    const panels = batch.mesh();
    panels.name = 'Dulon rooftop photovoltaic fields';
    panels.castShadow = false;
    group.add(panels);
  }
}

const enkaBridgeFaces = new Set([0, 5, 6, 7, 9, 10, 24, 25, 26, 27, 34, 49, 50, 51, 60, 61, 62]);
const enkaBridgePlans = [
  [[516.3, 2413.89], [504.87, 2410.01], [520.80, 2400.02], [509.37, 2396.16]],
  [[485.28, 2467.52], [495.92, 2471.17], [479.96, 2484.10], [490.57, 2487.37]],
];

function enkaShell() {
  const [source] = SCHOOL_SURVEYS['de-ontdekking'];
  const points = [...source.points];
  const faces = source.faces.map(([roof, ...rings], index) => {
    if (!enkaBridgeFaces.has(index)) return source.faces[index];
    return [roof, ...rings.map(ring => ring.map((idx, i) => {
      const point = points[idx];
      if (point[1] >= enkaSoffit) return idx;
      // Place each crossing on the surveyed wall plane, keeping its slight seam angles.
      const previous = points[ring[(i + ring.length - 1) % ring.length]];
      const next = points[ring[(i + 1) % ring.length]];
      const top = previous[1] > enkaSoffit ? previous : next[1] > enkaSoffit ? next : point;
      const t = top === point ? 0 : (enkaSoffit - point[1]) / (top[1] - point[1]);
      return points.push([point[0] + (top[0] - point[0]) * t, enkaSoffit,
        point[2] + (top[2] - point[2]) * t]) - 1;
    }))];
  });
  const outline = [[
    [480.24, 2465.82], [499.56, 2408.49], [499.87, 2408.31], [504.87, 2410.01],
    [516.3, 2413.89], [520.09, 2415.17], [500.81, 2472.84], [497.09, 2471.56],
    [495.92, 2471.17], [485.28, 2467.52], [484.17, 2467.15],
  ]];
  return [{ ...source, points, faces, outline }];
}

function enkaFacade(wall) {
  const { faceIndex, width, high } = wall;
  const steel = 0x928d81;
  if ([4, 17].includes(faceIndex)) {
    bays(wall, 3.03, (a, b, index) => {
      const windows = { color: index % 4 === 1 ? 0x526775 : glass, frame: steel, columns: 3, rows: 2 };
      if (faceIndex === 17 && index === 6) {
        surveyWindow(wall, a + 0.62, b - 0.62, -0.05, 2.55, { frame: 0x8c5842, columns: 2 });
      } else {
        surveyWindow(wall, a + 0.13, b - 0.13, 0.38, 2.56, windows);
      }
      surveyWindow(wall, a + 0.13, b - 0.13, 3.82, 6.07, windows);
      // The three columns continue through two blind rows between the glazed floors.
      bays(wall, (b - a - 0.26) / 3, (left, right) => {
        surveyPanel(wall, left + 0.027, right - 0.027, 2.67, 3.15, 0xc8c4b9, 0.038);
        surveyPanel(wall, left + 0.027, right - 0.027, 3.20, 3.68, 0xc8c4b9, 0.038);
      }, a + 0.13, b - 0.13);
      surveyPanel(wall, a + 0.03, a + 0.11, 0.18, 6.24, concrete, 0.07);
    });
    surveyPanel(wall, 0.09, width - 0.09, 6.18, 6.48, 0xbeb8ab, 0.09);
    for (const y of [6.8, 7.06, 7.34]) {
      surveyPanel(wall, 0.1, width - 0.1, y, y + 0.047, 0x5b7972, 0.14);
    }
    for (let u = 0.12; u < width - 0.1; u += 1.2) {
      surveyPanel(wall, u, u + 0.042, 6.51, 7.4, 0x5b7972, 0.14);
    }
    if (faceIndex === 17) {
      surveyLabel(wall, 49.3, 53.25, 6.75, 7.39, 'De Ontdekking', '#d8d5c8', '#39403d');
    }
    return 0x8e8679;
  }
  if ([13, 33, 44, 56, 58].includes(faceIndex)) {
    for (let y = 7.10; y + 0.24 < Math.min(high - 0.28, 11.45); y += 0.28) {
      for (let u = 0.08; u + 0.24 < width - 0.04; u += 0.28) {
        surveyWindow(wall, u, u + 0.24, y, y + 0.24, {
          color: 0x819394, frame: 0xa5a89e,
        });
      }
    }
    return 0xa8a398;
  }
  if ([1, 16, 30, 35, 37, 57].includes(faceIndex)) {
    glazedBand(wall, 1.32, Math.max(wall.low + 0.22, 7.02), high - 0.43, steel);
    return 0xa8a398;
  }
  if (enkaBridgeFaces.has(faceIndex)) {
    if (width > 2.3) {
      glazedBand(wall, 1.18, 7.45, Math.min(high - 0.4, 9.62), steel);
      surveyPanel(wall, 0.09, width - 0.09, 6.57, 7.38, 0xc7c3b8);
    }
    return 0x898881;
  }
  if ([11, 15, 29, 52, 54].includes(faceIndex)) {
    const brickColors = [0x52616c, 0x596a76, 0x5c6d78];
    const brickTop = Math.min(high, 6.49);
    for (let row = 0, y = wall.low + 0.10; y + 0.085 < brickTop; row++, y += 0.095) {
      for (let column = 0, u = row % 2 ? -0.118 : 0.012; u < width - 0.012; column++, u += 0.26) {
        surveyPanel(wall, Math.max(0.012, u), Math.min(width - 0.012, u + 0.25), y, y + 0.085,
          brickColors[(row + 2 * column) % brickColors.length], 0.021, 0.18);
      }
    }
    return 0x62676a;
  }
  return faceIndex === 53 ? 0x56616a : undefined;
}

function enkaBridges({ trim, colliders }) {
  const base = SCHOOL_SURVEYS['de-ontdekking'][0].ground;
  for (const [innerA, innerB, outerA, outerB] of enkaBridgePlans) {
    const lerp = (a, b, t) => a + (b - a) * t;
    const bridgePoint = (along, across, y) => [
      lerp(lerp(innerA[0], outerA[0], along), lerp(innerB[0], outerB[0], along), across),
      y,
      lerp(lerp(innerA[1], outerA[1], along), lerp(innerB[1], outerB[1], along), across),
    ];
    const bridgeFoot = (from, to, across0 = 0, across1 = 1) => [
      bridgePoint(from, across0, 0), bridgePoint(to, across0, 0),
      bridgePoint(to, across1, 0), bridgePoint(from, across1, 0),
    ];
    const addCollider = (footprint, minY, maxY) => {
      const outer = footprint.map(([x, , z]) => ({ x, z }));
      colliders.push({
        minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
        minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
        minY, maxY, polygon: { outer, holes: [] },
      });
    };
    const slab = bridgeFoot(0, 1);
    trim.polygon([slab.toReversed().map(([x, , z]) => [x, enkaSoffit, z])], 0x827b6c);
    addCollider(slab, ENKA_PORTAL_SOFFIT, 10.2);
    const portal = [[0, enkaSoffit], [0.81, enkaSoffit], [0.81, base], [0.75, base], [0.75, 3.65],
      [0.73, 4.21], [0.69, 4.49], [0.63, ENKA_PORTAL_SOFFIT], [0.15, ENKA_PORTAL_SOFFIT], [0.09, 4.48], [0.04, 4.18], [0.01, 3.53], [0, base]];
    for (const [edge, inner] of [[0.045, 0.085], [0.955, 0.915]]) {
      const outerRing = portal.map(([t, h]) => bridgePoint(t, edge, h));
      const innerRing = portal.map(([t, h]) => bridgePoint(t, inner, h));
      trim.polygon([edge > 0.5 ? outerRing : outerRing.toReversed()], 0x9d9586);
      trim.polygon([edge < 0.5 ? innerRing : innerRing.toReversed()], 0x9d9586);
      for (let i = 2; i < portal.length - 1; i++) {
        const next = i + 1;
        const side = [outerRing[i], outerRing[next], innerRing[next], innerRing[i]];
        trim.quad(...(edge > 0.5 ? side.toReversed() : side), 0x827c70);
      }
      addCollider(bridgeFoot(0.75, 0.81, Math.min(edge, inner), Math.max(edge, inner)), base, ENKA_PORTAL_SOFFIT);
    }
    const bodyPoint = (u, y) => bridgePoint(0, u, y);
    trim.quad(bodyPoint(0, base), bodyPoint(1, base), bodyPoint(1, enkaSoffit), bodyPoint(0, enkaSoffit), 0x56616a);
    for (let i = 0; i < 6; i++) {
      const left = 0.23 + i * 0.09, right = left + 0.077;
      trim.quad(bridgePoint(0.006, left, 0.18), bridgePoint(0.006, right, 0.18),
        bridgePoint(0.006, right, 5.48), bridgePoint(0.006, left, 5.48), i % 2 ? 0x44545b : 0x506368);
    }
  }
}

function lyceumFacade(wall) {
  const { faceIndex, width, low, high } = wall;
  if (width < 4.1 || high - low < 3.1 || low > 1.2) return;
  const champagne = 0xb1a088;
  if ([5, 67, 102].includes(faceIndex)) {
    glazedBand(wall, 1.45, -5.8, -3.15, champagne);
    glazedBand(wall, 1.45, -2.92, 0.03, champagne);
    return 0x9a8370;
  }
  const entranceEnd = faceIndex === 103 ? 11.6 : 0.05;
  if (faceIndex === 103) {
    glazedBand(wall, 1.4, -6.25, 0.34, champagne, 0.035, 0.15, entranceEnd);
    surveyLabel(wall, 0.62, 9.42, 0.38, 1.19, 'HET STREEK LYCEUM', '#5d503f', '#f1eade');
  }
  bays(wall, 3.02, (a, b, index) => {
    if (b - a < 0.8) return;
    for (const [lo, hi] of [[-6.12, -3.43], [-2.77, -0.1], [1.12, 3.48], [4.67, 7.12]]) {
      const left = a + (b - a) * 0.23;
      const right = b - (b - a) * 0.22;
      surveyWindow(wall, left, right, lo, hi, {
        color: index % 3 === 0 ? 0x3c545f : glass, frame: champagne,
      });
    }
    surveyPanel(wall, a + 0.095, a + 0.245, Math.max(low + 0.06, -6.45), high - 0.1,
      index % 2 === 0 ? 0xb69778 : 0xa78869, 0.083);
  }, entranceEnd, width - 0.07);
}

const schoolGreen = [0x84b63a, 0x72a92c, 0x99c54d, 0x64a328];
const colorGlass = [0xd67a27, 0xd1a32b, 0xbc5238, 0x3b8ca1];

function streekFacade(wall) {
  const { buildingIndex, faceIndex, width, low, high, base, point, trim } = wall;
  if (width < 3.3 || high - low < 2.4) return;
  const annex = buildingIndex > 0;
  const crown = annex ? base + 4.3 : 2.14;
  if (low > crown + 0.3) return;
  if (high > crown + 0.45) {
    bays(wall, 3.17, (a, b, index) => {
      const h = high - 0.035, y = crown + (index % 3) * 0.32;
      const cut = a + (b - a) * (index % 2 ? 0.6 : 0.27);
      trim.triangle(point(a, crown, 0.026), point(cut, h, 0.026), point(a, h, 0.026),
        schoolGreen[index % schoolGreen.length]);
      trim.quad(point(a, crown, 0.026), point(b, crown, 0.026), point(b, h, 0.026), point(cut, h, 0.026),
        schoolGreen[(index + 1) % schoolGreen.length]);
      if (!annex) {
        const opening = 0.8 + (index % 3) * 0.38;
        surveyWindow(wall, (a + b - opening) / 2, (a + b + opening) / 2, y + 0.5, Math.min(h - 0.3, y + 2.62), {
          color: faceIndex === 43 ? colorGlass[index % colorGlass.length] : glass, frame: darkFrame,
        });
      }
    }, 0.06, width - 0.06);
  }
  if (annex) return;
  glazedBand(wall, 2.0, 0.34, 1.69, darkFrame);
  if (faceIndex === 43) {
    glazedBand(wall, 1.45, -5.1, -0.72, darkFrame, 0.055, 4.3, width - 2.85);
    const letters = ['HET', 'STREEK', 'COLLEGE'];
    const backgrounds = ['#b13936', '#356f8d', '#d47523'];
    for (let i = 0; i < letters.length; i++) {
      surveyLabel(wall, 4.05 + i * 5.2, 9.19 + i * 5.2, -0.69, 0.27,
        letters[i], backgrounds[i], '#faf0d9');
    }
    for (const [from, to] of [[1.0, 4.05], [19.6, width - 0.85]]) {
      bays(wall, 0.64, (a, b, i) => surveyPanel(wall, a, b, -0.69, 0.27, colorGlass[i % colorGlass.length]), from, to);
    }
  } else {
    glazedBand(wall, 4.0, Math.max(base + 1.1, -5.0), -2.76, darkFrame, 0.47);
  }
}

function aeresFacade(wall) {
  const { faceIndex, width, low, high, base } = wall;
  if (width < 2.65 || high - low < 4.2 || low > base + 0.05) return;
  const stone = 0xaea294, light = 0xc3c0b9;
  const entry = faceIndex === 20;
  if (entry) {
    surveyWindow(wall, 0.39, width - 0.38, base + 0.49, base + 3.3,
      { color: 0x3c494f, frame: 0x443d37, columns: 3 });
    surveyLabel(wall, 0.28, width - 0.33, base + 3.28, base + 4.02, 'AL AMANA COLLEGE', '#dcd5c4', '#6d3452');
    surveyPanel(wall, 0.22, width - 0.24, 0.42, 3.05, light, 0.045);
    return stone;
  }
  bays(wall, 3.45, (a, b, index) => {
    const width = b - a;
    if (width < 1.15) return;
    surveyWindow(wall, a + 0.32, b - 0.15, base + 0.62, base + 2.88,
      { color: glass, frame: darkFrame, columns: 2 });
    surveyWindow(wall, a + 0.32, b - 0.15, base + 4.76, base + 7.12,
      { color: index % 3 ? 0x4c5b61 : glass, frame: darkFrame, columns: 2 });
    surveyPanel(wall, a + 0.28, b - 0.075, base + 2.94, base + 4.72, light, 0.035);
    surveyPanel(wall, a + 0.28, b - 0.075, base + 7.15, Math.min(base + 7.6, high - 0.05), light, 0.035);
    surveyPanel(wall, a + 0.08, a + 0.27, base + 0.12, Math.min(high - 0.09, base + 7.61), stone, 0.082);
  }, 0.065, width - 0.065);
}

export const SCHOOL_LANDMARK_FACTORIES = {
  'dulon-college': (_footprints, site) => createSurveyLandmark(site, SCHOOL_SURVEYS[site.id], dulonFacade, dulonSolar),
  'de-ontdekking': (_footprints, site) => createSurveyLandmark(site, enkaShell(), enkaFacade, enkaBridges),
  'het-streek-lyceum': (_footprints, site) => createSurveyLandmark(site, SCHOOL_SURVEYS[site.id], lyceumFacade),
  'het-streek-college': (_footprints, site) => createSurveyLandmark(site, SCHOOL_SURVEYS[site.id], streekFacade),
  'aeres-al-amana': (_footprints, site) => createSurveyLandmark(site, SCHOOL_SURVEYS[site.id], aeresFacade),
};
