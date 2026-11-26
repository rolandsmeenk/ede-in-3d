import { edeBounds, edePoints } from './ede-surface-geometry.js';
import { BICYCLE, FOOT, MOTOR } from './road-access.js?v=20261122-startup';
import { osmRoadMaterial } from './ede-road-surfaces.js';

const MAX_SPAN = 45, MAX_WIDTH = 9;
const PATH_KINDS = new Set(['footway', 'cycleway', 'path', 'pedestrian', 'bridleway']);
const BRIDGE_SURFACES = {
  asphalt: 'bridgeAsphalt', wood: 'bridgeWood', boards: 'bridgeWood', metal: 'bridgeMetal',
  concrete: 'deck', brick: 'bridgeBrick', block: 'bridgePaving', tile: 'bridgePaving',
  gravel: 'bridgeGravel', sand: 'bridgeEarth',
};
const BRIDGE_STRUCTURES = { wood: 'bridgeWood', metal: 'bridgeMetal', concrete: 'deck', masonry: 'bridgeBrick' };

function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}

function bridgeFrame([x, z, ex, ez]) {
  const length = Math.hypot(ex - x, ez - z);
  const ux = (ex - x) / length, uz = (ez - z) / length;
  return { length, ux, uz, along: p => (p.x - x) * ux + (p.z - z) * uz,
    across: p => (p.z - z) * ux - (p.x - x) * uz,
    point: (s, t) => ({ x: x + s * ux - t * uz, z: z + s * uz + t * ux }) };
}

export function matchSmallBridgeDecks(structures, roads, railways, materials = {}) {
  const routes = [...roads, ...railways].filter(way => (way.bridge || way.layer > 0) && !way.tunnel).map(way => {
    const points = edePoints(way.pts);
    const access = way.modes?.reduce((mask, modes) => mask | modes, 0);
    const active = PATH_KINDS.has(way.kind) && (access === undefined || (access & (FOOT | BICYCLE)) && !(access & MOTOR));
    return { way, points, active, bounds: edeBounds(points) };
  });
  const decks = new Map();
  for (const feature of structures) {
    if (feature.kind !== 'deck' || !feature.axis) continue;
    const frame = bridgeFrame(feature.axis);
    if (frame.length < 2 || frame.length > MAX_SPAN) continue;
    const polygons = feature.polygons.map(polygon => polygon.map(edePoints));
    const vertices = polygons.flatMap(([outer]) => outer);
    const across = vertices.map(frame.across);
    if (Math.max(...across) - Math.min(...across) > MAX_WIDTH) continue;
    const bounds = edeBounds(vertices);
    const contains = (x, z) => polygons.some(([outer, ...holes]) =>
      insideRing(outer, x, z) && !holes.some(hole => insideRing(hole, x, z)));
    const matching = [];
    for (const { way, points, active, bounds: b } of routes) {
      if ((way.layer || 1) !== feature.layer || b.maxX < bounds.minX || b.minX > bounds.maxX ||
          b.maxZ < bounds.minZ || b.minZ > bounds.maxZ) continue;
      let overlap = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], p = points[i], dx = p.x - a.x, dz = p.z - a.z;
        const length = Math.hypot(dx, dz);
        const samples = Math.ceil(length / 1.5);
        for (let j = 0; j < samples; j++) {
          const t = (j + 0.5) / samples;
          if (contains(a.x + dx * t, a.z + dz * t)) overlap += length / samples;
        }
      }
      if (overlap >= Math.min(2, frame.length * 0.35)) matching.push({ way, active, overlap });
    }
    if (!matching.length || matching.some(route => !route.active)) continue;
    matching.sort((a, b) => b.overlap - a.overlap);
    const survey = materials[feature.ids[0]];
    const structure = Object.hasOwn(BRIDGE_STRUCTURES, survey?.material) ? BRIDGE_STRUCTURES[survey.material] : 'deck';
    const finish = matching.map(({ way }) => osmRoadMaterial(way) ?? way.surface)
      .find(surface => Object.hasOwn(BRIDGE_SURFACES, surface));
    const material = finish ? BRIDGE_SURFACES[finish] : structure;
    decks.set(feature, { wayIds: matching.map(({ way }) => way.id), contains, material, structure, survey,
      exposedDecking: material === 'bridgeWood' || material === 'bridgeMetal' });
  }
  return decks;
}

export function buildSmallBridge({ rings, axis, surface, material, structure, thickness }, { slab, beam, append, addCollider }) {
  const frame = bridgeFrame(axis);
  const wood = material === 'bridgeWood';
  thickness ??= structure === 'bridgeWood' || structure === 'bridgeMetal' ? 0.23 : 0.30;
  slab(material, rings, surface, (x, z) => surface(x, z) - thickness,
    { solid: false, underside: true, side: structure, undersideMaterial: structure });

  if (wood) {
    const along = rings[0].map(frame.along);
    for (let s = Math.min(...along) + 0.16; s < Math.max(...along); s += 0.24) {
      const ends = [];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length], u = frame.along(a), v = frame.along(b);
          if ((u > s) !== (v > s)) ends.push(frame.across(a) + (frame.across(b) - frame.across(a)) * (s - u) / (v - u));
        }
      }
      ends.sort((a, b) => a - b);
      const at = (u, v) => {
        const { x, z } = frame.point(u, v);
        return [x, surface(x, z) + 0.006, z];
      };
      for (let i = 0; i + 1 < ends.length; i += 2) {
        const a = ends[i] + 0.02, b = ends[i + 1] - 0.02;
        if (b <= a) continue;
        const p = at(s, a), q = at(s, b), r = at(s + 0.009, b), t = at(s + 0.009, a);
        append('bridgeWoodJoint', [...p, ...q, ...r, ...p, ...r, ...t], p[0], p[2]);
      }
    }
  }

  // The footprint fixes the rail position. Railing dimensions are estimates.
  const ring = rings[0], builtPosts = new Set();
  const clockwise = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return sum + a.x * b.z - a.z * b.x;
  }, 0) < 0;
  const railHeight = 1.05;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < 0.18 || Math.abs(dx * frame.ux + dz * frame.uz) < length * 0.55) continue;
    const sign = clockwise ? -1 : 1, nx = -dz * sign / length, nz = dx * sign / length;
    const point = (t, inward = 0.045) => ({ x: a.x + dx * t + nx * inward, z: a.z + dz * t + nz * inward });
    const coordinate = ({ x, z }, y) => [x, surface(x, z) + y, z];
    const panels = Math.ceil(length / 2);
    for (let j = 0; j <= panels; j++) {
      const p = point(j / panels);
      const key = `${Math.round(p.x * 10)}/${Math.round(p.z * 10)}`;
      if (builtPosts.has(key)) continue;
      builtPosts.add(key);
      beam('bridgeRail', coordinate(p, 0), coordinate(p, railHeight), 0.033);
    }
    const infill = Math.ceil(length / 0.2);
    for (let j = 0; j < infill; j++) {
      const p = point((j + 0.5) / infill);
      beam('bridgeRail', coordinate(p, 0.17), coordinate(p, railHeight), 0.012);
    }
    for (let j = 0; j < panels; j++) {
      const p = point(j / panels), q = point((j + 1) / panels);
      for (const [y, radius] of [[railHeight, 0.037], [0.17, 0.023]]) {
        beam('bridgeRail', coordinate(p, y), coordinate(q, y), radius);
      }
      const outline = [point(j / panels, 0), point((j + 1) / panels, 0),
        point((j + 1) / panels, 0.09), point(j / panels, 0.09)];
      const start = surface(p.x, p.z), end = surface(q.x, q.z);
      addCollider(outline, [], Math.min(start, end), Math.max(start, end) + railHeight, 'bridge-railing',
        (x, z) => surface(x, z) + railHeight, surface);
    }
  }
}
