import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { CivicBatch, makeGroup } from './ede-civic-landmarks.js';
import { EDE_MAST_SITES } from './ede-mast-sites.js';
import { mastStrokeMesh } from './ede-mast-strokes.js';
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
  const detail = new CivicBatch();
  const segments = [];
  const segment = (a, b, lowerRadius, upperRadius = lowerRadius) => {
    segments.push([a.add(new THREE.Vector3(x, base, z)), b.add(new THREE.Vector3(x, base, z)), lowerRadius, upperRadius]);
  };
  const shaftHeight = height - 1.2;
  const crownRadius = lattice ? 0.38 : 0.24;
  detail.solid(new THREE.BoxGeometry(foundation * 2, 0.64, foundation * 2).translate(0, 0.07, 0), 0x92938b);
  detail.solid(new THREE.CylinderGeometry(lattice ? 0.8 : 0.51, lattice ? 0.8 : 0.51, 0.18, 8)
    .translate(0, shaftHeight - 1.24, 0), steel);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    const r = lattice ? 0.82 : 0.56;
    detail.solid(new THREE.BoxGeometry(0.26, 2.3, 0.15).translate(0, shaftHeight - 0.88, r).rotateY(a), panels);
    segment(new THREE.Vector3(Math.sin(a) * r, shaftHeight - 2.03, Math.cos(a) * r),
      new THREE.Vector3(Math.sin(a) * r, shaftHeight + 0.27, Math.cos(a) * r), 0.105);
  }
  detail.solid(new THREE.CylinderGeometry(0.079, 0.105, 1.2, 6).translate(0, height - 0.6, 0), galvanised);
  segment(new THREE.Vector3(0, shaftHeight, 0), new THREE.Vector3(0, height, 0), 0.105, 0.079);
  if (lattice) {
    const member = (a, b, radius) => {
      beam(detail, a, b, radius);
      segment(a.clone(), b.clone(), radius);
    };
    const corners = (y) => Array.from({ length: 3 }, (_, i) => {
      const a = i * Math.PI * 2 / 3;
      const r = THREE.MathUtils.lerp(radius, crownRadius, y / shaftHeight);
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    });
    const foot = corners(0.22), top = corners(shaftHeight);
    for (let i = 0; i < 3; i++) member(foot[i], top[i], 0.077);
    for (let level = 0; level < 7; level++) {
      const lower = corners(0.22 + level * (shaftHeight - 0.22) / 7);
      const upper = corners(0.22 + (level + 1) * (shaftHeight - 0.22) / 7);
      for (let i = 0; i < 3; i++) {
        const next = (i + 1) % 3;
        member(lower[i], upper[next], 0.043);
        member(upper[i], upper[next], 0.058);
      }
    }
  } else {
    detail.solid(new THREE.CylinderGeometry(crownRadius, radius, shaftHeight, 8).translate(0, shaftHeight / 2, 0), steel);
    segment(new THREE.Vector3(), new THREE.Vector3(0, shaftHeight, 0), radius, crownRadius);
  }
  const collision = {
    minX: x - foundation, maxX: x + foundation, minZ: z - foundation, maxZ: z + foundation,
    minY: base - 0.25, maxY: base + height,
  };
  const model = makeGroup(site.name, detail, [collision]);
  const [mesh] = model.children;
  mesh.userData.shadowStandIn = new THREE.CylinderGeometry(crownRadius, lattice ? 0.75 : radius, shaftHeight, 6)
    .translate(0, shaftHeight / 2, 0);
  model.userData.treeClearance = [collision];
  model.userData.mast = { mesh, centre: new THREE.Vector3(x, base + height / 2, z), segments };
  return model;
}

export const EDE_MAST_FACTORIES = Object.fromEntries(EDE_MAST_SITES.map(({ id }) => [id, createMast]));

export function createZendmastLod(masts) {
  const strokes = { start: [], end: [], centre: [], bounds: new THREE.Box3() };
  for (const { centre, segments } of masts) {
    for (const [a, b, lowerRadius, upperRadius] of segments) {
      strokes.start.push(...a, lowerRadius);
      strokes.end.push(...b, upperRadius);
      strokes.centre.push(...centre);
      strokes.bounds.expandByPoint(a).expandByPoint(b);
    }
  }
  const cutoff = uniform(60), night = uniform(0);
  const mesh = mastStrokeMesh(strokes, cutoff, night);
  mesh.name = 'Ede filtered zendmasten';
  return {
    mesh,
    update(camera, pixelHeight, nightFactor) {
      // Switch once the thinnest cross-braces project to roughly one pixel.
      const focal = camera.projectionMatrix.elements[5] * pixelHeight * 0.5;
      cutoff.value = THREE.MathUtils.clamp(0.086 * focal, 24, 250);
      night.value = nightFactor;
      const limit = cutoff.value ** 2;
      for (const { mesh, centre } of masts) mesh.visible = camera.position.distanceToSquared(centre) < limit;
    },
  };
}
