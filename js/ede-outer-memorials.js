import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';

const slate = 0x41433e;
const concrete = 0x969184;
const brick = 0x696055;
const granite = 0x999994;
const pale = '#e9e6db';
const dark = '#272623';

function box(batch, x, y, z, w, h, d, color, tilt = 0) {
  batch.solid(new THREE.BoxGeometry(w, h, d).rotateX(-tilt).translate(x, y, z), color);
}

function trace(path, points) {
  path.moveTo(...points[0]);
  for (const point of points.slice(1)) path.lineTo(...point);
  path.closePath();
  return path;
}

function cutStone(batch, outline, z, depth, color, holes = []) {
  const shape = trace(new THREE.Shape(), outline);
  shape.holes = holes.map(hole => trace(new THREE.Path(), hole));
  batch.solid(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).translate(0, 0, z), color);
}

function boulder(batch, x, y, w, h, d, color, flatFace) {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
    const rough = 1 + 0.13 * Math.sin(8 * px + 4 * py + 12 * pz) + 0.05 * py;
    const localZ = pz * d * rough / 2;
    positions.setXYZ(i, x + px * w * rough / 2, Math.max(-0.05, y + py * h * rough / 2),
      flatFace === undefined ? localZ : Math.min(localZ, flatFace));
  }
  batch.solid(geometry, color);
}

function lettering(labels) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256 * labels.length;
  const ctx = canvas.getContext('2d');
  const positions = [], uvs = [];
  labels.forEach(({ lines, x = 0, y, z, w, h, tilt = 0, color = dark, background }, index) => {
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, index * 256, 512, 256);
    }
    const step = Math.min(116, 214 / lines.length);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, row) => {
      ctx.font = `bold ${Math.floor(step * (row === 0 ? 0.79 : 0.66))}px sans-serif`;
      ctx.fillText(line, 256, index * 256 + 128 + (row - (lines.length - 1) / 2) * step, 472);
    });
    const y2 = Math.cos(tilt) * h / 2, z2 = Math.sin(tilt) * h / 2;
    const low = 1 - (index + 1) / labels.length, high = 1 - index / labels.length;
    const corners = [[x - w / 2, y - y2, z + z2], [x + w / 2, y - y2, z + z2],
      [x + w / 2, y + y2, z - z2], [x - w / 2, y + y2, z - z2]];
    const tex = [[0, low], [1, low], [1, high], [0, high]];
    for (const vertex of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[vertex]);
      uvs.push(...tex[vertex]);
    }
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map, alphaTest: 0.45, roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  mesh.userData.nearDetail = 30;
  return mesh;
}

function build(site, draw) {
  const batch = new CivicBatch(), labels = [], colliders = [];
  const ground = terrainHeightAt(site.x, site.z);
  const cs = Math.cos(site.heading), sn = Math.sin(site.heading);
  const world = (x, z) => ({ x: site.x + x * cs + z * sn, z: site.z - x * sn + z * cs });
  const block = (x, z, w, d, h) => colliders.push(...wallColliders(
    world(x - w / 2, z), world(x + w / 2, z), ground - 0.08, ground + h, d));
  draw(batch, labels, block);
  const group = makeGroup(site.name, batch, colliders);
  group.position.set(site.x, ground, site.z);
  group.rotation.y = site.heading;
  const detail = lettering(labels);
  if (detail) group.add(detail);
  return group;
}

function airborneBoulder(batch, labels, block) {
  boulder(batch, 0, 0.43, 1.40, 1.11, 0.98, 0x65625d, 0.30);
  labels.push({ lines: ['LUCHTLANDING', '17–18 SEPT. 1944'], y: 0.59, z: 0.303, w: 0.93, h: 0.27, color: pale });
  block(0, 0, 1.34, 0.80, 1.00);
}

function stirling(batch, labels, block) {
  boulder(batch, 0, 0.44, 1.71, 1.16, 1.20, 0x918879, 0.40);
  box(batch, 0.065, 0.72, 0.403, 0.47, 0.43, 0.018, slate);
  labels.push({ lines: ['PER ARDUA AD ASTRA', 'STIRLING LJ883', '570 SQUADRON RAF',
    '23 SEPTEMBER 1944', 'William Kirkham · Ernest Brown', 'David Atkinson · Morris Hand',
    'Harrold Ashton · Gerard Reardon'], x: 0.065, y: 0.72, z: 0.415, w: 0.45, h: 0.40, color: pale });
  block(0, 0, 1.53, 0.94, 1.04);
}

function ederveen(batch, labels, block) {
  box(batch, 0, 0.38, 0, 0.83, 0.81, 0.53, 0x878882);
  box(batch, 0, 0.86, -0.015, 0.47, 0.49, 0.056, 0x656965, 0.18);
  labels.push({ lines: ['1945  ·  1995', '50 JAAR BEVRIJDING', 'EDERVEEN 24 APRIL 1945',
    'POLAR BEAR DIVISION'], y: 0.865, z: 0.016, w: 0.44, h: 0.43, tilt: 0.18, color: pale });
  block(0, 0, 0.83, 0.53, 0.81);
  for (const [x, lines] of [[-1.38, ['Voor hen', 'die vielen']], [1.38, ['In oorlogen', 'en tijdens missies']]]) {
    box(batch, x, 0.24, 0.025, 1.15, 0.53, 0.57, granite);
    labels.push({ lines, x, y: 0.30, z: 0.313, w: 1.01, h: 0.25 });
    block(x, 0.025, 1.15, 0.57, 0.51);
  }
}

function wekerom(batch, labels, block) {
  box(batch, 0, 0.29, -0.10, 0.69, 0.65, 0.46, 0x4e4b42);
  for (let row = 0; row < 7; row++) {
    const unit = row % 2 ? 0.17 : 0.225;
    for (let x = -0.34; x < 0.32; x += unit) {
      const width = Math.min(unit, 0.345 - x);
      box(batch, x + width / 2, 0.038 + row * 0.084, 0.128, width - 0.009, 0.075, 0.023,
        row % 3 === 1 ? 0x776b5d : brick);
    }
  }
  const tilt = 0.67;
  box(batch, 0, 0.75, 0.055, 0.78, 0.69, 0.15, brick, tilt);
  box(batch, 0, 0.805, 0.12, 0.50, 0.50, 0.024, 0xa4a7a3, tilt);
  labels.push({ lines: ['1945  ·  1995', '50 JAAR BEVRIJDING', 'WEKEROM 16 APRIL 1945',
    '5 CANADIAN ARMOURED DIVISION'], y: 0.815, z: 0.133, w: 0.47, h: 0.47, tilt });
  block(0, -0.045, 0.77, 0.57, 1.02);
}

function otterlo(batch, labels, block) {
  box(batch, 0.01, 0.12, 0.015, 1.60, 0.29, 0.70, concrete);
  box(batch, -0.17, 0.275, -0.07, 0.85, 0.055, 0.36, slate);
  box(batch, -0.23, 0.40, -0.02, 1.50, 0.24, 0.57, 0xa39f91);
  box(batch, -0.07, 0.545, -0.075, 0.85, 0.055, 0.34, slate);
  box(batch, -0.12, 0.69, 0.015, 1.13, 0.24, 0.53, 0xaea595);
  box(batch, 0.01, 0.83, -0.045, 0.74, 0.045, 0.29, slate);
  cutStone(batch, [[-0.48, 0.85], [0.44, 0.85], [0.44, 1.40], [0.22, 1.40], [0.22, 1.04],
    [-0.025, 1.04], [-0.025, 1.11], [-0.48, 1.11]], -0.23, 0.46, 0xa19b8c);
  labels.push({ lines: ['1940'], x: -0.25, y: 0.98, z: 0.232, w: 0.45, h: 0.22 },
    { lines: ['1945'], x: 0.20, y: 0.70, z: 0.282, w: 0.46, h: 0.23 });
  block(0.005, 0, 1.58, 0.70, 1.40);
  for (const [x, r] of [[-1.02, 0.35], [-0.78, 0.28], [0.99, 0.30]]) {
    boulder(batch, x, 0.06, r, r * 0.72, 0.27, granite);
  }
}

function battle(batch, labels, block) {
  box(batch, 0, 0.34, 0, 0.78, 0.72, 0.63, 0x4a4c46);
  for (let row = 0; row < 8; row++) {
    const y = 0.037 + row * 0.082;
    const unit = row % 2 ? 0.20 : 0.145;
    for (let x = -0.38; x < 0.355; x += unit) {
      const width = Math.min(unit, 0.385 - x);
      box(batch, x + width / 2, y, 0.317, width - 0.007, 0.074, 0.012, row % 2 ? 0x545655 : 0x606261);
    }
  }
  box(batch, 0, 0.702, 0, 0.81, 0.041, 0.66, 0x856349);
  const leaf = [[0, 1.17], [0.076, 1.015], [0.124, 1.059], [0.103, 0.876], [0.19, 0.956],
    [0.211, 0.902], [0.299, 0.922], [0.274, 0.809], [0.315, 0.788], [0.145, 0.658],
    [0.167, 0.609], [0.035, 0.625], [0.04, 0.514], [-0.033, 0.514], [-0.025, 0.627],
    [-0.167, 0.609], [-0.145, 0.658], [-0.315, 0.788], [-0.274, 0.809], [-0.299, 0.922],
    [-0.211, 0.902], [-0.19, 0.956], [-0.103, 0.876], [-0.124, 1.059], [-0.076, 1.015]];
  const raisedLeaf = leaf.map(([x, y]) => [x * 0.86, 0.795 + (y - 0.514) * 0.79]);
  cutStone(batch, [[-0.19, 0.722], [-0.55, 1.048], [0, 1.55], [0.55, 1.048], [0.19, 0.722]],
    -0.08, 0.14, 0x77563b);
  cutStone(batch, [[-0.17, 0.724], [-0.503, 1.036], [0, 1.478], [0.503, 1.036], [0.17, 0.724]],
    0.083, 0.022, 0xb9bbb4, [raisedLeaf]);
  cutStone(batch, [[0, 0.29], [0.27, 0.66], [-0.27, 0.66]], 0.326, 0.011, 0xc0c4c1);
  labels.push({ lines: ['At the going down', 'of the sun', 'and in the morning', 'we will remember them'],
    y: 0.558, z: 0.339, w: 0.29, h: 0.18 });
  block(0, 0, 0.84, 0.67, 1.55);
  for (const x of [0.83, 1.25]) box(batch, x, 0.37, -0.24, 0.055, 0.78, 0.055, 0x86857d);
  box(batch, 1.04, 0.72, -0.19, 0.53, 0.47, 0.022, 0x999992, 0.35);
  labels.push({ lines: ['SLAG IN OTTERLO', '16–17 APRIL 1945', 'Canada · Groot-Brittannië · Otterlo'],
    x: 1.04, y: 0.725, z: -0.179, w: 0.51, h: 0.42, tilt: 0.35 });
  block(1.04, -0.18, 0.54, 0.24, 1);
}

function redCross(batch, labels, block) {
  cutStone(batch, [[-0.60, -0.03], [0.60, -0.03], [0.60, 0.30], [0.40, 0.50], [0.40, 1.48], [0.55, 1.62],
    [0.55, 1.78], [0, 1.80], [-0.55, 1.78], [-0.55, 1.62], [-0.40, 1.48], [-0.40, 0.50], [-0.60, 0.30]],
  -0.30, 0.52, 0xb0a184);
  cutStone(batch, [[-0.60, -0.03], [0.60, -0.03], [0.60, 0.23], [0.41, 0.50], [-0.41, 0.50], [-0.60, 0.23]],
    0.217, 0.083, 0xa79578);
  cutStone(batch, [[-0.39, 1.48], [0.39, 1.48], [0.55, 1.63], [0.55, 1.78], [0, 1.80], [-0.55, 1.78],
    [-0.55, 1.63]], 0.217, 0.083, 0xab9a7c);
  for (const y of [0.88, 1.24]) {
    box(batch, 0, y, 0.229, 0.86, 0.21, 0.037, concrete);
  }
  box(batch, 0, 1.0, 0.243, 0.115, 0.99, 0.033, 0xa69475);
  cutStone(batch, [[-0.115, 0.81], [0.115, 0.81], [0.115, 0.98], [0.182, 0.98], [0.182, 1.14],
    [0.115, 1.14], [0.115, 1.22], [-0.115, 1.22], [-0.115, 1.14], [-0.182, 1.14], [-0.182, 0.98],
    [-0.115, 0.98]], 0.26, 0.023, 0x4d4a3a);
  box(batch, 0, 1.184, 0.288, 0.060, 0.020, 0.009, 0xa44034);
  box(batch, 0, 1.184, 0.288, 0.020, 0.060, 0.011, 0xa44034);
  labels.push({ lines: ['NED. RODE KRUIS', 'EVACUATIE', 'TIJD', '24 SEPT.', '1944', '1945'],
    y: 0.997, z: 0.286, w: 0.23, h: 0.34, color: pale });
  const mosaic = [0x8b594b, 0xb59b71, 0x766759, 0x626e69, 0xaa826a];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 5; col++) {
      box(batch, -0.405, 0.77 + row * 0.071, -0.192 + col * 0.086, 0.013, 0.066, 0.081,
        mosaic[(row + 2 * col) % mosaic.length]);
    }
  }
  block(0, 0, 1.20, 0.60, 1.80);
}

function wormshoef(batch, labels, block) {
  const tilt = 1.04;
  for (const x of [-0.49, 0.49]) {
    box(batch, x, 0.51, -0.10, 0.13, 1.06, 0.12, 0x858787);
    block(x, -0.10, 0.14, 0.14, 1.07);
  }
  box(batch, 0, 0.91, 0.003, 1.14, 0.57, 0.036, 0xa1a4a5, tilt);
  labels.push({ lines: ['HOTEL DE WORMSHOEF', 'LUNTEREN'],
    x: -0.263, y: 0.928, z: 0.014, w: 0.52, h: 0.52, tilt, background: '#5d696d', color: pale },
    { lines: ['DE WORMSHOEF', 'In de oorlog gebruikte', 'de bezetter het hotel.', 'Sinds 2026 herinnert',
      'deze marker aan die tijd.'], x: 0.263, y: 0.928, z: 0.014, w: 0.52, h: 0.52,
      tilt, background: '#89a1ae', color: '#26343e' });
}

const memorialShapes = {
  'airborne-landing-boulder': airborneBoulder,
  'stirling-monument': stirling,
  'ederveen-centraal-monument': ederveen,
  'wekerom-centraal-monument': wekerom,
  'otterlo-oorlogsmonument': otterlo,
  'slag-in-otterlo': battle,
  'otterlo-rode-kruismonument': redCross,
  'wormshoef-geschiedenismarker': wormshoef,
};

export const EDE_OUTER_MEMORIAL_FACTORIES = Object.fromEntries(
  Object.entries(memorialShapes).map(([id, draw]) => [id, (_, site) => build(site, draw)]),
);
