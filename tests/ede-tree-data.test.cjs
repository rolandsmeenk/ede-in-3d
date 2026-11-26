const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

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
  const treeAtEntrance = trees.filter(tree => Math.hypot(tree.x + 752.4, tree.z - 782) <= 2.5);
  assert.equal(treeAtEntrance.length, 1);
  assert.ok(treeAtEntrance[0].sources & 8);
  assert.equal(treeAtEntrance[0].height, 15.2);
  assert.equal(edeTreeSite(treeAtEntrance[0], 0).crownWidth, 12.5);
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

test('EDT3 retains optional crown and phenology data independently', async () => {
  const { decodeEdeTrees, edeTreeSite } = await import('../js/ede-tree-data.js');
  const header = Buffer.alloc(8);
  header.write('EDT3');
  header.writeUInt32LE(3, 4);
  function record(x, sources, extras) {
    const row = Buffer.alloc(9);
    row.writeInt16LE(x * 5);
    row.writeUInt16LE(180, 4);
    row[7] = 255;
    row[8] = sources;
    return Buffer.concat([row, Buffer.from(extras)]);
  }
  const rows = [record(7, 1, []), record(11, 80, [111]), record(15, 168, [128, 6])];
  const bytes = Buffer.concat([header, ...rows]);
  const [ordinary, derived, surveyed] = decodeEdeTrees(Uint8Array.from(bytes).buffer);
  assert.equal(edeTreeSite(ordinary, 0).seasonGroup, 0);
  assert.equal(derived.crownWidth, 11.1);
  assert.equal(derived.seasonGroup, undefined);
  assert.equal(surveyed.crownWidth, 12.8);
  assert.equal(edeTreeSite(surveyed, 2).seasonGroup, 6);
  assert.ok(edeTreeSite(surveyed, 2).priority);
  bytes[bytes.length - 1] = 8;
  assert.throws(() => decodeEdeTrees(Uint8Array.from(bytes).buffer), /Invalid Ede tree asset/);
  assert.throws(() => decodeEdeTrees(Uint8Array.from(bytes.subarray(0, -1)).buffer), /Invalid Ede tree asset/);
});

test('the expanded inventory preserves existing trunks, including one surveyed school tree', async () => {
  const { decodeEdeTrees } = await import('../js/ede-tree-data.js');
  const asset = name => decodeEdeTrees(Uint8Array.from(readFileSync(join(__dirname, '../assets', name))).buffer);
  const baseline = asset('ede-trees.bin');
  const expanded = asset('ede-trees-expanded.bin');
  const key = ({ x, z }) => `${x},${z}`;
  const trunkKeys = new Set(expanded.map(key));
  assert.ok(expanded.length > baseline.length);
  assert.ok(baseline.every(tree => trunkKeys.has(key(tree))));
  const atSchool = expanded.filter(tree => Math.hypot(tree.x + 752.4, tree.z - 782) < 6);
  assert.equal(atSchool.length, 1);
  assert.equal(atSchool[0].sources & 24, 24);
  assert.equal(atSchool[0].crownWidth, 12.5);
  assert.equal(atSchool[0].height, 15.2);
});

test('mapped forest composition places evergreen Scots pine in the surveyed Roekel interior', async () => {
  const { decodeEdeWoodland, edeTreeSite, woodlandTreeSpecies } = await import('../js/ede-tree-data.js');
  const buffer = Uint8Array.from(gunzipSync(readFileSync(join(__dirname, '../assets/ede-woodland.bin.gz')))).buffer;
  const { coverAt, pineCells, step } = decodeEdeWoodland(buffer);
  assert.equal(step, 8);
  assert.ok(pineCells.length > 4000);
  for (const [x, z] of pineCells) assert.equal(coverAt(x, z), 4);
  const points = [];
  for (let x = 4900; x < 6000; x += 16) for (let z = -4900; z < -4200; z += 16) {
    if (coverAt(x, z) === 4) points.push({ x, z });
  }
  assert.ok(points.length > 100);
  const { x, z } = points[0];
  const species = woodlandTreeSpecies(coverAt(x, z), x, z);
  assert.equal(species, 4);
  assert.equal(edeTreeSite({ x, z, height: 18, species }, 0).seasonGroup, 1);
  assert.equal(coverAt(100000, 100000), 0);
  assert.equal(woodlandTreeSpecies(0, x, z, 2), 2);
  assert.equal(woodlandTreeSpecies(1, x, z, 0), 0);
  assert.equal(woodlandTreeSpecies(2, x, z), 3);
  const mixedSpecies = new Set(Array.from({ length: 50 }, (_, i) => woodlandTreeSpecies(3, x + i, z, 0)));
  assert.deepEqual(mixedSpecies, new Set([0, 3]));
  assert.throws(() => decodeEdeWoodland(buffer.slice(0, -1)), /Invalid Ede woodland extent/);
});
