import * as THREE from 'three/webgpu';
import { AMADEUS_BUILDING as building, EDE_AMADEUS_LANDMARKS } from './ede-amadeus-survey.js';
import { wallColliders } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const [site] = EDE_AMADEUS_LANDMARKS;

const cream = 0xe4d9be, burgundy = 0x733337, green = 0x263f39, timber = 0xab815c;
const ground = (x, z) => getTerrain() ? terrainHeightAt(x, z) : building.ground;

// Local axes follow the photographed frontage, with positive depth toward Driesprong.
const angle = Math.atan2(0.916, 0.402);
function terracePoint(u, y, depth) {
  return [1199.79 + u * Math.cos(angle) + depth * Math.sin(angle), y,
    -2209.64 - u * Math.sin(angle) + depth * Math.cos(angle)];
}

function beam(batch, a, b, width, color) {
  const start = new THREE.Vector3(...a), direction = new THREE.Vector3(...b).sub(start);
  const length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  const middle = start.addScaledVector(direction, length / 2);
  batch.solid(new THREE.BoxGeometry(width, length, width).applyQuaternion(rotation).translate(...middle), color);
}

function round(batch, [x, y, z], top, bottom, height, color, sides = 8) {
  batch.solid(new THREE.CylinderGeometry(top, bottom, height, sides).translate(x, y, z), color);
}

function wallDetails(wall) {
  const { faceIndex, width, base, low, high } = wall;
  if ([11, 65, 66].includes(faceIndex)) {
    const bays = Math.round(width / 2.2), bay = width / bays;
    const entry = faceIndex === 66 ? 1 : -1;
    for (let i = 0; i < bays; i++) {
      surveyWindow(wall, i * bay + 0.15, (i + 1) * bay - 0.15,
        base + (i === entry ? 0.13 : 0.52), base + 2.69, {
          color: i === entry ? 0x354443 : 0x383a38, frame: burgundy, columns: 2, rows: 2,
        });
    }
    surveyPanel(wall, 0.04, width - 0.04, base + 2.8, base + 2.96, green);
    return 0x704c3c;
  }
  if (faceIndex === 52) {
    surveyWindow(wall, 0.51, width - 0.20, low + 0.38, high - 0.29,
      { color: 0x526167, frame: burgundy, columns: 2 });
    return green;
  }
  if (low <= base + 0.03 && high - low > 2.75 && width > 4) {
    const bays = Math.max(1, Math.round(width / 4));
    for (let i = 0; i < bays; i++) {
      const center = width * (i + 0.5) / bays;
      surveyWindow(wall, center - 0.68, center + 0.68, base + 1.05, base + 2.35,
        { frame: green, columns: 2 });
    }
  }
  return low > base + 3 ? cream : undefined;
}

function upperFront(trim) {
  const point = (u, y, offset = 0) => terracePoint(u, y, -2.20 + offset);
  const wall = {
    trim, point, width: 10.5, a: { x: point(0, 0)[0], z: point(0, 0)[2] },
    b: { x: point(10.5, 0)[0], z: point(10.5, 0)[2] },
    normal: { x: Math.sin(angle), z: Math.cos(angle) },
    rings: [[point(1.65, 17.86), point(12.3, 17.86), point(10.47, 21.09), point(3.77, 21.09)]],
  };
  const [a, b, c, d] = wall.rings[0];
  trim.quad(a, b, c, d, cream);
  beam(trim, a, d, 0.13, green);
  beam(trim, d, c, 0.13, green);
  beam(trim, c, b, 0.13, green);
  for (const center of [4.35, 7.06, 9.77]) {
    surveyWindow(wall, center - 0.54, center + 0.54, 18.18, 20.53,
      { color: 0x566264, frame: burgundy, columns: 2, rows: 2 });
    for (const side of [-1, 1]) {
      const u = center + side * 0.79;
      surveyPanel(wall, u - 0.18, u + 0.18, 18.31, 19.73, 0x8a5860, 0.05);
    }
  }
}

function veranda({ trim, labels, colliders }) {
  for (const [start, end, depth, count] of [[0.10, 17.83, 0.67, 7], [17.83, 28.89, -1.23, 4]]) {
    const p = (u, y, d = 0) => terracePoint(u, y, depth + d);
    const roofTop = 17.95, beamTop = 16.98;
    // Sloped fascia and thin burgundy awning run continuously across the timber bays.
    trim.quad(p(start, beamTop, 0.34), p(end, beamTop, 0.34),
      p(end, roofTop, -0.75), p(start, roofTop, -0.75), 0x70524c);
    beam(trim, p(start, beamTop, 0.31), p(end, beamTop, 0.31), 0.14, green);
    beam(trim, p(start, roofTop, -0.75), p(end, roofTop, -0.75), 0.085, green);
    trim.quad(p(end, 16.98, 0.32), p(start, 16.98, 0.32),
      p(start, 16.73, 0.68), p(end, 16.73, 0.68), 0x994d42);
    const bay = (end - start) / count;
    for (let i = 0; i <= count; i++) {
      const u = start + i * bay;
      const foot = p(u, 0), bottom = ground(foot[0], foot[2]);
      beam(trim, p(u, bottom - 0.04), p(u, beamTop), 0.14, timber);
      if (i < count) beam(trim, p(u, beamTop - 0.77), p(u + 0.53, beamTop), 0.081, timber);
      if (i > 0) beam(trim, p(u, beamTop - 0.77), p(u - 0.53, beamTop), 0.081, timber);
      colliders.push(...wallColliders({ x: foot[0] - 0.08, z: foot[2] }, { x: foot[0] + 0.08, z: foot[2] },
        bottom, beamTop, 0.16));
    }
  }
  const board = terracePoint(13.83, 18.30, -0.10);
  trim.solid(new THREE.BoxGeometry(5.32, 0.73, 0.093).rotateY(angle).translate(...board), 0x673834);
  surveyLabel({ labels, point: (u, y) => terracePoint(u, y, -0.04) },
    11.2, 16.45, 17.97, 18.65, 'STEAKHOUSE', '#8d3833', '#f5e9cd');
  upperFront(trim);
}

function terraceSeating(trim, u, depth, span) {
  const [x, , z] = terracePoint(u, 0, depth);
  const y = ground(x, z);
  const p = height => [x, y + height, z];
  round(trim, p(0.39), 0.03, 0.05, 0.78, green);
  round(trim, p(0.78), 0.54, 0.54, 0.055, 0x967857);
  for (const side of [-1, 1]) {
    const seat = terracePoint(u + side * 0.81, 0, depth);
    const chairBase = ground(seat[0], seat[2]);
    seat[1] = chairBase + 0.41;
    trim.solid(new THREE.BoxGeometry(0.43, 0.065, 0.43).rotateY(angle).translate(...seat), 0x765b48);
    beam(trim, [seat[0], chairBase, seat[2]], seat, 0.08, green);
    const back = terracePoint(u + side * 1.01, chairBase + 0.65, depth);
    trim.solid(new THREE.BoxGeometry(0.054, 0.39, 0.40).rotateY(angle).translate(...back), 0x765b48);
  }
  if (!span) return;
  beam(trim, p(0), p(2.71), 0.05, timber);
  round(trim, p(2.49), 0.025, span, 0.49, 0xe0cfac);
  round(trim, p(2.20), span, span, 0.085, 0xcaba9e);
}

function libertyFigure({ trim, colliders }) {
  const x = 1215.13, z = -2223.99, y = ground(x, z);
  const p = (u, height, depth = 0) => terracePoint(19.31 + u, y + height, 8.28 + depth);
  const ivory = 0xe9dfc9, blue = 0x285294, scarlet = 0xa61f38, gold = 0xb6984c;
  round(trim, p(0, 0.22), 0.71, 0.76, 0.52, 0x555849);
  const robe = [[0.48, 0.47], [1.32, 0.43], [2.55, 0.37], [3.27, 0.40]];
  for (let i = 1; i < robe.length; i++) {
    for (let section = 0; section < 10; section++) {
      const facet = ([height, radius], index) => {
        const theta = (index / 10) * Math.PI * 2;
        return p(Math.cos(theta) * radius, height, Math.sin(theta) * radius);
      };
      const color = section >= 2 && section <= 5 ? scarlet : i === 3 ? blue : ivory;
      trim.quad(facet(robe[i - 1], section + 1), facet(robe[i - 1], section),
        facet(robe[i], section), facet(robe[i], section + 1), color);
    }
  }
  trim.solid(new THREE.SphereGeometry(0.27, 8, 5).scale(0.86, 1.22, 0.88)
    .translate(...p(0.03, 3.57, 0.035)), ivory);
  round(trim, p(0.03, 3.73, 0.015), 0.21, 0.24, 0.15, blue);
  for (let i = 0; i < 7; i++) {
    const theta = Math.PI * i / 6;
    const spike = new THREE.ConeGeometry(0.048, 0.32, 4)
      .rotateZ(Math.PI / 2 - theta).rotateY(angle)
      .translate(...p(0.03 - Math.cos(theta) * 0.27, 3.73 + Math.sin(theta) * 0.23, 0.045));
    trim.solid(spike, gold);
  }
  beam(trim, p(-0.20, 3.01), p(-0.64, 3.69, 0.06), 0.26, blue);
  beam(trim, p(-0.64, 3.64, 0.06), p(-0.84, 4.50, 0.08), 0.17, ivory);
  round(trim, p(-0.84, 4.64, 0.08), 0.16, 0.073, 0.31, gold);
  round(trim, p(-0.84, 4.95, 0.08), 0.035, 0.13, 0.33, 0xd39c3e, 6);
  beam(trim, p(0.30, 3.00), p(0.64, 2.66, 0.16), 0.20, scarlet);
  beam(trim, p(0.64, 2.66, 0.16), p(0.56, 2.91, 0.38), 0.14, ivory);
  trim.solid(new THREE.BoxGeometry(0.35, 0.53, 0.09).rotateY(angle)
    .translate(...p(0.58, 2.82, 0.35)), green);
  colliders.push(...wallColliders({ x: x - 0.56, z }, { x: x + 0.56, z }, y, y + 3.2, 1.12));
}

function terrace(context) {
  const { trim } = context;
  veranda(context);
  // Terrace edges surveyed from the PDOK aerial. Street photographs show the hedge,
  // umbrellas and tricolor figure. https://www.atlasvanede.nl/verken/short-walks/parkeerterrein-rond-ede/kogelvangers-23
  const edges = [[0.2, 0.38], [3.6, 2.6], [14.1, 7.25], [21.9, 11.45],
    [31.4, 7.45], [30.1, -0.92], [18.0, -1.51], [17.8, 0.38]];
  const apron = edges.map(([u, depth]) => {
    const [x, , z] = terracePoint(u, 0, depth);
    return [x, ground(x, z) + 0.045, z];
  });
  trim.polygon([apron], 0x9a8c79);
  for (let i = 2; i <= 4; i++) {
    const a = apron[i - 1], b = apron[i];
    beam(trim, [a[0], a[1] + 0.46, a[2]], [b[0], b[1] + 0.46, b[2]], 0.88, 0x51633a);
  }
  for (const seats of [[3.7, 1.25, 0], [7.45, 2.9, 1.72], [11.15, 3.35, 0],
    [14.9, 4.62, 1.8], [18.6, 4.26, 0], [22.9, 5.75, 1.75],
    [26.3, 3.15, 0], [28.2, 4.7, 1.64], [28, 0.83, 0]]) {
    terraceSeating(trim, ...seats);
  }
  libertyFigure(context);

  const woodPost = 0x947a5b, shelter = 0xd2c7a9;
  const corners = [[29.7, -15.7], [30.6, -3.1], [35.6, -3.4], [35.1, -14.0]].map(([u, depth]) => {
    const [x, , z] = terracePoint(u, 0, depth);
    const y = ground(x, z);
    beam(trim, [x, y, z], [x, y + 2.42, z], 0.083, woodPost);
    return [x, y + 2.42, z];
  });
  const [a, b, c, d] = corners;
  const peak = (u, depth) => {
    const [x, , z] = terracePoint(u, 0, depth);
    return [x, ground(x, z) + 3.38, z];
  };
  const left = peak(32.6, -11.8), right = peak(33.3, -5.8);
  trim.quad(a, b, right, left, shelter);
  trim.quad(d, left, right, c, shelter);
  trim.triangle(a, left, d, shelter);
  trim.triangle(b, c, right, shelter);
}

export const EDE_AMADEUS_LANDMARK_FACTORIES = {
  amadeus: (_footprints, landmark = site) => createSurveyLandmark(landmark, [building], wallDetails, terrace),
};
