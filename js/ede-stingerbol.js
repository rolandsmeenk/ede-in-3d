import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The 18.85 m plan diameter follows OSM w271575955. The operator reports a 20 m shell height.
const RADIUS = 9.42;
const LOWER_EDGE = 0.42;
const MIDDLE = 8.95;
const CROWN = 20;
const PANELS = 32;
const TURN = 2 * Math.PI;
const ROWS = [LOWER_EDGE, 1.78, 3.25, 4.75, 6.25, 7.75, 9.28, 10.65, 12.05, 13.45,
  14.8, 16.05, 17.2, 18.2, 19.0, 19.52, 19.82, CROWN];

function verticalRadius(y) {
  return y < MIDDLE ? 16.7 : 11.07;
}

function shellRadius(y) {
  return RADIUS * Math.sqrt(Math.max(0, 1 - ((y - MIDDLE) / verticalRadius(y)) ** 2));
}

function makeShell() {
  const positions = [], normals = [], colors = [], indices = [];
  const aluminium = new THREE.Color('#b2bcc0');
  const ribs = new THREE.Color('#889499');
  const courseSeams = new THREE.Color('#949c9d');
  const panel = new THREE.Color();
  const normal = new THREE.Vector3();

  function face(a, b, bottom, top, depth, color) {
    const base = positions.length / 3;
    for (const [angle, y] of [[a, bottom], [b, bottom], [b, top], [a, top]]) {
      const r = shellRadius(y), x = Math.sin(angle), z = Math.cos(angle);
      positions.push((r + depth) * x, y, (r + depth) * z);
      normal.set(x * r / RADIUS ** 2, (y - MIDDLE) / verticalRadius(y) ** 2, z * r / RADIUS ** 2).normalize();
      normals.push(normal.x, normal.y, normal.z);
      colors.push(color.r, color.g, color.b);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  for (let col = 0; col < PANELS; col++) {
    const a = TURN * col / PANELS, b = TURN * (col + 1) / PANELS;
    for (let row = 0; row < ROWS.length - 1; row++) {
      const bottom = ROWS[row], top = ROWS[row + 1];
      const variation = ((col * 29 + row * 13 + col * row * 11) % 23) / 23;
      const shade = 0.92 + variation * 0.11 - (row === 0 ? 0.16 : 0);
      panel.copy(aluminium).multiplyScalar(shade);
      face(a, b, bottom, top, 0, panel);
      if (row) face(a, b, bottom - 0.012, bottom + 0.012, 0.018, courseSeams);
      const halfRib = Math.min(0.04, 0.026 / shellRadius(top));
      face(a - halfRib, a + halfRib, bottom, top, 0.025, ribs);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export function createStingerbol() {
  const model = new THREE.Group();
  model.name = 'Stingerbol';
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.76, metalness: 0.24 });
  const shell = new THREE.Mesh(makeShell(), metal);
  const parts = [];

  function add(geometry, hex) {
    const color = new THREE.Color(hex);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  }

  function box(x, y, z, width, height, depth, color) {
    add(new THREE.BoxGeometry(width, height, depth).translate(x, y, z), color);
  }

  function bar(a, b, radius, color) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    const center = start.add(end).multiplyScalar(0.5);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 5);
    add(geometry.applyQuaternion(rotation).translate(center.x, center.y, center.z), color);
  }

  // The skirt, service belt and shutter distinguish the Stingerbol from a smooth sphere.
  const beltY = ROWS[6];
  const belt = new THREE.TorusGeometry(shellRadius(beltY) + 0.04, 0.068, 5, 64);
  add(belt.rotateX(Math.PI / 2).translate(0, beltY, 0), '#6b7373');
  const plinth = shellRadius(LOWER_EDGE) + 0.07;
  add(new THREE.CylinderGeometry(plinth, plinth, LOWER_EDGE, PANELS).translate(0, LOWER_EDGE / 2, 0), '#a6a49a');
  add(new THREE.CylinderGeometry(0.54, shellRadius(CROWN) + 0.035, 0.1, 20)
    .translate(0, CROWN + 0.03, 0), '#aab2b7');

  box(0, 2.08, 8.62, 5.46, 4.16, 3.78, '#9ba6aa');
  box(0, 4.26, 8.70, 5.54, 0.28, 3.88, '#aeb7b8');
  box(0, 2.0, 10.53, 4.72, 3.84, 0.10, '#666e71');
  box(0, 1.97, 10.60, 4.56, 3.74, 0.075, '#808788');
  for (let i = 0; i < 17; i++) box(0, 2.23 + i * 0.095, 10.647, 4.56, 0.022, 0.036, '#a2a7a6');
  box(-1.10, 1.13, 10.65, 1.12, 2.26, 0.068, '#4c575d');
  box(-1.10, 1.11, 10.70, 0.99, 2.20, 0.04, '#727e83');
  box(-0.76, 1.05, 10.738, 0.16, 0.036, 0.04, '#b0b2af');

  const ladderAngle = 0.30, steel = '#737777';
  function ladderPoint(y, lateral, depth) {
    const r = shellRadius(y) + depth;
    return [Math.sin(ladderAngle) * r + Math.cos(ladderAngle) * lateral, y,
      Math.cos(ladderAngle) * r - Math.sin(ladderAngle) * lateral];
  }
  const ladderRows = Array.from({ length: 24 }, (_, i) => beltY + (CROWN - beltY) * Math.sin(i * Math.PI / 46));
  for (let i = 0; i < ladderRows.length; i++) {
    const y = ladderRows[i];
    bar(ladderPoint(y, -0.24, 0.20), ladderPoint(y, 0.24, 0.20), 0.023, steel);
    if (i) {
      for (const side of [-0.24, 0.24]) {
        bar(ladderPoint(ladderRows[i - 1], side, 0.20), ladderPoint(y, side, 0.20), 0.036, steel);
      }
    }
    if (i % 3 === 0) {
      const hoop = Array.from({ length: 7 }, (_, j) => {
        const angle = Math.PI * j / 6;
        return ladderPoint(y, -Math.cos(angle) * 0.30, 0.20 + Math.sin(angle) * 0.57);
      });
      for (let j = 1; j < hoop.length; j++) bar(hoop[j - 1], hoop[j], 0.020, steel);
    }
  }
  const landing = [-0.32, 0.32].map(lateral => {
    const foot = ladderPoint(CROWN, lateral, 0.20);
    const top = [foot[0], CROWN + 0.74, foot[2]];
    bar(foot, top, 0.034, steel);
    return top;
  });
  bar(landing[0], landing[1], 0.028, steel);

  const hardware = new THREE.Mesh(mergeGeometries(parts), metal);
  parts.forEach(geometry => geometry.dispose());
  for (const mesh of [shell, hardware]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    model.add(mesh);
  }
  return model;
}
