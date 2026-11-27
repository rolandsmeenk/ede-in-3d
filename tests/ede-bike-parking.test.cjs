const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

async function parkingModule(three = {}) {
  return loadModule(readFileSync(join(__dirname, '../js/ede-bike-parking.js'), 'utf8'), { imports: {
    'three/webgpu': three,
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

test('all nearby De Klomp stands fit in the rack instance buffer', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const { createBikeParkingState, renderBikeParking } = await parkingModule(three);
  const { buildEdeBikeParkingSites } = await import('../js/ede-bike-parking-sites.js');
  const sites = buildEdeBikeParkingSites([], { placementAt: () => 0 });
  const state = createBikeParkingState(sites, () => {}, () => false, () => 0);
  state.tick(-6682, 6, 0, true);
  const nearby = state.nearby();
  assert.deepEqual(Array.from(nearby, area => area.id).sort(), [
    'veenendaal-de-klomp-noord', 'veenendaal-de-klomp-stationsweg', 'veenendaal-de-klomp-zuid',
  ]);
  const parent = new three.Group();
  renderBikeParking(parent, state, new Map())();
  const stands = parent.getObjectByName('Ede bicycle parking').children[0];
  assert.equal(stands.count, 3 * nearby.reduce((total, area) => total + area.slots.length, 0));
  assert.ok(stands.count <= stands.instanceMatrix.count);
});


test('all six White Bike racks have a map arrival and display the shared fleet', async () => {
  const { buildEdeBikeParkingSites } = await import('../js/ede-bike-parking-sites.js');
  const { EDE_WHITE_BIKE_SITES } = await import('../js/ede-white-bike-sites.js');
  const { containsTravelPoint, containsPlayablePoint, TELEPORT_LOCATIONS } = await import('../js/city-config.js');
  const { createBikeParkingState } = await parkingModule();
  const sites = buildEdeBikeParkingSites([], { placementAt: () => 0 }).filter(site => site.kind === 'white-bike');
  assert.equal(sites.length, 6);
  const state = createBikeParkingState(sites, () => {}, () => true, () => 0);
  const epoch = Date.parse('2026-07-18T12:00:00Z');
  for (const { id, x, z } of EDE_WHITE_BIKE_SITES) {
    const arrival = TELEPORT_LOCATIONS[id];
    assert.equal(arrival.focus.x, x);
    assert.ok(containsTravelPoint(arrival.x, arrival.z));
    assert.ok(containsTravelPoint(arrival.x - Math.sin(arrival.heading) * 52,
      arrival.z - Math.cos(arrival.heading) * 52));
    state.tick(x, z, 0, true, epoch, 0);
    const area = state.areas.get(id);
    assert.ok(state.nearby().includes(area));
    assert.equal(area.occupancy, area.entrance ? .96 : .62);
    assert.ok([...area.spaces.values()].every(space => space.style === 'white-bike'));
    assert.ok(area.anchors.size === 0);
    state.tick(x, z, 0, false, epoch, 1);
    const daytime = area.occupancy;
    assert.ok(area.entrance ? daytime < .5 : daytime > .9);
    state.tick(x, z, 0, false, epoch, 1, 1);
    assert.ok(area.entrance ? area.occupancy > daytime : area.occupancy < daytime);
  }
  const schaarsbergen = TELEPORT_LOCATIONS['white-bike-schaarsbergen'];
  assert.equal(containsPlayablePoint(schaarsbergen.x, schaarsbergen.z), false);
});

test('White Bikes use a 75% eligible share and stay on paved routes within the park', async () => {
  const { hogeVeluweBikeActivity, hogeVeluweBikeReturns, useWhiteBike, whiteBikePath, whiteBikeTrack } = await import('../js/ede-white-bike-traffic.js');
  const track = { ax: 10700, az: -5780, ux: 1, uz: 0, len: 10, surface: 'asphalt' };
  const longConnector = { ...track, kind: 'connector', len: 4500 };
  const connector = { ...track, kind: 'connector', len: 3 };
  const gravel = { ...track, surface: 'fine_gravel' };
  const outside = { ...track, ax: 6000, len: 5200 };
  assert.ok(whiteBikeTrack(track));
  assert.equal(Array.from({ length: 100 }, (_, i) => useWhiteBike(track, () => i / 100)).filter(Boolean).length, 75);
  assert.equal(useWhiteBike(outside, () => 0), false);
  assert.equal(useWhiteBike({ ...track, mountain: true }, () => 0), false);
  assert.ok(whiteBikePath([{ track: connector }, { track }]));
  assert.equal(whiteBikePath([{ track: longConnector }, { track }]), false);
  assert.equal(whiteBikePath([{ track: gravel }]), false);
  const activity = (date, hour, weekday = 6) => hogeVeluweBikeActivity({ date, minute: hour * 60, weekday });
  assert.equal(activity('2026-01-17', 8), 0);
  assert.equal(activity('2026-01-17', 18), 0);
  assert.equal(activity('2026-07-18', 22), 0);
  assert.ok(activity('2026-07-18', 13) > activity('2026-07-18', 9));
  assert.ok(activity('2026-07-18', 13) > activity('2026-07-18', 21));
  assert.ok(activity('2026-07-18', 13) > activity('2026-07-20', 13, 1));
  assert.equal(hogeVeluweBikeReturns({ minute: 9 * 60 }), 0);
  assert.equal(hogeVeluweBikeReturns({ minute: 17 * 60 }), 1);
});

test('morning park rides aim for the highlights and afternoon rides return to an entrance', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { buildEdeActiveTravel } = await import('../js/ede-active-travel.js');
  const { createEdeTrips } = await import('../js/ede-trips.js');
  const { EDE_WHITE_BIKE_SITES } = await import('../js/ede-white-bike-sites.js');
  const { whiteBikeTrack, whiteBikePath } = await import('../js/ede-white-bike-traffic.js');
  const activeTravel = buildEdeActiveTravel(EDE_DATA, null);
  const trips = createEdeTrips({ edges: [], activeTravel }, {}, { places: [], random: () => .39 });
  let frame = 0;
  for (const site of EDE_WHITE_BIKE_SITES.filter(site => site.id !== 'white-bike-schaarsbergen')) {
    const candidates = [];
    activeTravel.bikes(site.approach.x, site.approach.z, 70, candidates);
    let route;
    for (const track of candidates.filter(track => !track.noSpawn && whiteBikeTrack(track))) {
      trips.updateClock(frame++, Date.parse('2026-07-18T11:00:00Z'), { weekday: 6, minute: site.entrance ? 700 : 970 });
      route = trips.parkBike(track, track.allowed[0] ? 1 : -1, track.len / 2, !site.entrance);
      if (route) break;
    }
    assert.ok(route, site.id);
    assert.equal(Boolean(route.hub.entrance), !site.entrance);
    assert.ok(route.steps.every(step => whiteBikePath(step.legs)));
  }
});
