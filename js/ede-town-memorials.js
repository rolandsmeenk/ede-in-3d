import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';

function box(batch, x, y, z, width, height, depth, color) {
  batch.solid(new THREE.BoxGeometry(width, height, depth).translate(x, y, z), color);
}

function rod(batch, a, b, startRadius, endRadius, color) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const direction = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
  batch.solid(new THREE.CylinderGeometry(endRadius, startRadius, axis.length(), 10)
    .applyQuaternion(direction).translate(...start.lerp(end, 0.5)), color);
}

function addInscriptions(group, plaques) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  const edge = 256;
  canvas.width = edge * plaques.length;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  const positions = [], uvs = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  plaques.forEach(({ center: [x, y, z], width, height, lines, color, tilt = 0, font = 'sans-serif' }, i) => {
    const spacing = Math.min(76, 200 / lines.length);
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.floor(spacing * 0.7)}px ${font}`;
    lines.forEach((line, row) => ctx.fillText(line, (i + 0.5) * edge,
      edge / 2 + (row - (lines.length - 1) / 2) * spacing, edge - 22));
    const dy = Math.cos(tilt) * height / 2, dz = Math.sin(tilt) * height / 2;
    const corners = [[x - width / 2, y - dy, z + dz], [x + width / 2, y - dy, z + dz],
      [x + width / 2, y + dy, z - dz], [x - width / 2, y + dy, z - dz]];
    const u = i / plaques.length, v = (i + 1) / plaques.length;
    const coords = [[u, 0], [v, 0], [v, 1], [u, 1]];
    for (const j of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[j]);
      uvs.push(...coords[j]);
    }
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map, alphaTest: 0.48, roughness: 0.78 }));
  mesh.receiveShadow = true;
  mesh.userData.nearDetail = 30;
  group.add(mesh);
}

function buildMemorial(site, draw, castShadow = true) {
  const batch = new CivicBatch(), colliders = [], plaques = [];
  const y = terrainHeightAt(site.x, site.z);
  const cs = Math.cos(site.heading), sn = Math.sin(site.heading);
  const world = (x, z) => ({ x: site.x + x * cs + z * sn, z: site.z - x * sn + z * cs });
  const ground = (x, z) => {
    const point = world(x, z);
    return terrainHeightAt(point.x, point.z) - y;
  };
  const obstacle = (x, z, width, height, depth) => {
    const base = y + ground(x, z);
    colliders.push(...wallColliders(world(x - width / 2, z), world(x + width / 2, z),
      base - 0.08, base + height, depth));
  };
  draw(batch, plaques, ground, obstacle);
  const group = makeGroup(site.name, batch, colliders);
  group.position.set(site.x, y, site.z);
  group.rotation.y = site.heading;
  group.children[0].castShadow = castShadow;
  if (plaques.length) addInscriptions(group, plaques);
  return group;
}

const bricks = [0x895851, 0x975d50, 0x8b5848, 0x7b514b, 0x9b6a5e];

function brickStela(batch, x, base, z, tierDirection) {
  const width = 0.91, depth = 0.43, course = 0.111;
  const coreHeight = tierDirection ? 14 * course : 18 * course;
  box(batch, x, base + coreHeight / 2 - 0.04, z, width - 0.009, coreHeight + 0.08, depth - 0.009, 0x97867e);
  for (let row = 0; row < 18; row++) {
    const inset = Math.max(0, row - 13) * 0.165;
    const from = tierDirection < 0 ? inset : 0, to = tierDirection > 0 ? width - inset : width;
    const y = base + (row + 0.5) * course;
    for (let i = -1; i < 4; i++) {
      const start = Math.max(from, (i - 0.5 * (row % 2)) * 0.246);
      const end = Math.min(to, (i + 1 - 0.5 * (row % 2)) * 0.246);
      if (end - start < 0.019) continue;
      // Keep the mortar joints visible on all faces, with a continuous core behind them.
      box(batch, x - width / 2 + (start + end) / 2, y, z, end - start - 0.008,
        course - 0.009, depth, bricks[(row + 2 * (i + 1)) % bricks.length]);
    }
    if (tierDirection && row >= 14) {
      box(batch, x - width / 2 + (from + to) / 2, y - course / 2, z,
        to - from - 0.012, 0.010, depth - 0.008, 0x97867e);
    }
  }
}

const aircraft = [
  [-0.07, -0.43], [0.07, -0.43], [0.10, -0.10], [0.52, 0.02], [0.53, 0.12],
  [0.12, 0.07], [0.07, 0.38], [0.21, 0.44], [0.21, 0.50], [-0.21, 0.50],
  [-0.21, 0.44], [-0.07, 0.38], [-0.12, 0.07], [-0.53, 0.12], [-0.52, 0.02], [-0.10, -0.10],
];

function bombingMemorial(site) {
  return buildMemorial(site, (batch, plaques, ground, obstacle) => {
    const approachPaving = [[-2.75, -0.2], [-2.6, 0.9], [-1.3, 1.43], [-0.76, 2.62], [-0.75, 5.4],
      [0.80, 5.4], [0.82, 2.62], [1.45, 1.49], [2.65, 1.41], [2.45, -0.52], [0.75, -0.70], [-1.45, -0.69]];
    batch.polygon([approachPaving.map(([x, z]) => [x, ground(x, z) + 0.058, z])], 0x938477);
    const stelae = [
      { x: -1.60, z: 0.03, tier: -1, lines: ['SLACHTOFFERS VAN DE', 'OCHTENDBOMBARDEMENTEN', '17 SEPTEMBER 1944'] },
      { x: 0, z: -0.27, tier: 0, lines: ['17 SEPTEMBER 1944', 'Ter nagedachtenis aan de burgers',
        'die omkwamen bij de geallieerde', 'bombardementen op Ede.'] },
      { x: 1.60, z: 0.03, tier: 1, lines: ['SLACHTOFFERS VAN DE', 'MIDDAGBOMBARDEMENTEN', '17 SEPTEMBER 1944'] },
    ];
    for (const { x, z, tier, lines } of stelae) {
      const base = ground(x, z) + 0.055;
      brickStela(batch, x, base, z, tier);
      const height = tier ? 1.29 : 0.72, centerY = base + (tier ? 0.90 : 1.38);
      box(batch, x, centerY, z + 0.222, 0.69, height, 0.021, 0x212321);
      plaques.push({ center: [x, centerY, z + 0.234], width: 0.65, height: height * 0.72, lines, color: '#d1d0ca' });
      obstacle(x, z, 0.91, 2.05, 0.43);
    }

    const base = ground(0.31, -0.73);
    const wingY = base + 4.18;
    rod(batch, [0.31, base, -0.73], [-0.09, wingY, -0.83], 0.067, 0.059, 0x8c8b81);
    obstacle(0.31, -0.73, 0.14, 3.4, 0.14);
    const outline = [[-1.50, -0.10], [-1.36, -0.25], [-0.78, -0.25], [-0.22, -0.16], [0.08, -0.17],
      [0.72, -0.42], [1.44, -0.48], [1.54, -0.38], [1.39, -0.07], [0.88, 0.18],
      [0.33, 0.29], [0.03, 0.25], [-0.61, 0.13], [-1.42, 0.02]];
    const holes = [[0.46, 0.05, 0.21], [0.85, -0.05, 0.30], [1.21, -0.19, 0.31]]
      .map(([x, z, scale]) => aircraft.map(([u, v]) => [x + u * scale, z + v * scale]));
    const rings = [outline, ...holes].map(ring => ring.map(([x, z]) =>
      [x, wingY + 0.13 - 0.06 * x - 0.26 * z, z - 0.83]));
    const bottom = rings.map(ring => ring.map(([x, y, z]) => [x, y - 0.027, z]));
    batch.polygon(rings.map(ring => [...ring].reverse()), 0x716f62);
    batch.polygon(bottom, 0x625f51);
    for (const [i, ring] of rings.entries()) {
      for (let j = 0; j < ring.length; j++) {
        const k = (j + 1) % ring.length;
        const a = [ring[j], ring[k], bottom[i][k], bottom[i][j]];
        batch.quad(...a, 0x777466);
        batch.quad(...a.reverse(), 0x777466);
      }
    }
  });
}

const bronze = [0x4a403b, 0x504741, 0x594d44, 0x3e3c38, 0x4d4945];

// Model the three gestures from the bronze group photographed by Nationaal Comité 4 en 5 mei.
// https://www.4en5mei.nl/oorlogsmonumenten/zoeken/4943/ede-de-amazones-van-ede
function bronzeFigure(batch, x, y, z, heading, pose, height) {
  const cs = Math.cos(heading), sn = Math.sin(heading);
  const point = ([a, b, c]) => [x + a * cs + c * sn, y + b * height, z - a * sn + c * cs];
  const oval = (p, width, tall, depth, tint, lean = 0) => {
    batch.solid(new THREE.IcosahedronGeometry(1, 1).scale(width, tall * height, depth)
      .rotateZ(lean).rotateY(heading).translate(...point(p)), bronze[tint]);
  };
  const limb = (a, b, wide, narrow, tint) => rod(batch, point(a), point(b), wide, narrow, bronze[tint]);
  const hips = [0.005, 0.54, 0.0], chest = [-0.01, 0.76, 0.018];
  oval(hips, 0.174, 0.093, 0.123, 1);
  oval([0.0, 0.647, 0.011], 0.133, 0.115, 0.112, 0, -0.06);
  oval(chest, 0.172, 0.097, 0.121, 2);
  limb([-0.022, 0.795, 0.01], [-0.018, 0.912, 0.016], 0.061, 0.055, 1);
  oval([-0.018, 0.929, 0.023], 0.082, 0.071, 0.081, 2, -0.06);
  oval([-0.021, 0.936, 0.085], 0.056, 0.047, 0.033, 1);
  oval([-0.044, 0.959, -0.05], 0.072, 0.048, 0.062, 3);
  oval([-0.034, 0.980, -0.089], 0.046, 0.032, 0.052, 3);
  oval([-0.014, 0.934, 0.114], 0.021, 0.017, 0.016, 2);
  for (const sign of [-1, 1]) {
    const stance = pose === 'open' ? 0.160 : pose === 'hips' ? 0.125 : 0.079;
    const hip = [sign * 0.096, 0.528, -0.01];
    const knee = [sign * (stance - 0.017), 0.268, sign * 0.029];
    const ankle = [sign * stance, 0.042, sign * 0.047];
    limb(hip, knee, 0.099, 0.057, 0);
    oval(knee, 0.057, 0.064, 0.055, 2);
    limb(knee, ankle, 0.055, 0.033, 1);
    oval([ankle[0], 0.028, ankle[2] + 0.040], 0.051, 0.024, 0.102, 2);
    const shoulder = [sign * 0.163, 0.785, 0.009];
    const elbow = pose === 'hips' ? [sign * 0.292, 0.642, -0.02]
      : pose === 'chest' ? [sign * 0.161, 0.641, 0.102] : [sign * 0.208, 0.621, 0.013];
    const hand = pose === 'hips' ? [sign * 0.153, 0.590, 0.084]
      : pose === 'chest' ? [-sign * 0.104, 0.746 + sign * 0.032, 0.138] : [sign * 0.249, 0.483, 0.065];
    oval(shoulder, 0.064, 0.059, 0.061, 2);
    limb(shoulder, elbow, 0.056, 0.039, 1);
    limb(elbow, hand, 0.043, 0.026, 4);
    oval(hand, 0.035, 0.044, 0.021, 2, sign * 0.22);
  }
}

function amazones(site) {
  return buildMemorial(site, (batch, plaques, ground, obstacle) => {
    const figures = [
      [-4.23, -0.08, Math.PI - 0.20, 'hips', 1.65],
      [0, 0, 1.68, 'chest', 1.72],
      [4.00, -0.08, 0.27, 'open', 1.77],
    ];
    for (const [x, z, heading, pose, height] of figures) {
      const base = ground(x, z);
      box(batch, x, base + 0.14, z, 0.81, 0.36, 0.63, 0x8e9c9f);
      box(batch, x, base + 0.321, z, 0.80, 0.018, 0.62, 0xa3adb0);
      bronzeFigure(batch, x, base + 0.33, z, heading, pose, height);
      obstacle(x, z, 0.81, height + 0.33, 0.63);
    }
  });
}

const leaf = [
  [0, -0.53], [0.11, -0.35], [0.20, -0.38], [0.17, -0.13], [0.30, -0.24], [0.37, -0.17],
  [0.49, -0.18], [0.47, -0.02], [0.53, 0.01], [0.29, 0.24], [0.36, 0.34], [0.02, 0.30],
  [0.023, 0.47], [-0.023, 0.47], [-0.02, 0.30], [-0.36, 0.34], [-0.29, 0.24], [-0.53, 0.01],
  [-0.47, -0.02], [-0.49, -0.18], [-0.37, -0.17], [-0.30, -0.24], [-0.17, -0.13], [-0.20, -0.38], [-0.11, -0.35],
];

function mapleLeafs(site) {
  return buildMemorial(site, (batch, plaques, ground) => {
    // Estimated plaque size and spacing fitted to the photos and the Dutch paving courses.
    const plaquesOnSquare = [[-1.61, 0.26, 'ALLIED FORCES'], [1.26, 1.34, '17 APRIL 1945'],
      [0.43, -2.10, 'BEVRIJDING EDE']];
    for (const [x, z, text] of plaquesOnSquare) {
      const size = 0.82;
      const points = leaf.map(([a, b]) => {
        const px = x + a * size, pz = z + b * size;
        return [px, ground(px, pz) + 0.074, pz];
      });
      batch.polygon([[...points].reverse()], 0x8b9187);
      plaques.push({ center: [x, ground(x, z) + 0.083, z + 0.055], width: 0.63, height: 0.17,
        lines: [text], color: '#504a3e', tilt: Math.PI / 2 });
    }
  }, false);
}

function bartVanElstMemorial(site) {
  return buildMemorial(site, (batch, plaques, ground, obstacle) => {
    // White stone and plinth, with the two flanking brick-and-timber benches.
    box(batch, 0, ground(0, 0) + 0.42, 0, 0.92, 0.78, 0.48, 0x938f86);
    box(batch, 0, ground(0, 0) + 1.13, 0, 0.70, 0.62, 0.20, 0xe1ddd2);
    box(batch, 0, ground(0, 0) + 0.90, 0.108, 0.57, 0.035, 0.012, 0x858179);
    plaques.push({ center: [0, ground(0, 0) + 1.12, 0.111], width: 0.54, height: 0.34,
      lines: ['1940–1945', 'B. VAN ELST · M. LUGTHART', 'J. MEKKING · P. ROSEBOOM',
        'J. SCHOUTEN · H. VAN VLIET', 'GEVALLEN IN HET VERZET'], color: '#44423d' });
    for (const x of [-1.18, 1.18]) {
      box(batch, x, ground(x, 0) + 0.22, 0, 1.14, 0.44, 0.52, 0x795b4d);
      box(batch, x, ground(x, 0) + 0.49, 0, 1.20, 0.08, 0.58, 0x59483d);
      obstacle(x, 0, 1.15, 0.58, 0.58);
    }
    obstacle(0, 0, 0.94, 1.46, 0.48);
  });
}

function leijdesdorffMemorial(site) {
  return buildMemorial(site, (batch, plaques, ground, obstacle) => {
    const rim = [[-0.14, -0.28], [-0.14, 0.28], [0.14, 0.28], [0.14, -0.28]];
    batch.polygon([rim.map(([x, z]) => [x, ground(x, z) + 0.072, z])], 0x515c65);
    plaques.push({ center: [0, ground(0, 0) + 0.079, 0], width: 0.25, height: 0.50, tilt: Math.PI / 2,
      font: 'serif', color: '#c1c1ba',
      lines: ['Isaac Leijdesdorff', 'Harlingen, 10 sept. 1909', 'Sobibor, 23 juli 1943', 'en',
        'Sarina Tea', 'Leijdesdorff-Hoek', 'Enschede, 6 mrt. 1909', 'Sobibor, 23 juli 1943'] });

    // Visitor interpretation, placed at the back of the same pavement as the stone.
    const x = -1.35, z = -2.14, base = ground(x, z);
    box(batch, x, base + 0.58, z, 0.105, 1.18, 0.105, 0x3f494e);
    box(batch, x, base + 1.26, z, 0.51, 0.49, 0.038, 0x30393c);
    box(batch, x, base + 1.40, z + 0.020, 0.48, 0.15, 0.007, 0x426681);
    plaques.push({ center: [x, base + 1.42, z + 0.026], width: 0.45, height: 0.13,
      lines: ['OORLOGSHERINNERINGEN EDE'], color: '#eeeeeb' });
    plaques.push({ center: [x, base + 1.18, z + 0.022], width: 0.44, height: 0.29,
      lines: ['ONDERDUIKERS', 'IN DE MOLENSTRAAT', 'JULI 1943'], color: '#ddddcf' });
    obstacle(x, z, 0.11, 1.5, 0.11);
  });
}

export const EDE_TOWN_MEMORIAL_FACTORIES = {
  'monument-bombardementsslachtoffers': (_, site) => bombingMemorial(site),
  'de-amazones-van-ede': (_, site) => amazones(site),
  'maple-leafs-polar-bears': (_, site) => mapleLeafs(site),
  'leijdesdorff-hoek-gedenksteen': (_, site) => leijdesdorffMemorial(site),
  'bart-van-elst-monument': (_, site) => bartVanElstMemorial(site),
};
