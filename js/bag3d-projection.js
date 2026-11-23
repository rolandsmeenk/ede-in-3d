import * as THREE from '../vendor/three/build/three.core.js';
import { projectLonLatInto } from './ede-scene-coordinates.js';

export const WGS84_A = 6378137;
const WGS84_B = 6356752.314245179;
const WGS84_E2 = 1 - (WGS84_B / WGS84_A) ** 2;
const WGS84_EP2 = (WGS84_A / WGS84_B) ** 2 - 1;
const DEG = 180 / Math.PI;

export function projectEcefToScene(affine, point) {
  const { x, y, z } = point;
  const p = Math.sqrt(x * x + y * y);
  // Bowring inverse. Normalize the auxiliary vector to get sine and cosine without two extra trig calls.
  const za = z * WGS84_A, pb = p * WGS84_B;
  const auxiliary = 1 / Math.sqrt(za * za + pb * pb);
  const sinTheta = za * auxiliary, cosTheta = pb * auxiliary;
  const vertical = z + WGS84_EP2 * WGS84_B * sinTheta ** 3;
  const horizontal = p - WGS84_E2 * WGS84_A * cosTheta ** 3;
  const upright = 1 / Math.sqrt(vertical * vertical + horizontal * horizontal);
  const sinLat = vertical * upright, cosLat = horizontal * upright;
  // This is ellipsoid height. Use it only for relief. NAP comes from the scene terrain or survey.
  point.y = p * cosLat + z * sinLat - WGS84_A * Math.sqrt(1 - WGS84_E2 * sinLat ** 2);
  return projectLonLatInto(affine, Math.atan2(y, x) * DEG, Math.atan2(vertical, horizontal) * DEG, point);
}

// Use a local Jacobian for source shading normals. Each vertex uses the full nonlinear position transform.
function projectedNormalMatrix(transform, position, project) {
  const matrix = new THREE.Matrix3();
  if (!project || !position.count) return matrix.getNormalMatrix(transform);
  const reference = new THREE.Vector3().fromBufferAttribute(position, 0).applyMatrix4(transform);
  const axes = ['x', 'y', 'z'].map(key => {
    const plus = reference.clone(), minus = reference.clone();
    plus[key] += 2;
    minus[key] -= 2;
    return project(plus).sub(project(minus)).multiplyScalar(0.25);
  });
  const [x, y, z] = axes;
  const local = new THREE.Matrix4().set(
    x.x, y.x, z.x, 0,
    x.y, y.y, z.y, 0,
    x.z, y.z, z.z, 0,
    0, 0, 0, 1
  );
  return matrix.getNormalMatrix(local.multiply(transform));
}

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function* projectBagMesh(pos, nor, fid, full, project, limitToMunicipality, projected) {
  const normalMatrix = projectedNormalMatrix(full, pos, project);
  const count = pos.count;
  const positions = projected ?? new Float32Array(count * 3);
  const normals = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  const baseByBuilding = new Map(), extents = new Map();
  for (let i = 0; i < count; i++) {
    if ((i & 1023) === 0) yield;
    if (!projected) {
      v.fromBufferAttribute(pos, i).applyMatrix4(full);
      if (project) project(v);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    }
    v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
    normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z;
    const seed = fid ? Math.round(fid.getX(i)) : 0;
    const y = positions[i * 3 + 1];
    baseByBuilding.set(seed, Math.min(baseByBuilding.get(seed) ?? Infinity, y));
    if (fid || limitToMunicipality) {
      const x = positions[i * 3], z = positions[i * 3 + 2];
      const bounds = extents.get(seed);
      if (bounds) {
        bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
        bounds.top = Math.max(bounds.top, y);
      } else {
        extents.set(seed, { minX: x, maxX: x, minZ: z, maxZ: z, top: y });
      }
    }
    const r = hash(seed + 1), s = hash(seed * 7 + 3);
    if (v.y > 0.35) c.setHSL(0.03 + s * 0.04, 0.12 + r * 0.12, 0.17 + r * 0.1); // roofs: dark tile / slate
    else if (r < 0.62) c.setHSL(0.045 + s * 0.03, 0.34 + r * 0.2, 0.30 + s * 0.12); // brick
    else if (r < 0.85) c.setHSL(0.11 + s * 0.04, 0.12 + s * 0.12, 0.52 + r * 0.14); // plaster / stone
    else c.setHSL(0.08 + s * 0.05, 0.08, 0.40 + s * 0.15);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  return { positions, normals, colors, baseByBuilding, extents };
}

export { projectBagMesh };
