const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const assets = path.resolve(__dirname, '../assets');
const read = name => readFileSync(path.join(assets, name));
const json = name => JSON.parse(read(name));
const terrainFile = name => read(`ede-terrain-tiles/${name}`);
const canopyFile = name => read(`ede-forest-canopy/${name}`);

test('expansion collision uses measured 5 m terrain and retains the original town and local patches', async ({ mock }) => {
  let manifestStatus = 200;
  mock.method(globalThis, 'fetch', async url => {
    if (url.pathname.endsWith('/ede-terrain-tiles/manifest.json') && manifestStatus !== 200) {
      return new Response(null, { status: manifestStatus });
    }
    return new Response(readFileSync(url));
  });
  const terrain = await import('../js/terrain.js');
  const town = await terrain.loadTerrain({ expanded: true });
  const edition = terrain.getExpansionTerrain();
  assert.ok(edition);
  const { field, manifest } = edition;
  assert.equal(field.step, 5);
  assert.deepEqual([field.minX, field.minZ, field.maxX, field.maxZ], manifest.bounds);
  assert.equal(Number(field.napOrigin.toFixed(2)), 22.54);
  assert.equal(terrain.terrainHeightAt(0, 0), 0);
  assert.equal(terrain.getTerrainPatches().length, 3);
  assert.ok(terrain.terrainHeightAt(476, 651) - terrain.terrainHeightAt(476, 627) > 8);

  for (const [x, z] of [[-7004, -2301], [1951, -3188], [6209, 506], [8090, 3337]]) {
    assert.equal(terrain.terrainHeightAt(x, z), terrain.sampleTerrain(field, x, z));
  }
  assert.ok(Math.abs(terrain.terrainHeightAt(8090, 3337) - terrain.sampleTerrain(town, 8090, 3337)) > 1);
  for (const [x, z, dx, dz] of [
    [town.maxX, 0, 0.01, 0], [town.maxX, 2712, 0.01, 0], [town.minX, 0, -0.01, 0],
    [0, town.minZ, 0, -0.01], [0, town.maxZ, 0, 0.01]
  ]) {
    const atEdge = terrain.terrainHeightAt(x, z);
    assert.equal(atEdge, terrain.sampleTerrain(town, x, z));
    const error = Math.abs(terrain.terrainHeightAt(x + dx, z + dz) - atEdge);
    assert.ok(error < 0.002, `legacy collision seam at ${x}, ${z} jumps ${error.toFixed(3)} m`);
  }

  manifestStatus = 404;
  await terrain.loadTerrain({ expanded: true });
  assert.equal(terrain.getExpansionTerrain(), null);
  assert.equal(terrain.terrainHeightAt(8090, 3337), terrain.sampleTerrain(town, 8090, 3337));
});

test('terrain hierarchy covers the expansion and stores the collision vertices at every level', () => {
  const manifest = json('ede-terrain-tiles/manifest.json');
  const collision = terrainFile('collision.bin');
  const [west, north, east, south] = manifest.bounds;
  const columns = collision.readUInt32LE(4);
  const rows = collision.readUInt32LE(8);
  assert.equal(columns, (east - west) / 5 + 1);
  assert.equal(rows, (south - north) / 5 + 1);
  const town = read('ede-ahn.bin');
  const townWest = town.readFloatLE(12), townNorth = town.readFloatLE(16);
  const townStep = town.readFloatLE(20);
  const townEast = townWest + (town.readUInt32LE(4) - 1) * townStep;
  const townSouth = townNorth + (town.readUInt32LE(8) - 1) * townStep;
  const visited = new Set(), leaves = new Set();
  function visit(id, parent) {
    assert.ok(!visited.has(id), `duplicate tile ${id}`);
    visited.add(id);
    const tile = manifest.tiles[id];
    const [x, z, maxX, maxZ] = tile.bounds, size = maxX - x;
    assert.equal(size, maxZ - z);
    assert.ok(x >= west && z >= north && maxX <= east && maxZ <= south);
    if (parent) {
      assert.equal(size * 2, parent[2] - parent[0]);
      assert.ok(x === parent[0] || x === parent[0] + size);
      assert.ok(z === parent[1] || z === parent[1] + size);
    }
    const raw = terrainFile(`${id}.bin`);
    assert.equal(raw.length, tile.bytes);
    assert.equal(raw.length, 51 * 51 * 5);
    const stride = size / 250;
    for (const row of [0, 1, 25, 49, 50]) for (const col of [0, 1, 25, 49, 50]) {
      const collisionIndex = ((z - north) / 5 + row * stride) * columns + (x - west) / 5 + col * stride;
      assert.equal(raw.readInt16LE((row * 51 + col) * 5), collision.readInt16LE(28 + collisionIndex * 2));
    }
    if (size === 250) {
      assert.equal(tile.error, 0);
      assert.ok(!leaves.has(`${x}/${z}`));
      leaves.add(`${x}/${z}`);
    }
    for (const child of tile.children ?? []) visit(child, tile.bounds);
  }
  for (const id of manifest.roots) visit(id);
  assert.equal(visited.size, Object.keys(manifest.tiles).length);
  for (let x = west; x < east; x += 250) for (let z = north; z < south; z += 250) {
    const insideTown = x >= townWest && z >= townNorth && x + 250 <= townEast && z + 250 <= townSouth;
    assert.equal(leaves.has(`${x}/${z}`), !insideTown, `coverage at ${x}, ${z}`);
  }
});

test('canopy mesh payloads share exact top heights along equal-resolution tile seams', () => {
  const { cells } = json('ede-forest-canopy/manifest.json');
  const [west, north, east, south] = json('ede-terrain-tiles/manifest.json').bounds;
  const byId = new Map(cells.map(cell => [cell.id, cell]));
  assert.equal(byId.size, cells.length);
  const tiles = new Map();
  const edge = 50;
  const side = edge + 1;
  const maskBytes = edge * edge;
  for (const { id, bounds: [x, z, maxX, maxZ], step, children } of cells) {
    assert.equal(maxX - x, edge * step);
    assert.equal(maxZ - z, edge * step);
    for (const child of children ?? []) {
      const { bounds: [childX, childZ, childMaxX, childMaxZ], step: childStep } = byId.get(child);
      assert.equal(childStep * 2, step);
      assert.ok(childX >= x && childZ >= z && childMaxX <= maxX && childMaxZ <= maxZ);
    }
    const data = canopyFile(`${id}.bin`);
    assert.equal(data.length, maskBytes + side * side * 2);
    const top = (row, col) => data.readInt16LE(maskBytes + (row * side + col) * 2);
    let coverage = 0;
    for (let i = 0; i < maskBytes; i++) {
      if (!data[i]) continue;
      coverage++;
      const row = Math.floor(i / edge), col = i % edge;
      assert.ok(x + col * step >= west && x + (col + 1) * step <= east);
      assert.ok(z + row * step >= north && z + (row + 1) * step <= south);
      for (const dz of [0, 1]) for (const dx of [0, 1]) {
        assert.ok(top(row + dz, col + dx) > 0);
      }
    }
    assert.ok(coverage > 0);
    tiles.set(`${step}/${x}/${z}`, { x, z, step, top });
  }
  const seams = new Set();
  for (const { x, z, step, top } of tiles.values()) {
    const east = tiles.get(`${step}/${x + edge * step}/${z}`);
    const south = tiles.get(`${step}/${x}/${z + edge * step}`);
    if (east || south) seams.add(step);
    for (let i = 0; i < side; i++) {
      if (east) assert.equal(top(i, edge), east.top(i, 0));
      if (south) assert.equal(top(edge, i), south.top(0, i));
    }
  }
  assert.deepEqual(seams, new Set([10, 20]));
});
