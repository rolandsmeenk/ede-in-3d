const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

test('rural paths connect the mill and eastern destinations using their mapped access', async () => {
  const { EDE_DATA: data } = await import('../js/ede-geodata.js');
  const { projectLonLatInto } = await import('../js/ede-scene-coordinates.js');
  const { BICYCLE, FOOT, MOTOR } = await import('../js/road-access.js');
  const { activeGraph: graph, roads } = data;
  const project = ([lon, lat]) => projectLonLatInto(data.meta.lonLatAffine, lon, lat, {});
  const [, , ginkel, mossel, planken] = data.meta.corridorDetail.arrivals;
  const mill = data.meta.corridorDetail.arrivals[0];

  for (const mode of [FOOT, BICYCLE]) {
    const adjacency = new Map();
    for (const [a, b, , , , , , roadIndex] of graph.links) {
      const road = roads[roadIndex];
      for (const [from, to, direction] of [[a, b, 0], [b, a, 1]]) {
        if (!(road.modes[direction] & mode)) continue;
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from).push(to);
      }
    }
    const distance = (node, [x, z]) => Math.hypot(graph.nodes[node * 2] - x, graph.nodes[node * 2 + 1] - z);
    function connected(start, destinations) {
      const nearest = [...adjacency.keys()].reduce((a, b) => distance(a, start) <= distance(b, start) ? a : b);
      assert.ok(distance(nearest, start) < 50);
      const visited = new Set([nearest]);
      for (const node of visited) for (const next of adjacency.get(node) || []) visited.add(next);
      for (const target of destinations) assert.ok([...visited].some(node => distance(node, target) < 50), String(target));
    }
    const { x: mx, z: mz } = project([5.648, 52.056]);
    const { x: gx, z: gz } = project([5.687, 52.054]);
    connected([mx, mz], [mill]);
    connected([gx, gz], [ginkel]);
    connected(ginkel, [mossel, planken]);
  }

  const mosselseweg = roads.filter(road => road.name === 'Mosselseweg' && road.kind === 'track');
  assert.ok(mosselseweg.length > 0);
  assert.ok(mosselseweg.every(road => !((road.modes[0] | road.modes[1]) & MOTOR)));
});

test('the De Klomp timetable uses the mapped rail platforms and scheduled bus stops', async () => {
  const { buildEdeTrainTracks } = await import('../js/ede-train-tracks.js');
  const { paths } = buildEdeTrainTracks();
  for (const [id, platform] of [['main-5-east', '2'], ['main-3-west', '1']]) {
    const path = paths.find(path => path.id === id);
    const stop = path.stops['de-klomp'];
    assert.equal(stop?.platform, platform);
    assert.ok(path.sample(stop.distance).x < -6500);
  }

  const busses = JSON.parse(readFileSync(join(__dirname, '../assets/ede-bus-routes.json')));
  const variants = busses.variants.filter(variant => variant.line === '3' &&
    variant.stops.some(stop => stop.name.includes('Station De Klomp')));
  assert.ok(variants.length >= 2);
  for (const variant of variants) {
    assert.ok(variant.stops.filter(stop => stop.name.includes('Station De Klomp')).every(stop => stop.matched),
      variant.id);
  }
});
