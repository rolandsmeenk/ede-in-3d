const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const read = name => readFileSync(join(__dirname, '../js', name), 'utf8');

test('detailed fuel stations share their sign atlas and leave vehicle clearance beneath surveyed roofs', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const { attribute, color, mix, smoothstep, uniform } = await import('../vendor/three/build/three.tsl.js');
  const fuelPrices = await import('../js/ede-fuel-prices.js');
  const collision = loadModule(read('building-collision.js'));
  const { CivicBatch } = loadModule(read('ede-civic-landmarks.js'), { imports: {
    'three/webgpu': THREE, 'three/tsl': { attribute, mix },
    './ede-geodata.js': {}, './terrain.js': {}, './aerial-colors.js': {},
    './bag3d.js': {}, './ede-grade.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
    './ede-wind-props.js': {},
  } });
  const canvases = [];
  let updatePrices;
  const createCanvas = () => {
    const labels = [];
    const canvas = { labels, getContext: () => ({ fillRect() {}, fillText(text) { labels.push(text); } }) };
    canvases.push(canvas);
    return canvas;
  };
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
    'three/tsl': { attribute, color, mix, smoothstep }, './building-collision.js': collision,
    './ede-fuel-sites.js': { EDE_FUEL_SITES: sites }, './terrain.js': { terrainHeightAt: () => 8 },
    './ede-fuel-prices.js': { ...fuelPrices, watchFuelBaseline(update) { updatePrices = update; } },
    './tsl-materials.js': { cityUniforms: { uInteriorGlow: uniform(0), uWindowLights: uniform(new THREE.Vector3()) } },
  }, globals: { document: { createElement: createCanvas } } });
  const [covered, open] = buildEdeFuelStations(sites, { live: true });
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
  assert.equal(covered.userData.forecourtLights.length, 5);
  for (const light of covered.userData.forecourtLights.filter(light => light.dist === 12)) {
    assert.ok(light.y < canopy.minY);
    assert.ok(collision.polygonContains(canopy.polygon, light.x, light.z));
  }
  assert.equal(open.userData.forecourtLights.length, 1);
  assert.equal(canvases.length, 2);
  assert.equal(canvases[0].width * canvases[0].height * 4, 256 * 1024);
  const rates = covered.getObjectByName('Estimated fuel prices');
  assert.equal(rates.geometry.getAttribute('position').count, 12);
  assert.deepEqual(canvases[1].labels, ['€/L', 'E10', '2,15', 'B7', '2,29']);
  const version = rates.material.map.version;
  updatePrices({ day: '20261123', e10: 2.175, diesel: 2.19, lpg: 1.08 });
  assert.deepEqual(canvases[1].labels.slice(5), ['€/L', 'E10', '2,18', 'B7', '2,19']);
  assert.ok(rates.material.map.version > version);
  const signs = group => group.children.find(mesh => mesh.name === 'Station wordmarks');
  assert.equal(signs(covered).material, signs(open).material);
  assert.notEqual(signs(covered).geometry.attributes.uv.getX(0), signs(open).geometry.attributes.uv.getX(0));
  for (const group of [covered, open]) {
    assert.ok(group.children.find(mesh => mesh.name === 'Pump hoses and fittings').userData.nearDetail);
    assert.ok(group.getObjectByName('Canopy lamps and lit shop windows').material.emissiveNode);
    assert.ok(group.children.every(mesh => mesh.geometry.attributes.position.array.every(Number.isFinite)));
  }
});

test('fuel station replacements preserve the warehouse and exclude only verified shop buildings', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { EDE_FUEL_SITES, EDE_FUEL_FALLBACK_FOOTPRINTS } = await import('../js/ede-fuel-sites.js');
  const { landmarkBagExclusions } = await import('../js/ede-landmark-sites.js');
  const { containsPlayablePoint } = await import('../js/ede-playable-boundary.js');
  const { polygonContains } = loadModule(read('building-collision.js'));
  const points = ring => Array.from({ length: ring.length / 2 }, (_, i) => ({ x: ring[2 * i], z: ring[2 * i + 1] }));

  const [west, north, east, south] = EDE_DATA.meta.bounds;
  const added = ['n2765322949', 'n2761090387', 'n26866817', 'n13730420385', 'n13730420384', 'n1151393764', 'n848767429'];
  assert.equal(EDE_FUEL_SITES.length, 27);
  for (const id of added) {
    const site = EDE_FUEL_SITES.find(row => row.id === id);
    assert.ok(site, id);
    assert.ok(containsPlayablePoint(site.x, site.z), site.name);
    assert.ok(containsPlayablePoint(...site.pylon), site.name);
    assert.equal(site.pumps.length, site.bays);
    if (site.canopy !== false) {
      const canopy = { outer: site.canopyRing.map(([x, z]) => ({ x, z })), holes: [] };
      for (const [x, z] of site.pumps) assert.ok(polygonContains(canopy, x, z), site.name);
    }
  }
  assert.equal(new Set(EDE_FUEL_SITES.map(site => site.id)).size, EDE_FUEL_SITES.length);
  assert.deepEqual(EDE_FUEL_SITES.filter(site => site.north).map(site => site.name), ['Esso De Stroet', 'Esso De Tol', 'Esso Spelt']);
  for (const site of EDE_FUEL_SITES) {
    assert.ok(site.x >= west && site.x <= east && site.z >= north && site.z <= south, site.name);
    assert.ok(site.pylon.every(Number.isFinite) && Number.isFinite(site.pylonHeading));
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

test('fuel estimates use the newest valid daily national row and the right station profile', async () => {
  const { parseFuelBaseline, estimateFuelPrice } = await import('../js/ede-fuel-prices.js');
  const sample = { Euro95_1: 2.15, Diesel_2: 2.29, LPG_3: 1.03 };
  const baseline = parseFuelBaseline({ value: [
    { ...sample, Periods: '20261117', Euro95_1: null },
    { ...sample, Periods: '20261116' },
    { ...sample, Periods: '20261115', Euro95_1: 2.14 },
    { ...sample, Periods: '20261123' },
  ] }, '20261122');
  assert.deepEqual(baseline, { day: '20261116', e10: 2.15, diesel: 2.29, lpg: 1.03 });
  assert.equal(estimateFuelPrice(baseline, 'discount', 'e10').toFixed(3), '2.100');
  assert.equal(estimateFuelPrice(baseline, 'lunteren', 'diesel').toFixed(3), '2.240');
  assert.equal(estimateFuelPrice(baseline, 'local', 'lpg'), 1.03);
  assert.equal(estimateFuelPrice(baseline, 'local', 'cng'), null);
});
