import * as THREE from '../vendor/three/build/three.core.js';
import { sampleTerrain } from './terrain.js?v=20261124-workers';

export const SIDE = 51;
export const CELLS = 50;
export const FULL_EDGE = 2 ** CELLS - 1;
const BEVEL = 0.42;
const SKIRT_BASE = [1, 1, 0.42];
const CROWN_PROFILE = [[0, 0.22, 0.94], [0.16, 0.59, 0.72], SKIRT_BASE];
const DISTANT_CROWN_PROFILE = [[0, 0.28, 0.92], SKIRT_BASE];

const linear = Float32Array.from({ length: 256 }, (_, i) => THREE.ColorManagement.convert(
  new THREE.Color().setScalar(i / 255), THREE.SRGBColorSpace, THREE.LinearSRGBColorSpace
).r);

function overlap(a, b) {
  return a[0] <= b[2] && a[1] <= b[3] && a[2] >= b[0] && a[3] >= b[1];
}

function splitPolygon(points, distance) {
  const distances = points.map(distance);
  if (distances.every(value => value >= 0)) return [points, []];
  if (distances.every(value => value <= 0)) return [[], points];
  const inside = [], outside = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const da = distances[i], db = distances[(i + 1) % points.length];
    (da < 0 ? outside : inside).push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      const edge = a.map((value, j) => value + (b[j] - value) * t);
      inside.push(edge);
      outside.push(edge);
    } else if (da === 0) {
      outside.push(a);
    }
  }
  return [inside, outside];
}

export function buildTerrainGeometry(bytes, tile, legacy, field, seamOffset, side = SIDE) {
  if (bytes.byteLength !== side * side * 5) throw new Error('Invalid AHN terrain tile size');
  const view = new DataView(bytes);
  const [minX, minZ, maxX, maxZ] = tile.bounds;
  const bakeLinear = side === SIDE;
  const detail = bakeLinear ? tile.detail : null;
  if (detail) side = (maxX - minX) / detail.step + 1;
  const step = (maxX - minX) / (side - 1);
  const positions = [], colors = [], indices = [];
  const decodeColor = value => bakeLinear ? Math.round(linear[value] * 255) : value;
  function vertex(x, y, z, r, g, b) {
    const index = positions.length / 3;
    positions.push(x, y - 0.025, z);
    colors.push(r, g, b, 255);
    return index;
  }
  if (detail) {
    // Match the existing aerial palette and triangle interpolation at tile edges.
    const ratio = (SIDE - 1) / (side - 1);
    const stride = detail.stride ?? detail.columns;
    const start = ((minZ - detail.minZ) / step - (detail.rowOffset ?? 0)) * stride
      + (minX - detail.minX) / step - (detail.columnOffset ?? 0);
    const colorAt = (index, band) => decodeColor(view.getUint8(index * 5 + band));
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const cx = Math.min(SIDE - 2, Math.floor(x * ratio)), cz = Math.min(SIDE - 2, Math.floor(z * ratio));
      const u = x * ratio - cx, v = z * ratio - cz;
      const index = cz * SIDE + cx;
      const color = band => {
        const b = colorAt(index + 1, band), c = colorAt(index + SIDE, band);
        const fromLower = u + v <= 1;
        const a = colorAt(fromLower ? index : index + SIDE + 1, band);
        return Math.round(fromLower ? a + (b - a) * u + (c - a) * v : a + (c - a) * (1 - u) + (b - a) * (1 - v));
      };
      vertex(minX + x * step, detail.heights[start + z * stride + x], minZ + z * step, color(2), color(3), color(4));
    }
  } else {
    for (let z = 0, i = 0; z < side; z++) for (let x = 0; x < side; x++, i += 5) {
      const worldX = minX + x * step, worldZ = minZ + z * step;
      const elevation = (view.getInt16(i, true) - Math.round(field.napOrigin * 100)) / 100;
      vertex(worldX, elevation + seamOffset(worldX, worldZ),
        worldZ, decodeColor(view.getUint8(i + 2)),
        decodeColor(view.getUint8(i + 3)), decodeColor(view.getUint8(i + 4)));
    }
  }

  const pointAt = i => [positions[i * 3], positions[i * 3 + 1] + 0.025, positions[i * 3 + 2],
    colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2]];

  const cuts = tile.gradeCuts?.map(({ minX, minZ, maxX, maxZ, planes, ceiling }) => ({
    bounds: [minX, minZ, maxX, maxZ],
    distances: [
      ...planes.map(([x, z, offset]) => point => x * point[0] + z * point[2] - offset),
      ...(Number.isFinite(ceiling) ? [point => ceiling - point[1]] : []),
    ],
  }));

  function emitTriangle(a, b, c) {
    if (!cuts?.length) {
      indices.push(a, b, c);
      return;
    }
    const ax = positions[a * 3], az = positions[a * 3 + 2];
    const bx = positions[b * 3], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cz = positions[c * 3 + 2];
    const bounds = [Math.min(ax, bx, cx), Math.min(az, bz, cz), Math.max(ax, bx, cx), Math.max(az, bz, cz)];
    const relevant = cuts.filter(cut => overlap(bounds, cut.bounds));
    if (!relevant.length) {
      indices.push(a, b, c);
      return;
    }

    const corners = [a, b, c];
    const points = corners.map(pointAt);
    let fragments = [points];
    for (const { distances } of relevant) {
      const kept = [];
      for (const fragment of fragments) {
        // Subtract a convex prism. The optional height plane keeps an ecoduct's upper terrain.
        let inside = fragment;
        const outside = [];
        for (const distance of distances) {
          const [inner, outer] = splitPolygon(inside, distance);
          inside = inner;
          if (inside.length < 3) break;
          if (outer.length >= 3) outside.push(outer);
        }
        if (inside.length < 3) kept.push(fragment);
        else kept.push(...outside);
      }
      fragments = kept;
      if (!fragments.length) return;
    }
    for (const fragment of fragments) {
      const clipped = fragment.map(point => {
        const original = points.indexOf(point);
        if (original >= 0) return corners[original];
        const [x, y, z, r, g, b] = point;
        return vertex(x, y, z, Math.round(r), Math.round(g), Math.round(b));
      });
      for (let i = 1; i + 1 < clipped.length; i++) indices.push(clipped[0], clipped[i], clipped[i + 1]);
    }
  }

  // Boundary tiles intersect a triangulation of the municipality. Using the same polygon for
  // the overview and every tile level keeps the edge fixed while height and colour refine.
  const binsPerSide = 8;
  const binSize = (maxX - minX) / binsPerSide;
  const bins = tile.boundary && Array.from({ length: binsPerSide ** 2 }, (_, i) => {
    const x = minX + i % binsPerSide * binSize, z = minZ + Math.floor(i / binsPerSide) * binSize;
    const bounds = [x, z, x + binSize + step, z + binSize + step];
    const parts = tile.boundary.parts.filter(part => overlap(bounds, part.bounds));
    const edges = tile.boundary.edges.filter(edge => overlap(bounds, edge));
    return { parts, edges, inside: !edges.length && parts.some(({ planes }) => planes.every(([a, b, c]) => a * x + b * z + c >= 0)) };
  });
  const binAt = (value, origin) => Math.max(0, Math.min(binsPerSide - 1, Math.floor((value - origin) / binSize)));
  function addTriangle(a, b, c) {
    if (!bins) {
      emitTriangle(a, b, c);
      return;
    }
    const west = Math.min(positions[a * 3], positions[b * 3], positions[c * 3]);
    const north = Math.min(positions[a * 3 + 2], positions[b * 3 + 2], positions[c * 3 + 2]);
    const bin = bins[binAt(west, minX) + binAt(north, minZ) * binsPerSide];
    if (!bin.edges.length) {
      if (bin.inside) emitTriangle(a, b, c);
      return;
    }
    const east = Math.max(positions[a * 3], positions[b * 3], positions[c * 3]);
    const south = Math.max(positions[a * 3 + 2], positions[b * 3 + 2], positions[c * 3 + 2]);
    const bounds = [west, north, east, south];
    if (!bin.edges.some(edge => overlap(bounds, edge))) {
      if (bin.parts.some(part => overlap(bounds, part.bounds) && part.planes.every(([x, z, offset]) =>
        x * positions[a * 3] + z * positions[a * 3 + 2] + offset >= 0))) emitTriangle(a, b, c);
      return;
    }
    const corners = [a, b, c];
    const points = corners.map(pointAt);
    for (const part of bin.parts) {
      if (!overlap(bounds, part.bounds)) continue;
      let fragment = points;
      for (const [x, z, offset] of part.planes) {
        const distance = p => x * p[0] + z * p[2] + offset;
        if (fragment.every(p => distance(p) >= 0)) continue;
        const clipped = [];
        for (let i = 0; i < fragment.length; i++) {
          const p = fragment[i], q = fragment[(i + 1) % fragment.length];
          const dp = distance(p), dq = distance(q);
          if (dp >= 0) clipped.push(p);
          if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
            const t = dp / (dp - dq);
            clipped.push(p.map((value, j) => value + (q[j] - value) * t));
          }
        }
        fragment = clipped;
        if (fragment.length < 3) break;
      }
      if (fragment === points) {
        emitTriangle(a, b, c);
        return;
      }
      if (fragment.length < 3) continue;
      const clipped = fragment.map(point => {
        const original = points.indexOf(point);
        if (original >= 0) return corners[original];
        const [x, y, z, r, g, b] = point;
        return vertex(x, y, z, Math.round(r), Math.round(g), Math.round(b));
      });
      for (let i = 1; i + 1 < clipped.length; i++) emitTriangle(clipped[0], clipped[i], clipped[i + 1]);
    }
  }

  // The retained town rectangle owns its original grid and surveyed grades.
  const insideLegacy = (x, z) => x > legacy.minX && x < legacy.maxX && z > legacy.minZ && z < legacy.maxZ;
  const trim = minX < legacy.maxX && maxX > legacy.minX && minZ < legacy.maxZ && maxZ > legacy.minZ;
  const clip = (polygon, axis, edge, direction) => {
    const out = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = (a[axis] - edge) * direction, db = (b[axis] - edge) * direction;
      if (da >= 0) out.push(a);
      if ((da < 0) !== (db < 0)) {
        const t = da / (da - db);
        out.push(a.map((value, j) => value + (b[j] - value) * t));
      }
    }
    return out;
  };
  const planes = [[0, legacy.minX, 1], [0, legacy.maxX, -1], [2, legacy.minZ, 1], [2, legacy.maxZ, -1]];
  const edgeVertex = ([x, y, z, r, g, b]) => {
    if (x >= legacy.minX && x <= legacy.maxX && z >= legacy.minZ && z <= legacy.maxZ) {
      y = sampleTerrain(legacy, x, z);
    }
    return vertex(x, y, z, Math.round(r), Math.round(g), Math.round(b));
  };
  function triangle(a, b, c) {
    if (!trim) {
      addTriangle(a, b, c);
      return;
    }
    const points = [a, b, c].map(pointAt);
    const outsideLegacy = planes.some(([axis, edge, sign]) => points.every(p => (p[axis] - edge) * sign <= 0));
    if (outsideLegacy) {
      addTriangle(a, b, c);
      return;
    }
    if (points.every(([x, , z]) => insideLegacy(x, z))) return;
    let inside = points;
    for (const [axis, edge, direction] of planes) {
      const outside = clip(inside, axis, edge, -direction);
      if (outside.length >= 3) {
        const vertices = outside.map(edgeVertex);
        for (let i = 1; i + 1 < vertices.length; i++) addTriangle(vertices[0], vertices[i], vertices[i + 1]);
      }
      inside = clip(inside, axis, edge, direction);
      if (inside.length < 3) break;
    }
  }
  for (let z = 0; z < side - 1; z++) for (let x = 0; x < side - 1; x++) {
    const a = z * side + x;
    triangle(a, a + side, a + 1);
    triangle(a + 1, a + side, a + side + 1);
  }

  // Skirt faces point toward the lower neighbour. Separate vertices keep
  // their normals out of the top surface shading.
  const perimeter = [
    Array.from({ length: side }, (_, i) => i),
    Array.from({ length: side }, (_, i) => i * side + side - 1),
    Array.from({ length: side }, (_, i) => side * side - 1 - i),
    Array.from({ length: side }, (_, i) => (side - 1 - i) * side),
  ];
  for (const [edgeIndex, edge] of perimeter.entries()) {
    const depth = tile.skirts[edgeIndex], axis = edgeIndex % 2 === 0 ? 0 : 2;
    const fixed = pointAt(edge[0])[2 - axis];
    const [start, end] = axis === 0 ? [legacy.minX, legacy.maxX] : [legacy.minZ, legacy.maxZ];
    const clipToTown = axis === 0 ? fixed > legacy.minZ && fixed < legacy.maxZ
      : fixed > legacy.minX && fixed < legacy.maxX;
    let lastPoint, lastPair;
    const addPair = ([x, y, z, r, g, b]) =>
      [vertex(x, y, z, r, g, b), vertex(x, y - depth, z, r, g, b)];
    function addSkirt(a, b) {
      if (a[axis] === b[axis]) return;
      const [topA, downA] = a[axis] === lastPoint ? lastPair : addPair(a);
      const [topB, downB] = addPair(b);
      addTriangle(topA, topB, downA);
      addTriangle(downA, topB, downB);
      lastPoint = b[axis];
      lastPair = [topB, downB];
    }
    for (let i = 1; i < side; i++) {
      const a = pointAt(edge[i - 1]), b = pointAt(edge[i]);
      if (!clipToTown || Math.max(a[axis], b[axis]) <= start || Math.min(a[axis], b[axis]) >= end) {
        addSkirt(a, b);
        continue;
      }
      const clipEdge = (a, b, limit) => {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        const point = a.map((value, j) => value + t * (b[j] - value));
        point[axis] = limit;
        point[1] = sampleTerrain(legacy, point[0], point[2]);
        return point;
      };
      if (a[axis] < start || a[axis] > end) addSkirt(a, clipEdge(a, b, a[axis] < start ? start : end));
      if (b[axis] < start || b[axis] > end) addSkirt(clipEdge(b, a, b[axis] < start ? start : end), b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(colors, 4, true));
  const uv = new Float32Array(positions.length / 3 * 2);
  for (let i = 0; i < uv.length / 2; i++) {
    uv[i * 2] = positions[i * 3];
    uv[i * 2 + 1] = -positions[i * 3 + 2];
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildCanopyGeometry(buffer, { bounds, step: size, buffered = false, neighborMask = [FULL_EDGE, FULL_EDGE, FULL_EDGE, FULL_EDGE] }, {
  napOrigin, terrainHeightAt, containsPlayablePoint, playableBoundsCovered, playableBoundsOverlap,
}) {
  const side = CELLS + 1;
  const offset = CELLS * CELLS;
  if (buffer.byteLength !== offset + side * side * 2) throw new Error('Invalid canopy cell size');
  const rawMask = new Uint8Array(buffer, 0, offset);
  const mask = !buffered && playableBoundsCovered && !playableBoundsCovered(...bounds) ? rawMask.slice() : rawMask;
  if (mask !== rawMask) for (let z = 0; z < CELLS; z++) for (let x = 0; x < CELLS; x++) {
    const i = z * CELLS + x;
    if (!mask[i]) continue;
    const left = bounds[0] + x * size, top = bounds[1] + z * size;
    if (!playableBoundsCovered(left, top, left + size, top + size)) mask[i] = 0;
  }
  const height = new DataView(buffer, offset);
  const positions = new Array(side * side * 3);
  const shades = new Array(side * side);
  const indices = [];
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const i = z * side + x;
    const worldX = bounds[0] + x * size, worldZ = bounds[1] + z * size;
    positions[i * 3] = worldX;
    positions[i * 3 + 1] = height.getInt16(i * 2, true) / 100 - napOrigin;
    positions[i * 3 + 2] = worldZ;
    const shade = Math.sin(worldX * 0.743 + worldZ * 0.513) * 43758.5453;
    shades[i] = 0.70 + 0.30 * (shade - Math.floor(shade));
  }
  const outlines = new Map(), isolated = new Set();
  const coveredOnNeighbor = (edge, index) => Math.floor(neighborMask[edge] / 2 ** index) % 2;
  function covered(x, z) {
    if (z < 0) return coveredOnNeighbor(0, x);
    if (x >= CELLS) return coveredOnNeighbor(1, z);
    if (z >= CELLS) return coveredOnNeighbor(2, x);
    if (x < 0) return coveredOnNeighbor(3, z);
    return mask[z * CELLS + x] ? 1 : 0;
  }

  const walls = [], insets = new Map(), previousVertex = new Map(), nextVertex = new Map();
  function wall(a, b) {
    const dx = positions[b * 3] - positions[a * 3];
    const dz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const length = Math.hypot(dx, dz);
    for (const i of [a, b]) {
      if (!insets.has(i)) insets.set(i, [0, 0]);
      const inset = insets.get(i);
      inset[0] -= dz / length;
      inset[1] += dx / length;
    }
    walls.push([a, b]);
    nextVertex.set(a, b);
    previousVertex.set(b, a);
  }
  function bevel(corner, toward) {
    const index = positions.length / 3;
    for (let axis = 0; axis < 3; axis++) {
      const start = positions[corner * 3 + axis], end = positions[toward * 3 + axis];
      positions.push(start + (end - start) * BEVEL);
    }
    shades.push(shades[corner] + (shades[toward] - shades[corner]) * BEVEL);
    return index;
  }
  for (let z = 0; z < CELLS; z++) for (let x = 0; x < CELLS; x++) {
    const cell = z * CELLS + x;
    if (!mask[cell]) continue;
    const north = covered(x, z - 1), east = covered(x + 1, z);
    const south = covered(x, z + 1), west = covered(x - 1, z);
    const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
    if (north && east && south && west) {
      indices.push(a, c, b, b, c, d);
      continue;
    }
    const corners = [a, b, d, c];
    const neighbors = [north, east, south, west];
    const ring = [];
    const starts = [], ends = [];
    for (let i = 0; i < 4; i++) {
      const previous = (i + 3) % 4, next = (i + 1) % 4;
      if (neighbors[previous] || neighbors[i]) {
        starts[i] = ends[i] = corners[i];
        ring.push(corners[i]);
        continue;
      }
      starts[i] = bevel(corners[i], corners[previous]);
      ends[i] = bevel(corners[i], corners[next]);
      ring.push(starts[i], ends[i]);
      wall(starts[i], ends[i]);
    }
    if (!neighbors.some(Boolean)) for (const vertex of ring) isolated.add(vertex);
    outlines.set(cell, ring);
    for (let i = 1; i < ring.length - 1; i++) indices.push(ring[0], ring[i + 1], ring[i]);
    for (let i = 0; i < 4; i++) {
      if (!neighbors[i]) wall(ends[i], starts[(i + 1) % 4]);
    }
  }

  // Both tiles solve a shared rim vertex using the same four coverage samples.
  // Keep it on the seam whenever covered cells connect across it.
  function alignSeam(x, z, vertical) {
    const i = z * side + x;
    const nw = covered(x - 1, z - 1), ne = covered(x, z - 1);
    const sw = covered(x - 1, z), se = covered(x, z);
    if (!insets.has(i) && nw + ne + sw + se !== 3) return;
    const joins = vertical ? (nw && ne) || (sw && se) : (nw && sw) || (ne && se);
    const dx = joins && vertical ? 0 : ne + se - nw - sw;
    const dz = joins && !vertical ? 0 : sw + se - nw - ne;
    insets.set(i, [dx, dz]);
  }
  for (let j = 1; j < CELLS; j++) {
    alignSeam(j, 0, false);
    alignSeam(j, CELLS, false);
    alignSeam(0, j, true);
    alignSeam(CELLS, j, true);
  }
  // Corner neighbours aren't represented in the tile mask.
  for (const i of [0, CELLS, CELLS * side, side * side - 1]) {
    if (insets.has(i)) insets.set(i, [0, 0]);
  }

  // Smooth the traced polygon before rolling its sides down. Tile joins stay pinned,
  // and a concave turn can move only a little into a mapped clearing.
  const smoothed = new Map();
  for (const [i, [inwardX, inwardZ]] of insets) {
    const col = i % side, row = Math.floor(i / side);
    if (row < side && (col === 0 || col === CELLS || row === 0 || row === CELLS)) continue;
    const a = previousVertex.get(i), b = nextVertex.get(i);
    if (a === undefined || b === undefined) continue;
    const x = positions[i * 3], z = positions[i * 3 + 2];
    const ax = positions[a * 3] - x, az = positions[a * 3 + 2] - z;
    const bx = positions[b * 3] - x, bz = positions[b * 3 + 2] - z;
    const lengthA = Math.hypot(ax, az), lengthB = Math.hypot(bx, bz);
    const step = Math.min(lengthA, lengthB) * 0.33;
    const shiftX = (ax / lengthA + bx / lengthB) * step;
    const shiftZ = (az / lengthA + bz / lengthB) * step;
    const limit = shiftX * inwardX + shiftZ * inwardZ < 0 ? Math.min(1.15, size * 0.115) : size * 0.20;
    const scale = Math.min(1, limit / (Math.hypot(shiftX, shiftZ) || 1));
    smoothed.set(i, [x + shiftX * scale, z + shiftZ * scale]);
  }

  const rings = new Map(), profile = size === 10 ? CROWN_PROFILE : DISTANT_CROWN_PROFILE;
  for (const [i, [dx, dz]] of insets) {
    const [x, z] = smoothed.get(i) ?? [positions[i * 3], positions[i * 3 + 2]];
    const top = positions[i * 3 + 1];
    const height = top - terrainHeightAt(x, z);
    // The short edges between two diagonal cuts need a smaller inset.
    const radius = Math.max(0, Math.min(size * (i < side * side ? 0.30 : 0.15), height * 0.36));
    const scale = radius / (Math.hypot(dx, dz) || 1);
    const insetX = dx * scale, insetZ = dz * scale;
    const footX = x + insetX, footZ = z + insetZ;
    const ground = Math.min(top - 0.08, terrainHeightAt(footX, footZ) + 0.18);
    // Leave air below a single detached crown rather than putting a skirt all the way to the ground.
    const base = isolated.has(i) ? ground + (top - ground) * 0.38 : ground;
    positions[i * 3] = footX;
    positions[i * 3 + 2] = footZ;
    const ring = [i];
    // Roll out from the roof, then bend back in toward the ground.
    for (const [inset, drop, shade] of profile) {
      ring.push(positions.length / 3);
      positions.push(x + insetX * inset, top + (base - top) * drop, z + insetZ * inset);
      shades.push(shades[i] * shade);
    }
    rings.set(i, ring);
  }
  for (const [a, b] of walls) {
    const left = rings.get(a), right = rings.get(b);
    for (let j = 1; j < left.length; j++) {
      indices.push(left[j - 1], right[j - 1], left[j], left[j], right[j - 1], right[j]);
    }
  }

  for (const outline of outlines.values()) {
    for (let i = 0; i < outline.length; i++) outline[i] = rings.get(outline[i])?.[1] ?? outline[i];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('crownShade', new THREE.Float32BufferAttribute(shades, 1));
  const exterior = new Float32Array(positions.length / 3);
  if (buffered && playableBoundsOverlap && !playableBoundsOverlap(...bounds)) exterior.fill(1);
  else if (buffered && containsPlayablePoint && !playableBoundsCovered(...bounds)) {
    for (let i = 0; i < exterior.length; i++) {
      exterior[i] = Number(!containsPlayablePoint(positions[i * 3], positions[i * 3 + 2]));
    }
  }
  geometry.setAttribute('exteriorCanopy', new THREE.BufferAttribute(exterior, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, mask, outlines };
}

export function packLandscapeGeometry(geometry) {
  return {
    attributes: Object.entries(geometry.attributes).map(([name, { array, itemSize, normalized }]) =>
      ({ name, array, itemSize, normalized })),
    index: geometry.index.array,
    center: geometry.boundingSphere.center.toArray(),
    radius: geometry.boundingSphere.radius,
  };
}

export function restoreLandscapeGeometry({ attributes, index, center, radius }) {
  const geometry = new THREE.BufferGeometry();
  for (const { name, array, itemSize, normalized } of attributes) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3().fromArray(center), radius);
  return geometry;
}
