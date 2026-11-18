// tools/build-ede-geodata.mjs — writes js/ede-geodata.js from tools/data/osm_ede.json (Overpass, query q_ede.overpassql)
// Frame: 1 unit = 1 m, x = east, z = south, origin at the Oude Kerk (true north up, no grid rotation).
// usage: node tools/build-ede-geodata.mjs [osm_ede.json] [out.js]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const INPUT = process.argv[2] || path.join(DIR, 'data', 'osm_ede.json');
const OUT = process.argv[3] || path.join(DIR, '..', 'js', 'ede-geodata.js');
const osm = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
if (!Array.isArray(osm.elements) || !osm.elements.length || osm.remark) throw new Error('Expected a complete Ede OpenStreetMap response');
const log = (...a) => console.log('[ede-geodata]', ...a);

const BBOX = [52.012, 5.5925, 52.0605, 5.7005]; // S, W, N, E: must match q_ede.overpassql
const LAT0 = 52.0460029; // Oude Kerk
const LON0 = 5.671553;
const R = 6378137;
const KY = (Math.PI / 180) * R;
const KX = KY * Math.cos((LAT0 * Math.PI) / 180);
const r1 = (v) => Math.round(v * 10) / 10;
const toWorld = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
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
const WIDTH = { motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7, residential: 6, unclassified: 6, living_street: 5, service: 3.5, pedestrian: 5, cycleway: 2.5, footway: 2, path: 1.5, steps: 2, track: 3 };
const LANES = { motorway: 4, trunk: 4, primary: 2, secondary: 2, tertiary: 2, residential: 2, unclassified: 2, living_street: 1, service: 1 };
const DRIVABLE = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street']);
const drivable = [];
const roads = [];
const railways = [];
const signals = [];
const trees = [];
for (const e of osm.elements) {
  const t = e.tags || {};
  if (e.type === 'node') {
    const [x, z] = toWorld(e.lon, e.lat);
    if (t.natural === 'tree') trees.push({ x: r1(x), z: r1(z), h: r1(num(t.height) ?? 8) });
    else if (t.highway === 'traffic_signals') signals.push({ x: r1(x), z: r1(z) });
    continue;
  }
  if (e.type !== 'way' || !e.geometry) continue;
  const bridge = !!t.bridge && t.bridge !== 'no';
  const tunnel = (!!t.tunnel && t.tunnel !== 'no') || t.covered === 'yes';
  const layer = num(t.layer) ?? (bridge ? 1 : tunnel ? -1 : 0);
  if (t.railway && /^(rail|light_rail|tram|subway)$/.test(t.railway)) {
    railways.push({ id: `w${e.id}`, pts: flat(rdp(geomPts(e.geometry), 0.5)), bridge, tunnel, layer, kind: t.railway });
    continue;
  }
  if (!t.highway || /^(proposed|construction|platform|bus_stop|corridor|elevator|raceway)$/.test(t.highway)) continue;
  const kind = t.highway.replace(/_link$/, '') in WIDTH ? t.highway : 'service';
  const base = kind.replace(/_link$/, '');
  const lanes = num(t.lanes) ?? LANES[base] ?? 1;
  const width = num(t.width) ?? Math.max(WIDTH[base] ?? 3, lanes * 3);
  const oneway = t.oneway === 'yes' || t.oneway === '-1' || t.oneway === '1' || t.junction === 'roundabout';
  roads.push({ id: `w${e.id}`, pts: flat(rdp(geomPts(e.geometry), 0.5)), bridge, tunnel, layer, name: t.name || '', width: r1(width), lanes, oneway, reverse: t.oneway === '-1', kind, nodeIds: e.nodes || [] });
  if (DRIVABLE.has(kind) && !tunnel && e.nodes && e.nodes.length === e.geometry.length) {
    drivable.push({ name: t.name || '', width: r1(width), lanes, dir: !oneway ? 0 : t.oneway === '-1' ? -1 : 1, nodes: e.nodes, pts: geomPts(e.geometry) });
  }
}

// --- Street centreline graph: ways cut at every node shared by two ways (and at their ends) ----------------------------
// links: [node a, node b, name index, width, lanes, direction (1: a -> b, -1: b -> a, 0: both), inner shape points [x, z, ...]]
if (!drivable.length || !buildings.length) throw new Error('Ede snapshot is missing roads or buildings');

const roadGraph = (() => {
  const uses = new Map();
  for (const w of drivable) for (const id of new Set(w.nodes)) uses.set(id, (uses.get(id) || 0) + 1);
  const ids = new Map();
  const nodes = [];
  const names = [];
  const nameIds = new Map();
  const nodeOf = (id, p) => { if (!ids.has(id)) { ids.set(id, nodes.length / 2); nodes.push(r1(p[0]), r1(p[1])); } return ids.get(id); };
  const nameOf = (n) => { if (!nameIds.has(n)) { nameIds.set(n, names.length); names.push(n); } return nameIds.get(n); };
  const links = [];
  for (const w of drivable) {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const last = i === w.nodes.length - 1;
      if (!last && uses.get(w.nodes[i]) < 2 && w.nodes[i] !== w.nodes[0]) continue;
      if (w.nodes[i] === w.nodes[start]) { start = i; continue; }
      const seg = w.pts.slice(start, i + 1);
      const inner = rdp(seg, 0.4).slice(1, -1).flatMap(([x, z]) => [r1(x), r1(z)]);
      links.push([nodeOf(w.nodes[start], seg[0]), nodeOf(w.nodes[i], seg[seg.length - 1]), nameOf(w.name), w.width, w.lanes, w.dir, inner]);
      start = i;
    }
  }
  return { nodes, links, names };
})();

// --- Water & parks -------------------------------------------------------------------------------------------------------
const water = [];
const parks = [];
const squares = [];
for (const e of osm.elements) {
  const t = e.tags || {};
  if (e.type === 'node') continue;
  const isWater = t.natural === 'water' || /^(riverbank|dock)$/.test(t.waterway || '');
  const isPark = t.natural === 'wood' || /^(park|garden|playground|pitch)$/.test(t.leisure || '') || /^(grass|recreation_ground|cemetery|village_green|forest)$/.test(t.landuse || '');
  const isSquare = t.place === 'square' || (t.highway === 'pedestrian' && t.area === 'yes');
  if (!isWater && !isPark && !isSquare) continue;
  for (const p of polygons(e)) {
    const ring = cleanRing(p.ring);
    if (ring.length < 3 || Math.abs(ringArea(ring)) < 20) continue;
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

const [s, w, n, eLon] = BBOX;
const [minX, maxZ0] = toWorld(w, s);
const [maxX, minZ] = toWorld(eLon, n);
const data = {
  meta: {
    name: 'Ede', city: 'Ede',
    bounds: [r1(minX), r1(minZ), r1(maxX), r1(maxZ0)],
    geographicBounds: [s, w, n, eLon],
    frame: 'x = east, z = south, metres; origin at the Oude Kerk',
    coordinateSystem: 'x east, z south, metres',
    lonLatAffine: { lon0: LON0, lat0: LAT0, x: [0, r1(KX * 1e3) / 1e3, 0], z: [0, 0, -r1(KY * 1e3) / 1e3], maxErrorM: 0.5 },
    sources: [
      { name: 'OpenStreetMap contributors', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' },
      { name: 'CBS Wijk- en Buurtkaart 2025', url: 'https://www.cbs.nl/nl-nl/dossier/nederland-regionaal/geografische-data/wijk-en-buurtkaart-2025' }
    ],
    areas: AREAS,
    counts: { buildings: buildings.length, roads: roads.length, water: water.length, parks: parks.length, squares: squares.length, railways: railways.length, trees: trees.length, signals: signals.length }
  },
  buildings, roads, water, parks, squares, railways, trees, signals, landmarks, roadGraph
};
fs.writeFileSync(OUT, `// js/ede-geodata.js — GENERATED by tools/build-ede-geodata.mjs, do not edit by hand.\n// Ede, 1 unit = 1 m, x east, z south, origin at the Oude Kerk. © OpenStreetMap contributors (ODbL).\nexport const EDE_DATA = ${JSON.stringify(data)};\n`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`, JSON.stringify(data.meta.counts));
log('landmarks:', Object.keys(landmarks).join(', '));
