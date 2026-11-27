const assert = require('node:assert/strict');
const test = require('node:test');

const dependencies = Promise.all([
  import('../js/ede-city-clock.js'),
  import('../js/ede-market-schedule.js'),
  import('../js/ede-parking-demand.js'),
]);

const activityAt = (create, date, hour, options = {}) => create(
  { date, seconds: hour * 3600 },
  { season: 'summer', calendar: true, daylight: true, weather: 'dry', ...options },
);

test('the Amsterdam clock selects the weekly market and summer fountain hours', async () => {
  const [{ createEdeCityActivity }, { edeMarketState }] = await dependencies;
  const state = (date, hour, options) => edeMarketState(activityAt(createEdeCityActivity, date, hour, options));
  assert.deepEqual(state('2026-07-06', 8), { openSite: 'marktplein', fountain: false });
  assert.deepEqual(state('2026-07-06', 13), { openSite: null, fountain: false });
  assert.deepEqual(state('2026-07-09', 11), { openSite: 'stadspoort', fountain: true });
  assert.deepEqual(state('2026-07-10', 11), { openSite: 'bennekom', fountain: true });
  assert.deepEqual(state('2026-07-11', 16), { openSite: 'marktplein', fountain: false });
  assert.deepEqual(state('2026-07-11', 17), { openSite: null, fountain: false });
  assert.equal(state('2026-07-12', 8.99).fountain, false);
  assert.equal(state('2026-07-12', 9).fountain, true);
  assert.equal(state('2026-07-12', 20.99).fountain, true);
  assert.equal(state('2026-07-12', 21).fountain, false);
  assert.equal(state('2026-07-12', 11, { season: 'winter' }).fountain, false);
  assert.equal(state('2026-08-23', 14).fountain, false); // Heideweek centre event
  assert.equal(state('2026-12-25', 11, { season: 'winter' }).openSite, null);
});

test('the market car parks release their spaces on the Amsterdam clock', async () => {
  const [{ createEdeCityActivity }, { edeMarketParkingArea }, { ParkingDemand }] = await dependencies;
  const area = (date, hour) => edeMarketParkingArea(activityAt(createEdeCityActivity, date, hour));
  const stadspoort = 'osm-w25473495', bennekom = 'osm-w413998749';
  assert.equal(area('2026-07-09', 7.99), null);
  assert.equal(area('2026-07-09', 8), stadspoort);
  assert.equal(area('2026-07-09', 13), null);
  assert.equal(area('2026-07-09', 18), bennekom);
  assert.equal(area('2026-07-10', 14.99), bennekom);
  assert.equal(area('2026-07-10', 15), null);
  assert.equal(area('2026-12-24', 18), null); // Friday Christmas Day
  assert.equal(area('2026-12-25', 11), null);

  const demand = new ParkingDemand({ spaces: [stadspoort, bennekom].map((areaId, i) => ({
    id: areaId, areaId, x: i, z: 0, heading: 0, access: 'public',
  })) });
  const opts = { x: 0, z: 0, radius: 5, now: Date.parse('2026-07-16T09:00:00Z') };
  const snapshot = demand.refresh({ ...opts, closedArea: area('2026-07-16', 11) });
  assert.equal(snapshot.areas.find(row => row.id === stadspoort).open, false);
  assert.equal(demand.getSpaceState(stadspoort, opts.now).status, 'unavailable');
  assert.notEqual(demand.getSpaceState(bennekom, opts.now).status, 'unavailable');
  assert.equal(demand.reserveArrival(stadspoort, opts.now), null);
  demand.refresh(opts);
  assert.notEqual(demand.getSpaceState(stadspoort, opts.now).status, 'unavailable');
});
