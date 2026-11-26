import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addWindmillSailcloth, createWindmillRig, windmillUplight } from './ede-windmill.js';

const OCTAGON = Math.PI / 4;
const GALLERY_HEIGHT = 12.8;
const SAIL_HUB = 24.65;
const HUB_OFFSET = 4.90;
const SHAFT_SLOPE = 0.22;
const GALLERY_RADIUS = 6.85;
const SAIL_RADII = [23.55 / 2, 23.70 / 2];
const SAIL_ANGLE = 0.34;
const BRICK = 0x8a7063;
const THATCH = 0x434039;
const TIMBER = 0x3c3830;
const PAINT = 0xdddcd0;
const GREEN = 0x324636;
const TOWER_BANDS = [
  [5.0, 5.05, 0, 0.48, 0x7a6257],
  [4.88, 5.0, 0.48, 4.7, BRICK],
  [4.35, 4.88, 4.7, GALLERY_HEIGHT, BRICK],
  [3.57, 4.38, GALLERY_HEIGHT, 17.9, THATCH],
  [3.25, 3.57, 17.9, 21.0, THATCH],
  [2.84, 3.25, 21.0, 23.15, THATCH],
  [3.28, 3.35, 23.07, 23.30, TIMBER],
  [GALLERY_RADIUS + 0.07, GALLERY_RADIUS, 12.51, GALLERY_HEIGHT, TIMBER],
];

function bandGeometry(top, bottom, low, high) {
  return new THREE.CylinderGeometry(top, bottom, high - low, 8)
    .rotateY(OCTAGON / 2).translate(0, (low + high) / 2, 0);
}

export function addConcordiaTowerSilhouette(batch, matrix) {
  for (const [top, bottom, low, high, color] of TOWER_BANDS) {
    batch.solid(bandGeometry(top, bottom, low, high).applyMatrix4(matrix), color);
  }
}

// The gallery and sail sizes are published. Tower tapers, cap and trim are fitted to reference views.
export function createConcordiamolen() {
  const group = new THREE.Group();
  group.name = 'Concordiamolen';
  const { cap, sails } = createWindmillRig(group, SAIL_HUB, HUB_OFFSET, SHAFT_SLOPE);
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.89 });
  material.emissiveNode = windmillUplight(0.48);
  const parts = [];

  function finish(parent) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    for (const part of parts) part.dispose();
    parts.length = 0;
    return mesh;
  }
  const up = new THREE.Vector3(0, 1, 0);
  const start = new THREE.Vector3(), end = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  function add(geometry, hex) {
    const n = geometry.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    const color = new THREE.Color(hex);
    for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  }

  function beam(a, b, width, depth, color) {
    start.fromArray(a);
    end.fromArray(b).sub(start);
    const length = end.length();
    rotation.setFromUnitVectors(up, end.divideScalar(length));
    end.multiplyScalar(length / 2).add(start);
    add(new THREE.BoxGeometry(width, length, depth).applyQuaternion(rotation).translate(end.x, end.y, end.z), color);
  }

  function trimBox(width, height, depth, angle, radius, y, color) {
    add(new THREE.BoxGeometry(width, height, depth).translate(0, y, radius).rotateY(angle), color);
  }

  for (const [top, bottom, low, high, color] of TOWER_BANDS) {
    add(bandGeometry(top, bottom, low, high), color);
  }

  function window(angle, y, radius, width, height) {
    const face = Math.cos(OCTAGON / 2) * radius;
    trimBox(width + 0.10, height + 0.10, 0.12, angle, face + 0.055, y, PAINT);
    trimBox(width, height, 0.025, angle, face + 0.125, y, 0x2d3533);
    trimBox(0.045, height, 0.027, angle, face + 0.145, y, PAINT);
    trimBox(width, 0.043, 0.027, angle, face + 0.145, y, PAINT);
  }
  for (const angle of [-OCTAGON, OCTAGON, 3 * OCTAGON, -3 * OCTAGON]) {
    window(angle, 3.6, 4.91, 0.72, 1.5);
    window(angle, 9.35, 4.57, 0.66, 1.37);
    window(angle, 18.35, 3.53, 0.57, 0.87);
    window(angle, 21.1, 3.23, 0.51, 0.75);
  }
  trimBox(1.66, 2.78, 0.22, 0, 4.60, 1.41, 0x75665c);
  trimBox(1.43, 2.58, 0.16, 0, 4.73, 1.29, GREEN);
  trimBox(0.98, 2.10, 0.10, Math.PI, 3.97, 13.87, GREEN);

  // The modeled gallery ends behind the sail sweep at railing height.
  const rim = (i, y) => [GALLERY_RADIUS * Math.sin((i + 0.5) * OCTAGON), y, GALLERY_RADIUS * Math.cos((i + 0.5) * OCTAGON)];
  for (let i = 0; i < 8; i++) {
    const a = rim(i, GALLERY_HEIGHT), b = rim(i + 1, GALLERY_HEIGHT);
    for (const t of [0, 1 / 3, 2 / 3]) {
      const x = THREE.MathUtils.lerp(a[0], b[0], t), z = THREE.MathUtils.lerp(a[2], b[2], t);
      beam([x, GALLERY_HEIGHT, z], [x, 13.92, z], 0.105, 0.105, PAINT);
      beam([x * 0.67, 8.6, z * 0.67], [x, 12.53, z], 0.20, 0.19, TIMBER);
    }
    for (const y of [13.02, 13.46, 13.89]) {
      beam(rim(i, y), rim(i + 1, y), 0.10, 0.085, PAINT);
    }
  }

  const shaft = finish(group);

  const roof = [[3.3, 23.28], [3.26, 23.8], [3.01, 24.68], [2.47, 25.3], [1.73, 26.04],
    [0.85, 26.56], [0, 26.72]].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(roof, 18), THATCH);

  // Tail beam, winding frame and characteristic white struts behind the cap.
  beam([0, 23.8, -2.82], [0, 13.06, -6.60], 0.33, 0.36, TIMBER);
  beam([-4.02, 23.23, -2.0], [4.02, 23.23, -2.0], 0.21, 0.20, PAINT);
  for (const side of [-1, 1]) {
    beam([side * 3.88, 23.22, -2.02], [0, 13.65, -6.40], 0.18, 0.16, PAINT);
    beam([side * 2.6, 19.9, -2.75], [0, 14.9, -6.08], 0.14, 0.14, TIMBER);
  }

  // Distinctive green beard with pale trim below the shaft.
  trimBox(2.34, 0.56, 0.15, 0, 3.09, 23.60, PAINT);
  trimBox(2.20, 0.44, 0.17, 0, 3.16, 23.61, GREEN);
  beam([0, SAIL_HUB - 0.43, 2.94], [0, SAIL_HUB, HUB_OFFSET], 0.61, 0.59, 0x4d5050);
  finish(cap);

  for (let i = 0; i < 4; i++) {
    const angle = SAIL_ANGLE + i * Math.PI / 2;
    const span = SAIL_RADII[i % 2];
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const point = (r, width, offset = 0) => [
      r * cos - width * sin, r * sin + width * cos, offset,
    ];
    beam(point(0, 0), point(span, 0), 0.25, 0.18, TIMBER);
    beam(point(2.24, -0.30), point(span, -0.31), 0.35, 0.16, PAINT);
    beam(point(1.65, 0.92), point(span, 1.55), 0.065, 0.062, TIMBER);
    beam(point(1.65, 0.49), point(span, 0.77), 0.057, 0.053, TIMBER);
    for (let row = 0; row <= 20; row++) {
      const t = row / 20;
      const r = THREE.MathUtils.lerp(1.65, span, t);
      beam(point(r, 0), point(r, 0.92 + 0.63 * t), 0.062, 0.042, TIMBER);
    }
  }

  finish(sails);
  addWindmillSailcloth(sails, { angle: SAIL_ANGLE, radii: SAIL_RADII, root: 1.65, innerWidth: 0.92, outerWidth: 1.55 });
  return { tower: group, shaft };
}
