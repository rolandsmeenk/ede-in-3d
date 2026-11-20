import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv, vertexColor } from 'three/tsl';
import { CivicBatch, makeGroup } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { terrainHeightAt } from './terrain.js';

const brick = 0x8b6653, sandstone = 0xab9776, bronze = 0x635147;

function risingFigure(batch, base) {
  const oval = (a, b, cross, depth) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const axis = end.clone().sub(start);
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    const center = start.addScaledVector(axis, 0.5);
    batch.solid(new THREE.SphereGeometry(1, 12, 8)
      .scale(cross, axis.length() / 2, depth)
      .applyQuaternion(rotation).translate(center.x, base + center.y, center.z), bronze);
  };

  // The fallen defender rises on one elbow, with his other hand over his brow.
  oval([5.63, 0.18, 0.08], [6.43, 0.43, 0.08], 0.24, 0.25);
  oval([5.91, 0.16, 0.10], [6.78, 0.78, 0.12], 0.29, 0.22);
  oval([6.56, 0.54, 0.17], [6.83, 0.91, 0.19], 0.12, 0.11);
  oval([6.63, 0.74, 0.21], [6.91, 1.12, 0.23], 0.16, 0.15);
  oval([6.60, 0.66, 0.03], [6.26, 1.29, 0.02], 0.12, 0.13);
  oval([6.27, 1.25, 0.02], [6.77, 1.02, 0.21], 0.095, 0.10);
  oval([6.72, 1.10, 0.21], [6.80, 0.98, 0.31], 0.075, 0.095);
  oval([6.64, 0.65, 0.26], [7.08, 0.16, 0.42], 0.125, 0.115);
  oval([7.03, 0.14, 0.40], [7.37, 0.43, 0.56], 0.095, 0.10);
  oval([7.34, 0.32, 0.53], [7.42, 0.57, 0.58], 0.080, 0.07);
  oval([5.96, 0.26, 0.04], [5.21, 0.55, -0.11], 0.153, 0.15);
  oval([5.30, 0.58, -0.11], [4.87, 0.09, -0.20], 0.110, 0.105);
  oval([5.97, 0.21, 0.27], [5.21, 0.13, 0.39], 0.135, 0.13);
  oval([5.30, 0.12, 0.37], [4.74, 0.10, 0.15], 0.090, 0.10);
}

function inscription() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b29d7d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#6d5237';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.fillText('GESTEUND DOOR HET RECHT STREDEN ZIJ VOOR DE VRIJHEID', 1024, 34, 1990);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10.7, 0.34),
    new THREE.MeshStandardNodeMaterial({ map, roughness: 0.92 }));
  mesh.position.set(-0.46, 2.05, 1.064);
  mesh.receiveShadow = true;
  return mesh;
}

export function createMausoleum(_footprints, site) {
  const shell = new CivicBatch(), fixtures = new CivicBatch(), colliders = [];
  const sin = Math.sin(site.heading), cos = Math.cos(site.heading);
  const ground = terrainHeightAt(site.x, site.z);
  const world = (x, z) => ({ x: site.x + x * cos + z * sin, z: site.z - x * sin + z * cos });
  const terrain = (x, z) => {
    const p = world(x, z);
    return terrainHeightAt(p.x, p.z) - ground;
  };
  const box = (batch, x, y, z, w, h, d, color) =>
    batch.solid(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
  const collide = (x, z, w, d, low, high) => {
    const outer = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u, v]) => world(x + u * w / 2, z + v * d / 2));
    const xs = outer.map(p => p.x), zs = outer.map(p => p.z);
    colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
      minY: ground + low, maxY: ground + high, polygon: { outer, holes: [] } });
  };

  box(shell, -0.46, 0.73, 0, 12.08, 3.10, 1.98, brick);
  box(shell, -6.81, 0.72, 0, 1.36, 3.12, 2.00, brick);
  box(shell, 6.10, 0.79, 0.02, 2.80, 3.26, 2.06, brick);
  collide(0, 0, 15, 2.06, -0.9, 2.50);

  box(fixtures, -0.46, 2.32, 0, 12.15, 0.12, 2.08, sandstone);
  box(fixtures, -6.81, 2.32, 0, 1.43, 0.12, 2.08, sandstone);
  box(fixtures, 6.10, 2.46, 0.02, 2.90, 0.14, 2.16, sandstone);
  box(fixtures, -0.46, 1.39, 1.009, 10.99, 1.62, 0.09, 0xb19a75);

  const stone = [0xb6b3a7, 0xc2baaa, 0xbdb8aa, 0xadafa9];
  for (let col = 0; col < 20; col++) for (let row = 0; row < 2; row++) {
    box(fixtures, -5.61 + col * 0.543, 0.98 + 0.51 * row, 1.064,
      0.49, 0.44, 0.043, stone[(col + row * 3) % stone.length]);
  }
  box(fixtures, -6.81, 1.49, 1.023, 0.64, 0.89, 0.09, 0xb7a782);
  fixtures.polygon([[[-7.025,1.79,1.073],[-7.025,1.51,1.073],[-6.81,1.39,1.073],
    [-6.595,1.51,1.073],[-6.595,1.79,1.073]]], 0x8d7b5a);
  box(fixtures, 6.08, 1.31, 1.073, 1.25, 0.73, 0.065, 0xafaca3);
  box(fixtures, 6.10, 2.57, 0.02, 2.70, 0.10, 1.54, 0x514944);
  risingFigure(fixtures, 2.62);

  // The recorded benches sit on the existing walk in front of the memorial.
  for (const [x, z] of [[-8.2, 6.55], [-4.10, 6.70], [0, 6.85], [4.10, 7], [8.2, 7.15]]) {
    const y = terrain(x, z);
    box(fixtures, x, y + 0.40, z, 1.88, 0.12, 0.53, 0x938d7c);
    for (const dx of [-0.65, 0.65]) box(fixtures, x + dx, y + 0.16, z, 0.26, 0.40, 0.42, 0x595a51);
    collide(x, z, 1.88, 0.53, y - 0.05, y + 0.46);
  }
  const poleX = -9.3, poleZ = 1.45, poleY = terrain(poleX, poleZ);
  box(fixtures, poleX, poleY + 0.13, poleZ, 0.59, 0.31, 0.59, 0xaaa297);
  fixtures.solid(new THREE.CylinderGeometry(0.025, 0.049, 6.4, 10)
    .translate(poleX, poleY + 3.36, poleZ), 0xc1bbae);
  collide(poleX, poleZ, 0.59, 0.59, poleY - 0.025, poleY + 0.30);

  const group = makeGroup('Mausoleum op de Paasberg', shell, colliders);
  const masonry = group.children[0], coords = [];
  const { position, normal } = masonry.geometry.attributes;
  for (let i = 0; i < position.count; i++) {
    coords.push((position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 0.92,
      position.getY(i) / 0.50);
  }
  masonry.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  const { texture: surface } = createFacadeSurfaceTexture();
  masonry.material.colorNode = vertexColor().mul(mix(0.70, 1.15, texture(surface, uv()).r));
  group.add(fixtures.mesh());
  const letters = inscription();
  if (letters) group.add(letters);
  return group;
}
