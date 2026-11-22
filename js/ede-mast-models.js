import * as THREE from 'three/webgpu';
import { addLandmarkLod, CivicBatch, makeGroup } from './ede-civic-landmarks.js';
import { EDE_MAST_SITES } from './ede-mast-sites.js';
import { terrainHeightAt } from './terrain.js';

const steel = 0x959e9f, galvanised = 0xb9bfbd, panels = 0xc6c9c5;

function beam(batch, a, b, radius) {
  const delta = b.clone().sub(a);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  const middle = a.clone().lerp(b, 0.5);
  batch.solid(new THREE.CylinderGeometry(radius, radius, delta.length(), 4)
    .applyQuaternion(rotation).translate(middle.x, middle.y, middle.z), steel);
}

function createMast(_footprints, site) {
  const { x, z, height, radius, lattice } = site;
  const base = terrainHeightAt(x, z), foundation = radius + 0.45;
  const detail = new CivicBatch(), distant = new CivicBatch();
  const shaftHeight = height - 1.2;
  const crownRadius = lattice ? 0.38 : 0.24;
  for (const batch of [detail, distant]) {
    batch.solid(new THREE.BoxGeometry(foundation * 2, 0.64, foundation * 2).translate(0, 0.07, 0), 0x92938b);
    batch.solid(new THREE.CylinderGeometry(lattice ? 0.8 : 0.51, lattice ? 0.8 : 0.51, 0.18, 8)
      .translate(0, shaftHeight - 1.24, 0), steel);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      batch.solid(new THREE.BoxGeometry(0.26, 2.3, 0.15).translate(0, shaftHeight - 0.88, lattice ? 0.82 : 0.56)
        .rotateY(a), panels);
    }
    batch.solid(new THREE.CylinderGeometry(0.079, 0.105, 1.2, 6).translate(0, height - 0.6, 0), galvanised);
  }
  distant.solid(new THREE.CylinderGeometry(crownRadius, lattice ? 0.75 : radius, shaftHeight, 6)
    .translate(0, shaftHeight / 2, 0), steel);
  if (lattice) {
    const corners = (y) => Array.from({ length: 3 }, (_, i) => {
      const a = i * Math.PI * 2 / 3;
      const r = THREE.MathUtils.lerp(radius, crownRadius, y / shaftHeight);
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    });
    const foot = corners(0.22), top = corners(shaftHeight);
    for (let i = 0; i < 3; i++) beam(detail, foot[i], top[i], 0.077);
    for (let level = 0; level < 7; level++) {
      const lower = corners(0.22 + level * (shaftHeight - 0.22) / 7);
      const upper = corners(0.22 + (level + 1) * (shaftHeight - 0.22) / 7);
      for (let i = 0; i < 3; i++) {
        const next = (i + 1) % 3;
        beam(detail, lower[i], upper[next], 0.043);
        beam(detail, upper[i], upper[next], 0.058);
      }
    }
  } else {
    detail.solid(new THREE.CylinderGeometry(crownRadius, radius, shaftHeight, 8).translate(0, shaftHeight / 2, 0), steel);
  }
  const collision = {
    minX: x - foundation, maxX: x + foundation, minZ: z - foundation, maxZ: z + foundation,
    minY: base - 0.25, maxY: base + height,
  };
  const model = makeGroup(site.name, detail, [collision]);
  model.userData.treeClearance = [collision];
  return addLandmarkLod(model, distant, 340);
}

export const EDE_MAST_FACTORIES = Object.fromEntries(EDE_MAST_SITES.map(({ id }) => [id, createMast]));
