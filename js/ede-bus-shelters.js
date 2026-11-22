import * as THREE from 'three/webgpu';
import { edeAdMaterial } from './ede-advertising.js';

const ROOF = 2.26;
const FRAME = 0x394649;
const posterSize = [1.185, 1.75];

// Local axes follow the boarding lane; the open side of the shelter faces the bus.
export function fitShelter({ x, z, tx, tz, green, pose, setback, along: alongOffset }, blocked, groundAt) {
  const halfLength = green ? 2.35 : 2.0;
  const halfDepth = green ? 0.865 : 0.8;
  const dx = -tz, dz = tx;
  const setbacks = setback == null ? [2.35, 2.95, 3.55, 4.3, 5.2, 5.8] : [setback];
  const offsets = alongOffset == null ? [-3.25, -1.25, 2.5, 3.8] : [alongOffset];
  for (const back of setbacks) for (const along of offsets) {
    const cx = x + dx * back + tx * along, cz = z + dz * back + tz * along;
    const point = (u, v) => ({ x: cx + u * tx + v * dx, z: cz + u * tz + v * dz });
    const corners = [point(-halfLength, -halfDepth), point(halfLength, -halfDepth),
      point(halfLength, halfDepth), point(-halfLength, halfDepth)];
    const checks = [...corners, point(0, -halfDepth), point(0, halfDepth), point(0, 0)];
    if (checks.some(p => blocked(p.x, p.z))) continue;
    const front = back - halfDepth;
    if (pose?.platform && front < pose.platform.width + 0.6) continue;
    if (pose?.sign) {
      const sx = pose.sign.x - cx, sz = pose.sign.z - cz;
      if (Math.abs(sx * tx + sz * tz) < halfLength + 0.3 &&
          Math.abs(sx * dx + sz * dz) < halfDepth + 0.3) continue;
    }
    const heights = corners.map(p => groundAt(p.x, p.z));
    if (Math.max(...heights) - Math.min(...heights) > 0.7) continue;
    return { x: cx, y: groundAt(cx, cz), z: cz, tx, tz, yaw: Math.atan2(dx, dz), halfLength, halfDepth, corners, point };
  }
}

function shelterParts(site, pose, solid, glass, posters, colliders) {
  const { halfLength: end, halfDepth: side, y, point, yaw } = pose;
  const width = end * 2, depth = side * 2;
  const place = (u, height, v) => {
    const { x, z } = point(u, v);
    return [x, y + height, z];
  };
  const part = (u, h, v, w, ht, d, color) => solid.push({ position: place(u, h, v), yaw, size: [w, ht, d], color });
  const pane = (u, v, w, d) => glass.push({ position: place(u, 1.24, v), yaw, size: [w, 1.73, d] });
  function wall(u, v, w, d) {
    const { x, z } = point(u, v);
    const radius = Math.hypot(w, d) / 2;
    colliders.push({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius,
      minY: y + 0.22, maxY: y + ROOF, kind: 'bus-shelter',
      obb: { cx: x, cz: z, hx: w / 2, hz: d / 2, cs: pose.tx, sn: -pose.tz } });
  }

  part(0, ROOF + 0.05, 0, width, 0.10, depth, 0x566464);
  if (site.green) part(0, ROOF + 0.13, 0, width - 0.17, 0.09, depth - 0.16, 0x69754b);
  const back = side - 0.13, left = -end + 0.15, right = end - 0.15;
  for (const u of [left, 0, right]) part(u, 1.05, back, 0.075, 2.42, 0.075, FRAME);
  for (const u of [left, right]) part(u, 1.05, -side + 0.2, 0.075, 2.42, 0.075, FRAME);
  part(0, 2.16, back, width - 0.22, 0.055, 0.08, FRAME);
  part(0, 0.34, back, width - 0.22, 0.065, 0.08, FRAME);
  pane(0, back, width - 0.29, 0.027);
  pane(right, 0.08, 0.027, depth - 0.54);
  wall(0, back, width - 0.21, 0.10);
  wall(right, 0.08, 0.09, depth - 0.54);
  if (site.bench) {
    part(0, 0.47, side - 0.38, 1.85, 0.092, 0.37, 0x776657);
    for (const u of [-0.72, 0.72]) part(u, 0.20, side - 0.38, 0.065, 0.44, 0.26, FRAME);
  }
  if (site.ad) {
    part(left, 1.22, 0.045, 0.105, 1.84, 1.27, FRAME);
    for (const flip of [-1, 1]) posters.push({ position: place(left + flip * 0.055, 1.22, 0.045),
      yaw: yaw + flip * Math.PI / 2, size: [...posterSize, 1] });
    wall(left, 0.045, 0.11, 1.27);
  } else {
    pane(left, 0.08, 0.027, depth - 0.54);
    wall(left, 0.08, 0.09, depth - 0.54);
  }
}

export function batchBusStopParts(group, name, instances, geometry, material, distance, castShadow = false) {
  if (!instances.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  mesh.name = name;
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(), matrix = new THREE.Matrix4(), color = new THREE.Color();
  instances.forEach((instance, i) => {
    mesh.setMatrixAt(i, matrix.compose(position.fromArray(instance.position),
      rotation.setFromAxisAngle(up, instance.yaw), scale.fromArray(instance.size)));
    if (instance.color !== undefined) mesh.setColorAt(i, color.set(instance.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = castShadow;
  mesh.userData.cullDistance = distance;
  group.add(mesh);
}

export function buildEdeBusShelters(parent, sites, blocked, groundAt, surveyed) {
  const group = new THREE.Group();
  group.name = 'EdeBusShelters';
  const solids = [], glass = [], posters = [], colliders = [], covers = [], placed = [], skipped = [];
  for (const site of sites) {
    const { x, z } = site;
    // The surveyed Kievitsmeent shelter is twelve metres behind its CHB boarding point.
    if (surveyed.some(row => Math.hypot(row.position[0] - (site.surveyX ?? x),
        row.position[1] - (site.surveyZ ?? z)) < 14)) {
      skipped.push({ id: site.id, name: site.name, reason: 'surveyed shelter' });
      continue;
    }
    const pose = fitShelter(site, blocked, groundAt);
    if (!pose || placed.some(row => Math.hypot(row.x - pose.x, row.z - pose.z) < 3)) {
      skipped.push({ id: site.id, name: site.name, reason: 'no clear shelter footprint' });
      continue;
    }
    shelterParts(site, pose, solids, glass, posters, colliders);
    placed.push({ id: site.id, name: site.name, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
    const xs = pose.corners.map(p => p.x), zs = pose.corners.map(p => p.z);
    covers.push({ outer: pose.corners, holes: [], minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs), height: () => pose.y + ROOF });
  }
  const box = new THREE.BoxGeometry();
  batchBusStopParts(group, 'Shelter frames and roofs', solids, box, new THREE.MeshStandardNodeMaterial({ roughness: 0.68 }), 500, true);
  batchBusStopParts(group, 'Shelter glazing', glass, box, new THREE.MeshStandardNodeMaterial({ color: 0x9db5b6,
    roughness: 0.31, transparent: true, opacity: 0.29, depthWrite: false }), 350);
  if (posters.length) batchBusStopParts(group, 'Shelter poster faces', posters, new THREE.PlaneGeometry(), edeAdMaterial('portrait'), 420);
  group.userData = { placed, skipped };
  parent.add(group);
  return { colliders, covers };
}
