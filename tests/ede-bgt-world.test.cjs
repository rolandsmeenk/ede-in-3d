const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

const asset = require('../assets/ede-bgt.json');
const scene = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets/ede-map-v1.json.gz'))));

function area(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    sum += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  }
  return sum / 2;
}

test('BGT structures fit the playable Ede frame and each source ID is assigned once', () => {
  const [minX, minZ, maxX, maxZ] = scene.meta.bounds;
  const counts = {};
  const sources = new Set();
  for (const item of asset.structures) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    assert.ok(item.ids.length);
    for (const id of item.ids) {
      assert.ok(!sources.has(id), id);
      sources.add(id);
    }
    if (item.kind === 'pylon') assert.ok(item.tower.every(Number.isFinite));
    else assert.ok(item.polygons.length);
    for (const [outer, ...holes] of item.polygons) {
      assert.ok(area(outer) < 0);
      assert.ok(holes.every(hole => area(hole) > 0));
      for (const ring of [outer, ...holes]) {
        for (let i = 0; i < ring.length; i += 2) {
          assert.ok(ring[i] >= minX - 0.02 && ring[i] <= maxX + 0.02);
          assert.ok(ring[i + 1] >= minZ - 0.02 && ring[i + 1] <= maxZ + 0.02);
        }
      }
    }
  }
  assert.deepEqual(counts, asset.counts);
});

test('BGT extract includes the stations, A30 crossing and both Maanderbroek turbines', () => {
  const has = (kind, id) => asset.structures.some(item => item.kind === kind && item.ids.includes(id));
  assert.ok(has('platform', 'L0004.ab80d499b9464e928dc6eab3c6db2a21'));
  assert.ok(has('platform', 'L0004.2ca4dfdc57404835a51d0231d9461ef6'));
  assert.ok(has('deck', 'L0002.73bbac3ff8164220957d09d21d823920'));
  assert.ok(has('turbine', 'G0228.9ba9e32d35094eeab81f12181b239d34'));
  assert.ok(has('turbine', 'G0228.167bfd43079b48c4a282a745ffa86a7a'));
});
