const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');

const asset = name => JSON.parse(gunzipSync(readFileSync(join(__dirname, '..', 'assets', name))));

test('the corrected shoreline is shared by map layers, park geometry and movement', async () => {
  const { EDE_DATA, pointInPoly, roadCrossesWater, toPts, waterAt, waterAtExact } = await import('../js/city-config.js');
  const { GEO } = await import('../js/nyc-geodata.js');
  const { FRANKENENG_DOWNSTREAM } = await import('../js/ede-water-levels.js');
  const { water, land } = asset('ede-shorelines.json.gz');
  const original = asset('ede-map-v1.json.gz');
  const activeWater = [...water.filter(({ id }) => id !== 'water171'), FRANKENENG_DOWNSTREAM];
  const changes = new Map(asset('ede-complete-v1.json.gz').municipality.layers.water.changes);
  const playableWater = activeWater.flatMap(row => changes.get(row.id) ?? [row]);
  assert.deepEqual(EDE_DATA.water.slice(0, playableWater.length), playableWater);
  assert.equal(EDE_DATA.meta.counts.water, EDE_DATA.water.length);
  assert.ok(EDE_DATA.water.slice(playableWater.length).every(feature =>
    /^(?:(?:corridor|north)-water|osm-water-)/.test(feature.id) || (feature.fringe && feature.id.startsWith('bgt-fringe-water-'))));
  assert.ok(EDE_DATA.water.filter(feature => feature.fringe).length > 2000);
  assert.equal(waterAtExact(-3458, 783), false);
  assert.equal(waterAt(-3458, 783), false);
  assert.equal(GEO.centralPark.water, EDE_DATA.water);
  for (const key of ['roadGraph', 'activeGraph']) {
    const { nodes, names, controls } = EDE_DATA[key];
    assert.deepEqual(names.slice(0, original[key].names.length), original[key].names);
    const retainedControls = new Map(Object.entries(controls ?? {}).map(([id, control]) =>
      [nodes.slice(2 * id, 2 * id + 2).join(','), control]));
    for (const [node, control] of Object.entries(original[key].controls ?? {})) {
      assert.deepEqual(retainedControls.get(original[key].nodes.slice(2 * node, 2 * node + 2).join(',')), control);
    }
  }
  assert.ok(land.parks.some(([, , fragments]) => fragments.length > 1));
  assert.ok(water.some(feature => feature.holes.length));

  const parks = EDE_DATA.parks.map(({ ring, holes }) => [toPts(ring), ...holes.map(toPts)]);
  for (const [x, z] of [[-1726.18, 715.90], [-1438.15, 639.20], [-3032.76, 675.16], [389.51, -564.67], [-3781, 2385]]) {
    assert.equal(waterAtExact(x, z), true);
    assert.equal(waterAt(x, z), true);
    assert.equal(parks.some(([outline, ...holes]) =>
      pointInPoly(outline, x, z) && !holes.some(hole => pointInPoly(hole, x, z))), false);
  }

  assert.equal(waterAt(-2234.52, 2264.48), false);
  assert.equal(waterAt(-1948.85, 2944.54), true);
  assert.equal(roadCrossesWater(-1948.85, 2944.54), true);

  for (const { ring, holes } of activeWater) for (const outline of [ring, ...holes]) {
    for (let k = 0, last = outline.length - 2; k < outline.length; last = k, k += 2) {
      const x = (outline[k] + outline[last]) / 2, z = (outline[k + 1] + outline[last + 1]) / 2;
      for (const [dx, dz] of [[-0.5, 0.5], [0.5, -0.5]]) {
        assert.equal(waterAt(x + dx, z + dz), waterAtExact(x + dx, z + dz));
      }
    }
  }
});
