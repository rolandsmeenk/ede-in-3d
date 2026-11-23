const assert = require('node:assert/strict');
const busAsset = require('../assets/ede-bus-routes.json');
const { test } = require('node:test');

function edge(id, from, to, moves) {
  const span = to - from;
  return { id, key: `${from},0,${to},0`, from: { x: from, z: 0 }, to: { x: to, z: 0 },
    sx: from + 2, sz: 0, dx: 1, dz: 0, span, len: span - 4, lanes: [0, 1.8], moves };
}

test('bus routes follow directed lanes between actual map boundaries and dock on the curb side', async () => {
  const { buildBusRoutes } = await import('../tools/build-ede-bus-routes.mjs');
  const outside = (id, x) => ({ id, name: id, x, z: 0 });
  const stops = [outside('west', -15), { id: 'right', x: 12, z: 4 }, { id: 'wrong', x: 78, z: -5 }, outside('east', 115)];
  const trips = [{ id: 'first', dates: [0, 3] }, { id: 'second', dates: [0, 3] }];
  const outbound = { id: 'eastbound', shape: [[-15, 0], [115, 0]], stops, trips };
  const reverse = { id: 'westbound', shape: [[115, 0], [-15, 0]], stops: stops.slice().reverse(), trips };
  const feed = { variants: [outbound, reverse] };
  const graph = { bounds: [0, -10, 100, 10], edges: [edge(0, -10, 50, [{ to: 1, out: [-1, 1] }]), edge(1, 50, 110, [])] };
  const { data, report } = buildBusRoutes(feed, graph);
  const [east, west] = data.variants;
  assert.equal(east.slices.length, 1);
  assert.equal(east.slices[0].entryBoundary, true);
  assert.equal(east.slices[0].exitBoundary, true);
  const { legs, stops: boarding } = east.slices[0];
  assert.equal(legs[0].start, 15);
  assert.equal(legs.at(-1).end, 115);
  assert.deepEqual(data.edges, ['-10,0,50,0', '50,0,110,0']);
  assert.ok(legs.every(leg => leg.lane === 1));
  assert.deepEqual(east.stops.map(s => s.matched), [false, true, false, false]);
  assert.equal(boarding[0].index, 1);
  assert.equal(boarding[0].at, 20);
  assert.deepEqual(data.calendars, [[0, 3]]);
  assert.ok(data.variants.every(v => v.trips.every(t => t.dates === 0)));
  assert.equal(west.slices.length, 0);
  assert.deepEqual(report.variants[0].gaps.map(gap => gap.reason), ['outside-map', 'outside-map']);
  assert.ok(report.variants[1].gaps.some(gap => gap.reason === 'no-connected-lane'));

  graph.edges[0].moves = [];
  const disconnected = buildBusRoutes({ variants: [outbound] }, graph);
  assert.equal(disconnected.data.variants[0].slices.length, 2);
  assert.ok(disconnected.report.variants[0].gaps.some(gap => gap.reason === 'no-connected-lane'));
});

test('a terminal platform at the end of a bay can board before the next lane', async () => {
  const { buildBusRoutes } = await import('../tools/build-ede-bus-routes.mjs');
  const departure = { id: 'platform', platform: 'F', x: 49.1, z: 1.8 };
  const arrival = { id: 'street', x: 80, z: 4 };
  const variant = { id: 'departing', shape: [[49.2, 0], [80, 0]], stops: [departure, arrival] };
  const graph = { bounds: [0, -10, 100, 10], edges: [edge(0, 0, 50, [{ to: 1, out: [-1, 1] }]), edge(1, 50, 100, [])] };
  const { data } = buildBusRoutes({ variants: [variant] }, graph);
  const [route] = data.variants;
  assert.equal(route.stops[0].matched, true);
  const { legs, stops } = route.slices[0];
  assert.equal(stops[0].index, 0);
  assert.equal(stops[0].leg, 0);
  assert.equal(data.edges[legs[0].edge], '0,0,50,0');
  assert.equal(legs[0].start, 0);
  assert.ok(stops[0].at < legs[0].to);
});

test('a bus lane re-entering the municipal boundary does not cross the excluded area', async () => {
  const { buildBusRoutes } = await import('../tools/build-ede-bus-routes.mjs');
  const stops = [
    { id: 'west', x: 5, z: 0 }, { id: 'outside', x: 50, z: 0 }, { id: 'east', x: 95, z: 0 },
  ];
  const feed = { variants: [{ id: 'through', shape: [[5, 0], [95, 0]], stops }] };
  const boundary = [[[0, -10, 100, -10, 100, 10, 0, 10], [40, -4, 60, -4, 60, 4, 40, 4]]];
  const graph = { bounds: [0, -10, 100, 10], boundary, edges: [edge(0, 0, 100, [])] };
  const { data, report } = buildBusRoutes(feed, graph);
  const [route] = data.variants;
  assert.equal(route.slices.length, 2);
  assert.deepEqual(route.stops.map(stop => stop.matched), [true, false, true]);
  assert.equal(route.stops[1].x, undefined);
  assert.equal(route.stops[1].distance, 45);
  const [gap] = report.variants[0].gaps.filter(({ reason }) => reason === 'outside-map');
  assert.deepEqual([gap.from, gap.to], [35, 55]);
  assert.ok(route.slices[0].legs.at(-1).to <= 38);
  assert.ok(route.slices[1].legs[0].from >= 58);
});

test('the bundled timetable boards at the newly covered villages', () => {
  for (const town of ['Bennekom', 'Harskamp', 'De Valk']) {
    assert.ok(busAsset.variants.some(variant => variant.slices.length &&
      variant.stops.some(stop => stop.matched && stop.name.startsWith(`${town},`))), town);
  }
});
