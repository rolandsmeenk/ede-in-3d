const assert = require('node:assert/strict');
const test = require('node:test');

const parkingModule = import('../js/ede-parking-demand.js');
const date = value => Date.parse(value);

function spacesFor(areaId, x, count = 100, access = 'public') {
  return Array.from({length: count}, (_, index) => ({
    id: areaId + '/' + index, areaId, x: x + index % 10 * 3,
    z: Math.floor(index / 10) * 5, y: 0, heading: 0, layer: 0, access
  }));
}

function local(model, now, x = 0, z = 0, radius = 85) {
  return model.refresh({x, z, radius, now: typeof now === 'string' ? date(now) : now});
}

test('local Amsterdam hours and days select matching survey and fallback profiles', async () => {
  const {ParkingDemand} = await parkingModule;
  const areas = [
    {id: 'homes', kind: 'residential'},
    {id: 'parkweg', name: 'Parkweg', kind: 'residential'},
    {id: 'shopping', name: 'Kuiperplein', kind: 'shopping'},
    {id: 'station', kind: 'station'}
  ];
  const model = new ParkingDemand({areas, spaces: areas.flatMap((area, index) => spacesFor(area.id, index * 250))});
  assert.equal(local(model, '2026-12-03T11:00:00Z').counts.occupied, 45);
  assert.equal(local(model, '2026-12-03T01:00:00Z').counts.occupied, 77);
  const parkweg = local(model, '2026-06-18T18:30:00Z', 250).areas[0];
  assert.equal(parkweg.survey, 'parkweg-2020');
  assert.equal(parkweg.targetFraction, .6525);
  assert.equal(parkweg.localOccupied, 65);
  const kuiperSummer = local(model, '2026-06-20T08:30:00Z', 500).areas[0];
  const kuiperWinter = local(model, '2026-12-05T09:30:00Z', 500).areas[0];
  assert.equal(kuiperSummer.survey, 'ede-centre-2024');
  assert.equal(kuiperSummer.targetFraction, .925);
  assert.equal(kuiperWinter.targetFraction, kuiperSummer.targetFraction);
  assert.equal(local(model, '2026-12-04T16:30:00Z', 500).areas[0].targetFraction, .99);
  assert.equal(local(model, '2026-12-06T09:30:00Z', 500).areas[0].source, 'inferred');
  const beforeSunday = local(model, '2026-12-05T22:59:50Z', 500).counts.occupied;
  const afterSunday = local(model, '2026-12-05T23:00:00Z', 500).counts.occupied;
  assert.equal(beforeSunday, afterSunday);
  assert.ok(local(model, '2026-12-03T10:00:00Z', 750).counts.occupied > 2 * local(model, '2026-12-06T10:00:00Z', 750).counts.occupied);
  assert.ok(local(model, '2026-12-03T16:00:00Z', 750).departures.length > 0);
});

test('parking stays camera-local and capped without rerolling existing cars', async () => {
  const {ParkingDemand, parkingAppearanceSeed} = await parkingModule;
  const areas = [{id: 'first', kind: 'shopping'}, {id: 'second', kind: 'residential'}];
  const model = new ParkingDemand({areas, spaces: [...spacesFor('first', 0), ...spacesFor('second', 250)]});
  const now = date('2026-12-03T11:00:00Z');
  const here = local(model, now);
  assert.equal(here.spaces.length, 100);
  assert.ok(here.arrivals.length > 0 && here.arrivals.length <= 4);
  assert.ok(here.departures.length <= 4);
  assert.equal(local(model, now, 250).areas[0].id, 'second');
  assert.deepEqual(local(model, now), here);
  const stillParked = local(model, now + 30_000).spaces.filter(state => state.occupant);
  const appearance = new Map(here.spaces.filter(state => state.occupant).map(state => [state.space.id, state.occupant.appearanceSeed]));
  assert.ok(stillParked.length > 0);
  for (const state of stillParked) {
    assert.equal(state.occupant.appearanceSeed, parkingAppearanceSeed(state.space.id));
    if (appearance.has(state.space.id)) assert.equal(state.occupant.appearanceSeed, appearance.get(state.space.id));
  }
  assert.equal(model.refresh({x: 120, z: 0, radius: 180, now, limit: 2}).arrivals.length, 2);
  const top = new Set(here.arrivals.map(({space}) => space.id));
  const constrained = model.refresh({x: 0, z: 0, radius: 85, now,
    canManeuver: (space, kind) => kind === 'arrival' && !top.has(space.id)});
  assert.equal(constrained.departures.length, 0);
  assert.equal(constrained.arrivals.length, 4);
  assert.ok(constrained.arrivals.every(({space}) => !top.has(space.id)));
  assert.equal(local(model, now, 5000).counts.spaces, 0);
});

test('only exact fresh facility readings are displayed and expiry preserves current space choices', async () => {
  const {ParkingDemand} = await parkingModule;
  const now = date('2026-12-03T11:00:00Z');
  const area = {id: 'kuiper-osm', name: 'Kuiperplein', kind: 'shopping'};
  const similar = {id: 'kuiper-nearby', name: 'Kuiperplein side street', kind: 'residential'};
  const model = new ParkingDemand({
    areas: [area, similar], spaces: [...spacesFor(area.id, 0), ...spacesFor(similar.id, 250)],
    facilities: [{id: 'exact', areaId: area.id, name: 'Kuiperplein', kind: 'shopping', capacity: 120}],
    facilityReadings: [
      {facilityId: 'Kuiperplein side street', occupied: 10, capacity: 100, observedAt: now},
      {facilityId: 'exact', occupied: 30, capacity: 120, observedAt: now, expiresAt: now + 60_000},
      {facilityId: 'exact', occupied: 150, capacity: 120, observedAt: now + 20_000}
    ]
  });
  const fresh = local(model, now);
  const [summary] = fresh.areas;
  assert.equal(summary.source, 'observed');
  assert.equal(summary.open, null);
  assert.equal(summary.reading.occupied, 30);
  assert.equal(summary.reading.free, 90);
  assert.equal(summary.localOccupied, 25);
  assert.equal(fresh.spaces[0].source, 'inferred');
  assert.equal(local(model, now, 250).areas[0].reading, null);
  const expired = local(model, now + 60_000);
  assert.equal(expired.areas[0].source, 'survey');
  assert.equal(expired.areas[0].reading, null);
  assert.deepEqual(expired.spaces.filter(s => s.occupant).map(s => s.space.id),
    fresh.spaces.filter(s => s.occupant).map(s => s.space.id));
  assert.equal(local(model, now + 16 * 60_000).counts.occupied, 93);
  model.setFacilityReadings([{facilityId: 'exact', occupied: 60, observedAt: now + 60_000}]);
  assert.equal(local(model, now + 4 * 60_000 - 1).areas[0].source, 'observed');
  assert.equal(local(model, now + 4 * 60_000).areas[0].source, 'survey');
});

test('dated garage rules and fresh exact open status gate virtual trips', async () => {
  const {ParkingDemand} = await parkingModule;
  const garage = {
    id: 'station', kind: 'station', garage: true, capacity: 100, access: 'paid',
    entrance: {x: 10, y: -2, z: 20, layer: -1, wayId: 12},
    exit: {x: 15, y: -2, z: 20, layer: -1, wayId: 14},
    rules: {open24h: true, closedFrom: '2026-11-15', closedThrough: '2026-11-27'}
  };
  const model = new ParkingDemand({facilities: [garage]});
  const closed = local(model, '2026-11-27T22:59:00Z');
  assert.equal(closed.areas[0].source, 'closed');
  assert.equal(closed.arrivals.length, 0);
  assert.equal(closed.departures.length, 0);
  assert.equal(closed.counts.occupied, 0);
  assert.equal(closed.counts.virtual, garage.capacity);
  assert.equal(closed.areas[0].virtualSpaces, garage.capacity);
  assert.equal(closed.areas[0].mappedSpaces, 0);
  assert.equal(local(model, '2026-11-27T23:00:00Z').areas[0].open, true);
  const now = date('2026-11-30T07:00:00Z');
  const open = local(model, now);
  assert.ok(open.arrivals.length > 0);
  assert.ok(open.arrivals.every(({space}) => space.virtual && space.layer === -1 &&
    space.facility.entrance === garage.entrance && space.facility.exit === garage.exit));
  model.setFacilityReadings([{facilityId: garage.id, occupied: 100, observedAt: now}]);
  assert.equal(local(model, now).arrivals.length, 0);
  model.setFacilityReadings([{facilityId: garage.id, occupied: 20, observedAt: now + 1, open: false}]);
  const disabled = local(model, now + 1);
  assert.equal(disabled.areas[0].open, false);
  assert.equal(disabled.areas[0].reading.occupied, 20);
  assert.equal(disabled.counts.occupied, 0);
  assert.equal(model.reserveArrival(open.arrivals[0].space.id, now + 1), null);
});

test('parking transfers share a slot, keep appearance, and respect restrictions and expiration', async () => {
  const {ParkingDemand} = await parkingModule;
  const area = {id: 'shopping', kind: 'shopping'};
  const spaces = spacesFor(area.id, 0, 30);
  spaces[0].access = 'private';
  spaces[1].access = 'permit';
  const model = new ParkingDemand({areas: [area], spaces});
  const now = date('2026-12-03T11:00:00Z');
  const snapshot = local(model, now);
  const free = snapshot.arrivals[0].space.id;
  const limited = snapshot.arrivals[1].space.id;
  model.getSpaceState(limited, now).space.rules = {opening_hours: 'Mo-Sa 10:00-18:00'};
  assert.equal(model.reserveArrival(limited, now), null);
  assert.equal(model.getSpaceState(spaces[0].id, now).status, 'unavailable');
  assert.equal(model.reserveArrival(spaces[0].id, now), null);
  assert.equal(model.reserveArrival(spaces[1].id, now), null);
  const initial = model.reserveArrival(free, now);
  assert.equal(model.getSpaceState(free, now).status, 'reserved');
  assert.equal(model.reserveArrival(free, now), null);
  assert.equal(model.cancelArrival(initial, now), true);
  const timeout = model.reserveArrival(free, now, 15);
  assert.equal(model.finishArrival(timeout, timeout.expiresAt), null);
  const inbound = model.reserveArrival(free, now);
  const occupant = model.finishArrival(inbound, now + 60_000, 17);
  assert.equal(occupant.appearanceSeed, 17);
  assert.ok(occupant.departAt > occupant.arrivedAt + 20 * 60_000);
  assert.equal(model.finishArrival(inbound, now + 60_000), null);
  const departureTime = occupant.departAt;
  assert.deepEqual(model.getSpaceState(free, departureTime).occupant, occupant);
  const outbound = model.beginDeparture(free, departureTime);
  assert.equal(outbound.occupant.appearanceSeed, 17);
  assert.equal(model.getSpaceState(free, departureTime).status, 'departing');
  assert.equal(model.reserveArrival(free, departureTime), null);
  assert.equal(model.cancelDeparture(outbound, departureTime), true);
  assert.deepEqual(model.getSpaceState(free, departureTime).occupant, occupant);
  assert.equal(model.finishDeparture(model.beginDeparture(free, departureTime), departureTime + 60_000), true);
  assert.equal(model.getSpaceState(free, departureTime + 60_000).status, 'vacant');

  const limitedModel = new ParkingDemand({areas: [area], spaces: [{...spaces[2], rules: {maxstay: '10 minutes'}}],
    facilities: [{id: 'lot', areaId: area.id, kind: 'shopping', capacity: 1}],
    facilityReadings: [{facilityId: 'lot', occupied: 0, observedAt: now}]});
  const limitedToken = limitedModel.reserveArrival(spaces[2].id, now);
  assert.equal(limitedModel.finishArrival(limitedToken, now).departAt, now + 10 * 60_000);
});
