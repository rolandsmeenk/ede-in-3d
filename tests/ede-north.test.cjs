const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

const packed = file => JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets', file))));

test('the northern map keeps surviving OSM IDs and valid graph links after municipal clipping', async () => {
  const { EDE_DATA: map } = await import('../js/ede-geodata.js');
  const base = packed('ede-map-v1.json.gz');
  const corridors = packed('ede-corridors-v1.json.gz');
  const north = packed('ede-north-v1.json.gz');
  const completion = packed('ede-complete-v1.json.gz');
  const boundary = completion.municipality;
  const { edeCoverage } = await import('../js/ede-coverage.js');
  assert.ok(map.meta.north && map.meta.fullMunicipality);
  assert.deepEqual(map.meta.geographicBounds, edeCoverage.geographicBounds);
  assert.deepEqual(map.meta.playableBoundary, edeCoverage.playableBoundary);
  assert.deepEqual(map.meta.baseBounds, base.meta.bounds);
  for (const key of ['roads', 'buildings']) {
    const changes = new Map(boundary.layers[key].changes);
    const merged = [...base[key], ...corridors[key], ...north[key]];
    for (const [i, row] of completion.layers[key].replace) merged[i] = row;
    merged.push(...completion.layers[key].add);
    const retained = merged.flatMap((row, index) => changes.get(index) ?? [row]);
    assert.deepEqual(map[key].map(row => row.id), retained.map(row => row.id));
    assert.equal(new Set(map[key].map(row => row.id)).size, map[key].length);
  }
  for (const key of ['roadGraph', 'activeGraph']) {
    const { nodes, names, links } = map[key];
    assert.deepEqual(names, completion.graphs[key].names);
    for (const [a, b, name, , , , , road] of links) {
      assert.ok(a >= 0 && a * 2 < nodes.length);
      assert.ok(b >= 0 && b * 2 < nodes.length);
      assert.ok(name >= 0 && name < names.length);
      assert.ok(map.roads[road]);
    }
  }
});

test('the official Ede outline excludes Veenendaal but includes De Klomp and Wekerom', async () => {
  const { EDE_DATA: map } = await import('../js/ede-geodata.js');
  const { projectLonLat, TELEPORT_LOCATIONS } = await import('../js/city-config.js');
  const { containsPlayablePoint, constrainToPlayableArea } = await import('../js/ede-playable-boundary.js');
  assert.equal(map.meta.municipality.id, 'GM0228');
  const west = projectLonLat(5.57, 52.032);
  assert.equal(containsPlayablePoint(west.x, west.z), false);
  assert.ok(!map.parks.some(park => park.name === 'Evenemententerrein Veenendaal'));
  const edge = constrainToPlayableArea(west.x, west.z);
  assert.ok(containsPlayablePoint(edge.x, edge.z));
  for (const id of ['veenendaal-de-klomp', 'station-lunteren', 'kulturhus-wekerom']) {
    const { x, z } = TELEPORT_LOCATIONS[id];
    assert.ok(containsPlayablePoint(x, z), id);
  }
});

test('Lunteren approaches connect to Ede using mapped directions and reserve access', async () => {
  const { EDE_DATA: map, projectLonLat, TELEPORT_LOCATIONS: arrivals } = await import('../js/city-config.js');
  const { CAR, FOOT, BICYCLE, MOTOR } = await import('../js/road-access.js');
  const roads = new Map(map.roads.map(road => [road.id, road]));
  assert.deepEqual(roads.get('w912165168').modes, [0, 0]);
  assert.ok(roads.get('w68678293').modes.every(m => (m & FOOT) && !(m & (BICYCLE | MOTOR))));
  assert.ok(roads.get('w223211383').modes.every(m => (m & FOOT) && (m & BICYCLE) && !(m & MOTOR)));
  assert.ok(map.northStreetDetail.some(f => f.id === 'w1530443258' && f.level === 0 && f.collidable));

  function verifyRoutes(graph, mode, start, destinations) {
    const edges = new Map();
    for (const [a, b, , , , , , index] of graph.links) {
      for (const [from, to, direction] of [[a, b, 0], [b, a, 1]]) {
        if (!(map.roads[index].modes[direction] & mode)) continue;
        if (!edges.has(from)) edges.set(from, []);
        edges.get(from).push(to);
      }
    }
    const distance = (node, { x, z }) => Math.hypot(graph.nodes[node * 2] - x, graph.nodes[node * 2 + 1] - z);
    for (const [from, to] of destinations.flatMap(point => [[start, point], [point, start]])) {
      const origin = [...edges.keys()].reduce((a, b) => distance(a, from) < distance(b, from) ? a : b);
      assert.ok(distance(origin, from) < 60, JSON.stringify(from));
      const reached = new Set([origin]);
      for (const node of reached) for (const neighbor of edges.get(node) ?? []) reached.add(neighbor);
      assert.ok([...reached].some(node => distance(node, to) < 60), JSON.stringify(to));
    }
  }
  const ede = projectLonLat(5.65, 52.06);
  verifyRoutes(map.roadGraph, CAR, ede, [arrivals['lunteren-centrum'], arrivals['kulturhus-wekerom']]);
  verifyRoutes(map.activeGraph, FOOT, arrivals['lunteren-centrum'], [
    arrivals['station-lunteren'], arrivals.goudsberg, arrivals['wekeromse-zand'], arrivals['de-valouwe'],
    arrivals['kulturhus-wekerom'],
  ]);
  verifyRoutes(map.activeGraph, BICYCLE, ede, [arrivals['lunteren-centrum']]);
});

test('motor, pedestrian and bicycle networks connect through the old cutoff into Bennekom and Harskamp', async () => {
  const { EDE_DATA: map } = await import('../js/ede-geodata.js');
  const { CAR, BICYCLE, FOOT } = await import('../js/road-access.js');
  const { containsPlayablePoint } = await import('../js/ede-playable-boundary.js');
  const oldBounds = packed('ede-north-v1.json.gz').bounds;
  const destinations = map.meta.areas.filter(({ name, place }) => place && (name === 'Bennekom' || name === 'Harskamp'));
  assert.equal(destinations.length, 2);
  for (const { labelPoint: [x, z] } of destinations) {
    assert.ok(x < oldBounds[0] || x > oldBounds[2] || z < oldBounds[1] || z > oldBounds[3]);
    assert.ok(containsPlayablePoint(x, z));
  }
  for (const [graph, mode] of [[map.roadGraph, CAR], [map.activeGraph, BICYCLE], [map.activeGraph, FOOT]]) {
    const adjacency = new Map();
    for (const [a, b, , , , , , road] of graph.links) {
      for (const [from, to, direction] of [[a, b, 0], [b, a, 1]]) {
        if (!(map.roads[road].modes[direction] & mode)) continue;
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from).push(to);
      }
    }
    const distance = (id, x, z) => Math.hypot(graph.nodes[id * 2] - x, graph.nodes[id * 2 + 1] - z);
    const origin = [...adjacency.keys()].reduce((a, b) => distance(a, 0, 0) < distance(b, 0, 0) ? a : b);
    const reached = new Set([origin]);
    for (const id of reached) for (const neighbor of adjacency.get(id) ?? []) reached.add(neighbor);
    for (const { name, labelPoint: [x, z] } of destinations) {
      assert.ok([...reached].some(id => distance(id, x, z) < 65), `${name} is disconnected for mode ${mode}`);
    }
  }
});

test('measured crowns supply grounded tree sizes near northern woodland arrivals', async () => {
  const trees = JSON.parse(readFileSync(join(__dirname, '../assets/ede-forest-canopy/manifest.json'))).northernTreeSamples;
  const { TELEPORT_LOCATIONS: arrivals, ISLAND_BOUNDS: bounds } = await import('../js/city-config.js');
  for (const [x, z, height] of trees) {
    assert.ok(x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z < -3780);
    assert.ok(height >= 4 && height <= 40);
  }
  for (const id of ['de-koepel', 'goudsberg', 'hessenhut', 'de-valouwe']) {
    const { focus } = arrivals[id];
    assert.ok(trees.filter(([x, z]) => Math.hypot(x - focus.x, z - focus.z) < 120).length >= 12, id);
  }
});

test('motor, walking and cycling networks cross from Ede into the 500 m collar', async () => {
  const { EDE_DATA: map } = await import('../js/ede-geodata.js');
  const { createCoverageIndex, edeCoverage } = await import('../js/ede-coverage.js');
  const { CAR, BICYCLE, FOOT } = await import('../js/road-access.js');
  assert.deepEqual(map.meta.travelBoundary, edeCoverage.buildingBoundary);

  const municipality = createCoverageIndex(edeCoverage.playableBoundary);
  const travel = createCoverageIndex(edeCoverage.buildingBoundary);
  for (const [graph, mode] of [[map.roadGraph, CAR], [map.activeGraph, BICYCLE], [map.activeGraph, FOOT]]) {
    const links = new Map();
    for (const [a, b, , , , , , road] of graph.links) {
      for (const [from, to, direction] of [[a, b, 0], [b, a, 1]]) {
        if (!(map.roads[road].modes[direction] & mode)) continue;
        if (!links.has(from)) links.set(from, []);
        links.get(from).push(to);
      }
    }
    const position = id => [graph.nodes[id * 2], graph.nodes[id * 2 + 1]];
    const distance = id => Math.hypot(...position(id));
    const start = [...links.keys()].reduce((a, b) => distance(a) < distance(b) ? a : b);
    const seen = new Set([start]);
    for (const id of seen) for (const neighbor of links.get(id) ?? []) seen.add(neighbor);
    assert.ok([...seen].some(id => {
      const [x, z] = position(id);
      return !municipality.contains(x, z) && travel.contains(x, z);
    }), `No exterior collar connections for mode ${mode}`);
  }
});
