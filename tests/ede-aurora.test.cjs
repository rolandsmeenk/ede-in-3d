const assert = require('node:assert/strict');
const test = require('node:test');

const minute = 60_000;
const observedAt = Date.parse('2026-11-27T20:00:00Z');
const grid = (coordinates, observation = observedAt, forecast = observation + 90 * minute) => ({
  'Observation Time': new Date(observation).toISOString(),
  'Forecast Time': new Date(forecast).toISOString(),
  coordinates
});

test('strong nearby cells project higher and brighter than distant cells', async () => {
  const { parseAurora } = await import('../js/ede-aurora.js');
  const read = cells => parseAurora(grid(cells), observedAt + minute);
  const nearby = read([[6, 54, 80]]);
  assert.ok(nearby.strength > 0.5);
  assert.ok(nearby.bearing > 0 && nearby.bearing < 12);
  assert.ok(nearby.elevation > 25 && nearby.elevation < 50);
  assert.equal(nearby.observedAt, observedAt);
  assert.equal(nearby.forecastAt, observedAt + 90 * minute);

  const distant = read([[6, 61, 100]]);
  assert.ok(distant.strength > 0 && distant.strength < nearby.strength);
  assert.ok(distant.elevation > 1 && distant.elevation < 8);
  for (const cell of [[6, 61, 20], [6, 62, 100], [30, 55, 100], [6, 50, 100], [6, 54, 0]]) {
    assert.equal(read([cell]).strength, 0);
  }
});

test('western longitudes wrap and east and west cells average around true north', async () => {
  const { parseAurora } = await import('../js/ede-aurora.js');
  const read = cells => parseAurora(grid(cells), observedAt + minute);
  const west = read([[359, 58, 95]]);
  assert.ok(west.bearing > 300 && west.bearing < 360);
  assert.ok(Math.abs(west.bearing - read([[-1, 58, 95]]).bearing) < 1e-10);
  const combined = read([[359, 58, 95], [12.344, 58, 95]]);
  assert.ok(combined.bearing < 1 || combined.bearing > 359);
  assert.ok(Math.abs(combined.strength - west.strength) < 1e-10);
});

test('timestamps expire and malformed grids fail while quiet grids remain valid', async () => {
  const { parseAurora, isAuroraFresh } = await import('../js/ede-aurora.js');
  const payload = grid([[6, 54, -1], [6, 54, 0], [6, 54, null]]);
  const quiet = parseAurora(payload, observedAt + minute);
  assert.equal(quiet.strength, 0);
  assert.equal(quiet.elevation, 0);
  assert.equal(isAuroraFresh(quiet, observedAt + 29 * minute), true);
  assert.equal(isAuroraFresh(quiet, observedAt + 30 * minute), false);
  assert.throws(() => parseAurora(payload, observedAt + 30 * minute), /stale/);
  assert.throws(() => parseAurora(payload, observedAt - 6 * minute), /Invalid/);
  assert.throws(() => parseAurora({ ...payload, 'Forecast Time': 'invalid' }, observedAt), /Invalid/);
  assert.throws(() => parseAurora(grid([[6, 54, 0]], observedAt, observedAt - minute), observedAt), /Invalid/);
  assert.equal(parseAurora(grid([[6, 54, 0]], observedAt, observedAt), observedAt).strength, 0);
  assert.throws(() => parseAurora(grid([[6, 54, 999], [6, 54, -1], []]), observedAt), /grid/);
});

test('fetch uses the public NOAA feed without credentials and obeys cancellation', async t => {
  const { fetchAurora } = await import('../js/ede-aurora.js');
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'no-store');
    options.signal.throwIfAborted();
    return { ok: true, json: async () => grid([[6, 54, 80]], Date.now() - minute) };
  });
  assert.ok((await fetchAurora()).strength > 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchAurora(controller.signal), { name: 'AbortError' });
  mock.mock.mockImplementation(async () => ({ ok: false, status: 503 }));
  await assert.rejects(fetchAurora(), /503/);
});
