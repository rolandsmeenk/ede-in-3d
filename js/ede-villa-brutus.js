import * as THREE from 'three/webgpu';
import { along, CivicBatch, wallColliders } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';

// Museumplein 3. The 2025 PDOK orthophoto and the operator's exterior gallery
// locate the wraparound glass roof and the timber pergola against the BAG shell.
// The front section stays just south of the mapped pedestrian route across the square.
const rear = [{ x: -223.43, z: 335.00 }, { x: -227.74, z: 334.82 }, { x: -234.98, z: 347.42 }];
const front = [{ x: -223.43, z: 334.45 }, { x: -229.75, z: 334.25 }, { x: -236.95, z: 346.22 }];
const frameColor = 0x343637, timber = 0x957647;
const up = new THREE.Vector3(0, 1, 0);
const point = ({ x, z }, y) => [x, y, z];

function beam(batch, from, to, width, depth, color) {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
  const axis = end.clone().sub(start);
  const centre = start.clone().lerp(end, 0.5);
  batch.solid(new THREE.BoxGeometry(width, axis.length(), depth)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()))
    .translate(centre.x, centre.y, centre.z), color);
}

function quad(positions, a, b, c, d) {
  positions.push(...a, ...b, ...c, ...a, ...c, ...d);
}

function addDiningSet(batch, x, z, seatColor) {
  const y = terrainHeightAt(x, z);
  const box = (w, h, d, dx, dy, dz, color) => batch.solid(
    new THREE.BoxGeometry(w, h, d).translate(x + dx, y + dy, z + dz), color);
  box(0.78, 0.06, 0.67, 0, 0.75, 0, 0x94765e);
  box(0.07, 0.72, 0.07, 0, 0.37, 0, frameColor);
  box(0.36, 0.035, 0.36, 0, 0.03, 0, frameColor);
  for (const side of [-1, 1]) {
    box(0.38, 0.06, 0.34, side * 0.60, 0.43, 0, seatColor);
    box(0.05, 0.42, 0.38, side * 0.77, 0.64, 0, seatColor);
    for (const dz of [-0.13, 0.13]) {
      box(0.028, 0.40, 0.035, side * 0.75, 0.20, dz, frameColor);
      box(0.028, 0.40, 0.035, side * 0.47, 0.20, dz, frameColor);
    }
  }
}

function addPergola(batch, furniture, colliders, base) {
  const a = { x: -235.15, z: 347.71 }, b = { x: -237.56, z: 351.74 };
  const outward = p => ({ x: p.x - 2.28, z: p.z - 1.35 });
  const roofY = base + 2.67;
  for (const [start, end] of [[a, b], [outward(a), outward(b)]]) {
    beam(batch, point(start, roofY), point(end, roofY), 0.14, 0.16, timber);
    for (const t of [0, 0.5, 1]) {
      const p = along(start, end, t), y = terrainHeightAt(p.x, p.z) - 0.025;
      beam(batch, point(p, y), point(p, roofY), 0.12, 0.12, timber);
      colliders.push({ minX: p.x - 0.06, maxX: p.x + 0.06, minZ: p.z - 0.06, maxZ: p.z + 0.06, minY: y, maxY: roofY });
      for (const direction of t === 0.5 ? [-1, 1] : [t === 0 ? 1 : -1]) {
        beam(batch, point(p, roofY - 0.48), point(along(start, end, t + direction * 0.11), roofY),
          0.075, 0.087, timber);
      }
    }
  }
  for (let i = 0; i <= 38; i++) {
    const p = along(a, b, i / 38), major = i % 19 === 0;
    beam(batch, point(p, roofY + 0.08), point(outward(p), roofY + 0.08),
      major ? 0.10 : 0.036, major ? 0.12 : 0.022, major ? timber : 0xaf925d);
  }
  for (const t of [0.22, 0.5, 0.79]) {
    const p = along(a, b, t), centre = along(p, outward(p), 0.46);
    addDiningSet(furniture, centre.x, centre.z, 0x655744);
  }
  const mid = along(a, b, 0.5), planter = along(mid, outward(mid), 0.95);
  const ground = terrainHeightAt(planter.x, planter.z);
  const heading = Math.atan2(b.x - a.x, b.z - a.z);
  furniture.solid(new THREE.BoxGeometry(0.46, 0.42, 3.92).rotateY(heading)
    .translate(planter.x, ground + 0.20, planter.z), 0x895038);
  for (let i = 1; i < 12; i++) {
    const p = along(a, b, i / 12), plant = along(p, outward(p), 0.95);
    const leafHeight = ground + 0.45 + 0.06 * (i % 3);
    furniture.solid(new THREE.DodecahedronGeometry(0.23, 0)
      .scale(1, 0.7 + 0.14 * (i % 3), 1).translate(plant.x, leafHeight, plant.z),
    i % 2 ? 0x566c3c : 0x425832);
  }
}

export function createVillaBrutusTerraces() {
  const base = terrainHeightAt(-231.24, 339.78);
  const eave = base + 2.64, ridge = base + 3.10;
  const structure = new CivicBatch(), furniture = new CivicBatch(), colliders = [], glass = [];

  for (let i = 0; i < rear.length - 1; i++) {
    const a = rear[i], b = rear[i + 1], c = front[i + 1], d = front[i];
    quad(glass, point(a, ridge), point(b, ridge), point(c, eave), point(d, eave));
    const bays = i === 0 ? 4 : 8;
    for (let j = 0; j <= bays; j++) {
      // The shared mitred corner has one post and one roof rafter.
      if (i > 0 && j === 0) continue;
      const p = along(d, c, j / bays), q = along(a, b, j / bays);
      const ground = terrainHeightAt(p.x, p.z);
      beam(structure, point(p, ground - 0.022), point(p, eave), 0.085, 0.085, frameColor);
      beam(structure, point(p, eave), point(q, ridge), 0.080, 0.064, frameColor);
    }
    for (const t of i === 0 ? [] : [0.18, 0.40, 0.63, 0.84]) {
      const p = along(d, c, t), q = along(a, b, t);
      const middle = along(p, q, 0.54);
      addDiningSet(furniture, middle.x, middle.z, 0x853c33);
    }
  }

  const glazing = [rear[0], ...front, rear.at(-1)];
  for (let i = 0; i < glazing.length - 1; i++) {
    const a = glazing[i], b = glazing[i + 1];
    const ya = terrainHeightAt(a.x, a.z), yb = terrainHeightAt(b.x, b.z);
    const topA = i === 0 ? ridge : eave, topB = i === glazing.length - 2 ? ridge : eave;
    quad(glass, point(a, ya + 0.075), point(b, yb + 0.075), point(b, topB), point(a, topA));
    beam(structure, point(a, topA), point(b, topB), 0.17, 0.12, frameColor);
    beam(structure, point(a, ya + 0.032), point(b, yb + 0.032), 0.075, 0.055, frameColor);
    colliders.push(...wallColliders(a, b, Math.min(ya, yb) - 0.04, eave, 0.08));
  }

  addPergola(structure, furniture, colliders, base);

  const group = new THREE.Group();
  group.name = 'Villa Brutus · Museumplein conservatory and pergola';
  group.userData.colliders = colliders;
  const framing = structure.mesh();
  framing.name = 'Villa Brutus conservatory frames and timber pergola';
  group.add(framing);

  const furnishings = furniture.mesh();
  furnishings.name = 'Villa Brutus terrace furniture';
  furnishings.castShadow = false;
  furnishings.userData.nearDetail = 60;
  group.add(furnishings);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(glass, 3));
  geometry.computeVertexNormals();
  const panes = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({
    color: 0x7c9da6, metalness: 0.20, roughness: 0.28, side: THREE.DoubleSide,
    transparent: true, opacity: 0.30, depthWrite: false, forceSinglePass: true,
  }));
  panes.name = 'Villa Brutus conservatory glass';
  panes.userData.nearDetail = 120;
  group.add(panes);
  return group;
}
