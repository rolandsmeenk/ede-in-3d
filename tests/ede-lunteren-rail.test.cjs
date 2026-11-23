const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const timetable = require('../assets/ede-train-timetable.json');
const grade = require('../assets/ede-grade.json');
const { loadModule } = require('./helpers/module.cjs');

const date = timetable.dates.find(day => [1, 2, 3, 4, 5].includes(new Date(day).getUTCDay()));
const stopName = 'lunteren';

test('both RS34 directions use their published Lunteren platform and reach the playable boundary', async () => {
  const { buildEdeTrainTracks } = await import('../js/ede-train-tracks.js');
  const { createEdeTrainSchedule, trainPathFor, trainPlan, timetablePosition } = await import('../js/ede-train-schedule.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { EDE_NORTH_RAIL } = await import('../js/ede-north-rail-data.js');
  const { setEdeGrade, setEdePlatforms, gradeProfileAt } = await import('../js/ede-grade.js');
  const { serviceEpoch } = await import('../js/ede-transit-time.js');
  const epoch = serviceEpoch(date);
  setEdeGrade(grade);
  const { paths } = buildEdeTrainTracks();
  const { stations, entries } = createEdeTrainSchedule(timetable);
  const selected = EDE_NORTH_RAIL.platforms;
  assert.deepEqual(selected.map(p => p.number), ['1', '2']);
  const points = [];
  for (const direction of [1, -1]) {
    const entry = entries(epoch + 10 * 3600).find(({ trip }) => trip.route === 'rs34' && trip.direction === direction);
    const source = entry.trip.stops.find(stop => stop.station === stopName);
    const path = trainPathFor(paths, entry.trip);
    const plan = trainPlan(entry, path, stations);
    const arrival = plan.anchors.find(a => a.station === stopName);
    const dwell = timetablePosition(plan, arrival.arrival + 20);
    const berth = path.stops[stopName];
    const platform = selected.find(p => p.number === berth.platform);
    const train = path.sample(berth.distance);
    points.push(train);
    assert.equal(berth.platform, source.platform);
    assert.equal(arrival.platform, source.platform);
    assert.equal(arrival.departure - arrival.arrival, source.departure - source.arrival);
    assert.equal(dwell.speed, 0);
    assert.equal(dwell.distance, berth.distance);
    assert.ok(Math.abs(train.y + grade.datumNAP - 16.8) < 0.12);
    assert.ok(Math.hypot(train.x - platform.stop[0], train.z - platform.stop[1]) < 0.004);
    const edge = path.sample(direction === 1 ? 0 : path.length);
    if (EDE_DATA.meta.fullMunicipality) {
      const bridge = EDE_DATA.railways.find(way => way.id === 'w6305163');
      assert.ok(bridge?.municipalClip);
      assert.ok(Math.hypot(edge.x - bridge.pts.at(-2), edge.z - bridge.pts.at(-1)) < 0.02);
    } else {
      assert.ok(Math.abs(edge.z - EDE_DATA.meta.bounds[1]) < 0.02);
    }
  }
  assert.ok(Math.hypot(points[0].x - points[1].x, points[0].z - points[1].z) > 5);

  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const up = () => new THREE.Vector3(0, 1, 0);
  const { buildEdeLunterenPlatforms } = loadModule(
    readFileSync(require.resolve('../js/ede-lunteren-platforms.js'), 'utf8'), { imports: {
      'three/webgpu': THREE,
      './ede-civic-landmarks.js': { CivicBatch: class { polygon() {} quad() {} mesh() { return new THREE.Group(); } }, polygonNormal: up },
      './ede-geodata.js': { EDE_DATA },
      './ede-north-rail-data.js': await import('../js/ede-north-rail-data.js'),
    } });
  const walkables = buildEdeLunterenPlatforms(new THREE.Scene());
  assert.equal(walkables.length, 8);
  setEdePlatforms(walkables);
  for (const surface of walkables.slice(0, 2)) {
    const x = surface.outer.reduce((sum, point) => sum + point.x, 0) / surface.outer.length;
    const z = surface.outer.reduce((sum, point) => sum + point.z, 0) / surface.outer.length;
    const y = surface.height(x, z);
    assert.equal(gradeProfileAt(x, z, 'person', undefined, y)?.y, y);
    assert.notEqual(gradeProfileAt(x, z, 'car', undefined, y)?.kind, 'platform');
  }
});

test('RS34 waits on its own platform when an opposing service keeps the single track', async () => {
  const { buildEdeTrainTracks } = await import('../js/ede-train-tracks.js');
  const { createEdeTrainTraffic, TRAIN_CONSISTS, trainCarOffset } = await import('../js/ede-train-traffic.js');
  const { serviceEpoch } = await import('../js/ede-transit-time.js');
  const { setEdeGrade } = await import('../js/ede-grade.js');
  const { planTimeAt } = await import('../js/ede-train-schedule.js');
  setEdeGrade(grade);
  const tracks = buildEdeTrainTracks();
  const dateIndex = timetable.dates.indexOf(date);
  const select = direction => timetable.trips.find(trip => trip.route === 'rs34' && trip.direction === direction &&
    trip.stops.find(stop => stop.station === stopName).arrival >= 10 * 3600 && timetable.calendars[trip.calendar].includes(dateIndex));
  const south = select(1), north = select(-1);
  const southLunteren = south.stops.find(stop => stop.station === stopName).arrival;
  const northLunteren = north.stops.find(stop => stop.station === stopName).arrival;
  // Align arrival on the opposite platform, then delay the northbound train
  // in the single-track approach by adding five minutes to its arrival.
  const revised = { ...north, calendar: 0, stops: north.stops.map(stop => ({ ...stop,
    arrival: stop.arrival + southLunteren - northLunteren + (stop.station === 'ede-wageningen' ? 0 : 300),
    departure: stop.departure + southLunteren - northLunteren + (stop.station === 'ede-wageningen' ? 0 : 300),
  })) };
  const traffic = createEdeTrainTraffic({
    ...timetable, dates: [date], calendars: [[0]], trips: [{ ...south, calendar: 0 }, revised]
  }, tracks);
  const epoch = serviceEpoch(date);
  traffic.prepare(epoch + southLunteren);
  const plans = traffic.plans.filter(plan => plan.path.route === 'rs34');
  assert.equal(plans.length, 2);
  const southbound = plans.find(plan => plan.path.direction === 1);
  const northbound = plans.find(plan => plan.path.direction === -1);
  const half = trainCarOffset(TRAIN_CONSISTS.rs34, 0) + TRAIN_CONSISTS.rs34.length / 2;
  const southBlock = plan => plan.path.blocks.find(b => b.id === 'lunteren-south');
  const held = southbound.anchors.find(a => a.station === stopName);
  const published = south.stops.find(stop => stop.station === stopName);
  assert.ok(held.departure > epoch + published.departure, 'scheduled meet holds departure');
  assert.equal(traffic.position(southbound, held.departure - 1).speed, 0);
  assert.ok(planTimeAt(southbound.anchors, southBlock(southbound).from - half) >=
    planTimeAt(northbound.anchors, southBlock(northbound).to + half));

  for (let time = epoch + southLunteren - 520; time < epoch + southLunteren + 820; time += 0.5) {
    traffic.advance(0.5, time);
    const occupied = new Set();
    for (const train of traffic.progress.values()) {
      for (const block of train.plan.path.blocks ?? []) {
        if (train.distance + half < block.from || train.distance - half > block.to) continue;
        assert.ok(!occupied.has(block.id), `${block.id} was occupied in both directions at ${time - epoch}`);
        occupied.add(block.id);
      }
    }
  }
});
