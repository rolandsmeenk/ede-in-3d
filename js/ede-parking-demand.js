import { HOUR, localClock, weekday } from './ede-transit-time.js';

const MINUTE = 60_000;
const CELL = 96;
const READING_LIFETIME = 3 * MINUTE;
const READING_TRANSITION = 15 * MINUTE;
const RESERVATION_LIFETIME = 5 * MINUTE;
const DEPARTURE_GRACE = 15 * MINUTE;

const DWELL_MINUTES = {
  residential: [180, 690], shopping: [22, 105], station: [330, 660], other: [55, 240]
};

const PROFILE = {
  residential: [[0,.78], [6,.76], [9,.43], [16,.47], [20,.71], [23,.78]],
  shopping: [[0,.26], [5,.09], [8,.28], [11,.68], [15,.74], [18,.59], [22,.32]],
  station: [[0,.1], [5,.07], [7,.42], [9,.77], [14,.79], [17,.65], [19,.34], [22,.14]],
  other: [[0,.30], [6,.28], [10,.51], [15,.55], [19,.44], [23,.33]],
  parkweg: [[0,.69], [6,.67], [9,.48], [16,.49], [20.5,.6525], [23.5,.645]],
  parkwegSaturday: [[0,.69], [6,.67], [9.5,.688], [10.5,.697], [13.5,.688], [14.5,.671], [15.5,.652], [21,.72]],
  kuiperplein: [[0,.76], [5,.3], [8,.67], [9.5,.925], [13.5,.925], [18.5,.925], [23.5,.925]],
  kuiperpleinFriday: [[0,.76], [5,.3], [8,.66], [11,.88], [15.5,.925], [17.5,.99], [20.5,.925], [23.5,.775]],
  kuiperpleinSaturday: [[0,.76], [5,.3], [8,.67], [10.5,.925], [12.5,.925], [14.5,.925], [16.5,.775], [21,.78]]
};

function fraction(points, hour) {
  let [previousHour, previousValue] = points[0];
  for (let index = 1; index <= points.length; index++) {
    const [nextHour, nextValue] = points[index] ?? [24, points[0][1]];
    if (hour < nextHour) {
      return previousValue + (nextValue - previousValue) * (hour - previousHour) / (nextHour - previousHour);
    }
    previousHour = nextHour;
    previousValue = nextValue;
  }
  return previousValue;
}

function hash(text) {
  let result = 2166136261;
  for (let index = 0; index < text.length; index++) {
    result = Math.imul(result ^ text.charCodeAt(index), 16777619);
  }
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  return (result ^ (result >>> 15)) >>> 0;
}

export function parkingAppearanceSeed(spaceId) {
  return hash(String(spaceId) + '/appearance');
}

function cityTime(now) {
  const clock = localClock(now / 1000);
  return { date: clock.date, day: weekday(clock.date), hour: clock.seconds / HOUR };
}

function profileForDay(area, time) {
  const name = area.name?.trim().toLowerCase();
  const isKuiperplein = area.profile === 'kuiperplein' || name === 'kuiperplein';
  const isParkweg = area.profile === 'parkweg' || area.id === 'street-parkweg' ||
    (area.kind === 'residential' && name === 'parkweg');
  const weekend = time.day === 0 || time.day === 6;
  if (isKuiperplein && time.day !== 0) {
    const key = time.day === 6 ? 'kuiperpleinSaturday' : time.day === 5 ? 'kuiperpleinFriday' : 'kuiperplein';
    return { fraction: fraction(PROFILE[key], time.hour), source: 'survey', survey: 'ede-centre-2024' };
  }
  if (isParkweg && time.day !== 0) {
    const key = time.day === 6 ? 'parkwegSaturday' : 'parkweg';
    return { fraction: fraction(PROFILE[key], time.hour), source: 'survey', survey: 'parkweg-2020' };
  }
  let value = fraction(PROFILE[area.kind] ?? PROFILE.other, time.hour);
  if (area.kind === 'station' && weekend) value *= .43;
  if (area.kind === 'residential' && weekend) value += .07;
  if (area.kind === 'shopping' && time.day === 6) value += .08;
  if (area.kind === 'shopping' && time.day === 0) value *= .68;
  return { fraction: value, source: 'inferred', survey: null };
}

function zoneProfile(area, time) {
  const profile = profileForDay(area, time);
  if (time.hour >= 2) return profile;
  const previous = profileForDay(area, {day: (time.day + 6) % 7, hour: 0});
  profile.fraction += (previous.fraction - profile.fraction) * (1 - time.hour / 2);
  return profile;
}

function isClosed(area, time) {
  const rules = area.facility?.rules ?? area.rules;
  if (!rules) return false;
  if (rules.closed === true) return true;
  return Boolean(rules.closedFrom && rules.closedThrough &&
    time.date >= rules.closedFrom && time.date <= rules.closedThrough);
}

function permitsParking(space) {
  return ['public', 'paid', 'permit'].includes(space.access ?? 'public');
}

function permitsArrival(space) {
  const hours = space.rules?.opening_hours;
  return ['public', 'paid'].includes(space.access ?? 'public') && !space.rules?.['access:conditional'] &&
    (!hours || hours === '24/7');
}

function maximumStay(value) {
  const text = String(value ?? '').trim();
  const duration = /^(\d+(?:\.\d+)?)\s*(h|hours?|m|min|minutes?)?$/i.exec(text);
  if (duration) return Number(duration[1]) * (duration[2]?.toLowerCase().startsWith('h') ? 60 : 1);
  const clock = /^(\d+):([0-5]\d)$/.exec(text);
  return clock ? Number(clock[1]) * 60 + Number(clock[2]) : Infinity;
}

function dwellMinutes(slot) {
  const [minimum, maximum] = DWELL_MINUTES[slot.area.kind] ?? DWELL_MINUTES.other;
  const limit = slot.maximumStay;
  return [Math.min(minimum, limit), Math.min(maximum, limit)];
}

function tripWeight(kind, {day, hour}, departing) {
  const open = hour >= 7 && hour < 23;
  switch (kind) {
    case 'station':
      if (day === 0 || day === 6) return open ? .22 : .04;
      if (departing) return hour >= 15 && hour < 20 ? 1 : .13;
      return hour >= 6 && hour < 10 ? 1 : .14;
    case 'residential':
      if (departing) return hour >= 7 && hour < 11 ? 1 : .12;
      return hour >= 16 && hour < 22 ? 1 : .19;
    case 'shopping': return hour >= 9 && hour < 21 ? 1 : .10;
    default: return open ? .55 : .12;
  }
}

function addToCell(cells, item) {
  const key = Math.floor(item.space.x / CELL) + '/' + Math.floor(item.space.z / CELL);
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(item);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function position(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.z);
}

function limitCandidates(candidates, limit) {
  candidates.sort((a, b) => b.priority - a.priority || a.space.id.localeCompare(b.space.id));
  const result = [];
  const counts = new Map();
  for (const candidate of candidates) {
    if (result.length >= limit) break;
    const id = candidate.area.id;
    const count = counts.get(id) ?? 0;
    if (count === 4) continue;
    result.push(candidate);
    counts.set(id, count + 1);
  }
  return result;
}

export class ParkingDemand {
  constructor({spaces = [], areas = [], facilities = [], facilityReadings = []} = {}) {
    this.facilities = new Map(facilities.map(facility => [facility.id, facility]));
    this.zones = new Map(areas.map(area => [area.id, {...area, slots: []}]));
    this.slots = new Map();
    this.cells = new Map();
    this.readings = new Map();
    this.overrides = new Map();
    this.pending = new Map();
    for (const facility of facilities) {
      const areaId = facility.areaId ?? facility.id;
      const zone = this.zones.get(areaId);
      this.zones.set(areaId, {...zone, ...facility, id: areaId, facility, slots: []});
    }
    for (const space of spaces) {
      if (!position(space) || typeof space.id !== 'string' || this.slots.has(space.id)) continue;
      const facility = this.facilities.get(space.facilityId);
      const areaId = facility ? facility.areaId ?? facility.id : space.areaId ?? space.wayId ?? space.id;
      if (!this.zones.has(areaId)) this.zones.set(areaId, {id: areaId, kind: 'other', slots: []});
      const area = this.zones.get(areaId);
      if (!area.facility?.garage) {
        const facilityAccess = area.facility?.access;
        const access = facilityAccess === 'private' || facilityAccess === 'permit' ? facilityAccess : space.access ?? facilityAccess;
        this.addSpace(access === space.access ? space : {...space, access}, area);
      }
    }
    for (const area of this.zones.values()) {
      if (area.id === 'street-parkweg') area.kind = 'residential';
      const facility = area.facility;
      if (facility?.garage && positiveInteger(facility.capacity)) {
        const entrance = position(facility.entrance) ? facility.entrance : facility;
        if (position(entrance)) {
          for (let index = 0; index < facility.capacity; index++) {
            this.addSpace({
              id: facility.id + '/garage/' + index,
              x: entrance.x, y: entrance.y ?? 0, z: entrance.z,
              heading: entrance.heading ?? 0, layer: entrance.layer ?? 0,
              areaId: area.id, access: facility.access, facility, virtual: true
            }, area);
          }
        }
      }
      const {slots, ...metadata} = area;
      area.metadata = metadata;
      const eligible = slots.filter(slot => slot.maximumStay > 0 && permitsParking(slot.space));
      eligible.sort((a, b) => a.seed - b.seed || a.space.id.localeCompare(b.space.id));
      eligible.forEach((slot, rank) => { slot.rank = rank; });
      area.eligibleCount = eligible.length;
    }
    this.lastSnapshot = {
      spaces: [], areas: [], arrivals: [], departures: [],
      counts: {spaces: 0, occupied: 0, reserved: 0, departing: 0, virtual: 0}
    };
    this.setFacilityReadings(facilityReadings);
  }

  addSpace(space, area) {
    const maximum = maximumStay(space.rules?.maxstay);
    const slot = {space, area, seed: hash(space.id), appearanceSeed: parkingAppearanceSeed(space.id),
      maximumStay: maximum};
    area.slots.push(slot);
    this.slots.set(space.id, slot);
    addToCell(this.cells, slot);
  }

  setFacilityReadings(readings) {
    for (const reading of readings ?? []) {
      const facility = this.facilities.get(reading?.facilityId);
      const capacity = reading?.capacity ?? facility?.capacity;
      if (!facility || !positiveInteger(capacity) || !Number.isSafeInteger(reading.occupied) ||
          reading.occupied < 0 || reading.occupied > capacity || !Number.isFinite(reading.observedAt)) continue;
      const expiresAt = Math.min(reading.expiresAt ?? Infinity, reading.observedAt + READING_LIFETIME);
      if (!(expiresAt > reading.observedAt)) continue;
      const previous = this.readings.get(facility.id);
      if (!previous || reading.observedAt > previous.observedAt) {
        this.readings.set(facility.id, {...reading, expiresAt, capacity});
      }
    }
  }

  context(now) {
    return {now, time: cityTime(now), profiles: new Map()};
  }

  profile(area, context) {
    if (context.profiles.has(area)) return context.profiles.get(area);
    let profile = zoneProfile(area, context.time);
    const rules = area.facility?.rules ?? area.rules;
    if (rules?.open24h) profile.open = true;
    const reading = this.readings.get(area.facility?.id);
    if (isClosed(area, context.time)) {
      profile = {fraction: 0, source: 'closed', survey: null, open: false};
    } else if (reading && context.now >= reading.observedAt) {
      const exact = reading.occupied / reading.capacity;
      if (context.now < reading.expiresAt) {
        profile = {fraction: reading.open === false ? 0 : exact, source: 'observed', survey: null, reading, open: reading.open ?? profile.open};
      } else {
        const remaining = Math.max(0, 1 - (context.now - reading.expiresAt) / READING_TRANSITION);
        profile.fraction += ((reading.open === false ? 0 : exact) - profile.fraction) * remaining;
      }
    }
    profile.target = Math.round(profile.fraction * area.eligibleCount);
    context.profiles.set(area, profile);
    return profile;
  }

  spaceState(slot, context) {
    const {space, area} = slot;
    const profile = this.profile(area, context);
    const tx = this.pending.get(space.id);
    const txActive = tx && tx.expiresAt > context.now;
    let occupant = null;
    let status = 'vacant';
    if (profile.open === false || slot.rank == null) {
      status = 'unavailable';
    } else if (txActive) {
      status = tx.kind === 'arrival' ? 'reserved' : 'departing';
    } else {
      const overlay = this.overrides.get(space.id);
      if (overlay && overlay.until > context.now) occupant = overlay.occupant;
      else if (slot.rank < profile.target) {
        const [minimum, maximum] = dwellMinutes(slot);
        const dwell = (minimum + (maximum - minimum) * (slot.seed % 997) / 997) * MINUTE;
        const offset = slot.seed % dwell;
        const last = Math.floor((context.now - offset) / dwell) * dwell + offset;
        const departAt = context.now - last < 7 * MINUTE ? last : last + dwell;
        occupant = this.occupant(slot, departAt - dwell, departAt, slot.appearanceSeed);
      }
      if (occupant) status = 'occupied';
    }
    return {space, area: area.metadata, status, occupant, source: profile.reading ? 'inferred' : profile.source};
  }

  occupant(slot, arrivedAt, departAt, appearanceSeed) {
    return {id: slot.space.id, appearanceSeed, arrivedAt, departAt};
  }

  getSpaceState(spaceId, now = Date.now()) {
    const slot = this.slots.get(spaceId);
    return slot ? this.spaceState(slot, this.context(now)) : null;
  }

  refresh({x, z, radius, now = Date.now(), limit = 12, canManeuver}) {
    const context = this.context(now);
    const states = [];
    const arrivals = [];
    const departures = [];
    const areas = new Map();
    const counts = {spaces: 0, occupied: 0, reserved: 0, departing: 0, virtual: 0};
    for (const [id, tx] of this.pending) {
      if (tx.expiresAt <= now) this.pending.delete(id);
    }
    for (const [id, overlay] of this.overrides) {
      if (overlay.until <= now) this.overrides.delete(id);
    }

    const distanceLimit = radius * radius;
    for (let cellX = Math.floor((x - radius) / CELL); cellX <= Math.floor((x + radius) / CELL); cellX++) {
      for (let cellZ = Math.floor((z - radius) / CELL); cellZ <= Math.floor((z + radius) / CELL); cellZ++) {
        const nearby = this.cells.get(cellX + '/' + cellZ) ?? [];
        for (const slot of nearby) {
          const {space, area} = slot;
          const dx = space.x - x, dz = space.z - z;
          const distance = dx * dx + dz * dz;
          if (distance > distanceLimit) continue;
          const state = this.spaceState(slot, context);
          const profile = this.profile(area, context);
          if (!areas.has(area.id)) {
            const reading = profile.reading;
            areas.set(area.id, {
              ...state.area, source: profile.source, survey: profile.survey,
              capacity: area.facility?.capacity ?? area.reportedCapacity ?? area.capacity ??
                (positiveInteger(area.estimatedCapacity) ? area.estimatedCapacity : area.eligibleCount),
              capacitySource: area.reportedCapacity || (area.capacity && area.estimatedCapacity !== true) ? 'published' : 'estimated',
              mappedSpaces: area.facility?.garage ? 0 : area.eligibleCount,
              virtualSpaces: area.facility?.garage ? area.eligibleCount : 0,
              targetFraction: profile.fraction, open: profile.open ?? null,
              localSpaces: 0, localOccupied: 0, localReserved: 0, localDeparting: 0,
              reading: reading ? {capacity: reading.capacity, occupied: reading.occupied,
                free: reading.capacity - reading.occupied, observedAt: reading.observedAt, expiresAt: reading.expiresAt, open: reading.open} : null
            });
          }
          const summary = areas.get(area.id);
          states.push(state);
          counts.spaces++;
          summary.localSpaces++;
          if (space.virtual) counts.virtual++;
          if (state.status === 'occupied') { counts.occupied++; summary.localOccupied++; }
          if (state.status === 'reserved') { counts.reserved++; summary.localReserved++; }
          if (state.status === 'departing') { counts.departing++; summary.localDeparting++; }

          const closeness = 1 - distance / Math.max(1, distanceLimit);
          const variation = hash(space.id + '/' + Math.floor(now / (4 * MINUTE))) / 0x100000000;
          if (state.occupant && state.occupant.departAt <= now && (!space.virtual || position(space.facility.exit))) {
            const weight = tripWeight(area.kind, context.time, true);
            const tracked = this.overrides.has(space.id);
            if ((tracked || variation < weight) && (!canManeuver || canManeuver(space, 'departure'))) {
              departures.push({...state, priority: 2 * weight + closeness * .6 + variation * .35 + (tracked ? 2 : 0)});
            }
          }
          if (state.status === 'vacant' && permitsArrival(space) && profile.fraction > .03 &&
              (!space.virtual || position(space.facility.entrance))) {
            const weight = tripWeight(area.kind, context.time, false);
            if (variation < weight && (!canManeuver || canManeuver(space, 'arrival'))) {
              arrivals.push({...state, priority: 2 * weight + closeness * .6 + variation * .6});
            }
          }
        }
      }
    }
    const accepting = arrivals.filter(({area}) => {
      const summary = areas.get(area.id);
      const capacity = summary.reading?.capacity ?? summary.localSpaces;
      const occupied = summary.reading?.occupied ?? summary.localOccupied;
      return occupied + summary.localReserved < capacity;
    });
    this.lastSnapshot = {
      spaces: states, areas: [...areas.values()], counts,
      arrivals: limitCandidates(accepting, limit), departures: limitCandidates(departures, limit)
    };
    return this.lastSnapshot;
  }

  summary() {
    const {areas, counts} = this.lastSnapshot;
    return {areas, counts};
  }

  reserveArrival(spaceId, now = Date.now(), appearanceSeed) {
    const state = this.getSpaceState(spaceId, now);
    if (state?.status !== 'vacant' || !permitsArrival(state.space) ||
        (state.space.virtual && !position(state.space.facility.entrance))) return null;
    const context = this.context(now);
    const profile = this.profile(this.slots.get(spaceId).area, context);
    if (profile.reading) {
      let reserved = 0;
      for (const candidate of this.pending.values()) {
        if (candidate.kind === 'arrival' && candidate.areaId === state.area.id && candidate.expiresAt > now) reserved++;
      }
      if (profile.reading.occupied + reserved >= profile.reading.capacity) return null;
    }
    const token = {kind: 'arrival', areaId: state.area.id, space: state.space, occupant: null,
      appearanceSeed, expiresAt: now + RESERVATION_LIFETIME};
    this.pending.set(spaceId, token);
    return token;
  }

  finishArrival(token, now = Date.now(), appearanceSeed) {
    if (!this.take(token, 'arrival', now)) return null;
    const slot = this.slots.get(token.space.id);
    if (this.profile(slot.area, this.context(now)).open === false) return null;
    const [minimum, maximum] = dwellMinutes(slot);
    const sample = hash(slot.space.id + '/' + now) / 0x100000000;
    const departAt = now + (minimum + sample * (maximum - minimum)) * MINUTE;
    const occupant = this.occupant(slot, now, departAt, appearanceSeed ?? token.appearanceSeed ?? slot.appearanceSeed);
    this.overrides.set(slot.space.id, {occupant, until: departAt + DEPARTURE_GRACE});
    return occupant;
  }

  cancelArrival(token, now = Date.now()) {
    return this.take(token, 'arrival', now);
  }

  beginDeparture(spaceId, now = Date.now()) {
    const state = this.getSpaceState(spaceId, now);
    if (!state?.occupant || (state.space.virtual && !position(state.space.facility.exit))) return null;
    const token = {kind: 'departure', areaId: state.area.id, space: state.space, occupant: state.occupant,
      expiresAt: now + RESERVATION_LIFETIME};
    this.pending.set(spaceId, token);
    return token;
  }

  finishDeparture(token, now = Date.now()) {
    if (!this.take(token, 'departure', now)) return false;
    const slot = this.slots.get(token.space.id);
    const [minimum] = dwellMinutes(slot);
    this.overrides.set(slot.space.id, {occupant: null, until: now + minimum * MINUTE});
    return true;
  }

  cancelDeparture(token, now = Date.now()) {
    if (!this.take(token, 'departure', now)) return false;
    const until = Math.max(now, token.occupant.departAt) + DEPARTURE_GRACE;
    this.overrides.set(token.space.id, {occupant: token.occupant, until});
    return true;
  }

  take(token, kind, now) {
    if (token?.kind !== kind || this.pending.get(token.space.id) !== token) return false;
    this.pending.delete(token.space.id);
    return token.expiresAt > now;
  }
}
