const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

test('bike facilities follow the mapped side, direction and access', async () => {
  const { cycleFacilities, roadAccess } = await import('../tools/ede-road-access.mjs');
  const { BICYCLE } = await import('../js/road-access.js');
  const lanes = (tags, evidence, match) => {
    const t = { highway: 'residential', ...tags };
    return cycleFacilities(t, roadAccess(1, t, match, evidence).modes, 8, evidence, match);
  };
  assert.deepEqual(lanes({}), []);
  assert.deepEqual(lanes({ 'cycleway:both': 'shared_lane' }), []);
  assert.deepEqual(lanes({ 'cycleway:both': 'lane', 'cycleway:both:lane': 'advisory' }), []);
  assert.deepEqual(lanes({ 'cycleway:both': 'lane', bicycle: 'dismount' }), []);
  const strip = { cycleStrip: [true, false] };
  assert.deepEqual(lanes({ cycleway: 'lane' }, null, strip).map(lane => lane.allowed), [[true, false]]);
  assert.equal(lanes({ cycleway: 'lane' }, null, { cycleStrip: [false, false] }).length, 2);
  assert.equal(lanes({ cycleway: 'lane' }, null, { ...strip, cycleStripStale: true }).length, 2);
  assert.equal(lanes({ 'cycleway:both': 'lane' }, null, strip).length, 2);
  for (const structure of [{ bridge: 'yes' }, { tunnel: 'yes' }, { covered: 'yes' }, { layer: '-1' }]) {
    assert.equal(lanes({ cycleway: 'lane', ...structure }, null, strip).length, 2);
  }
  assert.deepEqual(lanes({ cycleway: 'lane', 'cycleway:lane': 'advisory' }, null, strip), []);
  const left = lanes({ oneway: 'yes', 'cycleway:left': 'lane', 'cycleway:left:oneway': '-1' });
  assert.ok(left[0].offset < 0);
  assert.deepEqual(left[0].allowed, [false, true]);
  const right = lanes({ 'cycleway:right': 'track', 'cycleway:right:oneway': 'no' });
  assert.ok(right[0].offset > 4);
  assert.deepEqual(right[0].allowed, [true, true]);
  const bgt = { kind: 'cycle', width: 3.2 };
  const wkd = { 0: { fiets: 'J' }, 1: { fiets: 'N' } };
  assert.deepEqual(lanes({ highway: 'path' }, bgt, wkd), [{ offset: 0, width: 3.2, allowed: [true, false], kind: 'path' }]);
  assert.ok(!(roadAccess(1, { highway: 'path', bicycle: 'no' }, wkd, bgt).modes[0] & BICYCLE));
});

test('official WKD strip evidence matches geometry and respects the source date', async () => {
  const { readWkd } = await import('../tools/ede-road-access.mjs');
  const source = join(__dirname, '../tools/data/ede-wkd-cycle-strips.json');
  const extract = JSON.parse(readFileSync(source));
  const points = extract.features.find(f => f.properties.fts_sug_h === '1' && f.properties.fts_sug_t === '0').geometry.coordinates;
  const project = (lon, lat) => [lon * 68000, lat * -111000];
  const route = points.map(([lon, lat]) => project(lon, lat));
  const fresh = readWkd(null, project, source, new Date('2026-11-19'));
  assert.deepEqual(fresh(route).cycleStrip, [true, false]);
  assert.deepEqual(fresh(route.slice().reverse()).cycleStrip, [false, true]);
  assert.equal(fresh(route).cycleStripStale, false);
  assert.equal(readWkd(null, project, source, new Date('2028-01-19'))(route).cycleStripStale, true);
  assert.equal(readWkd(null, project, source + '.absent')(route).cycleStrip, undefined);
});

test('pedestrian obstacles are respected and the two sidewalks meet only at a mapped crossing', async () => {
  const { buildEdeActiveTravel } = await import('../js/ede-active-travel.js');
  const { CAR, FOOT } = await import('../js/road-access.js');
  const road = { id: 'street', pts: [-10, 0, 10, 0], modes: [CAR | FOOT, CAR | FOOT], layer: 0, width: 5 };
  const activeGraph = {
    nodes: [-10, 0, 0, 0, 10, 0],
    links: [[0, 1, 0, 5, 1, 0, [], 0, [-4, 4]], [1, 2, 0, 5, 1, 0, [], 0, [-4, 4]]],
    controls: { 1: { x: 0, z: 0, osmId: 12, control: 'signal', markings: 'zebra' } }
  };
  const signal = { x: 0, z: 0, signal: true, in: [{ wayId: 'street', inArm: { group: 1 } }], out: [] };
  const route = buildEdeActiveTravel({ activeGraph, roads: [road] }, null, {
    motorNodes: [signal], walkable: (minX, maxX, minZ, maxZ) => !(minX < 6 && maxX > 5 && minZ < 5 && maxZ > 3)
  });
  const people = [];
  route.foot(0, 0, 20, people);
  const crossings = people.filter(t => t.crossing);
  assert.equal(crossings.length, 1);
  assert.equal(crossings[0].crossing.signal, signal);
  assert.equal(crossings[0].crossing.axisIndex, 1);
  assert.equal(crossings[0].crossing.markings, 'zebra');
  assert.equal(crossings[0].noSpawn, true);
  const left = people.find(t => t.az < 0 && t.ax < 0);
  assert.ok(left.links[1].some(path => path[0].track === crossings[0] && path.at(-1).track.az > 0));
  buildEdeActiveTravel({ activeGraph: { ...activeGraph, controls: {} }, roads: [road] }).foot(0, 0, 20, people);
  assert.ok(people.every(t => !t.crossing));
  assert.ok(people.find(t => t.az < 0 && t.ax < 0).links[1].every(path => path.at(-1).track.az < 0));
});

test('the checked-in Ede graph joins shopping streets and squares and preserves the Parkweidepad underpass', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { buildEdeActiveTravel } = await import('../js/ede-active-travel.js');
  const grade = JSON.parse(readFileSync(join(__dirname, '../assets/ede-grade.json')));
  const roads = new Map(EDE_DATA.roads.map(road => [road.id, road]));
  const narrowed = roads.get('w1480777191');
  assert.deepEqual(narrowed.wkdCycleStrip, [true, false]);
  assert.deepEqual(narrowed.cycle.map(lane => lane.allowed), [[true, false]]);
  const advisory = roads.get('w6953149');
  assert.deepEqual(advisory.wkdCycleStrip, [true, true]);
  assert.equal(advisory.cycle, undefined);
  const router = buildEdeActiveTravel(EDE_DATA, grade);
  const { sidewalkAt } = await import('../js/city-config.js');
  assert.equal(sidewalkAt(-58.11, -207.70), sidewalkAt(-59.19, -217.38));
  assert.notEqual(sidewalkAt(-58.11, -207.70), sidewalkAt(-49.17, -208.70));
  const foot = [];
  router.foot(0, 170, 450, foot);
  const visited = new Set(), walk = foot.filter(t => t.wayId === 'w6953320');
  for (const track of walk) visited.add(track);
  for (let i = 0; i < walk.length; i++) {
    for (const route of walk[i].links.flat()) {
      for (const { track } of route) {
        if (visited.has(track)) continue;
        visited.add(track);
        walk.push(track);
      }
    }
  }
  for (const id of ['w6953331', 'w6953482', 'w6953344']) assert.ok(walk.some(t => t.wayId === id), id);
  for (const id of ['r2756916', 'r9701784']) assert.ok(walk.some(t => t.areaId === id), id);
  assert.ok(foot.some(t => t.crossing?.osmId === 1517560422 && t.crossing.markings === 'zebra'));
  assert.ok(router.destinations.some(d => d.kind === 'square' && d.name === 'Markt'));
  const shop = router.destinations.find(d => d.kind === 'shop' && d.name === 'Just For Feet');
  assert.ok(shop);
  const byShop = [];
  router.foot(shop.x, shop.z, 0.2, byShop);
  assert.ok(byShop.some(t => t.wayId === 'w6953482' || t.wayId === 'w6953344'));

  const bikes = [];
  router.bikes(-1875, -465, 90, bikes);
  const tunnel = bikes.filter(t => t.wayId === 'w363124901');
  assert.ok(tunnel.length > 0);
  assert.ok(tunnel.every(t => t.layer === -1 && !t.crossing && t.exclusive));
  assert.ok(tunnel.some(t => t.links.flat(2).some(leg => leg.track.wayId === 'w363124902')));
  router.bikes(0, 0, 10000, bikes);
  assert.ok(bikes.every(t => ['lane', 'path', 'track'].includes(t.kind)));
  assert.ok(bikes.every(t => !['w6953149', 'w6954746', 'w6953331'].includes(t.wayId)));
});

test('mountain bikers use the four signed routes and keep their travel direction at junctions', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { buildEdeActiveTravel } = await import('../js/ede-active-travel.js');
  const { EDE_MTB_ROUTES } = await import('../js/ede-mtb-routes.js');
  const grade = JSON.parse(readFileSync(join(__dirname, '../assets/ede-grade.json')));
  const travel = buildEdeActiveTravel(EDE_DATA, grade);
  const trailTracks = [];
  travel.mountainBikes(0, 0, 18000, trailTracks);
  const signed = new Set(EDE_MTB_ROUTES.flat());
  const turns = new Set(EDE_MTB_ROUTES.flatMap(route => route.map((way, i) => `${way}/${route[(i + 1) % route.length]}`)));
  const wayId = track => Number(track.wayId.slice(1));
  const trackWays = new Set(trailTracks.map(wayId));
  for (const route of EDE_MTB_ROUTES) {
    assert.ok(route.filter(way => trackWays.has(Math.abs(way))).length > route.length * 0.8);
  }
  assert.ok(trailTracks.some(track => track.crossing && track.noSpawn));
  assert.ok(trailTracks.reduce((length, track) => length + track.len, 0) > 70000);
  for (const track of trailTracks) {
    assert.ok(track.mountain);
    for (let end = 0; end < 2; end++) {
      const from = (end ? 1 : -1) * wayId(track);
      if (track.allowed[1 - end]) assert.ok(signed.has(from));
      for (const path of track.links[end]) {
        assert.ok(path.every(leg => leg.track.mountain));
        const next = path.at(-1);
        const to = next.dir * wayId(next.track);
        assert.ok(signed.has(to));
        assert.ok(from === to || turns.has(`${from}/${to}`));
      }
    }
  }
  const regular = [];
  travel.bikes(0, 0, 18000, regular);
  assert.ok(regular.every(track => !track.mountain));
});
