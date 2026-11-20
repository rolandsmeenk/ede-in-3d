import * as THREE from 'three/webgpu';
import { CivicBatch, facePanel, wallExtent, wallColliders, polygonNormal, civicSigns } from './ede-civic-landmarks.js';
import { edePolygonGeometry, edeStrip, drapeEdeSurface } from './ede-geometry.js';
import { terrainHeightAt } from './terrain.js';
import { KUIL_SHELLS, TECHNOVA_SHELLS, TESQUA_SHELLS, TESQUA_COURTS } from './ede-next-survey.js';

const steel = 0x515c60, blueGlass = 0x536e72, pale = 0xd0d0bf;
const up = new THREE.Vector3(0, 1, 0);

function beam(batch, a, b, radius, color) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(up, direction.divideScalar(length));
  batch.solid(new THREE.CylinderGeometry(radius, radius, length, 6)
    .applyQuaternion(rotation).translate(...start.lerp(end, 0.5).toArray()), color);
}

function groundPatch(batch, shape, tint, lift = 0.055) {
  const ring = shape.map(([x, z]) => ({ x, z }));
  batch.solid(drapeEdeSurface(edePolygonGeometry(ring, [], lift)), tint);
}

function top(batch, a, b, c, d, color) {
  if ((b[0] - a[0]) * (c[2] - a[2]) > (b[2] - a[2]) * (c[0] - a[0])) {
    batch.quad(d, c, b, a, color);
  } else {
    batch.quad(a, b, c, d, color);
  }
}

function finish(batch, details, colliders, signs = []) {
  const group = new THREE.Group();
  group.add(batch.mesh());
  if (details.vertices.length) {
    const mesh = details.mesh();
    mesh.userData.nearDetail = true;
    group.add(mesh);
  }
  if (signs.length) {
    const labels = civicSigns(signs, { wide: true });
    if (labels) {
      labels.userData.nearDetail = true;
      group.add(labels);
    }
  }
  group.userData.colliders = colliders;
  return group;
}

function placeShell(batch, colliders, parts, surface) {
  for (const { id, points, faces } of parts) for (const [roof, ...rings] of faces) {
    const polygon = rings.map(ring => ring.map(i => points[i]));
    if (roof) {
      batch.polygon(polygon, surface.roof(id, polygon[0]));
      continue;
    }
    const ring = polygon[0], normal = polygonNormal(ring);
    if (!normal.lengthSq()) continue;
    const edge = wallExtent(ring, normal);
    edge.low = Math.min(...ring.map(p => p[1]));
    edge.high = Math.max(...ring.map(p => p[1]));
    batch.polygon(polygon, surface.wall(id, edge));
    if (Math.abs(normal.y) < 0.16 && edge.width > 0.4 && edge.high - edge.low > 0.75) {
      colliders.push(...wallColliders(edge.a, edge.b, edge.low, edge.high));
      surface.detail?.(edge, normal);
    }
  }
}

function panes(batch, { a, b, width }, normal, low, high, step, fill = 0.91, frame = steel) {
  if (high - low < 0.4) return;
  const count = Math.max(1, Math.round(width / step));
  for (let i = 0; i < count; i++) {
    const start = (i + (1 - fill) / 2) / count, end = (i + (1 + fill) / 2) / count;
    facePanel(batch, a, b, normal, start, end, low, high, frame, 0.12);
    facePanel(batch, a, b, normal, start + 0.055 / width, end - 0.055 / width, low + 0.065,
      high - 0.065, i % 4 === 0 ? 0x719399 : blueGlass, 0.14, 1);
    facePanel(batch, a, b, normal, start, end, low + (high - low) * 0.46, low + (high - low) * 0.46 + 0.055, frame, 0.17);
  }
}

export function createTechnova() {
  const batch = new CivicBatch(), details = new CivicBatch(), colliders = [];
  placeShell(batch, colliders, TECHNOVA_SHELLS, {
    roof: (_, polygon) => {
      const y = Math.max(...polygon.map(p => p[1]));
      const n = polygonNormal(polygon);
      return y > 0 && y < 6.5 && Math.abs(n.y) < 0.75 ? 0x73898c : 0xb9bab3;
    },
    wall: () => pale,
    detail(edge, normal) {
      if (edge.width < 5.2) return;
      if (edge.low < -6) {
        const topY = Math.min(edge.high - 0.14, -2.64);
        facePanel(batch, edge.a, edge.b, normal, 0.013, 0.987, edge.low + 0.16, topY, 0x3e575c);
        panes(details, edge, normal, edge.low + 0.16, topY, 2.01);
      }
      for (let floor = -2.14; floor < edge.high - 1.13; floor += 3.62) {
        if (floor < edge.low + 0.08) continue;
        panes(details, edge, normal, floor + 0.05, Math.min(floor + 2.95, edge.high - 0.16), 1.67, 0.44);
      }
    },
  });
  const sign = { a: { x: -649.5, z: 2721.88 }, b: { x: -660.7, z: 2723.84 }, lo: -2.42, hi: -1.16,
    color: '#dedfd6', textColor: '#293f41', text: 'TECHNOVA COLLEGE' };
  return finish(batch, details, colliders, [sign]);
}

function courtPoint(ring, u, v) {
  return [0, 1].map(k => (1 - v) * ((1 - u) * ring[0][k] + u * ring[1][k]) +
    v * ((1 - u) * ring[3][k] + u * ring[2][k]));
}

function courts(batch, details) {
  for (const [kind, ring, count] of TESQUA_COURTS) {
    const tennis = kind.startsWith('clay'), longX = kind === 'clay-cross';
    groundPatch(batch, ring, tennis ? 0xac704f : 0x477c9d);
    for (let i = 0; i < count; i++) {
      const m = (s, t) => longX ? courtPoint(ring, (i + t) / count, s) : courtPoint(ring, (i + s) / count, t);
      const lines = [
        [[0.14,0.14],[0.86,0.14]], [[0.14,0.86],[0.86,0.86]],
        [[0.14,0.14],[0.14,0.86]], [[0.86,0.14],[0.86,0.86]],
        [[0.14,0.29],[0.86,0.29]], [[0.14,0.71],[0.86,0.71]], [[0.5,0.29],[0.5,0.71]],
      ];
      if (tennis) lines.push([[0.23,0.14],[0.23,0.86]], [[0.77,0.14],[0.77,0.86]]);
      for (const [a, b] of lines) {
        const [ax, az] = m(...a), [bx, bz] = m(...b);
        details.solid(drapeEdeSurface(edeStrip({ x: ax, z: az }, { x: bx, z: bz }, 0.045, 0.073)), 0xf3eddc);
      }
      const net = [m(0.13, 0.5), m(0.87, 0.5)].map(([x, z]) => [x, terrainHeightAt(x, z) + 0.97, z]);
      beam(details, ...net, 0.025, 0xf1eee2);
      for (const p of net) beam(details, [p[0], p[1] - 0.9, p[2]], p, 0.037, steel);
    }
    if (kind !== 'padel') continue;
    for (let i = 0; i < 4; i++) {
      const [x, z] = ring[i], [bx, bz] = ring[(i + 1) % 4];
      const y = terrainHeightAt(x, z), by = terrainHeightAt(bx, bz);
      beam(details, [x, y, z], [x, y + 2.8, z], 0.043, steel);
      beam(details, [x, y + 2.8, z], [bx, by + 2.8, bz], 0.035, steel);
    }
  }
}

export function createTesqua() {
  const batch = new CivicBatch(), details = new CivicBatch(), colliders = [];
  placeShell(batch, colliders, TESQUA_SHELLS, {
    roof: (_, ring) => {
      const x = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      return x < -1903 ? 0x4c626b : 0x535d65;
    },
    wall: (_, edge) => edge.high > -1 ? 0x92928b : 0xa18a77,
    detail(edge, normal) {
      if (edge.width > 5 && edge.high < -2.1 && edge.a.z < 1375) {
        panes(details, edge, normal, edge.low + 0.45, Math.min(edge.high - 0.45, edge.low + 3), 2.7, 0.75);
      }
    },
  });
  courts(batch, details);
  const a = { x: -1864.8, z: 1298.25 }, b = { x: -1852.2, z: 1295.91 };
  const normal = { x: -0.183, z: -0.983 };
  const lift = terrainHeightAt(-1858.5, 1292);
  facadeEntry(batch, details, a, b, normal, lift);
  const signEdge = p => ({ x: p.x + normal.x * 0.052, z: p.z + normal.z * 0.052 });
  return finish(batch, details, colliders, [{ a: signEdge(a), b: signEdge(b), lo: lift + 3.24, hi: lift + 4.48,
    text: 'TESQUA', color: '#555c62', textColor: '#e5c674' }]);
}

function facadeEntry(batch, details, a, b, normal, lift) {
  const width = Math.hypot(a.x - b.x, a.z - b.z);
  facePanel(batch, a, b, normal, 0, 1, lift + 0.09, lift + 4.5, 0x555c62);
  panes(details, { a, b, width }, normal, lift + 0.13, lift + 3.14, 2.3, 0.93);
  const c = [a.x + normal.x * 1.55, lift + 3.16, a.z + normal.z * 1.55];
  const d = [b.x + normal.x * 1.55, lift + 3.16, b.z + normal.z * 1.55];
  top(details, [a.x, c[1], a.z], [b.x, c[1], b.z], d, c, steel);
  beam(details, [c[0], lift, c[2]], c, 0.075, steel);
  beam(details, [d[0], lift, d[2]], d, 0.075, steel);
}

export function createEderKuil() {
  const batch = new CivicBatch(), details = new CivicBatch(), colliders = [];
  placeShell(batch, colliders, KUIL_SHELLS, {
    roof: () => 0x585951,
    wall: () => 0xaaa99a,
    detail(edge, normal) {
      if (edge.width > 2.7) panes(details, edge, normal, edge.low + 0.71,
        Math.min(edge.high - 0.48, edge.low + 2.16), 1.46, 0.69);
    },
  });

  // Rows sit on the measured bowl. Keep the central and side stair bands open.
  const center = { x: 476.5, z: 620.5 };
  const rowBands = [[-1.01, -0.68], [-0.62, -0.06], [0.06, 0.62], [0.68, 1.01]];
  for (let i = 0; i < 19; i++) {
    const r = 13.02 + i * 1.13;
    const point = (a, radius, lift) => {
      const x = center.x + Math.sin(a) * radius, z = center.z + Math.cos(a) * radius;
      return [x, terrainHeightAt(x, z) + lift, z];
    };
    for (const [from, to] of rowBands) for (let segment = 0; segment < 6; segment++) {
      const a = from + (to - from) * segment / 6, b = from + (to - from) * (segment + 1) / 6;
      top(batch, point(a, r, 0.12), point(b, r, 0.12), point(b, r + 0.66, 0.10), point(a, r + 0.66, 0.10), 0xaba391);
      const left = point(a, r + 0.42, 0.39), right = point(b, r + 0.42, 0.39);
      beam(details, left, right, 0.055, 0x575953);
    }
  }
  for (const path of [
    [[447.9,687.8],[449.1,676.4],[452.0,671.0],[456.2,666.2],[457.4,660.7],[463.9,657.7],[474,654]],
    [[454.4,583.1],[454.4,587.7],[450.9,594],[449.6,603.4],[451.6,611.2],[456.8,621.9],[468.7,632.4]],
  ]) {
    for (let i = 1; i < path.length; i++) {
      const [x,z] = path[i - 1], [bx,bz] = path[i];
      batch.solid(drapeEdeSurface(edeStrip({ x,z }, { x: bx,z: bz }, 0.95, 0.046)), 0xa59c87);
    }
  }

  const x = 476.5, z = 624.8, y = 6.52;
  const front = [-10,-8,-5,-2,2,5,8,10].map(dx => [x + dx,y,z + 5.2 - Math.abs(dx) ** 2 * 0.018]);
  batch.polygon([[...front, [x + 10,y,z - 4.5], [x - 10,y,z - 4.5]]], 0x3e423e);
  for (let i = 1; i < front.length; i++) {
    const a = front[i - 1], b = front[i];
    batch.quad(b, a, [a[0], y - 1.2, a[2]], [b[0], y - 1.2, b[2]], 0x6e6658);
  }
  const topY = 11.1;
  const arch = (xx, zz) => [x + xx, topY - (xx / 10) ** 2 * 1.16, z + zz + (xx / 10) ** 2];
  for (let i = -10; i < 10; i += 2) {
    const a = arch(i,-4.4), b = arch(i+2,-4.4), c = arch(i+2,4.6), d = arch(i,4.6);
    top(batch, a,b,c,d, i % 4 ? 0xdddcd0 : 0xe8e6dc);
    beam(details, b,c, 0.035, 0x9da6a2);
  }
  for (const side of [-1,1]) {
    const tip = [x + side * 12.2, 15.0, z + 2];
    beam(details, [x + side * 12.0, y - 0.4, z - 3.9], tip, 0.107, 0xc4ccc5);
    beam(details, [x + side * 11.4, y - 0.2,z + 5.9], tip, 0.085, 0xadb7b1);
    for (const dx of [3,7,10]) beam(details, tip, arch(side * dx, 4.5), 0.022, steel);
  }
  return finish(batch, details, colliders);
}
