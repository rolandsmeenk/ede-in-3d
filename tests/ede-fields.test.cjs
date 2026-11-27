const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = file => readFileSync(join(__dirname, '..', file), 'utf8');
const phenology = loadModule(source('js/ede-field-phenology.js'));
const square = (w, n, e, s) => [w * 4, n * 4, e * 4, n * 4, e * 4, s * 4, w * 4, s * 4];

test('planting heights follow the two triangles in the compact terrain rim', async () => {
  const { TERRAIN_RIM_EDGE: edge, terrainRimHeightAt } = await import('../js/terrain.js');
  const grid = { minX: 0, minZ: 0, maxX: 100, maxZ: 100, columns: 2, rows: 2, step: 100, minY: -6,
    heights: [2, 4, 9, 1] };
  const inner = [[0, 2, 0], [100, 4, 0], [100, 1, 100], [0, 9, 100]];
  const outer = [[-edge, -6, -edge], [edge, -6, -edge], [edge, -6, edge], [-edge, -6, edge]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    for (const triangle of [[inner[i], inner[j], outer[i]], [inner[j], outer[j], outer[i]]]) {
      const [x, y, z] = triangle[0].map((a, k) => a * 0.2 + triangle[1][k] * 0.5 + triangle[2][k] * 0.3);
      assert.ok(Math.abs(terrainRimHeightAt(grid, x, z) - y) < 1e-9);
    }
  }
  assert.equal(terrainRimHeightAt(grid, 40, 60), undefined);
});

test('field terrain drapes up-facing triangles around holes and matches the neighbouring tile', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const { decodeFieldTile, containsFieldPoint, buildFieldTile } = loadModule(source('js/ede-field-tiles.js'), {
    imports: { 'three/webgpu': three },
  });
  const field = { code: 259, family: 'maize', cos: 1, sin: 0 };
  const fields = new Map([[7, field]]);
  const west = decodeFieldTile([[7, [square(465, 40, 512, 86), square(480, 50, 490, 60)]]],
    { bounds: [0, 0, 512, 512] }, fields);
  const east = decodeFieldTile([[7, [square(0, 40, 64, 86)]]], { bounds: [512, 0, 1024, 512] }, fields);
  assert.equal(containsFieldPoint(west[0], 472, 45), true);
  assert.equal(containsFieldPoint(west[0], 485, 55), false);
  const heightAt = (x, z) => Math.sin(z / 9) + x * 0.01;
  const a = buildFieldTile(west, heightAt, [0, 0, 512, 512]);
  const b = buildFieldTile(east, heightAt, [512, 0, 1024, 512]);
  const seam = geometry => {
    const { position, fieldRow } = geometry.attributes, vertices = [];
    for (let i = 0; i < position.count; i++) if (position.getX(i) === 512) {
      vertices.push([position.getZ(i), position.getY(i), fieldRow.getX(i), fieldRow.getY(i)]);
    }
    return vertices.sort((a, b) => a[0] - b[0]);
  };
  assert.deepEqual(seam(a.base), seam(b.base));
  assert.ok(seam(a.base).length > 2);
  const mesh = new three.Mesh(a.canopy, new three.MeshBasicMaterial());
  const hit = (x, z) => new three.Raycaster(new three.Vector3(x, 30, z), new three.Vector3(0, -1, 0)).intersectObject(mesh);
  assert.ok(hit(472, 45).length);
  assert.equal(hit(485, 55).length, 0);
  const { fieldEdge, position, normal } = a.canopy.attributes;
  const walls = Array.from({ length: position.count }, (_, i) => i).filter(i => fieldEdge.getX(i) === 1);
  assert.ok(walls.some(i => position.getX(i) === 465 && normal.getX(i) === -1), 'the exterior wall faces out');
  assert.ok(walls.some(i => position.getX(i) === 480 && normal.getX(i) === 1), 'the hole wall faces into the hole');
  for (const i of walls) {
    assert.equal(fieldEdge.getX(i + 1), 2);
    assert.ok(Math.abs(position.getY(i) - position.getY(i + 1) - 0.10) < 1e-5);
  }
  const index = a.canopy.index.array;
  for (let i = 0; i < index.length; i += 3) {
    const face = index.slice(i, i + 3);
    assert.ok(!face.every(i => fieldEdge.getX(i) && position.getX(i) === 512), 'no wall spans the tile seam');
  }
});

test('installed tiles reproduce seasonal maize, remove near plants in flight and keep the field cache bounded', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const utils = loadModule(source('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), {
    imports: { '../../../build/three.core.js': three },
  });
  const tiles = loadModule(source('js/ede-field-tiles.js'), { imports: { 'three/webgpu': three } });
  const plants = loadModule(source('js/ede-field-plants.js'), {
    imports: { 'three/webgpu': three, 'three/addons/utils/BufferGeometryUtils.js': utils },
  });
  const { createEdeFields } = loadModule(source('js/ede-fields.js').replace('import.meta.url', '"file:///js/ede-fields.js"'), {
    globals: { URL, performance },
    imports: { 'three/webgpu': three, 'three/tsl': tsl, './ede-geodata.js': {}, './ede-snow.js': { applySnowMaterial() {} },
      './ede-field-phenology.js': phenology, './ede-field-tiles.js': tiles, './ede-field-plants.js': plants },
  });
  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(60, 1, 0.1, 3000);
  camera.position.set(25, 2, 25);
  camera.lookAt(70, 0, 70);
  camera.updateMatrixWorld();
  const system = createEdeFields(scene, {
    heightAt: () => 0, compact: true,
    aerial: Promise.resolve({ ground: { width: 2, height: 2, minX: 0, minZ: 0, step: 50,
      data: new Uint8ClampedArray([69, 91, 46, 255, 162, 146, 119, 255, 100, 98, 56, 255, 131, 148, 78, 255]) } }),
    read: async file => file === 'index.json' ? {
      version: 1, tileSize: 512, tiles: ['0_0'], fields: { 10: [259, 0.2, null, 'brp', 0] },
    } : [[10, [square(0, 0, 110, 110), square(40, 40, 60, 60)]]],
  });
  for (let i = 0; i < 5; i++) {
    system.update(camera, '2025-07-26');
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(system.stats.maizeTiles, 1);
  assert.ok(system.stats.plants > 100 && system.stats.plants <= 4000);
  assert.equal(system.fieldAt(49, 49).length, 0);
  const [july] = system.fieldAt(25, 25);
  assert.ok(july.height > 2);
  system.update(camera, '2025-07-26', { altitude: 90 });
  assert.equal(system.stats.plants, 0);
  assert.equal(system.stats.maizeTiles, 1);
  system.update(camera, '2025-10-10');
  assert.equal(system.stats.maizeTiles, 0);
  assert.ok(system.fieldAt(25, 25)[0].height < 0.2);
  system.update(camera, '2025-07-26');
  assert.deepEqual(system.fieldAt(25, 25)[0], july);
  assert.ok(system.stats.resident <= 24);
});

test('bundled Ede field tiles use registered codes and retain stable row axes and flower references', () => {
  const directory = join(__dirname, '..', 'assets', 'ede-fields-v1');
  const manifest = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.ok(manifest.tiles.length > 150);
  const seen = new Set(), mixes = new Set();
  for (const [code, bearing, recipe] of Object.values(manifest.fields)) {
    assert.ok(Number.isFinite(bearing));
    if (code) {
      assert.ok(phenology.FIELD_CROP_CODES[code], `registered crop ${code}`);
      seen.add(code);
    }
    if (recipe) {
      assert.ok(phenology.FIELD_FLOWER_MIXES[recipe], `flower mix ${recipe}`);
      mixes.add(recipe);
    }
  }
  assert.equal(Object.keys(manifest.codes).length, 103);
  for (const code of Object.keys(manifest.codes)) {
    assert.ok(phenology.FIELD_CROP_CODES[code], `registry mapping for ${code}`);
  }
  assert.deepEqual(seen, new Set(Object.keys(manifest.coverage.plantedParcels).map(Number)));
  for (const mix of ['A6', 'G1', 'G3', 'ginkel-margin']) assert.ok(mixes.has(mix));
  for (const id of manifest.tiles) assert.ok(existsSync(join(directory, `${id}.json.gz`)), id);
  const tile = JSON.parse(gunzipSync(readFileSync(join(directory, `${manifest.tiles[0]}.json.gz`))));
  for (const [id, rings] of tile) {
    assert.ok(manifest.fields[id]);
    for (const ring of rings) assert.ok(ring.length >= 6 && ring.every(value => Number.isInteger(value) && value >= 0 && value <= 2048));
  }
});
