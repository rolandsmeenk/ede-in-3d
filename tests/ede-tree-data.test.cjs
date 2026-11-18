const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

test('the combined tree asset retains the mapped extent, multiple type groups and measured sizes', async () => {
  const { decodeEdeTrees, edeTreeSite } = await import('../js/ede-tree-data.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const raw = readFileSync(join(__dirname, '../assets/ede-trees.bin'));
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const trees = decodeEdeTrees(buffer);
  const types = new Set();
  const [minX, minZ, maxX, maxZ] = EDE_DATA.meta.bounds;
  let combined = 0, osm = 0;
  for (const tree of trees) {
    assert.ok(tree.x >= minX - 0.1 && tree.x <= maxX + 0.1 && tree.z >= minZ - 0.1 && tree.z <= maxZ + 0.1);
    types.add(tree.species);
    if ((tree.sources & 3) === 3 && tree.height && tree.trunkDiameter) combined++;
    if (tree.sources & 4) osm++;
  }
  assert.ok(trees.length > 45000);
  assert.ok(combined > 1000 && osm > 1000);
  assert.deepEqual([...types].sort((a, b) => a - b), [0, 1, 2, 3, 255]);
  assert.throws(() => decodeEdeTrees(buffer.slice(0, -1)), /Invalid Ede tree asset/);
  const known = trees.find(tree => tree.species === 3 && tree.height && tree.trunkDiameter);
  const site = edeTreeSite(known, 5);
  assert.equal(site.species, 3);
  assert.equal(site.height, known.height);
  assert.equal(site.trunkDiameter, known.trunkDiameter);
  assert.equal(site.y, 5.09);
  const unknown = trees.find(tree => tree.species === 255 && !tree.height);
  const estimated = edeTreeSite(unknown, 0);
  assert.equal(estimated.height, edeTreeSite(unknown, -10).height);
  assert.ok(estimated.tier > 0);
  assert.ok(estimated.height > 0 && estimated.species >= 0 && estimated.species <= 3);
});
