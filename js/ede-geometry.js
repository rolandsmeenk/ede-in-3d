import * as THREE from 'three/webgpu';
import { EDE_DATA } from './city-config.js';
import { getExpansionTerrain, getExpansionTerrainPatch, getTerrain, getTerrainPatch, getTerrainPatches, terrainHeightAt } from './terrain.js';
import { hasEdeMappedSurface, isEdeTrafficPavement } from './ede-road-surfaces.js';
import { clipEdeGround, gradeCuts, localGradeSurface, RAIL_BALLAST_WIDTH, RAIL_SLEEPER_SPACING, terrainGradeCuts } from './ede-grade.js';

import { nearestRoadInCells } from './ede-road-cell-query.js';
import { drapeSurface, edeBounds, edeGeometryGroups, edePoints, edeSpatialGroups, EDE_RENDER_CELL, emitSurface, makeSurfaceGeometry, overlaps, polygonGeometry } from './ede-surface-geometry.js';

const surfaceTerrain = { getTerrain, getExpansionTerrain, getExpansionTerrainPatch, getTerrainPatch, terrainHeightAt };
const surfaceGrade = { gradeCuts, localGradeSurface, clipEdeGround };

// Geometry adapters only: rendering stays in the upstream WebGPU/TSL systems.
export { edePoints, edeBounds, edeGeometryGroups, edeSpatialGroups, EDE_RENDER_CELL };

export function edePolygonGeometry(ring, holes, y) {
  return polygonGeometry(THREE, ring, holes, y);
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

export function edeRailStrip(sections, halfWidth, lift, offset = 0) {
  const positions = [], indices = [], uv = [];
  const edges = [offset - halfWidth, offset + halfWidth].map(side => side / RAIL_BALLAST_WIDTH + 0.5);
  for (const { a, b } of sections) {
    const vertex = positions.length / 3;
    for (const { left, right, distance, y } of [a, b]) {
      for (const t of edges) {
        positions.push(left.x + (right.x - left.x) * t, y + lift, left.z + (right.z - left.z) * t);
        uv.push(t, distance / RAIL_SLEEPER_SPACING + 0.5);
      }
    }
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
  }
  return surfaceGeometry(positions, indices, uv);
}

export const EDE_PEDESTRIAN_WAYS = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway', 'bridleway']);
let segments;
let roadIndex;
export function edeRoadSegments() {
  if (segments) return segments;
  segments = [];
  roadIndex = new Map();
  for (const road of EDE_DATA.roads || []) {
    if (!road.pts || road.tunnel && !(road.tunnelType === 'building_passage' && road.layer <= 0)) continue;
    const points = edePoints(road.pts);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.8) continue;
      const s = { a, b, len, road, segmentIndex: i - 1, width: road.bgtWidth ?? road.bgt?.width ?? road.width ?? 6, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
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

export function nearestEdeRoad(x, z, reach = 40, wayId, layer) {
  edeRoadSegments();
  return nearestRoadInCells(roadIndex, x, z, reach, wayId, layer);
}

export function edeRoadCells({ minX, minZ, maxX, maxZ }, reach) {
  edeRoadSegments();
  const cells = new Map();
  for (let x = Math.floor((minX - reach) / 64); x <= Math.floor((maxX + reach) / 64); x++) {
    for (let z = Math.floor((minZ - reach) / 64); z <= Math.floor((maxZ + reach) / 64); z++) {
      const key = `${x}/${z}`;
      if (roadIndex.has(key)) cells.set(key, roadIndex.get(key));
    }
  }
  return cells;
}

let generatedTravel;
const TRAVEL_CELL = 32;
const CIRCLE_PROBES = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [-0.707, -0.707], [0.707, -0.707]];

// Test the same traffic paving that the world draws, including OSM strips where BGT has gaps.
export function overlapsEdeTravelPavement(x, z, layer = 0, radius = 0) {
  if (isEdeTrafficPavement(x, z, layer) || radius > 0 && CIRCLE_PROBES.some(([dx, dz]) =>
    isEdeTrafficPavement(x + dx * radius, z + dz * radius, layer))) return true;
  if (!generatedTravel) {
    generatedTravel = new Map();
    for (const segment of edeRoadSegments()) {
      if (segment.pedestrian && segment.road.kind !== 'cycleway' || hasEdeMappedSurface(segment)) continue;
      const { a, b, width, road } = segment;
      const pad = Math.max(0.75, width / 2) + 1;
      for (let i = Math.floor((Math.min(a.x, b.x) - pad) / TRAVEL_CELL);
        i <= Math.floor((Math.max(a.x, b.x) + pad) / TRAVEL_CELL); i++) {
        for (let j = Math.floor((Math.min(a.z, b.z) - pad) / TRAVEL_CELL);
          j <= Math.floor((Math.max(a.z, b.z) + pad) / TRAVEL_CELL); j++) {
          const key = `${road.layer ?? 0}/${i}/${j}`;
          if (!generatedTravel.has(key)) generatedTravel.set(key, []);
          generatedTravel.get(key).push(segment);
        }
      }
    }
  }
  const cell = generatedTravel.get(`${layer}/${Math.floor(x / TRAVEL_CELL)}/${Math.floor(z / TRAVEL_CELL)}`);
  return cell?.some(({ a, ux, uz, len, width, pedestrian }) => {
    const dx = x - a.x, dz = z - a.z;
    const along = dx * ux + dz * uz;
    const half = pedestrian ? Math.max(0.75, width / 2) : width / 2;
    const across = Math.abs(dz * ux - dx * uz);
    return Math.hypot(Math.max(0, -along, along - len), Math.max(0, across - half)) <= radius;
  }) ?? false;
}

function surfaceGeometry(positions, indices, uv) {
  return makeSurfaceGeometry(THREE, positions, indices, uv);
}

export function edeWaterCut(geometry) {
  const points = geometry.getAttribute('position');
  const cuts = [];
  for (let i = 0; i < geometry.index.count; i += 3) {
    const triangle = [i, i + 1, i + 2].map(offset => {
      const index = geometry.index.getX(offset);
      return { x: points.getX(index), z: points.getZ(index) };
    });
    const [a, b, c] = triangle;
    const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(area) <= 1e-7) continue;
    const sign = Math.sign(area);
    const planes = triangle.map((a, j) => {
      const b = triangle[(j + 1) % 3];
      const nx = a.z - b.z, nz = b.x - a.x;
      return [nx * sign, nz * sign, (nx * a.x + nz * a.z) * sign];
    });
    cuts.push({ ...edeBounds(triangle), planes });
  }
  return cuts;
}

export function edeWaterBanks(rings, bottomY) {
  const positions = [], indices = [];
  for (const [index, points] of rings.entries()) {
    const area = points.reduce((sum, a, i) => {
      const b = points[(i + 1) % points.length];
      return sum + a.x * b.z - b.x * a.z;
    }, 0);
    const ring = (area > 0) === (index === 0) ? points : [...points].reverse();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const steps = Math.ceil(Math.hypot(dx, dz));
      if (!steps) continue;
      for (let j = 0; j <= steps; j++) {
        const x = a.x + dx * j / steps, z = a.z + dz * j / steps;
        const vertex = positions.length / 3;
        positions.push(x, terrainHeightAt(x, z) - 0.015, z, x, bottomY, z);
        if (j < steps) indices.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3);
      }
    }
  }
  return surfaceGeometry(positions, indices);
}

function* terrainGridGeometries({ columns, rows, minX, minZ, step, heights }, y, coarse = false, waterCuts = []) {
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
      const x = positions[offset], z = positions[offset + 2];
      if (i + 1 < width && j + 1 < height && !(coarse && getTerrainPatch(x, z))) {
        indices.push(a, a + width, a + 1, a + 1, a + width, a + width + 1);
      }
    }
    const bounds = {
      minX: minX + col * step, maxX: minX + (col + width - 1) * step,
      minZ: minZ + row * step, maxZ: minZ + (row + height - 1) * step
    };
    const grade = terrainGradeCuts(bounds);
    const cuts = grade.concat(waterCuts.filter(cut => overlaps(bounds, cut)));
    if (!cuts.length) {
      yield surfaceGeometry(positions, indices);
      continue;
    }
    const clipped = grade.length ? [] : Array.from(positions);
    const clippedIndices = grade.length ? null : [];
    for (let i = 0; i < indices.length; i += 3) {
      const vertices = indices.slice(i, i + 3);
      const triangle = vertices.map(v => ({
        x: positions[v * 3], y: positions[v * 3 + 1], z: positions[v * 3 + 2]
      }));
      const parts = clipEdeGround(triangle, cuts);
      if (clippedIndices && parts.length === 1 && parts[0] === triangle) {
        clippedIndices.push(...vertices);
      } else {
        const start = clipped.length / 3;
        for (const part of parts) emitSurface(part, clipped, terrainHeightAt);
        if (clippedIndices) for (let j = start; j < clipped.length / 3; j++) clippedIndices.push(j);
      }
    }
    yield surfaceGeometry(clipped, clippedIndices);
  }
}

export function* edeTerrainGeometries(y, waterCuts) {
  const terrain = getTerrain();
  const { columns, rows, minX, minZ, maxX, maxZ, step, minY } = terrain;
  yield* terrainGridGeometries(terrain, y, true, waterCuts);
  for (const patch of getTerrainPatches()) yield* terrainGridGeometries(patch, y, false, waterCuts);
  if (getExpansionTerrain()) return;
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

export function drapeEdeSurface(geometry, cutGrade = false, wayId, mappedPavement = false, keepAttribute) {
  return drapeSurface(THREE, surfaceTerrain, surfaceGrade, geometry, cutGrade, wayId, mappedPavement, keepAttribute);
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
