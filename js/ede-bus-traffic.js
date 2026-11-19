import { roadEdgeKey } from './road-network.js';
import { busProgressAt } from './ede-bus-schedule.js';
import { BUS } from './road-access.js';
import { EDE_TURN_RESTRICTIONS } from './ede-turn-restrictions.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function assignBusLanes(legs, alternateMove) {
  let restriction;
  for (let i = 1; i < legs.length; i++) {
    const move = legs[i - 1].road?.moves.find(move => move.to === legs[i].road);
    if (!move || !(restriction = EDE_TURN_RESTRICTIONS.step(restriction, move, BUS))) return false;
  }
  let next = null;
  for (let i = legs.length - 1; i >= 0; i--) {
    const { road, lane } = legs[i];
    if (!road) return false;
    const moves = next && road.moves.filter(move => move.to === legs[i + 1].road && (move.modes ?? BUS) & BUS);
    const choices = road.lanes.map((_, index) => {
      if (!((road.laneModes?.[index] ?? road.modes ?? BUS) & BUS)) return null;
      const cost = Math.abs(index - lane);
      if (!next) return { index, cost };
      let best = null;
      for (const move of moves) {
        for (const onward of next) {
          if (!onward) continue;
          const normal = move.out[index] === onward.index;
          const total = cost + onward.cost + (normal ? 0 : 10);
          if (best && best.cost <= total) continue;
          const connection = normal ? move : alternateMove?.(road, move, index, onward.index);
          if (connection) best = { index, cost: total, onward, connection };
        }
      }
      return best;
    });
    if (!choices.some(Boolean)) return false;
    next = choices;
  }
  let choice = next?.reduce((best, lane) => lane && (!best || lane.cost < best.cost) ? lane : best, null);
  if (!choice) return false;
  for (const leg of legs) {
    leg.lane = choice.index;
    leg.move = choice.connection;
    choice = choice.onward;
  }
  return true;
}

export function prepareEdeBusPaths(schedule, edges, alternateMove) {
  const byKey = new Map(edges.map((edge) => [roadEdgeKey(edge), edge]));
  const references = (schedule?.edges || []).map((key) => byKey.get(key));
  const paths = new Map();
  let missing = 0;
  for (const variant of schedule?.variants || []) {
    for (const slice of variant.slices) {
      const legs = slice.legs.map((leg) => ({ ...leg, road: references[leg.edge] }));
      if (!assignBusLanes(legs) && (!alternateMove || !assignBusLanes(legs, alternateMove))) {
        missing++;
        continue;
      }
      const stops = (slice.stops || []).map(({ index, leg, at }) => {
        const { road, lane } = legs[leg];
        const stop = variant.stops[index];
        const side = (stop.x - road.sx) * road.rx + (stop.z - road.sz) * road.rz - road.lanes[lane];
        return { index, leg, at: clamp(at, 0, road.len), side, stop };
      });
      paths.set(slice, { legs, stops });
    }
  }
  if (missing) console.warn(`[buses] ${missing} route sections differ from the current road graph`);
  return paths;
}

export function busEntryAt(path, distance, initial) {
  const { legs, stops } = path;
  const stop = initial && stops.find(({ stop }) => Math.abs(stop.distance - distance) < 0.05);
  if (stop) return { leg: stop.leg, at: stop.at, stop: stops.indexOf(stop) };
  const found = initial ? legs.findIndex(({ end }) => end >= distance) : 0;
  const leg = found < 0 ? legs.length - 1 : found;
  const { start, end, from, to, road } = legs[leg];
  const progress = initial && end > start ? clamp((distance - start) / (end - start), 0, 1) : 0;
  const at = clamp(from + (to - from) * progress, 0, road.len);
  const nextStop = stops.findIndex((stop) => stop.leg > leg || (stop.leg === leg && stop.at >= at - 0.1));
  return { leg, at, stop: nextStop < 0 ? stops.length : nextStop };
}

const MAX_FEED_AGE = 120;
const MAX_PROJECTION_ERROR = 45;

function fresh(timestamp, now) {
  return Number.isFinite(timestamp) && timestamp >= now - MAX_FEED_AGE && timestamp <= now + 15;
}

function currentStopIndex(run, vehicle) {
  const { stops } = run.variant;
  const { stopId, stopSequence } = vehicle;
  if (Number.isInteger(stopSequence)) {
    const sequences = run.trip.stopSequences;
    const index = sequences ? sequences.indexOf(stopSequence) : stopSequence - 1;
    if (stops[index] && (!stopId || stops[index].id === stopId)) return index;
  }
  if (!stopId) return -1;
  const index = stops.findIndex(stop => stop.id === stopId);
  return index === stops.findLastIndex(stop => stop.id === stopId) ? index : -1;
}

function projectBus(run, vehicle, paths, previous) {
  const stops = run.variant.stops;
  const stopIndex = currentStopIndex(run, vehicle);
  const stop = stops[stopIndex];
  if (vehicle.status === 1 && stop?.matched &&
      Math.hypot(vehicle.x - stop.x, vehicle.z - stop.z) <= MAX_PROJECTION_ERROR) return stop.distance;
  const lower = vehicle.status === 1 ? stop?.distance : stops[stopIndex - 1]?.distance;
  const upper = stop?.distance;
  const heading = vehicle.bearing * Math.PI / 180;
  let best;
  for (const section of run.runs) {
    const path = paths.get(section.slice);
    if (!path) continue;
    for (const leg of path.legs) {
      const { road, lane, from, to, start, end } = leg;
      const x = vehicle.x - road.sx - road.rx * road.lanes[lane];
      const z = vehicle.z - road.sz - road.rz * road.lanes[lane];
      const along = clamp(x * road.dx + z * road.dz, from, to);
      const error = Math.hypot(x - road.dx * along, z - road.dz * along);
      if (error > MAX_PROJECTION_ERROR) continue;
      const distance = to === from ? start : start + (end - start) * (along - from) / (to - from);
      let score = error;
      if (Number.isFinite(heading) && vehicle.status !== 1) {
        score += 18 * (1 - road.dx * Math.sin(heading) + road.dz * Math.cos(heading));
      }
      if (lower !== undefined) score += 0.6 * Math.max(0, lower - distance - 30);
      if (upper !== undefined) score += 0.6 * Math.max(0, distance - upper - 30);
      if (previous?.distance !== undefined) {
        const age = vehicle.timestamp - previous.timestamp;
        score += 0.4 * Math.max(0, previous.distance - distance - 15, distance - previous.distance - 30 - age * 25);
      }
      if (!best || score < best.score) best = { distance, score };
    }
  }
  return best?.distance;
}

export function createEdeBusTracker(schedule, paths) {
  let lastFeed, lastFeedTime = 0, observations = new Map();

  function acceptFeed(feed, now = Date.now() / 1000) {
    if (fresh(feed?.timestamp, now) && Array.isArray(feed.vehicles) && feed !== lastFeed && feed.timestamp >= lastFeedTime) {
      const next = new Map();
      lastFeed = feed;
      lastFeedTime = feed.timestamp;
      for (const vehicle of feed.vehicles) {
        const timestamp = vehicle.timestamp ?? feed.timestamp;
        if (!fresh(timestamp, now) || !Number.isFinite(vehicle.x) || !Number.isFinite(vehicle.z)) continue;
        const run = schedule.tripAtTime(vehicle.tripId, vehicle.serviceDate, timestamp);
        if (!run || next.get(run.tripKey)?.timestamp > timestamp) continue;
        const previous = observations.get(run.tripKey);
        if (previous?.timestamp >= timestamp) {
          next.set(run.tripKey, previous);
          continue;
        }
        const distance = projectBus(run, { ...vehicle, timestamp }, paths, previous);
        if (distance === undefined) {
          next.set(run.tripKey, { run, timestamp });
          continue;
        }
        let speed = vehicle.status === 1 ? 0 : vehicle.speed;
        if (!Number.isFinite(speed) && previous?.distance !== undefined) {
          const sampleSpeed = (distance - previous.distance) / (timestamp - previous.timestamp);
          if (sampleSpeed >= 0 && sampleSpeed <= 25) speed = sampleSpeed;
        }
        next.set(run.tripKey, { run, timestamp, distance, speed });
      }
      observations = next;
    }
  }

  function tripsAt(clock, now = Date.now() / 1000) {
    const due = lastFeedTime ? schedule.tripsAtTime(now) : schedule.tripsAt(clock);
    const live = [];
    const tracked = new Set();
    if (!fresh(lastFeedTime, now)) return due;
    for (const [tripKey, observation] of observations) {
      const { run, timestamp, distance, speed } = observation;
      if (!fresh(timestamp, now)) continue;
      tracked.add(tripKey);
      if (distance === undefined) continue;
      const age = clamp(now - timestamp, 0, 30);
      const predicted = busProgressAt(run.trip, run.variant.stops, distance, age, speed);
      const section = run.runs.find(({ startDistance, endDistance }) => predicted >= startDistance && predicted <= endDistance);
      if (section) live.push({
        ...section, key: `${tripKey}/${section.sliceIndex}`, tripKey,
        secondsSinceDeparture: now - run.departure, distance: predicted, live: true,
        speed: speed ?? busProgressAt(run.trip, run.variant.stops, predicted, 1) - predicted
      });
    }
    return [...live, ...due.filter(({ tripKey }) => !tracked.has(tripKey))];
  }

  return { acceptFeed, tripsAt };
}

export function busRouteDistance(path, legIndex, at) {
  const { start, end, from, to } = path.legs[legIndex];
  return to === from ? start : start + (end - start) * clamp((at - from) / (to - from), 0, 1);
}

export function busTrackingSpeed(currentDistance, run) {
  return clamp(run.speed + (run.distance - currentDistance) / 6, 0, 25);
}
