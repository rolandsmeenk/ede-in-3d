const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

test('matched buses start at the boundary and use only connected lanes', async () => {
  const { busEntryAt, prepareEdeBusPaths } = await import('../js/ede-bus-traffic.js');
  const { roadEdgeKey } = await import('../js/road-network.js');
  const road = (x, stopX) => ({
    from: { x, z: 0 }, to: { x: stopX, z: 0 }, len: stopX - x,
    sx: x, sz: 0, rx: 0, rz: 1, lanes: [1.8], moves: []
  });
  const first = road(-12, 20), second = road(20, 80);
  first.moves.push({ to: second, out: [0] });
  const slice = {
    entryBoundary: true,
    legs: [
      { edge: 0, lane: 0, start: 10, end: 30, from: 12, to: 32 },
      { edge: 1, lane: 0, start: 30, end: 90, from: 0, to: 60 },
    ],
    stops: [{ index: 0, leg: 1, at: 30 }],
  };
  const stop = { x: 50, z: 4, distance: 60 };
  const schedule = { edges: [roadEdgeKey(first), roadEdgeKey(second)], variants: [{ slices: [slice], stops: [stop] }] };
  const path = prepareEdeBusPaths(schedule, [second, first]).get(slice);
  assert.deepEqual(busEntryAt(path, 75, false), { leg: 0, at: 12, stop: 0 });
  assert.deepEqual(busEntryAt(path, 60, true), { leg: 1, at: 30, stop: 0 });
  assert.deepEqual(busEntryAt(path, 75, true), { leg: 1, at: 45, stop: 1 });
  assert.equal(path.stops[0].stop, stop);
});

test('ordinary traffic has an onward lane without entering the bus-only station roads', async () => {
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { edges } = buildRoadNetwork([], []);
  assert.ok(edges.some((edge) => edge.busOnly && edge.busExclusive));
  for (const edge of edges) for (const lane of edge.ambientLanes) {
    assert.ok(edge.ambientMoves.some((move) => move.to.ambientLanes.includes(move.out[lane])));
  }
});

test('all Ede bus sections retain connected legal lanes after lane counts change', async () => {
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { prepareEdeBusPaths } = await import('../js/ede-bus-traffic.js');
  const { setEdeMotorwayLanes } = await import('../js/ede-motorway-lanes.js');
  const { BUS } = await import('../js/road-access.js');
  const load = name => JSON.parse(readFileSync(join(__dirname, `../assets/ede-${name}.json`), 'utf8'));
  const schedule = load('bus-routes');
  setEdeMotorwayLanes(load('motorway-lanes'));
  const { edges, paintEdges, alternateBusMove } = buildRoadNetwork([], [], [], load('grade'));
  const paths = prepareEdeBusPaths(schedule, edges, alternateBusMove);
  assert.equal(paths.size, schedule.variants.flatMap(variant => variant.slices).length);
  for (const { legs } of paths.values()) for (let i = 0; i < legs.length; i++) {
    const { road, lane, move } = legs[i];
    assert.ok(road.laneModes[lane] & BUS);
    const next = legs[i + 1];
    if (next) {
      assert.equal(move.to, next.road);
      assert.equal(move.out[lane], next.lane);
    }
  }
  const approach = edges.find(edge => edge.wayId === 'w1156964960');
  assert.equal(approach.laneDefinition, paintEdges.find(edge => edge.wayId === approach.wayId).laneDefinition);
  assert.equal(approach.laneDefinition.width, 9.8);
  assert.deepEqual(approach.ambientLanes, [0, 1, 2]);
  assert.equal(approach.laneModes[3], BUS);
  assert.deepEqual(approach.moves.find(move => move.to.wayId === 'w620928502').out.slice(0, 3), [0, 1, -1]);
  const carriageway = edges.filter(edge => edge.wayId === 'w6960114' && edge.sourceRoadKey);
  assert.ok(carriageway.length > 4);
  assert.ok(carriageway.every(edge => edge.laneDefinition.source === 'weggeg' && edge.sourceRoadStart < edge.sourceRoadEnd));
});

test('fresh exact GTFS observations replace their scheduled run and stale data restores it', async () => {
  const { createEdeBusSchedule } = await import('../js/ede-bus-schedule.js');
  const { busRouteDistance, busTrackingSpeed, createEdeBusTracker, prepareEdeBusPaths } = await import('../js/ede-bus-traffic.js');
  const { roadEdgeKey } = await import('../js/road-network.js');
  const road = {
    sx: 0, sz: 0, dx: 1, dz: 0, rx: 0, rz: 1, len: 950, lanes: [2], moves: [],
    from: { x: 0, z: 0 }, to: { x: 950, z: 0 }
  };
  const day = '2026-11-18';
  const slice = { legs: [{ edge: 0, lane: 0, from: 0, to: 950, start: 0, end: 950 }] };
  const stops = [
    { id: 'station', distance: 0, x: 0, z: 2 },
    { id: 'market', distance: 950, x: 950, z: 2 }
  ];
  const trip = { id: 'exact-trip', dates: [0], departure: 9 * 3600, stops: [[0, 0], [500, 500]] };
  const variant = { id: 'exact-direction', routeId: '1', direction: 1, headsign: 'Markt', stops, slices: [slice], trips: [trip] };
  const date = new Date(`${day}T08:01:00Z`);
  const schedule = createEdeBusSchedule({ firstDate: day, lastDate: day, services: [day], variants: [variant], edges: [roadEdgeKey(road)] }, date);
  const paths = prepareEdeBusPaths(schedule, [road]);
  const { acceptFeed, tripsAt } = createEdeBusTracker(schedule, paths);
  const timestamp = date.getTime() / 1000;
  const [scheduled] = tripsAt(0, timestamp);
  assert.equal(scheduled.distance, 114);

  const vehicle = { tripId: trip.id, serviceDate: day, x: 230, z: 2, timestamp, speed: 10 };
  const feed = { timestamp, vehicles: [{ ...vehicle, tripId: 'unknown' }, vehicle, { ...vehicle, timestamp: timestamp - 1, x: 80 }] };
  acceptFeed(feed, timestamp + 10);
  const live = tripsAt(10, timestamp + 10);
  assert.equal(live.length, 1);
  assert.equal(live[0].tripKey, scheduled.tripKey);
  assert.equal(live[0].variant, variant);
  assert.equal(live[0].trip, trip);
  assert.equal(live[0].distance, 330);
  assert.equal(live[0].live, true);
  assert.equal(busTrackingSpeed(busRouteDistance(paths.get(slice), 0, 330), live[0]), 10);
  assert.ok(busTrackingSpeed(365, live[0]) < 10);
  assert.ok(busTrackingSpeed(305, live[0]) > 10);

  const [fallback] = tripsAt(121, timestamp + 121);
  assert.equal(fallback.tripKey, scheduled.tripKey);
  assert.ok(Math.abs(fallback.distance - 343.9) < 1e-6);
  assert.equal(fallback.live, undefined);

  const outOfRoute = { timestamp: timestamp + 130, vehicles: [{ ...vehicle, timestamp: timestamp + 130, z: 800 }] };
  acceptFeed(outOfRoute, timestamp + 130);
  assert.deepEqual(tripsAt(130, timestamp + 130), []);
});
