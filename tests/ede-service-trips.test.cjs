const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

test('tractor routing blocks motorway links, signed closures and roads crossing town centres', async () => {
  const { tractorRoadAllowed, tractorClosedWays } = await import('../js/road-access.js');
  const road = { from: { x: -5000, z: 2400 }, to: { x: -5200, z: 2600 }, roadKind: 'unclassified', wayId: 'w1' };
  const closed = tractorClosedWays([
    { rvvCode: 'C8', edges: [{ way: 'w2' }] },
    { rvvCode: 'C9', edges: [{ way: 'w3' }], conditions: { exemptions: [{ vehicleType: ['agriculturalVehicle'] }] } },
  ]);
  assert.ok(tractorRoadAllowed(road, closed));
  for (const flags of [
    { wayId: 'w2' }, { wayId: 'w132856393' }, { motorwayLink: true }, { motorroad: true }, { agricultural: 'no' },
    { from: { x: -1000, z: 100 }, to: { x: 1000, z: 100 } }
  ]) assert.equal(tractorRoadAllowed({ ...road, ...flags }, closed), false);
  assert.ok(tractorRoadAllowed({ ...road, wayId: 'w3' }, closed));
});

test('ambulance circuits and farm trails bind to their own connected directed lanes', async () => {
  const { buildRoadNetwork, roadEdgeKey } = await import('../js/road-network.js');
  const { setEdeMotorwayLanes } = await import('../js/ede-motorway-lanes.js');
  const { bindEdeFittedLanes, fittedLanePoint } = await import('../js/ede-lane-geometry.js');
  const { AMBULANCE_STOPS } = await import('../js/ede-ambulance-routes.js');
  const { TRACTOR_FARMS } = await import('../js/ede-tractor-farms.js');
  const { createServiceTrips, farmTrailPose } = await import('../js/ede-service-trips.js');
  const data = name => readFileSync(join(__dirname, '../assets/ede-' + name));
  const json = name => JSON.parse(data(name + '.json'));
  const packed = name => JSON.parse(gunzipSync(data(name + '.json.gz')));
  setEdeMotorwayLanes(json('motorway-lanes'));
  const network = buildRoadNetwork([], [], [], json('grade'), packed('street-features').signs);
  bindEdeFittedLanes(network, packed('fitted-lanes'), e => [roadEdgeKey(e), e.wayId, e.layer].join('|'));
  const road = { isClosed: () => false };
  const farms = createServiceTrips(network, road, TRACTOR_FARMS, 'tractor');
  const ambulance = createServiceTrips(network, road, AMBULANCE_STOPS, 'ambulance');
  assert.deepEqual(farms.rows.map(r => r.site.id), TRACTOR_FARMS.map(s => s.id));
  assert.deepEqual(ambulance.rows.map(r => r.site.id), AMBULANCE_STOPS.map(s => s.id));

  for (const { goals } of farms.rows) for (const goal of goals) {
    assert.ok(goal.edge.tractorLanes.includes(goal.lane));
    assert.ok(goal.out > goal.at);
    const start = farmTrailPose(goal.trail, 0, {});
    const end = farmTrailPose(goal.trail, goal.trail.length, {});
    const startLane = fittedLanePoint(goal.edge, goal.lane, goal.at, {});
    const endLane = fittedLanePoint(goal.edge, goal.lane, goal.out, {});
    assert.ok(Math.hypot(start.x - startLane.x, start.z - startLane.z) < 1e-6);
    assert.ok(Math.hypot(end.x - endLane.x, end.z - endLane.z) < 1e-6);
    assert.ok(goal.trail.length > 35);
  }
  const next = { base: 'pickup', pickup: 'hospital', hospital: 'base' };
  for (const from of ambulance.rows) {
    const out = from.goals[0];
    const actor = { edge: out.edge, lane: out.lane, s: out.at };
    for (const to of ambulance.rows.filter(r => r.site.kind === next[from.site.kind])) {
      const plan = ambulance.route(actor, to);
      assert.ok(plan?.steps.length, from.site.id + ' → ' + to.site.id);
      for (const step of plan.steps) {
        assert.ok(step.from.ambulanceMoves.includes(step.move));
        assert.ok(step.move.to.ambulanceLanes.includes(step.move.out[step.lane]));
      }
    }
  }
});
