import { BICYCLE, FOOT, MOTOR } from './road-access.js?v=20261122-startup';
import { EDE_SHOPS } from './ede-shops.js';
import { edeBikeFacilities } from './ede-road-lanes.js';
import { EDE_TURN_RESTRICTIONS } from './ede-turn-restrictions.js';
import { EDE_MTB_ROUTES } from './ede-mtb-routes.js';

const CELL = 64;
const CONNECTOR_LIMIT = 24;

const cellKey = (x, z) => x * 100000 + z;
const endPoint = (track, end) => [track.ax + track.ux * track.len * end, track.az + track.uz * track.len * end];
export const EDE_MTB_WAYS = new Map();
const mountainBikeTurns = new Set();
for (const route of EDE_MTB_ROUTES) {
  for (let i = 0; i < route.length; i++) {
    const way = route[i];
    if (!way) continue;
    const id = `w${Math.abs(way)}`;
    EDE_MTB_WAYS.set(id, (EDE_MTB_WAYS.get(id) || 0) | (way > 0 ? 1 : 2));
    const next = route[(i + 1) % route.length];
    if (next) mountainBikeTurns.add(`${way}/${next}`);
  }
}

function trackBetween([ax, az], [bx, bz], properties) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05) return null;
  return { ...properties, ax, az, ux: (bx - ax) / len, uz: (bz - az) / len,
    len, node: null, side: 0, line: 0, mapped: true, links: [[], []] };
}

function indexTracks(tracks) {
  const cells = new Map();
  for (const t of tracks) {
    const [bx, bz] = endPoint(t, 1);
    for (let x = Math.floor(Math.min(t.ax, bx) / CELL); x <= Math.floor(Math.max(t.ax, bx) / CELL); x++) {
      for (let z = Math.floor(Math.min(t.az, bz) / CELL); z <= Math.floor(Math.max(t.az, bz) / CELL); z++) {
        const key = cellKey(x, z);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(t);
      }
    }
  }
  return (x, z, radius, out) => {
    out.length = 0;
    const seen = new Set();
    for (let ix = Math.floor((x - radius) / CELL); ix <= Math.floor((x + radius) / CELL); ix++) {
      for (let iz = Math.floor((z - radius) / CELL); iz <= Math.floor((z + radius) / CELL); iz++) {
        for (const t of cells.get(cellKey(ix, iz)) || []) {
          if (seen.has(t)) continue;
          seen.add(t);
          const along = Math.max(0, Math.min(t.len, (x - t.ax) * t.ux + (z - t.az) * t.uz));
          if ((t.ax + along * t.ux - x) ** 2 + (t.az + along * t.uz - z) ** 2 < radius ** 2) out.push(t);
        }
      }
    }
  };
}

function polygonContains(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if ((ring[i + 1] > z) !== (ring[j + 1] > z) &&
      x < (ring[j] - ring[i]) * (z - ring[i + 1]) / (ring[j + 1] - ring[i + 1]) + ring[i]) inside = !inside;
  }
  return inside;
}

function footPoint(x, z, points) {
  let closest = [x, z], distance = 6;
  for (let i = 1; i < points.length; i++) {
    const [ax, az, ay] = points[i - 1], [bx, bz, by] = points[i], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d >= distance) continue;
    closest = [ax + t * dx, az + t * dz, ay + t * (by - ay)];
    distance = d;
  }
  return closest;
}

export function buildEdeActiveTravel(data, grade, { walkable = () => true, sidewalkAt = () => null, motorNodes = [] } = {}) {
  if (!data?.activeGraph) return null;
  const { nodes, links, controls = {} } = data.activeGraph;
  const profiles = new Map(), separateFootways = new Map();
  for (const site of grade?.sites || []) {
    for (const profile of site.profiles) {
      for (const id of profile.wayIds || []) {
        if (!profiles.has(id)) profiles.set(id, []);
        profiles.get(id).push(profile);
        if (profile.modes.length === 1 && profile.modes[0] === 'foot') separateFootways.set(id, profile);
      }
    }
  }

  const motorTracks = [];
  for (const road of data.roads) {
    if (!(road.modes?.reduce((mask, direction) => mask | direction, 0) & MOTOR)) continue;
    for (let i = 2; i < road.pts.length; i += 2) {
      const t = trackBetween(road.pts.slice(i - 2, i), road.pts.slice(i, i + 2),
        { wayId: road.id, width: road.bgtWidth ?? road.bgt?.width ?? road.width, layer: road.layer });
      if (t) motorTracks.push(t);
    }
  }
  const motorsNear = indexTracks(motorTracks), nearbyMotors = [];
  const signalNodes = motorNodes.filter(n => n.signal);
  const mappedSignals = data.signals || [];
  const destinations = [];
  const surveyedCrossings = Object.values(controls).filter(control => control.osmId);

  function clear(t, inside = () => true, pad = 0.35) {
    const n = Math.ceil(t.len);
    for (let i = 0; i <= n; i++) {
      const x = t.ax + t.ux * t.len * i / n, z = t.az + t.uz * t.len * i / n;
      if (!inside(x, z) || !walkable(x - pad, x + pad, z - pad, z + pad, t.layer)) return false;
    }
    return true;
  }

  function motorCrossings(t) {
    const [mx, mz] = endPoint(t, 0.5);
    motorsNear(mx, mz, t.len / 2 + 0.8, nearbyMotors);
    const hits = [];
    for (const road of nearbyMotors) {
      if (road.wayId === t.wayId || road.layer !== t.layer) continue;
      const cross = t.ux * road.uz - t.uz * road.ux;
      if (Math.abs(cross) < 0.35) continue;
      const dx = road.ax - t.ax, dz = road.az - t.az;
      const at = (dx * road.uz - dz * road.ux) / cross;
      const there = (dx * t.uz - dz * t.ux) / cross;
      if (at < -0.1 || at > t.len + 0.1 || there < -0.1 || there > road.len + 0.1) continue;
      hits.push({ at, road, reach: (road.width / 2 + 1.8) / Math.abs(cross) });
    }
    return hits;
  }

  function crossing(t, hits, controlHint) {
    const at = hits.reduce((sum, hit) => sum + hit.at, 0) / hits.length;
    const x = t.ax + t.ux * at, z = t.az + t.uz * at;
    const wayIds = [...new Set(hits.map(hit => hit.road.wayId))];
    let surveyed = null, nearby = 2.5;
    for (const control of surveyedCrossings) {
      const d = Math.hypot(control.x - x, control.z - z);
      if (d < nearby) { surveyed = control; nearby = d; }
    }
    let signal = null, axisIndex, distance = 36;
    const signaled = (surveyed?.control ?? controlHint) === 'signal' ||
      !surveyed && !controlHint && mappedSignals.some(p => Math.hypot(p.x - x, p.z - z) < 16);
    if (signaled) for (const n of signalNodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d >= distance) continue;
      const approach = n.in.find(edge => wayIds.includes(edge.wayId));
      const exit = n.out.find(edge => wayIds.includes(edge.wayId));
      if (!approach && !exit) continue;
      signal = n;
      axisIndex = approach?.inArm?.group ?? exit?.outArm?.group;
      distance = d;
    }
    if (signaled && axisIndex == null) {
      const road = hits.reduce((wide, hit) => hit.road.width > wide.width ? hit.road : wide, hits[0].road);
      axisIndex = Math.abs(road.uz) > Math.abs(road.ux) ? 0 : 1;
    }
    return { x, z, wayIds, control: signaled ? 'signal' : 'yield', signal, axisIndex,
      osmId: surveyed?.osmId, markings: surveyed?.markings };
  }

  function connect(a, ea, b, eb, extra = []) {
    if (!a.allowed[1 - ea] || !b.allowed[eb]) return;
    if (a.links[ea].some(path => path.at(-1).track === b && path.at(-1).dir === (eb ? -1 : 1))) return;
    a.links[ea].push([...extra, { track: b, dir: eb ? -1 : 1 }]);
  }

  function build(mode, mountain = false) {
    const modeName = mode === FOOT ? 'foot' : 'bike';
    const tracks = [], ports = new Map(), mappedPorts = [];
    const addPort = (node, track, end) => {
      if (!ports.has(node)) ports.set(node, []);
      const port = { track, end };
      ports.get(node).push(port);
      mappedPorts.push(port);
    };

    function split(t, hits, hint) {
      if (!hits.length) return [t];
      const start = Math.max(0, Math.min(...hits.map(({ at, reach }) => at - reach)));
      const end = Math.min(t.len, Math.max(...hits.map(({ at, reach }) => at + reach)));
      const a = endPoint(t, start / t.len), b = endPoint(t, end / t.len);
      const before = trackBetween(endPoint(t, 0), a, t), after = trackBetween(b, endPoint(t, 1), t);
      const control = crossing(t, hits, hint);
      if (mode === FOOT && !hint && !control.osmId && control.control !== 'signal') return [before, null, after];
      const middle = trackBetween(a, b, { ...t, noSpawn: true, crossing: control });
      if (!middle) return [t];
      if (mode === FOOT) middle.node = { curb: [], walkers: [] };
      return [before, middle, after].filter(Boolean);
    }

    function footPieces(t) {
      if (!t || t.structure || clear(t)) return [t];
      if (t.crossing) return [null];
      const a = endPoint(t, 0), b = endPoint(t, 1);
      const steps = Math.max(1, Math.ceil(t.len / 8));
      const pieces = [];
      for (let i = 0; i < steps; i++) {
        const start = i ? endPoint(t, i / steps) : a;
        const end = i + 1 < steps ? endPoint(t, (i + 1) / steps) : b;
        const piece = trackBetween(start, end, t);
        if (clear(piece)) { pieces.push(piece); continue; }
        const offset = Math.min(1.4, t.width / 2 - 0.35);
        let bypass = null;
        if (offset >= 0.25) for (const side of [-1, 1]) {
          const midpoint = [(start[0] + end[0]) / 2 - t.uz * offset * side,
            (start[1] + end[1]) / 2 + t.ux * offset * side];
          const first = trackBetween(start, midpoint, t), second = trackBetween(midpoint, end, t);
          if (clear(first) && clear(second) && !motorCrossings(first).length && !motorCrossings(second).length) {
            bypass = [first, second];
            break;
          }
        }
        pieces.push(...(bypass || [null]));
      }
      return pieces;
    }

    for (const [a, b, , , , , inner, roadIndex, footOffsets] of links) {
      const road = data.roads[roadIndex], [forward, reverse] = road.modes;
      const signed = EDE_MTB_WAYS.get(road.id);
      const trail = signed && /^(path|track)$/.test(road.kind);
      if (mountain ? !signed : trail) continue;
      if ((road.bridge || road.tunnel && road.tunnelType !== 'building_passage') && !profiles.has(road.id)) continue;
      const footProfile = mode === FOOT && separateFootways.get(road.id);
      const width = road.bgtWidth ?? road.bgt?.width ?? road.width;
      let surfaces = mode === FOOT && (footProfile || (forward | reverse) & FOOT)
        ? (footProfile ? [0] : footOffsets).map(offset => ({
          offset, width: footProfile?.width ?? (offset ? 2 : width), kind: offset ? 'sidewalk' : road.kind,
          allowed: [!!footProfile || !!(forward & FOOT), !!footProfile || !!(reverse & FOOT)]
        }))
        : mode === BICYCLE ? edeBikeFacilities(road).filter(lane => lane.kind !== 'advisory') : [];
      if (mountain) {
        const direction = [Boolean(signed & 1), Boolean(signed & 2)];
        if (trail || !((forward | reverse) & MOTOR)) {
          surfaces = [{ offset: 0, width, allowed: direction, kind: 'trail' }];
        } else {
          surfaces = surfaces.map(lane => ({ ...lane, allowed: direction.map((yes, i) => yes && lane.allowed[i]) }))
            .filter(lane => lane.allowed.some(Boolean));
        }
      }
      const points = [nodes[a * 2], nodes[a * 2 + 1], ...inner, nodes[b * 2], nodes[b * 2 + 1]];
      for (const { offset, width, allowed, kind } of surfaces) {
        const shape = [];
        for (let i = 0; i < points.length; i += 2) {
          const x = points[i], z = points[i + 1];
          const dx = (points[i + 2] ?? x) - (points[i - 2] ?? x);
          const dz = (points[i + 3] ?? z) - (points[i - 1] ?? z);
          const len = Math.hypot(dx, dz) || 1;
          shape.push(footProfile ? footPoint(x, z, footProfile.points) : [x - dz * offset / len, z + dx * offset / len]);
        }
        const properties = { wayId: road.id, layer: road.layer, structure: road.bridge || road.tunnel, mountain,
          sidewalk: kind === 'sidewalk', exclusive: kind !== 'lane', width, allowed, kind, offset,
          populationWidth: Math.min(width, 5),
          socialPlace: mode === FOOT && (kind === 'pedestrian' || kind === 'sidewalk') ? road.id + '/' + offset : null };
        let previous = null;
        for (let i = 1; i < shape.length; i++) {
          const t = trackBetween(shape[i - 1], shape[i], properties);
          if (!t) continue;
          if (mountain && data.meta?.bounds && [shape[i - 1], shape[i]].some(([x, z]) => {
            const [west, north, east, south] = data.meta.bounds;
            return x < west || x > east || z < north || z > south;
          })) {
            previous = null;
            continue;
          }
          const hits = motorCrossings(t);
          const startControl = i === 1 && controls[a];
          const endControl = i === shape.length - 1 && controls[b];
          const hint = road.crossing ?? (mode === BICYCLE
            ? (startControl?.control || endControl?.control || null) : null);
          const splitCrossings = split(t, hits, hint);
          const pieces = mode === FOOT ? splitCrossings.flatMap(footPieces) : splitCrossings;
          for (const piece of pieces) {
            if (!piece) {
              previous = null;
              continue;
            }
            if (previous) {
              connect(previous, 1, piece, 0);
              connect(piece, 0, previous, 1);
            }
            tracks.push(piece);
            if (i === 1 && piece === pieces[0]) addPort(a, piece, 0);
            if (i === shape.length - 1 && piece === pieces.at(-1)) addPort(b, piece, 1);
            previous = piece;
          }
        }
      }
    }

    function connectPorts(a, ea, b, eb, node) {
      const shared = node !== undefined;
      if (a === b) return;
      if (mountain && a.wayId !== b.wayId) {
        const from = (ea ? 1 : -1) * Number(a.wayId.slice(1));
        const to = (eb ? -1 : 1) * Number(b.wayId.slice(1));
        if (!mountainBikeTurns.has(`${from}/${to}`)) return;
      }
      const aProfiles = profiles.get(a.wayId)?.filter(profile => profile.modes.includes(modeName));
      const bProfiles = profiles.get(b.wayId)?.filter(profile => profile.modes.includes(modeName));
      if (a.layer !== b.layer) {
        const sameProfile = aProfiles?.some(profile => bProfiles?.includes(profile));
        if (!shared || !(a.structure || b.structure || sameProfile)) return;
        if (a.kind === 'steps' && !aProfiles?.length || b.kind === 'steps' && !bProfiles?.length) return;
      }
      if (shared) {
        const x = nodes[node * 2], z = nodes[node * 2 + 1];
        const via = EDE_TURN_RESTRICTIONS.nodeAt(a.wayId, x, z);
        if (via) {
          const at = EDE_TURN_RESTRICTIONS.nodeAt(b.wayId, x, z);
          if (!EDE_TURN_RESTRICTIONS.allowed([a.wayId, via, b.wayId, at, ea === eb], mode)) return;
        }
      }
      const [x, z] = endPoint(a, ea), [bx, bz] = endPoint(b, eb);
      const gap = Math.hypot(bx - x, bz - z);
      if (gap > (mode === FOOT ? shared ? 8 : 3.5 : shared ? 9 : 0.12)) return;
      if (aProfiles?.length && bProfiles?.length) {
        const aHeights = aProfiles.map(profile => footPoint(x, z, profile.points)[2]).filter(Number.isFinite);
        const bHeights = bProfiles.map(profile => footPoint(bx, bz, profile.points)[2]).filter(Number.isFinite);
        if (aHeights.length && bHeights.length && !aHeights.some(y => bHeights.some(other => Math.abs(y - other) < 0.65 + gap * 0.2))) return;
      }
      if (a.wayId === b.wayId && a.offset * b.offset < 0) return;
      if (gap < 0.05) return connect(a, ea, b, eb);
      const t = trackBetween([x, z], [bx, bz], { wayId: a.wayId, layer: a.layer, sidewalk: a.sidewalk && b.sidewalk,
        exclusive: a.exclusive && b.exclusive, width: Math.min(a.width, b.width), allowed: [true, true], noSpawn: true,
        kind: 'connector', populationWidth: 0, mountain });
      if (motorCrossings(t).length) return;
      if (mode === FOOT && !clear(t)) return;
      connect(a, ea, b, eb, [{ track: t, dir: 1 }]);
    }

    for (const [node, list] of ports) {
      const surveyed = controls[node];
      const crosswalks = new Map();
      for (const { track: a, end: ea } of list) {
        for (const { track: b, end: eb } of list) {
          if (mode !== FOOT || !surveyed?.osmId || a.wayId !== b.wayId || !a.sidewalk || !b.sidewalk ||
            a.offset * b.offset >= 0 || a.layer !== b.layer) {
            connectPorts(a, ea, b, eb, node);
            continue;
          }
          const start = endPoint(a, ea), finish = endPoint(b, eb), forward = a.offset < 0;
          const [from, to] = forward ? [start, finish] : [finish, start];
          const id = [...from, ...to].map(v => Math.round(v * 2)).join('/');
          let t = crosswalks.get(id);
          if (!t) {
            t = trackBetween(from, to, { layer: a.layer, width: 2, populationWidth: 0,
              exclusive: true, noSpawn: true, kind: 'crossing', allowed: [true, true] });
            if (!t || t.len > 22 || !clear(t)) continue;
            const hits = motorCrossings(t);
            if (!hits.length) continue;
            t.crossing = crossing(t, hits, surveyed.control);
            t.node = { curb: [], walkers: [] };
            crosswalks.set(id, t);
            tracks.push(t);
          }
          connect(a, ea, b, eb, [{ track: t, dir: forward ? 1 : -1 }]);
        }
      }
    }

    // A short shared road is useful only when it joins two dedicated facilities at mapped endpoints.
    if (mode === BICYCLE && !mountain) for (const [from, to, , , , , inner, roadIndex] of links) {
      const road = data.roads[roadIndex];
      if (road.cycle || road.bridge || road.tunnel || !ports.has(from) || !ports.has(to) ||
        !/^(residential|living_street|service|unclassified|tertiary_link|secondary_link|primary_link)$/.test(road.kind)) continue;
      const allowed = road.modes.map(mask => !!(mask & BICYCLE));
      if (!allowed.some(Boolean) || inner.length > 4) continue;
      const a = [nodes[from * 2], nodes[from * 2 + 1]], b = [nodes[to * 2], nodes[to * 2 + 1]];
      const shape = [a];
      for (let i = 0; i < inner.length; i += 2) shape.push(inner.slice(i, i + 2));
      shape.push(b);
      const parts = shape.slice(1).map((p, i) => trackBetween(shape[i], p, {
        wayId: road.id, kind: 'connector', layer: road.layer, width: road.width, sharedRoad: true,
        allowed, noSpawn: true, exclusive: false
      })).filter(Boolean);
      const total = parts.reduce((sum, t) => sum + t.len, 0);
      if (!total || total > CONNECTOR_LIMIT) continue;
      const itinerary = parts.flatMap(t => split(t, motorCrossings(t), road.crossing));
      for (let i = 1; i < itinerary.length; i++) {
        connect(itinerary[i - 1], 1, itinerary[i], 0);
        connect(itinerary[i], 0, itinerary[i - 1], 1);
      }
      const first = itinerary[0], last = itinerary.at(-1);
      for (const { track, end } of ports.get(from)) {
        if (!track.exclusive || track.structure || track.layer !== first.layer) continue;
        connectPorts(track, end, first, 0, from);
        connectPorts(first, 0, track, end, from);
      }
      for (const { track, end } of ports.get(to)) {
        if (!track.exclusive || track.structure || track.layer !== last.layer) continue;
        connectPorts(track, end, last, 1, to);
        connectPorts(last, 1, track, end, to);
      }
    }

    if (mode === FOOT) {
      const endpointCells = new Map();
      for (const port of mappedPorts) {
        const [x, z] = endPoint(port.track, port.end), key = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
        if (!endpointCells.has(key)) endpointCells.set(key, []);
        endpointCells.get(key).push(port);
      }
      function nearbyPorts(x, z, radius) {
        const result = [];
        for (let ix = Math.floor((x - radius) / CELL); ix <= Math.floor((x + radius) / CELL); ix++) {
          for (let iz = Math.floor((z - radius) / CELL); iz <= Math.floor((z + radius) / CELL); iz++) {
            result.push(...(endpointCells.get(cellKey(ix, iz)) || []));
          }
        }
        return result;
      }
      for (const { track, end } of mappedPorts) {
        const [x, z] = endPoint(track, end);
        for (const port of nearbyPorts(x, z, 3.5)) {
          if (track.layer !== port.track.layer || track.structure || port.track.structure || track.crossing || port.track.crossing) continue;
          if (track.sidewalk || port.track.sidewalk) {
            const [bx, bz] = endPoint(port.track, port.end);
            if (track.sidewalk && port.track.sidewalk && sidewalkAt(x, z) !== sidewalkAt(bx, bz)) continue;
          }
          connectPorts(track, end, port.track, port.end);
        }
      }

      for (const area of data.squares || []) {
        const { ring, holes = [] } = area;
        const step = 8, xs = ring.filter((_, i) => i % 2 === 0), zs = ring.filter((_, i) => i % 2 === 1);
        const inside = (x, z) => polygonContains(ring, x, z) && !holes.some(hole => polygonContains(hole, x, z));
        const grid = new Map();
        const areaTracks = [];
        const properties = { layer: 0, exclusive: true, width: 2, populationWidth: step / 2, kind: 'square',
          areaId: area.id, socialPlace: area.id, allowed: [true, true] };
        function add(a, b) {
          const t = trackBetween(a.point, b.point, properties);
          if (!t || !clear(t, (x, z) => inside(x - 0.35, z) && inside(x + 0.35, z)
            && inside(x, z - 0.35) && inside(x, z + 0.35)) || motorCrossings(t).length) return;
          a.ports.push({ track: t, end: 0 }); b.ports.push({ track: t, end: 1 });
          areaTracks.push(t);
        }
        for (let z = Math.ceil(Math.min(...zs) / step); z * step < Math.max(...zs); z++) {
          for (let x = Math.ceil(Math.min(...xs) / step); x * step < Math.max(...xs); x++) {
            if (!inside(x * step, z * step)) continue;
            const vertex = { point: [x * step, z * step], ports: [] };
            grid.set(cellKey(x, z), vertex);
            for (const k of [cellKey(x - 1, z), cellKey(x, z - 1)]) if (grid.has(k)) add(grid.get(k), vertex);
          }
        }
        for (const { point, ports } of grid.values()) {
          if (!ports.length) continue;
          for (const { track: a, end: ea } of ports) {
            for (const { track: b, end: eb } of ports) if (a !== b) connect(a, ea, b, eb);
          }
          for (const { track: target, end } of nearbyPorts(...point, 10)) {
            if (target.layer !== 0 || target.structure || target.crossing) continue;
            const p = endPoint(target, end);
            if (Math.hypot(p[0] - point[0], p[1] - point[1]) > 10) continue;
            const t = trackBetween(point, p, { ...properties, noSpawn: true, populationWidth: 0, kind: 'connector' });
            if (t && (!clear(t) || motorCrossings(t).length)) continue;
            for (const { track, end: from } of ports) {
              connect(track, from, target, end, t ? [{ track: t, dir: 1 }] : []);
              connect(target, end, track, from, t ? [{ track: t, dir: -1 }] : []);
            }
          }
        }
        if (areaTracks.length) {
          const middle = areaTracks[Math.floor(areaTracks.length / 2)];
          const [x, z] = endPoint(middle, 0.5);
          destinations.push({ x, z, name: area.name, kind: 'square' });
          for (const t of tracks) if (t.layer === 0 && t.kind !== 'square' && inside(...endPoint(t, 0.5))) t.populationWidth = 0;
          tracks.push(...areaTracks);
        }
      }
    }

    return indexTracks(tracks);
  }
  const foot = build(FOOT), tracksNearShop = [];
  for (const [name, x, z] of EDE_SHOPS) {
    foot(x, z, 16, tracksNearShop);
    let destination = null, distance = 16;
    for (const t of tracksNearShop) {
      if (t.noSpawn || t.layer !== 0 || !['footway', 'sidewalk', 'pedestrian', 'square'].includes(t.kind)) continue;
      const s = Math.max(0, Math.min(t.len, (x - t.ax) * t.ux + (z - t.az) * t.uz));
      const [px, pz] = endPoint(t, s / t.len);
      const d = Math.hypot(x - px, z - pz);
      if (d >= distance) continue;
      destination = { x: px, z: pz, name, kind: 'shop' };
      distance = d;
    }
    if (destination) destinations.push(destination);
  }
  function motorAt(x, z, layer, clearance = 0) {
    motorsNear(x, z, 16 + clearance, nearbyMotors);
    return nearbyMotors.some(track => {
      if ((track.layer ?? 0) !== layer) return false;
      const s = Math.max(0, Math.min(track.len, (x - track.ax) * track.ux + (z - track.az) * track.uz));
      return Math.hypot(x - track.ax - track.ux * s, z - track.az - track.uz * s) < track.width / 2 + clearance;
    });
  }
  return { bikes: build(BICYCLE), mountainBikes: build(BICYCLE, true), foot, destinations, motorAt };
}
