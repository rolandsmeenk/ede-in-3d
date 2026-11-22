import * as THREE from 'three/webgpu';
import { color, smoothstep } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

const turn = 2 * Math.PI, hourMarks = 12;
const hand = new THREE.Shape([
  new THREE.Vector2(-0.5, -0.10), new THREE.Vector2(0.5, -0.10),
  new THREE.Vector2(0.28, 0.91), new THREE.Vector2(0, 1), new THREE.Vector2(-0.28, 0.91),
]);
const handGeometry = new THREE.ShapeGeometry(hand);
const clockMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
clockMaterial.emissiveNode = color(0xffd7a3).mul(0.85)
  .mul(smoothstep(0.65, 1.50, cityUniforms.uInteriorGlow));

// point maps local horizontal, vertical and outward distances onto the dial.
export function clockFace(point, radius, color, markColor = color) {
  const center = new THREE.Vector3(...point(0, 0, 0));
  const right = new THREE.Vector3(...point(1, 0, 0)).sub(center);
  const up = new THREE.Vector3(...point(0, 1, 0)).sub(center);
  const depth = new THREE.Vector3(...point(0, 0, 1)).sub(center);
  const normal = right.clone().cross(up).normalize();
  // Facade helpers use different directions along the wall. Read clockwise from outside.
  if (normal.dot(depth) < 0) {
    right.negate();
    normal.negate();
  }
  return { center, right, up, normal, radius, color, markColor };
}

export function addRoundClock(batch, point, radius, dial, marks, rim) {
  const face = clockFace(point, radius, marks);
  const { center, right, up, normal } = face;
  const at = (x, y, depth) => center.clone().addScaledVector(right, x)
    .addScaledVector(up, y).addScaledVector(normal, depth).toArray();
  const disc = (r, depth, color) => batch.polygon([Array.from({ length: 24 }, (_, i) => {
    const angle = turn * i / 24;
    return at(Math.cos(angle) * r, Math.sin(angle) * r, depth);
  })], color);
  if (rim !== undefined) disc(radius + 0.05, -0.02, rim);
  disc(radius, 0, dial);
  face.center.addScaledVector(normal, 0.024);
  return face;
}

export function addClockDetails(group, faces) {
  if (!faces.length) return;
  const hands = faces.length * 2;
  const mesh = new THREE.InstancedMesh(handGeometry, clockMaterial, hands + faces.length * hourMarks);
  mesh.name = 'Clock hands and hour marks';
  mesh.userData.nearDetail = 240;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const bounds = new THREE.Box3(), instance = new THREE.Matrix4();
  const scale = new THREE.Vector3(), position = new THREE.Vector3();
  const poses = faces.map(({ center, right, up, normal, radius, color, markColor }, index) => {
    const tint = new THREE.Color(color);
    mesh.setColorAt(index * 2, tint);
    mesh.setColorAt(index * 2 + 1, tint);
    for (const side of [-1, 1]) {
      for (const height of [-1, 1]) {
        bounds.expandByPoint(center.clone().addScaledVector(right, side * radius).addScaledVector(up, height * radius));
      }
    }
    const hour = new THREE.Matrix4().makeBasis(right, up, normal).setPosition(center);
    const markTint = new THREE.Color(markColor);
    for (let i = 0; i < hourMarks; i++) {
      const angle = turn * i / hourMarks;
      const inner = radius * (i % 3 === 0 ? 0.72 : 0.79), length = radius * 0.92 - inner;
      position.set(Math.sin(angle) * inner, Math.cos(angle) * inner, -0.006);
      instance.makeRotationZ(-angle).scale(scale.set(radius * 0.090, length, 1)).setPosition(position);
      const marker = hands + index * hourMarks + i;
      mesh.setMatrixAt(marker, instance.premultiply(hour));
      mesh.setColorAt(marker, markTint);
    }
    return {
      hour,
      minute: new THREE.Matrix4().makeBasis(right, up, normal).setPosition(center.clone().addScaledVector(normal, 0.008)),
      radius,
    };
  });
  mesh.boundingBox = bounds.expandByScalar(0.01);
  mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());

  const rotation = [new THREE.Matrix4(), new THREE.Matrix4()];
  let lastMinute;
  mesh.userData.setClockMinutes = (minutes) => {
    if (minutes === lastMinute) return;
    lastMinute = minutes;
    rotation[0].makeRotationZ(-turn * (minutes % 720) / 720);
    rotation[1].makeRotationZ(-turn * (minutes % 60) / 60);
    for (const [i, { hour, minute, radius }] of poses.entries()) {
      instance.copy(rotation[0]).scale(scale.set(radius * 0.10, radius * 0.62, 1)).premultiply(hour);
      mesh.setMatrixAt(i * 2, instance);
      instance.copy(rotation[1]).scale(scale.set(radius * 0.067, radius * 0.84, 1)).premultiply(minute);
      mesh.setMatrixAt(i * 2 + 1, instance);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  mesh.userData.setClockMinutes(0);
  group.add(mesh);
}
