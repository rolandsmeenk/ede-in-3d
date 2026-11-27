const assert = require('node:assert/strict');
const test = require('node:test');

const activityModule = import('../js/ede-activity.js');
const parkingModule = import('../js/ede-parking-demand.js');

function snapshot(weekday, minute, overrides) {
  return {weekday, minute, daylight: true, weather: 'dry', events: [], ...overrides};
}

test('commutes, markets, nightlife and recreation follow the selected local clock', async () => {
  const {edeActivity} = await activityModule;
  const profile = (day, minute, options) => edeActivity(snapshot(day, minute, options));
  assert.equal(profile(1, 479).market, false);
  assert.equal(profile(1, 480).market, true);
  assert.equal(profile(1, 780).market, false);
  assert.equal(profile(6, 1019).market, true);
  assert.equal(profile(6, 1020).market, false);
  assert.equal(profile(2, 510).market, false);
  assert.ok(profile(1, 510).active(-119, -53) > profile(2, 510).active(-119, -53));
  assert.equal(profile(1, 510).active(2000, 2000), 1);

  assert.equal(profile(5, 1200).nightlife, true);
  assert.equal(profile(6, 90).nightlife, true);
  assert.equal(profile(0, 119).nightlife, true);
  assert.equal(profile(0, 120).nightlife, false);
  assert.equal(profile(1, 90).nightlife, false);
  assert.equal(profile(0, 800).recreation, true);
  assert.equal(profile(0, 800, {weather: 'rain'}).recreation, false);
  assert.equal(profile(0, 800, {heavyRain: true}).recreation, false);
  assert.equal(profile(0, 800, {daylight: false}).recreation, false);

  assert.equal(profile(4, 480).morning, true);
  assert.equal(profile(4, 990).afternoon, true);
  assert.equal(profile(4, 480, {holiday: true}).morning, false);
  assert.ok(profile(4, 480, {holiday: true}).road < profile(4, 480, {schoolHoliday: true}).road);
  assert.ok(profile(4, 480, {schoolHoliday: true}).road < profile(4, 480).road);
});

test('event crowds stay local, and Airborne leaves road and parking demand unchanged', async () => {
  const {edeActivity} = await activityModule;
  const ordinary = edeActivity(snapshot(6, 780));
  const airborne = edeActivity(snapshot(6, 780, {events: [{id: 'airborne', zone: 'ginkelse-heide'}]}));
  assert.equal(airborne.active(4286, 1019) > ordinary.active(4286, 1019), true);
  assert.equal(airborne.active(-119, -53), ordinary.active(-119, -53));
  assert.equal(airborne.parking(4286, 1019), ordinary.parking(4286, 1019));
  assert.equal(airborne.road, ordinary.road);
});

test('centre event parking only increases local inference and respects fresh readings and real closures', async () => {
  const {edeActivity} = await activityModule;
  const {ParkingDemand} = await parkingModule;
  const now = Date.parse('2026-12-03T11:00:00Z');
  const ordinary = edeActivity(snapshot(4, 720));
  const event = edeActivity(snapshot(4, 720, {events: [{id: 'christmas-market', zone: 'centrum'}]}));
  const facilities = [
    {id: 'central', kind: 'shopping', garage: true, capacity: 100, x: 0, z: 0},
    {id: 'outer', kind: 'shopping', garage: true, capacity: 100, x: 1000, z: 0},
    {id: 'closed', kind: 'shopping', garage: true, capacity: 100, x: 50, z: 0,
      rules: {closedFrom: '2026-12-03', closedThrough: '2026-12-03'}}
  ];
  const model = new ParkingDemand({facilities});
  function areas(activity, at = now) {
    return Object.fromEntries(model.refresh({x: 0, z: 0, radius: 1250, now: at, activity})
      .areas.map(area => [area.id, area]));
  }
  const baseline = areas(ordinary);
  const boosted = areas(event);
  assert.ok(boosted.central.targetFraction > baseline.central.targetFraction);
  assert.equal(boosted.outer.targetFraction, baseline.outer.targetFraction);
  assert.equal(boosted.closed.targetFraction, 0);
  model.setFacilityReadings([{facilityId: 'central', occupied: 31, observedAt: now, expiresAt: now + 60_000}]);
  assert.equal(areas(event).central.source, 'observed');
  assert.equal(areas(event).central.targetFraction, .31);
  assert.ok(Math.abs(areas(event, now + 60_000).central.targetFraction - .31) < 1e-9);
  assert.ok(areas(event, now + 16 * 60_000).central.targetFraction > .31);
});
