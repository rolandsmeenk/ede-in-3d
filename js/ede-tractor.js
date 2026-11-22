import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox } from './vehicles.js';

export const TRACTOR = { length: 4.8, width: 2.56, height: 3.22, axle: 1.43, mass: 6800, speed: 9 };

export const TRACTOR_PALETTES = [
  { name: 'John Deere', body: 0x367532, roof: 0x367532, rim: 0xe8bf36, accent: 0xe8bf36 },
  { name: 'Fendt', body: 0x63795b, roof: 0x576457, rim: 0xb33e33, accent: 0xd3d6cf },
  { name: 'New Holland', body: 0x275fac, roof: 0x2f64ae, rim: 0xe0e1d9, accent: 0xe1c43f },
  { name: 'Massey Ferguson', body: 0xaa3833, roof: 0x4d4f4b, rim: 0xc0c2bf, accent: 0xdbd4c7 },
  { name: 'Claas', body: 0x99b13b, roof: 0xd4d7cc, rim: 0xb34832, accent: 0xd6dacb }
];

const FRONT_WHEEL = { x: 0.93, z: TRACTOR.axle, radius: 0.66, width: 0.42 };
const REAR_WHEEL = { x: 1, z: -1.28, radius: 0.98, width: 0.56 };
const SIDES = [-1, 1];

function geometryBatch() {
  const parts = new Map();
  function add(part, geometry) {
    if (!parts.has(part)) parts.set(part, []);
    parts.get(part).push(geometry.index ? geometry.toNonIndexed() : geometry);
  }
  return {
    add,
    box(part, x, y, z, width, height, depth) {
      add(part, new THREE.BoxGeometry(width, height, depth).translate(x, y, z));
    },
    shell(part, x, y, z, width, height, depth, corner) {
      const bevel = Math.min(0.025, width * 0.19, height * 0.19, depth * 0.19);
      add(part, roundedBox(width / 2, height / 2, depth, corner, bevel).translate(x, y, z));
    },
    rod(part, from, to, radius) {
      const a = new THREE.Vector3(...from);
      const b = new THREE.Vector3(...to);
      const delta = b.clone().sub(a);
      const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
      add(part, new THREE.CylinderGeometry(radius, radius, delta.length(), 8)
        .applyQuaternion(turn).translate(...a.add(b).multiplyScalar(0.5).toArray()));
    },
    finish() {
      return Array.from(parts, ([part, pieces]) => [part, mergeGeometries(pieces)]);
    }
  };
}

function pane(vertices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function fender(radius, width, start) {
  const inner = radius + 0.065;
  const outer = inner + 0.085;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, start, Math.PI - start, false);
  shape.absarc(0, 0, inner, Math.PI - start, start, true);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 5 })
    .translate(0, 0, -width / 2).rotateY(-Math.PI / 2);
}

function buildBody() {
  const { add, box, shell, rod, finish } = geometryBatch();
  shell('trim', 0, 0.84, 0.08, 0.83, 0.44, 3.78, 0.14);
  shell('trim', 0, 0.57, 2.215, 0.92, 0.34, 0.37, 0.09);
  box('steel', 0, 0.54, 2.395, 0.24, 0.085, 0.01);
  shell('trim', 0, 0.93, REAR_WHEEL.z, 1.24, 0.42, 0.48, 0.15);
  shell('trim', 0, 0.65, FRONT_WHEEL.z, 1.45, 0.19, 0.29, 0.07);
  shell('trim', 0, 1.48, -0.57, 1.43, 0.18, 2.03, 0.07);

  const hood = roundedBox(0.54, 0.445, 1.94, 0.16, 0.025);
  const positions = hood.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const nose = (positions.getZ(i) + 0.97) / 1.94;
    positions.setX(i, positions.getX(i) * (1 - nose * 0.13));
    positions.setY(i, positions.getY(i) - nose * 0.17);
  }
  hood.computeVertexNormals();
  add('body', hood.translate(0, 1.56, 1.21));
  shell('trim', 0, 1.25, 2.176, 0.79, 0.48, 0.056, 0.115);
  for (const y of [1.10, 1.16, 1.22, 1.28, 1.34, 1.40]) {
    box('steel', 0, y, 2.207, 0.62, 0.015, 0.016);
  }
  shell('accent', 0, 1.60, 2.183, 0.095, 0.058, 0.024, 0.021);

  const bottomFront = [[-0.70, 1.54, 0.45], [0.70, 1.54, 0.45]];
  const bottomBack = [[-0.70, 1.54, -1.63], [0.70, 1.54, -1.63]];
  const topFront = [[-0.62, 2.91, 0.16], [0.62, 2.91, 0.16]];
  const topBack = [[-0.62, 2.91, -1.46], [0.62, 2.91, -1.46]];
  add('glass', pane([bottomFront[0], bottomFront[1], topFront[1], topFront[0]]));
  add('glass', pane([bottomBack[1], bottomBack[0], topBack[0], topBack[1]]));
  add('glass', pane([bottomBack[0], bottomFront[0], topFront[0], topBack[0]]));
  add('glass', pane([bottomFront[1], bottomBack[1], topBack[1], topFront[1]]));
  shell('roof', 0, 2.96, -0.65, 1.51, 0.22, 1.92, 0.10);

  for (const [index, side] of SIDES.entries()) {
    rod('trim', bottomFront[index], topFront[index], 0.045);
    rod('trim', bottomBack[index], topBack[index], 0.047);
    rod('trim', [side * 0.707, 1.55, -0.87], [side * 0.627, 2.90, -0.86], 0.026);
    rod('trim', [side * 0.682, 1.99, -1.56], [side * 0.682, 1.99, 0.36], 0.021);
    box('trim', side * 0.711, 1.92, -0.74, 0.044, 0.038, 0.13);
    rod('trim', [side * 0.64, 2.63, 0.20], [side * 1.13, 2.60, 0.39], 0.026);
    shell('trim', side * 1.14, 2.53, 0.40, 0.23, 0.30, 0.11, 0.050);
    shell('steel', side * 1.14, 2.53, 0.342, 0.18, 0.25, 0.019, 0.036);
    add('body', fender(REAR_WHEEL.radius, REAR_WHEEL.width, 0.14)
      .translate(side * REAR_WHEEL.x, REAR_WHEEL.radius, REAR_WHEEL.z));
    for (const [x, y, z] of [[0.90, 0.54, 0.03], [0.84, 0.82, -0.03], [0.76, 1.10, -0.08]]) {
      box('trim', side * x, y, z, 0.33, 0.105, 0.37);
      box('steel', side * x, y + 0.041, z + 0.17, 0.31, 0.025, 0.036);
    }
    add('accent', new THREE.BoxGeometry(0.022, 0.056, 1.26)
      .rotateY(-side * 0.036).translate(side * 0.515, 1.58, 1.14));
    shell('lens', side * 0.28, 1.56, 2.19, 0.26, 0.13, 0.043, 0.044);
    shell('lens', side * 0.52, 2.95, 0.314, 0.18, 0.082, 0.048, 0.030);
    shell('trim', side * 0.89, 1.64, -2.13, 0.32, 0.15, 0.15, 0.057);
    box('brake', side * 0.956, 1.64, -2.211, 0.15, 0.09, 0.022);
    box('amber', side * 0.814, 1.64, -2.211, 0.10, 0.09, 0.022);
    rod('steel', [side * 0.38, 0.66, -1.52], [side * 0.58, 0.51, -2.34], 0.052);
    rod('trim', [side * 0.35, 1.24, -1.70], [side * 0.49, 0.56, -2.00], 0.041);
    box('steel', side * 0.58, 0.51, -2.35, 0.15, 0.13, 0.10);
  }

  rod('trim', [-0.02, 1.66, 0.44], [-0.39, 2.27, 0.31], 0.012);
  rod('trim', [-0.22, 1.95, 0.397], [-0.47, 2.20, 0.351], 0.014);
  rod('trim', [0.64, 1.14, 0.68], [0.64, 2.31, 0.68], 0.074);
  rod('steel', [0.64, 2.30, 0.68], [0.64, 2.59, 0.58], 0.048);
  rod('steel', [0, 1.20, -1.73], [0, 0.88, -2.13], 0.055);
  rod('steel', [0, 0.78, -1.75], [0, 0.78, -2.15], 0.048);
  rod('trim', [-0.51, 3.01, -1.28], [-0.51, 3.12, -1.28], 0.077);
  add('amber', new THREE.CylinderGeometry(0.057, 0.070, 0.12, 12).translate(-0.51, 3.16, -1.28));
  return finish();
}

function buildWheel({ radius, width }, front) {
  const { add, rod, finish } = geometryBatch();
  const half = width / 2;
  const profile = [
    [0, -half + 0.024], [radius * 0.57, -half + 0.024], [radius * 0.76, -half],
    [radius * 0.92, -half + 0.040], [radius - 0.039, -half + 0.085],
    [radius - 0.039, half - 0.085], [radius * 0.92, half - 0.040], [radius * 0.76, half],
    [radius * 0.57, half - 0.024], [0, half - 0.024]
  ].map(([r, x]) => new THREE.Vector2(r, x));
  add('rubber', new THREE.LatheGeometry(profile, 24).rotateZ(-Math.PI / 2));

  const count = front ? 14 : 18;
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count;
    for (const side of SIDES) {
      add('rubber', new THREE.BoxGeometry(half * 0.99, 0.055, 0.076)
        .rotateY(-side * 0.55)
        .translate(side * half * 0.46, radius - 0.0275, 0)
        .rotateX(angle));
    }
  }

  for (const side of SIDES) {
    rod('rim', [side * (half - 0.036), 0, 0], [side * (half - 0.005), 0, 0], radius * 0.60);
    rod('rim', [side * (half - 0.023), 0, 0], [side * (half - 0.010), 0, 0], radius * 0.36);
    rod('steel', [side * (half - 0.014), 0, 0], [side * half, 0, 0], radius * 0.16);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const y = radius * 0.25 * Math.sin(angle);
      const z = radius * 0.25 * Math.cos(angle);
      rod('steel', [side * (half - 0.014), y, z], [side * (half - 0.004), y, z], 0.022);
    }
  }
  return finish();
}

function addMeshes(parent, parts, materials) {
  for (const [part, geometry] of parts) {
    const mesh = new THREE.Mesh(geometry, materials[part]);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

let geometry;

export function buildEdeTractor(palette = TRACTOR_PALETTES[0]) {
  geometry ??= {
    body: buildBody(),
    front: buildWheel(FRONT_WHEEL, true),
    rear: buildWheel(REAR_WHEEL, false),
    frontFender: [['trim', fender(FRONT_WHEEL.radius, FRONT_WHEEL.width + 0.025, 0.42)]]
  };
  const root = new THREE.Group();
  root.name = 'Agricultural tractor';
  root.visible = false;
  const material = (color, roughness, metalness = 0) =>
    new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
  const brake = new THREE.MeshStandardNodeMaterial({
    color: 0xb52420, emissive: 0xf31b11, emissiveIntensity: 0.19
  });
  const materials = {
    body: material(TRACTOR_PALETTES[0].body, 0.46, 0.16),
    roof: material(TRACTOR_PALETTES[0].roof, 0.54, 0.12),
    rim: material(TRACTOR_PALETTES[0].rim, 0.54, 0.21),
    accent: material(TRACTOR_PALETTES[0].accent, 0.60, 0.08),
    trim: material(0x252b2b, 0.75, 0.12),
    steel: material(0x656b69, 0.66, 0.40),
    rubber: material(0x252727, 0.91),
    glass: material(0x3c535d, 0.22, 0.29),
    lens: new THREE.MeshStandardNodeMaterial({
      color: 0xe1e9eb, emissive: 0xd4eaff, emissiveIntensity: 0.17, roughness: 0.31
    }),
    amber: material(0xe68212, 0.45),
    brake
  };
  function setPalette(colors) {
    for (const part of ['body', 'roof', 'rim', 'accent']) {
      materials[part].color.set(colors?.[part] ?? TRACTOR_PALETTES[0][part]);
    }
  }
  setPalette(palette);
  addMeshes(root, geometry.body, materials);

  const wheels = [];
  for (const [fit, front] of [[FRONT_WHEEL, true], [REAR_WHEEL, false]]) {
    for (const side of SIDES) {
      const pivot = new THREE.Group();
      const wheel = new THREE.Group();
      pivot.position.set(side * fit.x, fit.radius, fit.z);
      addMeshes(wheel, front ? geometry.front : geometry.rear, materials);
      if (front) addMeshes(pivot, geometry.frontFender, materials);
      pivot.add(wheel);
      root.add(pivot);
      wheels.push({ wheel, pivot, front, radius: fit.radius });
    }
  }
  return { root, wheels, brake, setPalette };
}
