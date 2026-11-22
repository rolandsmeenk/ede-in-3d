// Generate the packed Ede map from tools/data/osm_ede.json (Overpass, query q_ede.overpassql).
// Frame: 1 unit = 1 m, x = east, z = south, origin at the Oude Kerk (true north up, no grid rotation).
// usage: node tools/build-ede-geodata.mjs [osm_ede.json] [out.json.gz] [wkd-geojson-directory] [--corridors|--north]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { projectLonLatInto } from '../js/ede-scene-coordinates.js';
import { CAR, VAN, BUS, BICYCLE, FOOT, MOTOR } from '../js/road-access.js';
import { cycleFacilities, readWkd, roadAccess } from './ede-road-access.mjs';
import { buildRoadTags, writeRoadTags } from './build-ede-road-tags.mjs';
import { GOUDSBERG_FENCE, createNorthAccess } from './ede-north-access.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const switches = new Set(['--corridors', '--north']);
const args = process.argv.slice(2).filter(argument => !switches.has(argument));
const north = process.argv.includes('--north');
const corridors = north || process.argv.includes('--corridors');
const INPUT = args[0] || path.join(DIR, 'data', 'osm_ede.json');
const MAP_ASSET = path.join(DIR, '..', 'assets', 'ede-map-v1.json.gz');
const OUT = args[1] ? path.resolve(args[1]) : corridors
  ? path.join(DIR, '..', 'assets', north ? 'ede-north-v1.json.gz' : 'ede-corridors-v1.json.gz') : MAP_ASSET;
if (corridors && OUT === MAP_ASSET) throw new Error('Corridors must use a separate overlay path');
if (!OUT.endsWith('.json.gz')) throw new Error('Expected a .json.gz map output path');
const osm = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
if (!Array.isArray(osm.elements) || !osm.elements.length || osm.remark) throw new Error('Expected a complete Ede OpenStreetMap response');
const bgt = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'ede-bgt-road-evidence.json'), 'utf8'));
const log = (...a) => console.log('[ede-geodata]', ...a);

// Keep graph geometry and saved scenes on the coefficients of the checked-in map.
const base = JSON.parse(gunzipSync(fs.readFileSync(MAP_ASSET)));
const { lonLatAffine } = base.meta;
const coverage = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'ede-outer-coverage.json'), 'utf8'));
const [south, west, , east] = coverage.geographicBounds;
const geographicBounds = north ? coverage.geographicBounds : corridors
  ? [south, west, coverage.previousNorth, east] : base.meta.geographicBounds;
if (north) {
  // Keep every graph and geometry index from the first expansion as the prefix.
  const previous = JSON.parse(gunzipSync(fs.readFileSync(path.join(DIR, '..', 'assets', 'ede-corridors-v1.json.gz'))));
  for (const key of ['roads', 'railways', 'buildings', 'water', 'parks', 'squares', 'trees', 'signals']) {
    base[key].push(...previous[key]);
  }
  for (const key of ['roadGraph', 'activeGraph']) {
    for (const field of ['nodes', 'links', 'names']) base[key][field].push(...previous[key][field]);
  }
  base.meta.bounds = previous.bounds;
}
const r1 = (v) => Math.round(v * 10) / 10;
const toWorld = (lon, lat) => {
  const { x, z } = projectLonLatInto(lonLatAffine, lon, lat, {});
  return [x, z];
};
const cycleStripPath = path.join(DIR, 'data', 'ede-wkd-cycle-strips.json');
const cycleStripFile = fs.existsSync(cycleStripPath) ? cycleStripPath : null;
const wkd = readWkd(args[2], toWorld, cycleStripFile);
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);
const geomPts = (g) => (g || []).map((p) => toWorld(p.lon, p.lat));

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1 };
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const dx = pts[b][0] - pts[a][0], dz = pts[b][1] - pts[a][1];
    const L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - pts[a][0]) * dz - (pts[i][1] - pts[a][1]) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const closed = (r) => r.length > 3 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.3;
// Open ring (first point not repeated), simplified
const cleanRing = (r) => {
  const open = closed(r) ? r.slice(0, -1) : r;
  const s = rdp([...open, open[0]], 0.4).slice(0, -1);
  return s.length >= 3 ? s : open;
};

// Chains outer/inner member ways of a relation into closed rings
function chainRings(members) {
  const parts = members.filter((m) => m.geometry && m.geometry.length > 1).map((m) => geomPts(m.geometry));
  const rings = [];
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.3;
  while (parts.length) {
    let ring = parts.shift();
    for (let guard = 0; guard < 2000 && !near(ring[0], ring[ring.length - 1]); guard++) {
      const end = ring[ring.length - 1];
      const i = parts.findIndex((p) => near(p[0], end) || near(p[p.length - 1], end));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(near(p[0], end) ? p.slice(1) : p.reverse().slice(1));
    }
    if (closed(ring)) rings.push(ring);
  }
  return rings;
}
// Outer rings with their holes: [{ ring, holes }]
function polygons(e) {
  if (e.type === 'way') {
    const r = geomPts(e.geometry);
    return closed(r) ? [{ ring: r, holes: [] }] : [];
  }
  const outers = chainRings((e.members || []).filter((m) => m.role === 'outer' || m.role === ''));
  const inners = chainRings((e.members || []).filter((m) => m.role === 'inner'));
  return outers.map((ring) => {
    const bb = bbox(ring);
    const holes = inners.filter((h) => h[0][0] >= bb.x0 && h[0][0] <= bb.x1 && h[0][1] >= bb.z0 && h[0][1] <= bb.z1);
    return { ring, holes };
  });
}
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// --- Buildings --------------------------------------------------------------------------------------------------------
const buildings = [];
for (const e of osm.elements) {
  const t = e.tags || {};
  if (e.type === 'node' || !(t.building || t['building:part'])) continue;
  if (t.building === 'roof' || t.building === 'no') continue;
  const part = !t.building;
  for (const [i, p] of polygons(e).entries()) {
    const ring = cleanRing(p.ring);
    if (ring.length < 3 || Math.abs(ringArea(ring)) < 4) continue;
    const levels = num(t['building:levels']);
    const minH = num(t.min_height) ?? 0;
    let h = num(t.height), src = 'height';
    if (h == null && levels != null) { h = levels * 3.1 + (t.building === 'church' || t.building === 'cathedral' ? 8 : 1); src = 'building:levels'; }
    if (h == null) { h = 9; src = 'default'; }
    const o = { id: `${e.type[0]}${e.id}${i ? '_' + i : ''}`, ring: flat(ring), holes: p.holes.map((hh) => flat(cleanRing(hh))), h: r1(h), roofHeight: r1(num(t['roof:height']) ?? 0), roofShape: t['roof:shape'] || 'flat', levels: levels ?? 0, name: t.name || '', kind: t.building || 'part', heightSource: src };
    if (minH) o.minHeight = r1(minH);
    if (part) o.part = true;
    buildings.push(o);
  }
}

// --- Roads & railways ---------------------------------------------------------------------------------------------------
const WIDTH = { motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7, residential: 6, unclassified: 6, living_street: 5, service: 3.5, busway: 3.5, pedestrian: 5, cycleway: 2.5, footway: 2, path: 1.5, steps: 2, track: 3, bridleway: 2 };
const LANES = { motorway: 4, trunk: 4, primary: 2, secondary: 2, tertiary: 2, residential: 2, unclassified: 2, living_street: 1, service: 1 };
const DRIVABLE = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street']);
// These mapped approaches continue beyond the playable bounds. The matcher
// clips them at the actual crossing while ordinary traffic stays on its loop.
const BOUNDARY_APPROACHES = new Set([
  25999022, 25999048, 6962023, 974100768, 6960043, 44431669, 974100769,
  6959815, 6959876, 6959877, 6959806, 6959808, 1243033918, 1243033919, 1243033923
]);
// Keep the short links at the station intersection and Kastelenlaan as actual turns.
const SHORT_JUNCTION_LINKS = new Set([
  620928502, 620928503, 1193451509, 1193451510,
  1024971617, 1024971618, 421594657, 25710948, 430622525, 25710947
]);
const drivable = [];
const activeTravel = [];
const roads = [];
const railways = [];
const signals = [];
const crossingSurvey = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'ede-active-crossing-nodes.json'), 'utf8'));
const crossingNodes = new Map();
for (const e of [...crossingSurvey.elements, ...osm.elements]) {
  if (e.type !== 'node' || !['crossing', 'give_way', 'stop', 'traffic_signals'].includes(e.tags?.highway)) continue;
  const [x, z] = toWorld(e.lon, e.lat);
  crossingNodes.set(e.id, { x: r1(x), z: r1(z), control: crossingControl(e.tags),
    ...(e.tags.highway === 'crossing' ? { osmId: e.id, markings: e.tags['crossing:markings'] } : {}) });
}

function crossingControl(t) {
  if (t['crossing:signals'] === 'yes' || t.crossing === 'traffic_signals' || t.highway === 'traffic_signals') return 'signal';
  if (t.highway === 'crossing' || t.footway === 'crossing' || t.cycleway === 'crossing' ||
      t.highway === 'give_way' || t.highway === 'stop') return 'yield';
  return null;
}
const trees = [];
const northAccess = north ? createNorthAccess(osm) : null;
for (const e of osm.elements) {
  const t = northAccess?.(e) ?? e.tags ?? {};
  if (e.type === 'node') {
    const [x, z] = toWorld(e.lon, e.lat);
    if (t.natural === 'tree') trees.push({ x: r1(x), z: r1(z), h: r1(num(t.height) ?? 8) });
    else if (t.highway === 'traffic_signals') signals.push({ x: r1(x), z: r1(z) });
    continue;
  }
  if (e.type !== 'way' || !e.geometry) continue;
  const bridge = !!t.bridge && t.bridge !== 'no';
  const tunnel = (!!t.tunnel && t.tunnel !== 'no') || t.covered === 'yes';
  // The two AHN portals of this destination path meet street ground beneath a building.
  const surveyedBuildingPassage = e.id === 1361789451 && t.tunnel === 'yes';
  const tunnelType = surveyedBuildingPassage ? 'building_passage' : t.tunnel || 'covered';
  const layer = surveyedBuildingPassage ? 0 : num(t.layer) ?? (bridge ? 1 : tunnel ? -1 : 0);
  if (t.railway && /^(rail|light_rail|tram|subway)$/.test(t.railway)) {
    railways.push({ id: `w${e.id}`, pts: flat(rdp(geomPts(e.geometry), 0.5)), bridge, tunnel, layer, kind: t.railway });
    continue;
  }
  if (!t.highway || /^(proposed|construction|platform|bus_stop|corridor|elevator|raceway)$/.test(t.highway)) continue;
  const kind = t.highway.replace(/_link$/, '') in WIDTH ? t.highway : 'service';
  const base = kind.replace(/_link$/, '');
  const lanes = num(t.lanes) ?? LANES[base] ?? 1;
  const width = num(t.width) ?? Math.max(WIDTH[base] ?? 3, lanes * 3);
  const oneway = /^(yes|1|true|-1)$/.test(t.oneway) || !t.oneway && (t.junction === 'roundabout' || kind === 'motorway');
  const points = geomPts(e.geometry);
  const match = wkd(points, tunnel || t.maxheight);
  const evidence = bgt.ways[`w${e.id}`];
  const { modes, limits, laneModes, sidewalk, sidewalkSides } = roadAccess(e.id, t, match, evidence);
  const available = modes[0] | modes[1];
  const boundary = BOUNDARY_APPROACHES.has(e.id), junction = SHORT_JUNCTION_LINKS.has(e.id);
  const stationForecourt = kind === 'service' && (t.name === 'Polar Bearsplein'
    || corridors && t.name === 'Stationsplein' && t.bus === 'yes');
  const keepShape = boundary || bridge || tunnel || junction || kind === 'busway' || stationForecourt;
  const cycle = cycleFacilities(t, modes, width, evidence, match);
  const laneTagged = ['cycleway', 'cycleway:both', 'cycleway:left', 'cycleway:right']
    .some(key => ['lane', 'shared_lane'].includes(t[key]));
  const crossing = crossingControl(t);
  const road = { id: `w${e.id}`, pts: flat(rdp(points, 0.5)), bridge, tunnel, layer, name: t.name || '', width: r1(width),
    lanes, oneway, reverse: t.oneway === '-1', kind, nodeIds: e.nodes || [], modes,
    ...(cycle.length ? { cycle } : {}), ...(laneTagged && match.cycleStrip ? { wkdCycleStrip: match.cycleStrip } : {}),
    ...(crossing ? { crossing } : {}),
    ...(evidence ? { bgt: { kind: evidence.kind, ...(num(t.width) == null && evidence.width ? { width: evidence.width } : {}) } } : {}),
    ...(tunnel ? { tunnelType } : {}),
    ...(Object.keys(limits).length ? { limits } : {}), ...(laneModes.some(Boolean) ? { laneModes } : {}) };
  roads.push(road);
  if (t.area === 'yes' || !e.nodes || e.nodes.length !== points.length) continue;
  const way = { road: roads.length - 1, name: road.name, width: road.width, lanes, nodes: e.nodes, pts: points, boundary, junction, keepShape };
  const motor = available & MOTOR;
  if (motor && (DRIVABLE.has(kind) || kind === 'busway' || stationForecourt || !!(motor & BUS) && !(motor & (CAR | VAN)))) {
    const motorModes = modes.map((mask) => mask & MOTOR);
    const dir = motorModes.every(Boolean) ? 0 : motorModes[0] ? 1 : -1;
    drivable.push({ ...way, dir });
  }
  const mappedFoot = /^(footway|pedestrian|steps|cycleway|path|bridleway|track)$/.test(kind)
    || !!sidewalk && !['no', 'none', 'separate'].includes(sidewalk) || sidewalkSides.some((s) => s === 'yes');
  if (cycle.length || (available & BICYCLE) || (available & FOOT) && mappedFoot) {
    const footOffset = [];
    if (mappedFoot && (available & FOOT)) {
      if (/^(footway|pedestrian|steps|cycleway|path|bridleway|track)$/.test(kind)) footOffset.push(0);
      else {
        if (sidewalkSides[0] === 'yes' || ['yes', 'both', 'left'].includes(sidewalk) && !sidewalkSides[0]) footOffset.push(-road.width / 2 - 1);
        if (sidewalkSides[1] === 'yes' || ['yes', 'both', 'right'].includes(sidewalk) && !sidewalkSides[1]) footOffset.push(road.width / 2 + 1);
      }
    }
    activeTravel.push({ ...way, dir: 0, footOffset });
  }
}

// --- Street centreline graph: ways cut at every node shared by two ways (and at their ends) ----------------------------
// links: [node a, node b, name index, width, lanes, direction (1: a -> b, -1: b -> a, 0: both), inner shape points [x, z, ...]]
if (!drivable.length || !buildings.length) throw new Error('Ede snapshot is missing roads or buildings');

function buildGraph(ways, active = false) {
  const uses = new Map();
  for (const w of ways) for (const id of new Set(w.nodes)) uses.set(id, (uses.get(id) || 0) + 1);
  const ids = new Map();
  const nodes = [];
  const osmNodes = [];
  const names = [];
  const nameIds = new Map();
  const nodeOf = (id, p) => {
    if (!ids.has(id)) {
      ids.set(id, nodes.length / 2);
      nodes.push(r1(p[0]), r1(p[1]));
      if (corridors) osmNodes.push(id);
    }
    return ids.get(id);
  };
  const nameOf = (n) => { if (!nameIds.has(n)) { nameIds.set(n, names.length); names.push(n); } return nameIds.get(n); };
  const links = [];
  for (const w of ways) {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const last = i === w.nodes.length - 1;
      if (!last && uses.get(w.nodes[i]) < 2 && w.nodes[i] !== w.nodes[0] && !(active && crossingNodes.has(w.nodes[i]))) continue;
      if (w.nodes[i] === w.nodes[start]) { start = i; continue; }
      const seg = w.pts.slice(start, i + 1);
      const inner = rdp(seg, 0.4).slice(1, -1).flatMap(([x, z]) => [r1(x), r1(z)]);
      const link = [nodeOf(w.nodes[start], seg[0]), nodeOf(w.nodes[i], seg[seg.length - 1]), nameOf(w.name), w.width, w.lanes, w.dir, inner];
      link.push(w.road);
      if (active) link.push(w.footOffset);
      else if (w.keepShape) link.push({ ...(w.boundary ? { boundary: true } : {}), ...(w.junction ? { junction: true } : {}), keepShape: true });
      links.push(link);
      start = i;
    }
  }
  return { nodes, links, names, ...(corridors && { osmNodes }), ...(active ? { controls: Object.fromEntries([...crossingNodes].filter(([id]) => ids.has(id)).map(([id, v]) => [ids.get(id), v])) } : {}) };
}
const roadGraph = buildGraph(drivable);
const activeGraph = buildGraph(activeTravel, true);

// --- Water & parks -------------------------------------------------------------------------------------------------------
const water = [];
const parks = [];
const squares = [];
for (const e of osm.elements) {
  const t = e.tags || {};
  if (e.type === 'node') continue;
  const isWater = t.natural === 'water' || /^(riverbank|dock)$/.test(t.waterway || '');
  const isPark = t.natural === 'wood' || north && /^(sand|bare_rock|scrub|grassland)$/.test(t.natural || '') || corridors && t.natural === 'heath' || /^(park|garden|playground|pitch)$/.test(t.leisure || '') || /^(grass|recreation_ground|cemetery|village_green|forest)$/.test(t.landuse || '');
  const isSquare = t.place === 'square' || (t.highway === 'pedestrian' && t.area === 'yes');
  if (!isWater && !isPark && !isSquare) continue;
  if (isSquare && ['no', 'private', 'customers', 'permit'].includes(t.foot ?? t.access)) continue;
  for (const p of polygons(e)) {
    const ring = cleanRing(p.ring);
    const area = Math.abs(ringArea(ring));
    if (ring.length < 3 || area < 20 || corridors && area > 2_000_000) continue;
    if (isWater) water.push({ id: `water${water.length}`, ring: flat(ring), holes: p.holes.map((h) => flat(cleanRing(h))), name: t.name || '', kind: t.water || t.waterway || 'water' });
    else (isSquare ? squares : parks).push({ id: `${e.type[0]}${e.id}`, ring: flat(ring), holes: p.holes.map((h) => flat(cleanRing(h))), name: t.name || '', kind: isSquare ? 'square' : t.leisure || t.landuse || t.natural });
  }
}

// --- Landmarks: footprints for named buildings ----------------------------------------------------------------------------
const LANDMARKS = ['Oude Kerk', 'Cultura', 'Gemeentehuis Ede', 'Raadhuis', 'Station Ede Centrum', 'Ede Centrum', 'Ede-Wageningen', 'Huis Kernhem'];
const landmarks = {};
for (const b of buildings) {
  if (b.part || !LANDMARKS.includes(b.name)) continue;
  const pts = [];
  for (let i = 0; i < b.ring.length; i += 2) pts.push([b.ring[i], b.ring[i + 1]]);
  const bb = bbox(pts);
  const area = Math.abs(ringArea(pts));
  if (landmarks[b.name] && landmarks[b.name].area >= area) continue;
  landmarks[b.name] = { x: r1((bb.x0 + bb.x1) / 2), z: r1((bb.z0 + bb.z1) / 2), w: r1(bb.x1 - bb.x0), d: r1(bb.z1 - bb.z0), h: b.h, area: Math.round(area), ring: b.ring };
}

// Representative label points from the CBS Wijk- en Buurtkaart 2025 urban districts.
const AREAS = [
  ['Ede-Oost', 5.67497, 52.04331],
  ['Ede-West', 5.65861, 52.04039],
  ['Veldhuizen', 5.63687, 52.04190],
  ['Kernhem', 5.63201, 52.05039],
  ['Veluwse Poort', 5.68302, 52.03443],
  ['Ede-Zuid', 5.66903, 52.02332],
  ['Maandereng', 5.65562, 52.01943],
  ['Rietkampen', 5.63984, 52.02103],
  ['Bedrijventerrein', 5.61885, 52.03292]
].map(([name, lon, lat]) => ({ name, labelPoint: toWorld(lon, lat).map(r1) }));

const [s, w, n, e] = geographicBounds;
const { x0, x1, z0, z1 } = bbox([toWorld(w, s), toWorld(w, n), toWorld(e, s), toWorld(e, n)]);
const data = {
  meta: {
    name: 'Ede', city: 'Ede',
    bounds: [r1(x0), r1(z0), r1(x1), r1(z1)],
    geographicBounds,
    frame: 'x = east, z = south, metres; origin at the Oude Kerk',
    coordinateSystem: 'x east, z south, metres',
    lonLatAffine,
    sources: [
      { name: 'OpenStreetMap contributors', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' },
      { name: 'CBS Wijk- en Buurtkaart 2025', url: 'https://www.cbs.nl/nl-nl/dossier/nederland-regionaal/geografische-data/wijk-en-buurtkaart-2025' },
      { name: 'Gemeente Ede traffic decision 2024-120844', url: 'https://zoek.officielebekendmakingen.nl/gmb-2024-120844.html' },
      { name: 'Kadaster BGT road areas', license: 'CC0', url: 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections' },
      ...(cycleStripFile ? [{ name: 'Rijkswaterstaat WKD Fiets(suggestie)stroken', license: 'CC0', url: 'https://data.overheid.nl/en/dataset/73729-wegkenmerkendatabase-voor-fiets-suggestie-stroken' }] : []),
      ...(args[2] ? [{ name: 'Rijkswaterstaat WKD Verkeerstypen and Hoogtebeperkingen', license: 'CC0', url: 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/wkd_wegkenmerkendatabase/ows' }] : [])
    ],
    areas: AREAS,
    counts: { buildings: buildings.length, roads: roads.length, water: water.length, parks: parks.length, squares: squares.length, railways: railways.length, trees: trees.length, signals: signals.length }
  },
  buildings, roads, water, parks, squares, railways, trees, signals, landmarks, roadGraph, activeGraph
};
const roadTags = buildRoadTags(osm, roads, bgt).fields;
function corridorOverlay() {
  const [minX, minZ, maxX, maxZ] = base.meta.bounds;
  const outside = north ? (_, z) => z < minZ : (x, z) => x < minX || x > maxX || z < minZ || z > maxZ;
  const shapeOutside = points => points.some((x, i) => i % 2 === 0 && outside(x, points[i + 1]));
  const [left, top, right, bottom] = data.meta.bounds;
  const inRange = (x, z) => x >= left && x <= right && z >= top && z <= bottom;
  const within = points => {
    const { x0, x1, z0, z1 } = bbox(Array.from({ length: points.length / 2 }, (_, i) => points.slice(i * 2, i * 2 + 2)));
    return x0 <= right && x1 >= left && z0 <= bottom && z1 >= top;
  };
  const additions = (key, geometry) => {
    const knownIds = new Set(base[key].map(row => row.id));
    return data[key].filter(row => !knownIds.has(row.id) && shapeOutside(row[geometry]) && (!north || within(row[geometry])));
  };
  // Keep local detail around the five arrivals and the routes connecting them.
  const arrivals = (north ? coverage.northDetail.arrivals : [[5.6488339, 52.0620776], [5.5738443, 52.0460819], [5.7351475, 52.03733],
    [5.7616257, 52.0623555], [5.78636, 52.030766]]).map(point => toWorld(...point));
  const paths = (north ? coverage.northDetail.routes : [
    [[5.649, 52.046], [5.648, 52.055], [5.6488339, 52.0620776]],
    [[5.674, 52.0274], [5.626, 52.0337], [5.597, 52.04], [5.5738443, 52.0460819]],
    [[5.697, 52.054], [5.719, 52.043], [5.7351475, 52.03733], [5.755, 52.034], [5.78636, 52.030766]],
    [[5.7351475, 52.03733], [5.753, 52.049], [5.7616257, 52.0623555], [5.776, 52.054], [5.78636, 52.030766]]
  ]).map(route => route.map(point => toWorld(...point)));
  const zones = north ? [coverage.northDetail.village, ...(coverage.northDetail.additionalZones ?? [])]
    .map(([west, south, east, north]) => [...toWorld(west, north), ...toWorld(east, south)]) : [];
  const segments = paths.flatMap(path => path.slice(1).map(([x, z], i) => {
    const [ax, az] = path[i];
    const dx = x - ax, dz = z - az;
    return { ax, az, dx, dz, size: dx * dx + dz * dz };
  }));
  const detailed = (x, z) => zones.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)
    || arrivals.some(([ax, az]) => Math.hypot(x - ax, z - az) <= 500)
    || segments.some(({ ax, az, dx, dz, size }) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / size));
      return Math.hypot(x - ax - t * dx, z - az - t * dz) <= 150;
    });
  const newRoads = additions('roads', 'pts');
  function trimRail({ pts, ...rail }) {
    const clipped = [];
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], az = pts[i - 1], dx = pts[i] - ax, dz = pts[i + 1] - az;
      let enter = 0, exit = 1;
      for (const [start, delta, low, high] of [[ax, dx, left - 150, right + 150], [az, dz, top - 150, bottom + 150]]) {
        if (delta) {
          const t0 = (low - start) / delta, t1 = (high - start) / delta;
          enter = Math.max(enter, Math.min(t0, t1));
          exit = Math.min(exit, Math.max(t0, t1));
        } else if (start < low || start > high) {
          exit = -1;
        }
      }
      if (enter > exit) continue;
      if (!clipped.length) clipped.push(r1(ax + enter * dx), r1(az + enter * dz));
      clipped.push(r1(ax + exit * dx), r1(az + exit * dz));
    }
    return { ...rail, pts: clipped };
  }
  const railExtensions = [];
  if (north) {
    const northRails = new Map(data.railways.map(way => [way.id, way]));
    for (const previous of base.railways) {
      const source = northRails.get(previous.id);
      if (!source || !shapeOutside(source.pts)) continue;
      const head = previous.pts.slice(0, 2), tail = previous.pts.slice(-2);
      const first = source.pts.findIndex((x, i) => i % 2 === 0 && x === head[0] && source.pts[i + 1] === head[1]);
      const last = source.pts.findIndex((x, i) => i % 2 === 0 && x === tail[0] && source.pts[i + 1] === tail[1]);
      const earlier = first > 0 && source.pts[1] < head[1] && head[1] < minZ + 210;
      const later = last >= 0 && last < source.pts.length - 2 && source.pts.at(-1) < tail[1] && tail[1] < minZ + 210;
      if (!earlier && !later) continue;
      railExtensions.push(trimRail({
        ...previous, pts: [...(earlier ? source.pts.slice(0, first) : []),
          ...previous.pts, ...(later ? source.pts.slice(last + 2) : [])],
      }));
    }
  }
  const indices = new Map(newRoads.map((road, index) => [road.id, base.roads.length + index]));

  function graphExtension(key) {
    const original = base[key];
    const source = data[key];
    const coordinates = new Map();
    for (const link of original.links) {
      for (const index of link.slice(0, 2)) {
        const location = original.nodes.slice(index * 2, index * 2 + 2).join(',');
        if (!coordinates.has(location)) coordinates.set(location, new Map());
        const candidates = coordinates.get(location);
        if (!candidates.has(index)) candidates.set(index, new Set());
        candidates.get(index).add(link[7]);
      }
    }
    const nodes = [], names = [], links = [], controls = {};
    const nodeIndices = new Map();
    const nameIndices = new Map(original.names.map((name, index) => [name, index]));
    function node(index) {
      if (nodeIndices.has(index)) return nodeIndices.get(index);
      const point = source.nodes.slice(index * 2, index * 2 + 2);
      const candidates = coordinates.get(point.join(','));
      const shared = candidates && [...candidates].find(([, roads]) => [...roads].some(road =>
        base.roads[road].nodeIds.includes(source.osmNodes[index])));
      const target = shared ? shared[0] : (original.nodes.length + nodes.length) / 2;
      if (!shared) {
        nodes.push(...point);
        if (source.controls?.[index]) controls[target] = source.controls[index];
      }
      nodeIndices.set(index, target);
      return target;
    }
    for (const link of source.links) {
      const road = indices.get(roads[link[7]].id);
      if (road === undefined) continue;
      const name = source.names[link[2]];
      if (!nameIndices.has(name)) {
        nameIndices.set(name, original.names.length + names.length);
        names.push(name);
      }
      const a = node(link[0]), b = node(link[1]);
      if (a !== b) links.push([a, b, nameIndices.get(name), ...link.slice(3, 7), road, ...link.slice(8)]);
    }
    return { nodes, names, links, ...(source.controls && { controls }) };
  }

  const closure = north && osm.elements.find(row => row.type === 'way' && row.id === GOUDSBERG_FENCE);
  const northernDetail = closure?.geometry?.length ? [{
    id: `w${closure.id}`, source: 'osm', type: 'fence', level: 0, collidable: true,
    points: geomPts(closure.geometry).map(point => point.map(r1)),
  }] : [];
  return {
    version: 1,
    base: { bounds: base.meta.bounds, roads: base.roads.length, buildings: base.buildings.length,
      roadNodes: base.roadGraph.nodes.length, activeNodes: base.activeGraph.nodes.length },
    bounds: data.meta.bounds,
    geographicBounds,
    detail: { arrivals, routes: paths, ...(north && { zones }) },
    ...(north && { north: true, railExtensions, streetDetail: northernDetail, source: { osmTimestamp: osm.osm3s?.timestamp_osm_base } }),
    buildings: additions('buildings', 'ring').filter(({ ring }) => north ||
      ring.some((x, i) => i % 2 === 0 && detailed(x, ring[i + 1]))),
    roads: newRoads.map(road => ({ ...road, ...roadTags[road.id] })),
    railways: additions('railways', 'pts').map(trimRail).filter(rail => rail.pts.length >= 4),
    water: water.filter(({ ring }) => (!north || within(ring)) &&
      ring.every((x, i) => i % 2 || outside(x, ring[i + 1])))
      .map((row, index) => ({ ...row, id: `${north ? 'north' : 'corridor'}-water${index}` })),
    parks: additions('parks', 'ring'),
    squares: additions('squares', 'ring'),
    trees: trees.filter(({ x, z }) => outside(x, z) && (north ? inRange(x, z) : detailed(x, z))),
    signals: signals.filter(({ x, z }) => outside(x, z) && (!north || inRange(x, z))),
    roadGraph: graphExtension('roadGraph'),
    activeGraph: graphExtension('activeGraph'),
  };
}

const output = corridors ? corridorOverlay() : data;
if (!corridors) {
  const roadTagDir = OUT === MAP_ASSET ? path.join(DIR, '..', 'js') : path.dirname(OUT);
  writeRoadTags(path.join(roadTagDir, 'ede-road-tags.js'), roadTags);
}
fs.writeFileSync(OUT, gzipSync(JSON.stringify(output), { level: 9 }));
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`, JSON.stringify(data.meta.counts));
log('landmarks:', Object.keys(landmarks).join(', '));
log('WKD cycle strips matched', roads.filter(road => road.wkdCycleStrip).length, 'OSM lane-tagged ways');
