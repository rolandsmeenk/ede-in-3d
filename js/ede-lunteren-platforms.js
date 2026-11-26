import * as THREE from 'three/webgpu';
import { CivicBatch, polygonNormal } from './ede-civic-landmarks.js';
import { applySnowMaterial } from './ede-snow.js';
import { EDE_DATA } from './ede-geodata.js';
import { EDE_NORTH_RAIL, hasNorthRail } from './ede-north-rail-data.js';

export function lunterenPlatformHeight([[ax, az, ay], [bx, bz, by]], x, z) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return ay + (by - ay) * t;
}

function trackFaceDistance(edge, x, z) {
  let distance = Infinity;
  for (let i = 1; i < edge.length; i++) {
    const [[ax, az], [bx, bz]] = [edge[i - 1], edge[i]];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return distance;
}

export function buildEdeLunterenPlatforms(scene) {
  if (!hasNorthRail(EDE_DATA)) return [];
  const group = new THREE.Group();
  group.name = 'Ede Lunteren platforms';
  scene.add(group);
  const surfaces = [];
  const batch = new CivicBatch();
  for (const feature of [...EDE_NORTH_RAIL.platforms, ...EDE_NORTH_RAIL.ramps]) {
    const height = (x, z) => lunterenPlatformHeight(feature.slope, x, z);
    const outer = feature.polygon.map(([x, z]) => ({ x, z }));
    const top = outer.map(({ x, z }) => [x, height(x, z), z]);
    if (polygonNormal(top).y < 0) top.reverse();
    batch.polygon([top], feature.edge ? 0x80817c : 0x96948d);
    surfaces.push({ id: 'lunteren-platform-' + (feature.number ?? 'ramp-' + feature.id), outer, holes: [], height });

    for (let i = 0; i < top.length; i++) {
      const a = top[i], b = top[(i + 1) % top.length];
      if (feature.edge && trackFaceDistance(feature.edge, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2) < 0.35) continue;
      const depth = feature.edge ? 0.92 : 0.55;
      batch.quad(b, a, [a[0], a[1] - depth, a[2]], [b[0], b[1] - depth, b[2]], 0x777570);
    }
    if (!feature.edge) continue;
    const centerX = outer.reduce((sum, p) => sum + p.x, 0) / outer.length;
    const centerZ = outer.reduce((sum, p) => sum + p.z, 0) / outer.length;
    for (let i = 1; i < feature.edge.length; i++) {
      const [x, z] = feature.edge[i - 1], [ex, ez] = feature.edge[i];
      const dx = ex - x, dz = ez - z, length = Math.hypot(dx, dz);
      const side = Math.sign(-dz * (centerX - x) + dx * (centerZ - z));
      const acrossX = -dz * side / length, acrossZ = dx * side / length;
      const a = height(x, z), b = height(ex, ez);
      const face = [[x, a, z], [ex, b, ez], [ex, b - 0.92, ez], [x, a - 0.92, z]];
      if (side < 0) face.reverse();
      batch.quad(...face, 0x777570);
      const stripe = [[x + acrossX * 0.32, a + 0.008, z + acrossZ * 0.32],
        [ex + acrossX * 0.32, b + 0.008, ez + acrossZ * 0.32],
        [ex + acrossX * 0.49, b + 0.008, ez + acrossZ * 0.49],
        [x + acrossX * 0.49, a + 0.008, z + acrossZ * 0.49]];
      if (polygonNormal(stripe).y < 0) stripe.reverse();
      batch.quad(...stripe, 0xeeede0);
    }
  }
  const mesh = batch.mesh();
  applySnowMaterial(mesh.material, { shelter: true });
  mesh.castShadow = false;
  group.add(mesh);
  return surfaces;
}
