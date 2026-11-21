import * as THREE from 'three/webgpu';
import { addLandmarkLod, CivicBatch, polygonNormal } from './ede-civic-landmarks.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { P_BOS_EQUIPMENT, P_BOS_SHELL } from './ede-p-bos-survey.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const cream = 0xe4e1d5, lower = 0xb0ae9f, blue = 0x266273, grey = 0x74838b;
const point = ([x, z], y) => [x, y, z];
const underside = P_BOS_SHELL.ground;

function clipHeight(ring, height, above) {
  const output = [];
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length];
    const aInside = above ? a[1] >= height : a[1] <= height;
    const bInside = above ? b[1] >= height : b[1] <= height;
    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const t = (height - a[1]) / (b[1] - a[1]);
      output.push([a[0] + (b[0] - a[0]) * t, height, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return output;
}

// Wrap the surveyed volumes with the continuous teal and pale metal cladding seen from Nieuweweg.
function facadeBands(batch, rings, normal) {
  if (Math.abs(normal.y) > 0.15) return;
  const ring = rings[0];
  const west = Math.max(...ring.map(p => p[0])) < -6430.1;
  const street = normal.z > 0.85;
  const roof = Math.max(...ring.map(p => p[1]));
  const paintCeiling = underside + (street && roof > 2 ? 13.9 : 5.8);
  const paintStart = underside + (west ? 3.6 : 3.2);
  for (const [lo, hi, color] of [[underside + 0.03, paintStart, lower], [paintStart, paintCeiling, west ? 0x828987 : blue]]) {
    const clipped = clipHeight(clipHeight(ring, lo, true), hi, false);
    if (clipped.length < 3) continue;
    batch.polygon([clipped.map(([x, y, z]) => [x + normal.x * 0.018, y, z + normal.z * 0.018])], color);
  }
}

function dressMillWall(wall) {
  const { base, low, high, width, normal, a, b } = wall;
  facadeBands(wall.shell, wall.rings, normal);
  const x = (a.x + b.x) / 2;
  if (normal.z > 0.75 && low <= base + 0.06 && width > 3.1) {
    const isLoading = x > -6405;
    const deliveries = isLoading ? Math.max(1, Math.round(width / 5.5)) : 1;
    const bay = width / deliveries;
    for (let i = 0; i < deliveries; i++) {
      const center = bay * (i + 0.50);
      const half = Math.min(isLoading ? 1.69 : 0.66, bay * 0.36);
      const bottom = base + 0.10, top = Math.min(high - 0.16, base + (isLoading ? 3.85 : 2.39));
      if (!surveyWindow(wall, center - half, center + half, bottom, top, {
        frame: 0x818782, color: isLoading ? 0x555b59 : 0x38464c, columns: isLoading ? 1 : 2,
      })) continue;
      if (isLoading) {
        for (let y = bottom + 0.20; y < top - 0.10; y += 0.21) {
          surveyPanel(wall, center - half + 0.08, center + half - 0.08, y, y + 0.023, 0x747975, 0.062);
        }
      }
    }
  }
  if (normal.x < -0.80 && width > 4.8 && high > base + 18) {
    for (const ht of [10.7, 15.4, 20.3]) {
      surveyWindow(wall, 0.36, Math.min(1.99, width - 0.24), base + ht, base + ht + 0.40,
        { frame: 0x6f8186, color: 0x3c535b, columns: 3 });
    }
  }
  if (x > -6431 && width > 1.4 && high > base + 12) {
    const bottom = Math.max(low + 0.17, base + 4.70);
    if (high - bottom > 0.9) {
      for (let u = 0.16; u < width - 0.10; u += 0.61) {
        surveyPanel(wall, u, u + 0.041, bottom, high - 0.12, 0x929e98, 0.027);
      }
    }
  }
  return cream;
}

function beam(batch, start, end, size, color) {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const axis = b.clone().sub(a), length = axis.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.divideScalar(length));
  const center = a.lerp(b, 0.5);
  batch.solid(new THREE.BoxGeometry(size, length, size).applyQuaternion(rotation)
    .translate(center.x, center.y, center.z), color);
}

function addEquipment(batch, detail, colliders) {
  // BGT supplies all four footprints; the roof and ground levels are sampled from AHN.
  for (const [i, [x, z, r, floor, top]] of P_BOS_EQUIPMENT.tanks.entries()) {
    const grade = getTerrain() ? Math.min(floor, terrainHeightAt(x, z) - 0.12) : floor;
    const bodyTop = top - Math.min(0.55, (top - grade) * 0.14);
    const colour = [0xa3aeb0, 0xd4d5cd, 0xc1c3b9, 0xb6bdba][i];
    const sides = detail ? 20 : 8;
    batch.solid(new THREE.CylinderGeometry(r, r, bodyTop - grade, sides)
      .translate(x, (bodyTop + grade) / 2, z), colour);
    batch.solid(new THREE.CylinderGeometry(r * 0.65, r, top - bodyTop, sides)
      .translate(x, (top + bodyTop) / 2, z), 0xbcc3c0);
    if (detail && top - grade > 3) {
      for (const y of [grade + 0.62, bodyTop - 0.15]) {
        detail.solid(new THREE.CylinderGeometry(r + 0.033, r + 0.033, 0.074, sides, 1, true)
          .translate(x, y, z), grey);
      }
    }
    if (colliders) {
      const outer = Array.from({ length: sides }, (_, j) => {
        const angle = 2 * Math.PI * j / sides;
        return { x: x + r * Math.cos(angle), z: z + r * Math.sin(angle) };
      });
      colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r,
        minY: grade, maxY: top, polygon: { outer, holes: [] } });
    }
  }
  for (const [x, z, r, bottom, top] of P_BOS_EQUIPMENT.stacks) {
    batch.solid(new THREE.CylinderGeometry(r * 0.85, r, top - bottom, 8)
      .translate(x, (top + bottom) / 2, z), 0xb4bfbe);
    if (detail) {
      detail.solid(new THREE.CylinderGeometry(r + 0.06, r + 0.04, 0.18, 12)
        .translate(x, top - 0.09, z), 0x8c9798);
    }
  }

  // The 2026 extension is a row of cream rectangular bins above an open steel rack.
  const [[ax, az], [bx, bz]] = P_BOS_EQUIPMENT.bank;
  const length = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / length, dz = (bz - az) / length;
  const at = (u, w, y) => [ax + dx * u + dz * w, y, az + dz * u - dx * w];
  const angle = -Math.atan2(dz, dx);
  const top = 10.29, bottom = -7.19, pitch = length / 5;
  function box(u, depth, height, width, tall, thickness, color) {
    const [x, y, z] = at(u, depth, height);
    batch.solid(new THREE.BoxGeometry(width, tall, thickness).rotateY(angle).translate(x, y, z), color);
  }
  if (detail) {
    for (let i = 0; i < 5; i++) {
      const center = pitch * (i + 0.5);
      const tint = i % 2 ? 0xdfdfd4 : 0xe9e5d9;
      box(center, 2.30, (top + bottom) / 2, pitch - 0.10, top - bottom, 4.60, tint);
      box(center, 3.46, top + 0.21, 1.24, 0.42, 1.50, 0xcbd0c9);
      box(center, 2.30, bottom - 0.22, pitch - 0.30, 0.44, 3.40, 0xa6aa9e);
    }
    for (const w of [0.06, 4.55]) {
      for (const y of [bottom - 0.09, bottom - 3.4]) {
        beam(detail, at(0, w, y), at(length, w, y), 0.18, grey);
      }
      for (let i = 0; i <= 5; i++) {
        const u = i * pitch;
        beam(detail, at(u, w, bottom - 3.4), at(u, w, bottom + 0.10), 0.18, grey);
      }
    }
    for (let i = 0; i < 5; i++) {
      const u = i * pitch;
      beam(detail, at(u, 0.06, bottom - 3.4), at(u + pitch, 0.06, bottom - 0.09), 0.085, grey);
      beam(detail, at(u, 0.06, bottom - 1.52), at(u + pitch, 0.06, bottom - 1.52), 0.045, 0xb7a143);
    }
  } else {
    box(length / 2, 2.30, (top + bottom) / 2, length, top - bottom, 4.60, cream);
  }
}

export function buildEdePBosLandmark(site) {
  const model = createSurveyLandmark(site, [P_BOS_SHELL], dressMillWall, ({ group, trim, labels, colliders }) => {
    const equipment = new CivicBatch();
    addEquipment(equipment, trim, colliders);
    group.add(equipment.mesh());
    const [[ax, az], [bx, bz]] = P_BOS_EQUIPMENT.sign;
    labels.push({ a: { x: bx, z: bz + 0.06 }, b: { x: ax, z: az + 0.06 }, lo: 12.60, hi: 14.56,
      text: 'P. BOS', color: '#e4e1d5', textColor: '#aa791a' });
  });

  const silhouette = new CivicBatch();
  for (const [isRoof, ...indices] of P_BOS_SHELL.faces) {
    const rings = indices.map(ring => ring.map(i => {
      const [x, y, z] = P_BOS_SHELL.points[i];
      return point([x, z], !isRoof && y <= underside + 0.03 && getTerrain()
        ? Math.min(y, terrainHeightAt(x, z) - 0.14) : y);
    }));
    silhouette.polygon(rings, isRoof ? P_BOS_SHELL.roofColor : cream);
    if (!isRoof) facadeBands(silhouette, rings, polygonNormal(rings[0]));
  }
  addEquipment(silhouette);
  return addLandmarkLod(model, silhouette, 185);
}
