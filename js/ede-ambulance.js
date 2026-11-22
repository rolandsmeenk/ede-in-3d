import * as THREE from 'three/webgpu';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildSteerableWheelGeo, createCarWheelMaterial } from './cars.js';
import { mirrorSection, roundedBox } from './vehicles.js';

export const AMBULANCE = {
  length: 6.08, width: 2.32, height: 2.85, axle: 1.85, mass: 3300, speed: 16.7
};

const WHEEL_RADIUS = 0.365;
const REAR_AXLE = -1.84;
const SIDES = [-1, 1];

function ambulanceLettering() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 66px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#153e67';
  ctx.fillText('AMBULANCE', 256, 39);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildEdeAmbulance() {
  const root = new THREE.Group();
  root.name = 'Ede ambulance';
  root.visible = false;

  const paint = new THREE.MeshStandardNodeMaterial({ color: 0xece438, metalness: 0.12, roughness: 0.44 });
  const trim = new THREE.MeshStandardNodeMaterial({ color: 0x272b31, roughness: 0.76 });
  const grille = new THREE.MeshStandardNodeMaterial({ color: 0x5b6268, metalness: 0.35, roughness: 0.47 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x304956, metalness: 0.25, roughness: 0.21 });
  const headlights = new THREE.MeshStandardNodeMaterial({ color: 0xdce8f1, roughness: 0.28 });
  const brake = new THREE.MeshStandardNodeMaterial({ color: 0xb51b20, emissive: 0xf22219, emissiveIntensity: 0.19 });
  const lens = new THREE.MeshStandardNodeMaterial({ color: 0x1664b9, emissive: 0x1a60f0, emissiveIntensity: 0.2, metalness: 0.17, roughness: 0.24 });
  const red = new THREE.MeshStandardNodeMaterial({ color: 0xdd2b32, roughness: 0.51 });
  const blue = new THREE.MeshStandardNodeMaterial({ color: 0x184c8b, roughness: 0.51 });

  const parts = new Map();
  const add = (material, geometry) => {
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geometry.index ? geometry.toNonIndexed() : geometry);
  };
  const box = (material, x, y, z, w, h, d) =>
    add(material, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const shell = (material, x, y, z, w, h, d, corner) => {
    const bevel = Math.min(0.035, w * 0.22, h * 0.22, d * 0.22);
    add(material, roundedBox(w / 2, h / 2, d, corner, bevel).translate(x, y, z));
  };
  const panel = (material, points) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    add(material, geometry);
  };
  const sidePanel = (material, side, points) =>
    panel(material, (side < 0 ? points : points.slice().reverse()).map(([x, y, z]) => [side * x, y, z]));

  // A short bonnet and raked cab sit ahead of the raised patient compartment.
  const bonnet = [
    [0.45, 1.006, 1.24], [1.95, 1.006, 1.24], [2.50, 0.969, 1.19],
    [2.85, 0.914, 1.13], [2.98, 0.823, 1.03]
  ].map(([z, x, top]) => mirrorSection([[x - 0.05, 0.79], [x, 0.86], [x - 0.035, top - 0.055]], [0, top], z));
  add(paint, new LoftGeometry(bonnet.reverse(), { capStart: true, capEnd: true }));
  const cab = [
    [0.44, 0.88, 2.09], [1.19, 0.88, 2.09], [1.25, 0.88, 2.075], [2.16, 0.958, 1.24]
  ].map(([z, x, top]) => mirrorSection([[0.983, 1.185], [x, top]], null, z));
  add(paint, new LoftGeometry(cab.reverse(), { capStart: true, capEnd: true }));
  panel(glass, [[-0.863, 1.328, 2.079], [0.863, 1.328, 2.079],
    [0.794, 2.028, 1.315], [-0.794, 2.028, 1.315]]);
  shell(paint, 0, 1.68, -1.22, 2.03, 1.72, 3.50, 0.14);
  shell(paint, 0, 2.47, -1.18, 1.98, 0.53, 3.52, 0.24);
  const roofSlope = [[1.10, 0.82, 2.106], [0.88, 0.88, 2.41], [0.53, 0.972, 2.71]]
    .map(([z, x, top]) => mirrorSection([[x, 2.03], [x, top - 0.08], [x - 0.063, top - 0.024]], [0, top], z));
  add(paint, new LoftGeometry(roofSlope, { capStart: true, capEnd: true }));
  shell(trim, 0, 0.55, -0.05, 1.41, 0.28, 5.68, 0.10);

  shell(trim, 0, 0.68, 2.83, 1.86, 0.32, 0.39, 0.12);
  shell(trim, 0, 0.93, 2.965, 1.24, 0.20, 0.091, 0.075);
  for (const y of [0.887, 0.944, 1.001]) box(grille, 0, y, 3.013, 0.98, 0.016, 0.012);
  shell(paint, 0, 0.67, 3.027, 0.46, 0.10, 0.022, 0.023);
  shell(trim, 0, 0.64, -2.90, 1.97, 0.28, 0.25, 0.10);
  box(grille, 0, 0.68, -3.012, 1.35, 0.056, 0.055);
  box(trim, 0, 1.54, -2.976, 0.023, 1.49, 0.013);
  shell(paint, 0, 1.00, -3.0, 0.45, 0.104, 0.030, 0.026);

  const skirt = new THREE.Shape();
  skirt.moveTo(-2.85, 0.60);
  for (const z of [REAR_AXLE, AMBULANCE.axle]) {
    skirt.lineTo(z - 0.44, 0.465);
    skirt.absarc(z, 0.39, 0.447, Math.PI - 0.17, 0.17, true);
  }
  skirt.lineTo(2.47, 0.68);
  skirt.lineTo(2.47, 0.945);
  skirt.lineTo(-2.85, 0.945);
  skirt.closePath();

  for (const side of SIDES) {
    const archPanel = new THREE.ExtrudeGeometry(skirt, { depth: 0.01, bevelEnabled: false, curveSegments: 8 });
    add(paint, archPanel.rotateY(-Math.PI / 2).translate(side * 1.004 + 0.005, 0, 0));
    sidePanel(glass, side, [[0.973, 1.36, 0.63], [0.980, 1.36, 1.94],
      [0.901, 1.97, 1.29], [0.896, 2.008, 0.63]]);
    box(trim, side * 0.995, 1.29, 0.72, 0.028, 0.036, 0.21);
    box(trim, side * 1.055, 1.36, 1.86, 0.19, 0.047, 0.09);
    shell(trim, side * 1.11, 1.46, 1.86, 0.10, 0.208, 0.18, 0.045);
    shell(headlights, side * 0.713, 1.015, 2.926, 0.34, 0.143, 0.138, 0.062);
    shell(glass, side * 1.01, 2.17, -0.39, 0.035, 0.41, 0.86, 0.053);
    box(trim, side * 1.017, 1.12, 0.043, 0.022, 0.045, 0.16);
    box(trim, side * 1.017, 0.959, -0.28, 0.022, 0.061, 2.34);
    shell(glass, side * 0.409, 1.987, -2.972, 0.54, 0.54, 0.047, 0.076);
    box(trim, side * 0.145, 1.49, -2.987, 0.14, 0.043, 0.032);
    shell(brake, side * 0.855, 1.06, -2.966, 0.148, 0.38, 0.132, 0.056);
    box(headlights, side * 0.855, 1.01, -3.034, 0.12, 0.069, 0.010);
    shell(lens, side * 0.712, 2.535, -2.885, 0.31, 0.112, 0.126, 0.042);

    for (const [color, z, y, span] of [[blue, -2.54, 1.33, 2.72], [red, -2.36, 1.13, 2.96]]) {
      sidePanel(color, side, [[1.018, y, z], [1.018, y, z + span],
        [1.018, y + 0.13, z + span - 0.30], [1.018, y + 0.13, z + 0.30]]);
    }
    for (const [color, y] of [[red, 1.16], [blue, 1.34]]) {
      shell(color, side * 0.439, y, -2.983, 0.71, 0.092, 0.024, 0.024);
    }
  }

  shell(trim, 0, 2.728, 0.28, 1.72, 0.069, 0.24, 0.033);
  for (const side of SIDES) shell(lens, side * 0.447, 2.781, 0.29, 0.82, 0.138, 0.23, 0.061);

  for (const [material, geometries] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = material !== red && material !== blue;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  const lettering = new THREE.MeshStandardNodeMaterial({ map: ambulanceLettering(), alphaTest: 0.25, roughness: 0.62 });
  const sign = (x, y, z, width, yaw, pitch = 0) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 72 / 512), lettering);
    mesh.position.set(x, y, z);
    mesh.rotation.set(pitch, yaw, 0);
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  sign(0, 1.628, -3.003, 1.28, Math.PI);
  sign(0, 1.109, 2.904, 1.04, 0, -0.92);

  const wheels = [];
  const wheelMaterial = createCarWheelMaterial({ wheelRadius: WHEEL_RADIUS });
  for (const side of SIDES) {
    sign(side * 1.019, 1.698, -1.27, 2.48, side * Math.PI / 2);
    const wheelGeometry = buildSteerableWheelGeo({ wheelRadius: WHEEL_RADIUS }, side);
    for (const z of [REAR_AXLE, AMBULANCE.axle]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.879, WHEEL_RADIUS, z);
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.castShadow = wheel.receiveShadow = true;
      pivot.add(wheel);
      root.add(pivot);
      wheels.push({ wheel, pivot, front: z === AMBULANCE.axle, radius: WHEEL_RADIUS });
    }
  }
  return { root, wheels, brake, beacon: lens };
}
