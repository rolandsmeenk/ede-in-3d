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


test('a rail-only deck with sparse rail hits stays above its cut approaches', () => {
  const { loadModule } = require('./helpers/module.cjs');
  const { pathToFileURL } = require('node:url');
  const filename = join(__dirname, '../js/ede-bgt-world.js');
  const source = readFileSync(filename, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
    .replaceAll('export async function', 'async function') + '\nexport { makeDeckProfile };';
  const { makeDeckProfile } = loadModule(source, { filename, imports: {
    'three/webgpu': {}, 'three/tsl': {}, './tsl-materials.js': {}, './ede-geometry.js': {}, './terrain.js': { terrainHeightAt: () => 16.5 }, './ede-windmill.js': {}
  } });
  const feature = { axis: [0, 0, 80, 0] };
  const rail = (x, z, kind) => kind === 'rail-deck' && z === 0 && x >= 30 && x <= 40 ? 21.1 : undefined;
  const surface = makeDeckProfile(feature, rail);
  for (const x of [0, 30, 35, 40, 80]) assert.ok(Math.abs(surface(x, 7) - 20.96) < 1e-9);

  const road = makeDeckProfile(feature, (x, z, kind) => kind === 'road-deck' ? 27.1 : rail(x, z, kind));
  assert.ok(Math.abs(road(0, 7) - 26.96) < 1e-9);
});

test('electricity masts keep near steel and share a single filtered distance batch', async () => {
  const { loadModule } = require('./helpers/module.cjs');
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const filename = join(__dirname, '../js/ede-bgt-world.js');
  const source = readFileSync(filename, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify('file://' + filename))
    .replaceAll('export async function', 'async function') + '\nexport { buildEdeBgtWorld };';
  const structures = asset.structures.filter(item => item.kind === 'pylon').slice(0, 2)
    .map(({ ids, tower }, index) => ({ kind: 'pylon', ids, tower: [index * 400, 0, ...tower.slice(2)], polygons: [] }));
  const fetch = async () => ({ ok: true, json: async () => ({ version: 1, structures, source: {} }) });
  const { buildEdeBgtWorld } = loadModule(source, { filename, globals: { URL, fetch }, imports: {
    'three/webgpu': three, 'three/tsl': tsl, './tsl-materials.js': {},
    './ede-geometry.js': { edeBounds: () => ({}) }, './terrain.js': { terrainHeightAt: () => 0 },
    './ede-windmill.js': {},
  } });
  const model = await buildEdeBgtWorld(new three.Scene());
  const masts = model.group.children.filter(child => child.name === 'Ede electricity mast');
  assert.equal(masts.length, 2);
  assert.ok(masts.every(mesh => mesh.castShadow && mesh.geometry.attributes.position.count > 2000));
  assert.equal(model.colliders.length, 8);
  const filtered = model.group.children.filter(child => child.name === 'Ede filtered mast lattice');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].geometry.instanceCount, 2 * 95);
  assert.ok(filtered[0].material.transparent && !filtered[0].material.depthWrite);
  assert.ok(!filtered[0].castShadow);

  const camera = new three.PerspectiveCamera(60);
  camera.position.set(50, 16, 0);
  model.updateMastLod(camera, 900);
  assert.deepEqual(Array.from(masts, mesh => mesh.visible), [true, false]);
  camera.position.set(185, 16, 0);
  model.updateMastLod(camera, 900);
  assert.ok(masts.every(mesh => !mesh.visible));
  model.updateMastLod(camera, 1800);
  assert.ok(masts.every(mesh => mesh.visible));
});
