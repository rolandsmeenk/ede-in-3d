import * as THREE from 'three/webgpu';
import { attribute, smoothstep } from 'three/tsl';
import { CivicBatch } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';
import { cityUniforms } from './tsl-materials.js';

const turn = 2 * Math.PI;
const warmWhite = 0xffdb94;
const galvanized = 0x8c8f8c;
const flagColors = { airborne: 0x70263c, heideweek: 0x664297, kingsDay: 0xf47722 };

// Representative fixings on the surveyed Markt and Oude Kerkplein facades.
const centreMounts = [
  [-106.10, -27.95, 2.65, -0.50, -0.87],
  [-120.50, -19.71, 2.65, -0.50, -0.87],
  [-134.05, -12.52, 2.65, -0.50, -0.87],
  [-145.25, -5.58, 2.65, -0.50, -0.87],
  [-76.72, -64.07, 2.86, -0.79, -0.61],
  [-84.33, -54.13, 2.86, -0.79, -0.61],
  [-21.90, 32.76, 3.41, 0.50, -0.87],
  [2.17, 43.80, 3.22, 0.39, -0.92],
  [16.06, 47.81, 3.44, 0.24, -0.97],
  [31.19, 49.04, 3.39, 0.39, -0.92],
  [0.75, -39.66, 3.45, -0.19, 0.98],
  [13.61, -37.18, 3.45, -0.19, 0.98],
];

// Eight light points on the straight Tuinderslaan run in the baked lamp inventory.
const tuinderslaan = [
  [-1239, 1190.6], [-1214, 1172], [-1190.4, 1154.4], [-1167, 1137.2],
  [-1139, 1116], [-1114.6, 1097.6], [-1089, 1078], [-1062, 1058.2],
];

export function edeSeasonalVisibility(dateKey, season) {
  const preview = !dateKey && season === 'winter';
  const monthDay = dateKey?.slice(5) ?? '';
  const heideweek = Boolean(dateKey >= '2026-08-10' && dateKey <= '2026-08-29');
  const winter = preview || Boolean(dateKey >= '2025-12-01' && (monthDay >= '12-01' || monthDay <= '01-06'));
  let kingsDay = false;
  if (monthDay === '04-26' || monthDay === '04-27') {
    const april27 = new Date(dateKey.slice(0, 4) + '-04-27T00:00:00Z');
    kingsDay = dateKey >= '2018-04-26' && monthDay === (april27.getUTCDay() === 0 ? '04-26' : '04-27');
  }
  return {
    heideweek,
    airborne: monthDay.startsWith('09-'),
    kingsDay,
    winter,
    marketLights: preview || Boolean(dateKey >= '2025-11-15' && dateKey <= '2026-01-06'),
    christmasMarket: dateKey === '2026-12-19',
  };
}

function cylinderBetween(batch, a, b, radius, tint) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  const transform = new THREE.Matrix4().compose(start.lerp(end, 0.5), rotation, new THREE.Vector3(1, 1, 1));
  batch.solid(new THREE.CylinderGeometry(radius, radius, length, 5).applyMatrix4(transform), tint);
}

function bulb(batch, [x, y, z], radius = 0.027, tint = warmWhite) {
  batch.solid(new THREE.OctahedronGeometry(radius).translate(x, y, z), tint);
}

function wire(frame, lights, points, radius = 0.017, spacing = 0.13, bulbRadius = radius * 1.9) {
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1], end = points[i];
    cylinderBetween(frame, start, end, radius, 0x645b45);
    const difference = end.map((value, axis) => value - start[axis]);
    const count = Math.max(1, Math.round(Math.hypot(...difference) / spacing));
    for (let j = 0; j < count; j++) {
      bulb(lights, start.map((value, axis) => value + difference[axis] * j / count), bulbRadius);
    }
  }
}

function addFlag(hardware, cloth, [x, z, y, nx, nz], theme, scale = 1) {
  const start = [x, y, z];
  const tip = [x + nx * 1.38 * scale, y + 0.86 * scale, z + nz * 1.38 * scale];
  cylinderBetween(hardware, start, tip, 0.020, 0x545658);
  const point = (u, v, offset = 0) => {
    const out = (0.25 + 1.13 * u - 0.23 * u * v) * scale;
    const drape = (0.075 * Math.sin(u * turn * 1.5) * v + offset) * scale;
    return [x + nx * out - nz * drape, y + (0.16 + 0.70 * u - 0.94 * v) * scale, z + nz * out + nx * drape];
  };
  for (let i = 0; i < 8; i++) {
    const a = i / 8, b = (i + 1) / 8;
    cloth.quad(point(a, 0), point(a, 1), point(b, 1), point(b, 0), flagColors[theme]);
  }
  if (theme === 'kingsDay') return;
  for (const side of [-1, 1]) {
    const at = ([u, v]) => point(u, v, side * 0.012);
    if (theme === 'airborne') {
      // A restrained Pegasus silhouette on the maroon cloth.
      cloth.polygon([[
        [0.57, 0.46], [0.61, 0.34], [0.73, 0.30], [0.79, 0.35], [0.71, 0.41],
        [0.69, 0.49], [0.78, 0.50], [0.83, 0.60], [0.80, 0.66], [0.73, 0.56],
        [0.66, 0.56], [0.60, 0.64], [0.50, 0.64], [0.44, 0.75], [0.35, 0.78],
        [0.32, 0.73], [0.41, 0.70], [0.45, 0.58], [0.33, 0.58], [0.23, 0.50],
        [0.25, 0.45], [0.35, 0.51], [0.46, 0.48], [0.34, 0.27], [0.46, 0.35],
        [0.46, 0.20], [0.54, 0.32],
      ].map(at)], 0xb5d3e9);
    } else {
      // A spray of heather blossoms gives the festival flags their purple-and-pink accent.
      for (let i = 0; i < 4; i++) {
        const u = 0.40 + i * 0.065, v = 0.68 - i * 0.11;
        cloth.quad(at([u - 0.085, v]), at([u, v - 0.07]), at([u + 0.085, v]),
          at([u, v + 0.07]), i % 2 ? 0xf1d7ef : 0xde97d7);
      }
    }
  }
}

function matchTuinderslaanLamps(lamps) {
  const supports = [];
  for (const [x, z] of tuinderslaan) {
    const lamp = lamps.find(point => !point.layer && Math.hypot(point.x - x, point.z - z) < 0.55);
    if (!lamp || (lamp.height ?? 8.2) < 4.2) continue;
    const base = lamp.baseY ?? terrainHeightAt(lamp.x, lamp.z);
    // The plan describes holders, with no measured bracket height. Limit use to the mapped poles.
    supports.push([lamp.x, lamp.z, base + 3.55, lamp.nx ?? 0.60, lamp.nz ?? 0.80]);
  }
  return supports;
}

function addConeLights(frame, lights, x, y, z, height, radius) {
  const top = [x, y + height, z];
  const baseY = y + 0.19;
  for (let i = 0; i < 10; i++) {
    const angle = turn * i / 10;
    const base = [x + Math.cos(angle) * radius, baseY, z + Math.sin(angle) * radius];
    const between = base.map((value, axis) => (value + top[axis]) / 2);
    between[1] -= 0.14;
    wire(frame, lights, [base, between, top], 0.011, 0.17, 0.034);
  }
}

function addMarketLights(frame, lights) {
  // A representative wire deer with legs, a caged body and branched antlers.
  const x = -94, z = -78;
  const y = terrainHeightAt(x, z);
  const path = (points) => wire(frame, lights, points.map(([u, v, w]) => [x + u, y + v, z + w]));
  const body = [[-0.92, 1.22, 0.28], [-0.38, 1.22, 0.43], [0.25, 1.25, 0.43], [0.72, 1.38, 0.28]];
  for (const [u, v, radius] of body) {
    path(Array.from({ length: 11 }, (_, i) => [u, v + Math.cos(i * turn / 10) * radius, Math.sin(i * turn / 10) * radius]));
  }
  for (let i = 0; i < 6; i++) {
    const angle = i * turn / 6;
    path(body.map(([u, v, radius]) => [u, v + Math.cos(angle) * radius, Math.sin(angle) * radius]));
  }
  for (const side of [-1, 1]) {
    const w = side * 0.25;
    path([[-0.77, 1.12, w], [-0.62, 0.55, w], [-0.91, 0.08, w], [-0.71, 0.08, w]]);
    path([[0.5, 1.12, w], [0.66, 0.54, w], [0.58, 0.08, w], [0.78, 0.08, w]]);
    path([[0.55, 1.18, w], [0.84, 1.66, w], [0.96, 2.11, w * 0.66], [1.17, 2.14, w * 0.65],
      [1.51, 1.91, w * 0.46], [1.29, 1.87, w * 0.48], [0.95, 1.94, w * 0.66], [0.73, 1.56, w]]);
    path([[1.03, 2.12, w * 0.55], [0.87, 2.29, w * 1.4], [0.66, 2.53, w * 2.0],
      [0.65, 2.78, w * 2.23]]);
    path([[0.80, 2.38, w * 1.64], [0.98, 2.61, w * 2], [0.97, 2.80, w * 2.33]]);
    path([[0.67, 2.53, w * 2.0], [0.44, 2.68, w * 2.24], [0.43, 2.85, w * 2.46]]);
  }
  path([[-0.90, 1.40, 0], [-1.21, 1.56, 0], [-1.29, 1.63, 0]]);
  for (const [x, z, y, nx, nz] of centreMounts.slice(0, 4)) {
    const anchor = [x + nx * 0.62, y + 1.32, z + nz * 0.62];
    cylinderBetween(frame, [x, y + 1.32, z], anchor, 0.015, galvanized);
    const heart = Array.from({ length: 31 }, (_, i) => {
      const angle = (i * turn / 30) - 0.05;
      const sin = Math.sin(angle);
      const u = 0.028 * 16 * sin ** 3;
      const v = 0.029 * (13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle));
      return [anchor[0] - nz * u, anchor[1] - 0.49 + v, anchor[2] + nx * u];
    });
    cylinderBetween(frame, anchor, heart[0], 0.012, galvanized);
    wire(frame, lights, heart, 0.012, 0.10);
  }
}

function addChurchMarket(frame, lights) {
  const x = -26, z = 5.6, y = terrainHeightAt(x, z);
  frame.solid(new THREE.CylinderGeometry(0.19, 0.28, 2.0, 7).translate(x, y + 1, z), 0x5d442e);
  for (let i = 0; i < 6; i++) {
    const radius = 2.23 - i * 0.32;
    const level = y + 1.15 + i * 0.86;
    frame.solid(new THREE.ConeGeometry(radius, 2.10, 13).rotateY(i * 0.42).translate(x, level + 1.05, z),
      i % 2 ? 0x2d5139 : 0x365c43);
    for (let j = 0; j < 28 - 3 * i; j++) {
      const angle = turn * j / (28 - 3 * i) + i * 0.60, r = radius + 0.018;
      bulb(lights, [x + Math.cos(angle) * r, level + 0.025, z + Math.sin(angle) * r], 0.049);
    }
  }
  for (const [sx, sz, awning] of [[-13, 30, 0x872b30], [3, 33, 0xc4ae86], [19, 37, 0x395c47]]) {
    const sy = terrainHeightAt(sx, sz);
    const box = (w, h, d, x, y, z, tint) => frame.solid(new THREE.BoxGeometry(w, h, d).translate(x, y, z), tint);
    for (const dx of [-1.05, 1.05]) {
      for (const dz of [-0.76, 0.76]) box(0.10, 2.12, 0.10, sx + dx, sy + 1.06, sz + dz, 0x5b3a24);
    }
    box(2.22, 0.79, 0.12, sx, sy + 0.40, sz - 0.76, 0x795036);
    box(2.25, 0.10, 0.57, sx, sy + 0.83, sz - 0.67, 0x9d6d48);
    const front = sz - 0.96, back = sz + 0.96;
    for (const dz of [-1, 1]) {
      const low = dz < 0 ? front : back;
      frame.quad([sx - 1.23, sy + 2.05, low], [sx - 1.23, sy + 2.61, sz],
        [sx + 1.23, sy + 2.61, sz], [sx + 1.23, sy + 2.05, low], awning);
    }
    for (let i = 0; i < 11; i++) bulb(lights, [sx - 1.14 + i * 0.228, sy + 2.01, front], 0.033);
  }
}

export function buildEdeSeasonalDecorations(scene, lampSupports = []) {
  const sites = [];
  const dusk = smoothstep(0.40, 1.15, cityUniforms.uInteriorGlow);
  const lightMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.66 });
  lightMaterial.emissiveNode = attribute('color', 'vec3').mul(dusk.mul(3.0));
  const clothMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
  const tin = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.74, side: THREE.DoubleSide });

  function addSite(name, activity, x, z, radius, build, accentMaterial = lightMaterial) {
    const frame = new CivicBatch(), accent = new CivicBatch();
    build(frame, accent);
    if (!frame.vertices.length && !accent.vertices.length) return;
    const group = new THREE.Group();
    group.name = name;
    group.visible = false;
    for (const [batch, material] of [[frame, tin], [accent, accentMaterial]]) {
      if (!batch.vertices.length) continue;
      const mesh = batch.mesh();
      mesh.material.dispose();
      mesh.material = material;
      mesh.castShadow = mesh.receiveShadow = false;
      group.add(mesh);
    }
    scene.add(group);
    sites.push({ group, activity, x, z, range2: radius * radius });
  }

  const centreFlags = theme => (frame, cloth) => {
    for (const mount of centreMounts) addFlag(frame, cloth, mount, theme);
  };
  addSite('Heideweek · Centrum flags', 'heideweek', -61, 2, 215, centreFlags('heideweek'), clothMaterial);
  addSite('Airborne · Centrum flags', 'airborne', -61, 2, 215, centreFlags('airborne'), clothMaterial);
  addSite('Markt · 2025 winter lights', 'marketLights', -110, -62, 155, addMarketLights);
  addSite('Oude Kerk · Christmas market', 'christmasMarket', -6, 18, 145, addChurchMarket);

  const mounts = matchTuinderslaanLamps(lampSupports);
  for (const [name, theme] of [['Heideweek decorations', 'heideweek'], ['Koningsdag flags', 'kingsDay']]) {
    addSite('Tuinderslaan · ' + name, theme, -1145, 1120, 200, (frame, cloth) => {
      for (const mount of mounts) addFlag(frame, cloth, mount, theme, 0.82);
    }, clothMaterial);
  }
  addSite('Tuinderslaan · winter decorations', 'winter', -1145, 1120, 200, (frame, lights) => {
    for (const [x, z, y, nx, nz] of mounts) {
      const point = (along, down, side) => [x + nx * along - nz * side, y - down, z + nz * along + nx * side];
      cylinderBetween(frame, point(0, 0, 0), point(0.34, -0.23, 0), 0.025, galvanized);
      for (const side of [-1, 1]) {
        wire(frame, lights, [point(0.08, 0, 0), point(0.33, 0.25, side * 0.23),
          point(0.64, 0.20, side * 0.19), point(0.88, -0.04, side * 0.08)], 0.014);
      }
    }
  });

  const x = 208.7, z = 2422.6, y = terrainHeightAt(x, z);
  addSite('Papierstraat / Oliestraat · flagpole', undefined, x, z, 130, frame => {
    frame.solid(new THREE.CylinderGeometry(0.045, 0.075, 5.6, 8).translate(x, y + 2.8, z), 0xe5e5e0);
    frame.solid(new THREE.SphereGeometry(0.085, 8, 6).translate(x, y + 5.62, z), 0xe5e5e0);
  });
  addSite('Papierstraat / Oliestraat · Christmas light cone', 'winter', x, z, 130,
    (frame, lights) => addConeLights(frame, lights, x, y, z, 5.38, 1.58));

  let flags = edeSeasonalVisibility();
  let lastDate, lastSeason, camera;
  function refresh() {
    if (!camera) return;
    for (const { group, activity, x, z, range2 } of sites) {
      group.visible = (!activity || flags[activity]) && (camera.x - x) ** 2 + (camera.z - z) ** 2 < range2;
    }
  }
  return {
    update(dateKey, season) {
      if (dateKey === lastDate && season === lastSeason) return;
      lastDate = dateKey;
      lastSeason = season;
      flags = edeSeasonalVisibility(dateKey, season);
      refresh();
    },
    updateView(cameraPosition) {
      camera = cameraPosition;
      refresh();
    },
  };
}
