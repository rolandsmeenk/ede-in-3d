const assert = require('node:assert/strict');
const test = require('node:test');
const timetable = require('../assets/ede-train-timetable.json');

const date = '2026-11-19';
const dateIndex = timetable.dates.indexOf(date);
const isOperating = trip => timetable.calendars[trip.calendar].includes(dateIndex);
const wag = 'ede-wageningen', centrum = 'ede-centrum';
const findStop = (trip, station) => trip.stops.find(stop => stop.station === station);
const isMorning = trip => {
  const stop = findStop(trip, wag);
  return stop && stop.arrival >= 10 * 3600 && stop.arrival < 11 * 3600;
};
const localTrips = timetable.trips.filter(trip => isOperating(trip) && isMorning(trip));

async function setup(asset = timetable, options) {
  const { buildEdeTrainTracks } = await import('../js/ede-train-tracks.js');
  const { createEdeTrainTraffic, TRAIN_STATUS } = await import('../js/ede-train-traffic.js');
  const { trainKey, trainPathFor } = await import('../js/ede-train-schedule.js');
  const { serviceEpoch } = await import('../js/ede-transit-time.js');
  const tracks = buildEdeTrainTracks();
  const traffic = createEdeTrainTraffic(asset, tracks, options);
  const key = trip => trainKey(trip.operator, date, trip.number);
  const current = (trip, at) => traffic.plans.find(plan => plan.key === key(trip) && traffic.position(plan, at));
  return { tracks, traffic, trainPathFor, serviceEpoch, TRAIN_STATUS, key, current };
}

function gps(path, distance, timestamp, identity, speed) {
  const where = path.sample(distance);
  return {
    operator: 'NS', number: identity, timestamp, x: where.x, z: where.z,
    bearing: (-where.heading * 180 / Math.PI + 360) % 360, speed
  };
}

test('NS deduplicates fixes, estimates speed from progress, brakes at the next stop and hands off along the same track', async () => {
  const { traffic, tracks, current, trainPathFor, serviceEpoch, TRAIN_STATUS, key } =
    await setup(timetable, { predictionSeconds: 20 });
  const ns = localTrips.find(trip => trip.operator === 'NS' && trip.direction === 1 && findStop(trip, wag).platform === '5');
  const path = trainPathFor(tracks.paths, ns);
  const at = serviceEpoch(date) + findStop(ns, wag).arrival - 29;
  const berth = path.stops[wag].distance;
  const fix = gps(path, berth - 180, at, ns.number, 15);
  traffic.acceptSnapshot({ version: 1, gps: [fix, fix] }, at);
  const chosen = current(ns, at);
  assert.equal(chosen.path, path);
  assert.equal(chosen.status, TRAIN_STATUS.gps);
  assert.equal(traffic.plans.filter(plan => plan.key === key(ns)).length, 1);
  assert.ok(traffic.position(chosen, at + 4).distance > berth - 180);
  assert.ok(traffic.position(chosen, at + 19.9).distance <= berth);

  const secondAt = at + 4;
  traffic.acceptSnapshot({ version: 1, gps: [gps(path, berth - 125, secondAt, ns.number)] }, secondAt);
  const second = current(ns, secondAt);
  assert.ok(Math.abs(traffic.position(second, secondAt).speed - 13.75) < 0.01);
  const last = traffic.position(second, secondAt + 19.999);
  assert.ok(last.distance <= berth && last.speed < 0.01);
  traffic.prepare(secondAt + 20);
  const fallback = current(ns, secondAt + 20);
  assert.equal(fallback.status, TRAIN_STATUS.timetable);
  assert.equal(fallback.path, path);
  assert.ok(Math.abs(traffic.position(fallback, secondAt + 20).distance - last.distance) < 0.05);
  // After a wall-clock correction, a future fix must not suppress the scheduled train.
  traffic.prepare(at - 60);
  assert.equal(current(ns, at - 60).status, TRAIN_STATUS.timetable);
});

test('RS34 holds its updated dwell, turns at the same berth and honours cancellation', async () => {
  const { traffic, tracks, current, trainPathFor, serviceEpoch, TRAIN_STATUS, key } = await setup();
  const depot = serviceEpoch(date);
  const rr = localTrips.find(trip => trip.operator === 'RRReis' && trip.direction === 1);
  const terminalStop = findStop(rr, wag);
  const depotArrival = terminalStop.arrival;
  const local = findStop(rr, centrum);
  const neighbor = timetable.trips.filter(trip => trip.operator === 'RRReis' && trip.direction === -1 &&
    isOperating(trip) && trip.stops[0].departure >= depotArrival + 60 &&
    trip.stops[0].departure < depotArrival + 12 * 60).sort((a, b) => a.stops[0].departure - b.stops[0].departure)[0];

  const actualArrival = depot + local.arrival + 150;
  const origin = trip => ({ operator: 'RRReis', number: trip.number, tripId: trip.realtimeTripId, serviceDate: date });
  const incoming = { ...origin(rr), delay: 150,
    stops: [
      { sequence: local.sequence, arrival: actualArrival, departure: actualArrival + 40, platform: '1' },
      { sequence: terminalStop.sequence, platform: '1b' }
    ] };
  const outgoing = { ...origin(neighbor), delay: 190, stops: [] };
  function update(timestamp, cancelled) {
    traffic.acceptSnapshot({ version: 1, updates: [
      { ...incoming, timestamp }, { ...outgoing, timestamp, cancelled }
    ] }, timestamp);
  }
  update(actualArrival + 15, false);
  const dwell = current(rr, actualArrival + 15);
  assert.equal(dwell.status, TRAIN_STATUS.live);
  const stop = traffic.position(dwell, actualArrival + 15);
  assert.equal(stop.speed, 0);
  assert.equal(stop.platform, '1');
  assert.equal(stop.distance, dwell.path.stops[centrum].distance);

  const turn = depot + neighbor.stops[0].arrival + 190;
  update(turn - 1, false);
  const parked = current(rr, turn - 1);
  const departing = current(neighbor, turn);
  assert.ok(parked.terminalArrival && departing.terminalDeparture);
  assert.equal(departing.turnFrom, key(rr));
  assert.equal(departing.path.direction, -1);
  assert.equal(traffic.position(departing, turn).platform, '1b');
  assert.ok(Math.abs(parked.anchors.at(-1).distance - parked.path.stops[wag].distance) > 15);
  const a = parked.path.sample(traffic.position(parked, turn - 1).distance);
  const b = departing.path.sample(traffic.position(departing, turn).distance);
  assert.ok(Math.hypot(a.x-b.x,a.z-b.z) < 0.001);

  update(turn + 1, true);
  assert.equal(current(neighbor, turn + 1), undefined);
  traffic.prepare(turn + 300);
  assert.equal(current(neighbor, turn + 300), undefined);
});

test('a matching overnight service keeps its service date and unknown GPS retires after its prediction window', async () => {
  const { createEdeTrainSchedule } = await import('../js/ede-train-schedule.js');
  const { serviceEpoch } = await import('../js/ede-transit-time.js');
  const n = localTrips.find(trip => trip.operator === 'NS' && trip.direction === 1);
  const overnight = { ...n, calendar: 0, stops: n.stops.map(stop => ({
    ...stop, arrival: stop.arrival + 15 * 3600, departure: stop.departure + 15 * 3600
  })) };
  const newAsset = { ...timetable, dates: [date,'2026-11-20'], calendars: [[0]], trips: [overnight] };
  const source = createEdeTrainSchedule(newAsset);
  const at = serviceEpoch(date) + findStop(overnight,wag).arrival;
  assert.equal(source.lookup({ operator: 'NS', number: n.number }, at).date, date);
  const { traffic, tracks } = await setup(newAsset, { predictionSeconds: 10 });
  const path = tracks.paths.find(path => path.id === 'main-5-east');
  const unknown = gps(path, 2400, at, '99999999', 22);
  traffic.acceptSnapshot({version:1,gps:[unknown]}, at);
  assert.equal(traffic.plans.filter(plan => plan.fix?.number === '99999999').length, 1);
  traffic.prepare(at + 10);
  assert.equal(traffic.plans.filter(plan => plan.fix?.number === '99999999').length, 0);
});
