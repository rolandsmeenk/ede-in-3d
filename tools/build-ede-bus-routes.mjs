// Fit normalized GTFS shapes to the directed lanes and turns exported by the game.
// Usage: node tools/build-ede-bus-routes.mjs GTFS_JSON ROAD_GRAPH_JSON [ASSET_JSON] [REPORT_JSON]
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STEP = 8; // metres between shape observations
const REACH = 21; // maximum deviation from the operator's shape, in metres
const CELL = 32;
const EPS = 1e-6;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const round = n => Math.round(n * 1000) / 1000;
const between = (a, b, t) => a + (b - a) * t;
const inside = ([x, z], [minX, minZ, maxX, maxZ]) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;

function clip(a, b, bounds) {
  let start = 0, end = 1;
  for (let axis = 0; axis < 2; axis++) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < EPS) {
      if (a[axis] < bounds[axis] || a[axis] > bounds[axis + 2]) return null;
      continue;
    }
    const t0 = (bounds[axis] - a[axis]) / d, t1 = (bounds[axis + 2] - a[axis]) / d;
    start = Math.max(start, Math.min(t0, t1));
    end = Math.min(end, Math.max(t0, t1));
  }
  return start < end ? [start, end] : null;
}

function sourceShape(points) {
  const segments = [];
  let length = 0;
  if (!points.every(p => p.length === 2 && p.every(Number.isFinite))) throw new Error('Invalid GTFS shape point');
  for (let i = 1; i < points.length; i++) {
    const [x, z] = points[i - 1], [ex, ez] = points[i];
    const len = Math.hypot(ex - x, ez - z);
    if (len < EPS) continue;
    segments.push({ a: points[i - 1], b: points[i], x, z, dx: (ex - x) / len, dz: (ez - z) / len, s: length, len });
    length += len;
  }
  if (!segments.length) throw new Error('GTFS shape has no distinct points');
  function at(s) {
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].s + segments[mid].len < s) lo = mid + 1;
      else hi = mid;
    }
    const seg = segments[lo], along = clamp(s - seg.s, 0, seg.len);
    return [seg.x + seg.dx * along, seg.z + seg.dz * along];
  }
  return { length, segments, at };
}

function shapeStops(stops, shape) {
  let previous = [];
  for (const [index, stop] of stops.entries()) {
    if (!Number.isFinite(stop.x) || !Number.isFinite(stop.z)) throw new Error(`Invalid coordinates for GTFS stop ${stop.id}`);
    const known = Number.isFinite(stop.distance) && stop.distance >= 0 && stop.distance <= shape.length + 0.5;
    const candidates = known ? [{ s: Math.min(stop.distance, shape.length) }] : shape.segments.map(seg => {
      const along = clamp((stop.x - seg.x) * seg.dx + (stop.z - seg.z) * seg.dz, 0, seg.len);
      return { s: seg.s + along, error: Math.hypot(stop.x - seg.x - seg.dx * along, stop.z - seg.z - seg.dz * along) };
    });
    const row = [];
    let best, p = 0;
    for (const candidate of candidates) {
      while (p < previous.length && previous[p].s <= candidate.s + EPS) {
        if (!best || previous[p].score < best.score) best = previous[p];
        p++;
      }
      if (index && !best) continue;
      const endpointCost = (index === 0 ? candidate.s : index === stops.length - 1 ? shape.length - candidate.s : 0) * 0.025;
      row.push({ s: candidate.s, score: (best?.score || 0) + (candidate.error || 0) + endpointCost, prev: best });
    }
    if (!row.length) throw new Error(`GTFS stop ${stop.id} falls out of shape order`);
    previous = row;
  }
  let best = previous.reduce((a, b) => a.score <= b.score ? a : b);
  const projected = [];
  for (let i = stops.length - 1; i >= 0; i--) {
    projected.unshift({ ...stops[i], distance: best.s });
    best = best.prev;
  }
  return projected;
}

function modeledRanges(shape, bounds, start, end) {
  const ranges = [];
  for (const seg of shape.segments) {
    if (seg.s > end) break;
    if (seg.s + seg.len < start) continue;
    const interval = clip(seg.a, seg.b, bounds);
    if (!interval) continue;
    const a = Math.max(start, seg.s + interval[0] * seg.len), b = Math.min(end, seg.s + interval[1] * seg.len);
    if (b <= a) continue;
    const last = ranges.at(-1);
    if (last && a - last[1] < EPS) last[1] = b;
    else ranges.push([a, b]);
  }
  return ranges;
}

function directedLanes(graph) {
  const { bounds, edges } = graph;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
    throw new Error('Expected road graph bounds [minX, minZ, maxX, maxZ]');
  }
  if (!Array.isArray(edges) || !edges.length) throw new Error('Expected directed road graph edges');
  const byId = new Map(), cells = new Map();
  const visit = (minX, minZ, maxX, maxZ, fn) => {
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) fn(`${x}/${z}`);
    }
  };
  for (const e of edges) {
    const { id, from, to, sx, sz, dx, dz, span, len, rx = -dz, rz = dx, x0 = from.x, z0 = from.z } = e;
    if (![id, from.x, from.z, to.x, to.z, sx, sz, x0, z0, dx, dz, span, len, ...e.lanes].every(Number.isFinite) || byId.has(id) || len <= 0 || span < len) {
      throw new Error(`Invalid road graph edge ${id}`);
    }
    const clearStart = (sx - x0) * dx + (sz - z0) * dz;
    const lanes = e.lanes.map((offset, index) => {
      const x = x0 + rx * offset, z = z0 + rz * offset;
      const ex = x + span * dx, ez = z + span * dz;
      const range = clip([x, z], [ex, ez], bounds);
      return { edge: e, index, x, z, x0, z0, dx, dz, rx, rz, span, clearStart, clearEnd: clearStart + len,
        sideCost: (e.lanes.length - index - 1) * 0.9, turns: [], range: range?.map(t => t * span) };
    });
    byId.set(id, lanes);
    if (lanes.some(lane => lane.range)) {
      visit(Math.min(x0, to.x), Math.min(z0, to.z), Math.max(x0, to.x), Math.max(z0, to.z), key => {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(lanes);
      });
    }
  }
  for (const lanes of byId.values()) {
    for (const lane of lanes) for (const move of lane.edge.moves) {
      const next = byId.get(move.to)?.[move.out[lane.index]];
      if (lane.range?.[1] >= lane.span - EPS && next?.range?.[0] <= EPS) lane.turns.push(next);
    }
  }
  function nearby(observation) {
    const { point: [x, z], dx, dz, stop, beginsTrip, endsTrip } = observation;
    const seen = new Set(), ways = [];
    visit(x - REACH, z - REACH, x + REACH, z + REACH, key => {
      for (const lanes of cells.get(key) || []) {
        if (seen.has(lanes)) continue;
        seen.add(lanes);
        const l = lanes[0], facing = l.dx * dx + l.dz * dz;
        if (facing < 0.1) continue;
        const t = clamp((x - l.x0) * l.dx + (z - l.z0) * l.dz, 0, l.span);
        const d = Math.hypot(l.x0 + t * l.dx - x, l.z0 + t * l.dz - z);
        if (d <= REACH) ways.push({ lanes, t, cost: d * 1.2 + (1 - facing) * 9 });
      }
    });
    return ways.sort((a, b) => a.cost - b.cost).slice(0, 8).flatMap(({ lanes, t, cost }) => lanes.filter(l => l.range).map(lane => {
      const padding = Math.min(0.8, lane.edge.len / 3);
      const position = stop && positionOnLane(stop, lane, lane.clearStart + (endsTrip ? padding : 0), lane.clearEnd - (beginsTrip ? padding : 0));
      const target = stop?.platform && position.error < 6 && (beginsTrip || endsTrip) ? position.t : t;
      const along = clamp(target, ...lane.range);
      const dockCost = position ? position.error * (stop.platform ? 2.8 : 0.65) + Math.max(0, -position.side - 0.8) * 3 : 0;
      return { lane, t: along, cost: cost + lane.sideCost + Math.abs(along - t) + dockCost };
    }));
  }
  return { nearby, byId };
}

function positionOnLane(stop, lane, min, max) {
  const dx = stop.x - lane.x, dz = stop.z - lane.z;
  const t = clamp(dx * lane.dx + dz * lane.dz, min, max);
  return { t, side: dx * lane.rx + dz * lane.rz, error: Math.hypot(dx - lane.dx * t, dz - lane.dz * t) };
}

function roadTransitions(from, targets, a, b, reach = REACH) {
  const [x, z] = a.point, [ex, ez] = b.point;
  const dx = ex - x, dz = ez - z, d2 = dx * dx + dz * dz;
  const interval = b.s - a.s, limit = interval * 2.4 + 9;
  const out = new Map();
  const queue = [{ lane: from.lane, start: from.t, length: 0, steps: [] }];
  const visited = new Set();
  const deviation = (lane, t) => {
    const ax = lane.x0 + lane.dx * t - x, az = lane.z0 + lane.dz * t - z;
    const f = d2 > EPS ? clamp((ax * dx + az * dz) / d2, 0, 1) : 0;
    return Math.hypot(ax - f * dx, az - f * dz);
  };
  while (queue.length) {
    queue.sort((p, q) => q.length - p.length);
    const { lane, start, length, steps } = queue.pop();
    if (visited.has(lane)) continue;
    visited.add(lane);
    for (const target of targets) {
      if (target.lane !== lane || target.t < start - EPS || length + target.t - start > limit) continue;
      if (deviation(lane, start) > reach || deviation(lane, target.t) > reach) continue;
      const next = { lane, from: start, to: target.t };
      out.set(target, { steps: [...steps, next], cost: Math.abs(length + target.t - start - interval) * 0.8 });
    }
    const toNode = length + lane.span - start;
    if (toNode > limit || deviation(lane, start) > reach || deviation(lane, lane.span) > reach) continue;
    for (const next of lane.turns) {
      if (!visited.has(next)) queue.push({ lane: next, start: 0, length: toNode, steps: [...steps, { lane, from: start, to: lane.span }] });
    }
  }
  return out;
}

function matchRange(shape, roads, stops, start, end) {
  const count = Math.ceil((end - start) / STEP);
  const measures = Array.from({ length: count + 1 }, (_, i) => ({ s: between(start, end, i / count) }));
  for (const stop of stops) {
    if (stop.distance < start || stop.distance > end) continue;
    const nearest = Math.round((stop.distance - start) / (end - start) * count);
    const point = measures[nearest];
    if (Math.abs(point.s - stop.distance) < 0.5 && !point.stop) Object.assign(point, { s: stop.distance, stop });
    else measures.push({ s: stop.distance, stop });
  }
  measures.sort((a, b) => a.s - b.s);
  let previous = [], prior;
  for (const [i, { s, stop }] of measures.entries()) {
    const a = shape.at(Math.max(start, s - STEP / 2)), b = shape.at(Math.min(end, s + STEP / 2));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const observation = { s, stop, beginsTrip: stop === stops[0], endsTrip: stop === stops.at(-1), point: shape.at(s),
      dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len };
    const candidates = roads.nearby(observation);
    const best = previous.reduce((p, q) => p.score <= q.score ? p : q, { score: Infinity });
    const missing = previous.find(p => !p.candidate);
    const row = candidates.map(candidate => ({ candidate, s, score: candidate.cost + (i ? best.score + 34 : 0), prev: i ? best : null }));
    for (const prev of previous) {
      if (!prev.candidate) continue;
      const links = roadTransitions(prev.candidate, candidates, prior, observation);
      for (const next of row) {
        const link = links.get(next.candidate);
        if (!link) continue;
        const score = prev.score + next.candidate.cost + link.cost;
        if (score < next.score) Object.assign(next, { score, prev, steps: link.steps });
      }
    }
    row.push({ s, score: 29 + (stop ? 14 : 0) + (i ? Math.min(best.score + 12, missing.score) : 0), prev: i && missing.score <= best.score + 12 ? missing : i ? best : null });
    previous = row;
    prior = observation;
  }
  let chosen = previous.reduce((a, b) => a.score <= b.score ? a : b);
  const chain = [];
  while (chosen) { chain.push(chosen); chosen = chosen.prev; }
  return chain.reverse();
}

function routeSlices(chain) {
  const slices = [];
  let legs = [];
  function finish() {
    if (legs.length) slices.push({ legs, stops: [] });
    legs = [];
  }
  for (const { s, prev, steps } of chain) {
    if (!steps) { finish(); continue; }
    let along = 0;
    const length = steps.reduce((sum, step) => sum + step.to - step.from, 0);
    for (const { lane, from, to } of steps) {
      const offset = along;
      along += to - from;
      const pos = t => length < EPS ? s : between(prev.s, s, (offset + t - from) / length);
      const a = Math.max(from, lane.clearStart, lane.range[0]), b = Math.min(to, lane.clearEnd, lane.range[1]);
      if (b - a < EPS) continue;
      const leg = { edge: lane.edge.id, lane: lane.index, start: round(pos(a)), end: round(pos(b)), from: round(a - lane.clearStart), to: round(b - lane.clearStart) };
      if (leg.end <= leg.start || leg.to <= leg.from) continue;
      const last = legs.at(-1);
      if (last && leg.edge === last.edge && leg.lane === last.lane && Math.abs(leg.from - last.to) <= 0.002) {
        const predicted = between(last.from, leg.to, (last.end - last.start) / (leg.end - last.start));
        if (Math.abs(predicted - last.to) < 0.6) { last.end = leg.end; last.to = leg.to; continue; }
      }
      legs.push(leg);
    }
  }
  finish();
  return slices;
}

function stitchShortGaps(shape, roads, paths) {
  const slices = [];
  const position = (leg, at) => {
    const lane = roads.byId.get(leg.edge)[leg.lane];
    return { lane, t: clamp(lane.clearStart + at, 0, lane.span) };
  };
  for (const path of paths) {
    const current = slices.at(-1), last = current?.legs.at(-1), first = path.legs[0];
    const gap = last ? first.start - last.end : Infinity;
    if (gap > 0 && gap <= 20) {
      const a = { s: last.end, point: shape.at(last.end) }, b = { s: first.start, point: shape.at(first.start) };
      const target = position(first, first.from);
      const route = roadTransitions(position(last, last.to), [target], a, b, 14).get(target);
      if (route) {
        const middle = routeSlices([{ ...b, prev: a, steps: route.steps }]);
        current.legs.push(...middle.flatMap(s => s.legs), ...path.legs);
        continue;
      }
    }
    slices.push(path);
  }
  return slices;
}

function snapStops(projected, slices, roads, bounds) {
  const firstLeg = slices[0]?.legs[0], lastLeg = slices.at(-1)?.legs.at(-1);
  let previous = 0;
  return projected.map((stop, index) => {
    const isFirst = index === 0, isLast = index === projected.length - 1;
    const latest = projected[index + 1]?.distance ?? Infinity;
    let best;
    if (inside([stop.x, stop.z], bounds)) for (const slice of slices) {
      for (const [legIndex, leg] of slice.legs.entries()) {
        const { start, end, from, to } = leg;
        const reach = stop.platform ? 24 : 16;
        if (start > stop.distance + reach || end < stop.distance - reach) continue;
        const lane = roads.byId.get(leg.edge)[leg.lane];
        const first = isFirst && leg === firstLeg && start - stop.distance < 6;
        const last = isLast && leg === lastLeg && stop.distance - end < 6;
        const lo = Math.max(lane.range[0], lane.clearStart + (first ? 0 : from + (last ? 0.1 : 0)));
        const hi = Math.min(lane.range[1], lane.clearStart + (last ? lane.edge.len : to - (first ? 0.1 : 0)));
        if (lo > hi) continue;
        const position = positionOnLane(stop, lane, lo, hi);
        const maxError = stop.platform ? 6 : 20;
        // Street stop coordinates can sit on the lane centerline or its road's centerline.
        const leftTolerance = stop.platform ? 1.6 : Math.max(0, lane.edge.lanes[lane.index]) + 0.8;
        if (position.error > maxError || position.side < -leftTolerance) continue;
        const at = clamp(position.t - lane.clearStart, 0, lane.edge.len);
        const distance = first ? Math.min(stop.distance, start) : last ? Math.max(stop.distance, end)
          : between(start, end, clamp((at - from) / (to - from), 0, 1));
        if (distance < previous - 0.002 || distance > latest + 0.002) continue;
        const score = position.error + lane.sideCost + Math.abs(distance - stop.distance) * 0.25;
        if (!best || score < best.score) best = { slice, leg, legIndex, score, first, last, at, distance, side: position.side };
      }
    }
    if (best) {
      const { slice, leg, legIndex, first, last, distance, at, side } = best;
      if (first) { leg.start = round(distance); leg.from = round(at); }
      if (last) { leg.end = round(distance); leg.to = round(at); }
      slice.stops.push({ index, leg: legIndex, at: round(at), offset: round(clamp(side - 1.7, 0, 0.45)) });
      previous = distance;
    } else previous = Math.max(previous, stop.distance);
    return { ...stop, distance: round(best?.distance ?? stop.distance), matched: !!best };
  });
}

function clipBoundary(slice, roads, distance, entering) {
  const leg = entering ? slice.legs[0] : slice.legs.at(-1);
  const lane = roads.byId.get(leg.edge)[leg.lane];
  const boundary = lane.range[entering ? 0 : 1];
  if (entering ? boundary <= EPS : boundary >= lane.span - EPS) return;
  const progress = entering ? leg.start : leg.end, at = entering ? leg.from : leg.to;
  const s = boundary - lane.clearStart;
  if (Math.abs(progress - distance) > STEP || Math.abs(at - s) > STEP || s < 0 || s > lane.edge.len) return;
  if (entering && s < leg.to && distance < leg.end) {
    leg.start = round(distance);
    leg.from = round(s);
    slice.entryBoundary = true;
  } else if (!entering && s > leg.from && distance > leg.start) {
    leg.end = round(distance);
    leg.to = round(s);
    slice.exitBoundary = true;
  }
}

function mergeLegs(slice) {
  const legs = [];
  const indexes = slice.legs.map(leg => {
    const last = legs.at(-1);
    if (last && last.edge === leg.edge && last.lane === leg.lane) {
      last.end = leg.end;
      last.to = leg.to;
    } else legs.push(leg);
    return legs.length - 1;
  });
  slice.legs = legs;
  for (const stop of slice.stops) stop.leg = indexes[stop.leg];
}

function coverageGaps(start, end, ranges) {
  const gaps = [];
  let last = start;
  for (const [a, b] of ranges) {
    if (a - last > 0.002) gaps.push([last, a]);
    last = Math.max(last, b);
  }
  if (end - last > 0.002) gaps.push([last, end]);
  return gaps;
}

export function buildBusRoutes(feed, graph) {
  const roads = directedLanes(graph);
  const byId = new Map(graph.edges.map(e => [e.id, e]));
  const edgeKeys = new Map(), calendarKeys = new Map(), calendars = [];
  const dateIndex = dates => {
    const key = dates.join(',');
    if (!calendarKeys.has(key)) { calendarKeys.set(key, calendars.length); calendars.push(dates); }
    return calendarKeys.get(key);
  };
  const report = { source: feed.source, bounds: graph.bounds, variants: [] };
  const variants = feed.variants.map(({ shape: coords, stops, trips = [], ...variant }) => {
    if (stops.length < 2) throw new Error(`GTFS variant ${variant.id} has fewer than two stops`);
    const shape = sourceShape(coords);
    const projected = shapeStops(stops, shape);
    const start = projected[0].distance, end = projected.at(-1).distance;
    const insideRanges = modeledRanges(shape, graph.bounds, start, end);
    const slices = insideRanges.flatMap(([a, b]) => {
      const paths = stitchShortGaps(shape, roads, routeSlices(matchRange(shape, roads, projected, a, b)));
      if (!paths.length) return paths;
      if (a > start + EPS) clipBoundary(paths[0], roads, a, true);
      if (b < end - EPS) clipBoundary(paths.at(-1), roads, b, false);
      return paths;
    });
    const locatedStops = snapStops(projected, slices, roads, graph.bounds);
    slices.forEach(mergeLegs);
    const sliceRanges = slices.map(({ legs }) => [legs[0].start, legs.at(-1).end]);
    for (const { legs } of slices) for (const leg of legs) {
      const key = byId.get(leg.edge).key;
      if (typeof key !== 'string' || !key) throw new Error(`Road edge ${leg.edge} has no stable key`);
      if (!edgeKeys.has(key)) edgeKeys.set(key, edgeKeys.size);
      leg.edge = edgeKeys.get(key);
    }
    const gap = ([a, b], reason) => ({ reason, from: round(a), to: round(b), metres: round(b - a),
      points: [shape.at(a), shape.at((a + b) / 2), shape.at(b)].map(point => point.map(round)),
      stops: locatedStops.filter(stop => stop.distance >= a && stop.distance <= b && !stop.matched).map(({ id, name }) => ({ id, name })) });
    const gaps = [
      ...coverageGaps(start, end, insideRanges).map(range => gap(range, 'outside-map')),
      ...insideRanges.flatMap(([a, b]) => coverageGaps(a, b, sliceRanges.filter(([c, d]) => d > a && c < b))
        .map(range => gap(range, 'no-connected-lane')))
    ].sort((a, b) => a.from - b.from);
    const sum = ranges => round(ranges.reduce((total, [a, b]) => total + b - a, 0));
    report.variants.push({ id: variant.id, line: variant.line, direction: variant.direction, headsign: variant.headsign,
      serviceDistanceM: round(end - start), insideMapM: sum(insideRanges), matchedM: sum(sliceRanges),
      matchedStops: locatedStops.filter(stop => stop.matched).length,
      stops: locatedStops.map(({ id, name, platform, x, z, distance, matched }) => ({ id, name, platform, x, z, distance, matched })), gaps });
    return { ...variant, length: round(shape.length), stops: locatedStops, slices,
      trips: trips.map(trip => ({ ...trip, dates: dateIndex(trip.dates) })) };
  });
  return { data: { ...feed, bounds: graph.bounds, edges: [...edgeKeys.keys()], calendars, variants }, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, roads, asset = fileURLToPath(new URL('../assets/ede-bus-routes.json', import.meta.url)), reportFile] = process.argv.slice(2);
  if (!input || !roads) throw new Error('Usage: node tools/build-ede-bus-routes.mjs GTFS_JSON ROAD_GRAPH_JSON [ASSET_JSON] [REPORT_JSON]');
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const { data, report } = buildBusRoutes(read(input), read(roads));
  fs.writeFileSync(asset, `${JSON.stringify(data)}\n`);
  if (reportFile) fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  for (const v of report.variants) {
    console.log(`${v.line} ${v.headsign} (${v.id}): ${Math.round(v.matchedM)}/${Math.round(v.insideMapM)} m on map, ${v.matchedStops}/${v.stops.length} stops, ${v.gaps.length} gaps`);
  }
}
