import { EDE_DATA } from './ede-geodata.js';
import { MOTOR } from './road-access.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const CELL = 48;
const RAIL_LOOKUP_REACH = 32;
const STEP_HEIGHT = 1.7;
export const RAIL_BALLAST_WIDTH = 2.9;
export const RAIL_BALLAST_TOP = 0.035;
export const RAIL_SLEEPER_SPACING = 0.65;
export const RAIL_TOP = 0.13;
export const CHE_BRIDGE_SOFFIT = -1.80;
export const ENKA_PORTAL_SOFFIT = 4.60;
// The landmark models supply the physical portals for these mapped ways.
const MODELED_PASSAGE_SOFFITS = {
  w961378352: CHE_BRIDGE_SOFFIT,
  w494663072: ENKA_PORTAL_SOFFIT,
  w494663075: ENKA_PORTAL_SOFFIT,
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const cellKey = (x, z) => `${x}/${z}`;
let world = { sites: [], railHeights: [] };
let segments = new Map();
let profiles = new Map();
let ways = new Map();
let localSurfaceWays = new Map();
let localSurfaces = [];
let tracks = new Map();
let nearbyTracks = new Map();
let railCorridors = new Map();
let corridorSpans = new Map();
let corridorTerrainCuts;
let cuts = new Map();
let roofs = new Map();
let wayCuts = new Map();
let buildingPassages;
const passageCells = new Map();
let fittedPassageCells = new Map();
const platformCells = new Map(), helipadCells = new Map(), structureRoofs = new Map();

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

// The station survey stops inside the platforms. Continue its grade along
// mapped rails and ease back to AHN outside the passenger berths.
const stationRailTies = [
  [227837719, [431638734], 232, 360],
  [227837719, [227837719, 556549466, 431533902], -145, -210],
  [431657554, [431657554], 345, 470],
  [431657554, [431533794], -95, -220],
  [1052080205, [1052080205], 345, 409.3],
  [431639755, [431533734, 89438305], -90, -190],
  [1052080207, [1052080207], 345, 475],
  [1052080207, [1052080207], -145, -250]
];

function stationRailExtensions(profiles) {
  const railways = new Map(EDE_DATA.railways.map(way => [way.id, way]));
  const extensions = [];
  for (const [sourceId, wayIds, platformEdge, groundEdge] of stationRailTies) {
    const survey = profiles.find(profile => profile.wayId === `w${sourceId}` && profile.source?.startsWith('ProRail'));
    if (!(survey?.points?.length > 1)) continue;
    const sign = Math.sign(groundEdge - platformEdge);
    const samples = survey.points.slice().sort((a, b) => sign * (b[0] - a[0]));
    const [x0, , y0] = samples[0];
    const [refX, , refY] = samples.find(point => Math.abs(point[0] - x0) >= 20) ?? samples.at(-1);
    const slope = (y0 - refY) / (x0 - refX);
    const from = Math.min(x0, groundEdge), to = Math.max(x0, groundEdge);
    for (const id of wayIds) {
      const way = railways.get(`w${id}`);
      if (!way) continue;
      const points = [];
      for (let i = 2; i < way.pts.length; i += 2) {
        const [ax, az, bx, bz] = way.pts.slice(i - 2, i + 2);
        const low = Math.max(from, Math.min(ax, bx)), high = Math.min(to, Math.max(ax, bx));
        if (low >= high) continue;
        for (const x of ax < bx ? [low, high] : [high, low]) {
          if (points.at(-1)?.[0] === x) continue;
          points.push([x, az + (bz - az) * (x - ax) / (bx - ax), y0 + (x - x0) * slope]);
        }
      }
      if (points.length < 2) continue;
      extensions.push({ wayId: way.id, points, terrainTie: [platformEdge, groundEdge], source: 'ProRail survey continuation' });
    }
  }
  return extensions;
}

export function setEdeGrade(data) {
  const nextSegments = new Map(), nextProfiles = new Map(), nextWays = new Map(), nextTracks = new Map();
  const nextLocalSurfaceWays = new Map();
  const nextLocalSurfaces = [];
  const nextCuts = new Map(), nextRoofs = new Map();
  const nextWayCuts = new Map();
  const nextFittedPassages = new Map();
  for (const site of data.sites) {
    for (const entry of site.profiles || []) {
      if (!(entry.width > 0) || !entry.points.every(point => point.length === 3 && point.every(Number.isFinite))) {
        throw new Error(`Invalid grade profile ${entry.id}`);
      }
      if (site.kind === 'surface' && !(entry.shoulder > 0 && entry.shoulder <= entry.width / 2)) {
        throw new Error(`Invalid surface shoulder for ${entry.id}`);
      }
      const profile = { ...entry, site, half: entry.width / 2, covers: coveredRanges(entry) };
      const spans = calculateSegments(profile);
      nextProfiles.set(profile.id, spans);
      for (const id of entry.wayIds || []) addWay(nextWays, id, spans);
      if (site.kind === 'surface' && spans.length) {
        const surface = describeLocalSurface(spans);
        nextLocalSurfaces.push(surface);
        for (const id of entry.wayIds || []) nextLocalSurfaceWays.set(id, surface);
      }
      const outline = site.kind === 'surface' ? [] : gradeSections(entry).map(sectionCut);
      if (entry.cutBuildings) {
        for (const section of gradeSections(entry, 3)) {
          if (section.covered) {
            indexCut(nextFittedPassages, slopingPassageCut(section, entry.id, entry.clearance || site.clearance || 3, true));
          }
        }
      }
      for (const id of entry.wayIds || []) addWay(nextWayCuts, id, outline);
      if (site.kind === 'level') for (const cut of outline) indexCut(nextCuts, cut);
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
        const { a, b } = section;
        const dx = b.x - a.x, dz = b.z - a.z;
        const runSquared = dx * dx + dz * dz;
        const floorAt = (x, z) => a.y + (b.y - a.y) * clamp(((x - a.x) * dx + (z - a.z) * dz) / runSquared, 0, 1);
        if (section.covered && site.kind === 'underpass') {
          indexCut(nextRoofs, { ...cut, floorAt, clearance: entry.clearance || site.clearance || 3 });
        }
        if (!section.covered || site.cutCoveredTerrain) indexCut(nextCuts, { ...cut, floorAt });
      }
    }
  }
  const railProfiles = data.railHeights || [];
  for (const profile of [...railProfiles, ...stationRailExtensions(railProfiles)]) {
    if (profile.points?.length > 1) addWay(nextTracks, profile.wayId, calculateSegments(profile));
    // Cut only the narrow ballast footprint where terrain could bury the rails.
    if (profile.fittedBallast || profile.source?.startsWith('ProRail')) {
      for (const section of gradeSections({ ...profile, width: RAIL_BALLAST_WIDTH })) indexCut(nextCuts, sectionCut(section));
    }
  }
  const nextCorridors = new Map(), nextCorridorSpans = new Map();
  for (const profile of data.railCorridors || []) {
    const sections = gradeSections({ ...profile, width: RAIL_BALLAST_WIDTH }, Infinity);
    nextCorridors.set(profile.wayId, { ...profile, sections });
    for (const span of calculateSegments(profile)) {
      indexCut(nextCorridorSpans, {
        ...span,
        minX: Math.min(span.x, span.endX) - 2, maxX: Math.max(span.x, span.endX) + 2,
        minZ: Math.min(span.z, span.endZ) - 2, maxZ: Math.max(span.z, span.endZ) + 2,
      });
    }
  }
  const nextNearbyTracks = new Map();
  // Preserve the original track and span order when two alignments are equally close.
  for (const spans of nextTracks.values()) for (const span of spans) {
    const pad = RAIL_LOOKUP_REACH + (span.profile.half ?? 0);
    indexCut(nextNearbyTracks, Object.assign(span, {
      minX: Math.min(span.x, span.endX) - pad, maxX: Math.max(span.x, span.endX) + pad,
      minZ: Math.min(span.z, span.endZ) - pad, maxZ: Math.max(span.z, span.endZ) + pad,
    }));
  }
  world = data;
  segments = nextSegments;
  profiles = nextProfiles;
  ways = nextWays;
  localSurfaceWays = nextLocalSurfaceWays;
  localSurfaces = nextLocalSurfaces;
  tracks = nextTracks;
  nearbyTracks = nextNearbyTracks;
  railCorridors = nextCorridors;
  corridorSpans = nextCorridorSpans;
  corridorTerrainCuts = undefined;
  cuts = nextCuts;
  roofs = nextRoofs;
  wayCuts = nextWayCuts;
  fittedPassageCells = nextFittedPassages;
  return data;
}

export async function loadEdeGrade({ localSurfaces = true } = {}) {
  async function read(path) {
    const response = await fetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return response.json();
  }
  const [data, corrections] = await Promise.all([
    read('../assets/ede-grade.json'),
    localSurfaces ? read('../assets/ede-ahn-surfaces.json').catch(error => {
      console.warn('[grade] using coarse surfaces for exposed approaches:', error.message);
      return null;
    }) : null,
  ]);
  if (corrections?.version === 1 && Array.isArray(corrections.sites)) {
    data.sites = [...data.sites, ...corrections.sites];
  }
  return setEdeGrade(data);
}

export const getEdeGrade = () => world;
export const isGradeWay = (wayId) => ways.has(wayId);

function indexPlatforms(cells, platforms) {
  cells.clear();
  for (const platform of platforms) {
    const { minX, minZ, maxX, maxZ } = boundsOf(platform.outer);
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        const key = cellKey(x, z);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(platform);
      }
    }
  }
}

export function setEdePlatforms(platforms) {
  indexPlatforms(platformCells, platforms);
}

export function setEdeHelipads(helipads) {
  indexPlatforms(helipadCells, helipads);
}

export function heliLandingHeightAt(x, z) {
  const candidates = helipadCells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  let height;
  for (const { outer, y } of candidates ?? []) {
    if (insideRing(outer, x, z) && (height === undefined || y > height)) height = y;
  }
  return height;
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

function nearestSpan(spans, x, z, { mode, kind, referenceY, reach = 0.3, heading, wayId } = {}) {
  let picked = null, best = Infinity;
  const useMode = modeGroup(mode);
  for (const span of spans) {
    const { profile } = span;
    if (wayId && wayId !== profile.wayId) continue;
    if (useMode && !profile.modes.includes(useMode)) continue;
    if (kind && profile.site?.kind !== kind) continue;
    const raw = (x - span.x) * span.dx + (z - span.z) * span.dz;
    const along = clamp(raw, 0, span.length);
    const lateral = -(x - span.x) * span.dz + (z - span.z) * span.dx;
    const distance = Math.hypot(raw - along, lateral);
    if (distance > (profile.half ?? 0) + reach) continue;
    const localSurface = profile.site?.kind === 'surface';
    if (localSurface && (raw < -0.001 || raw > span.length + 0.001 || Math.abs(lateral) >= profile.half)) continue;
    let y = span.y + (span.endY - span.y) * along / span.length;
    if (localSurface) {
      const weight = clamp((profile.half - Math.abs(lateral)) / profile.shoulder, 0, 1);
      y = terrainHeightAt(x, z) + y * weight;
    }
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

export function gradeProfileAt(x, z, mode, heading, referenceY, profileId, reach = 0.3) {
  const cell = segments.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  const explicit = profileId && (profiles.get(profileId) || ways.get(profileId));
  const hit = nearestSpan(explicit || cell || [], x, z, { mode, heading, referenceY, reach });
  if (!hit) {
    if (modeGroup(mode) === 'foot' && !profileId) {
      const platform = platformAt(x, z, referenceY);
      if (platform) return platform;
    }
    const passage = buildingPassageAt(x, z, referenceY);
    if (!passage || profileId && profileId !== passage.id) return null;
    return { id: passage.id, site: passage.id, kind: 'passage', y: terrainHeightAt(x, z), roof: passage.roofAt(x, z) };
  }
  const { span, y, along, lateral } = hit;
  const { profile } = span;
  const s = span.at + along;
  const covered = profile.covers.some(([from, to]) => s >= from && s <= to);
  return { id: profile.id, site: profile.site.id, kind: profile.site.kind, y, lateral,
    roof: covered ? y + (profile.clearance || profile.site.clearance || 3) : Infinity };
}

export function isUnderEdeRoof(x, y, z) {
  const cell = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
  const covered = roofs.get(cell)?.some(({ planes, floorAt, clearance }) => {
    if (!planes.every(([nx, nz, c]) => nx * x + nz * z >= c - 1e-8)) return false;
    const floor = floorAt(x, z);
    return y >= floor - 0.25 && y <= floor + clearance;
  });
  return covered || !!buildingPassageAt(x, z, y) || (structureRoofs.get(cell)?.some(({ outer, holes, height }) =>
    insideRing(outer, x, z) && !holes.some(ring => insideRing(ring, x, z)) && y <= height(x, z)) ?? false);
}

export function gradeHeightAt(x, z, referenceY, mode = 'motor', profileId) {
  return gradeProfileAt(x, z, mode, undefined, referenceY, profileId)?.y ?? gradeGroundHeightAt(x, z, referenceY);
}

export function gradeGroundHeightAt(x, z, referenceY) {
  const cell = cuts.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!cell) return terrainHeightAt(x, z);
  let floor, distance = Infinity;
  for (const { planes, floorAt } of cell) {
    if (!floorAt || !planes.every(([nx, nz, c]) => nx * x + nz * z >= c - 1e-8)) continue;
    const y = floorAt(x, z);
    const delta = Number.isFinite(referenceY) ? Math.abs(referenceY - y) : -y;
    if (delta < distance) { distance = delta; floor = y; }
  }
  return floor ?? terrainHeightAt(x, z);
}

export function gradeWayAt(wayId, x, z, extra = 0.3) {
  return nearestSpan(ways.get(wayId) || [], x, z, { reach: extra });
}

function describeLocalSurface(spans) {
  const points = spans.flatMap(span => [{ x: span.x, z: span.z }, { x: span.endX, z: span.endZ }]);
  const bounds = boundsOf(points);
  const pad = Math.max(...spans.map(span => span.profile.half));
  const planes = [];
  const { x, z, dx, dz, profile } = spans[0];
  for (const across of [-profile.half, profile.shoulder - profile.half,
    profile.half - profile.shoulder, profile.half]) {
    planes.push([-dz, dx, -dz * x + dx * z + across]);
  }
  for (const span of spans) {
    const count = Math.ceil(span.length / 1.1);
    for (let i = 0; i < count; i++) {
      planes.push([span.dx, span.dz, span.dx * span.x + span.dz * span.z + span.length * i / count]);
    }
  }
  const last = spans.at(-1);
  planes.push([last.dx, last.dz, last.dx * last.endX + last.dz * last.endZ]);
  return { minX: bounds.minX - pad, maxX: bounds.maxX + pad, minZ: bounds.minZ - pad, maxZ: bounds.maxZ + pad,
    planes, heightAt: (x, z) => nearestSpan(spans, x, z)?.y ?? terrainHeightAt(x, z) };
}

export function localGradeSurface(wayId, bounds) {
  if (wayId) return localSurfaceWays.get(wayId);
  for (const surface of localSurfaces) {
    if (overlaps(bounds, surface)) return surface;
  }
}

function railElevation(hit) {
  if (!hit) return undefined;
  const { span, along, y } = hit;
  const tie = span.profile.terrainTie;
  if (!tie) return y;
  const x = span.x + along * span.dx, z = span.z + along * span.dz;
  const t = clamp((x - tie[0]) / (tie[1] - tie[0]), 0, 1);
  return y + (terrainHeightAt(x, z) - y) * t * t * (3 - 2 * t);
}

export const getRailCorridors = () => railCorridors;

export function railCorridorHeightAt(wayId, x, z) {
  const spans = corridorSpans.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
  return nearestSpan(spans, x, z, { wayId, reach: 2 })?.y;
}

export function railHeightAt(wayId, x, z) {
  return railCorridorHeightAt(wayId, x, z) ??
    railElevation(nearestSpan(tracks.get(wayId) || [], x, z, { reach: 2 }));
}

function structureRailElevation(hit) {
  if (!hit) return undefined;
  const { span, along } = hit;
  return railCorridorHeightAt(span.profile.wayId, span.x + along * span.dx, span.z + along * span.dz) ??
    railElevation(hit);
}

export function nearbyRailHeightAt(x, z, reach = 5) {
  if (reach <= RAIL_LOOKUP_REACH) {
    const spans = nearbyTracks.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
    return structureRailElevation(nearestSpan(spans, x, z, { reach }));
  }
  let nearest = null;
  for (const spans of tracks.values()) {
    const hit = nearestSpan(spans, x, z, { reach });
    if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
  }
  return structureRailElevation(nearest);
}

export function gradeDeckAt(x, z, reach = 0.3) {
  const cell = segments.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (reach <= 1) return nearestSpan(cell || [], x, z, { kind: 'bridge', reach })?.y;
  const nearby = new Set();
  for (let i = Math.floor((x - reach) / CELL); i <= Math.floor((x + reach) / CELL); i++) {
    for (let j = Math.floor((z - reach) / CELL); j <= Math.floor((z + reach) / CELL); j++) {
      for (const span of segments.get(cellKey(i, j)) || []) nearby.add(span);
    }
  }
  return nearestSpan(nearby, x, z, { kind: 'bridge', reach })?.y;
}

export function gradeSections(entry, spacing = 6) {
  const covers = coveredRanges(entry);
  const spans = calculateSegments(entry);
  const border = [...covers.flat(), ...(entry.span || [])];
  const centers = [];
  for (const span of spans) {
    const subdivisions = Math.max(1, Math.ceil(span.length / spacing));
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

function slopingPassageCut(section, id, clearance, fitted = false) {
  const { a, b } = section;
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
  const slope = (b.y - a.y) / length;
  const ux = dx / length, uz = dz / length;
  const floorAt = (x, z) => a.y + (ux * (x - a.x) + uz * (z - a.z)) * slope;
  const roofAt = (x, z) => floorAt(x, z) + clearance;
  return { ...sectionCut(section), ...section, id, clearance, ux, uz, roofAt, slope,
    openingBaseAt: fitted ? (x, z) => floorAt(x, z) - 0.15 : undefined };
}

export function getEdeBuildingPassages() {
  if (buildingPassages) return buildingPassages;
  buildingPassages = new Map();
  for (const road of EDE_DATA.roads) {
    if (road.tunnelType !== 'building_passage' || road.layer > 0) continue;
    const points = [];
    for (let i = 0; i < road.pts.length; i += 2) {
      const x = road.pts[i], z = road.pts[i + 1];
      points.push([x, z, terrainHeightAt(x, z)]);
    }
    // The garage aisles need turning clearance beyond the mapped single-lane carriageway.
    const garageAisle = road.id === 'w956231562' || road.id === 'w956231563';
    const modeledSoffit = MODELED_PASSAGE_SOFFITS[road.id];
    const modeled = modeledSoffit !== undefined;
    const profile = { id: road.id, points, width: road.bgtWidth ?? road.bgt?.width ?? (garageAisle ? 5 : road.width), modeled };
    // Unposted openings have an estimated soffit based on the mapped use.
    const clearance = road.limits?.height ?? (road.modes.some(mode => mode & MOTOR) ? 3.4 : 2.8);
    const sections = gradeSections(profile, 3).map(section => {
      const { a, b } = section;
      a.y = terrainHeightAt(a.x, a.z);
      b.y = terrainHeightAt(b.x, b.z);
      const cut = slopingPassageCut(section, road.id, clearance);
      if (modeled) {
        cut.roofAt = () => modeledSoffit;
        cut.slope = 0;
      }
      indexCut(passageCells, cut);
      return cut;
    });
    buildingPassages.set(road.id, { profile, sections,
      spans: calculateSegments({ ...profile, half: profile.width / 2 }) });
  }
  return buildingPassages;
}

function buildingPassageAt(x, z, y) {
  const cell = passageCells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  return cell?.find(({ planes, roofAt }) =>
    planes.every(([nx, nz, c]) => nx * x + nz * z >= c - 1e-8) &&
    (!Number.isFinite(y) || (y >= terrainHeightAt(x, z) - 0.25 && y < roofAt(x, z))));
}

export function buildingPassageCuts(bounds) {
  const found = new Set();
  for (let x = Math.floor(bounds.minX / CELL); x <= Math.floor(bounds.maxX / CELL); x++) {
    for (let z = Math.floor(bounds.minZ / CELL); z <= Math.floor(bounds.maxZ / CELL); z++) {
      const key = cellKey(x, z);
      for (const index of [passageCells, fittedPassageCells]) {
        for (const cut of index.get(key) || []) if (overlaps(bounds, cut)) found.add(cut);
      }
    }
  }
  return found;
}

function passageOpenings(a, b, pad, excludeId) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const bounds = boundsOf([a, b]);
  bounds.minX -= pad; bounds.maxX += pad;
  bounds.minZ -= pad; bounds.maxZ += pad;
  const openings = [];
  for (const cut of buildingPassageCuts(bounds)) {
    if (excludeId && (cut.id === excludeId || cut.openingBaseAt)) continue;
    let from = 0, to = 1;
    for (const [nx, nz, c] of cut.planes) {
      const distance = nx * a.x + nz * a.z - c + pad * Math.hypot(nx, nz);
      const step = nx * dx + nz * dz;
      if (Math.abs(step) < 1e-8) {
        if (distance < 0) { to = 0; break; }
      } else if (step > 0) from = Math.max(from, -distance / step);
      else to = Math.min(to, -distance / step);
    }
    if (to > from) openings.push({ from, to, openingBaseAt: cut.openingBaseAt, roofAt: cut.roofAt });
  }
  return openings;
}

export function buildingPassageOpenings(a, b) {
  // Clear the thickness of both sides of the portal facade.
  return passageOpenings(a, b, 0.45);
}

export function buildingPassageSideSpans(a, b, id) {
  // At a shared junction, keep only the outside of the combined passage.
  const openings = passageOpenings(a, b, 0.18, id).sort((p, q) => p.from - q.from);
  const pointAt = t => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  const spans = [];
  let start = 0;
  for (const { from, to } of openings) {
    if (from > start) spans.push([pointAt(start), pointAt(from)]);
    start = Math.max(start, to);
  }
  if (start < 1) spans.push([pointAt(start), b]);
  return spans;
}

export function buildingPassageHeadingAt(x, z, y, heading) {
  const cut = buildingPassageAt(x, z, y);
  if (!cut) return undefined;
  const hit = nearestSpan(buildingPassages.get(cut.id).spans, x, z, { heading });
  if (!hit) return undefined;
  const { dx, dz } = hit.span;
  const axis = Math.atan2(dx, dz);
  return Math.cos(heading - axis) >= 0 ? axis : axis + Math.PI;
}

function collectGradeCuts(index, bounds, result) {
  if (!index.size) return;
  for (let x = Math.floor(bounds.minX / CELL); x <= Math.floor(bounds.maxX / CELL); x++) {
    for (let z = Math.floor(bounds.minZ / CELL); z <= Math.floor(bounds.maxZ / CELL); z++) {
      for (const cut of index.get(cellKey(x, z)) || []) if (overlaps(bounds, cut)) result.add(cut);
    }
  }
}

export function gradeCuts(bounds, wayId) {
  const result = new Set((wayCuts.get(wayId) || []).filter(cut => overlaps(bounds, cut)));
  collectGradeCuts(cuts, bounds, result);
  return [...result];
}

export function terrainGradeCuts(bounds) {
  const result = new Set(gradeCuts(bounds));
  const terrain = getTerrain();
  if (!terrain || !railCorridors.size) return [...result];
  if (!corridorTerrainCuts) {
    corridorTerrainCuts = new Map();
    for (const { bridge, sections } of railCorridors.values()) {
      if (bridge) continue;
      for (const section of sections) {
        const { a, b } = section;
        const buried = [[a, b], [a.left, b.left], [a.right, b.right]].some(([p, q]) => {
          return terrainHeightAt(p.x, p.z) - p.y > 0.05 || terrainHeightAt(q.x, q.z) - q.y > 0.05 ||
            terrainHeightAt((p.x + q.x) / 2, (p.z + q.z) / 2) - (p.y + q.y) / 2 > 0.05;
        });
        if (!buried) continue;
        const cut = sectionCut(section);
        if (overlaps(terrain, cut)) indexCut(corridorTerrainCuts, cut);
      }
    }
  }
  collectGradeCuts(corridorTerrainCuts, bounds, result);
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
    const cameraPassage = buildingPassageAt(x, z);
    const passageId = at?.kind === 'passage' ? at.id
      : cameraPassage && entity.position.y < cameraPassage.roofAt(x, z)
        && Math.hypot(x - entity.position.x, z - entity.position.z) <= 24 ? cameraPassage.id : undefined;
    if (passageId) {
      const { profile, spans } = buildingPassages.get(passageId);
      const hit = nearestSpan(spans, x, z, { reach: 24 });
      if (hit) {
        const { span, along, lateral } = hit;
        const half = profile.width / 2 - 0.45;
        const side = clamp(lateral, -half, half);
        const px = span.x + span.dx * along - span.dz * side;
        const pz = span.z + span.dz * along + span.dx * side;
        const cover = buildingPassageAt(px, pz) ?? cameraPassage;
        const roof = cover?.roofAt(px, pz) ?? at.roof;
        // A camera behind an open portal can keep its distance along the passage axis.
        position.x += span.dz * (lateral - side);
        position.z -= span.dx * (lateral - side);
        position.y = clamp(position.y, terrainHeightAt(position.x, position.z) + clearance, roof - 0.25);
        return;
      }
    }
    const fitted = at && profiles.get(at.id);
    if (fitted && (at.kind === 'underpass' || fitted[0]?.profile.covers.length)) {
      const hit = nearestSpan(fitted, x, z, { reach: 24 });
      if (hit) {
        const { span, along, lateral, y } = hit;
        const { profile } = span;
        const covered = profile.covers.some(([from, to]) => span.at + along >= from && span.at + along <= to);
        const entityInside = Number.isFinite(at.roof) || at.y < terrainHeightAt(entity.position.x, entity.position.z) - 0.65;
        // A follow camera can still sit under the roof when the player has left it.
        if (entityInside || (covered && hit.distance <= profile.half + 0.3)) {
          const side = clamp(lateral, -profile.half + 0.45, profile.half - 0.45);
          position.x = span.x + span.dx * along - span.dz * side;
          position.z = span.z + span.dz * along + span.dx * side;
          const roof = covered ? y + (profile.clearance || profile.site.clearance || 3) - 0.25 : Infinity;
          const projected = gradeProfileAt(position.x, position.z, entity.type, entity.heading, undefined, at.id);
          const soffit = Math.min(roof, (projected?.roof ?? Infinity) - 0.25);
          position.y = clamp(position.y, y + clearance, soffit);
          return;
        }
      }
    }
  }
  const deck = entity.type === 'helicopter'
    ? Math.max(gradeDeckAt(x, z) ?? -Infinity, heliLandingHeightAt(x, z) ?? -Infinity) : gradeDeckAt(x, z);
  const onDeck = Number.isFinite(deck) && (entity.type === 'helicopter' || entity.position.y >= deck - 1.2);
  const platform = entity.type === 'person' ? platformAt(x, z, entity.position.y)?.y : undefined;
  position.y = Math.max(position.y, (onDeck ? deck : platform ?? gradeGroundHeightAt(x, z, entity.position.y)) + clearance);
}
