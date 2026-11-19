// Run after starting the local game server and Chrome with --remote-debugging-port=9297.
// node tools/audit-ede-crossings.mjs [report.json] [http://127.0.0.1:8990] [debug-port] [site-filter]
import { readFile, writeFile } from 'node:fs/promises';
import { EDE_DATA } from '../js/ede-geodata.js';
import { BUS, CAR, VAN, BICYCLE, FOOT, fitsRoad, VEHICLE_CLEARANCE } from '../js/road-access.js';

const [output = '/tmp/ede-crossing-checks.json', origin = 'http://127.0.0.1:8990', port = '9297', filter = ''] = process.argv.slice(2);
const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const [catalog, grade] = await Promise.all([read('./data/ede-crossing-sites.json'), read('../assets/ede-grade.json')]);
const ways = new Map([...EDE_DATA.roads, ...EDE_DATA.railways].map(way => [way.id, way]));
const gradeSites = new Map(grade.sites.map(site => [site.id, site]));
const modeBits = { car: CAR, van: VAN, bus: BUS, cyclist: BICYCLE, person: FOOT };
const routePoints = way => Array.from({ length: way.pts.length / 2 }, (_, i) => way.pts.slice(i * 2, i * 2 + 2));
const length = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const heading = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const endpoints = new Map();
const passageJunctions = new Map();
for (const way of ways.values()) {
  const points = routePoints(way);
  if (points.length < 2) continue;
  for (const path of [points, [...points].reverse()]) {
    const key = path[0].join(',');
    if (!endpoints.has(key)) endpoints.set(key, []);
    endpoints.get(key).push({ way, path });
    if (way.tunnelType === 'building_passage') {
      for (let i = 1; i < path.length - 1; i++) {
        const key = path[i].join(',');
        if (!passageJunctions.has(key)) passageJunctions.set(key, []);
        passageJunctions.get(key).push({ way, path: path.slice(i) });
      }
    }
  }
}

export function stations(points) {
  return points.reduce((out, point, i) => [...out, i ? out.at(-1) + length(points[i - 1], point) : 0], []);
}

function atDistance(points, offsets, s) {
  const i = Math.max(1, offsets.findIndex(offset => offset >= s));
  const t = (s - offsets[i - 1]) / (offsets[i] - offsets[i - 1]);
  return points[i].map((v, j) => points[i - 1][j] + (v - points[i - 1][j]) * t);
}

export function nearestOnRoute(points, offsets, x, z) {
  let best = { distance: Infinity };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], n = offsets[i] - offsets[i - 1];
    if (n < 0.001) continue;
    const along = clamp(((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / n, 0, n);
    const dx = a[0] + (b[0] - a[0]) * along / n - x;
    const dz = a[1] + (b[1] - a[1]) * along / n - z;
    const distance = Math.hypot(dx, dz);
    if (distance < best.distance) best = { distance, s: offsets[i - 1] + along, i };
  }
  return best;
}

function trim(points, center, interval) {
  const offsets = stations(points);
  const cross = nearestOnRoute(points, offsets, ...center).s;
  if (!Number.isFinite(cross)) return null;
  const start = Math.max(0, cross - interval), end = Math.min(offsets.at(-1), cross + interval);
  if (end - start < 1) return null;
  return {
    points: [atDistance(points, offsets, start), ...points.filter((_, i) => start < offsets[i] && offsets[i] < end),
      atDistance(points, offsets, end)], middle: atDistance(points, offsets, cross)
  };
}

function directionsFor(way, profile) {
  if (!way.modes) return { forward: ['train'], reverse: ['train'] };
  const fits = (mode, bit) => {
    const group = mode === 'person' ? 'foot' : mode === 'cyclist' ? 'bike' : 'motor';
    const vehicle = VEHICLE_CLEARANCE[mode];
    return (!profile?.modes || profile.modes.includes(group)) && (!vehicle ||
      fitsRoad(vehicle, way.limits, bit) && (profile?.entryHeightLimit == null || vehicle.height <= profile.entryHeightLimit));
  };
  return Object.fromEntries(['forward', 'reverse'].map((direction, i) => [direction,
    Object.entries(modeBits).filter(([mode, bit]) => (way.modes[i] & bit) && fits(mode, bit)).map(([mode]) => mode)]));
}

function withApproaches(way, portals) {
  let points = routePoints(way);
  const isPassage = way.tunnelType === 'building_passage';
  const used = new Set([way.id]);
  for (let side = 0; side < 2; side++) {
    let added = 0;
    while (points.length > 1 && added < 58) {
      const a = points.at(-2), b = points.at(-1);
      const key = b.join(',');
      const candidates = [...(endpoints.get(key) ?? []), ...(isPassage ? passageJunctions.get(key) ?? [] : [])].filter(item =>
        item.way.kind === way.kind && !used.has(item.way.id));
      const aligned = candidates.map(item => ({ ...item,
        scale: Math.cos(heading(a, b) - heading(item.path[0], item.path[1])) }))
        .filter(item => item.scale > 0.66).sort((a, b) => b.scale - a.scale);
      if (!aligned.length) break;
      const next = aligned[0];
      used.add(next.way.id);
      if (isPassage && next.way.tunnelType !== 'building_passage') {
        points.push(...(trim(next.path, b, 12)?.points ?? next.path).slice(1));
        break;
      }
      if (portals) portals[1 - side] = next.path.at(-1);
      points.push(...next.path.slice(1));
      added += stations(next.path).at(-1);
    }
    points = points.reverse();
  }
  return points;
}

function levels(site) {
  const ids = rows => (rows || []).map(value => String(value).startsWith('w') ? String(value) : 'w' + value);
  if (site.kind === 'level') return { shared: ids(site.wayIds) };
  return { upper: ids(site.upperWayIds), lower: ids(site.lowerWayIds) };
}

function planFor(site) {
  const own = gradeSites.get(site.gradeId ?? site.id);
  const nearby = grade.sites.filter(g => g === own || g.profiles.some(p =>
    p.points.some(([x, z]) => length(site.center, [x, z]) < 80)));
  const fallbackLevels = levels(site);
  if (!Object.values(fallbackLevels).some(ids => ids.length) && site.wayIds?.length) {
    fallbackLevels.upper = site.kind === 'bridge' ? site.wayIds : [];
    fallbackLevels.lower = site.kind === 'bridge' ? [] : site.wayIds;
  }
  const results = [];
  for (const [level, ids] of Object.entries(fallbackLevels)) {
    const seen = new Set();
    for (const id of ids) {
      const way = ways.get(id);
      if (!way) continue;
      const fitted = nearby.flatMap(g => g.profiles.filter(p => p.wayIds?.includes(id)
        && (level === 'shared' || g.kind === (level === 'upper' ? 'bridge' : 'underpass'))));
      for (const profile of fitted.length ? fitted : [null]) {
        const key = profile?.id ?? id;
        if (seen.has(key)) continue;
        seen.add(key);
        const intersections = (site.crossings ?? []).filter(point => point.upperWayId === id || point.lowerWayId === id);
        const center = intersections.length ? intersections[Math.floor(intersections.length / 2)].center : site.center;
        const original = routePoints(way);
        const passage = !profile && way.tunnelType === 'building_passage' && (way.layer ?? 0) <= 0;
        const portals = passage ? [original[0], original.at(-1)] : [];
        const sample = passage ? trim(original, center, Infinity) : trim(profile?.points ?? withApproaches(way), center, profile ? 62 : 50);
        if (!sample) continue;
        if (passage) sample.points = withApproaches(way, portals);
        const steps = stations(sample.points);
        const middle = nearestOnRoute(sample.points, steps, ...sample.middle);
        const axis = heading(sample.points[middle.i - 1], sample.points[middle.i]);
        const originalHit = nearestOnRoute(original, stations(original), ...sample.middle);
        const originalAxis = heading(original[originalHit.i - 1], original[originalHit.i]);
        const directions = directionsFor(way, profile);
        const reversed = Math.cos(axis - originalAxis) < 0;
        if (reversed) {
          [directions.forward, directions.reverse] = [directions.reverse, directions.forward];
        }
        const stationsToCheck = (profile?.covered ?? profile?.span ?? []).flat();
        const measures = profile ? stations(profile.points) : [];
        portals.push(...stationsToCheck.map(s => atDistance(profile.points, measures, clamp(s, 0, measures.at(-1)))));
        results.push({ level, way: id, profile: profile?.id, structure: way.tunnelType ?? (way.tunnel ? 'tunnel' : way.bridge ? 'bridge' : null),
          modelled: !!profile || passage,
          reversed, directions, ...sample, portals, heading: axis });
      }
    }
  }
  return { ...site, routes: results };
}

const selectors = filter.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
const sites = catalog.sites.filter(site => !selectors.length ||
  selectors.some(value => (site.id + ' ' + site.name).toLowerCase().includes(value))).map(planFor);
if (!sites.length) throw new Error('No crossing sites selected');
const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
const page = pages.find(tab => tab.type === 'page');
if (!page) throw new Error('Open a page in the isolated Chrome session');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
const pending = new Map();
let nextId = 0;
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const wait = pending.get(message.id);
  if (!wait) return;
  pending.delete(message.id);
  if (message.error) wait.reject(new Error(message.error.message));
  else wait.resolve(message.result);
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result.value;
}
try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp('Page.navigate', { url: origin + '/' });
  for (let tries = 0; !await evaluate('window.__slopwaw?.ready === true').catch(() => false); tries++) {
    if (tries >= 100) throw new Error('Game did not load: ' + await evaluate('document.querySelector("#loading-status")?.textContent'));
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  await evaluate('(async () => { window.edeCrossingAudit = (await import("/tools/audit-ede-crossing-route.mjs")).auditSite })()');
  const report = { version: 1, datumNAP: grade.datumNAP, backend: await evaluate('__slopwaw.backend'), sites: [] };
  for (const site of sites) {
    report.sites.push(await evaluate('window.edeCrossingAudit(window.__slopwaw,' + JSON.stringify(site) + ')'));
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(site.id, site.routes.length);
  }
} finally {
  ws.close();
}
