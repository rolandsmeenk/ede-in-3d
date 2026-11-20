import * as THREE from 'three/webgpu';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { EDE_SPORT_LANDMARKS, SPORT_LANDMARK_SURVEYS } from './ede-sport-landmark-survey.js';
import { drapeEdeSurface, edePolygonGeometry } from './ede-geometry.js';
import { EDE_PAVING_STYLE } from './ede-road-surfaces.js';
import { createEdePavingMaterial, createRoadSurfaceMaterial } from './tsl-materials.js';
import { WVEDE_BRICK_SECTION, WVEDE_CIRCUIT, WVEDE_START_LINE_INDEX } from './ede-wvede-circuit-survey.js';
import { terrainHeightAt } from './terrain.js';

const white = 0xdadbd4, metal = 0x666e6b, charcoal = 0x343d3c, glass = 0x3c5258;
const dtsBlue = 0x2861a1, net = 0x657b69;
const up = new THREE.Vector3(0, 1, 0);

function bar(batch, a, b, width, color) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const direction = to.clone().sub(from), length = direction.length();
  if (length < 0.01) return;
  const rotation = new THREE.Quaternion().setFromUnitVectors(up, direction.divideScalar(length));
  batch.solid(new THREE.BoxGeometry(width, length, width).applyQuaternion(rotation)
    .translate(...from.lerp(to, 0.5).toArray()), color);
}

function wallOpenings(wall, bays, frame = white) {
  const { width, base, high } = wall;
  for (const [from, to, low, top, columns = 1, color = glass] of bays) {
    surveyWindow(wall, width * from, width * to, base + low, Math.min(base + top, high - 0.1), { columns, color, frame });
  }
}

function label(wall, text, color, textColor = '#f5f4ed', low = 2.35, top = 2.87) {
  const { width, base, high } = wall, span = Math.min(width * 0.78, text.length * 0.26 + 0.75);
  if (base + top < high) surveyLabel(wall, (width - span) / 2, (width + span) / 2, base + low, base + top,
    text, color, textColor);
}

function shoe(batch, { point, high, width }, from, to, depth, color, y = high - 0.18) {
  const front = depth, back = 0.01;
  const a = point(width * from, y, back), b = point(width * to, y, back);
  const c = point(width * to, y - 0.09, front), d = point(width * from, y - 0.09, front);
  batch.quad(a, b, c, d, color);
  batch.quad(d, c, b, a, color);
  batch.quad(d, c, point(width * to, y - 0.23, front), point(width * from, y - 0.23, front), color);
}

function wallDetails(id, wall) {
  const { buildingIndex, faceIndex, width, high, base, low, normal, trim } = wall;
  if (id === 'moorfielders' && buildingIndex === 0) {
    if ([4, 9].includes(faceIndex)) {
      wallOpenings(wall, [[0.1, 0.86, 0.94, 2.23, 2]], 0x757c79);
      surveyPanel(wall, 0.08, width * 0.92, base + 2.26, base + 2.48, 0x908d7d);
    }
    if ([7, 8].includes(faceIndex)) {
      wallOpenings(wall, [[0.12, 0.92, 0.1, 2.30, 1]], 0x7c8480);
      if (faceIndex === 7) surveyLabel(wall, -1.36, 1.36, base + 3.09, base + 4.16,
        'HUSTLE IN', '#254677', '#ece9d6');
    }
    if (faceIndex === 2) wallOpenings(wall, [[0.14, 0.29, 0.95, 2.26], [0.40, 0.55, 0.95, 2.26],
      [0.65, 0.82, 0.95, 2.26]]);
  }
  if (id === 'climax-atletiek' && buildingIndex === 0 && [2, 7, 16].includes(faceIndex)) {
    wallOpenings(wall, [[0.12, 0.9, faceIndex === 16 ? 0.09 : 0.96, 2.42, faceIndex === 16 ? 2 : 4]]);
    if (faceIndex === 7) {
      label(wall, 'CLIMAX ATLETIEK', '#d8e2d5', '#296643', 2.53, 2.98);
      shoe(trim, wall, 0.08, 0.92, 0.68, 0x565d57);
    }
  }
  if (id === 'ede-victoria' && [1, 2, 6].includes(faceIndex)) {
    wallOpenings(wall, faceIndex === 6 ? [[0.06, 0.29, 0.08, 2.16, 2], [0.38, 0.76, 0.93, 2.18, 4],
      [0.83, 0.93, 0.08, 2.16]] : [[0.11, 0.87, 0.94, 2.24, 3]]);
    if (faceIndex === 6) {
      label(wall, 'VV EDE/VICTORIA', '#b3b530', '#282b26');
      shoe(trim, wall, 0.03, 0.96, 0.83, 0x393b3c, base + 2.54);
    }
  }
  if (id === 'fc-jeugd') {
    if (buildingIndex === 0 && faceIndex === 3) {
      wallOpenings(wall, [[0.07, 0.23, 0.09, 2.35, 2], [0.26, 0.91, 0.72, 2.35, 7]], 0x303c41);
      label(wall, 'FC JEUGD ’90', '#173b75', '#f1f3ed', 2.73, 3.35);
      shoe(trim, wall, 0.05, 0.95, 0.96, 0x444c51, base + 2.68);
    }
    if (buildingIndex === 0 && faceIndex === 0) wallOpenings(wall, [[0.2, 0.41, 0.09, 2.25, 2],
      [0.52, 0.83, 0.75, 2.25, 3]], 0x303c41);
    if (buildingIndex === 1 && faceIndex === 2) {
      for (let i = 0; i < 5; i++) {
        const start = (0.07 + i * 0.18) * width;
        surveyWindow(wall, start, start + 1.6, base + 0.1, base + 2.12, { frame: 0x62706d, color: 0x8a9090 });
      }
    }
  }
  if (id === 'wvede') {
    const belt = Math.min(high - 0.2, base + 2.88);
    for (let y = base + 0.22; y < belt; y += 0.19) {
      surveyPanel(wall, 0.04, width - 0.04, y, y + 0.024, 0x343834, 0.026);
    }
    if (faceIndex === 9) {
      wallOpenings(wall, [[0.05, 0.27, 0.78, 2.38, 4], [0.29, 0.42, 0.09, 2.38, 2],
        [0.45, 0.80, 0.78, 2.38, 6], [0.82, 0.94, 0.09, 2.38, 2]], 0xc0bfad);
      shoe(trim, wall, 0.0, 1.0, 0.82, 0x474e48, base + 2.79);
      label(wall, 'WVEDE', '#343f54', '#f5964c', 2.48, 2.74);
    }
    if ([4, 7].includes(faceIndex)) wallOpenings(wall, [[0.1, 0.84, 1.0, 2.24, 3]], 0xbfbdae);
  }
  if (id === 'dts-ede') {
    if (buildingIndex === 0 && [1, 3, 4, 7].includes(faceIndex)) {
      wallOpenings(wall, [[0.08, 0.25, 0.14, 2.32, 2], [0.30, 0.93, 0.94, 2.32, Math.max(2, Math.round(width / 2.5))]],
        0x365981);
      if (faceIndex === 3) label(wall, 'DTS ’35 EDE', '#214876');
      if (faceIndex === 1) shoe(trim, wall, 0.04, 0.97, 1.05, 0x494f54, base + 2.73);
    }
    if (buildingIndex === 1 && faceIndex === 0) {
      wallOpenings(wall, [[0.07, 0.93, 2.11, 2.92, 12]], 0x2d5790);
      grandstand(wall);
    }
  }
  if (id === 'sporthal-t-riet' && width > 0.9) {
    if (low > base + 3) return 0x8d8e83;
    if (high < base + 4.05 && normal.z > 0.2 && (wall.a.z + wall.b.z) / 2 > 2861) {
      wallOpenings(wall, [[0.10, 0.92, 0.55, 2.57, Math.max(1, Math.round(width / 1.2))]], 0x4a4c44);
      if (faceIndex === 5) {
        label(wall, 'DICK’S INN', '#3b3025', '#f3ce83', 2.74, 3.42);
        shoe(trim, wall, 0.06, 0.95, 1.09, 0x45392e, base + 2.70);
      }
    }
    if ([19, 69, 70].includes(faceIndex)) {
      wallOpenings(wall, [[0.24, 0.73, 0.10, 2.52, Math.max(2, Math.round(width / 2))]], 0xb0b0a4);
      if (faceIndex === 70) {
        label(wall, 'SPORTHAL ’T RIET', '#484e46', '#f2eee3', 2.91, 3.61);
        shoe(trim, wall, 0.13, 0.83, 1.22, 0x626e66, base + 2.78);
      }
    }
    if ([18, 22, 24].includes(faceIndex)) {
      for (let u = 1.3; u < width - 1.2; u += 3.25) {
        surveyWindow(wall, u, u + 1.15, base + 3.02, base + 3.73,
          { color: 0x586873, frame: 0xa9a598, columns: 2 });
      }
    }
  }
}

function grandstand(wall) {
  const { trim, point, width, base } = wall;
  const floor = base + 0.78, roof = base + 3.65;
  const solid = (u, v, y, h, depth, color) => {
    trim.quad(point(u,y,depth), point(v,y,depth), point(v,h,depth), point(u,h,depth), color);
    trim.quad(point(v,y,depth), point(u,y,depth), point(u,h,depth), point(v,h,depth), color);
  };
  solid(0, width, base, floor, 2.76, 0xad8c70);
  shoe(trim, wall, 0, 1, 2.89, 0x404850, roof);
  for (let i = 0; i <= 7; i++) {
    const u = i * width / 7;
    bar(trim, point(u, floor, 2.72), point(u, roof - 0.18, 2.72), 0.095, dtsBlue);
    if (i < 7) {
      const to = (i + 1) * width / 7;
      bar(trim, point(u, floor + 0.76, 2.81), point(to, floor + 0.76, 2.81), 0.045, metal);
    }
  }
  for (let row = 0; row < 3; row++) {
    const depth = 2.47 - row * 0.75, y = floor + row * 0.42;
    trim.quad(point(0,y,depth), point(width,y,depth), point(width,y,depth - 0.71), point(0,y,depth - 0.71), 0x92928b);
    for (let u = 1.1; u < width - 1; u += 0.63) {
      if (u % (width / 3) < 0.92) continue;
      const color = Math.round(u / 0.63 + row) % 5 < 2 ? white : dtsBlue;
      bar(trim, point(u,y + 0.20,depth - 0.38), point(u + 0.42,y + 0.20,depth - 0.38), 0.10, color);
      solid(u, u + 0.42, y + 0.19, y + 0.53, depth - 0.60, color);
    }
  }
  for (let i = 0; i < 5; i++) {
    const height = base + i * 0.16, depth = 3.69 - i * 0.18;
    bar(trim, point(0.2,height,depth), point(1.31,height,depth), 0.14, metal);
    bar(trim, point(width - 1.31,height,depth), point(width - 0.2,height,depth), 0.14, metal);
  }
}

function fence(trim, points, height, gap) {
  for (let i = 1; i < points.length; i++) {
    const [x, z] = points[i - 1], [ex, ez] = points[i];
    const span = Math.hypot(ex - x, ez - z), count = Math.ceil(span / gap);
    const at = (u, y) => {
      const a = x + (ex - x) * u, b = z + (ez - z) * u;
      return [a, terrainHeightAt(a, b) + y, b];
    };
    for (let j = 0; j < count; j++) {
      const a = j / count, b = (j + 1) / count;
      bar(trim, at(a, 0), at(a, height), 0.075, metal);
      for (let k = 1; k < 6; k++) {
        const u = a + (b - a) * k / 6;
        bar(trim, at(u, 0.18), at(u, height), 0.013, net);
      }
      for (let v = 0; v < height; v += 0.79) bar(trim, at(a, v), at(b, v), 0.013, net);
      bar(trim, at(a, height), at(b, height), 0.043, metal);
    }
    if (i === points.length - 1) bar(trim, at(1, 0), at(1, height), 0.075, metal);
  }
}

function dugout({ trim, colliders }, a, b, side, width, color, curved = false) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const vx = (a[1] - b[1]) * side / length, vz = (b[0] - a[0]) * side / length;
  const base = terrainHeightAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  const at = (u, d, y = 0) => [a[0] + u * (b[0] - a[0]) + d * vx, base + y,
    a[1] + u * (b[1] - a[1]) + d * vz];
  const panel = (p, q, r, s, tint) => {
    trim.quad(p, q, r, s, tint);
    trim.quad(s, r, q, p, tint);
  };
  const section = curved ? [[0,1.28], [0.20,1.79], [0.59,2.14], [1.09,2.32], [width,2.35]]
    : [[0,2.13], [width,2.38]];
  for (let i = 1; i < section.length; i++) {
    const [d0,h0] = section[i - 1], [d1,h1] = section[i];
    panel(at(0,d0,h0), at(1,d0,h0), at(1,d1,h1), at(0,d1,h1), color);
  }
  if (!curved) {
    panel(at(0,0,0.07), at(1,0,0.07), at(1,0,2.13), at(0,0,2.13), 0x778278);
    for (const u of [0, 1]) panel(at(u,0,0.07), at(u,width,0.07), at(u,width,2.38), at(u,0,2.13), 0x778278);
  }
  const uprights = Math.ceil(length / 2.4);
  for (let i = 0; i <= uprights; i++) {
    const u = i / uprights;
    bar(trim, at(u, 0), at(u, 0, section[0][1]), 0.064, metal);
    bar(trim, at(u, width), at(u, width, section.at(-1)[1]), 0.064, metal);
    for (let j = 1; j < section.length; j++) {
      bar(trim, at(u, ...section[j - 1]), at(u, ...section[j]), 0.045, metal);
    }
  }
  for (let u = 0.03; u < 0.94; u += 0.18) {
    bar(trim, at(u, 0.5), at(u, 0.5, 0.47), 0.074, metal);
  }
  panel(at(0.02,0.29,0.47), at(0.98,0.29,0.47), at(0.98,0.64,0.47), at(0.02,0.64,0.47), 0x796956);
  const outer = [at(0,0), at(1,0), at(1,0.13), at(0,0.13)].map(([x,,z]) => ({ x,z }));
  colliders.push({
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: base - 0.2, maxY: base + 2.38, polygon: { outer, holes: [] },
  });
}

function moorfielders(detail) {
  const { group, trim } = detail;
  const terrace = [[-402.12,3550.56],[-398.36,3545.33],[-393.61,3542.59],[-377.13,3537.65],[-371.90,3537.17],
    [-369.43,3543.69],[-374.19,3550.67],[-390.67,3555.61],[-395.15,3555.09]];
  const geometry = drapeEdeSurface(edePolygonGeometry(terrace.map(([x,z]) => ({ x,z })), [], 0.081), true);
  setPavingStyle(geometry, EDE_PAVING_STYLE.block);
  const paving = new THREE.Mesh(geometry, createEdePavingMaterial());
  paving.name = 'Hustle In paved forecourt';
  paving.receiveShadow = true;
  group.add(paving);
  const backstops = [
    [[-513.39,3504.11],[-516.91,3513.35],[-517.95,3523.10],[-514.00,3533.62],[-506.55,3540.66],[-496.34,3546.20]],
    [[-524.24,3408.77],[-536.97,3412.22],[-544.22,3417.19],[-546.75,3424.94],[-546.28,3433.95]],
    [[-459.35,3389.75],[-448.11,3386.29],[-438.13,3383.08],[-427.90,3382.62],[-421.95,3389.90],[-418.25,3402.17]],
  ];
  for (const [i, points] of backstops.entries()) fence(trim, points, i === 0 ? 5.15 : 3.85, 4.25);
  const shelters = [
    [[-511.16,3508.62],[-503.89,3498.14],1,3.1],
    [[-499.58,3545.94],[-481.40,3551.51],-1,3.0],
    [[-536.73,3412.47],[-523.24,3407.52],1,2.55],
    [[-545.53,3432.70],[-541.59,3445.22],-1,2.55],
  ];
  for (const [a, b, side, size] of shelters) dugout(detail, a, b, side, size, 0x485551);
  const a = [-391.48,3572.37], b = [-370.50,3564.44], c = [-365.56,3575.72], d = [-388.03,3582.89];
  const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
  fence(trim, [a,b,c,d,a], 3.0, 4.3);
  fence(trim, [mid(a,d), mid(b,c)], 3.0, 4.3);
}

function signPanel(labels, from, to, lo, hi, text, color, textColor) {
  labels.push({ text, a: { x: to[0], z: to[2] }, b: { x: from[0], z: from[2] }, lo, hi, color, textColor });
}

function dts(detail) {
  const { trim, labels } = detail;
  const x = -2589.1, z = 1023.5, y = terrainHeightAt(x, z);
  const ux = 0.986, uz = -0.167;
  const p = (u, h, d = 0) => [x + u * ux + uz * d, y + h, z + u * uz - ux * d];
  bar(trim, p(0,0,-0.22), p(0,5.7,-0.22), 0.23, 0x626d63);
  for (const side of [-1, 1]) {
    bar(trim, p(side * 4.85,1.95,-0.11), p(side * 4.85,3.0,-0.11), 0.11, metal);
    for (const dist of [3.39, 4.15, 4.85]) bar(trim, p(0,5.60,-0.19), p(side * dist,3.07,-0.08), 0.025, 0x313b3e);
  }
  const labelFacingRoad = (a, b, lo, hi, text, color, textColor) =>
    signPanel(labels, b, a, lo, hi, text, color, textColor);
  const plate = (u, v, low, high, color) => {
    trim.quad(p(u,low),p(v,low),p(v,high),p(u,high),color);
    trim.quad(p(v,low),p(u,low),p(u,high),p(v,high),color);
  };
  plate(-4.84,4.84,2.12,2.57,0x273f62);
  plate(-3.55,3.55,2.56,3.79,0x224865);
  labelFacingRoad(p(-2.50,0,0.013),p(2.50,0,0.013),y+3.20,y+3.72,'Welkom op','#274967','#eff0db');
  labelFacingRoad(p(-2.50,0,0.013),p(2.50,0,0.013),y+2.65,y+3.22,'sportpark Inschoten','#274967','#eff0db');
  labelFacingRoad(p(-4.83,0,0.013),p(4.83,0,0.013),y+2.17,y+2.53,'AUTOBEDRIJF G. BRABER B.V.','#253d5b','#efece0');
  for (const [u, h, radius] of [[0, 4.91, 0.62], [-2.98, 3.17, 0.34], [2.98, 3.17, 0.34]]) {
    const ring = (r, d, color) => {
      const points = Array.from({ length: 24 }, (_, i) => {
        const angle = i * Math.PI / 12;
        return p(u + Math.cos(angle) * r, h + Math.sin(angle) * r, d);
      });
      trim.polygon([points], color);
      trim.polygon([[...points].reverse()], color);
    };
    ring(radius,0.023,white);
    ring(radius * 0.86,0.032,0x285082);
    labelFacingRoad(p(u-radius*0.62,0,0.038),p(u+radius*0.62,0,0.038),y+h-radius*0.43,y+h+radius*0.43,'DTS','#285082','#f2f3eb');
  }
  dugout(detail, [-2603.53,1082.4], [-2594.92,1080.93], 1, 1.75, 0x6b7b82, true);
  dugout(detail, [-2563.10,1076.18], [-2555.61,1074.83], 1, 1.75, 0x6b7b82, true);
}

function solarArray(trim, start, front, back, columns, rows) {
  const point = (u, v) => [
    start[0] + (front[0] - start[0]) * u + (back[0] - start[0]) * v,
    start[1] + (front[1] - start[1]) * u + (back[1] - start[1]) * v,
    start[2] + (front[2] - start[2]) * u + (back[2] - start[2]) * v,
  ];
  for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) {
    const u = (i + 0.06) / columns, v = (j + 0.04) / rows;
    const e = (i + 0.96) / columns, n = (j + 0.93) / rows;
    const a = point(u,v), b = point(e,v), c = point(e,n), d = point(u,n);
    const color = (i + 2 * j) % 3 === 0 ? 0x344560 : 0x29394f;
    trim.quad(a,d,c,b,color);
    trim.quad(a,b,c,d,color);
  }
}

function riet({ trim }) {
  solarArray(trim, [-2309.3,-3.58,2823.7], [-2292.1,-3.58,2831.83], [-2325.4,-3.58,2857.7], 13, 20);
}

function jeugd({ trim }) {
  solarArray(trim, [-265.58,-1.98,3456.68], [-248.89,-1.98,3451.27], [-268.37,-1.98,3448.04], 14, 5);
}

function climax({ trim }) {
  solarArray(trim, [-192.7,-1.98,3572.21], [-179.72,-1.98,3568.02], [-195.0,-1.98,3565.4], 10, 5);
  solarArray(trim, [-176.4,-2.48,3566.7], [-167.41,-2.48,3563.8], [-180.7,-2.48,3553.65], 7, 8);
}

function setPavingStyle(geometry, style) {
  const styles = new Float32Array(geometry.getAttribute('position').count).fill(style);
  geometry.setAttribute('pavingStyle', new THREE.BufferAttribute(styles, 1));
}

function wvedeCircuit(group) {
  const curve = new THREE.CatmullRomCurve3(WVEDE_CIRCUIT.map(([x, z]) => new THREE.Vector3(x, 0, z)), true);
  const count = WVEDE_CIRCUIT.length;
  const point = (index, offset) => {
    const t = ((index % count) + count) % count / count;
    const center = curve.getPoint(t), heading = curve.getTangent(t);
    return { x: center.x - heading.z * offset, z: center.z + heading.x * offset };
  };
  const asphalt = createRoadSurfaceMaterial();
  const brick = createEdePavingMaterial();
  const surface = (first, last, half, material, name) => {
    const positions = [], uvs = [], indices = [];
    for (let i = first; i <= last; i += 0.25) {
      const left = point(i, -half), right = point(i, half);
      const j = positions.length / 3;
      positions.push(left.x, 0.082, left.z, right.x, 0.082, right.z);
      uvs.push(left.x, -left.z, right.x, -right.z);
      if (i < last) indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
    const strip = new THREE.BufferGeometry();
    strip.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    strip.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    strip.setIndex(indices);
    strip.computeVertexNormals();
    const geometry = drapeEdeSurface(strip, true);
    if (geometry !== strip) strip.dispose();
    if (material === brick) setPavingStyle(geometry, EDE_PAVING_STYLE.block);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const [east, west] = WVEDE_BRICK_SECTION;
  surface(west, east + count, 2.10, asphalt, 'WVEde asphalt');
  surface(east, west, 2.10, brick, 'WVEde brick return');

  const index = WVEDE_START_LINE_INDEX;
  const corners = [point(index - 0.006, -2.02), point(index + 0.006, -2.02),
    point(index + 0.006, 2.02), point(index - 0.006, 2.02)];
  const line = new THREE.Mesh(drapeEdeSurface(edePolygonGeometry(corners, [], 0.094), true),
    new THREE.MeshStandardMaterial({ color: 0xdedcd0, roughness: 0.88 }));
  line.name = 'WVEde start and finish';
  line.receiveShadow = true;
  group.add(line);
}

function wvedeStart({ group, trim, labels }) {
  wvedeCircuit(group);
  const x = -2061.9, z = 1354.2, y = terrainHeightAt(x,z), width = 4.2;
  const a = [x - width / 2,y,z], b = [x + width / 2,y,z];
  const face = (lo, hi, color) => trim.quad([a[0],y+lo,z],[b[0],y+lo,z],[b[0],y+hi,z],[a[0],y+hi,z],color);
  for (const post of [a,b]) bar(trim, post,[post[0],post[1]+2.36,post[2]-0.07],0.11,charcoal);
  face(0.35,2.36,0xe1e1d9);
  face(2.04,2.31,0xc45d30);
  face(0.35,0.59,0x25334b);
  signPanel(labels, [a[0],y,z+0.016], [b[0],y,z+0.016], y+2.02,y+2.32,'MEDAL PLAZA','#e0dfd7','#933f26');
  signPanel(labels, [a[0],y,z+0.016], [b[0],y,z+0.016], y+1.56,y+2.0,'WVEDE','#29364c','#f39755');
  for (const d of [-1, 0, 1]) {
    const height = d === 0 ? 0.54 : d < 0 ? 0.41 : 0.29;
    trim.solid(new THREE.CylinderGeometry(0.45,0.48,height,20).translate(x+0.96*d,y+height/2,z+0.87), 0x2e3c53);
  }
  for (const px of [-2058.2, -2049.4, -2040.6]) {
    const p = (x, y) => [x,terrainHeightAt(x,1355.15) + y,1355.15];
    bar(trim,p(px,0),p(px,0.87),0.058,metal);
    bar(trim,p(px+4.30,0),p(px+4.30,0.87),0.058,metal);
    bar(trim,p(px,0.82),p(px+4.30,0.82),0.046,metal);
  }
}

const finishDetails = {
  moorfielders,
  'climax-atletiek': climax,
  'fc-jeugd': jeugd,
  'dts-ede': dts,
  'sporthal-t-riet': riet,
  wvede: wvedeStart,
};

export const SPORT_LANDMARK_FACTORIES = Object.fromEntries(EDE_SPORT_LANDMARKS.map(({ id }) => [
  id, (_footprints, site) => createSurveyLandmark(site, SPORT_LANDMARK_SURVEYS[id],
    wall => wallDetails(id, wall), finishDetails[id]),
]));
