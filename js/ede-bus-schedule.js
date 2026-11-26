import { DAY, HOUR, dateEpoch, localClock, localMidnight, serviceEpoch, shiftDate, weekday } from './ede-transit-time.js';

function offsetAtDistance(stops, times, distance, leaving) {
  for (let i = 0; i < stops.length; i++) {
    const here = stops[i].distance;
    if (distance === here && (!leaving || stops[i + 1]?.distance !== here)) return times[i][leaving ? 1 : 0];
    if (distance >= here) continue;
    if (i === 0) return times[0][0];
    const before = stops[i - 1].distance;
    const departure = times[i - 1][1], arrival = times[i][0];
    return departure + (arrival - departure) * (distance - before) / (here - before);
  }
  return times.at(-1)[1];
}

function distanceAtOffset(stops, times, offset) {
  for (let i = 0; i < stops.length; i++) {
    const [arrival, departure] = times[i];
    const here = stops[i].distance;
    if (i > 0 && offset < arrival) {
      const before = stops[i - 1].distance, previousDeparture = times[i - 1][1];
      return before + (here - before) * (offset - previousDeparture) / (arrival - previousDeparture);
    }
    if (offset <= departure) return here;
  }
  return stops.at(-1).distance;
}

export async function loadEdeBusSchedule() {
  const response = await fetch(new URL('../assets/ede-bus-routes.json?v=20261126-route-graph', import.meta.url));
  if (!response.ok) throw new Error(`ede-bus-routes.json returned HTTP ${response.status}`);
  return createEdeBusSchedule(await response.json());
}

export function createEdeBusSchedule({ firstDate, lastDate, services, variants, edges, calendars }, now = new Date()) {
  const runs = [], trips = new Map(), serviceDates = new Map();
  const runsByDate = new Map(services.map((date) => [date, []]));
  let maxEnd = 0, maxDuration = 0;
  for (const variant of variants) {
    for (const trip of variant.trips) {
      let preceding;
      const dates = Array.isArray(trip.dates) ? trip.dates : calendars[trip.dates];
      const tripRuns = [];
      if (!serviceDates.has(dates)) serviceDates.set(dates, new Set(dates.map(index => services[index])));
      trips.set(trip.id, { variant, trip, dates: serviceDates.get(dates), runs: tripRuns });
      for (const [sliceIndex, slice] of variant.slices.entries()) {
        const startDistance = slice.start ?? slice.legs[0].start;
        const endDistance = slice.end ?? slice.legs.at(-1).end;
        const startOffset = offsetAtDistance(variant.stops, trip.stops, startDistance, false);
        const endOffset = offsetAtDistance(variant.stops, trip.stops, endDistance, true);
        if (endOffset <= startOffset) continue;
        const run = { variant, trip, slice, sliceIndex, startDistance, endDistance, startOffset, endOffset };
        if (preceding) preceding.next = run;
        preceding = run;
        runs.push(run);
        tripRuns.push(run);
        maxEnd = Math.max(maxEnd, trip.departure + endOffset);
        maxDuration = Math.max(maxDuration, endOffset - startOffset);
        for (const index of dates) runsByDate.get(services[index]).push(run);
      }
    }
  }

  const firstWeekdays = new Map(), lastWeekdays = new Map();
  for (const date of services) {
    const day = weekday(date);
    if (!firstWeekdays.has(day)) firstWeekdays.set(day, date);
    lastWeekdays.set(day, date);
  }
  const lastServiceDay = Math.ceil((maxEnd + HOUR) / DAY);
  let dayStart = Infinity, dayEnd = -Infinity, entries = [];

  function refreshEntries(at) {
    if (dayStart <= at && at < dayEnd) return;
    const { date } = localClock(at);
    dayStart = localMidnight(date);
    dayEnd = localMidnight(shiftDate(date, 1));
    entries = [];
    for (let i = -lastServiceDay; i <= 1; i++) {
      const serviceDate = shiftDate(date, i);
      let datedRuns = runsByDate.get(serviceDate);
      if (serviceDate < firstDate) datedRuns = runsByDate.get(firstWeekdays.get(weekday(serviceDate)));
      if (serviceDate > lastDate) datedRuns = runsByDate.get(lastWeekdays.get(weekday(serviceDate)));
      if (!datedRuns?.length) continue;
      const epoch = serviceEpoch(serviceDate);
      for (const run of datedRuns) {
        const departure = epoch + run.trip.departure;
        const tripKey = `${serviceDate}/${run.variant.id}/${run.trip.id}`;
        entries.push({
          run, departure, start: departure + run.startOffset, end: departure + run.endOffset,
          tripKey, key: `${tripKey}/${run.sliceIndex}`
        });
      }
    }
    entries.sort((a, b) => a.start - b.start);
  }

  function activeEntries(at, grace) {
    refreshEntries(at);
    const earliest = at - maxDuration - grace;
    let left = 0, right = entries.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (entries[middle].start < earliest) left = middle + 1;
      else right = middle;
    }
    const active = [];
    for (let i = left; i < entries.length && entries[i].start <= at + grace; i++) {
      if (entries[i].end >= at - grace) active.push(entries[i]);
    }
    return active;
  }

  let startEpoch = now.getTime() / 1000;
  if (runs.length && !activeEntries(startEpoch, 0).length) {
    // Open on the next service when the player's start time falls in a gap in the timetable.
    const { date } = localClock(startEpoch);
    for (let i = 0; i < 7; i++) {
      refreshEntries(localMidnight(shiftDate(date, i)));
      const next = entries.find(({ start }) => start >= startEpoch);
      if (next) {
        startEpoch = next.start;
        break;
      }
    }
  }

  function tripsAtTime(at, graceSeconds = 0) {
    return activeEntries(at, graceSeconds).map(({ run, departure, key, tripKey }) => {
      const { variant, trip, startDistance, endDistance } = run;
      const secondsSinceDeparture = at - departure;
      const distance = distanceAtOffset(variant.stops, trip.stops, secondsSinceDeparture);
      return { ...run, key, tripKey, secondsSinceDeparture, distance: Math.max(startDistance, Math.min(endDistance, distance)) };
    });
  }

  function tripAtTime(id, serviceDate, observedAt) {
    const entry = trips.get(id);
    if (!entry) return null;
    const { variant, trip, dates } = entry;
    const localDate = localClock(observedAt).date;
    if (!serviceDate) {
      const candidates = [shiftDate(localDate, -1), localDate].filter(date => dates.has(date));
      candidates.sort((a, b) =>
        Math.abs(observedAt - serviceEpoch(a) - trip.departure) -
        Math.abs(observedAt - serviceEpoch(b) - trip.departure));
      serviceDate = candidates[0];
    }
    if (!dates.has(serviceDate) || Math.abs(dateEpoch(serviceDate) - dateEpoch(localDate)) > DAY) return null;
    const departure = serviceEpoch(serviceDate) + trip.departure;
    return { ...entry, tripKey: `${serviceDate}/${variant.id}/${trip.id}`, departure };
  }

  return {
    variants, edges, runs, tripAtTime, tripsAtTime,
    tripsAt: (elapsedSeconds, graceSeconds) => tripsAtTime(startEpoch + elapsedSeconds, graceSeconds)
  };
}

export function busProgressAt(trip, stops, distance, age, speed) {
  if (!age || speed === 0) return distance;
  if (Number.isFinite(speed)) return distance + speed * age;
  const offset = offsetAtDistance(stops, trip.stops, distance, true);
  return Math.min(distance + 22 * age, distanceAtOffset(stops, trip.stops, offset + age));
}
