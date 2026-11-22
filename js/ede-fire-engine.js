import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUS_SPEC, buildBusWheelGeo, createBusWheelMaterial } from './bus.js';
import { roundedBox } from './vehicles.js';

export const FIRE_ENGINE = {
  length: 7.50, width: 2.55, height: 3.24, axle: 2.20, mass: 14600, speed: 14.2,
  wheelRadius: BUS_SPEC.wheelRadius
};

export function buildEdeFireEngine() {
  const root = new THREE.Group();
  root.name = 'Dutch brandweer tankautospuit';
  root.visible = false;

  const paint = new THREE.MeshStandardNodeMaterial({ color: 0xc51e22, roughness: 0.48, metalness: 0.16 });
  const trim = new THREE.MeshStandardNodeMaterial({ color: 0x282d32, roughness: 0.72 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x364c59, roughness: 0.23, metalness: 0.24 });
  const aluminum = new THREE.MeshStandardNodeMaterial({ color: 0x979c9d, roughness: 0.54, metalness: 0.37 });
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf4f4ec, roughness: 0.5 });
  const blue = new THREE.MeshStandardNodeMaterial({ color: 0x17457a, roughness: 0.51 });
  const brake = new THREE.MeshStandardNodeMaterial({ color: 0xa51416, emissive: 0xf22219, emissiveIntensity: 0.19 });
  const beacon = new THREE.MeshStandardNodeMaterial({ color: 0x2873c5, emissive: 0x247aff, emissiveIntensity: 0.2 });
  const parts = new Map();
  function add(material, geometry) {
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geometry.index ? geometry.toNonIndexed() : geometry);
  }
  function box(material, x, y, z, width, height, depth, tilt = 0) {
    add(material, new THREE.BoxGeometry(width, height, depth).rotateX(tilt).translate(x, y, z));
  }
  function shell(material, x, y, z, width, height, depth) {
    add(material, roundedBox(width / 2, height / 2, depth, 0.14, 0.018).translate(x, y, z));
  }

  // Double cab and enclosed equipment body of a Dutch tankautospuit.
  shell(trim, 0, 0.81, 0, 1.68, 0.38, 6.84);
  shell(paint, 0, 2.01, 2.17, 2.29, 2.11, 2.88);
  shell(paint, 0, 2.13, -1.52, 2.46, 1.94, 4.14);
  shell(trim, 0, 1.04, 3.59, 2.39, 0.40, 0.25);
  shell(aluminum, 0, 0.91, -3.59, 2.35, 0.22, 0.27);
  box(glass, 0, 2.52, 3.619, 1.99, 0.67, 0.034);
  box(trim, 0, 2.53, 3.642, 0.046, 0.67, 0.017);
  box(trim, 0, 1.56, 3.623, 1.46, 0.36, 0.049);
  for (const y of [1.45, 1.55, 1.65]) box(aluminum, 0, y, 3.654, 1.25, 0.017, 0.016);

  // A low roof ladder and a shuttered pump compartment at the rear.
  box(aluminum, 0, 2.20, -3.602, 1.56, 1.20, 0.050);
  for (let y = 1.66; y < 2.78; y += 0.083) box(trim, 0, y, -3.631, 1.53, 0.014, 0.009);
  for (const x of [-0.56, -0.18]) box(aluminum, x, 3.152, -1.37, 0.043, 0.088, 3.77);
  for (let z = -3.14; z < 0.45; z += 0.28) box(aluminum, -0.37, 3.15, z, 0.44, 0.052, 0.037);

  const label = document.createElement('canvas');
  label.width = 384;
  label.height = 58;
  const ctx = label.getContext('2d');
  ctx.fillStyle = '#f6f5ee';
  ctx.font = 'bold 54px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BRANDWEER', 192, 30);
  const texture = new THREE.CanvasTexture(label);
  texture.colorSpace = THREE.SRGBColorSpace;
  const lettering = new THREE.MeshStandardNodeMaterial({ map: texture, alphaTest: 0.3, roughness: 0.55 });

  const wheels = [];
  const tireMaterial = createBusWheelMaterial();
  for (const side of [-1, 1]) {
    box(glass, side * 1.153, 2.50, 2.79, 0.033, 0.59, 1.22);
    box(glass, side * 1.152, 2.50, 1.48, 0.031, 0.55, 0.83);
    box(trim, side * 1.19, 2.55, 3.27, 0.17, 0.35, 0.15);
    box(trim, side * 1.163, 1.99, 1.36, 0.037, 0.072, 0.21);
    box(aluminum, side * 1.07, 1.08, 1.31, 0.31, 0.11, 0.56);
    box(white, side * 0.93, 1.28, 3.648, 0.35, 0.14, 0.065);
    box(brake, side * 1.01, 1.17, -3.635, 0.22, 0.13, 0.067);
    box(beacon, side * 0.59, 3.116, 3.02, 0.62, 0.16, 0.23);
    box(beacon, side * 0.98, 2.97, -3.601, 0.23, 0.112, 0.083);

    for (const z of [-2.52, -1.24, -0.05]) {
      box(aluminum, side * 1.237, 2.05, z, 0.032, 1.32, 1.02);
      box(trim, side * 1.259, 1.49, z, 0.019, 0.031, 0.53);
      for (let y = 1.53; y < 2.68; y += 0.082) box(trim, side * 1.254, y, z, 0.014, 0.012, 0.99);
    }
    for (let i = 0; i < 4; i++) {
      box(i % 2 ? blue : white, side * 1.156, 1.64, 2.08 + 0.245 * i, 0.022, 0.76, 0.126, 0.62);
    }
    add(lettering, new THREE.PlaneGeometry(2.06, 0.31).rotateY(side * Math.PI / 2)
      .translate(side * 1.241, 2.87, -1.49));
    const tire = buildBusWheelGeo(side);
    for (const z of [FIRE_ENGINE.axle, -2.11]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.085, FIRE_ENGINE.wheelRadius, z);
      const wheel = new THREE.Mesh(tire, tireMaterial);
      wheel.castShadow = wheel.receiveShadow = true;
      pivot.add(wheel);
      root.add(pivot);
      wheels.push({ pivot, wheel, front: z > 0 });
    }
  }
  box(paint, 0, 1.14, 3.716, 0.46, 0.103, 0.024);
  box(white, 0, 1.13, -3.727, 0.46, 0.103, 0.024);

  for (const [material, geometries] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = material !== lettering;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return { root, wheels, brake, beacon };
}
