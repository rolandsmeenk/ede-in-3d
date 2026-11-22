import { localClock } from './ede-transit-time.js';
import {
  connectTrainTurnarounds, createEdeTrainSchedule, planTimeAt, reserveTrainBlocks, timetablePosition, trainKey, trainPathFor, trainPlan
} from './ede-train-schedule.js';

export const TRAIN_STATUS = Object.freeze({ gps: 'GPS', live: 'estimated from live updates', timetable: 'timetable' });
const MAX_SPEED = 52, BRAKING = 0.85, ACCELERATION = 0.48;
const UPDATE_AGE = 180, MAX_DELAY = 6 * 3600, KEEP_FOR = 36 * 3600;
const PREDICTION_STEP = 0.5;
const CAR_GAP = 0.3;
export const TRAIN_CONSISTS = {
  intercity: { length: 23.7, cars: 4 }, sprinter: { length: 17.7, cars: 4 },
  international: { length: 24.5, cars: 5 }, nightjet: { length: 24.5, cars: 4 },
  rs34: { length: 19.1, cars: 3 }
};
export function trainModel(trip) {
  if (trip.operator === 'RRReis') return 'rs34';
  if (/sprinter/i.test(trip.serviceType)) return 'sprinter';
  if (/nightjet/i.test(trip.serviceType)) return 'nightjet';
  if (/ice/i.test(trip.serviceType)) return 'international';
  return 'intercity';
}

export function trainCarOffset(model, i) {
  return ((model.cars - 1) / 2 - i) * (model.length + CAR_GAP);
}

const rs34HalfLength = trainCarOffset(TRAIN_CONSISTS.rs34, 0) + TRAIN_CONSISTS.rs34.length / 2;
const occupiesBlock = (block, distance) => distance + rs34HalfLength >= block.from && distance - rs34HalfLength <= block.to;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const validNumber = value => typeof value === 'string' && /^\d{1,8}$/.test(value);

function validTime(timestamp, now, age) {
  return Number.isFinite(timestamp) && timestamp <= now + 15 && timestamp >= now - age;
}

function preparePrediction(fix, previous, plan, seconds) {
  const observedSpeed = fix.speed;
  const dt = previous ? fix.timestamp - previous.timestamp : 0;
  const recent = dt > 0 && dt <= 90 && previous.path === fix.path;
  const measured = recent ? (fix.distance - previous.distance) / dt : Infinity;
  const planSpeed = plan ? timetablePosition(plan, fix.timestamp).speed : 0;
  const speed = clamp(Number.isFinite(observedSpeed) ? observedSpeed : measured >= 0 && measured <= MAX_SPEED ?
    measured : planSpeed, 0, MAX_SPEED);
  const acceleration = recent ? clamp((speed - previous.speed) / dt, -BRAKING, ACCELERATION) : 0;
  const nextStop = plan?.anchors.find(a => a.distance >= fix.distance && a.distance <= fix.path.length);
  const limit = nextStop?.distance ?? fix.path.length;

  let v = speed, distance = fix.distance;
  const samples = [{ distance, speed }];
  for (let step = 0; step < Math.ceil(seconds / PREDICTION_STEP); step++) {
    const remaining = Math.max(0, limit - distance);
    const brakingSpeed = nextStop ? Math.sqrt(2 * BRAKING * remaining) : MAX_SPEED;
    const wanted = Math.min(brakingSpeed, MAX_SPEED, Math.max(0, v + acceleration * PREDICTION_STEP));
    const next = clamp(wanted, v - BRAKING * PREDICTION_STEP, v + ACCELERATION * PREDICTION_STEP);
    distance += Math.min(remaining, (v + next) * 0.5 * PREDICTION_STEP);
    v = distance >= limit ? 0 : next;
    samples.push({ distance, speed: v });
  }
  const expiry = fix.timestamp + seconds;
  let offset = null;
  if (plan) {
    const last = samples.at(-1).distance;
    const expected = timetableTimeAtPosition(plan, last, expiry);
    if (Math.abs(expiry - expected) <= MAX_DELAY) offset = expiry - expected;
  }
  return { ...fix, speed, limit, expiry, nextStop, samples, offset };
}

function timetableTimeAtPosition(plan, distance, reference) {
  const stopped = plan.anchors.find(anchor => Math.abs(anchor.distance - distance) < 0.05);
  return stopped ? clamp(reference, stopped.arrival, stopped.departure) : planTimeAt(plan.anchors, distance);
}

function fallbackFromUpdate(entry, path, stations, update) {
  const berths = update?.stops?.filter(row => row.platform).map(({ sequence, stopId, platform }) =>
    ({ sequence, stopId, platform }));
  const base = trainPlan(entry, path, stations, berths?.length ? { stops: berths } : undefined);
  if (!update || !base) return base;
  const lastLivePlan = trainPlan(entry, path, stations, update);
  const at = update.timestamp + UPDATE_AGE;
  if (!lastLivePlan || at < lastLivePlan.start || at > lastLivePlan.end) return base;
  const { distance } = timetablePosition(lastLivePlan, at);
  const offset = at - timetableTimeAtPosition(base, distance, at);
  if (Math.abs(offset) > MAX_DELAY) return base;
  return { ...base, start: base.start + offset, end: base.end + offset, anchors:
    base.anchors.map(anchor => ({ ...anchor, arrival: anchor.arrival + offset, departure: anchor.departure + offset })) };
}

function gpsPosition(fix, at) {
  const step = clamp((at - fix.timestamp) / PREDICTION_STEP, 0, fix.samples.length - 1);
  const a = fix.samples[Math.floor(step)], b = fix.samples[Math.ceil(step)];
  const t = step % 1;
  return {
    distance: a.distance + (b.distance - a.distance) * t,
    speed: a.speed + (b.speed - a.speed) * t,
    limit: fix.limit, platform: fix.nextStop?.platform
  };
}

function validUpdate(row) {
  return row.operator === 'RRReis' && validNumber(row.number) && Array.isArray(row.stops) &&
    row.stops.length <= 100 && row.stops.every(stop => stop && typeof stop === 'object' &&
      ['arrival','departure','arrivalDelay','departureDelay'].every(key =>
        stop[key] == null || Number.isFinite(stop[key]))) && (row.delay == null || Number.isFinite(row.delay));
}

export function createEdeTrainTraffic(timetable, tracks, { predictionSeconds = 32 } = {}) {
  predictionSeconds = Number.isFinite(predictionSeconds) ? clamp(predictionSeconds, 5, 90) : 32;
  const schedule = createEdeTrainSchedule(timetable);
  const fixes = new Map(), updates = new Map(), lastFixByNumber = new Map(), preparedPlans = new Map();
  const progress = new Map();
  const { paths } = tracks;
  let plans = [], preparedAt = -Infinity, advancedAt = -Infinity;

  function acceptSnapshot(snapshot, now = Date.now() / 1000) {
    if (snapshot?.version !== 1) return;
    for (const row of Array.isArray(snapshot.updates) ? snapshot.updates : []) {
      if (!row || !validUpdate(row) || !validTime(row.timestamp, now, row.cancelled ? KEEP_FOR : UPDATE_AGE) ||
          (row.serviceDate && !validDate(row.serviceDate))) continue;
      const entry = schedule.lookup(row, row.timestamp);
      if (!entry || (updates.get(entry.key)?.timestamp ?? -Infinity) >= row.timestamp) continue;
      updates.set(entry.key, { ...row, entry });
    }
    for (const row of Array.isArray(snapshot.gps) ? snapshot.gps : []) {
      if (row?.operator !== 'NS' || !validNumber(row.number) || !validTime(row.timestamp, now, predictionSeconds + 20) ||
          !Number.isFinite(row.x) || !Number.isFinite(row.z) || (row.serviceDate && !validDate(row.serviceDate))) continue;
      const entry = schedule.lookup(row, row.timestamp);
      const prior = lastFixByNumber.get(row.number);
      const date = entry?.date ?? row.serviceDate ??
        (prior && row.timestamp - prior.timestamp <= 180 ? prior.date : localClock(row.timestamp).date);
      const key = trainKey(row.operator, date, row.number);
      const previous = fixes.get(key);
      if ((previous?.timestamp ?? -Infinity) >= row.timestamp) continue;
      const bestPath = entry && trainPathFor(paths, entry.trip);
      if (!bestPath && !previous && (!Number.isFinite(row.bearing) || row.speed < 2)) continue;
      const match = tracks.match(row, { route: 'main', direction: bestPath?.direction ?? previous?.path.direction,
        platform: row.platform, terminal: bestPath ? Boolean(bestPath.terminal) : undefined,
        preferredPath: bestPath, previous });
      if (!match) continue;
      const compatible = bestPath && Boolean(bestPath.terminal) === Boolean(match.path.terminal);
      const plan = compatible ? trainPlan(entry, match.path, schedule.stations) : null;
      const fix = preparePrediction({ ...match, key, date, number: row.number, operator: row.operator, timestamp: row.timestamp,
        speed: Number.isFinite(row.speed) && row.speed >= 0 ? row.speed : undefined, entry, plan }, previous, plan, predictionSeconds);
      fixes.set(key, fix);
      lastFixByNumber.set(row.number, fix);
    }
    prepare(now);
  }

  function prepare(at) {
    preparedAt = at;
    const candidates = new Map();
    for (const entry of schedule.entries(at)) {
      if (at >= entry.first - 25 * 60 && at <= entry.last + 25 * 60) candidates.set(entry.key, entry);
    }

    for (const [key, update] of updates) {
      if (!validTime(update.timestamp, at, KEEP_FOR) || at > update.entry.last + MAX_DELAY) updates.delete(key);
      else candidates.set(key, update.entry);
    }

    for (const [key, fix] of fixes) {
      if (fix.timestamp > at + 15 || at > (fix.plan ? Math.max(fix.plan.end + (fix.offset ?? 0), fix.expiry) : fix.expiry) + 2) {
        fixes.delete(key);
        if (lastFixByNumber.get(fix.number) === fix) lastFixByNumber.delete(fix.number);
      }
    }

    for (const [key, cached] of preparedPlans) {
      if (!candidates.has(key) && at > cached.entry.last + MAX_DELAY) preparedPlans.delete(key);
    }

    const due = [];
    for (const [key, entry] of candidates) {
      if (fixes.has(key)) continue;
      const update = updates.get(key);
      if (update?.cancelled) continue;
      const live = validTime(update?.timestamp, at, UPDATE_AGE);
      let cached = preparedPlans.get(key);
      if (cached?.entry.trip !== entry.trip || cached.update !== update || cached.live !== live) {
        const path = trainPathFor(paths, entry.trip, update);
        const plan = live ? trainPlan(entry, path, schedule.stations, update) :
          fallbackFromUpdate(entry, path, schedule.stations, update);
        cached = { entry, update, live, plan };
        preparedPlans.set(key, cached);
      }
      const { plan } = cached;
      if (plan && at >= plan.start - 25 * 60 && at <= plan.end + 25 * 60) {
        due.push({ ...plan, status: live ? TRAIN_STATUS.live : TRAIN_STATUS.timetable, updateAt: update?.timestamp });
      }
    }
    reserveTrainBlocks(due, rs34HalfLength);
    connectTrainTurnarounds(due);
    for (const fix of fixes.values()) {
      if (at < fix.expiry) {
        due.push({ key: fix.key, path: fix.path, trip: fix.entry?.trip ?? { operator: fix.operator, number: fix.number },
          start: fix.timestamp - 15, end: fix.expiry, status: TRAIN_STATUS.gps, updateAt: fix.timestamp, fix });
      } else if (fix.plan && fix.offset !== null) {
        due.push({ ...fix.plan, start: fix.expiry, end: fix.plan.end + fix.offset,
          offset: fix.offset, status: TRAIN_STATUS.timetable, updateAt: fix.timestamp });
      }
    }
    plans = due;
  }

  function position(plan, at) {
    if (at < plan.start || at >= plan.end) return null;
    return plan.fix ? gpsPosition(plan.fix, at) : timetablePosition(plan, at - (plan.offset ?? 0));
  }

  function advance(dt, at) {
    if (at < preparedAt || at - preparedAt >= 0.75 || plans.some(plan => plan.fix?.expiry <= at)) prepare(at);
    const reset = at < advancedAt || at - advancedAt > 2;
    advancedAt = at;
    if (reset) progress.clear();
    const seen = new Set();
    // A real-time update can change a reservation while a consist is still on
    // the section. Its actual position keeps the opposing entrance protected.
    const occupied = new Map();
    for (const [key, train] of progress) {
      for (const block of train.plan.path.blocks ?? []) {
        if (occupiesBlock(block, train.distance)) occupied.set(block.id, key);
      }
    }
    for (let plan of plans) {
      let target = position(plan, at);
      if (!target) continue;
      let train = progress.get(plan.key) ?? progress.get(plan.turnFrom);
      if (!train) {
        train = { distance: target.distance, speed: target.speed };
      } else if (train.plan.path !== plan.path) {
        const previous = train.plan.path.sample(train.distance);
        const transfer = plan.path.project(previous.x, previous.z);
        const previousTarget = transfer.error > 1.25 && position(train.plan, at);
        if (previousTarget) {
          plan = train.plan;
          target = previousTarget;
        } else {
          train.distance = transfer.error <= 1.25 ? transfer.distance : target.distance;
          if (train.plan.path.direction !== plan.path.direction) train.speed = 0;
        }
      }
      if (train.plan?.key !== plan.key) progress.delete(train.plan?.key);
      train.plan = plan;
      train.target = target;
      const blocks = plan.path.blocks ?? [];
      const blocked = blocks.find(block => train.distance - rs34HalfLength <= block.to &&
        occupied.has(block.id) && occupied.get(block.id) !== plan.key);
      train.blockLimit = blocked ? blocked.from - rs34HalfLength - 1 : Infinity;
      if (train.distance > train.blockLimit && !progress.has(plan.key)) {
        // The plan may begin on the far side of the map. Wait off-map if a
        // delayed train still owns the entrance.
        if (train.blockLimit < 0) continue;
        train.distance = train.blockLimit;
        train.speed = 0;
      }
      const wanted = clamp(target.speed + (target.distance - train.distance) / 2.5, 0,
        Math.min(MAX_SPEED, Math.sqrt(2 * BRAKING * Math.max(0, train.blockLimit - train.distance))));
      train.speed = clamp(wanted, Math.max(0, train.speed - dt), train.speed + 0.58 * dt);
      const limit = Math.min(target.limit, train.blockLimit);
      if (train.distance < limit) train.distance = Math.min(limit, train.distance + train.speed * dt);
      if (train.distance >= train.blockLimit) train.speed = 0;
      for (const block of blocks) {
        if (occupiesBlock(block, train.distance)) occupied.set(block.id, plan.key);
      }
      progress.set(plan.key, train);
      seen.add(plan.key);
    }
    for (const key of progress.keys()) if (!seen.has(key)) progress.delete(key);
  }

  function forecast(train, at, seconds) {
    const end = Math.min(at + seconds, train.plan.end - 0.01);
    const target = position(train.plan, end);
    if (!target) return train.distance;
    // Carry the current smoothing offset into the prediction so it follows the rendered train.
    const predicted = target.distance + (at + seconds - end) * target.speed;
    return Math.max(train.distance, Math.min(target.limit, train.blockLimit ?? Infinity,
      predicted + train.distance - train.target.distance));
  }

  function* upcoming(at, seconds) {
    for (const plan of plans) {
      if (plan.fix || plan.start <= at || plan.start > at + seconds || progress.has(plan.key)) continue;
      const target = position(plan, plan.start);
      if (target) yield { plan, distance: target.distance, target };
    }
  }

  return { acceptSnapshot, prepare, position, advance, forecast, upcoming, progress, get plans() { return plans; } };
}

export function watchEdeTrains(traffic) {
  const url = new URL('../api/ede-trains', import.meta.url);
  let pending = false, next = 0, unavailable = false;
  async function poll() {
    const now = Date.now();
    if (document.hidden || pending || now < next || unavailable) return;
    pending = true;
    next = now + 10000;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (response.status === 404) unavailable = true;
      else if (response.ok) traffic.acceptSnapshot(await response.json());
    } catch { /* Each fix and trip update expires independently. */ }
    finally { pending = false; }
  }
  setInterval(poll, 1000);
  document.addEventListener('visibilitychange', poll);
  void poll();
}
