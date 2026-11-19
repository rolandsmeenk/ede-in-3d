import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function buildingBatch() {
  const parts = [];
  function add(geometry, tint) {
    const solid = geometry.index ? geometry.toNonIndexed() : geometry;
    if (solid !== geometry) geometry.dispose();
    const count = solid.getAttribute('position').count;
    const rgb = new THREE.Color(tint);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) rgb.toArray(colors, 3 * i);
    solid.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(solid);
  }
  return {
    box(x, y, z, w, h, d, color) {
      add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
    },
    facade(x, y, z, w, h, side, color) {
      add(new THREE.PlaneGeometry(w, h).rotateY(side * Math.PI / 2).translate(x, y, z), color);
    },
    volume(ring, height, color) {
      const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
      add(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }).rotateX(-Math.PI / 2), color);
    },
    gable(ring, back, depth, color) {
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      add(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).translate(0, 0, back), color);
    },
    mesh() {
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }));
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    },
  };
}

function astrantSign() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#262629';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#edc53f';
  ctx.fillRect(8, 8, 240, 80);
  ctx.fillStyle = '#242528';
  ctx.font = '900 43px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ASTRANT', 128, 49);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.16), new THREE.MeshStandardMaterial({ map, roughness: 0.75 }));
}

export function createAstrant() {
  const group = new THREE.Group();
  const batch = buildingBatch();
  const charcoal = 0x292b2d, metal = 0x6a6a64, pane = 0x495558;
  const west = [[-12.12, -9.34], [-2.11, -9.34], [-2.11, 5.88], [-12.12, 5.96]];
  const east = [[-2.11, -6.50], [5.97, -6.50], [13.12, 0.56], [13.12, 4.64], [-2.11, 4.64]];
  batch.volume(west, 7.16, charcoal);
  batch.volume(east, 5.86, charcoal);
  batch.box(-7.11, 7.18, -1.69, 10.08, 0.12, 15.36, metal);
  batch.box(7.8, 5.9, 4.6, 10.65, 0.12, 0.24, metal);

  const vestibule = [[-0.97, 0], [2.47, 0], [2.47, 6.40], [1.25, 8.43], [0.15, 8.43], [-0.97, 6.72]];
  batch.gable(vestibule, -2.62, 7.31, metal);
  const glass = [[-0.83, 0.45], [2.33, 0.45], [2.33, 6.37], [1.17, 8.22], [0.24, 8.22], [-0.83, 6.68]];
  batch.gable(glass, 4.687, 0.055, pane);
  for (const y of [2.55, 4.78, 6.48]) batch.box(0.75, y, 4.765, 3.17, 0.105, 0.08, charcoal);
  for (const [x, height] of [[0.20, 8.08], [1.27, 8.01]]) batch.box(x, height / 2, 4.765, 0.105, height, 0.085, charcoal);
  batch.box(0.74, 1.45, 4.77, 1.13, 2.29, 0.08, 0xd2caba);
  batch.box(1.13, 1.40, 4.83, 0.055, 0.38, 0.053, charcoal);
  for (let step = 0; step < 3; step++) {
    batch.box(0.75, 0.085 * (step + 1), 5.48 - step * 0.16, 5.65 - step * 0.22,
      0.17 * (step + 1), 2.18 - step * 0.48, 0x8b8173);
  }

  const sign = astrantSign();
  sign.position.set(4.69, 4.32, 4.693);
  sign.receiveShadow = true;
  group.add(batch.mesh(), sign);
  return group;
}

export function createPegasusFlat() {
  const group = new THREE.Group();
  const batch = buildingBatch();
  const brick = 0x8f6662, concrete = 0xd7d1c3, rail = 0x677a82, salmon = 0xb56c5c;
  batch.box(0, 18.36, 0, 11.58, 37.48, 104.2, brick);
  batch.box(0, 36.94, 0, 11.75, 0.4, 104.4, 0x3f4140);
  batch.box(10.6, 20.2, -14.2, 5.45, 40.4, 7.5, concrete);
  batch.box(10.6, 40.32, -14.2, 5.65, 0.18, 7.7, 0x777670);
  batch.box(7.64, 17.9, -14.2, 3.68, 35.6, 4.6, brick);
  batch.box(15.1, 2.38, -13.8, 9, 0.28, 7.4, concrete);
  batch.box(18.82, 1.13, -10.55, 0.32, 2.3, 0.32, concrete);
  batch.box(18.82, 1.13, -16.95, 0.32, 2.3, 0.32, concrete);

  const glass = [0x3e4c55, 0x52656d, 0x607179, 0x555557, 0x748082];
  for (let floor = 0; floor < 12; floor++) {
    const y = 2.15 + 2.87 * floor;
    for (const side of [-1, 1]) {
      const x = 5.79 * side;
      batch.box(x + 0.54 * side, y, 0, 1.16, 0.23, 103.4, salmon);
      batch.box(x + 1.08 * side, y + 0.54, 0, 0.13, 0.83, 103.2, concrete);
      batch.box(x + 1.15 * side, y + 1.00, 0, 0.15, 0.085, 103.2, rail);
      for (let bay = 0; bay < 24; bay++) {
        const z = 49.0 - bay * 4.26;
        batch.facade(x + 0.014 * side, y + 1.36, z, 3.08, 1.99, side, concrete);
        batch.facade(x + 0.027 * side, y + 1.46, z, 2.80, 1.64, side,
          glass[(bay + floor * 3 + (side === 1 ? 2 : 0)) % glass.length]);
        batch.facade(x + 0.037 * side, y + 1.46, z, 0.06, 1.64, side, concrete);
      }
    }
    batch.facade(13.34, 2.75 + floor * 2.87, -14.2, 3.1, 1.69, 1, glass[(floor + 1) % glass.length]);
  }

  group.add(batch.mesh());
  return group;
}
