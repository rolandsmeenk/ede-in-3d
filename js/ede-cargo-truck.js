import * as THREE from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityUniforms } from './tsl-materials.js';
import { CARGO_CLEARANCE } from './ede-vehicle-mix.js';
import { roundedBox } from './vehicles.js';

const headlight = [0.93, 0.92];
const taillight = [1.01, 0.77];

function truckSpec(clearance, axle, wheelRadius, cabPaint, trailer) {
  const { length, weight } = clearance;
  return {
    ...clearance, axle, mass: weight * 1000, wheelRadius, cabPaint, trailer,
    speed: 80 / 3.6, zFront: length / 2, zRear: -length / 2, headlight, taillight,
    lamps: [headlight[1], taillight[1]], lampX: [headlight[0], taillight[0]]
  };
}

export const CARGO_TRUCK_SPECS = {
  rigid: truckSpec(CARGO_CLEARANCE.rigid, 2.55, 0.50, 0xd9e2d9, false),
  semi: truckSpec(CARGO_CLEARANCE.semi, 1.8, 0.52, 0x435f93, true)
};

export function createCargoTruckMaterial() {
  const { attribute, smoothstep } = THREE.TSL;
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0.12, roughness: 0.61 });
  mat.emissiveNode = attribute('truckLamp', 'vec3').mul(smoothstep(0.60, 1.12, cityUniforms.uInteriorGlow));
  return mat;
}

// One draw call per variant, with the chassis centred between the bumpers and its nose on +Z.
export function buildCargoTruckGeometry(spec, cabPaint = spec.cabPaint) {
  const pieces = [];
  const tint = new THREE.Color();
  const glow = new THREE.Color();
  function add(geometry, paint, lamp = 0x000000) {
    const g = geometry.index ? geometry : mergeVertices(geometry);
    tint.set(paint);
    glow.set(lamp);
    const n = g.attributes.position.count;
    const colors = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    const lights = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    for (let i = 0; i < n; i++) {
      colors.setXYZ(i, tint.r, tint.g, tint.b);
      lights.setXYZ(i, glow.r, glow.g, glow.b);
    }
    g.setAttribute('color', colors);
    g.setAttribute('truckLamp', lights);
    pieces.push(g);
  }
  const box = (paint, x, y, z, w, h, d, lamp) =>
    add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), paint, lamp);
  const shell = (paint, x, y, z, w, h, d, r) =>
    add(roundedBox(w / 2, h / 2, d, r, 0.025).translate(x, y, z), paint);

  const rubber = 0x181b1f;
  const trim = 0x30373a;
  const steel = 0x969c9e;
  const glass = 0x304654;
  const cargoPaint = spec.trailer ? 0x63867d : 0xdce0db;
  const cargoStripe = spec.trailer ? 0xa4c0b3 : 0x617c73;
  const { zFront: nose, zRear: tail, wheelRadius: radius, width, height, trailer } = spec;
  const cabDepth = trailer ? 2.5 : 2.2;
  const cabHeight = trailer ? 3.63 : 3.10;
  const cargoFront = nose - cabDepth - (trailer ? 0.55 : 0.18);
  const cargoLength = cargoFront - tail - 0.08;
  const cargoZ = cargoFront - cargoLength / 2;
  const cargoFloor = 1.24;
  const cargoY = (height + cargoFloor) / 2;
  const frontAxle = nose - 1.24;
  const driveAxle = trailer ? frontAxle - 3.60 : frontAxle - 5.10;

  // Flat-front cab with the entry steps and bumper tucked around the steering axle.
  const cab = roundedBox(1.20, (cabHeight - 1.08) / 2, cabDepth - 0.10, 0.16, 0.04)
    .translate(0, (cabHeight + 1.08) / 2, nose - cabDepth / 2);
  const p = cab.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    const rake = Math.max(0, y - 2.03) * 0.15;
    p.setZ(i, z - rake * Math.max(0, 1 - (nose - z) / cabDepth));
  }
  cab.computeVertexNormals();
  add(cab, cabPaint);
  shell(trim, 0, 0.87, nose - 0.23, 2.42, 0.37, 0.40, 0.09);
  box(rubber, 0, 1.49, nose - 0.042, 1.61, 0.53, 0.04);
  for (const y of [1.30, 1.42, 1.54, 1.66]) box(trim, 0, y, nose - 0.017, 1.55, 0.027, 0.033);
  box(steel, 0, 1.7, nose - 0.0125, 0.15, 0.064, 0.025);
  const glassY = 2.42 + (trailer ? 0.16 : 0);
  const glassZ = nose - 0.041 - (glassY - 2.03) * 0.15;
  add(roundedBox(1.064, 0.407, 0.045, 0.10, 0.015).rotateX(-Math.atan(0.15))
    .translate(0, glassY, glassZ), rubber);
  add(roundedBox(1.025, 0.370, 0.032, 0.078, 0.009).rotateX(-Math.atan(0.15))
    .translate(0, glassY + 0.008, glassZ + 0.021), glass);
  for (const side of [-1, 1]) {
    box(rubber, side * 0.49, glassY - 0.279, glassZ + 0.072, 0.59, 0.023, 0.022);
    const sideGlassZ = nose - cabDepth / 2 - 0.045;
    box(rubber, side * 1.196, glassY, sideGlassZ, 0.026, 0.71, cabDepth - 0.57);
    box(glass, side * 1.212, glassY + 0.015, sideGlassZ, 0.018, 0.63, cabDepth - 0.68);
    box(trim, side * 1.225, glassY, sideGlassZ - 0.35, 0.017, 0.69, 0.06);
    box(trim, side * 1.216, 1.83, nose - cabDepth + 0.37, 0.032, 0.06, 0.18);
    box(rubber, side * 1.04, 0.94, nose - cabDepth + 0.28, 0.34, 0.14, 0.42);
    box(steel, side * 1.055, 0.72, nose - cabDepth + 0.28, 0.31, 0.094, 0.40);
    box(trim, side * 1.30, 2.22, nose - 0.40, 0.25, 0.058, 0.057);
    shell(rubber, side * 1.43, 2.34, nose - 0.40, 0.17, 0.33, 0.15, 0.05);
    box(glass, side * 1.43, 2.34, nose - 0.481, 0.105, 0.24, 0.022);
    box(0xf1f5eb, side * headlight[0], headlight[1], nose - 0.030, 0.33, 0.125, 0.06, 0xfff4dc);
    box(0xb5211b, side * taillight[0], taillight[1], tail + 0.019, 0.23, 0.13, 0.038, 0xf3291c);
    box(0xda8a26, side * 0.835, taillight[1], tail + 0.0175, 0.095, 0.13, 0.035);
  }
  box(0xddb443, 0, 0.79, nose - 0.018, 0.48, 0.105, 0.036);
  box(0xddb443, 0, 0.75, tail + 0.0185, 0.48, 0.105, 0.037);

  const frameTail = trailer ? driveAxle - 0.72 : tail + 0.08;
  box(trim, 0, 0.87, (nose - 0.18 + frameTail) / 2, 1.22, 0.33, nose - 0.18 - frameTail);
  box(trim, 0, 1.105, cargoZ, 1.91, 0.26, cargoLength);
  box(trim, 0, 0.76, tail + 0.14, width - 0.12, 0.24, 0.25);

  // Framed cargo box, or a curtainsider with a separate tractor chassis and three trailer axles.
  shell(cargoPaint, 0, cargoY, cargoZ, width - 0.04, height - cargoFloor, cargoLength, 0.05);
  for (const side of [-1, 1]) {
    const x = side * (width / 2 - 0.02);
    box(cargoStripe, x, cargoY - 0.21, cargoZ, 0.018, trailer ? 0.24 : 0.32, cargoLength - 0.25);
    for (const y of [cargoFloor + 0.035, height - 0.045]) box(steel, x, y, cargoZ, 0.040, 0.084, cargoLength);
    for (const z of [tail + 0.11, cargoFront - 0.03]) {
      box(steel, x, cargoY, z, 0.04, height - cargoFloor - 0.08, 0.09);
    }
    const guardFront = trailer ? cargoFront - 1.0 : nose - cabDepth - 0.38;
    const guardRear = trailer ? tail + 5.15 : driveAxle + 0.65;
    for (const y of [0.58, 0.81]) {
      box(steel, side * 1.09, y, (guardFront + guardRear) / 2, 0.095, 0.10, guardFront - guardRear);
    }
    if (trailer) {
      for (const t of [0.10, 0.23, 0.36, 0.49, 0.62, 0.75, 0.88]) {
        const z = tail + cargoLength * t;
        box(0x55726d, x, cargoFloor + 0.22, z, 0.016, 0.22, 0.056);
        box(steel, x, cargoFloor + 0.13, z, 0.019, 0.054, 0.077);
      }
      box(trim, side * 0.68, 0.66, cargoFront - 2.45, 0.16, 0.82, 0.19);
    }
    for (const t of [0.17, 0.50, 0.83]) {
      box(0xd38724, x, cargoFloor + 0.052, tail + cargoLength * t, 0.045, 0.066, 0.143, 0xf1a528);
    }
    box(steel, side * 0.59, cargoY, tail + 0.067, 0.065, height - cargoFloor - 0.25, 0.067);
    box(trim, side * 0.49, cargoFloor + 0.49, tail + 0.030, 0.26, 0.055, 0.060);
    box(0xb5211b, side * 1.1, height - 0.12, tail + 0.063, 0.084, 0.056, 0.047, 0xd32018);
  }
  box(trim, 0, cargoY, tail + 0.072, 0.033, height - cargoFloor - 0.16, 0.042);

  const axles = trailer ? [frontAxle, driveAxle, tail + 1.65, tail + 2.96, tail + 4.27] : [frontAxle, driveAxle];
  for (const z of axles) {
    for (const side of [-1, 1]) {
      const wide = z === driveAxle;
      const tireWidth = wide ? 0.46 : 0.31;
      const x = side * (1.21 - tireWidth / 2);
      add(new THREE.CylinderGeometry(radius, radius, tireWidth, 12).rotateZ(Math.PI / 2)
        .translate(x, radius, z), rubber);
      add(new THREE.CircleGeometry(radius * 0.63, 12).rotateY(side * Math.PI / 2)
        .translate(side * 1.212, radius, z), steel);
      add(new THREE.CircleGeometry(radius * 0.28, 8).rotateY(side * Math.PI / 2)
        .translate(side * 1.215, radius, z), trim);
      box(trim, side * 1.045, 1.06, z, 0.42, 0.105, 1.14);
      if (z !== frontAxle) box(rubber, side * 1.063, 0.61, z - 0.60, 0.36, 0.58, 0.08);
    }
  }

  const geometry = mergeGeometries(pieces);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
