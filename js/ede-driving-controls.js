import { FOOT, MOTOR, BUS } from './road-access.js';
import { EDE_DRIVING_CONTROL_EVIDENCE } from './ede-driving-control-evidence.js';

const EMPTY = [];
const BUMP_SPEED = { hump: 5.2, table: 7.2, cushion: 5.8 };
const ROAD_MARKING_DWELL = 1.25;
const sameLayer = (a, b) => (a.layer ?? 0) === (b.layer ?? 0);
const eligible = (feature, match, confidence) => feature.match === 'matched' && match.confidence >= confidence;
const isYieldingZebra = feature => feature.marked && (feature.control === 'uncontrolled' || feature.control === 'zebra');
const completeZebra = feature => feature.match === 'matched' && isYieldingZebra(feature)
  && feature.sidewalks?.length === 2 && feature.sidewalks.every(end => end.edges.length);

function add(index, key, item) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(item);
}

function distanceToLine(x, z, [a, b]) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const fraction = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * fraction, z - a[1] - dz * fraction);
}

function hasSupplement(sign) {
  return sign.supplementarySigns?.length || sign.privateProperty || sign.missingRoadSection
    || sign.conditions?.exemptions?.length || Object.keys(sign.conditions?.restrictions ?? {}).length;
}

export function createEdeDrivingControls(features, network, evidence = EDE_DRIVING_CONTROL_EVIDENCE) {
  const roads = new Map(), approaches = new Map(), junctions = new Set(), roundaboutEntries = new Map();
  const roundabouts = new Set(evidence.roundabouts);
  const signedStops = new Set(), handledSigns = new Set(), boundBumps = new Set(), boundZebras = new Set();
  const activeLines = new Set();
  const linesByWay = new Map(), zebrasByWay = new Map(), zebrasByOsmNode = new Map();
  const zebraPaths = new WeakMap(), dwells = new WeakMap();
  const isRing = edge => roundabouts.has(edge.wayId);
  const edges = network?.edges ?? EMPTY;
  const hasJunction = edge => !edge.to.shape && edge.to.in?.some(other =>
    other !== edge && other.axisIndex !== edge.axisIndex && sameLayer(edge, other));

  for (const line of evidence.lines) add(linesByWay, line[2], line);
  const zebras = features?.crossings?.filter(isYieldingZebra) ?? EMPTY;
  for (const zebra of zebras) {
    if (!completeZebra(zebra)) continue;
    for (const osmId of zebra.osmNodeIds ?? EMPTY) add(zebrasByOsmNode, String(osmId), zebra);
    for (const way of new Set(zebra.edges.filter(match => match.modes & MOTOR && eligible(zebra, match, 0.85)).map(match => match.way))) {
      add(zebrasByWay, way, zebra);
    }
  }

  for (const edge of edges) {
    if (!edge.wayId || !(edge.modes & MOTOR) || edge.boundary) continue;
    // The bake measures from the graph node; cars measure from the inset lane start.
    const start = (edge.sx - edge.from.x) * edge.dx + (edge.sz - edge.from.z) * edge.dz;
    const incoming = edge.to.in ?? EMPTY;
    const ringLanes = incoming.filter(other => other !== edge && isRing(other) && sameLayer(edge, other));
    if (edge.moves?.some(move => isRing(move.to) && sameLayer(edge, move.to)) && ringLanes.length) {
      if (!isRing(edge)) roundaboutEntries.set(edge, ringLanes);
      junctions.add(edge.to);
    }
    const junction = hasJunction(edge) || roundaboutEntries.has(edge);
    let approach = null;
    if (junction) for (const [id, kind, , layer, x, z, dx, dz] of linesByWay.get(edge.wayId) ?? EMPTY) {
      if (layer !== (edge.layer ?? 0) || dx * edge.dx + dz * edge.dz < 0.8) continue;
      const station = (x - edge.sx) * edge.dx + (z - edge.sz) * edge.dz;
      const aside = Math.abs((x - edge.sx) * edge.dz - (z - edge.sz) * edge.dx);
      if (station < -0.2 || aside > 3.2 || Math.abs(edge.len - station) > 16) continue;
      if (!approach || kind === 'stop' && approach.kind !== 'stop' ||
          kind === approach.kind && Math.abs(edge.len - station) < Math.abs(edge.len - approach.at)) {
        approach = { id, kind, at: station, modes: edge.modes };
      }
    }

    const bumps = [], crossings = [];
    for (const match of features?.forRoad(edge) ?? EMPTY) {
      const { feature, type } = match;
      const modes = match.modes & edge.modes & (feature.affectedModes ?? MOTOR);
      if (!modes || !sameLayer(match, edge) || !sameLayer(feature, edge) ||
          feature.bridge != null && feature.bridge !== !!edge.bridge ||
          feature.tunnel != null && feature.tunnel !== !!edge.underpass) continue;
      const from = match.from - start, to = match.to - start;
      if (type === 'bump' && eligible(feature, match, 0.83) && feature.height > 0 && BUMP_SPEED[feature.profile]) {
        bumps.push({ id: feature.id, from, to, modes, speed: BUMP_SPEED[feature.profile] });
        boundBumps.add(feature.id);
      } else if (type === 'crossing' && completeZebra(feature) && match.confidence >= 0.85) {
        crossings.push({ id: feature.id, from, to, modes });
        boundZebras.add(feature.id);
      } else if (type === 'sign' && junction && eligible(feature, match, 0.84) && !hasSupplement(feature)
          && Number.isFinite(feature.appliesBearing) && edge.span - match.to <= 16 && from >= -3) {
        if (/^B0?7$/.test(feature.rvvCode)) {
          signedStops.add(feature.id);
          if (approach?.kind === 'stop' && Math.abs(approach.at - from) <= 10) handledSigns.add(feature.id);
        }
        if (/^B0?6$/.test(feature.rvvCode)) {
          handledSigns.add(feature.id);
          approach ??= { id: feature.id, kind: 'yield', at: edge.len, modes };
        }
      }
    }
    if (approach) {
      if (approach.id.startsWith('n')) activeLines.add(approach.id);
      approaches.set(edge, approach);
      junctions.add(edge.to);
    } else if (roundaboutEntries.has(edge)) {
      approaches.set(edge, { id: ringLanes[0].wayId, kind: 'roundabout', at: edge.len, modes: edge.modes });
    }
    if (bumps.length || crossings.length) roads.set(edge, { bumps, crossings });
  }

  const priority = new Map();
  for (const edge of edges) {
    if (!junctions.has(edge.to)) continue;
    const incoming = edge.to.in.filter(other => other !== edge && sameLayer(edge, other));
    const mapped = approaches.get(edge);
    if (roundaboutEntries.has(edge)) {
      priority.set(edge, roundaboutEntries.get(edge));
    } else if (isRing(edge) && edge.to.out?.some(next => isRing(next) && sameLayer(edge, next))) {
      priority.set(edge, EMPTY);
    } else if (mapped) {
      const crossTraffic = incoming.filter(other => other.axisIndex !== edge.axisIndex && !approaches.has(other));
      if (crossTraffic.length) priority.set(edge, crossTraffic);
    } else if (incoming.some(other => other.axisIndex !== edge.axisIndex && approaches.has(other))) {
      priority.set(edge, EMPTY);
    }
  }

  function approach(edge, mode = MOTOR) {
    const rule = approaches.get(edge);
    return rule?.modes & mode ? rule : null;
  }

  function stopTarget(vehicle, clock, mode = MOTOR) {
    if (vehicle.conn) return Infinity;
    const { edge, half, s, speed } = vehicle;
    const rule = approach(edge, mode);
    if (rule?.kind !== 'stop') return Infinity;
    const target = Math.max(0, Math.min(rule.at - half - 0.2, edge.len - Math.min(half, edge.len * 0.45) - 0.08));
    let dwell = dwells.get(vehicle);
    if (dwell?.edge !== edge) {
      dwell = { edge, since: Infinity, complete: s > target + 0.4 };
      dwells.set(vehicle, dwell);
    }
    if (dwell.complete) return Infinity;
    if (s >= target - 0.24 && Math.abs(speed) <= 0.18) {
      dwell.since = Math.min(dwell.since, clock);
      dwell.complete = clock - dwell.since >= ROAD_MARKING_DWELL;
    } else {
      dwell.since = Infinity;
    }
    return dwell.complete ? Infinity : target;
  }

  function speedCap(edge, s, half = 0, mode = MOTOR) {
    let cap = Infinity;
    for (const bump of roads.get(edge)?.bumps ?? EMPTY) {
      if (!(bump.modes & mode) || s - half > bump.to) continue;
      const speed = bump.speed * (mode === BUS ? 0.82 : 1);
      const distance = Math.max(0, bump.from - s - half);
      cap = Math.min(cap, Math.sqrt(speed * speed + 4.6 * distance));
    }
    return cap;
  }

  function crossings(edge, mode = MOTOR) {
    const matches = roads.get(edge)?.crossings ?? EMPTY;
    return mode === MOTOR || matches.every(row => row.modes & mode) ? matches : matches.filter(row => row.modes & mode);
  }

  function pathCrossings(track, direction = 1, mode = FOOT) {
    if (mode !== FOOT || !track?.crossing || !track.allowed?.[direction < 0 ? 1 : 0]) return EMPTY;
    let directions = zebraPaths.get(track);
    if (!directions) zebraPaths.set(track, (directions = []));
    const i = direction < 0 ? 1 : 0;
    if (directions[i]) return directions[i];
    const { wayIds = EMPTY, osmId, x, z } = track.crossing;
    const candidates = new Set(zebrasByOsmNode.get(String(osmId)));
    for (const way of wayIds) for (const zebra of zebrasByWay.get(way) ?? EMPTY) candidates.add(zebra);
    const exact = track.wayId ? features?.forPath(track, direction, FOOT) ?? EMPTY : EMPTY;
    const matched = new Set(exact.filter(match => match.type === 'crossing' && match.confidence >= 0.75).map(match => match.feature));
    return directions[i] = [...candidates].filter(zebra => {
      if (!boundZebras.has(zebra.id) || !sameLayer(zebra, track) ||
          (zebra.bridge != null || zebra.tunnel != null) && !!(zebra.bridge || zebra.tunnel) !== !!track.structure ||
          !zebra.edges.some(match => match.modes & MOTOR && wayIds.includes(match.way))) return false;
      if (matched.has(zebra) || zebra.osmNodeIds?.some(id => String(id) === String(osmId))) return true;
      const tangent = zebra.tangent;
      return tangent && Math.abs(track.ux * tangent[0] + track.uz * tangent[1]) < 0.58 &&
        (zebra.segments ?? [zebra]).some(strip => strip.marked !== false && strip.ends?.length === 2 &&
          distanceToLine(x, z, strip.ends) < 2.2);
    }).map(zebra => zebra.id);
  }

  const mappedSignCounts = (features?.signs ?? EMPTY).reduce((counts, sign) => {
    if (/^B0?6$/.test(sign.rvvCode)) counts.yield++;
    if (/^B0?7$/.test(sign.rvvCode)) counts.stop++;
    return counts;
  }, { yield: 0, stop: 0 });
  const activeStops = new Set([...approaches.values()].filter(rule => rule.kind === 'stop').map(rule => rule.id)).size;
  const boundYieldSigns = [...handledSigns].filter(id => !signedStops.has(id)).length;
  const zebraIntents = new Set();
  if (network?.activeTravel?.foot && network.nodes?.length && boundZebras.size) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const { x, z } of network.nodes) {
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
    const tracks = [];
    network.activeTravel.foot((minX + maxX) / 2, (minZ + maxZ) / 2, Math.hypot(maxX - minX, maxZ - minZ) / 2 + 20, tracks);
    for (const track of tracks) {
      for (const id of pathCrossings(track, 1)) zebraIntents.add(id);
      for (const id of pathCrossings(track, -1)) zebraIntents.add(id);
    }
  }
  const review = {
    bumps: { linked: boundBumps.size, review: (features?.bumps?.length ?? 0) - boundBumps.size },
    zebras: { linked: zebraIntents.size, roadOnly: boundZebras.size - zebraIntents.size, review: zebras.length - zebraIntents.size },
    signs: { stop: mappedSignCounts.stop, yield: mappedSignCounts.yield, linkedYield: boundYieldSigns,
      review: mappedSignCounts.stop + mappedSignCounts.yield - handledSigns.size },
    mappedLines: { stop: activeStops, yield: activeLines.size - activeStops, review: evidence.lines.length - activeLines.size },
    roundaboutEntries: roundaboutEntries.size,
    legacySignalJunctions: network?.nodes?.filter(node => node.signal).length ?? 0,
    signalizedCrossingsWithoutPlans: features?.crossings?.filter(feature => feature.control === 'signal').length ?? 0
  };

  return { approach, conflicts: (edge, mode = MOTOR) => edge.modes & mode ? priority.get(edge) ?? null : null,
    speedCap, crossings, pathCrossings, stopTarget,
    resetVehicle: vehicle => dwells.delete(vehicle), review };
}
