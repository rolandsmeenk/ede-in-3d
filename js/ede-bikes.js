import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const EDE_BIKE_STYLES = [
  { id: 'omafiets', label: 'Omafiets', color: 0x282a2c, radius: 0.354, tireWidth: 0.042 },
  { id: 'transportfiets', label: 'Transportfiets', color: 0x3e7569, radius: 0.355, tireWidth: 0.050 },
  { id: 'ebike', label: 'City e-bike', color: 0x3b6691, radius: 0.355, tireWidth: 0.047 },
  { id: 'fatbike', label: 'Fatbike', color: 0x955939, radius: 0.318, tireWidth: 0.104 }
];

// Keep the rider's contact points and wheelbase aligned for the player and instanced traffic.
export const EDE_BIKE_FIT = {
  axle: 0.55, seat: [0, 0.98, -0.28], head: [0, 0.80, 0.45],
  grip: [0.22, 1.02, 0.40], bracket: [0, 0.34, -0.145]
};

const rubber = 0x1c1d20;
const trim = 0x383b3d;
const alloy = 0xaeb8bc;

export function buildEdeBike(style, detailed = false) {
  const { axle, seat, head, grip, bracket } = EDE_BIKE_FIT;
  const { id, color, radius, tireWidth } = style;
  const fat = id === 'fatbike';
  const frontHub = [0, radius, axle], rearHub = [0, radius, -axle];
  const body = [], fork = [], wheel = [];
  const steps = detailed ? 36 : 20;
  const round = detailed ? 10 : 6;
  const up = new THREE.Vector3(0, 1, 0);
  const add = (parts, geometry, rgb) => {
    const color = new THREE.Color(rgb);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let index = 0; index < colors.length; index += 3) color.toArray(colors, index);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  };
  const tube = (parts, a, b, width, rgb) => {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const axis = end.clone().sub(start);
    add(parts, new THREE.CylinderGeometry(width, width, axis.length(), round)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()))
      .translate(...start.add(end).multiplyScalar(0.5).toArray()), rgb);
  };
  const curve = (parts, points, width, rgb) => {
    const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    add(parts, new THREE.TubeGeometry(path, detailed ? 18 : 9, width, round, false), rgb);
  };
  const box = (parts, center, size, rgb, angle = 0) => {
    add(parts, new THREE.BoxGeometry(...size).rotateX(angle).translate(...center), rgb);
  };
  const profile = (parts, center, length, width, height, rgb, angle = 0) => {
    const geometry = new THREE.CapsuleGeometry(height, Math.max(0, length - 2 * height), detailed ? 4 : 2, round);
    add(parts, geometry.rotateX(Math.PI / 2).scale(width / (2 * height), 1, 1).rotateX(angle).translate(...center), rgb);
  };

  const section = fat ? 0.044 : 0.022;
  add(wheel, new THREE.TorusGeometry(radius - section, section, round, steps)
    .rotateY(Math.PI / 2).scale(tireWidth / (2 * section), 1, 1), rubber);
  const rimRadius = radius - section * 1.65;
  add(wheel, new THREE.TorusGeometry(rimRadius, fat ? 0.011 : 0.007, 5, steps).rotateY(Math.PI / 2), alloy);
  tube(wheel, [-tireWidth * 0.63, 0, 0], [tireWidth * 0.63, 0, 0], fat ? 0.046 : 0.021, trim);
  for (let spoke = 0; spoke < (detailed ? 16 : 8); spoke++) {
    const angle = spoke * Math.PI / (detailed ? 8 : 4);
    tube(wheel, [spoke % 2 ? 0.015 : -0.015, 0, 0],
      [0, rimRadius * Math.cos(angle), rimRadius * Math.sin(angle)], fat ? 0.003 : 0.002, alloy);
  }

  const saddlePost = [0, 0.83, -0.265];
  const tubeRadius = fat ? 0.035 : 0.019;
  tube(body, bracket, saddlePost, tubeRadius, color);
  for (const side of [-1, 1]) {
    const rearDropout = [side * (tireWidth / 2 + 0.017), radius, -axle];
    tube(body, bracket, rearDropout, tubeRadius * 0.74, color);
    tube(body, saddlePost, rearDropout, tubeRadius * 0.68, color);
    curve(fork, [[side * 0.022, head[1], head[2]], [side * (tireWidth / 2 + 0.019), 0.65, 0.47],
      [side * (tireWidth / 2 + 0.019), radius, axle]], fat ? 0.022 : 0.014, fat ? trim : color);
  }

  if (fat) {
    tube(body, bracket, head, 0.044, color);
    tube(body, [0, 0.87, -0.49], head, 0.033, color);
    tube(body, [0, 0.87, -0.49], rearHub, 0.021, color);
    box(body, [0, 0.60, 0.15], [0.117, 0.133, 0.47], trim, -0.58);
    profile(body, [0, 0.94, -0.21], 0.68, 0.175, 0.040, rubber);
  } else {
    const lowerRail = [[0, 0.75, -0.24], [0, 0.50, -0.06], [0, 0.54, 0.18], head];
    curve(body, lowerRail, id === 'ebike' ? 0.034 : 0.022, color);
    curve(body, [bracket, [0, 0.40, 0.085], head], 0.024, color);
    tube(body, saddlePost, [0, 0.95, seat[2]], 0.014, alloy);
    profile(body, [0, 0.947, seat[2]], 0.26, 0.177, 0.032, rubber);
    profile(body, [0.065, 0.357, -0.34], 0.55, 0.077, 0.058, trim);
    for (const side of [-1, 1]) {
      tube(body, [side * 0.12, 0.79, -0.79], [side * 0.12, 0.79, -0.31], 0.012, color);
      tube(body, [side * 0.12, 0.79, -0.76], [side * 0.055, radius, -axle], 0.009, alloy);
    }
    for (const z of [-0.76, -0.62, -0.48, -0.34]) tube(body, [-0.12, 0.79, z], [0.12, 0.79, z], 0.009, color);
    if (id === 'ebike') {
      box(body, [0, 0.529, 0.195], [0.081, 0.091, 0.36], trim, -0.58);
      profile(body, [0, 0.356, bracket[2]], 0.19, 0.135, 0.065, trim);
    }
    if (id === 'transportfiets') {
      // Crate on a front carrier, with open slats so the cargo box reads in profile.
      tube(body, [0, 0.65, 0.40], [0, 0.69, 0.75], 0.021, trim);
      box(body, [0, 0.71, 0.72], [0.31, 0.03, 0.30], trim);
      const crateColor = 0x9e6e48;
      for (const y of [0.74, 0.79, 0.84]) {
        for (const side of [-1, 1]) {
          box(body, [side * 0.155, y, 0.72], [0.016, 0.030, 0.32], crateColor);
          box(body, [0, y, 0.72 + side * 0.153], [0.30, 0.030, 0.016], crateColor);
        }
      }
      for (const x of [-0.145, 0.145]) {
        for (const z of [0.58, 0.86]) box(body, [x, 0.79, z], [0.023, 0.14, 0.022], crateColor);
      }
    }
  }

  const fender = (parts, z, start, arc) => {
    const width = fat ? 0.009 : 0.006;
    const geometry = new THREE.TorusGeometry(radius + 0.013, width, 5, steps, arc)
      .rotateZ(start).rotateY(-Math.PI / 2).scale((tireWidth + 0.014) / (width * 2), 1, 1);
    add(parts, geometry.translate(0, radius, z), fat ? trim : color);
  };
  fender(body, -axle, 0.11, Math.PI + 0.36);
  fender(fork, axle, 0.92, Math.PI - 0.64);
  tube(fork, head, [0, 1.01, head[2]], 0.017, alloy);
  curve(fork, [[-0.25, grip[1], grip[2]], [-0.14, 1.011, 0.45], [0, 1.008, 0.47],
    [0.14, 1.011, 0.45], [0.25, grip[1], grip[2]]], fat ? 0.018 : 0.012, alloy);
  for (const side of [-1, 1]) {
    tube(fork, [side * 0.18, 1.013, 0.415], [side * 0.25, grip[1], grip[2]], 0.018, rubber);
  }
  const lamp = [0, fat ? 0.79 : 0.70, fat ? 0.59 : 0.62];
  const lampRadius = fat ? 0.050 : 0.024;
  const bridgeWidth = tireWidth / 2 + 0.018;
  tube(fork, [-bridgeWidth, 0.68, 0.466], [bridgeWidth, 0.68, 0.466], 0.011, trim);
  tube(fork, [0, 0.68, 0.466], [0, lamp[1], lamp[2] - 0.019], 0.010, trim);
  add(fork, new THREE.CylinderGeometry(lampRadius, lampRadius, 0.073, round)
    .rotateX(Math.PI / 2).translate(...lamp), trim);
  add(fork, new THREE.CylinderGeometry(lampRadius * 0.83, lampRadius * 0.83, 0.006, round)
    .rotateX(Math.PI / 2).translate(lamp[0], lamp[1], lamp[2] + 0.037), 0xfff8d9);
  tube(body, [0, radius + 0.22, -0.77], [0, 0.63, -0.81], 0.010, trim);
  box(body, [0, 0.63, -0.81], [fat ? 0.085 : 0.061, 0.029, 0.022], 0xeb323e);
  return { body: mergeGeometries(body), fork: mergeGeometries(fork), wheel: mergeGeometries(wheel), lamp };
}
