import { localClock, serviceEpoch, shiftDate, weekday } from './ede-transit-time.js';

const STATION = 'ede-wageningen';
const MAX_SPEED = 55;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const platformNumber = value => String(value ?? '').trim().toLowerCase().match(/^\d+/)?.[0];
export const trainKey = (operator, date, number) => `${operator}/${date}/${number}`;

export async function loadEdeTrainTimetable() {
  const response = await fetch(new URL('../assets/ede-train-timetable.json?v=20261123-municipality-coverage', import.meta.url));
  if (!response.ok) throw new Error(`Rail timetable HTTP ${response.status}`);
  const timetable = await response.json();
  if (timetable.version !== 1 || !Array.isArray(timetable.trips) ||
      !Array.isArray(timetable.dates) || !Array.isArray(timetable.calendars)) throw new Error('Invalid rail timetable');
  return timetable;
}

export function createEdeTrainSchedule({ dates = [], calendars = [], trips = [], stations = {} } = {}) {
  const index = new Map(dates.map((date, i) => [date, i]));
  const weekly = dates.map(weekday);
  const byId = new Map(), byNumber = new Map();
  const byCalendar = calendars.map(() => []);
  const activeCalendars = dates.map(() => []);

  for (let id = 0; id < calendars.length; id++) {
    for (const date of calendars[id]) activeCalendars[date].push(id);
  }
  for (const trip of trips) {
    if (!byCalendar[trip.calendar] || !trip.stops?.length) continue;
    byCalendar[trip.calendar].push(trip);
    for (const id of [trip.tripId, trip.realtimeTripId]) {
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(trip);
    }
    const number = `${trip.operator}/${trip.number}`;
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(trip);
  }

  function calendarDate(date) {
    if (index.has(date)) return index.get(date);
    const day = weekday(date);
    if (date < dates[0]) return weekly.indexOf(day);
    if (date > dates.at(-1)) return weekly.lastIndexOf(day);
    return -1;
  }

  function entry(trip, date, epoch = serviceEpoch(date)) {
    return { trip, date, epoch, key: trainKey(trip.operator, date, trip.number),
      first: epoch + trip.stops[0].arrival, last: epoch + trip.stops.at(-1).departure };
  }

  let cachedDate, dated = [];
  function entries(at) {
    const { date } = localClock(at);
    if (date === cachedDate) return dated;
    dated = [];
    cachedDate = date;
    for (const offset of [-1, 0, 1]) {
      const serviceDate = shiftDate(date, offset);
      const epoch = serviceEpoch(serviceDate);
      for (const calendar of activeCalendars[calendarDate(serviceDate)] ?? []) {
        for (const trip of byCalendar[calendar]) dated.push(entry(trip, serviceDate, epoch));
      }
    }
    return dated;
  }

  function lookup(record, at) {
    const byTrip = byId.get(record.tripId);
    const candidates = byTrip ?? byNumber.get(`${record.operator}/${record.number}`);
    if (!candidates) return null;
    const { date: today } = localClock(at);
    const serviceDates = record.serviceDate ? [record.serviceDate] : [shiftDate(today, -1), today, shiftDate(today, 1)];
    let picked = null, error = Infinity;
    for (const date of serviceDates) {
      const idx = calendarDate(date);
      for (const trip of candidates) {
        if (trip.operator !== record.operator || trip.number !== String(record.number) || !calendars[trip.calendar].includes(idx)) continue;
        const candidate = entry(trip, date);
        const distance = Math.max(0, candidate.first - at, at - candidate.last);
        if (distance < error || (distance === error && candidate.first > picked?.first)) {
          error = distance;
          picked = candidate;
        }
      }
    }
    return error <= 6 * 3600 || record.serviceDate ? picked : null;
  }

  return { entries, lookup, stations };
}

function isTerminal(trip) {
  return trip.route === 'rs34' || trip.stops[0].station === STATION || trip.stops.at(-1).station === STATION;
}

function stopUpdate(stop, update) {
  return update?.stops?.findLast(row => row.sequence != null ? row.sequence === stop.sequence : row.stopId === stop.stopId);
}

export function trainPathFor(paths, trip, update) {
  let best = null, bestScore = -Infinity;
  for (const path of paths) {
    if (path.route !== trip.route || path.direction !== trip.direction || Boolean(path.terminal) !== isTerminal(trip)) continue;
    let score = 0;
    for (const stop of trip.stops) {
      const change = stopUpdate(stop, update);
      const actual = path.stops[stop.station]?.platform;
      if (!actual || change?.skipped) continue;
      if (change?.platform && platformNumber(change.platform) !== platformNumber(actual)) {
        score = -Infinity;
        break;
      }
      if (stop.platform && platformNumber(stop.platform) === platformNumber(actual)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best;
}

function extrapolate(geometry, station, before) {
  if (!station) return null;
  const edge = before ? geometry.start : geometry.end;
  const distance = Math.hypot(station[0] - edge.x, station[1] - edge.z);
  return before ? -distance : geometry.length + distance;
}

// Accelerate and brake at the two scheduled stops with a constant cruising section in between.
function legPosition(from, to, seconds) {
  const duration = to.arrival - from.departure;
  const elapsed = clamp(seconds, 0, duration);
  const ramp = Math.min(duration * 0.24, 12);
  const speed = (to.distance - from.distance) / (duration - ramp);
  if (elapsed < ramp) return { distance: from.distance + speed * elapsed ** 2 / (2 * ramp), speed: speed * elapsed / ramp };
  const remaining = duration - elapsed;
  if (remaining < ramp) return { distance: to.distance - speed * remaining ** 2 / (2 * ramp), speed: speed * remaining / ramp };
  return { distance: from.distance + speed * (elapsed - ramp / 2), speed };
}

export function timetablePosition(plan, at) {
  const { anchors, path } = plan;
  for (let i = 0; i < anchors.length; i++) {
    const here = anchors[i];
    if (i > 0 && at < here.arrival) {
      const previous = anchors[i - 1];
      const movement = legPosition(previous, here, at - previous.departure);
      const leavingPlatform = movement.distance - previous.distance < 60 ? previous.platform : undefined;
      return { ...movement, distance: clamp(movement.distance, 0, path.length),
        limit: clamp(here.distance, 0, path.length), platform: leavingPlatform ?? here.platform };
    }
    if (at <= here.departure) return { distance: clamp(here.distance, 0, path.length), speed: 0,
      limit: clamp(here.distance, 0, path.length), platform: here.platform };
  }
  const last = anchors.at(-1);
  const before = anchors.at(-2);
  // A service may hold on a terminal berth until its next train number departs.
  const stopAtBoundary = plan.terminalArrival || !before ? last.distance : path.length;
  return { distance: clamp(stopAtBoundary, 0, path.length), speed: 0, limit: stopAtBoundary, platform: last.platform };
}

export function planTimeAt(anchors, distance, leaving = false) {
  for (let i = 0; i < anchors.length; i++) {
    const here = anchors[i];
    if (distance === here.distance) return leaving ? here.departure : here.arrival;
    if (distance >= here.distance) continue;
    if (i === 0) return here.arrival;
    const before = anchors[i - 1];
    let low = before.departure, high = here.arrival;
    for (let iteration = 0; iteration < 16; iteration++) {
      const mid = (low + high) / 2;
      if (legPosition(before, here, mid - before.departure).distance < distance) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }
  return anchors.at(-1).departure;
}

export function trainPlan(entry, path, stations, update) {
  if (!path) return null;
  const { trip, epoch } = entry;
  const anchors = [];
  const geometry = { start: path.sample(0), end: path.sample(path.length), length: path.length };
  let delay = update?.delay ?? 0;
  let previous = null;
  for (const stop of trip.stops) {
    const change = stopUpdate(stop, update);
    if (change?.skipped) continue;
    const berth = path.stops[stop.station];
    const platform = change?.platform || stop.platform;
    const section = berth?.sections?.[platform];
    const point = stations[stop.station];
    const before = point && Math.hypot(point[0] - geometry.start.x, point[1] - geometry.start.z) <=
      Math.hypot(point[0] - geometry.end.x, point[1] - geometry.end.z);
    const distance = section ?? berth?.distance ?? extrapolate(geometry, point, before);
    if (!Number.isFinite(distance) || (previous && distance <= previous.distance)) continue;
    const scheduledArrival = epoch + stop.arrival;
    const scheduledDeparture = epoch + stop.departure;
    const actualArrival = change?.arrival ?? scheduledArrival + (change?.arrivalDelay ?? delay);
    const actualDeparture = change?.departure ?? scheduledDeparture + (change?.departureDelay ?? actualArrival - scheduledArrival);
    delay = actualDeparture - scheduledDeparture;
    const arrival = previous ? Math.max(actualArrival, previous.departure + Math.max(1, (distance - previous.distance) / MAX_SPEED)) : actualArrival;
    const roundedDwell = stop.station === 'ede-centrum' && !change?.departure && actualDeparture === actualArrival ? 20 : 0;
    const departure = Math.max(arrival + roundedDwell, actualDeparture);
    previous = { station: stop.station, arrival, departure, distance, platform: section == null ? berth?.platform : platform };
    anchors.push(previous);
  }
  if (anchors.length < 2) return null;
  const initial = anchors[0], last = anchors.at(-1);
  const terminalDeparture = path.terminal === initial.station;
  const terminalArrival = path.terminal === last.station;
  const start = terminalDeparture ? initial.arrival : planTimeAt(anchors, 0);
  const end = terminalArrival ? last.departure + 45 : planTimeAt(anchors, path.length, true);
  if (end <= start || last.distance < 0 || initial.distance > path.length) return null;
  return { ...entry, path, anchors, start, end, terminalArrival, terminalDeparture };
}

export function connectTrainTurnarounds(plans) {
  const terminal = plans.filter(plan => plan.terminalArrival || plan.terminalDeparture);
  const used = new Set();
  for (const outgoing of terminal.filter(plan => plan.terminalDeparture).sort((a, b) => a.start - b.start)) {
    const leave = outgoing.anchors[0];
    let incoming;
    for (const plan of terminal) {
      if (used.has(plan.key) || !plan.terminalArrival || plan.trip.operator !== outgoing.trip.operator ||
          plan.path.direction === outgoing.path.direction || plan.path.terminal !== outgoing.path.terminal) continue;
      const arrive = plan.anchors.at(-1);
      const arriveTrack = platformNumber(arrive.platform), leaveTrack = platformNumber(leave.platform);
      const differentSections = arrive.platform !== leave.platform && arrive.platform !== arriveTrack && leave.platform !== leaveTrack;
      if (arriveTrack !== leaveTrack || differentSections || arrive.departure > leave.departure ||
          leave.departure - arrive.departure > 25 * 60) continue;
      if (!incoming || arrive.departure > incoming.anchors.at(-1).departure) incoming = plan;
    }
    if (!incoming) continue;
    used.add(incoming.key);
    outgoing.turnFrom = incoming.key;
    const arrive = incoming.anchors.at(-1);
    const incomingSection = outgoing.path.stops[leave.station]?.sections?.[arrive.platform];
    const outgoingSection = incoming.path.stops[arrive.station]?.sections?.[leave.platform];
    if (incomingSection != null && arrive.platform !== leave.platform) {
      outgoing.anchors = [{ ...leave, platform: arrive.platform, distance: incomingSection }, ...outgoing.anchors.slice(1)];
    } else if (outgoingSection != null && arrive.platform !== leave.platform) {
      incoming.anchors = [...incoming.anchors.slice(0, -1), { ...arrive, platform: leave.platform, distance: outgoingSection }];
    }
    const handoff = Math.max(arrive.departure, outgoing.start);
    incoming.end = handoff;
    outgoing.start = handoff;
  }
}

// Allocate a shared section from the leading cab’s entry through rear clearance.
export function reserveTrainBlocks(plans, halfLength) {
  const waiting = plans.filter(plan => plan.path.blocks?.length).map(plan => ({ plan, next: 0 }));
  const releases = new Map();
  const entryTime = (plan, block) => planTimeAt(plan.anchors, block.from - halfLength);
  while (waiting.length) {
    waiting.sort((a, b) => entryTime(a.plan, a.plan.path.blocks[a.next]) -
      entryTime(b.plan, b.plan.path.blocks[b.next]) || a.plan.key.localeCompare(b.plan.key));
    const job = waiting.shift();
    const { plan } = job;
    const block = plan.path.blocks[job.next++];
    const ready = entryTime(plan, block);
    const release = releases.get(block.id) ?? -Infinity;
    if (ready < release) {
      // The preceding public stop is the safe hold point. For southbound
      // trains entering the map this may be Barneveld Zuid, beyond the map.
      const hold = plan.anchors.findLastIndex(anchor => anchor.distance <= block.from - halfLength);
      const delay = release - ready;
      plan.anchors = plan.anchors.map((anchor, i) => i < hold ? anchor : {
        ...anchor,
        arrival: i === hold ? anchor.arrival : anchor.arrival + delay,
        departure: anchor.departure + delay,
      });
      if (!plan.terminalDeparture) plan.start = planTimeAt(plan.anchors, 0);
      plan.end += delay;
    }
    releases.set(block.id, planTimeAt(plan.anchors, block.to + halfLength, true) + 4);
    if (job.next < plan.path.blocks.length) waiting.push(job);
  }
}
