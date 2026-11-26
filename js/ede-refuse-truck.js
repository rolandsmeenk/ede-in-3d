import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUS_SPEC, buildBusWheelGeo, createBusWheelMaterial } from './bus.js';
import { roundedBox } from './vehicles.js';

export const ACV_TRUCK = {
  length: 8.55, width: 2.54, axle: 2.3, mass: 23600, speed: 8.4, wheelRadius: BUS_SPEC.wheelRadius
};
export const SALT_SPREADER = { ...ACV_TRUCK, width: 2.52, mass: 18000, speed: 70 / 3.6 };

function truckMarkings(spreader) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (spreader) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(20, 43, 472, 106);
    ctx.fillStyle = '#184c85';
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Rijkswaterstaat', 256, 114);
  } else {
    for (const [color, points] of [
      ['#68a543', [[40, 106], [96, 29], [110, 90]]],
      ['#2d89b2', [[43, 119], [107, 104], [92, 152]]],
      ['#b6ce48', [[105, 148], [120, 101], [157, 118]]]
    ]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#303634';
    ctx.font = 'bold 124px Arial, sans-serif';
    ctx.fillText('acv', 162, 125);
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillText('Vanzelfsprekend in de buurt', 162, 161);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildAcvTruck() {
  return buildServiceTruck(false);
}

export function buildSaltSpreader() {
  return buildServiceTruck(true);
}

function buildServiceTruck(spreader) {
  const root = new THREE.Group();
  root.name = spreader ? 'Rijkswaterstaat salt spreader' : 'ACV refuse truck';
  root.visible = false;
  const paint = new THREE.MeshStandardNodeMaterial({ color: spreader ? 0xf09122 : 0xf9ca32, metalness: 0.19, roughness: 0.55 });
  const chassis = new THREE.MeshStandardNodeMaterial({ color: 0x424644, metalness: 0.32, roughness: 0.79 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x888a81, metalness: 0.46, roughness: 0.69 });
  const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x171a1b, roughness: 0.88 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x3c5261, metalness: 0.30, roughness: 0.22 });
  const lens = new THREE.MeshStandardNodeMaterial({ color: 0xe8eef3, emissive: 0xd1e3ff, emissiveIntensity: 0.2, roughness: 0.34 });
  const brake = new THREE.MeshStandardNodeMaterial({ color: 0xbc2317, emissive: 0xf22514, emissiveIntensity: 0.19 });
  const beacon = new THREE.MeshStandardNodeMaterial({ color: 0xffa016, emissive: 0xff9209, emissiveIntensity: 0.23 });
  const parts = new Map();
  const add = (material, geometry) => {
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geometry.index ? geometry.toNonIndexed() : geometry);
  };
  const box = (material, x, y, z, w, h, d) =>
    add(material, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const shell = (material, x, y, z, w, h, d, corner) => {
    const bevel = Math.min(0.033, w * 0.22, h * 0.22, d * 0.22);
    add(material, roundedBox(w / 2, h / 2, d, corner, bevel).translate(x, y, z));
  };
  const rod = (material, from, to, radius) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const axis = b.clone().sub(a);
    add(material, new THREE.CylinderGeometry(radius, radius, axis.length(), 10)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()))
      .translate(...a.add(b).multiplyScalar(0.5).toArray()));
  };

  // Low cab over a straight ladder frame with rear tandem.
  shell(chassis, 0, 0.82, 0.05, 1.82, 0.40, 7.72, 0.09);
  shell(paint, 0, 2.03, 2.84, 2.42, 2.13, 2.47, 0.19);
  shell(chassis, 0, 0.97, 3.77, 2.42, 0.38, 0.64, 0.11);
  shell(paint, 0, 1.48, 3.89, 2.32, 0.56, 0.42, 0.12);
  shell(rubber, 0, 1.49, 4.104, 1.55, 0.40, 0.066, 0.09);
  for (const y of [1.39, 1.47, 1.55, 1.63]) box(chassis, 0, y, 4.144, 1.43, 0.022, 0.022);
  for (const side of [-1, 1]) {
    const x = side * 1.208;
    shell(rubber, x, 2.53, 2.96, 0.06, 0.73, 1.48, 0.09);
    shell(glass, x + side * 0.035, 2.54, 2.96, 0.022, 0.65, 1.39, 0.08);
    box(chassis, x + side * 0.05, 2.53, 3.32, 0.019, 0.70, 0.038);
    box(rubber, x, 1.94, 2.27, 0.040, 0.048, 0.19);
    box(chassis, side * 1.06, 0.97, 3.34, 0.40, 0.14, 0.55);
    box(steel, side * 1.07, 0.71, 3.37, 0.38, 0.12, 0.47);
    rod(chassis, [x, 2.51, 3.53], [side * 1.41, 2.55, 3.7], 0.038);
    shell(rubber, side * 1.405, 2.66, 3.7, 0.19, 0.31, 0.13, 0.068);
    shell(lens, side * 0.949, 1.14, 4.116, 0.39, 0.13, 0.065, 0.052);
    box(steel, side * 1.14, 0.96, 0.43, 0.12, 0.17, 1.52);
    box(steel, side * 1.14, 0.67, 0.43, 0.12, 0.12, 1.52);
  }
  shell(rubber, 0, 2.53, 4.064, 2.14, 0.80, 0.091, 0.092);
  shell(glass, 0, 2.55, 4.116, 2.01, 0.71, 0.049, 0.080);
  for (const side of [-1, 1]) {
    rod(rubber, [side * 0.24, 2.23, 4.149], [side * 0.76, 2.36, 4.15], 0.016);
    rod(rubber, [side * 0.48, 2.21, 4.15], [side * 0.51, 2.29, 4.154], 0.015);
  }
  box(paint, 0, 0.91, 4.112, 0.43, 0.099, 0.041);

  if (spreader) {
    const hopper = new THREE.MeshStandardNodeMaterial({ color: 0xf9c527, roughness: 0.57 });
    const blue = new THREE.MeshStandardNodeMaterial({ color: 0x184c85, roughness: 0.63 });
    add(hopper, new THREE.CylinderGeometry(1, 0.61, 1.36, 4)
      .rotateY(Math.PI / 4).scale(1.64, 1, 2.88).translate(0, 2.18, -0.96));
    shell(rubber, 0, 2.91, -0.96, 2.29, 0.14, 4.02, 0.09);
    shell(hopper, 0, 2.29, -3.04, 2.24, 0.57, 0.24, 0.09);
    for (const side of [-1, 1]) {
      for (const x of [0.26, 0.60, 0.94]) {
        add(blue, new THREE.BoxGeometry(0.16, 0.63, 0.02)
          .rotateZ(side * Math.PI / 5).translate(side * x, 2.29, -3.17));
      }
      box(chassis, side * 1.03, 1.03, -1.94, 0.41, 0.17, 2.83);
      box(brake, side * 1.03, 1.02, -3.99, 0.28, 0.13, 0.08);
      add(beacon, new THREE.CylinderGeometry(0.086, 0.113, 0.13, 12).translate(side * 0.83, 3.17, 2.71));
      add(beacon, new THREE.CylinderGeometry(0.086, 0.113, 0.13, 12).translate(side * 0.95, 2.66, -3.03));
    }
    box(chassis, 0, 0.92, -3.97, 2.33, 0.26, 0.24);
    rod(steel, [0, 1.88, -2.65], [0, 0.62, -3.87], 0.17);
    add(steel, new THREE.CylinderGeometry(0.36, 0.36, 0.09, 20).translate(0, 0.55, -3.87));
    box(hopper, 0, 0.86, -4.1, 0.43, 0.105, 0.04);
  } else {
    shell(paint, 0, 2.18, -0.89, 2.47, 2.24, 4.53, 0.19);
    shell(paint, 0, 1.97, -3.55, 2.38, 2.06, 1.22, 0.23);
    shell(rubber, 0, 1.77, -4.139, 1.85, 1.13, 0.17, 0.19);
    shell(steel, 0, 1.27, -4.16, 1.76, 0.26, 0.22, 0.09);
    box(chassis, 0, 0.84, -4.11, 2.34, 0.19, 0.23);
    box(steel, 0, 0.94, -4.24, 1.49, 0.082, 0.13);
    box(paint, 0, 0.85, -4.238, 0.43, 0.105, 0.036);
    for (const side of [-1, 1]) {
      const x = side * 1.022;
      rod(steel, [x, 2.58, -3.55], [x, 1.61, -4.09], 0.080);
      rod(chassis, [x, 1.76, -4.0], [side * 0.76, 1.15, -4.29], 0.066);
      box(steel, side * 0.60, 1.37, -4.28, 0.19, 0.29, 0.14);
      box(brake, side * 1.01, 1.04, -4.252, 0.21, 0.11, 0.052);
      box(beacon, side * 0.83, 1.04, -4.252, 0.10, 0.11, 0.052);
      box(rubber, side * 1.05, 0.47, -3.08, 0.37, 0.49, 0.076);
      box(rubber, side * 1.05, 1.07, -1.92, 0.37, 0.16, 2.73);
      box(beacon, side * 1.24, 1.26, -1.57, 0.039, 0.08, 0.17);
      add(beacon, new THREE.CylinderGeometry(0.078, 0.108, 0.11, 12).translate(side * 0.90, 3.35, -2.80));
    }
    for (let i = -3; i <= 3; i++) box(steel, i * 0.18, 1.1, -4.25, 0.065, 0.27, 0.13);
  }

  for (const [material, geometries] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }

  const markings = new THREE.MeshStandardNodeMaterial({
    map: truckMarkings(spreader), alphaTest: 0.25, roughness: 0.61, polygonOffset: true, polygonOffsetFactor: -1
  });
  const panel = spreader ? new THREE.PlaneGeometry(1.42, 0.53) : new THREE.PlaneGeometry(2.93, 1.10);
  const wheels = [];
  const tireMaterial = createBusWheelMaterial();
  for (const side of [-1, 1]) {
    const logo = new THREE.Mesh(panel, markings);
    logo.rotation.y = side * Math.PI / 2;
    if (spreader) logo.position.set(side * 1.213, 1.83, 2.87);
    else logo.position.set(side * 1.238, 2.34, -0.74);
    logo.receiveShadow = true;
    root.add(logo);
    const tireGeometry = buildBusWheelGeo(side);
    for (const z of [2.68, -1.31, -2.57]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.05, ACV_TRUCK.wheelRadius, z);
      const wheel = new THREE.Mesh(tireGeometry, tireMaterial);
      wheel.castShadow = wheel.receiveShadow = true;
      pivot.add(wheel);
      root.add(pivot);
      wheels.push({ wheel, pivot, front: z > 0 });
    }
  }
  return { root, wheels, brake, beacon };
}
