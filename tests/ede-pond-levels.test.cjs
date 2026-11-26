const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('published pond levels match surveyed IDs, with estimates for ponds missing plausible targets', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { loadEdePondLevels } = await import('../js/ede-water-levels.js');
  const fetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => new Response(readFileSync(url));
    const levels = await loadEdePondLevels();
    const water = new Map(EDE_DATA.water.map(feature => [feature.id, feature]));
    for (const [id, { nap, y }] of levels) {
      assert.ok(water.has(id), id);
      assert.ok(!['stream', 'ditch', 'waterloop', 'greppel, droge sloot'].includes(water.get(id).kind), id);
      assert.ok(Math.abs(nap - y - 22.54) < 1e-9, id);
    }
    assert.deepEqual(levels.get('water28'), { nap: 13.25, y: 13.25 - 22.54, code: 'GPG_435' });
    assert.equal(levels.get('water26').nap, 12);
    assert.equal(levels.get('water65').code, undefined);
    assert.equal(levels.get('water9').code, undefined);
    assert.ok(!levels.has('water91'));
  } finally {
    globalThis.fetch = fetch;
  }
});

test('the same level shoreline cuts legacy and streamed terrain and keeps the island', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const surface = await import('../js/ede-surface-geometry.js');
  const { clipEdeGround } = await import('../js/ede-grade-query.js');
  const { buildTerrainGeometry } = await import('../js/ede-landscape-geometry.js');
  const field = { columns: 3, rows: 3, minX: 0, minZ: 0, maxX: 12, maxZ: 12, step: 6, minY: 4,
    heights: new Float32Array(9).fill(4) };
  const source = readFileSync(join(__dirname, '../js/ede-geometry.js'), 'utf8')
    .replace('export function* edeTerrainGeometries', 'function* edeTerrainGeometries')
    + '\nexport { edeTerrainGeometries };';
  const { edeTerrainGeometries, edePolygonGeometry, edeSurfaceCuts, indexEdeSurfaceCuts, drapeEdeSurface } =
    loadModule(source, { imports: {
      'three/webgpu': THREE, './city-config.js': {}, './ede-road-surfaces.js': {}, './ede-road-cell-query.js': {},
      './terrain.js': { getTerrain: () => field, getExpansionTerrain: () => ({}),
        getTerrainPatches: () => [], getTerrainPatch: () => null, terrainHeightAt: () => 4 },
      './ede-grade.js': { terrainGradeCuts: () => [], gradeCuts: () => [], localGradeSurface: () => undefined, clipEdeGround },
      './ede-surface-geometry.js': surface,
    } });

  const ring = (a, b) => [{ x: a, z: a }, { x: b, z: a }, { x: b, z: b }, { x: a, z: b }];
  const water = edePolygonGeometry(ring(2, 10), [ring(5, 7)], -1);
  const cuts = edeSurfaceCuts(water);
  const query = indexEdeSurfaceCuts(cuts);
  const part = query({ minX: 0, minZ: 0, maxX: 12, maxZ: 12 });
  assert.equal(part.length, cuts.length);
  assert.equal(query({ minX: 20, minZ: 20, maxX: 21, maxZ: 21 }).length, 0);
  const [legacy] = [...edeTerrainGeometries(-0.025, query)];
  const overlay = drapeEdeSurface(edePolygonGeometry(ring(0, 12), [], 0.05), true, undefined, false, undefined, query);
  const material = new THREE.MeshBasicMaterial();
  function hit(geometry, x, z) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(new THREE.Mesh(geometry, material))[0]?.point.y;
  }
  const positions = [[3.2, 4.1], [6, 6.1], [11.2, 4.1]];
  assert.deepEqual(positions.map(p => hit(water, ...p)), [-1, undefined, undefined]);
  const legacyBounds = { minX: -100, minZ: -100, maxX: -50, maxZ: -50 };
  const tile = { bounds: [0, 0, 12, 12], skirts: [3, 3, 3, 3], gradeCuts: part };
  const streamed = [13, 51].map(side => {
    const buffer = new ArrayBuffer(side * side * 5);
    const bytes = new DataView(buffer);
    for (let i = 0; i < side * side; i++) bytes.setInt16(i * 5, 2654, true);
    return buildTerrainGeometry(buffer, tile, legacyBounds, { napOrigin: 22.54 }, () => 0, side);
  });
  for (const ground of [legacy, overlay, ...streamed]) {
    assert.equal(hit(ground, ...positions[0]), undefined);
    assert.ok(hit(ground, ...positions[1]) > 3.9);
    assert.ok(hit(ground, ...positions[2]) > 3.9);
  }
});
