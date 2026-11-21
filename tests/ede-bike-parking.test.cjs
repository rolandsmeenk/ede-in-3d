const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

async function parkingModule() {
  return loadModule(readFileSync(join(__dirname, '../js/ede-bike-parking.js'), 'utf8'), { imports: {
    'three/webgpu': {},
    './ede-transit-time.js': await import('../js/ede-transit-time.js'),
    './ede-parking-demand.js': await import('../js/ede-parking-demand.js'),
  } });
}

test('bike parking uses Amsterdam school hours and a higher secondary-school fatbike share', async () => {
  const { bikeParkingTime, bikeParkingOccupancy, bikeStyleFor } = await parkingModule();
  const peak = bikeParkingTime(Date.parse('2026-06-10T07:00:00Z'));
  const weekend = bikeParkingTime(Date.parse('2026-06-13T07:00:00Z'));
  assert.deepEqual([peak.hour, peak.weekend], [9, false]);
  assert.ok(bikeParkingOccupancy('school', peak) > .8);
  assert.ok(bikeParkingOccupancy('school', weekend) < .05);
  assert.equal(bikeStyleFor(true, .06), 'fatbike');
  assert.equal(bikeStyleFor(false, .06), 'ebike');
  assert.equal(bikeStyleFor(true, .40), 'omafiets');
});

test('parking and departure transfer one bike of the same type and keep state across camera jumps', async () => {
  const { createBikeParkingState } = await parkingModule();
  const track = { layer: 0, ax: 0, az: 0, ux: 1, uz: 0, len: 50, allowed: [true, false] };
  const slots = Array.from({ length: 24 }, (_, i) => ({ id: 'space-' + i, x: 22 + i * .06, y: 0, z: 3, yaw: 0 }));
  const state = createBikeParkingState([
    { id: 'one', kind: 'shops', slots, access: 'public' },
    { id: 'other-level', kind: 'shops', slots, access: 'public', level: 1 },
    { id: 'private', kind: 'shops', slots, access: 'private' },
  ], (_x, _z, _r, out) => { out[0] = track; }, () => true, () => 0);
  assert.equal(state.places.length, 1);
  const epoch = Date.parse('2026-11-19T12:00:00Z');
  state.tick(22, 0, 0, true, epoch);
  const area = state.areas.get('one'), goal = state.places[0].bikeAnchors[0];
  const find = occupied => [...area.spaces.values()].find(space => Boolean(state.occupant(space, area)) === occupied);
  const vacancy = find(false), occupied = find(true);
  assert.ok(vacancy && occupied);
  assert.equal(state.park(goal, 'one', 'fatbike', () => false), false);
  assert.equal(state.park(goal, 'one', 'fatbike', slot => slot === vacancy.slot), true);
  assert.equal(state.park(goal, 'one', 'ebike', slot => slot === vacancy.slot), false);
  state.tick(1000, 1000, 1, true, epoch);
  state.tick(22, 0, 2, true, epoch);
  assert.equal(state.occupant(vacancy, area), 'fatbike');
  assert.equal(state.depart((_anchor, slot) => slot === vacancy.slot), false, 'wait for the parked bike’s dwell');
  const style = state.occupant(occupied, area);
  assert.equal(state.depart((anchor, slot, movingStyle) => anchor.track === track &&
    slot === occupied.slot && movingStyle === style), true);
  assert.equal(state.occupant(occupied, area), null);
  state.tick(22, 0, 32, true, vacancy.change.ready);
  assert.equal(state.depart((_anchor, slot, movingStyle) => slot === vacancy.slot && movingStyle === 'fatbike'), true);
  assert.equal(state.occupant(vacancy, area), null);
  assert.equal(state.stats.arrived, 1);
  assert.equal(state.stats.departed, 2);
});
