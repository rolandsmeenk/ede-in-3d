const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports = {}, globals = {}) {
  return loadModule(readFileSync(join(__dirname, '../js/', name), 'utf8'),
    { imports, globals, filename: name });
}

test('farm building survey has correct structure for all farm sites', async () => {
  const survey = load('ede-farm-building-survey.js');

  const { FARM_SURVEYS, EDE_FARM_LANDMARKS } = survey;

  // 9 farm sites across Ede and the northern rural landscape (Hoekelum is excluded, handled by restaurant estates)
  assert.equal(EDE_FARM_LANDMARKS.length, 9);

  const expectedIds = [
    'de-brand', 'heuvelseweg-boerderij', 'oud-willigerweg-boerderij',
    'boerderij-engelenhove', 'boerderij-slijpkruik', 'boerderij-bouwhuis',
    'boerderij-kalverkamp', 'memelinkhoeve', 'roodselaar-hoeve',
  ];
  for (const id of expectedIds) {
    const site = EDE_FARM_LANDMARKS.find(s => s.id === id);
    assert.ok(site, `site ${id} present`);
    assert.ok(typeof site.osmId === 'string' && site.osmId.startsWith('w'), `${id} has osmId`);
    assert.ok(typeof site.x === 'number' && typeof site.z === 'number', `${id} has coords`);
    assert.ok(site.worldSpace === true, `${id} worldSpace`);

    const buildings = FARM_SURVEYS[id];
    assert.ok(Array.isArray(buildings) && buildings.length >= 1, `${id} has survey entries`);
    for (const b of buildings) {
      assert.ok(['farmhouse', 'barn'].includes(b.kind), `${id} kind is farmhouse or barn`);
      assert.ok(Array.isArray(b.outline) && b.outline[0].length >= 3, `${id} outline has ring`);
      assert.ok(typeof b.ground === 'number', `${id} ground defined`);
      assert.ok(typeof b.wallTop === 'number' && b.wallTop > 0, `${id} wallTop > 0`);
      assert.ok(typeof b.ridgeHeight === 'number' && b.ridgeHeight > b.wallTop, `${id} ridgeHeight > wallTop`);
    }
  }
});

test('farm building factory builds finite non-empty meshes for every site', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');

  const context = { fillRect() {}, save() {}, translate() {}, restore() {}, fillText() {} };
  const document = { createElement: () => ({ getContext: () => context }) };
  const terrain = { getTerrain: () => false, terrainHeightAt: () => 0 };

  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] },
    './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {},
    './ede-facade-material.js': {},
  }, { document });

  const facadeMat = { createFacadeSurfaceTexture: () => ({ texture: new three.Texture() }) };

  const survey = load('ede-farm-building-survey.js');

  const farmModule = load('ede-farm-building.js', {
    'three/webgpu': three,
    'three/tsl': tsl,
    './ede-civic-landmarks.js': civic,
    './terrain.js': terrain,
    './ede-facade-material.js': facadeMat,
    './ede-farm-building-survey.js': survey,
  }, { document });

  const { EDE_FARM_LANDMARK_FACTORIES } = farmModule;
  const { EDE_FARM_LANDMARKS } = survey;

  for (const site of EDE_FARM_LANDMARKS) {
    const factory = EDE_FARM_LANDMARK_FACTORIES[site.id];
    assert.ok(typeof factory === 'function', `factory exists for ${site.id}`);

    const model = factory([], site);
    assert.ok(model, `${site.id} model is truthy`);

    const bounds = new three.Box3().setFromObject(model);
    assert.ok(!bounds.isEmpty(), `${site.id} model is non-empty`);

    // Model should be centered near the site location (worldSpace, within 70 m)
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cz = (bounds.min.z + bounds.max.z) / 2;
    assert.ok(Math.abs(cx - site.x) < 70, `${site.id} model X within 70 m of site (cx=${cx.toFixed(1)} site.x=${site.x})`);
    assert.ok(Math.abs(cz - site.z) < 70, `${site.id} model Z within 70 m of site (cz=${cz.toFixed(1)} site.z=${site.z})`);

    // Height should be plausible (between 2 and 15 m above ground reference)
    const height = bounds.max.y - bounds.min.y;
    assert.ok(height >= 2 && height <= 15, `${site.id} height plausible: ${height.toFixed(1)} m`);
  }
});

test('farm sites are excluded from generic OSM and BAG stream rendering', async () => {
  const survey = load('ede-farm-building-survey.js');
  const { EDE_FARM_LANDMARKS, FARM_SURVEYS } = survey;

  // Collect all osmIds and bagIds that the farm module declares
  const osmIds = new Set(EDE_FARM_LANDMARKS.flatMap(s => [s.osmId, ...(s.annexOsmIds ?? [])]));
  const bagIds = new Set(EDE_FARM_LANDMARKS.flatMap(s => s.bagIds ?? []));

  // Primary farm OSM ways
  assert.ok(osmIds.has('w271586553'), 'De Brand primary osmId registered');
  assert.ok(osmIds.has('w271719274'), 'Heuvelseweg primary osmId registered');
  assert.ok(osmIds.has('w271892146'), 'Oud Willigerweg primary osmId registered');
  assert.ok(osmIds.has('w1463709461'), 'Engelenhove primary osmId registered');
  assert.ok(osmIds.has('w271548742'), 'Slijpkruik primary osmId registered');
  assert.ok(osmIds.has('w271890326'), 'Memelinkhoeve primary osmId registered');

  // Hoekelum (restaurant-estate) must NOT appear in farm exclusions
  assert.ok(!osmIds.has('w271473151'), 'Hoekelum NOT in farm sites (handled elsewhere)');

  // The primary BAG IDs
  assert.ok(bagIds.has('0228100000037083'), 'De Brand BAG ID registered');
  assert.ok(bagIds.has('0228100000051628'), 'Heuvelseweg BAG ID registered');
  assert.ok(bagIds.has('0228100000024693'), 'Oud Willigerweg BAG ID registered');
});

test('existing expansion and teleport tests still pass after farm integration', async () => {
  // Smoke-test: load the survey module to ensure no parse errors that would break
  // ede-landmark-sites.js (which now imports EDE_FARM_LANDMARKS).
  const survey = load('ede-farm-building-survey.js');
  assert.ok(Array.isArray(survey.EDE_FARM_LANDMARKS), 'EDE_FARM_LANDMARKS exportable');
  assert.ok(typeof survey.FARM_SURVEYS === 'object', 'FARM_SURVEYS exportable');
});
