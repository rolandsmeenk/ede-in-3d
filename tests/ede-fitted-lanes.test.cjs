const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');

const load = (name, compressed) => {
  const bytes = readFileSync(join(__dirname, '../assets', `ede-${name}.json${compressed ? '.gz' : ''}`));
  return JSON.parse(compressed ? gunzipSync(bytes) : bytes);
};

test('shipped lane paths and junction connectors bind to the unchanged street and bus routes', async () => {
  const { bindEdeFittedLanes, fittedLanePoint, projectFittedLane } = await import('../js/ede-lane-geometry.js');
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { streetRoadKey } = await import('../js/ede-street-features.js');
  const { setEdeMotorwayLanes } = await import('../js/ede-motorway-lanes.js');
  const { prepareEdeBusPaths } = await import('../js/ede-bus-traffic.js');
  setEdeMotorwayLanes(load('motorway-lanes'));
  const network = buildRoadNetwork([], [], [], load('grade'));
  const asset = load('fitted-lanes', true);
  const schedule = load('bus-routes');
  const count = prepareEdeBusPaths(schedule, network.edges, network.alternateBusMove).size;
  const bound = bindEdeFittedLanes(network, asset, streetRoadKey);
  assert.equal(bound.edges, Object.keys(asset.edges).length);
  assert.ok(bound.connectors > 0);
  assert.equal(bound.rejectedEdges + bound.rejectedConnectors, 0);
  assert.equal(prepareEdeBusPaths(schedule, network.edges, network.alternateBusMove).size, count);
  const edge = network.edges.find(e => e.wayId === 'w1156964960');
  const lane = 2;
  assert.ok(edge.fittedLanes[lane]);
  const station = edge.len * 0.4;
  const p = fittedLanePoint(edge, lane, station, {});
  const recovered = projectFittedLane(edge, lane, p.x, p.z, 0, edge.len, {});
  assert.ok(Math.abs(recovered.station - station) < 0.001);
  assert.ok(Math.abs(Math.hypot(p.dx, p.dz) - 1) < 1e-6);
  assert.ok(p.width > 2 && p.stationScale > 0);
});

test('a stale junction path leaves the original geometry active throughout', async () => {
  const { bindEdeFittedLanes } = await import('../js/ede-lane-geometry.js');
  const first = { id: 0, wayId: 'a', sx: 0, sz: 0, len: 10, dx: 1, dz: 0, rx: 0, rz: 1, lanes: [0] };
  const next = { ...first, id: 1, wayId: 'b', sx: 15 };
  first.moves = [{ to: next, out: [0] }];
  const connector = () => ({ len: 5 });
  const network = { edges: [first, next], connector };
  const lane = [0,0,0,0,3, 10,10,1,10.05,3];
  const badConnector = [0,10,0,0,3, 5,15,0,5,3];
  const asset = { edges: { a: { start: [0,0], lanes: [lane] } }, connectors: { a: { b: { '0:0': badConnector } } } };
  const bound = bindEdeFittedLanes(network, asset, edge => edge.wayId);
  assert.equal(bound.rejectedConnectors, 1);
  assert.equal(bound.edges, 0);
  assert.equal(first.fittedLanes, undefined);
  assert.equal(network.connector, connector);
});
