import * as THREE from 'three/webgpu';
import { CivicBatch, civicSigns, makeGroup, polygonNormal, wallColliders } from './ede-civic-landmarks.js';
import { nearbyRailHeightAt, RAIL_TOP } from './ede-grade.js';
import { DE_KLOMP_PLATFORMS, EXPANSION_LANDMARK_SURVEYS, GINKEL_SHEEPFOLD_FENCES } from './ede-expansion-landmark-surveys.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { addWindmillSailcloth, createWindmillRig } from './ede-windmill.js';
import { terrainHeightAt } from './terrain.js';
import { sheepFleeceInfluences } from './tree-seasons.js';

function box(batch, x, y, z, width, height, depth, color, heading = 0) {
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(heading).translate(x, y, z), color);
}

function sheepfoldWall(wall) {
  const { base, buildingIndex, faceIndex, high, low, normal, point, trim, width } = wall;
  if (low > base + 0.05 || width < 0.8) return;
  if (!buildingIndex && width > 11) {
    const heading = Math.atan2(normal.x, normal.z);
    for (let i = 1; i <= 3; i++) {
      const [x, , z] = point(i * width / 4, base, 0.10);
      const ground = Math.min(base, terrainHeightAt(x, z));
      box(trim, x, ground + 0.57, z, 0.37, 1.23, 0.50, 0x845f49, heading);
      box(trim, x - normal.x * 0.075, ground + 1.18, z - normal.z * 0.075,
        0.39, 0.22, 0.30, 0x795642, heading);
    }
    for (const at of [0.20, 0.41, 0.62, 0.83]) {
      const u = at * width;
      surveyWindow(wall, u - 0.26, u + 0.26, base + 1.40, base + 1.96,
        { color: 0x423c2f, frame: 0x755842, columns: 2 });
    }
  }
  if (buildingIndex) {
    surveyPanel(wall, 0.02, width - 0.02, base + 0.02, base + 0.34, 0x8d8575);
    for (let y = 0.48; y < Math.min(1.8, high - base - 0.18); y += 0.16) {
      surveyPanel(wall, 0.02, width - 0.02, base + y, base + y + 0.025, 0x292a24, 0.032);
    }
  }
  const doorFace = buildingIndex ? Math.abs(normal.x) > 0.86 : [5, 13].includes(faceIndex);
  if (!doorFace || width >= 6 || high - base < 1.75) return;
  const middle = width / 2, span = Math.min(width * 0.83, buildingIndex ? 1.57 : 2.32);
  const top = Math.min(high - 0.14, base + 2.38);
  surveyPanel(wall, middle - span / 2, middle + span / 2, base + 0.02, top, 0x282b23, 0.038);
  for (let i = 1; i < 10; i++) {
    const x = middle + (i / 10 - 0.5) * span;
    surveyPanel(wall, x - 0.011, x + 0.011, base + 0.06, top - 0.05, 0x484638, 0.047);
  }
  for (const sign of [-1, 1]) for (const y of [base + 0.43, top - 0.43]) {
    const x = middle + sign * span * 0.32;
    surveyPanel(wall, x - span * 0.17, x + span * 0.17, y, y + 0.045, 0x171a17, 0.057);
  }
}
function addSheepfoldFences({ trim, colliders }) {
  const posts = new Set();
  const color = 0x62503b;
  for (const { points } of GINKEL_SHEEPFOLD_FENCES) {
    for (let j = 1; j < points.length; j++) {
      const [ax, az] = points[j - 1], [bx, bz] = points[j];
      const dx = bx - ax, dz = bz - az;
      const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 2.6));
      const heading = Math.atan2(-dz, dx);
      const edge = Array.from({ length: count + 1 }, (_, i) => {
        const x = ax + i * dx / count, z = az + i * dz / count;
        const y = terrainHeightAt(x, z);
        const key = `${x.toFixed(2)},${z.toFixed(2)}`;
        if (!posts.has(key)) {
          box(trim, x, y + 0.55, z, 0.13, 1.1, 0.13, color);
          posts.add(key);
        }
        return { x, y, z };
      });
      for (let i = 1; i < edge.length; i++) {
        const a = edge[i - 1], b = edge[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const slope = Math.atan2(b.y - a.y, length);
        for (const height of [0.50, 0.90]) {
          const rail = new THREE.BoxGeometry(length, 0.095, 0.08).rotateZ(slope).rotateY(heading)
            .translate((a.x + b.x) / 2, (a.y + b.y) / 2 + height, (a.z + b.z) / 2);
          trim.solid(rail, color);
        }
        colliders.push(...wallColliders(a, b, Math.min(a.y, b.y) - 0.05, Math.max(a.y, b.y) + 1.1, 0.13));
      }
    }
  }
}

function sheepfoldFlockBatch(coat) {
  // Positions inside the fenced paddock alongside the main sheepfold.
  const placements = [
    [4320.6, 1066.8, 0.48, 1.02, true],
    [4322.5, 1067.5, 1.86, 0.69, false],
    [4327.1, 1065.2, -0.63, 0.98, false],
    [4328.8, 1070.3, 2.28, 1.04, true],
    [4322.1, 1072.8, -1.75, 0.96, true],
    [4325.7, 1074.0, 0.83, 1.00, false],
    [4329.7, 1078.1, -2.74, 0.91, true],
    [4322.0, 1078.4, -0.30, 1.06, true],
    [4319.5, 1083.4, -0.88, 1.03, false],
    [4321.3, 1084.4, -1.42, 0.73, true],
    [4325.4, 1083.1, 2.96, 0.95, true],
    [4328.6, 1087.0, 1.34, 1.04, false],
  ];
  const batch = new CivicBatch();
  const fleece = [0xe4d9c2, 0xf2e9d4, 0xd2c3a9, 0xe8dfcc];
  const face = 0xd7cbb2;
  const hoof = 0x50483c;

  for (const [i, [x, z, heading, size, grazing]] of placements.entries()) {
    const ground = terrainHeightAt(x, z);
    const cos = Math.cos(heading), sin = Math.sin(heading);
    const wool = fleece[i % fleece.length];
    const part = (color, px, py, pz, rx, ry, rz, tilt = 0, roll = 0) => {
      const shape = new THREE.SphereGeometry(1, 10, 6).scale(rx, ry, rz)
        .rotateX(tilt).rotateZ(roll).translate(px, py, pz)
        .scale(size, size, size).rotateY(heading).translate(x, ground, z);
      batch.solid(shape, color);
    };

    part(wool, 0, 0.71, -0.05, 0.24 + 0.14 * coat, 0.22 + 0.14 * coat, 0.53 + 0.07 * coat);
    part(wool, 0, 0.70, -0.38, 0.21 + 0.135 * coat, 0.20 + 0.12 * coat, 0.245 + 0.055 * coat);
    part(wool, 0, 0.74, 0.28, 0.21 + 0.14 * coat, 0.22 + 0.115 * coat, 0.265 + 0.06 * coat);
    part(wool, 0, 0.42, -0.59, 0.052 + 0.047 * coat, 0.26, 0.065 + 0.045 * coat, 0.18);

    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const px = side * 0.17 * size, pz = (end * 0.37 - 0.04) * size;
      const wx = x + px * cos + pz * sin, wz = z - px * sin + pz * cos;
      const foot = terrainHeightAt(wx, wz);
      const leg = ground + 0.63 * size - foot;
      batch.solid(new THREE.CylinderGeometry(0.043 * size, 0.026 * size, leg, 6)
        .translate(wx, foot + leg / 2, wz), face);
      batch.solid(new THREE.CylinderGeometry(0.039 * size, 0.043 * size, 0.068 * size, 6)
        .rotateY(heading).translate(wx, foot + 0.034 * size, wz), hoof);
    }

    const headY = grazing ? 0.30 : 1.04, headZ = grazing ? 0.77 : 0.59;
    part(wool, 0, grazing ? 0.51 : 0.85, grazing ? 0.51 : 0.43,
      0.116 + 0.066 * coat, grazing ? 0.32 : 0.25, 0.13 + 0.052 * coat, grazing ? -0.72 : 0.59);
    part(face, 0, headY, headZ, 0.103, 0.15, 0.12, grazing ? -0.22 : 0.52);
    part(0xb1a58c, 0, headY - 0.092, headZ + 0.062, 0.073, 0.064, 0.092);
    part(hoof, 0, headY - 0.095, headZ + 0.143, 0.050, 0.026, 0.017);
    for (const side of [-1, 1]) {
      part(face, side * 0.135, headY + 0.048, headZ - 0.046, 0.10, 0.025, 0.042, 0, -side * 0.23);
      part(0x32281e, side * 0.083, headY + 0.033, headZ + 0.063, 0.019, 0.020, 0.021);
    }
  }

  return batch;
}

function addSheepfoldFlock(group) {
  const flock = sheepfoldFlockBatch(0).mesh();
  const winter = sheepfoldFlockBatch(1);
  winter.geometry.setAttribute('position', new THREE.Float32BufferAttribute(winter.vertices, 3));
  winter.geometry.computeVertexNormals();
  flock.geometry.morphAttributes.position = [winter.geometry.attributes.position];
  flock.geometry.morphAttributes.normal = [winter.geometry.attributes.normal];
  flock.geometry.computeBoundingBox();
  flock.updateMorphTargets();
  flock.morphTargetInfluences = sheepFleeceInfluences;
  flock.name = 'Ginkelse Heide sheep flock';
  group.add(flock);
}

function addDeKlompPlatforms({ group, platforms }) {
  const slabs = new CivicBatch();
  const surface = (x, z) => {
    const railBase = nearbyRailHeightAt(x, z, 7);
    return railBase === undefined ? terrainHeightAt(x, z) + 0.78 : railBase + RAIL_TOP + 0.76;
  };
  for (const { id, points } of DE_KLOMP_PLATFORMS) {
    const clockwise = THREE.ShapeUtils.isClockWise(points.map(([x, z]) => new THREE.Vector2(x, z)));
    const outline = clockwise ? points : [...points].reverse();
    const top = outline.map(([x, z]) => [x, surface(x, z), z]);
    const outer = outline.map(([x, z]) => ({ x, z }));
    slabs.polygon([top], 0xb4ada0);
    for (let i = 0; i < top.length; i++) {
      const a = top[i], b = top[(i + 1) % top.length];
      const bottom = ([x, y, z]) => [x, Math.min(y - 0.23, terrainHeightAt(x, z) - 0.10), z];
      slabs.quad(a, bottom(a), bottom(b), b, 0x9d9689);
    }
    platforms.push({ id, outer, holes: [], height: surface });
  }
  const mesh = slabs.mesh();
  mesh.name = 'De Klomp railway platforms';
  group.add(mesh);
}

const signs = {
  'juffrouw-tok': { text: 'RESTAURANT', face: 'south', field: '#58312c', ink: '#ffe6b1' },
  mossel: { text: 'THEESCHENKERIJ', face: 'west', field: '#344131', ink: '#f1e9d8' },
  'planken-wambuis': { text: 'RESTAURANT', face: 'north', field: '#293929', ink: '#f9e7b9' },
  'veenendaal-de-klomp': { text: 'Veenendaal-De Klomp', face: 'north', field: '#1a4076', ink: '#ffffff' },
};

function createSignedBuilding(site) {
  const { text, face, field, ink } = signs[site.id];
  let signed = false;
  return createSurveyLandmark(site, EXPANSION_LANDMARK_SURVEYS[site.id], wall => {
    const { base, high, low, normal, width } = wall;
    if (low > base + 0.05 || high < base + 2.4 || width < 3) return;
    const bays = Math.max(1, Math.round(width / 3.5));
    for (let i = 0; i < bays; i++) {
      const middle = (i + 0.5) * width / bays;
      surveyWindow(wall, middle - 0.62, middle + 0.62, base + 0.8, base + 2.05,
        { color: 0x354b4d, frame: 0xb4aca0, columns: 2 });
    }
    const frontage = face === 'north' ? -normal.z : face === 'south' ? normal.z : -normal.x;
    if (signed || frontage < 0.65 || width < 4.25) return;
    const center = width / 2;
    const halfWidth = Math.min(width * 0.44, text.length * 0.135);
    const top = Math.min(base + 3.25, high - 0.10);
    if (top - 0.48 > base + 2.05) {
      surveyLabel(wall, center - halfWidth, center + halfWidth, top - 0.48, top, text, field, ink);
      signed = true;
    }
  }, site.id === 'veenendaal-de-klomp' ? addDeKlompPlatforms : undefined);
}

function addSheepfoldRoofs(trim) {
  const [main, small] = EXPANSION_LANDMARK_SURVEYS['schaapskooi-ginkelse-heide'];
  const tiles = [0xa15337, 0xa7593a, 0xb16341, 0x924d34];
  // The long roof slopes have clay tiles inset into the surrounding thatch.
  for (const [building, faces] of [[main, [[21, 0, 3, 18, 19], [22, 8, 20, 16, 22]]],
    [small, [[13, 5, 20, 1, 0], [14, 16, 7, 1, 0]]]]) {
    for (const [face, eaveA, eaveB, ridgeA, ridgeB] of faces) {
      const points = building.faces[face][1].map(i => building.points[i]);
      const n = polygonNormal(points);
      const [px, py, pz] = points[0];
      const [a, b, c, d] = [eaveA, eaveB, ridgeA, ridgeB].map(i => building.points[i]);
      const rows = building === main ? 11 : 6;
      const cols = building === main ? 40 : 13;
      function point(u, v) {
        const x = (a[0] + (b[0] - a[0]) * u) * (1 - v) + (c[0] + (d[0] - c[0]) * u) * v;
        const z = (a[2] + (b[2] - a[2]) * u) * (1 - v) + (c[2] + (d[2] - c[2]) * u) * v;
        return [x, py - (n.x * (x - px) + n.z * (z - pz)) / n.y + 0.035, z];
      }
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const u = 0.10 + col * 0.80 / cols, v = 0.06 + row * 0.71 / rows;
        const end = u + 0.79 / cols, top = v + 0.69 / rows;
        const tile = [point(u, v), point(end, v), point(end, top), point(u, top)];
        if (polygonNormal(tile).y < 0) tile.reverse();
        trim.quad(...tile, tiles[(row * 7 + col * 3 + Math.floor(col / 5)) % tiles.length]);
      }
    }
  }
}

// Opening positions are fractions of each surveyed wall face, followed by width,
// sill height, head height and the window's muntin layout.
const restaurantDetails = {
  'juffrouw-tok': {
    frame: 0x353932, glass: 0x42524d, signFace: 34, signHeight: 3.25,
    doors: [[82, 0.56, 1.42], [15, 0.16, 1.60]],
    faces: [{
      15: [[0.32, 2.12, 0.35, 2.41, 2], [0.49, 2.12, 0.35, 2.41, 2], [0.66, 2.12, 0.35, 2.41, 2], [0.83, 2.12, 0.35, 2.41, 2]],
      34: [[0.32, 1.12, 0.72, 2.27, 2, 2], [0.71, 1.12, 0.72, 2.27, 2, 2], [0.50, 1.06, 3.98, 5.08, 2]],
      43: [[0.23, 1.25, 0.82, 2.32, 2, 2], [0.47, 1.25, 0.82, 2.32, 2, 2], [0.74, 1.25, 0.82, 2.32, 2, 2]],
      74: [[0.27, 1.18, 0.78, 2.34, 2, 2], [0.73, 1.18, 0.78, 2.34, 2, 2]],
      82: [[0.25, 1.12, 0.78, 2.28, 2, 2], [0.82, 1.12, 0.78, 2.28, 2, 2], [0.56, 1.05, 3.61, 4.76, 2]],
      16: [[0.37, 1.08, 1.00, 2.33, 2], [0.57, 1.05, 4.23, 5.40, 2]],
    }],
    tables: [[4369.8, 959.0], [4370.0, 963.5], [4370.0, 968.2]],
  },
  mossel: {
    frame: 0x564337, glass: 0x505752, signFace: 30, signHeight: 3.02,
    doors: [[5, 0.39, 1.54]], barn: true,
    faces: [{
      0: [[0.58, 1.52, 0.98, 1.88, 1]],
      5: [[0.13, 2.85, 0.22, 2.59, 3], [0.61, 3.08, 0.22, 2.59, 3], [0.84, 3.05, 0.22, 2.59, 3]],
      8: [[0.50, 3.93, 0.14, 3.04, 3], [0.28, 1.59, 3.19, 4.69, 1]],
      12: [[0.51, 3.61, 0.14, 3.04, 3], [0.70, 1.46, 3.19, 4.77, 1]],
      24: [[0.30, 3.40, 0.23, 2.61, 3], [0.67, 3.40, 0.23, 2.61, 3], [0.87, 1.85, 0.23, 2.61, 2]],
      30: [[0.56, 2.04, 0.96, 2.26, 1], [0.58, 0.70, 3.82, 4.83, 1]],
    }, {
      2: [[0.31, 0.97, 0.65, 2.26, 2, 2], [0.73, 0.97, 0.65, 2.26, 2, 2], [0.49, 0.68, 3.11, 4.28, 2]],
      3: [[0.24, 1.00, 0.68, 2.26, 2, 2], [0.72, 1.00, 0.68, 2.26, 2, 2]],
      6: [[0.55, 0.90, 0.68, 2.26, 2, 2]],
      14: [[0.24, 1.04, 0.68, 2.26, 2, 2], [0.51, 1.04, 0.68, 2.26, 2, 2], [0.77, 1.04, 0.68, 2.26, 2, 2]],
    }],
    tables: [[6155.7, -1822.6], [6153.6, -1819.4], [6152, -1816.1]],
  },
  'planken-wambuis': {
    frame: 0x353e39, glass: 0x4c574f, signFace: 10, signHeight: 3.80,
    doors: [[17, 0.55, 1.55], [9, 0.22, 1.36]],
    faces: [{
      7: [[0.39, 1.29, 0.80, 2.43, 2, 2], [0.76, 1.21, 0.80, 2.43, 2, 2]],
      9: [[0.58, 1.59, 0.65, 2.54, 2, 2], [0.80, 0.89, 0.65, 2.54, 2]],
      10: [[0.26, 1.23, 0.72, 2.50, 2, 2], [0.66, 1.56, 0.72, 2.50, 2, 2], [0.24, 0.99, 4.70, 5.78, 2]],
      12: [[0.25, 1.28, 0.77, 2.32, 2, 2], [0.72, 1.28, 0.77, 2.32, 2, 2]],
      13: [[0.18, 2.54, 0.19, 2.53, 2], [0.50, 2.54, 0.19, 2.53, 2], [0.82, 2.54, 0.19, 2.53, 2]],
      16: [[0.27, 1.12, 0.73, 2.46, 2, 2], [0.70, 1.22, 0.73, 2.46, 2, 2]],
      17: [[0.15, 1.28, 0.74, 2.42, 2, 2], [0.35, 1.28, 0.74, 2.42, 2, 2], [0.72, 1.28, 0.74, 2.42, 2, 2], [0.89, 1.28, 0.74, 2.42, 2, 2]],
      19: [[0.22, 1.55, 0.76, 2.44, 2, 2], [0.51, 1.55, 0.76, 2.44, 2, 2], [0.79, 1.55, 0.76, 2.44, 2, 2]],
    }],
    tables: [[7864.6, 1711.9], [7862.9, 1715.4], [7860.5, 1719.0]],
  },
};

function buildRestaurant(site) {
  const style = restaurantDetails[site.id];
  const { text, field, ink } = signs[site.id];
  return createSurveyLandmark(site, EXPANSION_LANDMARK_SURVEYS[site.id], wall => {
    const { base, buildingIndex, faceIndex, high, low, width } = wall;
    for (const [at, span, sill, head, columns, rows] of style.faces[buildingIndex]?.[faceIndex] ?? []) {
      const center = width * at;
      const frame = style.barn && buildingIndex ? 0x404b3a : style.frame;
      surveyWindow(wall, center - span / 2, center + span / 2, base + sill, base + head,
        { color: style.glass, frame, columns, rows });
    }
    if (!buildingIndex) {
      const entrance = style.doors.find(([face]) => face === faceIndex);
      if (entrance) {
        const [, at, span] = entrance, center = width * at;
        surveyPanel(wall, center - span / 2, center + span / 2, base + 0.02, base + 2.22, style.frame);
        surveyWindow(wall, center - span * 0.40, center + span * 0.40, base + 0.40,
          base + 2.10, { color: style.glass, frame: style.frame, columns: 2 });
      }
      if (faceIndex === style.signFace) {
        const middle = width * 0.49, half = Math.min(width * 0.32, 1.48);
        surveyLabel(wall, middle - half, middle + half, base + style.signHeight - 0.34,
          base + style.signHeight, text, field, ink);
      }
    }
    if (low <= base + 0.05 && high >= base + 1 && width > 1.5) {
      if (style.barn && !buildingIndex) {
        for (let u = 0.17; u < width - 0.1; u += 0.20) {
          surveyPanel(wall, u, u + 0.014, base + 0.08, base + Math.min(2.88, high - base - 0.14), 0x38332b, 0.014);
        }
      } else {
        surveyPanel(wall, 0.02, width - 0.02, base + 0.03, base + 0.33, 0x6d6152, 0.017);
      }
    }
  }, ({ trim }) => {
    for (const [x, z] of style.tables) {
      const y = terrainHeightAt(x, z);
      const picnic = site.id === 'mossel';
      const wood = picnic ? 0x97714b : 0x6f5843;
      box(trim, x, y + 0.76, z, 1.55, 0.07, 0.72, wood);
      for (const side of [-1, 1]) {
        box(trim, x + side * 0.53, y + 0.36, z, 0.095, 0.72, 0.39, 0x564c3f);
        if (picnic) {
          box(trim, x, y + 0.43, z + side * 0.61, 1.55, 0.07, 0.28, wood);
        } else {
          box(trim, x, y + 0.47, z + side * 0.66, 0.48, 0.09, 0.45, wood);
          box(trim, x, y + 0.72, z + side * 0.88, 0.49, 0.50, 0.075, wood);
          box(trim, x, y + 0.23, z + side * 0.68, 0.12, 0.46, 0.28, 0x4d473d);
        }
      }
    }
  });
}

function createDoesburgermolen(footprints, site) {
  const { x, z } = site;
  const y = terrainHeightAt(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = -1.46;
  const { cap, sails } = createWindmillRig(group, 11.65, 3.13, 0);
  sails.rotation.z = 0.34;

  const base = new CivicBatch();
  const mill = new CivicBatch();
  // The buck and its access steps turn on the post above the fixed thatched base.
  const skirt = new THREE.CylinderGeometry(1.9, 3.15, 3.9, 12).translate(0, 1.95, 0);
  base.solid(skirt, 0x65533a);
  group.add(base.mesh());
  box(mill, 0, 7.05, 0.15, 4.55, 6.7, 5.65, 0x352c24);
  const roof = new THREE.CylinderGeometry(0, 1, 1.6, 4)
    .rotateY(Math.PI / 4).scale(3.65, 1, 4.45).translate(0, 11.20, 0.1);
  mill.solid(roof, 0x544639);
  for (let i = -5; i <= 5; i++) {
    box(mill, 0.39 * i, 7.05, 2.986, 0.05, 6.55, 0.035, 0x4a3e31);
  }
  box(mill, 0, 7.78, 2.99, 1.08, 1.3, 0.10, 0xddd4b8);
  box(mill, 0, 7.78, 3.06, 0.82, 1.04, 0.07, 0x363c37);
  for (let i = 0; i < 13; i++) {
    box(mill, 0, 0.22 + i * 0.27, -7.2 + i * 0.33, 1.15, 0.13, 0.30, 0x564739);
  }
  cap.add(mill.mesh());

  // The Nederlandse Molendatabase records a 22.7 m sail span (mill 00856).
  const radius = 11.35;
  const lattices = new CivicBatch();
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const strut = (across, radial, width, length, depth, color) => {
      lattices.solid(new THREE.BoxGeometry(width, length, depth).rotateZ(angle)
        .translate(-across * c - radial * s, -across * s + radial * c, 0), color);
    };
    strut(0, radius / 2, 0.16, radius, 0.16, 0x48382a);
    strut(1.13, 6.55, 0.07, 9.6, 0.08, 0x574333);
    for (let i = 0; i < 19; i++) strut(0.56, 1.9 + i * 0.51, 1.15, 0.045, 0.06, 0x655441);
  }
  sails.add(lattices.mesh());
  addWindmillSailcloth(sails, { angle: Math.PI / 2, radii: [radius], root: 1.9, innerWidth: 1.18, outerWidth: 1.18 });
  const { outer, holes } = footprints[0];
  group.userData.colliders = [{
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: y, maxY: y + 12.2, polygon: { outer, holes },
  }];
  return group;
}

function createAirborneMonument() {
  // Nationaal Comité 4 en 5 mei records a concrete column topped by a copper eagle.
  const monument = new CivicBatch();
  box(monument, 0, 0.12, 0, 1.1, 0.24, 0.98, 0x9b9c91);
  box(monument, 0, 1.44, 0, 0.30, 2.64, 0.30, 0xb9b8a9);
  box(monument, 0, 1.25, 0.154, 0.23, 0.39, 0.02, 0x594b39);
  const bronze = 0x6e563d;
  box(monument, 0, 2.80, 0, 0.14, 0.28, 0.15, bronze);
  for (const side of [-1, 1]) {
    const point = (x, y, z) => [x * side, y, z];
    const tips = [point(0.03, 2.89, 0.03), point(0.62, 3.04, -0.06),
      point(0.47, 2.85, -0.13), point(0.05, 2.79, -0.10)];
    monument.quad(...tips, bronze);
    monument.quad(...tips.slice().reverse(), bronze);
  }
  return makeGroup('Airborne Monument Ginkelse Heide', monument, null);
}

function memorialColliders(site, from, to, offset, thickness, height) {
  const sin = Math.sin(site.heading), cos = Math.cos(site.heading);
  const point = u => ({ x: site.x + u * cos + offset * sin, z: site.z - u * sin + offset * cos });
  const ground = terrainHeightAt(site.x, site.z);
  return wallColliders(point(from), point(to), ground - 0.16, ground + height, thickness);
}

function createVensters(_, site) {
  const batch = new CivicBatch();
  const steel = [0x804422, 0x955431, 0x864626, 0x8a4828, 0x7b3c22];
  const width = 1.68, pitch = 1.72, bottom = 0.46, header = 0.148, stile = 0.09;
  const panels = [
    [42, 299, 163], [323, 595, 119], [619, 918, 73], [942, 1215, 119], [1239, 1495, 163],
  ];
  const vertices = [], uv = [], indices = [];
  const edge = width / 2;
  for (const [i, [left, right, upper]] of panels.entries()) {
    const index = i - 2, center = index * pitch, color = steel[i];
    const top = site.height - Math.abs(index) * 0.2;
    for (const side of [-1, 1]) {
      box(batch, center + side * (edge - stile / 2), (top + bottom) / 2, 0, stile, top - bottom, 0.075, color);
    }
    box(batch, center, top - header / 2, 0, width, header, 0.075, color);
    box(batch, center, bottom + 0.20, 0, width, 0.40, 0.044, color);
    box(batch, center, 0.055, 0.50, width, 0.23, 1.37, 0xb1aa97);
    const a = center - edge + 0.025, b = center + edge - 0.025;
    batch.quad([a, bottom, -0.13], [a, 0.17, 1.15], [b, 0.17, 1.15], [b, bottom, -0.13], 0xc2b9a5);
    batch.quad([a + 0.14, 0.425, 0.03], [a + 0.14, 0.214, 0.97], [b - 0.14, 0.214, 0.97],
      [b - 0.14, 0.425, 0.03], color);

    // Sample just the five infills. The artwork sits behind the lips of the steel frames.
    const x0 = center - edge + stile - 0.008, x1 = center + edge - stile + 0.008;
    const y1 = top - header + 0.008;
    const u0 = left / 1536, u1 = right / 1536, v0 = 1 - 965 / 1024, v1 = 1 - upper / 1024;
    const vertex = vertices.length / 3;
    vertices.push(x0, bottom, 0, x1, bottom, 0, x1, y1, 0, x0, y1, 0);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  }
  const limit = pitch * 2 + edge;
  const group = makeGroup(site.name, batch, memorialColliders(site, -limit, limit, 0.42, 1.48, site.height));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide, shadowSide: THREE.DoubleSide, roughness: 0.93, alphaTest: 0.34, visible: false,
  });
  const cutouts = new THREE.Mesh(geometry, material);
  cutouts.name = 'Vensters steel openwork';
  cutouts.castShadow = cutouts.receiveShadow = true;
  group.add(cutouts);
  if (typeof document !== 'undefined') {
    new THREE.TextureLoader().load('./assets/ede-vensters-openwork.webp', map => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      material.map = map;
      material.needsUpdate = true;
      material.visible = true;
    });
  }
  return group;
}

function createHuzarenMonument(_, site) {
  const batch = new CivicBatch();
  const brick = [0x916752, 0x966e5b, 0x8c6051, 0x9e7760];
  const width = 1.93, head = 1.32, depth = 0.45;
  box(batch, 0, 0.55, 0, width, 1.24, depth, 0x9a9080);
  for (let row = 0; row < 18; row++) {
    for (let col = 0; col < 9; col++) {
      const left = Math.max(-width / 2, -width / 2 + (col - (row % 2) * 0.5) * 0.24);
      const right = Math.min(width / 2, -width / 2 + (col + 1 - (row % 2) * 0.5) * 0.24) - 0.009;
      if (right <= left) continue;
      box(batch, (left + right) / 2, 0.04 + row * 0.064, 0.227, right - left, 0.056, 0.019, brick[(row * 3 + col * 7) % 4]);
    }
  }
  box(batch, 0, 1.19, 0, width + 0.07, 0.16, depth + 0.055, 0x504744);
  box(batch, 0, 0.82, 0.242, 1.5, 0.50, 0.08, 0xaaa79b);
  for (const y of [0.587, 1.057]) {
    batch.solid(new THREE.CylinderGeometry(0.033, 0.033, 1.48, 8).rotateZ(Math.PI / 2)
      .translate(0, y, 0.266), 0xb6b1a2);
  }
  for (const x of [-1.37, -2.34]) box(batch, x, 0.48, 0.70, 0.07, 0.96, 0.08, 0x6f6c5f);
  batch.solid(new THREE.BoxGeometry(1.18, 0.062, 0.49).rotateX(-0.38).translate(-1.86, 0.96, 0.70), 0xb5b3a5);
  batch.solid(new THREE.BoxGeometry(1.08, 0.015, 0.38).rotateX(-0.38).translate(-1.86, 0.998, 0.70), 0xd4d6ca);

  const group = makeGroup(site.name, batch, [
    ...memorialColliders(site, -width / 2, width / 2, 0, depth, head),
    ...memorialColliders(site, -2.43, -1.29, 0.70, 0.36, 1.05),
  ]);
  const lines = ['10 MEI 1940', 'C.E. GRAAF VAN LIMBURG STIRUM', 'P.CH. BONKERK', 'J.G. DIJKERS'];
  const text = civicSigns(lines.map((line, i) => ({
    text: line, color: '#aaa79b', textColor: '#69665b',
    a: { x: -0.73, z: 0.283 }, b: { x: 0.73, z: 0.283 },
    lo: 0.93 - i * 0.097, hi: 1.025 - i * 0.097,
  })), { wide: true });
  if (text) {
    text.userData.nearDetail = 75;
    group.add(text);
  }
  return group;
}

export const EXPANSION_LANDMARK_FACTORIES = {
  'schaapskooi-ginkelse-heide': (_, site) => createSurveyLandmark(site, EXPANSION_LANDMARK_SURVEYS[site.id], sheepfoldWall, details => {
    addSheepfoldFences(details);
    addSheepfoldRoofs(details.trim);
    addSheepfoldFlock(details.group);
  }),
  'juffrouw-tok': (_, site) => buildRestaurant(site),
  doesburgermolen: createDoesburgermolen,
  mossel: (_, site) => buildRestaurant(site),
  'planken-wambuis': (_, site) => buildRestaurant(site),
  'veenendaal-de-klomp': (_, site) => createSignedBuilding(site),
  'airborne-monument-ginkel': createAirborneMonument,
  'vensters-op-het-verleden': createVensters,
  huzarenmonument: createHuzarenMonument,
};
