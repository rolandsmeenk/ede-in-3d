import * as THREE from 'three/webgpu';
import { EDE_DATA } from './ede-geodata.js';
import { blockAt, waterAtExact } from './city-config.js';
import { edeSpatialGroups, nearestEdeRoad, overlapsEdeTravelPavement } from './ede-geometry.js';
import { gradeProfileAt } from './ede-grade.js';
import { containsPlayablePoint } from './ede-playable-boundary.js';
import { projectLonLatInto } from './ede-scene-coordinates.js';
import { terrainHeightAt } from './terrain.js';
import { EDE_BUS_SHELTER_SITES } from './ede-bus-shelter-sites.js';
import { batchBusStopParts, buildEdeBusShelters } from './ede-bus-shelters.js';

const TILE = 0.3;
const SIGN_SIZE = 0.46;
const POLE_HEIGHT = 2.47;
const CELL_WIDTH = 216, CELL_HEIGHT = 88, COLUMNS = 8;
const FACE = [4, 4, 64, 64], PAVER = [72, 4, 16, 16], CURB = [92, 4, 16, 16];
const WHITE = [112, 4, 16, 16], DARK = [132, 4, 16, 16];
const RIBS = [152, 4, 16, 32], DOTS = [172, 4, 32, 48];

const keyFor = ({ x, z, platform = '' }) => [x, z, platform].join('/');
const compareLines = (a, b) => String(a).localeCompare(String(b), 'nl', { numeric: true });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function collectEdeBusStops(variants, bounds = EDE_DATA.meta.bounds) {
  const [minX, minZ, maxX, maxZ] = bounds;
  const platforms = new Map();
  for (const { line, stops } of variants) {
    for (let i = 0; i < stops.length; i++) {
      const { x, z, name, platform = '', id } = stops[i];
      if (!(x >= minX && x <= maxX && z >= minZ && z <= maxZ)) continue;
      const key = keyFor(stops[i]);
      if (!platforms.has(key)) {
        const before = Number.isFinite(stops[i - 1]?.x) ? stops[i - 1] : stops[i];
        const after = Number.isFinite(stops[i + 1]?.x) ? stops[i + 1] : stops[i];
        const heading = Math.atan2(after.x - before.x, after.z - before.z);
        platforms.set(key, { x, z, name, platform, heading, ids: new Set(), lines: new Set() });
      }
      const stop = platforms.get(key);
      stop.ids.add(id);
      stop.lines.add(line);
    }
  }
  return [...platforms.values()].map(stop => ({ ...stop, ids: [...stop.ids],
    lines: [...stop.lines].sort(compareLines) }));
}

export function boardingDirections({ variants, edges }) {
  const segments = edges.map(edge => edge.split(',').map(Number));
  const directions = new Map();
  for (const variant of variants) for (const slice of variant.slices) {
    for (const { index, leg } of slice.stops ?? []) {
      const stop = variant.stops[index];
      const edge = segments[slice.legs[leg]?.edge];
      if (!stop || !edge) continue;
      const [ax, az, bx, bz] = edge;
      const length = Math.hypot(bx - ax, bz - az);
      if (!length) continue;
      const tx = (bx - ax) / length, tz = (bz - az) / length;
      const along = (stop.x - ax) * tx + (stop.z - az) * tz;
      const lateral = (stop.z - az) * tx - (stop.x - ax) * tz;
      const score = Math.abs(lateral) + Math.abs(along - clamp(along, 0, length)) + (lateral < -0.5 ? 20 : 0);
      const key = keyFor(stop);
      if ((directions.get(key)?.score ?? Infinity) <= score) continue;
      directions.set(key, { tx, tz, ax: ax + along * tx, az: az + along * tz, score });
    }
  }
  return directions;
}

function roadsideDirection(stop, bearing) {
  const road = nearestEdeRoad(stop.x, stop.z, 16, undefined, 0);
  if (!road || road.bridge) return;
  const { ux, uz, x, z } = road;
  const side = (stop.z - z) * ux - (stop.x - x) * uz;
  const flip = Number.isFinite(bearing) ? ux * Math.sin(bearing) - uz * Math.cos(bearing) < 0 : side < 0;
  const tx = flip ? -ux : ux, tz = flip ? -uz : uz;
  return { tx, tz, ax: x, az: z };
}

export function fitEdeBusStop(stop, config, trafficAt, clearAt, groundAt) {
  const { x, z, tx, tz, ax, az } = stop;
  const side = (z - az) * tx - (x - ax) * tz;
  const point = (u, v) => ({ x: x + u * tx - v * tz, z: z + u * tz + v * tx });
  const traffic = (u, v) => { const p = point(u, v); return trafficAt(p.x, p.z); };
  const clear = (u, v, margin = 0.06) => { const p = point(u, v); return clearAt(p.x, p.z, margin); };
  const pavement = (u, v) => { const p = point(u, v); return groundAt(p.x, p.z); };
  // Follow the road outward from the boarding lane. A bike path beyond it is a separate obstacle.
  function findEdge(u) {
    if (!Number.isFinite(side) || side < -1.3) return;

    let inside = false;
    for (let v = -side - 0.5; v <= Math.min(7.5, 12 - side); v += 0.2) {
      if (traffic(u, v)) inside = true;
      else if (inside) {
        let a = v - 0.2, b = v;
        for (let i = 0; i < 5; i++) {
          const m = (a + b) / 2;
          if (traffic(u, m)) a = m; else b = m;
        }
        if (b >= -3.5) return b + 0.12;
        break;
      }
    }
  }

  const edge = findEdge(0);
  const width = clamp(config.platformWidth ?? 1.5, 1.2, 3);
  const length = clamp(config.platformLength ?? 12, 3.6, 24);
  let platform;
  if (edge !== undefined && config.platform !== false) {
    for (const size of new Set([length, Math.min(length, 7.2), Math.min(length, 3.6)])) {
      const start = 1.5 - size, end = 1.5;
      const n = Math.ceil(size / 0.6);
      const kerb = [];
      for (let i = 0; i <= n; i++) {
        const u = start + size * i / n;
        const v = findEdge(u);
        if (v === undefined || Math.abs(v - edge) > 0.9 ||
            (i && Math.abs(v - kerb[i - 1]) > 0.35) ||
            ![v, v + width / 2, v + width].every(v => clear(u, v))) break;
        kerb.push(v);
      }
      if (kerb.length !== n + 1) continue;
      const offsetAt = u => {
        const i = clamp((u - start) / size * n, 0, n);
        const a = Math.min(n - 1, Math.floor(i));
        return kerb[a] + (kerb[a + 1] - kerb[a]) * (i - a);
      };
      const height = clamp(config.curbHeight ?? 0.18, 0, 0.24);
      const roadbed = u => pavement(u, offsetAt(u) - 0.22) + 0.065;
      const bed = (u, v) => {
        const rise = height * clamp(Math.min(u - start, end - u) / 0.65, 0, 1);
        const slope = clamp((v - 0.38) / (width - 0.38), 0, 1);
        const ground = pavement(u, offsetAt(u) + v) + 0.037;
        return Math.max(ground, (roadbed(u) + rise) * (1 - slope) + ground * slope);
      };
      platform = { start, end, width, offsetAt, bed, roadbed,
        tactile: config.tactile !== false, markings: config.markings !== false };
      break;
    }
  }
  const offsets = config.signOffset ? [config.signOffset] : [];
  for (const u of [1.8, 1.05, 0, -1.05, -2.4, -3.6, 3, -4.8, 4.5, -6]) {
    const localEdge = findEdge(u) ?? edge;
    const back = localEdge === undefined
      ? [0, 0.6, 1.2, 1.8, 2.5, 3.2, 4, 4.8, 5.6, 6.4, 7.2]
      : [localEdge + (platform ? width + 0.20 : 0.48), localEdge + 0.48, localEdge + 1.25,
        localEdge + 1.8, localEdge + 2.5, localEdge + 3.2, localEdge + 4, localEdge + 4.8];
    for (const v of back) {
      if (Math.hypot(u, v) <= 8.5 && (!Number.isFinite(side) || v >= -side + 0.55)) offsets.push([u, v]);
    }
  }
  for (const [u, v] of offsets) {
    if (!clear(u, v, 0.30)) continue;
    const sign = point(u, v);
    const across = platform ? v - platform.offsetAt(u) : Infinity;
    const onPlatform = platform && u >= platform.start && u <= platform.end && across >= 0 && across <= platform.width;
    if (onPlatform && platform.tactile &&
        across >= 0.45 && across <= (Math.abs(u) < 0.57 ? 1.2 : 0.92)) continue;
    sign.y = onPlatform ? platform.bed(u, across) : groundAt(sign.x, sign.z);
    return { x, z, tx, tz, point, platform, sign, curb: edge };
  }
}

function drawAtlas(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = COLUMNS * CELL_WIDTH;
  canvas.height = Math.ceil((stops.length + 1) / COLUMNS) * CELL_HEIGHT;
  const ctx = canvas.getContext('2d');
  const fill = (color, rect) => { ctx.fillStyle = color; ctx.fillRect(...rect); };
  fill('#07558e', [0, 0, 72, 72]);
  fill('#f7f8f7', [7, 7, 58, 58]);
  fill('#07558e', [9, 9, 54, 54]);
  fill('#f7f8f7', [13, 13, 46, 46]);
  fill('#111616', [23, 22, 26, 26]);
  fill('#111616', [22, 33, 28, 10]);
  fill('#111616', [25, 46, 5, 5]);
  fill('#111616', [42, 46, 5, 5]);
  fill('#f7f8f7', [26, 26, 20, 11]);
  fill('#f7f8f7', [26, 41, 4, 3]);
  fill('#f7f8f7', [42, 41, 4, 3]);

  fill('#94928b', PAVER);
  fill('#73726e', [72, 4, 1, 16]);
  fill('#73726e', [72, 4, 16, 1]);
  fill('#b9b8ad', CURB);
  fill('#e4e3dc', WHITE);
  fill('#444544', DARK);
  fill('#c4beaa', RIBS);
  for (let j = 7; j < 36; j += 6) {
    fill('#9c9688', [152, j, 16, 2]);
    fill('#e5dfcb', [152, j + 2, 16, 1]);
  }
  fill('#c4beaa', DOTS);
  for (let x = 176; x < 204; x += 7) for (let y = 8; y < 52; y += 7) {
    ctx.fillStyle = '#ebe5d3';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textBaseline = 'middle';
  stops.forEach((stop, i) => {
    const x = ((i + 1) % COLUMNS) * CELL_WIDTH, y = Math.floor((i + 1) / COLUMNS) * CELL_HEIGHT;
    stop.panel = [x + 3, y + 3, CELL_WIDTH - 6, CELL_HEIGHT - 6];
    fill('#f5f6f2', [x, y, CELL_WIDTH, CELL_HEIGHT]);
    fill('#173b4b', [x, y, CELL_WIDTH, 34]);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px Arial, sans-serif';
    ctx.textAlign = 'left';
    const suffix = '-' + stop.platformCode;
    const name = stop.platformCode && stop.name.endsWith(suffix) ? stop.name.slice(0, -suffix.length) : stop.name;
    ctx.fillText(name, x + 9, y + 18, stop.platformCode ? 164 : 198);
    if (stop.platformCode) {
      fill('#fff', [x + 180, y + 5, 29, 24]);
      ctx.fillStyle = '#173b4b';
      ctx.textAlign = 'center';
      ctx.fillText(stop.platformCode, x + 194, y + 18, 24);
    }
    const count = Math.min(stop.lines.length, 14);
    const cols = Math.min(count, 7);
    const badge = 196 / Math.max(1, cols);
    ctx.textAlign = 'center';
    ctx.font = 'bold 17px Arial, sans-serif';
    for (let j = 0; j < count; j++) {
      const left = x + 10 + (j % cols) * badge;
      const top = y + 38 + Math.floor(j / cols) * 22;
      fill('#173b4b', [left, top, badge - 4, 20]);
      ctx.fillStyle = '#fff';
      ctx.fillText(stop.lines[j], left + (badge - 4) / 2, top + 11, badge - 6);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function stopSurfaces(stop, quad) {
  const { sign, tx, tz, point, platform, panel } = stop;
  for (const side of [-1, 1]) {
    const face = (bottom, width, height, rect) => {
      const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([u, v]) =>
        [sign.x + side * (tx * 0.046 + tz * u * width / 2), sign.y + bottom + v * height,
          sign.z + side * (tz * 0.046 - tx * u * width / 2)]);
      quad(corners, rect);
    };
    face(POLE_HEIGHT - SIGN_SIZE, SIGN_SIZE, SIGN_SIZE, FACE);
    face(POLE_HEIGHT - SIGN_SIZE - 0.25, 0.46, 0.19, panel);
  }
  if (!platform) return;

  const { start, end, width, offsetAt, bed, roadbed, tactile, markings } = platform;
  const top = (u, v, lift = 0) => {
    const p = point(u, offsetAt(u) + v);
    return [p.x, bed(u, v) + lift, p.z];
  };
  const tile = (a, b, near, far, rect, lift) => quad(
    [top(a, far, lift), top(b, far, lift), top(b, near, lift), top(a, near, lift)], rect);
  const rows = Math.round((width - 0.19) / TILE);
  const step = (width - 0.19) / rows;
  const rib = 0.49;
  const n = Math.ceil((end - start) / TILE);
  for (let i = 0; i < n; i++) {
    const a = start + (end - start) * i / n, b = start + (end - start) * (i + 1) / n;
    const toe = u => {
      const p = point(u, offsetAt(u));
      return [p.x, roadbed(u) - 0.025, p.z];
    };
    quad([toe(b), toe(a), top(a, 0.06), top(b, 0.06)], CURB);
    tile(a, b, 0.06, 0.19, CURB);
    for (let row = 0; row < rows; row++) {
      const v = 0.19 + step * row;
      tile(a, b, v, v + step, row === 0 && markings ? (i % 2 ? DARK : WHITE) : PAVER);
    }
    if (tactile && (b <= -0.45 || a >= 0.45)) tile(a, b, rib, rib + 0.3, RIBS, 0.005);
  }
  if (tactile) tile(-0.45, 0.45, rib, rib + 0.6, DOTS, 0.008);
}

function renderStops(group, stops) {
  if (!stops.length) return;
  const atlas = drawAtlas(stops);
  const material = new THREE.MeshStandardNodeMaterial({ map: atlas, roughness: 0.85 });
  const { width, height } = atlas.image;
  const posts = stops.map(({ sign }) => ({
    position: [sign.x, sign.y + POLE_HEIGHT / 2, sign.z], size: [1, 1, 1], yaw: 0
  }));
  batchBusStopParts(group, 'Bus stop posts', posts, new THREE.CylinderGeometry(0.034, 0.04, POLE_HEIGHT, 7),
    new THREE.MeshStandardNodeMaterial({ color: 0x747e7d, roughness: 0.62 }), 420);
  for (const cell of edeSpatialGroups(stops, stop => stop.sign)) {
    const positions = [], uvs = [], indices = [];
    const quad = (points, [x, y, w, h]) => {
      const first = positions.length / 3;
      positions.push(...points.flat());
      const u0 = (x + 0.5) / width, u1 = (x + w - 0.5) / width;
      const v0 = 1 - (y + h - 0.5) / height, v1 = 1 - (y + 0.5) / height;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    };
    for (const stop of cell) stopSurfaces(stop, quad);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Bus stop signs and paving';
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = 440;
    group.add(mesh);
  }
}

const stopLabel = name => name.split(', ').at(-1).replace(/[- ](?:Perron )?[A-Z]$/, '')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function attachShelterSites(stops, sites, directions) {
  const assigned = new Set();
  for (const site of sites) {
    const { x, z } = site;
    const radians = site.bearing * Math.PI / 180;
    const tx = Math.sin(radians), tz = -Math.cos(radians);
    let closest;
    let reach = 20;
    for (const stop of stops) {
      if (stop.site || stopLabel(stop.name) !== stopLabel(site.name)) continue;
      const d = Math.hypot(x - stop.x, z - stop.z);
      if (d >= reach) continue;
      const direction = directions.get(keyFor(stop));
      if (direction && direction.tx * tx + direction.tz * tz < 0.65) continue;
      closest = stop;
      reach = d;
    }
    if (closest) {
      closest.site = site;
      assigned.add(site);
    }
  }
  return sites.filter(site => !assigned.has(site));
}

// Override per GTFS stop ID or Gelderland quay ID. Offsets are [metres forward, metres right] of the GTFS point.
export function buildEdeBusStops(scene, schedule, { overrides = {}, surveyed = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'EdeBusStops';
  scene.add(group);
  const { lonLatAffine, bounds: [west, north, east, south] } = EDE_DATA.meta;
  const inMap = (x, z) => x >= west && x <= east && z >= north && z <= south && containsPlayablePoint(x, z);
  const trafficAt = (x, z) => overlapsEdeTravelPavement(x, z);
  const groundAt = (x, z) => {
    const y = terrainHeightAt(x, z);
    const profile = gradeProfileAt(x, z, 'foot', undefined, y);
    return profile?.kind === 'platform' || profile?.kind === 'surface' ? profile.y : y;
  };
  const clearAt = (x, z, margin) => {
    if (!inMap(x, z) || waterAtExact(x, z) || overlapsEdeTravelPavement(x, z, 0, margin)) return false;
    const block = blockAt(x, z, false);
    return !(block?.osmId && !block.park);
  };
  const sites = EDE_BUS_SHELTER_SITES.map(site => ({
    ...site, ...projectLonLatInto(lonLatAffine, site.lon, site.lat, {})
  })).filter(site => inMap(site.x, site.z));
  const stops = collectEdeBusStops(schedule?.variants ?? []).filter(stop => inMap(stop.x, stop.z));
  const directions = schedule ? boardingDirections(schedule) : new Map();
  const shelterOnly = attachShelterSites(stops, sites, directions);
  const placed = [], shelters = [], skipped = [];
  for (const stop of stops) {
    const config = Object.assign({}, overrides[stop.site?.id], ...stop.ids.map(id => overrides[id]));
    const bearing = (config.bearing ?? stop.site?.bearing) * Math.PI / 180;
    const direction = (config.bearing === undefined && directions.get(keyFor(stop))) ||
      roadsideDirection(stop, bearing) || { tx: Math.sin(stop.heading), tz: Math.cos(stop.heading) };
    const layout = { platform: !stop.platform, ...config };
    const pose = fitEdeBusStop({ ...stop, ...direction }, layout, trafficAt, clearAt, groundAt) ??
      (stop.site && fitEdeBusStop({ ...direction, x: stop.site.x, z: stop.site.z },
        { platform: false }, trafficAt, clearAt, groundAt));
    if (pose) {
      const existing = placed.find(other => other.platformCode === stop.platform &&
        stopLabel(other.name) === stopLabel(stop.name) && other.tx * pose.tx + other.tz * pose.tz > 0.8 &&
        Math.hypot(other.sign.x - pose.sign.x, other.sign.z - pose.sign.z) < 3.75);
      if (existing) {
        existing.ids = [...new Set([...existing.ids, ...stop.ids])];
        existing.lines = [...new Set([...existing.lines, ...stop.lines])].sort(compareLines);
      } else placed.push({ ...pose, platformCode: stop.platform, name: stop.name, lines: stop.lines, ids: stop.ids });
    } else skipped.push(stop);
    const shelter = config.shelter ?? stop.site;
    if (shelter) {
      const curb = pose?.curb == null ? (stop.site ?? stop) : pose.point(0, pose.curb);
      shelters.push({
        bench: true, ...stop.site, ...shelter, id: stop.site?.id ?? stop.ids[0], name: stop.name,
        x: curb.x, z: curb.z, tx: direction.tx, tz: direction.tz, pose,
        surveyX: stop.site?.x ?? stop.x, surveyZ: stop.site?.z ?? stop.z
      });
    }
  }
  for (const site of shelterOnly) {
    const config = overrides[site.id];
    if (config?.shelter === false) continue;
    const radians = (config?.bearing ?? site.bearing) * Math.PI / 180;
    shelters.push({ ...site, ...config?.shelter, tx: Math.sin(radians), tz: -Math.cos(radians) });
  }
  renderStops(group, placed);
  const result = buildEdeBusShelters(group, shelters, (x, z) => !clearAt(x, z, 0.16), groundAt, surveyed);
  group.userData.stopCount = placed.length;
  group.userData.platformCount = placed.filter(stop => stop.platform).length;
  group.userData.skippedStops = skipped.map(({ ids, name }) => ({ ids, name }));
  return { ...result, group };
}
