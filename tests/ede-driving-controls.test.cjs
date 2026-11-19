const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

const assets = (name) => readFileSync(join(__dirname, '../assets', name));

test('the Ede map binds a raised zebra, directed stops and roundabout priority', async () => {
  const { createEdeDrivingControls } = await import('../js/ede-driving-controls.js');
  const { indexStreetFeatures } = await import('../js/ede-street-features.js');
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { setEdeMotorwayLanes } = await import('../js/ede-motorway-lanes.js');
  const { BICYCLE, CAR, FOOT } = await import('../js/road-access.js');
  setEdeMotorwayLanes(JSON.parse(assets('ede-motorway-lanes.json')));
  const features = indexStreetFeatures(JSON.parse(gunzipSync(assets('ede-street-features.json.gz'))));
  const network = buildRoadNetwork([], [], [], JSON.parse(assets('ede-grade.json')));
  const controls = createEdeDrivingControls(features, network);

  const zebra = features.byId('ndw-vop-4407');
  assert.equal(zebra.street, 'Molenstraat');
  assert.equal(zebra.control, 'uncontrolled');
  assert.equal(zebra.markings, 'zebra');
  assert.equal(features.byId(zebra.bumpId).profile, 'hump');
  const edge = network.edges.find(e => controls.crossings(e, CAR).some(row => row.id === zebra.id));
  const row = controls.crossings(edge).find(row => row.id === zebra.id);
  assert.ok(row.from > 0 && row.to < edge.len);
  assert.equal(controls.crossings(edge, BICYCLE).length, 0);
  assert.equal(controls.speedCap(edge, row.from - 2.2, 2.2, CAR), 5.2);
  assert.ok(controls.speedCap(edge, row.from - 20, 2.2, CAR) > 5.2);
  assert.equal(controls.speedCap(edge, row.from, 2.2, BICYCLE), Infinity);
  const tracks = [];
  network.activeTravel.foot(zebra.x, zebra.z, 25, tracks);
  const path = tracks.find(t => t.crossing?.osmId === 9726439421);
  assert.ok(controls.pathCrossings(path, 1, FOOT).includes(zebra.id));
  assert.ok(controls.pathCrossings({ ...path, layer: 1 }, 1, FOOT).length === 0);
  assert.ok(controls.pathCrossings(path, 1, BICYCLE).length === 0);
  assert.ok(controls.review.zebras.linked > 0);
  const table = features.byId('ndw-drempel-264233');
  const tableRoads = network.edges.filter(e => e.wayId === table.wayId &&
    controls.crossings(e).some(row => row.id === 'ndw-vop-22686'));
  assert.equal(table.profile, 'table');
  assert.equal(tableRoads.length, 2);
  for (const tableRoad of tableRoads) {
    const tableAt = controls.crossings(tableRoad).find(row => row.id === 'ndw-vop-22686').from;
    assert.equal(controls.speedCap(tableRoad, tableAt, 2.2, CAR), 7.2);
  }

  const stop = network.edges.find(e => controls.approach(e)?.id === 'n14029357144');
  assert.equal(stop.wayId, 'w421619020');
  assert.equal(controls.approach(stop, CAR).kind, 'stop');
  assert.equal(controls.approach(stop, BICYCLE), null);
  assert.equal(controls.review.mappedLines.stop, 2);
  const vehicle = { edge: stop, half: 2.2, s: 0, speed: 10 };
  const target = controls.stopTarget(vehicle, 3, CAR);
  assert.ok(target + vehicle.half < stop.len);
  vehicle.s = target;
  vehicle.speed = 0;
  assert.equal(controls.stopTarget(vehicle, 10, CAR), target);
  assert.equal(controls.stopTarget(vehicle, 11.24, CAR), target);
  assert.equal(controls.stopTarget(vehicle, 11.25, CAR), Infinity);
  assert.equal(controls.stopTarget(vehicle, 12, CAR), Infinity);
  controls.resetVehicle(vehicle);
  vehicle.s = 0;
  vehicle.speed = 10;
  assert.equal(controls.stopTarget(vehicle, 20, CAR), target);

  const roundabout = network.edges.find(e => e.wayId === 'w6953898' && controls.approach(e)?.kind === 'roundabout');
  const circulating = controls.conflicts(roundabout, CAR);
  assert.deepEqual(circulating.map(e => e.wayId), ['w668532572']);
  assert.deepEqual(controls.conflicts(circulating[0], CAR), []);
  assert.equal(controls.review.signalizedCrossingsWithoutPlans, 82);
});

test('street controls keep directed and independently layered references separate', async () => {
  const { createEdeDrivingControls } = await import('../js/ede-driving-controls.js');
  const { indexStreetFeatures, streetRoadKey } = await import('../js/ede-street-features.js');
  const { CAR, MOTOR } = await import('../js/road-access.js');
  const a = { x: 0, z: 0, in: [] }, b = { x: 30, z: 0, in: [] };
  const front = { from: a, to: b, sx: 2, sz: 0, dx: 1, dz: 0, span: 30, len: 26, wayId: 'w1', layer: 0, modes: MOTOR };
  const back = { ...front, from: b, to: a, sx: 28, dx: -1 };
  const overpass = { ...front, layer: 1, bridge: true };
  const key = streetRoadKey(front);
  const hump = (id, from, match) => ({ id, match, layer: 0, height: 0.08, profile: 'hump',
    edges: [{ key, from, to: from + 2, modes: MOTOR, confidence: 0.94, layer: 0 }] });
  const features = indexStreetFeatures({
    version: 1, signs: [], crossings: [], bumps: [hump('actual', 12, 'matched'), hump('uncertain', 22, 'uncertain')]
  });
  const controls = createEdeDrivingControls(features, { edges: [front, back, overpass] }, { roundabouts: [], lines: [] });
  assert.equal(controls.speedCap(front, 8, 2, CAR), 5.2);
  assert.ok(controls.speedCap(front, 1, 2, CAR) > 5.2);
  assert.equal(controls.speedCap(front, 19, 2, CAR), Infinity);
  assert.equal(controls.speedCap(back, 8, 2, CAR), Infinity);
  assert.equal(controls.speedCap(overpass, 8, 2, CAR), Infinity);
  assert.deepEqual(controls.review.bumps, { linked: 1, review: 1 });
});
