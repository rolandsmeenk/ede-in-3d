import * as THREE from 'three/webgpu';
import { EDE_DATA } from './city-config.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

// Geometry adapters only: rendering stays in the upstream WebGPU/TSL systems.
export const EDE_RENDER_CELL = 750;

export function edeSpatialGroups(items, position = item => item) {
  const cells = new Map();
  for (const item of items) {
    const { x, z } = position(item);
    const key = `${Math.floor(x / EDE_RENDER_CELL)}/${Math.floor(z / EDE_RENDER_CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(item);
  }
  return cells.values();
}

export function edeGeometryGroups(geometries) {
  return edeSpatialGroups(geometries, geometry => {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    return { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 };
  });
}

export function edePoints(flat) {
  const points = [];
  for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i], z: flat[i + 1] });
  return points;
}

export function edeBounds(points) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z);
  }
  return b;
}

export function edePolygonGeometry(ring, holes = [], y = 0) {
  const shape = new THREE.Shape(ring.map(p => new THREE.Vector2(p.x, -p.z)));
  for (const hole of holes) if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, -p.z))));
  const geometry = new THREE.ShapeGeometry(shape, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

export function edeStrip(a, b, halfWidth, y, offset = 0) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  if (len < 0.1) return null;
  const nx = -dz / len, nz = dx / len;
  return edePolygonGeometry([
    { x: a.x + nx * (offset - halfWidth), z: a.z + nz * (offset - halfWidth) },
    { x: b.x + nx * (offset - halfWidth), z: b.z + nz * (offset - halfWidth) },
    { x: b.x + nx * (offset + halfWidth), z: b.z + nz * (offset + halfWidth) },
    { x: a.x + nx * (offset + halfWidth), z: a.z + nz * (offset + halfWidth) },
  ], [], y);
}

export const EDE_PEDESTRIAN_WAYS = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway', 'bridleway']);
let segments;
let roadIndex;
export function edeRoadSegments() {
  if (segments) return segments;
  segments = [];
  roadIndex = new Map();
  for (const road of EDE_DATA.roads || []) {
    if (road.tunnel || !road.pts) continue;
    const points = edePoints(road.pts);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.8) continue;
      const s = { a, b, len, road, segmentIndex: i - 1, width: road.width || 6, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
        pedestrian: EDE_PEDESTRIAN_WAYS.has(road.kind), bridge: !!road.bridge };
      segments.push(s);
      if (s.pedestrian) continue;
      for (let x = Math.floor(Math.min(a.x, b.x) / 64); x <= Math.floor(Math.max(a.x, b.x) / 64); x++) {
        for (let z = Math.floor(Math.min(a.z, b.z) / 64); z <= Math.floor(Math.max(a.z, b.z) / 64); z++) {
          const key = `${x}/${z}`;
          if (!roadIndex.has(key)) roadIndex.set(key, []);
          roadIndex.get(key).push(s);
        }
      }
    }
  }
  return segments;
}

export function nearestEdeRoad(x, z, reach = 40) {
  edeRoadSegments();
  let best = null, bestD = reach * reach;
  for (let gx = Math.floor((x - reach) / 64); gx <= Math.floor((x + reach) / 64); gx++) {
    for (let gz = Math.floor((z - reach) / 64); gz <= Math.floor((z + reach) / 64); gz++) {
      for (const s of roadIndex.get(`${gx}/${gz}`) || []) {
        const t = Math.max(0, Math.min(s.len, (x - s.a.x) * s.ux + (z - s.a.z) * s.uz));
        const px = s.a.x + s.ux * t, pz = s.a.z + s.uz * t;
        const d2 = (px - x) ** 2 + (pz - z) ** 2;
        if (d2 < bestD) { bestD = d2; best = { ...s, x: px, z: pz, distance: Math.sqrt(d2) }; }
      }
    }
  }
  return best;
}

function surfaceGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  const uv = new Float32Array(positions.length / 3 * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3) {
    uv[j++] = positions[i];
    uv[j++] = -positions[i + 2];
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (indices) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function* edeTerrainGeometries(y) {
  const { columns, rows, minX, minZ, step, heights, maxX, maxZ, minY } = getTerrain();
  const chunk = 64;
  for (let row = 0; row < rows - 1; row += chunk) for (let col = 0; col < columns - 1; col += chunk) {
    const width = Math.min(chunk, columns - 1 - col) + 1;
    const height = Math.min(chunk, rows - 1 - row) + 1;
    const positions = new Float32Array(width * height * 3), indices = [];
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const a = j * width + i, offset = a * 3;
      positions[offset] = minX + (col + i) * step;
      positions[offset + 1] = heights[(row + j) * columns + col + i] + y;
      positions[offset + 2] = minZ + (row + j) * step;
      if (i + 1 < width && j + 1 < height) indices.push(a, a + width, a + 1, a + 1, a + width, a + width + 1);
    }
    yield surfaceGeometry(positions, indices);
  }

  // Continue the measured edges into coarse distant scenery.
  const border = 16000;
  const rim = (n, sample, outside) => {
    const positions = [], indices = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = sample(i);
      const [ox, oz] = outside(i / (n - 1));
      positions.push(x, terrainHeightAt(x, z) + y, z, ox, minY + y, oz);
      const a = i * 2;
      if (i + 1 < n) indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
    return surfaceGeometry(positions, indices);
  };
  yield rim(columns, i => [minX + i * step, minZ], t => [-border + 2 * border * t, -border]);
  yield rim(rows, i => [maxX, minZ + i * step], t => [border, -border + 2 * border * t]);
  yield rim(columns, i => [maxX - i * step, maxZ], t => [border - 2 * border * t, border]);
  yield rim(rows, i => [minX, maxZ - i * step], t => [-border, border - 2 * border * t]);
}

function clipSurface(points, signedDistance) {
  const result = [];
  let a = points[points.length - 1], da = signedDistance(a);
  for (const b of points) {
    const db = signedDistance(b);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
    if (db >= 0) result.push(b);
    a = b; da = db;
  }
  return result;
}

// Split planar overlays across both the grid lines and the cell diagonal, so
// their offsets stay above the same triangles used by rendering and physics.
export function drapeEdeSurface(geometry) {
  const field = getTerrain();
  if (!field || !geometry) return geometry;
  const { step, minX, minZ, columns, rows } = field;
  const position = geometry.getAttribute('position'), index = geometry.index;
  if (!position.count) return geometry;
  const lift = position.getY(0), positions = [];
  const emit = polygon => {
    for (let i = 1; i + 1 < polygon.length; i++) {
      const a = polygon[0], b = polygon[i], c = polygon[i + 1];
      if (Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) < 1e-8) continue;
      for (const p of [a, b, c]) positions.push(p.x, terrainHeightAt(p.x, p.z) + lift, p.z);
    }
  };
  const visit = polygon => {
    if (polygon.length < 3) return;
    const bounds = edeBounds(polygon);
    const x0 = Math.max(0, Math.floor((bounds.minX + 1e-6 - minX) / step) + 1);
    const z0 = Math.max(0, Math.floor((bounds.minZ + 1e-6 - minZ) / step) + 1);
    const x1 = Math.min(columns - 1, Math.floor((bounds.maxX - 1e-6 - minX) / step));
    const z1 = Math.min(rows - 1, Math.floor((bounds.maxZ - 1e-6 - minZ) / step));
    if (x1 >= x0 || z1 >= z0) {
      const d = x1 - x0 >= z1 - z0
        ? p => p.x - (minX + Math.floor((x0 + x1) / 2) * step)
        : p => p.z - (minZ + Math.floor((z0 + z1) / 2) * step);
      visit(clipSurface(polygon, d));
      visit(clipSurface(polygon, p => -d(p)));
      return;
    }
    const col = Math.floor(((bounds.minX + bounds.maxX) / 2 - minX) / step);
    const row = Math.floor(((bounds.minZ + bounds.maxZ) / 2 - minZ) / step);
    if (col >= 0 && col < columns - 1 && row >= 0 && row < rows - 1) {
      const diagonal = minX + minZ + (col + row + 1) * step;
      const d = p => p.x + p.z - diagonal;
      emit(clipSurface(polygon, d));
      emit(clipSurface(polygon, p => -d(p)));
    } else emit(polygon);
  };
  const count = index ? index.count : position.count;
  const point = i => {
    const v = index ? index.getX(i) : i;
    return { x: position.getX(v), z: position.getZ(v) };
  };
  for (let i = 0; i < count; i += 3) visit([point(i), point(i + 1), point(i + 2)]);
  geometry.dispose();
  return surfaceGeometry(positions);
}

export function drapeEdeVertices(geometry) {
  if (!getTerrain()) return geometry;
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    position.setY(i, position.getY(i) + terrainHeightAt(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();
  return geometry;
}
