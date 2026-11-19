import * as THREE from 'three/webgpu';
import { EDE_DATA } from './ede-geodata.js';
import { terrainHeightAt } from './terrain.js';

export const PLANTION_ORIGIN = { x: -4090, z: 970 };
const MAIN_HALL = 'w271151642';
const WEST_HALL = 'w271151018';
const OFFICE_TOP = 17;
const CROWN_HEIGHT = 42;
const CROWN_CENTER = { x: -3863.85, z: 960.07 };

const concrete = new THREE.Color(0xb2afa5);
const green = new THREE.Color(0x6f8b7b);
const pale = new THREE.Color(0xa5b2b0);
const door = new THREE.Color(0xc0c7c7);
const seam = new THREE.Color(0x495e59);
const roof = new THREE.Color(0xb0b2aa);
const solar = new THREE.Color(0x223543);
const glass = new THREE.Color(0x49616e);

function outline(source) {
  const ring = [];
  for (let i = 0; i < source.ring.length; i += 2) {
    const p = new THREE.Vector2(source.ring[i] - PLANTION_ORIGIN.x, source.ring[i + 1] - PLANTION_ORIGIN.z);
    if (!ring.length || p.distanceToSquared(ring.at(-1)) > 0.015) ring.push(p);
  }
  if (ring[0].distanceToSquared(ring.at(-1)) < 0.015) ring.pop();
  return THREE.ShapeUtils.isClockWise(ring) ? ring : ring.reverse();
}

function polygonIncludes(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > z) !== (b.y > z) && x < a.x + (z - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

function surface() {
  const positions = [], colors = [], indices = [], uvs = [];
  return {
    face(points, tint, texcoords = []) {
      const start = positions.length / 3;
      for (const [i, p] of points.entries()) {
        positions.push(...p);
        colors.push(tint.r, tint.g, tint.b);
        uvs.push(...(texcoords[i] || [0, 0]));
      }
      indices.push(start, start + 1, start + 2);
      if (points.length === 4) indices.push(start, start + 2, start + 3);
    },
    mesh(material) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      return mesh;
    }
  };
}

function paintSign() {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 68px Georgia, serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#173f2a';
  ctx.fillText('Plantion', 7, 53);
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI * 0.2;
    ctx.beginPath();
    ctx.ellipse(328 + Math.cos(angle) * 21, 47 + Math.sin(angle) * 21, 17, 6, angle, 0, 2 * Math.PI);
    ctx.fillStyle = i % 2 ? '#e6eb94' : '#a6d13d';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(328, 47, 10, 0, 2 * Math.PI);
  ctx.fillStyle = '#dceeb2';
  ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, roughness: 0.85 });
}

export function createPlantion() {
  const group = new THREE.Group();
  const walls = surface(), windows = surface(), signage = surface();
  const tint = new THREE.Color(), white = new THREE.Color(0xffffff);
  const { x: ox, z: oz } = PLANTION_ORIGIN;
  const ground = terrainHeightAt(ox, oz);
  const halls = EDE_DATA.buildings.filter(b => b.id === MAIN_HALL || b.id === WEST_HALL);
  for (const source of halls) {
    const ring = outline(source);
    const main = source.id === MAIN_HALL;
    const roofAt = (x, z) => {
      if (!main) return 8.5;
      const rise = THREE.MathUtils.smoothstep(x + ox, -4020, -3870);
      const setback = 1 - THREE.MathUtils.smoothstep(z + oz, 966, 1010);
      return 11.3 + (OFFICE_TOP - 11.3) * rise * setback;
    };

    // The roof rises toward the cylindrical corner and stays low over the dispatch halls.
    const roofPoint = p => [p.x, roofAt(p.x, p.y), p.y];
    for (const face of THREE.ShapeUtils.triangulateShape(ring, [])) {
      const [a, b, c] = face.map(i => ring[i]);
      const order = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0 ? [a, b, c] : [c, b, a];
      walls.face(order.map(roofPoint), roof);
    }

    const edges = ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x, dz = b.y - a.y, length = a.distanceTo(b);
      return { a, b, dx, dz, length, wx: (a.x + b.x) / 2 + ox, wz: (a.y + b.y) / 2 + oz };
    });
    for (const [edge, { a, b, dx, dz, length, wx, wz }] of edges.entries()) {
      const nx = -dz / length, nz = dx / length;
      const apex = [roofAt(a.x, a.y), roofAt(b.x, b.y)];
      const bottom = [a, b].map(p => Math.min(-0.12, terrainHeightAt(p.x + ox, p.y + oz) - ground - 0.18));
      const point = (t, y, offset = 0) => [a.x + dx * t + nx * offset, y, a.y + dz * t + nz * offset];
      const span = (target, start, end, lowA, lowB, highA, highB, color, offset = 0) =>
        target.face([point(start, lowA, offset), point(end, lowB, offset),
          point(end, highB, offset), point(start, highA, offset)], color);

      span(walls, 0, 1, bottom[0], bottom[1], 3.68, 3.68, concrete);
      const office = main && (wx > -3877 || (wx > -4140 && wz < 922));
      const panel = office ? green : pale;
      const columns = Math.ceil(length / 1.25);
      for (let i = 0; i < columns; i++) {
        const s = i / columns, t = (i + 1) / columns;
        tint.copy(panel).multiplyScalar([0.94, 1.02, 0.98, 1.05][(edge + i) % 4]);
        span(walls, s, t, 3.68, 3.68,
          THREE.MathUtils.lerp(...apex, s), THREE.MathUtils.lerp(...apex, t), tint);
      }
      if (!office) {
        span(walls, 0, 1, 4.9, 4.9, 5.66, 5.66, green, 0.015);
        if (apex[0] > 7.05 && apex[1] > 7.05) span(walls, 0, 1, 6.32, 6.32, 7.04, 7.04, green, 0.015);
      }
      if (office) {
        // The mullions break up two continuous rows of reflective office windows.
        for (const y of [5.35, 9.26]) {
          if (Math.min(...apex) < y + (y < 6 ? 1.45 : 3.1)) continue;
          span(walls, 0, 1, y - 0.08, y - 0.08, y + 1.38, y + 1.38, seam, 0.035);
          const count = Math.ceil(length / 2.1);
          for (let i = 0; i < count; i++) {
            const gap = Math.min(0.08 / length, 0.18);
            const start = i / count + gap, end = (i + 1) / count - gap;
            if (end <= start) continue;
            tint.copy(glass).multiplyScalar(0.74 + ((i + edge) % 5) * 0.135);
            span(windows, start, end, y, y, y + 1.27, y + 1.27, tint, 0.048);
          }
        }
      }
      if (length < 2.25 || (!office && !(wz > 1028 || (wz < 928 && main)))) continue;
      const docks = Math.max(1, Math.round(length / 5.4));
      const margin = Math.min(0.72 / length, 0.16);
      for (let i = 0; i < docks; i++) {
        const s = i / docks + margin, t = (i + 1) / docks - margin;
        if (t <= s) continue;
        span(walls, s - 0.025 / length, t + 0.025 / length, 0.12, 0.12, 3.5, 3.5, seam, 0.025);
        span(walls, s, t, 0.19, 0.19, 3.36, 3.36, door, 0.038);
        for (let pane = 0; pane < 3; pane++) {
          const l = THREE.MathUtils.lerp(s, t, (pane + 0.32) / 3);
          const r = THREE.MathUtils.lerp(s, t, (pane + 0.78) / 3);
          span(windows, l, r, 2.49, 2.49, 2.78, 2.78, glass, 0.051);
        }
      }
    }

    // Fit the roof-mounted arrays inside the surveyed perimeter, clear of the office curl.
    const minX = Math.min(...ring.map(p => p.x)), maxX = Math.min(137, Math.max(...ring.map(p => p.x)));
    const minZ = Math.min(...ring.map(p => p.y)), maxZ = Math.max(...ring.map(p => p.y));
    for (let x = minX + 9; x + 11 < maxX; x += 14) for (let z = minZ + 9; z + 4 < maxZ; z += 7.7) {
      if (![[x - 2, z - 2], [x + 13, z - 2], [x + 13, z + 5], [x - 2, z + 5]]
        .every(([a, b]) => polygonIncludes(ring, a, b))) continue;
      const end = x + 11.04, back = z + 3.75;
      walls.face([[x, roofAt(x, z) + 0.21, z], [x, roofAt(x, back) + 0.46, back],
        [end, roofAt(end, back) + 0.46, back], [end, roofAt(end, z) + 0.21, z]], solar);
    }

    if (!main) continue;
    // The original Plantion wordmark is mounted directly on the green curved spandrel.
    for (const selection of [
      edges.filter(e => e.wx > -3863 && e.wz >= 924 && e.wz < 940),
      edges.filter(e => e.wx > -3869 && e.wz >= 955 && e.wz < 968)
    ]) {
      const width = selection.reduce((sum, edge) => sum + edge.length, 0);
      if (!width) continue;
      let d = 0;
      for (const { a, b, dx, dz, length } of selection) {
        const front = p => [p.x - dz / length * 0.11, p.y + dx / length * 0.11];
        const [ax, az] = front(a), [bx, bz] = front(b);
        const u0 = d / width, u1 = (d + length) / width;
        signage.face([[ax, 12.64, az], [bx, 12.64, bz], [bx, 16.15, bz], [ax, 16.15, az]], white,
          [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
        d += length;
      }
    }
  }

  // The 2015 built crown rises to 42 m. Its twist and open inner edge follow the architect's views.
  const cx = CROWN_CENTER.x - ox, cz = CROWN_CENTER.z - oz;
  const tower = surface();
  const spiral = i => {
    const t = i / 108, turn = t * Math.PI * 4.45;
    const radius = 8.05 * Math.exp(-2.45 * t ** 1.65);
    const lower = OFFICE_TOP - 0.2 + 23.4 * Math.max(0, (t - 0.35) / 0.65) ** 2.1;
    const upper = 20.15 + (CROWN_HEIGHT - 20.15) * t ** 2;
    const angle = turn + 0.8;
    return { x: cx + radius * Math.cos(angle), z: cz + radius * Math.sin(angle), lower, upper };
  };
  for (let i = 0; i < 108; i++) {
    const a = spiral(i), b = spiral(i + 1);
    tint.copy(green).multiplyScalar([0.94, 1, 1.07][i % 3]);
    tower.face([[a.x, a.lower, a.z], [a.x, a.upper, a.z], [b.x, b.upper, b.z], [b.x, b.lower, b.z]], tint);
    if ((i >= 49 && i <= 65) || (i >= 70 && i <= 79)) {
      const panel = p => [p.x + (p.x - cx) * 0.009, p.z + (p.z - cz) * 0.009];
      const [x, z] = panel(a), [q, r] = panel(b);
      const ya = a.lower + (a.upper - a.lower) * 0.23, yb = b.lower + (b.upper - b.lower) * 0.23;
      const ta = a.lower + (a.upper - a.lower) * 0.67, tb = b.lower + (b.upper - b.lower) * 0.67;
      tower.face([[x, ya, z], [x, ta, z], [q, tb, r], [q, yb, r]], solar);
    }
  }
  const solid = walls.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  const crown = tower.mesh(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.68, metalness: 0.2, side: THREE.DoubleSide
  }));
  solid.castShadow = crown.castShadow = true;
  group.add(solid, crown, windows.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.18 })));
  if (typeof document !== 'undefined') group.add(signage.mesh(paintSign()));
  return group;
}
