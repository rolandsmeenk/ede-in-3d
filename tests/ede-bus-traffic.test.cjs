const assert = require('node:assert/strict');
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
