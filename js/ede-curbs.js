import { containsPavingRing } from './ede-road-surfaces.js';

const CELL = 32;
const key = (x, z) => Math.floor(x / CELL) + '/' + Math.floor(z / CELL);
let profiles = new Map(), tactile = new Map(), cells = new Map(), tables = new Map(), driveways = new Map();
let sites = new Map(), gradeLifts = new Map(), paintGaps = new Map(), tableId, roadLift;
let municipal = null, municipalCaps = new Map(), municipalFlats = new Map();

function index(cells, [ax, ay, az, bx, by, bz, cx, cy, cz]) {
  const dx = bx - ax, dz = bz - az, ex = cx - ax, ez = cz - az;
  const area = dx * ez - dz * ex;
  if (!Number.isFinite(area) || Math.abs(area) < 1e-9) return;
  const plane = { ax, ay, az, dx, dz, ex, ez, area, by: by - ay, cy: cy - ay };
  for (let x = Math.floor(Math.min(ax, bx, cx) / CELL); x <= Math.floor(Math.max(ax, bx, cx) / CELL); x++) {
    for (let z = Math.floor(Math.min(az, bz, cz) / CELL); z <= Math.floor(Math.max(az, bz, cz) / CELL); z++) {
      const key = x + '/' + z;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(plane);
    }
  }
}

function heightIn(cells, cell, x, z) {
  let height;
  for (const { ax, ay, az, dx, dz, ex, ez, area, by, cy } of cells.get(cell) ?? []) {
    const u = ((x - ax) * ez - (z - az) * ex) / area;
    const v = (dx * (z - az) - dz * (x - ax)) / area;
    if (u >= -1e-5 && v >= -1e-5 && u + v <= 1 + 1e-5) {
      const y = ay + u * by + v * cy;
      if (height === undefined || y > height) height = y;
    }
  }
  return height;
}

export function setEdeCurbs(asset) {
  profiles = new Map(Object.entries(asset?.profiles ?? {}));
  tactile = new Map(Object.entries(asset?.tactile ?? {}));
  paintGaps = new Map(Object.entries(asset?.paintGaps ?? {}));
  cells = new Map();
  tables = new Map();
  driveways = new Map();
  sites = new Map();
  municipal = asset?.version === 2 ? asset : null;
  municipalCaps = new Map();
  municipalFlats = new Map();
  for (const site of [...asset?.sites ?? [], ...municipal?.transitionSites ?? []]) {
    const [cx, cz, radius] = site;
    for (let x = Math.floor((cx - radius) / CELL); x <= Math.floor((cx + radius) / CELL); x++) {
      for (let z = Math.floor((cz - radius) / CELL); z <= Math.floor((cz + radius) / CELL); z++) {
        const cell = x + '/' + z;
        if (!sites.has(cell)) sites.set(cell, []);
        sites.get(cell).push(site);
      }
    }
  }
  gradeLifts = new Map(Object.entries(asset?.gradeProfiles ?? {}));
  tableId = asset?.table;
  roadLift = asset?.roadLift;
  const drivewayIds = new Set(asset?.driveways);
  for (const [id, tops] of profiles) {
    for (const top of tops) {
      for (let i = 0; i < top.length; i += 9) {
        const triangle = top.slice(i, i + 9);
        index(cells, triangle);
        if (drivewayIds.has(id)) index(driveways, triangle);
      }
    }
  }
}

export async function loadEdeCurbs(municipality = false) {
  const url = municipality ? '../assets/ede-curbs-v2.json.gz?v=20261127-toorop-zebra' : '../assets/ede-curbs-v1.json.gz?v=20261127-toorop-zebra';
  const response = await fetch(new URL(url, import.meta.url));
  if (municipality && response.status === 404) return loadEdeCurbs();
  if (!response.ok) throw new Error('Ede curb profiles returned HTTP ' + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const stream = new Response(bytes);
  const reader = bytes[0] === 31 && bytes[1] === 139
    ? new Response(stream.body.pipeThrough(new DecompressionStream('gzip'))) : stream;
  const asset = await reader.json();
  const validTop = top => Array.isArray(top) && top.length > 0 && top.length % 9 === 0 && top.every(Number.isFinite);
  if (asset.version !== (municipality ? 2 : 1) || !asset.profiles || !Array.isArray(asset.sites) || !Number.isFinite(asset.roadLift)
      || !asset.sites.every(site => Array.isArray(site) && site.length === 3 && site.every(Number.isFinite) && site[2] > 0)
      || !Object.values(asset.profiles).every(tops => Array.isArray(tops) && tops.every(validTop))
      || !Object.values(asset.tactile ?? {}).every(validTop)
      || !Object.values(asset.paintGaps ?? {}).every(width => Number.isFinite(width) && width > 0)) {
    throw new Error('Invalid Ede curb profiles');
  }
  if (municipality && (!asset.flat || !asset.tops || !Array.isArray(asset.transitionSites)
      || !asset.transitionSites.every(site => Array.isArray(site) && site.length === 3 && site.every(Number.isFinite) && site[2] > 0)
      || !Object.values(asset.tops).every(parts => Object.values(parts).every(validTop))
      || !Object.values(asset.flat).every(parts => Object.values(parts).every(y => Number.isFinite(y) && y > asset.roadLift)))) {
    throw new Error('Invalid Ede municipal curb profiles');
  }
  setEdeCurbs(asset);
}

export function bindEdeCurbPaving(surfaces) {
  if (!municipal) return;
  municipalCaps = new Map();
  municipalFlats = new Map();
  for (const { id, layer, polygons } of surfaces) {
    const flat = municipal.flat[id], tops = municipal.tops[id];
    if (layer || !flat && !tops) continue;
    for (const [part, [outer, ...holes]] of polygons.entries()) {
      const top = tops?.[part];
      if (top) {
        for (let i = 0; i < top.length; i += 9) index(municipalCaps, top.slice(i, i + 9));
      }
      if (flat?.[part] === undefined) continue;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
        minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
      }
      const surface = { outer, holes, minX, maxX, minZ, maxZ, y: flat[part] };
      for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
        for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
          const cell = x + '/' + z;
          if (!municipalFlats.has(cell)) municipalFlats.set(cell, []);
          municipalFlats.get(cell).push(surface);
        }
      }
    }
  }
}

export function curbGeometryFor(id, polygon) {
  return profiles.get(id)?.[polygon] ?? municipal?.tops[id]?.[polygon] ?? municipal?.flat[id]?.[polygon];
}

export const curbTactileFor = id => tactile.get(id);

export const curbPaintGapFor = id => paintGaps.get(id);

export const curbGradeLift = id => gradeLifts.get(id);

export function registerCurbTable(id, triangles) {
  if (id !== tableId) return;
  for (const triangle of triangles) index(tables, triangle.flat());
}

export function curbHeightAt(x, z, base, layer, allowCurbs = true) {
  if (layer || !sites.size && !municipal) return undefined;
  const cell = key(x, z);
  const table = heightIn(tables, cell, x, z);
  if (table !== undefined) return table;
  const top = heightIn(allowCurbs ? cells : driveways, cell, x, z);
  if (top > roadLift + 1e-5) return base + top;
  if (allowCurbs && municipal) {
    const ramp = heightIn(municipalCaps, cell, x, z);
    if (ramp !== undefined) return base + ramp;
    for (const { outer, holes, minX, maxX, minZ, maxZ, y } of municipalFlats.get(cell) ?? []) {
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ && containsPavingRing(outer, x, z)
          && !holes.some(hole => containsPavingRing(hole, x, z))) return base + y;
    }
  }
  // Nearby road, path and cut-through meshes have the mapped pavement lift.
  for (const [cx, cz, radius] of sites.get(cell) ?? []) {
    const distance = Math.hypot(x - cx, z - cz);
    if (distance < radius) return base + roadLift * Math.min(1, (radius - distance) / 4);
  }
}
