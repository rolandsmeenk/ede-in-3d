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

  const { createCoverageIndex } = await import('../js/ede-coverage.js');
  const pavedRoads = load('north-paving', true).surfaces.filter(surface =>
    surface.layer === 0 && surface.function.startsWith('rijbaan '));
  for (const [way, x, z] of [['w6850526', 4945, -10720], ['w299229745', 10065, 1202]]) {
    const motorPavement = createCoverageIndex(pavedRoads.flatMap(surface =>
      surface.polygons.filter(([outer]) => outer.some((coordinate, i) => i % 2 === 0
        && Math.abs(coordinate - x) < 250 && Math.abs(outer[i + 1] - z) < 250))));
    const approaches = network.edges.filter(e => e.wayId === way && e.len > 250 &&
      Math.abs(e.sx + e.dx * e.len / 2 - x) < 150 && Math.abs(e.sz + e.dz * e.len / 2 - z) < 150);
    assert.equal(approaches.length, 2, way);
    for (const approach of approaches) {
      for (const portion of [0.3, 0.4, 0.5, 0.6, 0.7]) {
        const { x, z, dx, dz } = fittedLanePoint(approach, 0, approach.len * portion, {});
        assert.ok(motorPavement.contains(x - dz, z + dx) && motorPavement.contains(x + dz, z - dx), way);
      }
    }
  }

  const kolkakkerweg = network.edges.find(e => streetRoadKey(e) === '-859.20,857.60,-959.50,874.30|w6953286|0');
  assert.ok(kolkakkerweg?.fittedLanes?.[0]);
  assert.equal(kolkakkerweg.sourceRoadKey, '-859.20,857.60,-978.80,873.80|w6953286|0');

  for (const [way, lanes, width] of [['w1055535553', 5, 15.3], ['w1055535551', 5, 15.8],
    ['w1055715727', 5, 16.2], ['w1055535552', 4, 12.6]]) {
    const stop = network.edges.find(e => e.wayId === way && e.turnTagsAtEnd);
    assert.ok(stop?.to.signal, way);
    assert.equal(stop.lanes.length, lanes, way);
    assert.equal(stop.laneDefinition.width, width, way);
    assert.ok(stop.driveLanes.every(lane => lane.width >= 3), way);
    assert.ok(network.edges.some(e => e.wayId === way && e.to.shape && e.lanes.length < stop.lanes.length), way);
  }
  const westbound = network.edges.find(e => e.wayId === 'w1055715727' && e.turnTagsAtEnd);
  assert.ok(westbound.driveLanes[2].busOnly && !westbound.ambientLanes.includes(2));
});

test('Apeldoornseweg follows the mapped curves while retaining bus references and junction endpoints', async () => {
  const { bindApeldoornsewegCurves, fittedLanePoint } = await import('../js/ede-lane-geometry.js');
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { streetRoadKey } = await import('../js/ede-street-features.js');
  const { setEdeMotorwayLanes } = await import('../js/ede-motorway-lanes.js');
  const { prepareEdeBusPaths } = await import('../js/ede-bus-traffic.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  setEdeMotorwayLanes(load('motorway-lanes'));
  const network = buildRoadNetwork([], [], [], load('grade'));
  const schedule = load('bus-routes');
  const before = prepareEdeBusPaths(schedule, network.edges, network.alternateBusMove);
  assert.ok([...before.values()].some(path => path.legs.some(leg => leg.road.roadName === 'Apeldoornseweg')));
  const roads = new Map(EDE_DATA.roads.map(road => [road.id, road]));
  const approaches = ['w118547825', 'w160287247', 'w6952730', 'w32824992'].map(id =>
    network.edges.filter(edge => edge.wayId === id).sort((a, b) => b.len - a.len)[0]);
  const stops = approaches.map(edge => [fittedLanePoint(edge, 0, 0, {}), fittedLanePoint(edge, 0, edge.len, {})]);
  const distance = ({ x, z }, edge) => {
    const { pts } = roads.get(edge.wayId);
    let nearest = Infinity;
    for (let i = 0; i + 2 < pts.length; i += 2) {
      const a = pts[i], b = pts[i + 1], dx = pts[i + 2] - a, dz = pts[i + 3] - b;
      const t = Math.max(0, Math.min(1, ((x - a) * dx + (z - b) * dz) / (dx * dx + dz * dz)));
      nearest = Math.min(nearest, Math.hypot(x - a - dx * t, z - b - dz * t));
    }
    return nearest;
  };
  const stations = [0.2, 0.35, 0.5, 0.65, 0.8];
  assert.ok(approaches.every(edge => Math.max(...stations.map(t =>
    distance(fittedLanePoint(edge, 0, edge.len * t, {}), edge))) > 12));
  bindApeldoornsewegCurves(network, streetRoadKey);
  for (const [i, edge] of approaches.entries()) {
    assert.ok(edge.fittedLanes?.[0], edge.wayId);
    for (const t of stations) {
      const p = fittedLanePoint(edge, 0, edge.len * t, {});
      assert.ok(distance(p, edge) < 3.5, edge.wayId);
    }
    for (const [end, station] of [0, edge.len].entries()) {
      const p = fittedLanePoint(edge, 0, station, {});
      assert.ok(Math.hypot(stops[i][end].x - p.x, stops[i][end].z - p.z) < 0.002, edge.wayId);
    }
  }
  const after = prepareEdeBusPaths(schedule, network.edges, network.alternateBusMove);
  assert.deepEqual([...after.keys()], [...before.keys()]);
});

test('through lanes at A12 exit 24, Maanderbroek and Ede-Noord taper before merging', async () => {
  const { bindEdeFittedLanes } = await import('../js/ede-lane-geometry.js');
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { streetRoadKey } = await import('../js/ede-street-features.js');
  const { setEdeMotorwayLanes } = await import('../js/ede-motorway-lanes.js');
  setEdeMotorwayLanes(load('motorway-lanes'));
  const network = buildRoadNetwork([], [], [], load('grade'));
  bindEdeFittedLanes(network, load('fitted-lanes', true), streetRoadKey);

  for (const [approach, continuation, minKmh] of [
    ['w1085149039', 'w1034188526', 65],
    ['w723962247', 'w723962248', 40],
    ['w750476158', 'w380485855', 65],
    ['w321166475', 'w1223228154', 40],
  ]) {
    const edge = network.edges.find(e => e.wayId === approach && e.ambientMoves.some(m => m.to.wayId === continuation));
    assert.ok(edge && !edge.to.signal, approach);
    const move = edge.ambientMoves.find(m => m.to.wayId === continuation);
    const driven = edge.ambientLanes.filter(lane => move.out[lane] >= 0);
    assert.ok(driven.length > 0, approach);
    for (const lane of driven) {
      const curve = network.connector(edge, lane, move.to, move.out[lane]);
      const cap = 3.6 * Math.sqrt(3.5 / Math.max(curve.curv, 0.001));
      assert.ok(cap >= minKmh, [approach, lane, cap.toFixed(1)].join(' '));
    }
  }
});

test('reviewed roundabouts keep one-way circuits, island clearance and entry priority', async () => {
  const { bindEdeFittedLanes, fittedLanePoint } = await import('../js/ede-lane-geometry.js');
  const { streetRoadKey, indexStreetFeatures } = await import('../js/ede-street-features.js');
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { createEdeDrivingControls } = await import('../js/ede-driving-controls.js');
  const { EDE_DRIVING_CONTROL_EVIDENCE } = await import('../js/ede-driving-control-evidence.js');
  const { CAR } = await import('../js/road-access.js');
  const { setEdeMotorwayLanes } = await import('../js/ede-motorway-lanes.js');
  setEdeMotorwayLanes(load('motorway-lanes'));
  const network = buildRoadNetwork([], [], [], load('grade'));
  bindEdeFittedLanes(network, load('fitted-lanes', true), streetRoadKey);
  const { edges, connector, curvePoint } = network;
  const controls = createEdeDrivingControls(indexStreetFeatures(load('street-features', true)), network);
  const southbound = edges.filter(edge => edge.wayId === 'w6954705' && edge.from.z < -68.8);
  assert.ok(southbound.length > 1);
  assert.ok(southbound.every(edge => edge.ambientLanes.length === 2));
  assert.ok(edges.some(edge => edge.wayId === 'w6954705' && edge.from.z >= -68.8 && edge.ambientLanes.length === 3));

  const ringWays = new Set(EDE_DRIVING_CONTROL_EVIDENCE.roundabouts);
  for (const [name, x, z, margin] of [
    ['Proosdijerveldweg', -1152.7, 620.1, 10],
    ['Kernhemseweg', -1551.2, -941.8, 9],
    ['Schaapsweg', -707.3, 335.5, 8],
    ['Bovenbuurtweg', -784, 2366.1, 8],
    ['Schutterweg', -4656.2, 1354.2, 10],
    ['Raadhuisstraat', 216.1, -140.1, 6],
    ['Klinkenbergerweg', -32.6, 878.9, 9],
    ['Van Steenbergenweg', -1910.5, 2473.3, 7],
    ['Polar Bearsplein', 183.4, 2306.1, 6],
    ['Klaphekweg', -1487.9, 801.8, 8],
  ]) {
    const radius = p => Math.hypot(p.x - x, p.z - z);
    const ring = new Set(edges.filter(edge => ringWays.has(edge.wayId) && radius(edge.from) < 22 && radius(edge.to) < 22));
    assert.ok(ring.size >= 10, name);
    const visited = new Set();
    const first = ring.values().next().value;
    let edge = first;
    while (!visited.has(edge)) {
      visited.add(edge);
      assert.equal(edge.ambientLanes.length, 1, name);
      const moves = edge.ambientMoves.filter(move => ring.has(move.to));
      assert.equal(moves.length, 1, name);
      const [move] = moves, [lane] = edge.ambientLanes;
      const curve = connector(edge, lane, move.to, move.out[lane]);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        assert.ok(radius(fittedLanePoint(edge, lane, edge.len * t, {})) > margin, name);
        assert.ok(radius(curvePoint(curve, curve.len * t, {})) > margin, name);
      }
      edge = move.to;
    }
    assert.equal(edge, first, name);
    assert.equal(visited.size, ring.size, name);
    const entrances = edges.filter(edge => !ring.has(edge) && edge.ambientMoves.some(move => ring.has(move.to)));
    assert.ok(entrances.length >= 2, name);
    assert.ok(entrances.every(edge => controls.conflicts(edge, CAR)?.some(incoming => ring.has(incoming))), name);
  }
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
