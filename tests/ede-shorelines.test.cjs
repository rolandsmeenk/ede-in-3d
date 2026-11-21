const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');

const asset = name => JSON.parse(gunzipSync(readFileSync(join(__dirname, '..', 'assets', name))));

test('the corrected shoreline is shared by map layers, park geometry and movement', async () => {
  const { EDE_DATA, pointInPoly, roadCrossesWater, toPts, waterAt, waterAtExact } = await import('../js/city-config.js');
  const { GEO } = await import('../js/nyc-geodata.js');
  const { water, land } = asset('ede-shorelines.json.gz');
  const original = asset('ede-map-v1.json.gz');
  const activeWater = water.filter(({ id }) => id !== 'water171');
  assert.deepEqual(EDE_DATA.water.slice(0, activeWater.length), activeWater);
  assert.equal(EDE_DATA.meta.counts.water, EDE_DATA.water.length);
  assert.ok(EDE_DATA.water.slice(activeWater.length).every(feature => feature.id.startsWith('corridor-water')));
  assert.equal(waterAtExact(-3458, 783), false);
  assert.equal(waterAt(-3458, 783), false);
  assert.equal(GEO.centralPark.water, EDE_DATA.water);
  for (const key of ['roadGraph', 'activeGraph']) {
    for (const field of ['nodes', 'links', 'names']) {
      assert.deepEqual(EDE_DATA[key][field].slice(0, original[key][field].length), original[key][field]);
    }
    for (const [node, control] of Object.entries(original[key].controls ?? {})) {
      assert.deepEqual(EDE_DATA[key].controls[node], control);
    }
  }
  assert.ok(land.parks.some(([, , fragments]) => fragments.length > 1));
  assert.ok(water.some(feature => feature.holes.length));

  const parks = EDE_DATA.parks.map(({ ring, holes }) => [toPts(ring), ...holes.map(toPts)]);
  for (const [x, z] of [[-1726.18, 715.90], [-1438.15, 639.20], [-3032.76, 675.16], [389.51, -564.67]]) {
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
