const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

const file = join(__dirname, '../assets/ede-street-features.json.gz');

test('street furniture indexes all three types, in travel order, without mixing the reverse direction', async () => {
  const { indexStreetFeatures, streetRoadKey, streetPathKey } = await import('../js/ede-street-features.js');
  const edge = { from: { x: 0, z: 0 }, to: { x: 20, z: 0 }, wayId: 'w42', layer: -1 };
  const reverse = { ...edge, from: edge.to, to: edge.from };
  const path = { ax: 8, az: 4, ux: 0, uz: -1, len: 8, wayId: 'w77', layer: -1 };
  const link = (key, from, to, modes) => ({ key, from, to, modes, layer: -1, confidence: 0.9 });
  const road = streetRoadKey(edge);
  const asset = indexStreetFeatures({
    version: 1,
    signs: [{ id: 'start', edges: [link(road, 2, 2, 7)] }],
    bumps: [{ id: 'hump', edges: [link(road, 8, 12, 7), link(streetRoadKey(reverse), 8, 12, 7)] }],
    crossings: [{ id: 'zebra', edges: [link(road, 6, 8, 7), link(streetPathKey(path, 1, 16), 1, 7, 16)] }]
  });
  assert.deepEqual(asset.forRoad(edge).map(({ type }) => type), ['sign', 'crossing', 'bump']);
  assert.deepEqual(asset.forRoad(reverse).map(({ type }) => type), ['bump']);
  assert.deepEqual(asset.forPath(path, 1, 16).map(({ type }) => type), ['crossing']);
  assert.equal(asset.forPath(path, -1, 16).length, 0);
  assert.equal(asset.forEdge(road)[2].to, 12);
  assert.equal(asset.byId('start').id, 'start');
});

test('the checked-in Ede snapshot links the one-way sign, raised zebra, signal crossing and tunnel approach', async () => {
  const { indexStreetFeatures } = await import('../js/ede-street-features.js');
  const dataset = indexStreetFeatures(JSON.parse(gunzipSync(readFileSync(file))));
  const sign = dataset.byId('3eb60732-5636-4490-9321-7bb1f4d4ad77');
  assert.equal(sign.rvvCode, 'C3');
  assert.equal(sign.edges.length, 1);
  assert.equal(dataset.forEdge(sign.edges[0].key).find(m => m.feature === sign).type, 'sign');
  const raised = dataset.byId('ndw-vop-22686');
  const table = dataset.byId(raised.bumpId);
  assert.equal(table.profile, 'table');
  assert.ok(table.height > 0.05 && table.edges.some(e => e.to > e.from));
  assert.ok(raised.marked && raised.sidewalks.every(endpoint => endpoint.edges.length));
  assert.ok(raised.edges.some(({ key, modes }) => modes & 7 && dataset.forEdge(key)
    .some(m => m.feature === raised && m.type === 'crossing')));
  assert.ok(raised.edges.some(({ key, modes }) => modes === 16 && dataset.forEdge(key)
    .some(m => m.feature === raised && m.type === 'crossing')));

  const signal = dataset.byId('osm-crossing-n270772153');
  assert.equal(signal.control, 'signal');
  assert.equal(signal.marked, false);
  assert.ok(signal.refuge && signal.edges.length > 1);
  assert.deepEqual(new Set(signal.edges.filter(edge => edge.modes & 7).map(edge => edge.way)),
    new Set(['w1024971611', 'w25710949']));
  const gradeSign = dataset.byId('9f1e915b-2a03-43fe-a043-38b084636f4f');
  assert.equal(gradeSign.renderWay, 'w25710948');
  assert.equal(gradeSign.sourceLayer, -1);
  assert.equal(gradeSign.edges[0].layer, 0);
});
