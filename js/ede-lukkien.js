import * as THREE from 'three/webgpu';
import { sampleRoofColor } from './aerial-colors.js';
import { terrainHeightAt } from './terrain.js';
import {
  CivicBatch, along, facePanel, makeGroup, offsetEdge, polygonNormal, wallColliders, wallExtent,
} from './ede-civic-landmarks.js';
import { LUKKIEN_HELIPAD, LUKKIEN_SURVEY } from './ede-lukkien-survey.js';

const slate = 0x363d43, concrete = 0xa5a7a1, brick = 0xa35744;
const glass = [0x252e3a, 0x354657, 0x2d3c47, 0x374450];

function planPoint(p, y) {
  return [p.x, y, p.z];
}

function facadeWindows(batch, a, b, normal, width, start, end, low, high, gap, border = slate) {
  if (high - low < 0.2 || width * (end - start) < 0.5) return;
  const panes = Math.max(1, Math.round(width * (end - start) / gap));
  facePanel(batch, a, b, normal, start, end, low, high, border, 0.025);
  for (let i = 0; i < panes; i++) {
    const left = start + (end - start) * i / panes + 0.065 / width;
    const right = start + (end - start) * (i + 1) / panes - 0.065 / width;
    facePanel(batch, a, b, normal, left, right, low + 0.055, high - 0.055, glass[i % glass.length], 0.045, 1);
  }
}

function shell(batch, colliders) {
  const roofRgb = [];
  for (const [index, faces] of LUKKIEN_SURVEY.entries()) {
    const roofId = index === 0 ? 'w271178639' : 'w271178396';
    const roofTint = sampleRoofColor(roofId, roofRgb) ? new THREE.Color().setRGB(...roofRgb) : 0x555856;
    for (const [roof, ...rings] of faces) {
      if (roof) {
        batch.polygon(rings, roofTint);
        continue;
      }
      const outer = rings[0], n = polygonNormal(outer);
      if (n.lengthSq() === 0) continue;
      const { a, b, width } = wallExtent(outer, n);
      const low = Math.min(...outer.map(p => p[1])), top = Math.max(...outer.map(p => p[1]));
      const { z } = along(a, b, 0.5);
      const office = z > 2607 && top > 0.8;
      const frontage = n.z > 0.65 && width > 3;
      batch.polygon(rings, office ? 0x454549 : 0x414b54);
      if (width > 0.24) colliders.push(...wallColliders(a, b, Math.max(-15.5, low), top, 0.26));
      if (Math.abs(n.y) > 0.08 || width < 1 || top - low < 1) continue;
      const bottom = Math.max(low, -13.89);
      if (office) {
        const cap = Math.min(top, 1.76);
        const brickBase = Math.max(bottom, -2.7);
        facePanel(batch, a, b, n, 0, 1, brickBase, cap, brick);
        if (cap - brickBase > 1.5) {
          facadeWindows(batch, a, b, n, width, 0.04, 0.96, brickBase + 0.85, Math.min(cap - 0.25, brickBase + 2.05),
            4.1, 0x87695c);
        }
        if (low < -3.0 && top > -3.1) {
          const lo = Math.max(bottom + 0.25, -7.22), hi = Math.min(top - 0.04, -2.7);
          facadeWindows(batch, a, b, n, width, 0.006, 0.994, lo, hi, 1.26, 0xd8d9d1);
        }
        if (frontage && bottom < -9.75) {
          for (const y of [-12.75, -9.55]) {
            facadeWindows(batch, a, b, n, width, 0.10, 0.93, y, Math.min(y + 0.86, top - 0.3), 3.5, 0x584b45);
          }
        }
      } else if (width > 8 && top < -2.5) {
        const stripe = Math.max(bottom + 0.1, top - (top - bottom) * 0.47);
        facePanel(batch, a, b, n, 0, 1, stripe - 0.58, stripe + 0.55, 0xa1acaf);
      }
    }
  }
}

function surfaceRing(batch, center, outerRadius, innerRadius, color) {
  const point = (angle, radius) => [
    center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius,
  ];
  for (let i = 0; i < 64; i++) {
    const angle = i * Math.PI * 2 / 64, next = (i + 1) * Math.PI * 2 / 64;
    batch.quad(point(angle, outerRadius), point(angle, innerRadius), point(next, innerRadius), point(next, outerRadius), color);
  }
}

function markedBox(batch, x, y, z, w, d, color) {
  batch.solid(new THREE.BoxGeometry(w, 0.014, d).translate(x, y + 0.009, z), color);
}

function deck(batch, colliders) {
  const { x, y, z, outer } = LUKKIEN_HELIPAD;
  const bottom = y - 0.58, color = 0x3c4245;
  batch.polygon([[...outer].reverse().map(p => planPoint(p, y))], color);
  batch.polygon([outer.map(p => planPoint(p, bottom))], 0x263335);
  outer.forEach((a, i) => {
    const b = outer[(i + 1) % outer.length];
    batch.quad(planPoint(a, bottom), planPoint(b, bottom), planPoint(b, y), planPoint(a, y), 0x515c5d);
    batch.quad(planPoint(a, y - 0.15), planPoint(b, y - 0.15), [b.x, y, b.z], [a.x, y, a.z], 0x9ca3a0);
  });
  colliders.push({
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: bottom, maxY: y, polygon: { outer, holes: [] },
  });

  for (const [dx, dz] of [[-7, -6], [7, -6], [-7, 6], [7, 6]]) {
    batch.solid(new THREE.BoxGeometry(0.36, bottom - 1.76, 0.36)
      .translate(x + dx, (1.76 + bottom) / 2, z + dz), 0x4a5253);
  }

  const center = { x, y: y + 0.012, z };
  surfaceRing(batch, center, 10.05, 9.85, 0xe5e5dc);
  surfaceRing(batch, center, 6.05, 5.76, 0xd1b854);
  for (const dx of [-0.79, 0.79]) markedBox(batch, x + dx, y, z, 0.33, 2.65, 0xf2f0e8);
  markedBox(batch, x, y, z, 1.65, 0.31, 0xf2f0e8);
  for (let i = 0; i < 6; i++) markedBox(batch, x + 8.5, y, z - 2.9 + i * 0.76, 1.55, 0.25, 0xdfded2);

  // Access pod and stairs sit outside the marked ring.
  const pod = { x: -3243.99, z: 2622.36 };
  batch.solid(new THREE.CylinderGeometry(3.80, 3.80, 2.61, 24).translate(pod.x, 3.02, pod.z), 0x40484a);
  for (let step = 0; step < 8; step++) {
    const rise = 0.27 * (step + 1);
    batch.solid(new THREE.BoxGeometry(0.44, rise, 1.85)
      .translate(-3244.4 - step * 0.43, 1.77 + rise / 2, 2629.1), concrete);
  }
  const pole = { x: -3242.73, z: 2618.86 }, mastBase = 4.22, mastHeight = 2.54;
  batch.solid(new THREE.CylinderGeometry(0.035, 0.051, mastHeight, 8)
    .translate(pole.x, mastBase + mastHeight / 2, pole.z), 0x7b8584);
  const rim = (i, j) => {
    const t = i / 5, angle = j * Math.PI * 2 / 10, radius = 0.28 - 0.20 * t;
    return [pole.x + 0.12 + 1.75 * t, mastBase + mastHeight - 0.13 - 0.39 * t * t + Math.cos(angle) * radius,
      pole.z + 0.11 * t + Math.sin(angle) * radius];
  };
  for (let i = 0; i < 5; i++) for (let j = 0; j < 10; j++) {
    batch.quad(rim(i, j), rim(i, j + 1), rim(i + 1, j + 1), rim(i + 1, j), i % 2 ? 0xf1eee3 : 0xc54a33);
  }
}

function lukkienSign(a, b, y, height = 1.62, badge = false) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!badge) {
    ctx.fillStyle = '#30383d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#f2f1e8';
    ctx.fillRect(10, 5, 80, 85);
    ctx.fillStyle = '#262c32';
    ctx.fillRect(17, 47, 65, 31);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i === 2 ? '#bb433d' : '#f2f1e8';
      ctx.fillRect(21 + i * 12, 53, 7, 18);
    }
  }
  ctx.fillStyle = '#f2f1e8';
  ctx.font = badge ? '800 76px system-ui' : '800 64px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LUKKIEN', badge ? 303 : 256, 49);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const width = Math.hypot(a.x - b.x, a.z - b.z);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map, alphaTest: badge ? 0.4 : 0, roughness: 0.85 }));
  mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
  mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  return mesh;
}

export function createLukkien() {
  const batch = new CivicBatch(), colliders = [];
  shell(batch, colliders);
  deck(batch, colliders);

  const a = { x: -3226.05, z: 2636.01 }, b = { x: -3210.54, z: 2637.41 };
  const front = { x: -0.09, z: 0.996 };
  const threshold = terrainHeightAt(-3217.3, 2638.5);
  const entryA = { x: -3221.08, z: 2627.49 }, entryB = { x: -3213.01, z: 2628.39 };
  facadeWindows(batch, entryA, entryB, front, 8.12, 0, 1, threshold + 0.08, threshold + 3.25, 1.16, concrete);
  const [p, q] = offsetEdge(a, b, front, 1.22);
  const roofY = -8.08;
  const roofCorners = [a, b, q, p];
  batch.polygon([[...roofCorners].reverse().map(pt => planPoint(pt, roofY))], slate);
  batch.polygon([roofCorners.map(pt => planPoint(pt, roofY - 0.28))], slate);
  facePanel(batch, p, q, front, 0, 1, roofY - 0.65, roofY + 1.27, 0x30383d);
  const group = makeGroup('Lukkien', batch, colliders);
  const [s0, s1] = offsetEdge(along(p, q, 0.13), along(p, q, 0.87), front, 0.08);
  for (const sign of [
    lukkienSign(s0, s1, roofY + 0.35),
    // The studio wordmark wraps the south-east corner above the silver belt.
    lukkienSign({ x: -3140.61, z: 2614.29 }, { x: -3129.80, z: 2615.30 }, -5.61, 1.72, true),
    lukkienSign({ x: -3126.07, z: 2612.11 }, { x: -3125.03, z: 2601.22 }, -5.98, 1.72, true),
  ]) if (sign) group.add(sign);
  group.userData.helipads = [LUKKIEN_HELIPAD];
  return group;
}
