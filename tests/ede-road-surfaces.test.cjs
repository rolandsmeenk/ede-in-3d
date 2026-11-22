const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');

const packed = name => JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets', name))));
const asset = packed('ede-road-surfaces.json.gz');
const extension = packed('ede-corridor-paving.json.gz');
const mockedSurfaces = async (url) => new Response(JSON.stringify(
  url.pathname.endsWith('/ede-corridor-paving.json.gz') ? extension : asset));

test('the same Kernhem street keeps its mapped asphalt to fired-brick change', () => {
  const materials = [
    ['G0228.fe246f2dda96d6d6e0400a0a35020533', 'asfalt', 'gesloten verharding', 'asphalt'],
    ['G0228.fe246f49d190d6d6e0400a0a35020533', 'gebakken klinkers', 'open verharding', 'brick']
  ];
  for (const [id, detail, broad, material] of materials) {
    const mapped = asset.surfaces.find(surface => surface.id === id);
    assert.equal(mapped.plus_fysiek_voorkomen, detail);
    assert.equal(mapped.fysiek_voorkomen, broad);
    assert.equal(mapped.material, material);
    assert.equal(mapped.resolution, 'bgt-detail');
    assert.equal(mapped.layer, 0);
    assert.ok(mapped.polygons[0][0].length >= 6);
  }
  assert.ok(asset.covered.w6954444.includes(0));
});

test('Ede retains each paving class, and grade-separated data cannot suppress a ground fallback', () => {
  for (const material of ['asphalt', 'brick', 'block', 'tile', 'concrete', 'gravel', 'sand']) {
    assert.ok(asset.counts[material] > 0, material);
  }
  assert.ok(asset.surfaces.some(surface => surface.layer > 0));
  assert.ok(asset.surfaces.some(surface => surface.layer < 0));
  assert.ok(!Object.hasOwn(asset.covered, 'w6960078')); // A30 bridge above the railway.
  assert.ok(!Object.hasOwn(asset.covered, 'w6952984')); // Albertstunnel below the railway.
});

test('generic BGT materials only use compatible OSM ways', () => {
  const taggedUnpaved = asset.surfaces.find(surface => surface.id === 'G0228.2632250f3b2947028cd6e4e14f6c4823');
  assert.equal(taggedUnpaved.resolution, 'osm-compatible');
  assert.ok(taggedUnpaved.osm.some(([wayId, surface]) => wayId.startsWith('w') && surface));
  const conflictingPavers = asset.surfaces.find(surface => surface.id === 'G0228.56d59cdb124748958efa0b3d308abb1e');
  assert.equal(conflictingPavers.resolution, 'bgt-general');
  assert.equal(conflictingPavers.material, 'gravel');
});

test('Westtunnel gets BGT tiles only on its fitted lower pedestrian section', async t => {
  t.mock.method(globalThis, 'fetch', mockedSurfaces);
  const { gradePavement, loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  await loadEdeRoadSurfaces();
  const section = { a: { x: -3.270067786, z: 2040.3691188 }, b: { x: -3.48, z: 2037.64 } };
  assert.equal(gradePavement(section, -1, 'foot')?.material, 'tile');
  assert.equal(gradePavement(section, 0, 'foot'), undefined);
  assert.equal(gradePavement(section, -1, 'motor'), undefined);
});

test('both Raadhuisstraat covered carriageways use the continuous mapped asphalt', async t => {
  t.mock.method(globalThis, 'fetch', mockedSurfaces);
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { hasEdeMappedSurface, loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  await loadEdeRoadSurfaces();
  for (const id of ['w274278314', 'w274278316']) {
    const road = EDE_DATA.roads.find(road => road.id === id);
    const [ax, az, bx, bz] = road.pts;
    assert.ok(hasEdeMappedSurface({ road, a: { x: ax, z: az }, b: { x: bx, z: bz }, segmentIndex: 0 }));
  }
});

test('N224 lane markings and traffic follow the paved bend east of Ginkelse Heide', async t => {
  t.mock.method(globalThis, 'fetch', mockedSurfaces);
  const { buildRoadNetwork } = await import('../js/road-network.js');
  const { isEdeTrafficPavement, loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  await loadEdeRoadSurfaces();
  const { paintEdges, edges } = buildRoadNetwork([], []);
  const wayId = 'w6850904';
  const east = paintEdges.filter(edge => edge.wayId === wayId && edge.direction === 0);
  assert.ok(east.length && east[0].from.x < 4600 && east.at(-1).to.x > 8100);
  let samples = 0;
  for (const edge of east) {
    for (let s = 0; s < edge.span; s += 10) {
      const x = edge.x0 + edge.dx * s, z = edge.z0 + edge.dz * s;
      if (x < 4700 || x > 7600) continue;
      assert.ok(isEdeTrafficPavement(x, z), `N224 divider at ${x}, ${z}`);
      samples++;
    }
  }
  assert.ok(samples > 280);
  const lanes = edges.filter(edge => edge.wayId === wayId && edge.direction === 0);
  assert.equal(lanes.length, east.length);
  for (let i = 1; i < lanes.length; i++) {
    assert.ok(lanes[i - 1].moves.some(move => move.to === lanes[i]), 'traffic can continue east around the curve');
  }
});

test('the Hilgers and Valenberg cycleways use surveyed BGT asphalt footprints', async t => {
  t.mock.method(globalThis, 'fetch', mockedSurfaces);
  const { isEdeTrafficPavement, loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  await loadEdeRoadSurfaces();
  for (const id of ['G0228.cd612b91460c465ea242dc97a8ffc412', 'G0228.fe246f498667d6d6e0400a0a35020533']) {
    const surface = extension.surfaces.find(item => item.id === id);
    assert.equal(surface?.function, 'fietspad');
    assert.equal(surface.material, 'asphalt');
    assert.equal(surface.layer, 0);
  }
  assert.ok(extension.covered.w109378838?.length);
  assert.deepEqual(extension.covered.w1013523963, [0, 1, 2, 3]);
  assert.ok(isEdeTrafficPavement(404, -2506.75));
  assert.ok(isEdeTrafficPavement(4523.2, -2741.1));
});

test('roadside pole clearance respects ground BGT road, cycle and driveway polygons', async t => {
  const { isEdeTrafficPavement, loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  const square = x => [x, 0, x + 5, 0, x + 5, 5, x, 5];
  const surfaces = ['rijbaan lokale weg', 'fietspad', 'inrit', 'voetpad', 'rijbaan lokale weg']
    .map((kind, i) => ({ function: kind, layer: i === 4 ? 1 : 0, polygons: [[square(i * 10)]] }));
  t.mock.method(globalThis, 'fetch', async url => url.pathname.endsWith('/ede-corridor-paving.json.gz') ?
    new Response(null, { status: 404 }) : new Response(JSON.stringify({ version: 1, covered: {}, surfaces })));
  await loadEdeRoadSurfaces();
  assert.deepEqual([2, 12, 22, 32, 42].map(x => isEdeTrafficPavement(x, 2)),
    [true, true, true, false, false]);
});


test('paving coverage keeps segment indices shared by the core and outer surveys', async t => {
  const { loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.pathname.endsWith('/ede-corridor-paving.json.gz')) return new Response(null, { status: 404 });
    const indices = url.pathname.endsWith('/ede-north-paving.json.gz') ? [1, 2] : [0, 1];
    return new Response(JSON.stringify({ version: 1, covered: { w1: indices }, surfaces: [] }));
  });
  const result = await loadEdeRoadSurfaces({ north: true });
  assert.deepEqual(result.covered.w1, [0, 1, 2]);
});
