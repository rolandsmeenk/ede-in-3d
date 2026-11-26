const assert = require('node:assert/strict');
const test = require('node:test');

test('the baked water works preserve unique sources, supported dimensions and the Frankeneng sill', async () => {
  const { EDE_DATA, readMapAsset } = await import('../js/ede-geodata.js');
  const { SCENE_NAP_ORIGIN } = await import('../js/ede-scene-coordinates.js');
  const { pathToFileURL } = require('node:url');
  const { resolve } = require('node:path');
  const asset = await readMapAsset(pathToFileURL(resolve(__dirname, '../assets/ede-water-works.json.gz')));
  assert.equal(asset.version, 1);
  assert.equal(asset.license, 'CC-BY-SA-4.0');
  const [minX, minZ, maxX, maxZ] = EDE_DATA.meta.bounds;
  const inside = (x, z) => x >= minX - .02 && x <= maxX + .02 && z >= minZ - .02 && z <= maxZ + .02;
  assert.equal(new Set(asset.weirs.map(r => r.id)).size, asset.weirs.length);
  for (const field of ['culverts', 'banks', 'suppressWaterEdges']) assert.ok(!(field in asset), field);
  for (const r of asset.weirs) {
    assert.ok(inside(r.x, r.z), r.id);
    assert.ok([r.y, r.heading, r.width, r.height, r.sourceNap].every(Number.isFinite), r.id);
    assert.ok(r.width > 0 && r.height > 0, r.id);
  }
  const frankeneng = asset.weirs.find(r => r.code === 'KST-1106');
  assert.ok(frankeneng);
  assert.equal(frankeneng.type, 'gate');
  assert.equal(frankeneng.width, 2.41);
  assert.ok(Math.abs(frankeneng.y + SCENE_NAP_ORIGIN - 6.04) < .001);
  assert.ok(asset.weirs.some(r => r.type === 'fixed'));
});
