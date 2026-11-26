const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const asset = require('../assets/ede-bgt.json');
const authoredPlatformIds = [
  'L0004.0971bf0fc3ca4d938b074c2793e4456e', 'L0004.4403f8468bde4df2bd96574e02e347b8',
  'L0004.259ce80caac146b58d788438f3c4820d', 'L0004.990e57a3116d460581441bb3543ba347',
  'L0004.ab7c81b3b4210f19e0530b29a8c02470', 'L0004.ef6e5e029d594e3cae6f8908baccb259',
];

function area(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    sum += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  }
  return sum / 2;
}

test('BGT structures fit the 500 m playable frame and each source ID is assigned once', async () => {
  const { edeCoverage } = await import('../js/ede-coverage.js');
  const rings = edeCoverage.buildingBoundary.flat();
  const xs = rings.flatMap(ring => ring.filter((_, i) => i % 2 === 0));
  const zs = rings.flatMap(ring => ring.filter((_, i) => i % 2 === 1));
  const minX = Math.min(...xs), minZ = Math.min(...zs), maxX = Math.max(...xs), maxZ = Math.max(...zs);
  assert.equal(asset.source.exterior.date, '2026-11-23');
  assert.equal(asset.source.municipality, 'GM0228');
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
  assert.ok(asset.structures.some(item => item.kind === 'turbine' && item.hubHeight === 6));
  assert.ok(authoredPlatformIds.every(id => has('platform', id)));
});


test('the complete municipal BGT inventory includes northern decks and local turbine scale', () => {
  const ids = new Map(asset.structures.flatMap(structure => structure.ids.map(id => [id, structure])));
  assert.equal(ids.get('L0003.d6cadc8d77994768830be8beb29046a2').kind, 'deck');
  assert.equal(ids.get('G0228.3ee8eb0533604ce9b05475f200118735').hubHeight, 11);
  assert.ok(asset.coveredByBuildings.includes('G0228.03edc86e0860404990dd1d44134deb74'));
  assert.ok(asset.coveredByBuildings.every(id => !ids.has(id)));
});

test('a rail-only deck with sparse rail hits stays above its cut approaches', () => {
  const { loadModule } = require('./helpers/module.cjs');
  const { pathToFileURL } = require('node:url');
  const filename = join(__dirname, '../js/ede-bgt-world.js');
  const source = readFileSync(filename, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
    .replaceAll('export async function', 'async function') + '\nexport { makeDeckProfile };';
  const { makeDeckProfile } = loadModule(source, { filename, imports: {
    'three/webgpu': {}, 'three/tsl': {}, './tsl-materials.js': {}, './ede-snow.js': {}, './ede-geometry.js': {}, './terrain.js': { terrainHeightAt: () => 16.5 },
    './ede-windmill.js': {}, './ede-mast-strokes.js': {}, './ede-bridge.js': {},
    './ede-geodata.js': {}, './ede-scene-coordinates.js': {},
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
  const platforms = asset.structures.filter(({ ids }) => ids.some(id => authoredPlatformIds.includes(id)));
  const fetch = async url => ({ ok: true, json: async () => url.pathname.endsWith('ede-bridge-materials.json')
    ? { version: 1, decks: {} } : { version: 1, structures: [...structures, ...platforms], source: {} } });
  const strokes = loadModule(readFileSync(join(__dirname, '../js/ede-mast-strokes.js'), 'utf8'), { imports: {
    'three/webgpu': three, 'three/tsl': tsl, './tsl-materials.js': {}, './ede-snow.js': {},
  } });
  const { buildEdeBgtWorld } = loadModule(source, { filename, globals: { URL, fetch }, imports: {
    'three/webgpu': three, 'three/tsl': tsl, './tsl-materials.js': {},
    './ede-snow.js': { applySnowMaterial: material => material },
    './ede-geometry.js': { edeBounds: () => ({}) }, './terrain.js': { terrainHeightAt: () => 0 },
    './ede-windmill.js': {}, './ede-mast-strokes.js': strokes, './ede-geodata.js': { EDE_DATA: { roads: [], railways: [] } },
    './ede-bridge.js': await import('../js/ede-bridge.js'), './ede-scene-coordinates.js': {},
  } });
  const model = await buildEdeBgtWorld(new three.Scene());
  assert.equal(model.platforms.length, 0, 'the authored station platforms own their render geometry');
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

test('zendmasten keep their detailed models and share a filtered, tapered distance mesh', async () => {
  const { loadModule } = require('./helpers/module.cjs');
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const source = name => readFileSync(join(__dirname, `../js/${name}.js`), 'utf8');
  const terrain = { terrainHeightAt: () => 3 };
  const core = { 'three/webgpu': three, 'three/tsl': tsl };
  const sites = await import('../js/ede-mast-sites.js');
  const civic = loadModule(source('ede-civic-landmarks'), { imports: { ...core,
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': {}, './terrain.js': terrain,
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  } });
  const strokes = loadModule(source('ede-mast-strokes'), { imports: { ...core, './tsl-materials.js': {}, './ede-snow.js': {} } });
  const { EDE_MAST_FACTORIES, createZendmastLod } = loadModule(source('ede-mast-models'), { imports: {
    ...core, './ede-civic-landmarks.js': civic, './ede-mast-sites.js': sites,
    './ede-mast-strokes.js': strokes, './terrain.js': terrain,
  } });
  const models = sites.EDE_MAST_SITES.map(site => EDE_MAST_FACTORIES[site.id]([], site));
  const masts = models.map(model => model.userData.mast);
  assert.ok(sites.EDE_MAST_SITES.every(site => site.hideOnMap));
  assert.ok(masts.every(mast => mast.mesh.geometry.getAttribute('position').count > 100));
  assert.ok(masts.every(mast => mast.mesh.userData.shadowStandIn.isBufferGeometry));
  const lod = createZendmastLod(masts);
  assert.equal(lod.mesh.geometry.instanceCount, 64);
  const [shaft] = masts[0].segments.slice(-1);
  assert.ok(shaft[2] > shaft[3], 'the monopole tapers toward the top');
  assert.equal(shaft[0].y, 3);
  const camera = new three.PerspectiveCamera(60);
  camera.position.copy(masts[0].centre).add(new three.Vector3(100, 0, 0));
  lod.update(camera, 900, 0);
  assert.equal(masts[0].mesh.visible, false);
  lod.update(camera, 1800, 0);
  assert.equal(masts[0].mesh.visible, true);
  assert.equal(masts[1].mesh.visible, false);
});
