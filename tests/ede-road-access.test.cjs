const assert = require('node:assert/strict');
const test = require('node:test');

test('station platforms and bus lanes retain legal access independently of grade', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { BUS, CAR, VAN, VEHICLE_CLEARANCE, fitsRoad } = await import('../js/road-access.js');
  const roads = new Map(EDE_DATA.roads.map(road => [road.id, road]));
  assert.deepEqual(roads.get('w455683512').modes, [BUS, 0]);
  assert.deepEqual(roads.get('w1054198063').modes, [BUS, 0]);
  assert.equal(roads.get('w1231194487').modes[0], BUS);
  assert.equal(roads.get('w1254180373').modes[0], CAR | VAN | BUS);
  assert.deepEqual(roads.get('w1156964960').laneModes[0], [7, 7, 7, BUS]);
  assert.deepEqual(roads.get('w6921108').laneModes[0], [7, BUS]);
  const forecourt = roads.get('w1231194473');
  assert.equal(forecourt.limits.length, 10);
  assert.ok(fitsRoad(VEHICLE_CLEARANCE.bus, forecourt.limits, BUS));
  const tunnel = roads.get('w6952984');
  assert.equal(tunnel.tunnel, true);
  assert.equal(tunnel.layer, -1);
  assert.equal(tunnel.modes[0], CAR | VAN | BUS);
  assert.equal(tunnel.limits.height, 4.1);
});

test('active-travel routes connect at shared endpoints and preserve crossings on separate levels', async () => {
  const { buildEdeActiveTravel } = await import('../js/ede-active-travel.js');
  const { BICYCLE, FOOT } = await import('../js/road-access.js');
  const activeGraph = {
    nodes: [-6, 0, 6, 0, 0, -6, 0, 6, 18, 0],
    links: [[0, 1, 0, 3, 1, 0, [], 0, [0]], [2, 3, 0, 3, 1, 0, [], 1, [0]], [1, 4, 0, 3, 1, 0, [], 2, [0]]]
  };
  const path = (id, modes, layer) => ({
    id, modes, layer, width: 3,
    cycle: modes.some(mask => mask & BICYCLE) ? [{
      offset: 0, width: 3, kind: 'path', allowed: modes.map(mask => !!(mask & BICYCLE))
    }] : []
  });
  const roads = [path('cycleway', [BICYCLE, BICYCLE], 0), path('footbridge', [FOOT, FOOT], 1), path('one-way', [BICYCLE, 0], 0)];
  const router = buildEdeActiveTravel({ activeGraph, roads });
  const bikes = [], people = [];
  router.bikes(0, 0, 25, bikes);
  router.foot(0, 0, 25, people);
  const [cycleway, oneWay] = bikes;
  assert.deepEqual(cycleway.links[1], [[{ track: oneWay, dir: 1 }]]);
  assert.deepEqual(oneWay.links, [[], []]);
  assert.equal(people[0].wayId, 'footbridge');
  assert.deepEqual(people[0].links, [[], []]);
});
