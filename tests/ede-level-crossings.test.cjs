const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const grade = require('../assets/ede-grade.json');
const timetable = require('../assets/ede-train-timetable.json');

async function setup() {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const terrain = await import('../js/terrain.js');
  const geodata = await import('../js/ede-geodata.js');
  const gradeModule = await import('../js/ede-grade.js');
  const trains = await import('../js/ede-train-traffic.js');
  const { buildEdeTrainTracks } = await import('../js/ede-train-tracks.js');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => new Response(readFileSync(url));
    await terrain.loadTerrain();
  } finally {
    globalThis.fetch = originalFetch;
  }
  gradeModule.setEdeGrade(grade);
  const { createEdeLevelCrossings } = loadModule(
    readFileSync(path.join(__dirname, '../js/ede-level-crossings.js'), 'utf8'),
    { imports: { 'three/webgpu': THREE, './terrain.js': terrain, './ede-geodata.js': geodata,
      './ede-grade.js': gradeModule, './ede-train-traffic.js': trains } }
  );
  const tracks = buildEdeTrainTracks();
  return { tracks, trains, build: traffic => createEdeLevelCrossings(new THREE.Scene(), { tracks, traffic }) };
}

test('a scheduled RS34 closes Telefoonweg for road users until the last carriage clears', async () => {
  const { tracks, trains, build } = await setup();
  const { serviceEpoch } = await import('../js/ede-transit-time.js');
  const { planTimeAt } = await import('../js/ede-train-schedule.js');
  const date = '2026-11-19';
  const index = timetable.dates.indexOf(date);
  const trip = timetable.trips.find(trip => trip.operator === 'RRReis' && trip.direction === 1 &&
    trip.stops[0].departure > 10 * 3600 && timetable.calendars[trip.calendar].includes(index));
  const traffic = trains.createEdeTrainTraffic({
    ...timetable, dates: [date], calendars: [[0]], trips: [{ ...trip, calendar: 0 }]
  }, tracks);
  const crossings = build(traffic);
  assert.equal(crossings.crossings.length, 29);
  assert.equal(crossings.group.children.length, 64);
  const state = crossings.crossings.find(state => state.id === 'telefoonweg-level-crossing');
  const { controls: point } = grade.sites.find(site => site.id === state.id);
  const rail = tracks.paths.find(path => path.id === 'rs34-south');
  traffic.prepare(serviceEpoch(date) + trip.stops[0].departure);
  const plan = traffic.plans.find(plan => plan.date === date);
  const distance = rail.project(point.x, point.z).distance;
  const pass = planTimeAt(plan.anchors, distance);
  const half = trains.trainCarOffset(trains.TRAIN_CONSISTS.rs34, 0) + trains.TRAIN_CONSISTS.rs34.length / 2;
  const dx = Math.sin(point.heading), dz = Math.cos(point.heading);
  const query = { x: point.x - dx * 12, z: point.z - dz * 12,
    y: -1.6, dx, dz, wayId: point.roadWayIds[0] };
  const seen = new Set(), flashes = new Set();
  let checkedBeforeNose = false, checkedAfterCenter = false;
  for (let i = 0; i <= 560; i++) {
    const at = pass - 35 + i / 10;
    traffic.advance(0.1, at);
    crossings.update(0.1, at);
    seen.add(state.phase);
    if (state.phase === 'warning') {
      flashes.add(state.flash);
      for (const mode of ['motor', 'bike', 'foot']) {
        assert.ok(Math.abs(crossings.stopDistance({ ...query, mode }) - 6.5) < 1e-9);
      }
      const opposite = { ...query, x: point.x + dx * 12, z: point.z + dz * 12, dx: -dx, dz: -dz };
      assert.ok(Math.abs(crossings.stopDistance({ ...opposite, mode: 'motor' }) - 6.5) < 1e-9);
      for (const options of [{ layer: -1 }, { y: 3 }, { wayId: 'w-other' }, { x: point.x, z: point.z }]) {
        assert.equal(crossings.stopDistance({ ...query, mode: 'foot', ...options }), Infinity);
      }
    }
    const train = traffic.progress.get(plan.key);
    if (!train) continue;
    if (train.distance + half >= distance - 14 && train.distance + half < distance - 8) {
      checkedBeforeNose = true;
      assert.equal(state.phase, 'closed');
    }
    if (train.distance > distance + 1 && train.distance - half < distance - 1) {
      checkedAfterCenter = true;
      assert.equal(state.phase, 'closed');
    }
  }
  assert.deepEqual([...seen], ['open', 'warning', 'closing', 'closed', 'opening']);
  assert.deepEqual([...flashes].sort(), [0, 1]);
  assert.equal(state.phase, 'open');
  assert.equal(state.flash, -1);
  assert.equal(crossings.stopDistance({ ...query, mode: 'motor' }), Infinity);
  assert.ok(checkedBeforeNose && checkedAfterCenter);
});

test('Dwarsweg stays closed when a second train approaches from the opposite direction', async () => {
  const { tracks, build } = await setup();
  const progress = new Map();
  const crossings = build({ progress, upcoming: () => [], forecast: (train, at, seconds) => train.distance + seconds * train.speed });
  const site = grade.sites.find(site => site.id === 'dwarsweg-level-crossing');
  const state = crossings.crossings.find(state => state.id === site.id);
  function setTrain(id, point, offset) {
    const path = tracks.paths.find(path => path.id === id);
    const center = path.project(point.x, point.z).distance;
    progress.set(id, { plan: { path, trip: { operator: 'NS' } }, distance: center + offset, speed: 30 });
  }
  setTrain('main-5-east', site.crossings[0], 0);
  crossings.update(1, 0);
  assert.equal(state.phase, 'closed');
  setTrain('main-5-east', site.crossings[0], 100);
  setTrain('main-3-west', site.crossings[1], -120);
  for (let at = 1; at <= 7; at++) {
    setTrain('main-3-west', site.crossings[1], (at - 5) * 30);
    crossings.update(1, at);
    assert.equal(state.phase, 'closed');
  }
  for (let at = 8; at <= 15; at++) crossings.update(1, at);
  assert.equal(state.phase, 'open');
});

test('the Lunteren station foot crossing protects both surveyed platform tracks', async () => {
  const { tracks, build } = await setup();
  const { EDE_NORTH_RAIL } = await import('../js/ede-north-rail-data.js');
  const site = EDE_NORTH_RAIL.sites.find(site => site.id === 'north-level-crossing-357');
  const progress = new Map();
  const crossings = build({ progress, upcoming: () => [], forecast: train => train.distance });
  const state = crossings.crossings.find(state => state.id === site.id);
  const control = site.controls;
  const dx = Math.sin(control.heading), dz = Math.cos(control.heading);
  const y = site.crossings[0].y;
  const query = { x: control.x - dx * 14, z: control.z - dz * 14, y, dx, dz, wayId: control.roadWayIds[0] };
  for (const [index, id] of ['rs34-south', 'rs34-north'].entries()) {
    const path = tracks.paths.find(path => path.id === id);
    const contact = site.crossings.find(point =>
      Number.isFinite(path.project(point.x, point.z, point.railWayId).error));
    const distance = path.project(contact.x, contact.z, contact.railWayId).distance;
    progress.set(id, { plan: { path, trip: { operator: 'RRReis' } }, distance });
    crossings.update(0.1, index * 20);
    assert.equal(state.phase, 'closed');
    assert.ok(Number.isFinite(crossings.stopDistance({ ...query, mode: 'foot' })));
    assert.equal(crossings.stopDistance({ ...query, mode: 'motor' }), Infinity);
    progress.clear();
    crossings.update(5, index * 20 + 5);
    assert.equal(state.phase, 'open');
  }
});
