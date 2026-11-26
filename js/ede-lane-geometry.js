// Geometry is baked in scene metres. Stations remain in the existing directed edge frame.
const STRIDE = 5;
const POINT_EPSILON = 0.08;

export async function loadEdeFittedLanes() {
  const response = await fetch(new URL('../assets/ede-fitted-lanes.json.gz?v=20261126-apeldoornseweg', import.meta.url));
  if (!response.ok) throw new Error(`Ede lane geometry HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = new Response(bytes);
  const asset = await (bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body).json();
  if (asset.version !== 1 || !asset.edges || Array.isArray(asset.edges)) throw new Error('Invalid Ede lane geometry');
  return asset;
}

function compile(samples, length) {
  if (!Array.isArray(samples) || samples.length < 2 * STRIDE || samples.length % STRIDE ||
      samples[0] !== 0 || Math.abs(samples.at(-STRIDE) - length) > POINT_EPSILON) return null;
  let previousStation = -1, previousDistance = -1;
  const size = samples.length / STRIDE;
  const tangent = new Float32Array(size * 2);
  let curv = 0;
  for (let i = 0; i < size; i++) {
    const n = i * STRIDE;
    const s = samples[n], x = samples[n + 1], z = samples[n + 2], d = samples[n + 3], width = samples[n + 4];
    if (!Number.isFinite(s) || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(d) ||
        !Number.isFinite(width) || s <= previousStation || d <= previousDistance || width <= 0) return null;
    const a = Math.max(0, n - STRIDE), b = Math.min(samples.length - STRIDE, n + STRIDE);
    const dx = samples[b + 1] - samples[a + 1], dz = samples[b + 2] - samples[a + 2];
    const len = Math.hypot(dx, dz);
    if (!(len > 0.001) || (i && Math.hypot(x - samples[n - STRIDE + 1], z - samples[n - STRIDE + 2]) <= 0.001)) return null;
    tangent[i * 2] = dx / len;
    tangent[i * 2 + 1] = dz / len;
    if (i) {
      const cross = tangent[i * 2 - 2] * tangent[i * 2 + 1] - tangent[i * 2 - 1] * tangent[i * 2];
      const dot = tangent[i * 2 - 2] * tangent[i * 2] + tangent[i * 2 - 1] * tangent[i * 2 + 1];
      curv = Math.max(curv, Math.abs(Math.atan2(cross, dot)) / (d - previousDistance));
    }
    previousStation = s;
    previousDistance = d;
  }
  return { samples: Float32Array.from(samples), tangent, curv, len: length };
}

function pointOn(path, s, out, extend = false) {
  const { samples, tangent } = path;
  let lo = 0, hi = samples.length / STRIDE - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid * STRIDE] <= s) lo = mid;
    else hi = mid;
  }
  const a = lo * STRIDE, b = hi * STRIDE;
  const scale = (samples[b] - samples[a]) / (samples[b + 3] - samples[a + 3]);
  const t = Math.max(0, Math.min(1, (s - samples[a]) / (samples[b] - samples[a])));
  const dx = tangent[lo * 2] * (1 - t) + tangent[hi * 2] * t;
  const dz = tangent[lo * 2 + 1] * (1 - t) + tangent[hi * 2 + 1] * t;
  const norm = Math.hypot(dx, dz) || 1;
  out.dx = dx / norm;
  out.dz = dz / norm;
  const extra = extend ? s - Math.min(samples.at(-STRIDE), Math.max(0, s)) : 0;
  out.x = samples[a + 1] * (1 - t) + samples[b + 1] * t + out.dx * extra / scale;
  out.z = samples[a + 2] * (1 - t) + samples[b + 2] * t + out.dz * extra / scale;
  out.width = samples[a + 4] * (1 - t) + samples[b + 4] * t;
  out.stationScale = scale;
  return out;
}

export function fittedLanePoint(edge, lane, station, out) {
  const geometry = edge.fittedLanes?.[lane];
  if (geometry) return pointOn(geometry, station + (edge.fittedStationOffset ?? 0), out, true);
  out.x = edge.sx + edge.dx * station + edge.rx * edge.lanes[lane];
  out.z = edge.sz + edge.dz * station + edge.rz * edge.lanes[lane];
  out.dx = edge.dx;
  out.dz = edge.dz;
  out.stationScale = 1;
  out.width = edge.driveLanes?.[lane]?.width ?? 3.4;
  return out;
}

export function projectFittedLane(edge, lane, x, z, from, to, out) {
  const path = edge.fittedLanes?.[lane];
  const cap = s => Math.max(from, Math.min(to, s));
  let station = cap((x - edge.sx) * edge.dx + (z - edge.sz) * edge.dz);
  if (path) {
    let best = Infinity;
    const { samples } = path;
    const offset = edge.fittedStationOffset ?? 0;
    for (let i = STRIDE; i < samples.length; i += STRIDE) {
      const a = i - STRIDE;
      const span = samples[i] - samples[a], ax = samples[a + 1], az = samples[a + 2];
      const dx = samples[i + 1] - ax, dz = samples[i + 2] - az;
      const low = Math.max(a ? 0 : -Infinity, (from + offset - samples[a]) / span);
      const high = Math.min(i < samples.length - STRIDE ? 1 : Infinity, (to + offset - samples[a]) / span);
      if (low > high) continue;
      const raw = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
      const t = Math.max(low, Math.min(high, raw));
      const error = (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
      if (error < best) { best = error; station = samples[a] + span * t - offset; }
    }
  }
  fittedLanePoint(edge, lane, station, out);
  out.station = station;
  return out;
}

// Map the original road shape onto the existing traffic edge and stop-line stations.
export function mappedRoadPath(edge) {
  if (!edge.paintPath || edge.bridge || edge.underpass || edge.layer) return;
  const source = edge.direction ? edge.paintPath.toReversed() : edge.paintPath;
  const first = source[0], last = source.at(-1);
  const length = Math.hypot(last.x - first.x, last.z - first.z);
  if (!length || !source.some(({ x, z }) =>
    Math.abs((x - first.x) * (last.z - first.z) - (z - first.z) * (last.x - first.x)) > length * 0.75)) return;
  const points = [{ x: edge.x0, z: edge.z0 }, ...source.slice(1, -1),
    { x: edge.x0 + edge.dx * edge.span, z: edge.z0 + edge.dz * edge.span }];
  const sections = [];
  let distance = 0;
  for (const point of points) {
    const previous = sections.at(-1);
    if (previous) {
      const span = Math.hypot(point.x - previous.x, point.z - previous.z);
      if (span < 0.03) continue;
      previous.nx = (previous.z - point.z) / span;
      previous.nz = (point.x - previous.x) / span;
      distance += span;
    }
    sections.push({ ...point, distance });
  }
  if (sections.length < 2) return;
  const setback = (edge.sx - edge.x0) * edge.dx + (edge.sz - edge.z0) * edge.dz;
  return sections.map((point, i) => {
    const before = sections[Math.max(0, i - 1)], after = i + 1 === sections.length ? before : point;
    const miter = Math.max(0.6, 1 + before.nx * after.nx + before.nz * after.nz);
    return { x: point.x, z: point.z, station: point.distance / distance * edge.span - setback,
      nx: (before.nx + after.nx) / miter, nz: (before.nz + after.nz) / miter };
  });
}

export function mappedRoadPoint(path, station, offset) {
  const right = path.findIndex(point => point.station >= station);
  const i = right < 0 ? path.length - 1 : Math.max(1, right);
  const a = path[i - 1], b = path[i];
  const t = (station - a.station) / (b.station - a.station);
  return [a.x + (b.x - a.x) * t + (a.nx + (b.nx - a.nx) * t) * offset,
    a.z + (b.z - a.z) * t + (a.nz + (b.nz - a.nz) * t) * offset];
}

export function bindApeldoornsewegCurves(network, edgeKey) {
  const mapped = new Map();
  for (const edge of network.edges) {
    if (edge.roadName !== 'Apeldoornseweg' || edge.fittedLanes?.every(Boolean)) continue;
    const path = mappedRoadPath(edge);
    if (!path) continue;
    const { sx, sz, dx, dz, rx, rz, len } = edge;
    // The median BGT centre is offset from the mapped axis on the two long one-way carriageways.
    const centerOffset = { w118547825: 0.9, w160287247: -1.3 }[edge.wayId] ?? 0;
    const taper = Math.min(16, len / 3);
    const stations = [...new Set([0, taper / 2, taper, len - taper, len - taper / 2, len,
      ...path.map(point => point.station).filter(station => station > 0 && station < len)])].sort((a, b) => a - b);
    edge.fittedLanes = edge.lanes.map((offset, lane) => {
      if (edge.fittedLanes?.[lane]) return edge.fittedLanes[lane];
      const samples = [];
      let distance = 0, px, pz;
      for (const station of stations) {
        const straightX = sx + dx * station + rx * offset;
        const straightZ = sz + dz * station + rz * offset;
        const [x, z] = mappedRoadPoint(path, station, offset + centerOffset);
        // Keep the archived junction endpoints while following the mapped shape between them.
        const t = Math.min(1, station / taper, (len - station) / taper);
        const weight = t * t * (3 - 2 * t);
        const laneX = straightX + (x - straightX) * weight;
        const laneZ = straightZ + (z - straightZ) * weight;
        if (samples.length) distance += Math.hypot(laneX - px, laneZ - pz);
        samples.push(station, laneX, laneZ, distance, edge.driveLanes?.[lane]?.width ?? 3.4);
        px = laneX;
        pz = laneZ;
      }
      return compile(samples, len);
    });
    mapped.set(edgeKey(edge), edge);
  }
  for (const edge of network.paintEdges ?? []) {
    const runtime = mapped.get(edgeKey(edge));
    if (!runtime || edge.lanes.length !== runtime.lanes.length) continue;
    edge.fittedLanes = runtime.fittedLanes;
    edge.fittedStationOffset = (edge.sx - runtime.sx) * edge.dx + (edge.sz - runtime.sz) * edge.dz;
  }
}

export function bindEdeFittedLanes(network, asset, edgeKey) {
  const stats = { edges: 0, lanes: 0, connectors: 0, rejectedEdges: 0, rejectedConnectors: 0 };
  if (!asset) return stats;
  const byKey = new Map();
  for (const edge of network.edges) if (edge.wayId) byKey.set(edgeKey(edge), edge);
  for (const [key, record] of Object.entries(asset.edges)) {
    const edge = byKey.get(key);
    if (!edge || !Array.isArray(record?.lanes) || record.lanes.length !== edge.lanes.length ||
        !Array.isArray(record.start) || record.start.length !== 2 || !record.start.every(Number.isFinite) || Math.hypot(record.start[0] - edge.sx, record.start[1] - edge.sz) > POINT_EPSILON) {
      stats.rejectedEdges++;
      continue;
    }
    const fit = record.lanes.map(row => row && compile(row, edge.len));
    if (!fit.some(Boolean)) {
      stats.rejectedEdges++;
      continue;
    }
    edge.fittedLanes = fit;
    stats.edges++;
    stats.lanes += fit.filter(Boolean).length;
  }
  const originalConnector = network.connector, originalPoint = network.curvePoint;
  const paths = new Map(), source = {}, target = {}, endpoint = {};
  const keyFor = (e, i, f, j) => ((e.id * 16 + i) * network.edges.length + f.id) * 16 + j;
  const close = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) <= POINT_EPSILON;
  for (const [from, destinations] of Object.entries(asset.connectors ?? {})) for (const [to, records] of Object.entries(destinations)) {
    const e = byKey.get(from), f = byKey.get(to);
    for (const [pair, samples] of Object.entries(records)) {
      const [i, j] = pair.split(':').map(Number);
      if (!e || !f || e.lanes[i] == null || f.lanes[j] == null || !e.moves.some(move =>
        move.to === f && (move.out[i] === j || network.alternateBusMove?.(e, move, i, j)))) {
        stats.rejectedConnectors++;
        continue;
      }
      const old = originalConnector(e, i, f, j);
      const path = compile(samples, old.len);
      if (!path || !close(fittedLanePoint(e, i, e.len, source), pointOn(path, 0, endpoint)) ||
          !close(fittedLanePoint(f, j, 0, target), pointOn(path, old.len, endpoint))) {
        stats.rejectedConnectors++;
        continue;
      }
      paths.set(keyFor(e, i, f, j), path);
      stats.connectors++;
    }
  }
  // Edges and connectors are exported together. A stale asset must not move a
  // lane endpoint away from the legacy connector it would otherwise fall back to.
  if (stats.rejectedEdges || stats.rejectedConnectors) {
    for (const edge of byKey.values()) delete edge.fittedLanes;
    stats.edges = stats.lanes = stats.connectors = 0;
    return stats;
  }
  for (const edge of network.paintEdges ?? []) if (edge.wayId) {
    const runtime = byKey.get(edgeKey(edge));
    if (!runtime?.fittedLanes || edge.lanes.length !== runtime.lanes.length) continue;
    edge.fittedLanes = runtime.fittedLanes;
    edge.fittedStationOffset = (edge.sx - runtime.sx) * edge.dx + (edge.sz - runtime.sz) * edge.dz;
  }

  network.connector = (e, i, f, j) => paths.get(keyFor(e, i, f, j)) ?? originalConnector(e, i, f, j);
  network.curvePoint = (curve, station, out) => {
    if (curve.samples) return pointOn(curve, station, out);
    out.stationScale = 1;
    return originalPoint(curve, station, out);
  };
  return stats;
}
