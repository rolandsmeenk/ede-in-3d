import { EDE_DATA } from './ede-geodata.js';
import { SCHAARSBERGEN_TRAVEL_RING } from './ede-white-bike-sites.js';

export const playableBoundary = EDE_DATA.meta.playableBoundary ?? [];
const baseTravelBoundary = EDE_DATA.meta.travelBoundary ?? playableBoundary;
export const travelBoundary = EDE_DATA.meta.fullMunicipality
  ? [...baseTravelBoundary, [SCHAARSBERGEN_TRAVEL_RING]] : baseTravelBoundary;
const band = z => Math.floor(z / 128);
const boundsBands = new Map(), ringBands = new Map();
function indexEdge(bands, edge) {
  const first = band(Math.min(edge[1], edge[3])), last = band(Math.max(edge[1], edge[3]));
  for (let row = first; row <= last; row++) {
    if (!bands.has(row)) bands.set(row, []);
    bands.get(row).push(edge);
  }
}
function ringEdges(ring) {
  const result = [];
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    result.push([ring[j], ring[j + 1], ring[i], ring[i + 1]]);
  }
  return result;
}
function indexBoundary(boundary, bounds) {
  const edges = [];
  for (const polygon of boundary) for (const ring of polygon) {
    const bands = new Map();
    ringBands.set(ring, bands);
    for (const edge of ringEdges(ring)) {
      edges.push(edge);
      indexEdge(bands, edge);
      if (bounds) indexEdge(bounds, edge);
    }
  }
  return edges;
}

const edges = indexBoundary(playableBoundary, boundsBands);
const travelEdges = travelBoundary === playableBoundary ? edges : indexBoundary(travelBoundary);

function crossing(x, z, ax, az, bx, bz) {
  if (x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && z >= Math.min(az, bz) && z <= Math.max(az, bz)
    && Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) < 1e-6) return 2;
  return Number((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax);
}

function inRing(x, z, ring) {
  let inside = 0;
  const indexed = ringBands.get(ring);
  for (const [ax, az, bx, bz] of indexed ? (indexed.get(band(z)) ?? []) : ringEdges(ring)) {
    const hit = crossing(x, z, ax, az, bx, bz);
    if (hit === 2) return 2;
    inside ^= hit;
  }
  return inside;
}

function inBoundary(x, z, boundary) {
  return boundary.some(([outer, ...holes]) => inRing(x, z, outer) > 0 && !holes.some(hole => inRing(x, z, hole) === 1));
}

function touchesBounds(minX, minZ, maxX, maxZ) {
  for (let row = band(minZ); row <= band(maxZ); row++) {
    for (const [ax, az, bx, bz] of boundsBands.get(row) ?? []) {
      if (Math.max(ax, bx) >= minX && Math.min(ax, bx) <= maxX && Math.max(az, bz) >= minZ && Math.min(az, bz) <= maxZ) return true;
    }
  }
  return false;
}

const core = EDE_DATA.meta.baseBounds;
const coveredCore = core && inBoundary(core[0], core[1], playableBoundary) && !touchesBounds(...core) ? core : null;

export function containsPlayablePoint(x, z, boundary = playableBoundary) {
  if (!boundary.length) return true;
  if (boundary === playableBoundary && coveredCore &&
      x > coveredCore[0] && x < coveredCore[2] && z > coveredCore[1] && z < coveredCore[3]) return true;
  return inBoundary(x, z, boundary);
}

export function playableBoundsOverlap(minX, minZ, maxX, maxZ) {
  return containsPlayablePoint(minX, minZ) || touchesBounds(minX, minZ, maxX, maxZ);
}

export function playableBoundsCovered(minX, minZ, maxX, maxZ) {
  return containsPlayablePoint(minX, minZ) && !touchesBounds(minX, minZ, maxX, maxZ);
}

export const containsTravelPoint = (x, z) =>
  containsPlayablePoint(x, z) || containsPlayablePoint(x, z, travelBoundary);

export function constrainToPlayableArea(x, z) {
  return constrain(x, z, containsPlayablePoint, edges);
}

export function constrainToTravelArea(x, z) {
  return constrain(x, z, containsTravelPoint, travelEdges);
}

function constrain(x, z, contains, edges) {
  if (contains(x, z)) return { x, z };
  let best = Infinity, nearest;
  for (const [ax, az, bx, bz] of edges) {
    const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
    if (length2 <= 0) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2));
    const px = ax + t * dx, pz = az + t * dz;
    const distance = (px - x) ** 2 + (pz - z) ** 2;
    if (distance < best) {
      best = distance;
      nearest = [px, pz, dx / Math.sqrt(length2) * 0.15, dz / Math.sqrt(length2) * 0.15];
    }
  }
  const [px, pz, dx, dz] = nearest;
  for (const [nx, nz] of [[px - dz, pz + dx], [px + dz, pz - dx]]) {
    if (contains(nx, nz)) return { x: nx, z: nz };
  }
  return { x: px, z: pz };
}
