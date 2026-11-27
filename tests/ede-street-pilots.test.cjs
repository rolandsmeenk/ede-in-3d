const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports, globals) {
  return loadModule(readFileSync(join(__dirname, '../js', name), 'utf8'), { imports, globals, filename: name });
}

test('the fitted Grotestraat fronts face the street and the Lunteren roofscape retains surveyed collision', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const bytes = gunzipSync(readFileSync(join(__dirname, '../assets/ede-terrain-tiles/collision.bin.gz')));
  const field = decodeTerrain(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const terrain = { getTerrain: () => field, terrainHeightAt: (x, z) => sampleTerrain(field, x, z) };
  const labels = [];
  const document = { createElement: () => ({ getContext: () => ({
    fillRect() {}, save() {}, translate() {}, fillText(text) { labels.push(text); }, restore() {},
  }) }) };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  }, { document });
  const sites = load('ede-grotestraat-sites.js');
  const survey = load('ede-dorpsstraat-survey.js');
  const { buildGrotestraatShopfronts, buildDorpsstraatRoofs } = load('ede-street-pilots.js', {
    'three/webgpu': three, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    './ede-grotestraat-sites.js': sites, './ede-dorpsstraat-survey.js': survey,
    './ede-survey-landmark.js': load('ede-survey-landmark.js', {
      './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    }),
  });
  const shopfronts = buildGrotestraatShopfronts();
  assert.equal(shopfronts.userData.shopCount, 16);
  assert.ok(labels.includes('Snoopies') && labels.includes('HEMA'));
  assert.equal(new Set(labels).size, 16);
  assert.equal(sites.isGrotestraatPilotShop('HEMA', -61, 78.9), true);
  assert.equal(sites.isGrotestraatPilotShop('HEMA', -3573.7, -4459.6), false);
  const signGeometry = shopfronts.getObjectByName('Fitted shop signs').geometry;
  assert.ok(signGeometry.attributes.normal.getX(0) > 0.9, 'the west fronts point east');
  assert.ok(signGeometry.attributes.normal.getX(90) < -0.8, 'the east fronts point west');
  const firstShop = sites.GROTESTRAAT_SHOPS[0];
  const [ax, az] = firstShop.a;
  const [bx, bz] = firstShop.b;
  const outward = new three.Vector2(az - bz, bx - ax).normalize();
  const backing = shopfronts.getObjectByName('Shopfront trim, canopies and window displays').geometry.attributes.position;
  assert.ok(outward.dot(new three.Vector2(backing.getX(0) - ax, backing.getZ(0) - az)) > 0.22,
    'the display backing clears the offline façade thickness');
  const glass = shopfronts.getObjectByName('Shopfront glass');
  assert.equal(glass.material.transparent, true);
  assert.equal(glass.material.depthWrite, false);
  const roofscape = buildDorpsstraatRoofs();
  assert.equal(roofscape.userData.colliders.length, 5);
  assert.equal(new Set(survey.DORPSSTRAAT_BUILDINGS.flatMap(building => building.osmIds)).size, 6);
  assert.equal(roofscape.userData.solarPanelCount, 24);
  const roofDetail = roofscape.children.find(mesh => mesh.userData.nearDetail);
  const { color, normal, position, civicGloss } = roofDetail.geometry.attributes;
  let moduleVertices = 0;
  const panelColor = new three.Color(0x2e455f);
  for (let i = 0; i < position.count; i++) {
    if (civicGloss.getX(i) < 0.79 || Math.abs(color.getX(i) - panelColor.r) > 0.00001) continue;
    assert.ok(normal.getY(i) > 0.95, 'the visible cell plane faces upward');
    moduleVertices++;
  }
  assert.equal(moduleVertices, roofscape.userData.solarPanelCount * 6);
  for (const model of [shopfronts, roofscape]) model.traverse(mesh => {
    if (mesh.isMesh) assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite), mesh.name);
  });
});
