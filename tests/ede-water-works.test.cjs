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
  const features = [...asset.culverts, ...asset.weirs, ...asset.banks];
  assert.equal(new Set(features.map(r => r.id)).size, features.length);
  assert.equal(new Set(asset.suppressWaterEdges).size, asset.suppressWaterEdges.length);
  for (const r of [...asset.culverts, ...asset.weirs]) {
    assert.ok(inside(r.x, r.z), r.id);
    assert.ok([r.y, r.heading, r.width, r.height, r.sourceNap].every(Number.isFinite), r.id);
    assert.ok(r.width > 0 && r.height > 0, r.id);
  }
  const frankeneng = asset.weirs.find(r => r.code === 'KST-1106');
  assert.ok(frankeneng);
  assert.equal(frankeneng.type, 'gate');
  assert.equal(frankeneng.width, 2.41);
  assert.ok(Math.abs(frankeneng.y + SCENE_NAP_ORIGIN - 6.04) < .001);
  assert.ok(asset.culverts.some(r => r.shape === 'round'));
  assert.ok(asset.culverts.some(r => r.shape === 'box'));
  assert.ok(asset.banks.some(r => r.type === 'sheet'));
  assert.ok(asset.banks.some(r => r.type === 'timber'));
  for (const r of asset.banks) {
    assert.ok(r.points.length > 1 && r.points.every(([x, y, z]) => inside(x, z) && Number.isFinite(y)), r.id);
  }
});
