const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');

const asset = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets/ede-road-surfaces.json.gz'))));

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
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(asset)));
  const { gradePavement, loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  await loadEdeRoadSurfaces();
  const section = { a: { x: -3.270067786, z: 2040.3691188 }, b: { x: -3.48, z: 2037.64 } };
  assert.equal(gradePavement(section, -1, 'foot')?.material, 'tile');
  assert.equal(gradePavement(section, 0, 'foot'), undefined);
  assert.equal(gradePavement(section, -1, 'motor'), undefined);
});

test('both Raadhuisstraat covered carriageways use the continuous mapped asphalt', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(asset)));
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { hasEdeMappedSurface, loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  await loadEdeRoadSurfaces();
  for (const id of ['w274278314', 'w274278316']) {
    const road = EDE_DATA.roads.find(road => road.id === id);
    const [ax, az, bx, bz] = road.pts;
    assert.ok(hasEdeMappedSurface({ road, a: { x: ax, z: az }, b: { x: bx, z: bz }, segmentIndex: 0 }));
  }
});

test('roadside pole clearance respects ground BGT road, cycle and driveway polygons', async t => {
  const { isEdeTrafficPavement, loadEdeRoadSurfaces } = await import('../js/ede-road-surfaces.js');
  const square = x => [x, 0, x + 5, 0, x + 5, 5, x, 5];
  const surfaces = ['rijbaan lokale weg', 'fietspad', 'inrit', 'voetpad', 'rijbaan lokale weg']
    .map((kind, i) => ({ function: kind, layer: i === 4 ? 1 : 0, polygons: [[square(i * 10)]] }));
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ version: 1, covered: {}, surfaces })));
  await loadEdeRoadSurfaces();
  assert.deepEqual([2, 12, 22, 32, 42].map(x => isEdeTrafficPavement(x, 2)),
    [true, true, true, false, false]);
});
