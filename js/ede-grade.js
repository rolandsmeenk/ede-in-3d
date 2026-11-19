import { terrainHeightAt } from './terrain.js';

const CELL = 48;
const STEP_HEIGHT = 1.7;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const cellKey = (x, z) => `${x}/${z}`;
let world = { sites: [], railHeights: [] };
let segments = new Map();
let profiles = new Map();
let ways = new Map();
let tracks = new Map();
let cuts = new Map();
let roofs = new Map();
let wayCuts = new Map();
const platformCells = new Map(), structureRoofs = new Map();

const modeGroup = mode => mode === 'person' ? 'foot'
  : ['cyclist', 'cargobike', 'bicycle', 'cycleway'].includes(mode) ? 'bike'
    : ['car', 'van', 'bus'].includes(mode) ? 'motor' : mode;

function coveredRanges(profile) {
  const { covered } = profile;
  return !covered?.length ? [] : typeof covered[0] === 'number' ? [covered] : covered;
}

function calculateSegments(profile) {
  const spans = [];
  let at = 0;
  for (let i = 1; i < profile.points.length; i++) {
    const [x, z, y] = profile.points[i - 1];
    const [endX, endZ, endY] = profile.points[i];
    const length = Math.hypot(endX - x, endZ - z);
    if (length < 0.01) continue;
    const dx = (endX - x) / length, dz = (endZ - z) / length;
    spans.push({ at, x, z, y, endX, endZ, endY, dx, dz, length, profile });
    at += length;
  }
  return spans;
}

function addWay(map, wayId, spans) {
  if (!map.has(wayId)) map.set(wayId, []);
  map.get(wayId).push(...spans);
}

function indexCut(index, cut) {
  for (let x = Math.floor(cut.minX / CELL); x <= Math.floor(cut.maxX / CELL); x++) {
    for (let z = Math.floor(cut.minZ / CELL); z <= Math.floor(cut.maxZ / CELL); z++) {
      const key = cellKey(x, z);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(cut);
    }
  }
}

export function setEdeGrade(data) {
  const nextSegments = new Map(), nextProfiles = new Map(), nextWays = new Map(), nextTracks = new Map();
  const nextCuts = new Map(), nextRoofs = new Map();
  const nextWayCuts = new Map();
  for (const site of data.sites) {
    for (const entry of site.profiles || []) {
      if (!(entry.width > 0) || !entry.points.every(point => point.length === 3 && point.every(Number.isFinite))) {
        throw new Error(`Invalid grade profile ${entry.id}`);
      }
      const profile = { ...entry, site, half: entry.width / 2, covers: coveredRanges(entry) };
      const spans = calculateSegments(profile);
      nextProfiles.set(profile.id, spans);
      for (const id of entry.wayIds || []) addWay(nextWays, id, spans);
      if (site.kind !== 'level') {
        const outline = gradeSections(entry).map(sectionCut);
        for (const id of entry.wayIds || []) addWay(nextWayCuts, id, outline);
      }
      for (const span of spans) {
        const pad = profile.half + 1;
        const minX = Math.floor((Math.min(span.x, span.endX) - pad) / CELL);
        const maxX = Math.floor((Math.max(span.x, span.endX) + pad) / CELL);
        const minZ = Math.floor((Math.min(span.z, span.endZ) - pad) / CELL);
        const maxZ = Math.floor((Math.max(span.z, span.endZ) + pad) / CELL);
        for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
          const key = cellKey(x, z);
          if (!nextSegments.has(key)) nextSegments.set(key, []);
          nextSegments.get(key).push(span);
        }
      }
    }
    if (site.kind !== 'underpass' && !site.excavation) continue;
    for (const entry of site.excavation ? [site.excavation] : site.profiles) {
      for (const section of gradeSections(entry)) {
        const cut = sectionCut(section);
        if (section.covered && site.kind === 'underpass') {
          const { a, b } = section;
          const dx = b.x - a.x, dz = b.z - a.z;
          indexCut(nextRoofs, { ...cut, a, b, dx, dz, runSquared: dx * dx + dz * dz,
            clearance: entry.clearance || site.clearance || 3 });
        }
        if (!section.covered || site.cutCoveredTerrain) indexCut(nextCuts, cut);
      }
    }
  }
  for (const profile of data.railHeights || []) {
    if (profile.points?.length > 1) addWay(nextTracks, profile.wayId, calculateSegments(profile));
    // The coarse terrain can bury measured station ballast. Cut only its
    // narrow footprint, preserving the terrain between parallel tracks.
    if (profile.source?.startsWith('ProRail')) {
      for (const section of gradeSections({ ...profile, width: 2.9 })) indexCut(nextCuts, sectionCut(section));
    }
  }
  world = data;
  segments = nextSegments;
  profiles = nextProfiles;
  ways = nextWays;
  tracks = nextTracks;
  cuts = nextCuts;
  roofs = nextRoofs;
  wayCuts = nextWayCuts;
  return data;
}

export async function loadEdeGrade() {
  const response = await fetch(new URL('../assets/ede-grade.json', import.meta.url));
  if (!response.ok) throw new Error(`Ede grade data returned HTTP ${response.status}`);
  return setEdeGrade(await response.json());
}

export const getEdeGrade = () => world;
export const isGradeWay = (wayId) => ways.has(wayId);

export function setEdePlatforms(platforms) {
  platformCells.clear();
  for (const platform of platforms) {
    const { minX, minZ, maxX, maxZ } = boundsOf(platform.outer);
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        const key = cellKey(x, z);
        if (!platformCells.has(key)) platformCells.set(key, []);
        platformCells.get(key).push(platform);
      }
    }
  }
}

export function setEdeStructureRoofs(covers) {
  structureRoofs.clear();
  for (const cover of covers) indexCut(structureRoofs, cover);
}

function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function platformAt(x, z, referenceY) {
  const candidates = platformCells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
  for (const { id, outer, holes, height } of candidates) {
    if (!insideRing(outer, x, z) || holes.some(ring => insideRing(ring, x, z))) continue;
    const y = height(x, z);
    if (Number.isFinite(referenceY) && Math.abs(referenceY - y) > STEP_HEIGHT) continue;
    return { id, site: id, kind: 'platform', y, roof: Infinity };
  }
  return null;
}

function nearestSpan(spans, x, z, { mode, kind, referenceY, reach = 0.3, heading } = {}) {
  let picked = null, best = Infinity;
  const useMode = modeGroup(mode);
  for (const span of spans) {
    const { profile } = span;
    if (useMode && !profile.modes.includes(useMode)) continue;
    if (kind && profile.site?.kind !== kind) continue;
    const raw = (x - span.x) * span.dx + (z - span.z) * span.dz;
    const along = clamp(raw, 0, span.length);
    const lateral = -(x - span.x) * span.dz + (z - span.z) * span.dx;
    const distance = Math.hypot(raw - along, lateral);
    if (distance > (profile.half ?? 0) + reach) continue;
    const y = span.y + (span.endY - span.y) * along / span.length;
    const delta = Number.isFinite(referenceY) ? Math.abs(referenceY - y) : 0;
    if (delta > STEP_HEIGHT) continue;
    const alignment = Number.isFinite(heading) ? Math.abs(Math.sin(heading) * span.dx + Math.cos(heading) * span.dz) : 1;
    const score = distance + 2 * delta + (1 - alignment) * 5;
    if (score >= best) continue;
    best = score;
    picked = { span, y, along, lateral, distance, delta };
  }
  return picked;
}

export function gradeProfileAt(x, z, mode, heading, referenceY, profileId) {
  if (!segments.size && !platformCells.size) return null;
  const cell = segments.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  const explicit = profileId && (profiles.get(profileId) || ways.get(profileId));
  const hit = nearestSpan(explicit || cell || [], x, z, { mode, heading, referenceY });
  if (!hit) return modeGroup(mode) === 'foot' && !profileId ? platformAt(x, z, referenceY) : null;
  const { span, y, along, lateral } = hit;
  const { profile } = span;
  const s = span.at + along;
  const covered = profile.covers.some(([from, to]) => s >= from && s <= to);
  return { id: profile.id, site: profile.site.id, kind: profile.site.kind, y, lateral,
    roof: covered ? y + (profile.clearance || profile.site.clearance || 3) : Infinity };
}

export function isUnderEdeRoof(x, y, z) {
  const cell = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
  const covered = roofs.get(cell)?.some(({ planes, a, b, dx, dz, runSquared, clearance }) => {
    if (!planes.every(([nx, nz, c]) => nx * x + nz * z >= c - 1e-8)) return false;
    const progress = clamp(((x - a.x) * dx + (z - a.z) * dz) / runSquared, 0, 1);
    const floor = a.y + (b.y - a.y) * progress;
    return y >= floor - 0.25 && y <= floor + clearance;
  });
  return covered || (structureRoofs.get(cell)?.some(({ outer, holes, height }) =>
    insideRing(outer, x, z) && !holes.some(ring => insideRing(ring, x, z)) && y <= height(x, z)) ?? false);
}

export function gradeHeightAt(x, z, referenceY, mode = 'motor', profileId) {
  return gradeProfileAt(x, z, mode, undefined, referenceY, profileId)?.y ?? terrainHeightAt(x, z);
}

export function gradeWayAt(wayId, x, z, extra = 0.3) {
  return nearestSpan(ways.get(wayId) || [], x, z, { reach: extra });
}

export function railHeightAt(wayId, x, z) {
  return nearestSpan(tracks.get(wayId) || [], x, z, { reach: 2 })?.y;
}

export function nearbyRailHeightAt(x, z, reach = 5) {
  let nearest = null;
  for (const spans of tracks.values()) {
    const hit = nearestSpan(spans, x, z, { reach });
    if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
  }
  return nearest?.y;
}

export function gradeDeckAt(x, z) {
  const cell = segments.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  return nearestSpan(cell || [], x, z, { kind: 'bridge' })?.y;
}

export function gradeSections(entry, spacing = 6) {
  const covers = coveredRanges(entry);
  const spans = calculateSegments(entry);
  const border = covers.flat();
  const centers = [];
  for (const span of spans) {
    const subdivisions = Math.ceil(span.length / spacing);
    const marks = Array.from({ length: subdivisions }, (_, i) => span.at + i * span.length / subdivisions);
    for (const limit of border) if (limit > span.at && limit < span.at + span.length) marks.push(limit);
    for (const distance of [...new Set(marks)].sort((a, b) => a - b)) {
      const step = distance - span.at;
      centers.push({
        x: span.x + span.dx * step, z: span.z + span.dz * step,
        y: span.y + (span.endY - span.y) * step / span.length, distance
      });
    }
  }
  const last = spans.at(-1);
  if (!last) return [];
  centers.push({ x: last.endX, z: last.endZ, y: last.endY, distance: last.at + last.length });
  const half = entry.width / 2;
  for (const [i, p] of centers.entries()) {
    const prev = centers[i - 1] || p, next = centers[i + 1] || p;
    const a = Math.hypot(p.x - prev.x, p.z - prev.z) || 1;
    const b = Math.hypot(next.x - p.x, next.z - p.z) || 1;
    const nx = (prev.z - p.z) / a + (p.z - next.z) / b;
    const nz = (p.x - prev.x) / a + (next.x - p.x) / b;
    const length = Math.hypot(nx, nz) || 1;
    const width = half * clamp(2 / length, 1, 1.4);
    const offset = i === 0 || i === centers.length - 1 ? half : width;
    p.left = { x: p.x - offset * nx / length, z: p.z - offset * nz / length, y: p.y };
    p.right = { x: p.x + offset * nx / length, z: p.z + offset * nz / length, y: p.y };
  }
  return centers.slice(1).map((b, i) => {
    const a = centers[i], middle = (a.distance + b.distance) / 2;
    return { a, b, covered: covers.some(([from, to]) => middle > from && middle < to) };
  });
}

const boundsOf = (points) => ({
  minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
  minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z))
});
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

function sectionCut({ a, b }) {
  const polygon = [a.left, a.right, b.right, b.left];
  const sign = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return sum + p.x * q.z - p.z * q.x;
  }, 0) < 0 ? -1 : 1;
  const planes = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const nx = -(q.z - p.z) * sign, nz = (q.x - p.x) * sign;
    return [nx, nz, nx * p.x + nz * p.z];
  });
  return { ...boundsOf(polygon), planes };
}

export function gradeCuts(bounds, wayId) {
  const outlines = (wayCuts.get(wayId) || []).filter(cut => overlaps(bounds, cut));
  if (!cuts.size) return outlines;
  const result = new Set(outlines);
  for (let x = Math.floor(bounds.minX / CELL); x <= Math.floor(bounds.maxX / CELL); x++) {
    for (let z = Math.floor(bounds.minZ / CELL); z <= Math.floor(bounds.maxZ / CELL); z++) {
      for (const cut of cuts.get(cellKey(x, z)) || []) if (overlaps(bounds, cut)) result.add(cut);
    }
  }
  return [...result];
}

function clip(poly, nx, nz, c, direction) {
  const result = [];
  if (!poly.length) return result;
  let a = poly.at(-1), da = (nx * a.x + nz * a.z - c) * direction;
  for (const b of poly) {
    const db = (nx * b.x + nz * b.z - c) * direction;
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        y: a.y + (b.y - a.y) * t });
    }
    if (db >= 0) result.push(b);
    a = b;
    da = db;
  }
  return result;
}

export function clipEdeGround(polygon, candidates) {
  let remaining = [polygon];
  const bounds = boundsOf(polygon);
  for (const cut of candidates) {
    if (!overlaps(bounds, cut)) continue;
    const outside = [];
    for (const element of remaining) {
      let inside = element;
      for (const [nx, nz, c] of cut.planes) inside = clip(inside, nx, nz, c, 1);
      if (inside.length < 3) {
        outside.push(element);
        continue;
      }
      let fragment = element;
      for (const [nx, nz, c] of cut.planes) {
        const side = clip(fragment, nx, nz, c, -1);
        if (side.length >= 3) outside.push(side);
        fragment = clip(fragment, nx, nz, c, 1);
      }
    }
    remaining = outside;
    if (!remaining.length) break;
  }
  return remaining;
}

export function constrainEdeCamera(entity, position, clearance = 0.55) {
  const { x, z } = position;
  if (entity.type !== 'helicopter') {
    const at = gradeProfileAt(entity.position.x, entity.position.z, entity.type, entity.heading, entity.position.y);
    if (at?.kind === 'underpass' && (Number.isFinite(at.roof) || at.y < terrainHeightAt(entity.position.x, entity.position.z) - 0.65)) {
      const hit = nearestSpan(profiles.get(at.id), x, z, { reach: 24 });
      if (hit) {
        const { span, along, lateral, y } = hit;
        const { profile } = span;
        const side = clamp(lateral, -profile.half + 0.45, profile.half - 0.45);
        position.x = span.x + span.dx * along - span.dz * side;
        position.z = span.z + span.dz * along + span.dx * side;
        const covered = profile.covers.some(([from, to]) => span.at + along >= from && span.at + along <= to);
        const roof = covered ? y + (profile.clearance || profile.site.clearance || 3) - 0.25 : Infinity;
        position.y = clamp(position.y, y + clearance, roof);
        return;
      }
    }
  }
  const deck = gradeDeckAt(x, z);
  const onDeck = deck !== undefined && (entity.type === 'helicopter' || entity.position.y >= deck - 1.2);
  const platform = entity.type === 'person' ? platformAt(x, z, entity.position.y)?.y : undefined;
  position.y = Math.max(position.y, (onDeck ? deck : platform ?? terrainHeightAt(x, z)) + clearance);
}
