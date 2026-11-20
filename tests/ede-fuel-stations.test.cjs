const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const read = name => readFileSync(join(__dirname, '../js', name), 'utf8');

test('detailed fuel stations share their sign atlas and leave vehicle clearance beneath surveyed roofs', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const { attribute, mix } = await import('../vendor/three/build/three.tsl.js');
  const { CivicBatch } = loadModule(read('ede-civic-landmarks.js'), { imports: {
    'three/webgpu': THREE, 'three/tsl': { attribute, mix },
    './ede-geodata.js': {}, './terrain.js': {}, './aerial-colors.js': {},
    './bag3d.js': {}, './ede-grade.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  } });
  let canvasCount = 0;
  const canvas = { getContext: () => ({ fillRect() {}, fillText() {} }) };
  const sites = [
    { id: 'test-covered', name: 'Tango test', brand: 'Tango', x: 12, z: 20, heading: Math.PI / 2,
      width: 14, length: 8, bays: 2, canopyRing: [[-7,-4],[7,-4],[6,4],[-7,4]],
      shop: { x: 25, z: 20, heading: 0, width: 7, length: 5 },
      pylon: [18, 14] },
    { id: 'test-open', name: 'TinQ test', brand: 'TinQ', x: -32, z: 15, heading: 0,
      width: 10, length: 5, bays: 2, canopy: false },
  ];
  const { buildEdeFuelStations } = loadModule(read('ede-fuel-stations.js'), { imports: {
    'three/webgpu': THREE, './ede-civic-landmarks.js': { CivicBatch },
    './ede-fuel-sites.js': { EDE_FUEL_SITES: sites }, './terrain.js': { terrainHeightAt: () => 8 },
  }, globals: { document: { createElement: () => { canvasCount++; return canvas; } } } });
  const [covered, open] = buildEdeFuelStations();
  const colliders = covered.userData.colliders;
  const canopy = colliders.find(row => row.kind === 'fuel-canopy');
  assert.equal(canopy.minY, 12.68);
  assert.ok(canopy.polygon.outer.some(({ x, z }) => x === 16 && z === 14));
  assert.equal(colliders.filter(row => row.kind === 'fuel-pump').length, 2);
  assert.equal(colliders.filter(row => row.kind === 'fuel-support').length, 2);
  assert.ok(colliders.some(row => row.kind === 'fuel-pylon'));
  assert.ok(colliders.some(row => row.kind === 'fuel-shop'));
  assert.equal(covered.userData.weatherCovers.length, 1);
  assert.equal(open.userData.weatherCovers.length, 0);
  assert.equal(open.userData.colliders.length, 2);
  assert.equal(canvasCount, 1);
  assert.equal(canvas.width * canvas.height * 4, 256 * 1024);
  const signs = group => group.children.find(mesh => mesh.name === 'Station wordmarks');
  assert.equal(signs(covered).material, signs(open).material);
  assert.notEqual(signs(covered).geometry.attributes.uv.getX(0), signs(open).geometry.attributes.uv.getX(0));
  for (const group of [covered, open]) {
    assert.ok(group.children.find(mesh => mesh.name === 'Pump hoses and fittings').userData.nearDetail);
    assert.ok(group.children.every(mesh => mesh.geometry.attributes.position.array.every(Number.isFinite)));
  }
});

test('fuel station replacements preserve the warehouse and exclude only verified shop buildings', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { EDE_FUEL_SITES, EDE_FUEL_FALLBACK_FOOTPRINTS } = await import('../js/ede-fuel-sites.js');
  const { landmarkBagExclusions } = await import('../js/ede-landmark-sites.js');
  const { polygonContains } = loadModule(read('building-collision.js'));
  const points = ring => Array.from({ length: ring.length / 2 }, (_, i) => ({ x: ring[2 * i], z: ring[2 * i + 1] }));

  const [west, north, east, south] = EDE_DATA.meta.bounds;
  assert.equal(new Set(EDE_FUEL_SITES.map(site => site.id)).size, EDE_FUEL_SITES.length);
  for (const site of EDE_FUEL_SITES) {
    assert.ok(site.x >= west && site.x <= east && site.z >= north && site.z <= south, site.name);
    if (!site.shop?.bagId) continue;
    const { x, z, bagId } = site.shop;
    const exclusions = landmarkBagExclusions({ min: { x: x - 2, z: z - 2 }, max: { x: x + 2, z: z + 2 } });
    assert.ok(exclusions.has(bagId));
  }
  const [{ id, ring, holes }] = EDE_FUEL_FALLBACK_FOOTPRINTS;
  const warehouse = EDE_DATA.buildings.find(row => row.id === id);
  assert.deepEqual(warehouse.ring, ring);
  const polygon = { outer: points(ring), holes: holes.map(points) };
  assert.equal(polygonContains(polygon, -3439.5, 2276), true);
  const { x, z } = EDE_FUEL_SITES.find(site => site.name === 'Shell TruckDiesel Ede');
  assert.equal(polygonContains(polygon, x, z), false);
});
