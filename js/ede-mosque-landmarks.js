import * as THREE from 'three/webgpu';
import { CivicBatch } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';

function prism(ring, bottom, top, wallColor, roofColor, ground = bottom) {
  const n = ring.length;
  return {
    ground, wallColor, roofColor,
    outline: bottom === ground ? [ring] : [],
    points: [bottom, top].flatMap(y => ring.map(([x, z]) => [x, y, z])),
    faces: [...ring.map((_, i) => {
      const j = (i + 1) % n;
      return [0, [i, i + n, j + n, j]];
    }), [1, ring.map((_, i) => n * 2 - 1 - i)]],
  };
}

const AL_GROUND = -6.96;
const OCHRE = 0xaa804e, RUSSET = 0x904939, PATINA = 0x547571;
const DARK_ROOF = 0x545552, GLASS = 0x586864;

const alWing = [[-1881.53,1045.30],[-1851.41,1032.95],[-1848.38,1040.33],[-1855.53,1043.29],
  [-1854.82,1045.06],[-1868.89,1059],[-1874.55,1061.76],[-1875.68,1059.02],
  [-1874.86,1058.67],[-1877.48,1052.36],[-1878.44,1052.76]];
const alHall = [[-1868.89,1059],[-1854.71,1044.96],[-1840.67,1059.05],[-1854.74,1073.16]];
const alSquare = [[-1864.6,1049.2],[-1844.7,1049.2],[-1844.7,1069.1],[-1864.6,1069.1]];
const alTower = [[-1875.82,1059.08],[-1872.93,1057.89],[-1871.81,1060.61],[-1874.70,1061.80]];

function gableWindow(wall, x, width, low, shoulder, peak) {
  const a = x - width / 2, b = x + width / 2;
  surveyPanel(wall, a, b, low, shoulder, GLASS, 0.051, 0.72);
  wall.trim.triangle(wall.point(a, shoulder, 0.051), wall.point(b, shoulder, 0.051),
    wall.point(x, peak, 0.051), GLASS, 0.72);
}

function alFacade(wall) {
  const { buildingIndex, faceIndex, width, high, low, point, trim } = wall;
  if (buildingIndex === 3) {
    if (width < 2.6) return;
    surveyWindow(wall, 0.10, width - 0.10, 8.17, 10.61,
      { frame: RUSSET, color: 0xa2ac99, columns: 4 });
    for (const y of [-4.8, -0.5, 3.8]) gableWindow(wall, width / 2, 0.27, y, y + 1.85, y + 2.04);
    for (const u of [width / 2 - 0.23, width / 2 + 0.17]) {
      for (let y = -6.25; y < 7.75; y += 0.38) surveyPanel(wall, u, u + 0.06, y, y + 0.13, 0xe0bf89);
    }
  } else if (buildingIndex === 1) {
    for (let x = 0.7; x < width; x += 2.05) {
      for (let i = 0; i < 4; i++) {
        const y = -5.65 + i * 2.0;
        if ((i + Math.round((x - 0.7) / 2.05)) % 2 === 0) {
          surveyWindow(wall, x - 0.25, x + 0.25, y + 0.39, y + 1, { frame: 0x74533d, color: GLASS });
        }
        if (x + 1.0 >= width) continue;
        const diamond = [point(x + 1, y + 0.05, 0.052), point(x + 0.05, y + 1.05, 0.052),
          point(x + 1, y + 2.05, 0.052), point(x + 1.95, y + 1.05, 0.052)];
        if (x + 1.95 >= width || y + 2.05 >= high) continue;
        const inlay = [point(x + 1, y + 0.10, 0.052), point(x + 0.10, y + 1.05, 0.052),
          point(x + 1, y + 2.00, 0.052), point(x + 1.90, y + 1.05, 0.052)];
        for (let side = 0; side < 4; side++) {
          const next = (side + 1) % 4;
          trim.quad(diamond[next], diamond[side], inlay[side], inlay[next], 0x8c6344);
        }
      }
    }
  } else if (buildingIndex === 0) {
    if (faceIndex === 6) return;
    surveyPanel(wall, 0, width, high - 0.13, high, PATINA);
    if (faceIndex === 8) {
      surveyPanel(wall, 0, width, low + 0.08, high - 0.14, RUSSET, 0.036);
      surveyPanel(wall, 0.08, width - 0.08, low + 0.10, -3.31, 0x739081, 0.041);
      for (let x = width / 12; x < width; x += width / 6) {
        gableWindow(wall, x, width / 6 - 0.08, -3.20, -1.21, -0.63);
      }
      const center = width / 2;
      surveyPanel(wall, center - 1.00, center + 1.00, low + 0.05, -3.69, 0x587267, 0.065);
      surveyPanel(wall, center - 0.90, center - 0.019, low + 0.09, -3.80, 0xa54e3b, 0.074);
      surveyPanel(wall, center + 0.019, center + 0.90, low + 0.09, -3.80, 0xa54e3b, 0.074);
      for (const x of [center - 0.44, center + 0.44]) {
        surveyPanel(wall, x - 0.075, x + 0.075, -6.33, -4.33, GLASS, 0.080, 0.70);
      }
    } else if (width > 2.4) {
      const bays = Math.max(1, Math.round(width / 4.7));
      for (let i = 0; i < bays; i++) {
        const center = width * (i + 0.5) / bays;
        surveyWindow(wall, center - 0.61, center + 0.61, -2.82, -1.71, { frame: RUSSET, color: GLASS });
        surveyWindow(wall, center - 0.61, center + 0.61, -6.02, -4.98, { frame: RUSSET, color: GLASS });
      }
    }
  }
}

function alRoof({ group }) {
  const roof = new CivicBatch();
  const cap = [-1873.82, 11.15, 1059.84];
  for (let i = 0; i < 4; i++) {
    const a = alTower[i], b = alTower[(i + 1) % 4];
    roof.triangle([b[0],10.71,b[1]], [a[0],10.71,a[1]], cap, PATINA);
  }
  const [x, y, z] = cap;
  roof.solid(new THREE.CylinderGeometry(0.033, 0.035, 0.66, 8).translate(x, y + 0.33, z), 0xb9b5a1);
  for (const [offset, radius] of [[0.16,0.18],[0.39,0.13],[0.57,0.09]]) {
    roof.solid(new THREE.SphereGeometry(radius, 10, 6).translate(x, y + offset, z), 0xc3b99b);
  }
  const crescent = new THREE.Shape();
  crescent.absarc(0, 0, 0.255, 0.68, Math.PI * 2 - 0.68, false);
  crescent.absarc(0.102, 0, 0.186, Math.PI * 2 - 1.08, 1.08, true);
  crescent.closePath();
  roof.solid(new THREE.ExtrudeGeometry(crescent, { depth: 0.035, bevelEnabled: false, curveSegments: 10 })
    .rotateY(0.46).translate(x, y + 0.82, z), 0xc3b99b);

  const skylight = [[-1859.1,1059.0],[-1854.6,1054.5],[-1850.1,1059],[-1854.6,1063.5]];
  const peak = [-1854.6, 4.31, 1059.0];
  for (let i = 0; i < 4; i++) {
    const a = skylight[i], b = skylight[(i + 1) % 4];
    const corner = [a[0], 2.79, a[1]], next = [b[0], 2.79, b[1]];
    const middle = [(a[0] + b[0]) / 2, 2.79, (a[1] + b[1]) / 2];
    roof.triangle(next, corner, peak, 0x426276, 0.81);
    for (const start of [corner, middle]) {
      roof.quad(start, [start[0] + 0.10, start[1] + 0.017, start[2] - 0.08],
        [peak[0] + 0.07, peak[1] + 0.025, peak[2] - 0.07], [peak[0], peak[1] + 0.025, peak[2]], 0xc7c7ba);
    }
  }
  const panel = (u, v, y) => [-1881.53 + 0.9252 * u + 0.3793 * v, y, 1045.30 - 0.3793 * u + 0.9252 * v];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 24; column++) {
      const u = 0.8 + column * 1.27, v = 1.05 + row * 1.78;
      roof.quad(panel(u, v, -0.14), panel(u, v + 1.53, -0.08),
        panel(u + 1.19, v + 1.53, -0.08), panel(u + 1.19, v, -0.14), 0x354651, 0.45);
    }
  }
  const mesh = roof.mesh();
  mesh.name = 'Al Mouahidin minaret and roof details';
  group.add(mesh);
}

function createAlMouahidin(_footprints, site) {
  return createSurveyLandmark(site, [
    prism(alWing, AL_GROUND, -0.28, OCHRE, DARK_ROOF),
    prism(alHall, AL_GROUND, 2.74, OCHRE, DARK_ROOF),
    prism(alSquare, -4.0, 2.41, PATINA, DARK_ROOF, AL_GROUND),
    prism(alTower, AL_GROUND, 10.72, OCHRE, PATINA),
  ], alFacade, alRoof);
}

const SIC_GROUND = -9.12, BUFF = 0xbeb09a, TAUPE = 0x8b7964, LIMESTONE = 0xd1c9b4;
const SIC_FRAME = 0x34383b, SIC_GLASS = 0x536069;
const sicPoint = (u, d) => [-2061.88 + 0.9214 * u - 0.389 * d, 123.51 - 0.389 * u - 0.9214 * d];
const sicPlan = (left, right, front, back) => [
  sicPoint(left, front), sicPoint(left, back), sicPoint(right, back), sicPoint(right, front),
];

function sicFacade(wall) {
  const { buildingIndex, faceIndex, width, high, point, trim } = wall;
  const front = faceIndex === 3;
  const glazing = { frame: SIC_FRAME, color: SIC_GLASS };
  if (buildingIndex === 2) {
    if (!front) return;
    surveyWindow(wall, 0.27, width - 0.27, -8.99, -6.65, { ...glazing, columns: 6 });
    surveyPanel(wall, -0.13, width + 0.13, -6.51, -6.32, SIC_FRAME, 0.81);
    trim.quad(point(-0.13, -6.32), point(-0.13, -6.32, 0.81),
      point(width + 0.13, -6.32, 0.81), point(width + 0.13, -6.32), SIC_FRAME);
    trim.quad(point(width + 0.13, -6.51), point(width + 0.13, -6.51, 0.81),
      point(-0.13, -6.51, 0.81), point(-0.13, -6.51), SIC_FRAME);
    for (let i = 0; i < 4; i++) {
      const center = (i + 0.5) * width / 4;
      surveyPanel(wall, center - 0.36, center + 0.36, -5.85, -0.18, TAUPE);
      for (const y of [-5.60, -2.52]) surveyWindow(wall, center - 0.35, center + 0.35, y, y + 1.63, glazing);
    }
  } else if (buildingIndex === 1) {
    const count = Math.floor(width / 2.1);
    for (let i = 0; i < count; i++) {
      const center = (i + 0.5) * width / count;
      if (front && Math.abs(center - width / 2) < 4.1) continue;
      surveyWindow(wall, center - 0.57, center + 0.57, high - 1.87, high - 0.62, glazing);
    }
  } else {
    const count = Math.floor(width / 4.6);
    const centers = front ? [2.68, 6.28, 9.94, 20.83, 24.49, 28.09]
      : Array.from({ length: count }, (_, i) => (i + 0.5) * width / count);
    for (const center of centers) {
      surveyPanel(wall, center - 1.24, center + 1.24, -6.70, -3.31, 0x9d8f7d);
      for (const y of [-8.34, -5.67]) {
        surveyWindow(wall, center - 1.23, center + 1.23, y, y + 1.62, { ...glazing, columns: 3 });
      }
    }
  }
}

function createSicEde(_footprints, site) {
  return createSurveyLandmark(site, [
    prism(sicPlan(0, 30.77, 0, 16.89), SIC_GROUND, -2.36, BUFF, 0x727577),
    prism(sicPlan(1.38, 29.39, 1.04, 16.23), -2.36, 0.30, TAUPE, 0x727577, SIC_GROUND),
    prism(sicPlan(11.32, 19.45, -0.62, 0.30), SIC_GROUND, 0.57, LIMESTONE, 0xb9b5a9),
  ], sicFacade);
}

// The 3DBAG survey separates this hall from 169A and the surrounding homes.
const MGT_GROUND = -5.47;
const mgtPlan = [[-1064.98,24.53],[-1061.97,-1.18],[-1056.15,2.16],[-1056.87,7.98],
  [-1045.17,9.59],[-1043.01,13.79],[-1063.08,24.89]];

function createMgtMoskee(_footprints, site) {
  return createSurveyLandmark(site, [prism(mgtPlan, MGT_GROUND, -2.38, 0x8c5548, 0x565958)], wall => {
    const { faceIndex, width } = wall;
    surveyPanel(wall, 0, width, -2.93, -2.38, 0xe1ded5);
    if (faceIndex < 2 || faceIndex > 3) return;
    const bays = faceIndex === 2 ? 2 : 3;
    for (let i = 0; i < bays; i++) {
      const center = (i + 0.5) * width / bays;
      const size = width / bays * 0.40;
      const door = i === 0 && faceIndex === 3;
      surveyPanel(wall, center - size - 0.10, center + size + 0.10, -5.31, -2.94, 0x303532);
      surveyWindow(wall, center - size, center + size, door ? -5.34 : -4.66, -3.04,
        { frame: 0x303532, color: 0x67736e, columns: 2 });
    }
  });
}

export const MOSQUE_LANDMARK_FACTORIES = {
  'al-mouahidin': createAlMouahidin,
  'sic-ede': createSicEde,
  'ede-mgt-moskee': createMgtMoskee,
};
