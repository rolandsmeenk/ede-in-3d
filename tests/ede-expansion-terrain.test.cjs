const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');
const { loadModule } = require('./helpers/module.cjs');

const assets = path.resolve(__dirname, '../assets');
const read = name => readFileSync(path.join(assets, name));
const json = name => JSON.parse(read(name));
const terrainFile = name => read(`ede-terrain-tiles/${name}`);
const canopyFile = name => read(`ede-forest-canopy/${name}`);

test('expansion collision uses measured 5 m terrain and retains the original town and local patches', async ({ mock }) => {
  let manifestStatus = 200, expandedRequests = 0;
  mock.method(globalThis, 'fetch', async url => {
    if (url.pathname.includes('/ede-terrain-tiles/')) expandedRequests++;
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
  assert.deepEqual([field.minX, field.minZ, field.maxX, field.maxZ], manifest.collisionBounds);
  assert.ok(field.heights instanceof Int16Array);
  const { overviewField, rootSamples } = edition;
  assert.equal(overviewField.step, 40);
  assert.equal(rootSamples.byteLength, manifest.roots.length * 13 ** 2 * 2);
  const [east, z] = [manifest.bounds[2] - 100, 0];
  assert.equal(terrain.terrainHeightAt(east, z), terrain.sampleTerrain(overviewField, east, z));
  assert.equal(Number(field.napOrigin.toFixed(2)), 22.54);
  assert.equal(terrain.terrainHeightAt(0, 0), 0);
  assert.equal(terrain.getTerrainPatches().length, 8);
  assert.equal(terrain.getTerrainPatch(-3316.529, 2704.732)?.step, 3);
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

  expandedRequests = 0;
  await terrain.loadTerrain();
  assert.equal(expandedRequests, 0);
  assert.equal(terrain.getExpansionTerrain(), null);
  assert.equal(terrain.getTerrainPatches().length, 8);
  assert.equal(terrain.getTerrainPatch(-3316.529, 2704.732)?.step, 3);
});

test('buffered terrain covers the northern sites and adjoining 5 m tiles share vertices', async () => {
  const { geographicBounds, northDetail } = require('../tools/data/ede-outer-coverage.json');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { projectLonLatInto } = await import('../js/ede-scene-coordinates.js');
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const manifest = json('ede-terrain-tiles/manifest.json');
  const field = decodeTerrain(Uint8Array.from(gunzipSync(terrainFile(manifest.collisionFile))).buffer, true);
  const project = ([lon, lat]) => projectLonLatInto(EDE_DATA.meta.lonLatAffine, lon, lat, {});
  const [south, west, north, east] = geographicBounds;
  for (const [lon, lat] of [[west, north], [east, north], [west, south], [east, south], ...northDetail.arrivals]) {
    const { x, z } = project([lon, lat]);
    assert.ok(x >= field.minX && x <= field.maxX && z >= field.minZ && z <= field.maxZ, `${lon},${lat}`);
    assert.ok(Number.isFinite(sampleTerrain(field, x, z)));
  }
  const station = project(northDetail.arrivals[0]);
  const summit = project(northDetail.arrivals[1]);
  assert.ok(sampleTerrain(field, summit.x, summit.z) - sampleTerrain(field, station.x, station.z) > 20,
    'Goudsberg rises above the station');
  let seams = 0;
  for (const id of Object.keys(manifest.tiles)) {
    const [size, x, z] = id.split('_').map(Number);
    if (size !== 250 || z !== -4250) continue;
    const southId = `250_${x}_-4000`;
    if (!manifest.tiles[southId]) continue;
    assert.deepEqual(terrainFile(`${id}.bin`).subarray(50 * 51 * 5),
      terrainFile(`${southId}.bin`).subarray(0, 51 * 5), `seam at ${x}`);
    seams++;
  }
  assert.ok(seams > 40);
});

test('terrain hierarchy covers the 2 km envelope and uses exact collision vertices at every level', async () => {
  const manifest = json('ede-terrain-tiles/manifest.json');
  const { createCoverageIndex, edeCoverage } = await import('../js/ede-coverage.js');
  const coverage = createCoverageIndex(edeCoverage.terrainBoundary);
  const { decodeTerrain } = await import('../js/terrain.js');
  const collision = decodeTerrain(Uint8Array.from(gunzipSync(terrainFile(manifest.collisionFile))).buffer, true);
  const [west, north, east, south] = manifest.bounds;
  const { columns, rows, minX, minZ, maxX, maxZ } = collision;
  assert.deepEqual([minX, minZ, maxX, maxZ], manifest.collisionBounds);
  assert.equal(columns, (maxX - minX) / 5 + 1);
  assert.equal(rows, (maxZ - minZ) / 5 + 1);
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
    assert.equal(x % size || 0, 0);
    assert.equal(z % size || 0, 0);
    assert.ok(coverage.overlapsBounds(...tile.bounds));
    assert.ok(tile.range[0] <= tile.range[1]);
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
      const gx = (x - minX) / 5 + col * stride, gz = (z - minZ) / 5 + row * stride;
      const sample = raw.readInt16LE((row * 51 + col) * 5);
      assert.ok(sample >= tile.range[0] && sample <= tile.range[1]);
      if (gx >= 0 && gz >= 0 && gx < columns && gz < rows) assert.equal(sample, collision.heights[gz * columns + gx]);
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
    if (insideTown) assert.equal(leaves.has(`${x}/${z}`), false);
    else if (coverage.coversBounds(x, z, x + 250, z + 250)) {
      assert.ok(leaves.has(`${x}/${z}`), `coverage at ${x}, ${z}`);
    }
  }
});

async function terrainRenderer() {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const terrain = await import('../js/terrain.js');
  const filename = path.resolve(__dirname, '../js/ede-terrain-tiles.js');
  const tiles = loadModule(readFileSync(filename, 'utf8'), { filename, imports: {
    './ede-landscape-geometry.js': await import('../js/ede-landscape-geometry.js'),
    './ede-landscape-jobs.js': {}, './ede-grade.js': { expansionGradeCuts: () => [] },
    'three/webgpu': three, 'three/tsl': {}, './aerial-colors.js': {},
    './tsl-materials.js': {}, './ede-snow.js': {}, './ede-playable-boundary.js': {}, './ede-coverage.js': {},
    './terrain.js': { ...terrain, expansionSeamOffset: () => 0 },
  } });
  return { three, terrain, ...tiles };
}

test('expanded terrain cuts remove lower ground and retain terrain above a covered crossing', async () => {
  const { three, tileGeometry } = await terrainRenderer();
  const buffer = new ArrayBuffer(4 * 5);
  const samples = new DataView(buffer);
  for (const [i, height] of [2200, 2400, 2200, 2400].entries()) {
    samples.setInt16(i * 5, height, true);
    samples.setUint8(i * 5 + 2, (i % 2) * 200);
  }
  const bounds = [0, 0, 10, 10], skirts = [3, 3, 3, 3];
  const legacy = { minX: -100, minZ: -100, maxX: -50, maxZ: -50 };
  const field = { napOrigin: 22 };
  const cut = { minX: 2, minZ: 2, maxX: 8, maxZ: 8,
    planes: [[1, 0, 2], [-1, 0, -8], [0, 1, 2], [0, -1, -8]] };
  const hits = ({ gradeCuts }, x, z) => {
    const geometry = tileGeometry(buffer, { bounds, skirts, gradeCuts }, legacy, field, 2);
    const mesh = new three.Mesh(geometry, new three.MeshBasicMaterial());
    const ray = new three.Raycaster(new three.Vector3(x, 20, z), new three.Vector3(0, -1, 0));
    return ray.intersectObject(mesh);
  };

  assert.equal(hits({}, 3, 4).length, 1);
  assert.equal(hits({ gradeCuts: [cut] }, 3, 4).length, 0);
  assert.equal(hits({ gradeCuts: [cut] }, 7, 4).length, 0);
  assert.equal(hits({ gradeCuts: [cut] }, 9, 4).length, 1);

  const covered = { gradeCuts: [{ ...cut, ceiling: 1 }] };
  assert.equal(hits(covered, 3, 4).length, 0);
  const [overhead] = hits(covered, 7, 4);
  assert.ok(Math.abs(overhead.point.y - 1.375) < 1e-6);
  const colors = overhead.object.geometry.attributes.color.array;
  assert.ok(colors.includes(100) && colors.includes(160), 'new edge vertices keep interpolated aerial colors');
  const { normal } = overhead.object.geometry.attributes;
  const { a, b, c } = overhead.face;
  for (const i of [a, b, c]) {
    assert.ok(Math.abs(normal.getX(i) + 0.2 / Math.hypot(0.2, 1)) < 1e-6);
    assert.ok(Math.abs(normal.getY(i) - 1 / Math.hypot(0.2, 1)) < 1e-6);
  }
});

test('coarse terrain retains land between many small cuts in one triangle', async () => {
  const { three, tileGeometry } = await terrainRenderer();
  const gradeCuts = [];
  for (let x = 3; x < 27; x += 4) for (let z = 3; z < 27; z += 4) {
    gradeCuts.push({ minX: x, minZ: z, maxX: x + 1, maxZ: z + 1,
      planes: [[1, 0, x], [-1, 0, -x - 1], [0, 1, z], [0, -1, -z - 1]] });
  }
  const tile = { bounds: [0, 0, 64, 64], skirts: [3, 3, 3, 3], gradeCuts };
  const legacy = { minX: -100, minZ: -100, maxX: -50, maxZ: -50 };
  const geometry = tileGeometry(new ArrayBuffer(4 * 5), tile, legacy, { napOrigin: 0 }, 2);
  const mesh = new three.Mesh(geometry, new three.MeshBasicMaterial());
  const ray = new three.Raycaster(new three.Vector3(0, 5, 0), new three.Vector3(0, -1, 0));
  for (const { minX, minZ } of gradeCuts) {
    ray.ray.origin.set(minX + 0.3, 5, minZ + 0.7);
    assert.equal(ray.intersectObject(mesh).length, 0);
    ray.ray.origin.x = minX + 1.6;
    assert.equal(ray.intersectObject(mesh).length, 1);
  }
});

test('buffered roots draw immediately after camera jumps while detail fetches wait', async ({ mock }) => {
  const [three, tsl, terrain, coverage] = await Promise.all([
    import('../vendor/three/build/three.webgpu.js'), import('../vendor/three/build/three.tsl.js'),
    import('../js/terrain.js'), import('../js/ede-coverage.js'),
  ]);
  mock.method(globalThis, 'fetch', async url => new Response(readFileSync(url)));
  await terrain.loadTerrain({ expanded: true });
  let pending = 0, canceled = 0;
  const fetchTile = (_url, { signal }) => {
    pending++;
    signal.addEventListener('abort', () => { pending--; canceled++; });
    return new Promise(() => {});
  };
  const filename = path.resolve(__dirname, '../js/ede-terrain-tiles.js');
  const { createTerrainTiles } = loadModule(readFileSync(filename, 'utf8'), {
    filename, globals: { URL, AbortController, performance, fetch: fetchTile },
    imports: {
      './ede-landscape-geometry.js': await import('../js/ede-landscape-geometry.js'),
    './ede-landscape-jobs.js': {}, './ede-grade.js': { expansionGradeCuts: () => [] },
    'three/webgpu': three, 'three/tsl': tsl, './aerial-colors.js': { sampleGroundColor: () => false },
      './ede-snow.js': { applySnowMaterial: material => material },
      './tsl-materials.js': { heathSeasonColor: color => color, wetFilm: tsl.float(0) },
      './ede-playable-boundary.js': {}, './ede-coverage.js': coverage, './terrain.js': terrain,
    },
  });
  const scene = new three.Scene();
  const renderer = createTerrainTiles(scene, null);
  const group = scene.getObjectByName('EdeTerrainQuadtree');
  const camera = new three.PerspectiveCamera(56, 1.6, .35, 60000);
  const { updateViewRange } = loadModule(readFileSync(path.resolve(__dirname, '../js/scene-culling.js'), 'utf8'),
    { imports: { 'three/webgpu': three } });
  for (const [eye, target] of [
    [[18000, 700, -6000], [20300, 22, -6000]], [[-6750, 550, 250], [-8800, 16, 500]],
    [[10700, 750, -11200], [10600, 21, -13100]],
  ]) {
    camera.position.set(...eye);
    camera.lookAt(...target);
    renderer.update(camera, updateViewRange(camera, 700, terrain.terrainHeightAt(eye[0], eye[2])));
    const visible = group.children.filter(mesh => mesh.visible);
    assert.ok(visible.length > 0);
    assert.equal(renderer.stats.residentBytes, 0);
    assert.equal(renderer.stats.drawCalls, 0);
    for (const mesh of visible) mesh.onBeforeRender(null, null, null, mesh.geometry);
    assert.equal(renderer.stats.drawCalls, visible.length);
    assert.ok(renderer.stats.triangles >= visible.length);
  }
  assert.equal(pending, 4);
  assert.ok(canceled > 0, 'camera jumps abandon stale tile requests');
});

test('the finer tile skirt reaches below a much coarser neighbour and faces the gap', async () => {
  const { three, terrain, sizeTerrainSkirts, tileGeometry } = await terrainRenderer();
  const { roots, tiles } = json('ede-terrain-tiles/manifest.json');
  const field = terrain.decodeTerrain(Uint8Array.from(gunzipSync(terrainFile('collision.bin.gz'))).buffer);
  const town = terrain.decodeTerrain(Uint8Array.from(read('ede-ahn.bin')).buffer);
  sizeTerrainSkirts(Object.values(tiles), roots.map(id => tiles[id]), field);
  const fineId = '250_6500_0', coarseId = '4000_4000_-4000';
  const fine = tiles[fineId], coarse = tiles[coarseId];
  const rawFine = terrainFile(fineId + '.bin'), rawCoarse = terrainFile(coarseId + '.bin');
  function height(raw, tile, row, x) {
    const [west, , east] = tile.bounds;
    const u = (x - west) * 50 / (east - west), i = Math.floor(u);
    const at = j => raw.readInt16LE(5 * (51 * row + j)) / 100 - field.napOrigin;
    return at(i) + (at(i + 1) - at(i)) * (u - i);
  }
  let peak = 0, testX;
  for (let x = fine.bounds[0] + 0.01; x < fine.bounds[2]; x += 5) {
    const gap = height(rawFine, fine, 0, x) - height(rawCoarse, coarse, 50, x);
    if (gap > peak) {
      peak = gap;
      testX = x;
    }
  }
  assert.ok(peak > 8 && fine.skirts[0] > peak, 'the previous 3 m skirt left a gap');
  const mesh = new three.Mesh(tileGeometry(Uint8Array.from(rawFine).buffer, fine, town, field));
  const y = height(rawCoarse, coarse, 50, testX) - 0.025;
  const ray = new three.Raycaster(new three.Vector3(testX, y, -0.5), new three.Vector3(0, 0, 1), 0, 1);
  assert.ok(ray.intersectObject(mesh).length, 'the skirt is visible from the lower tile');
  assert.equal(mesh.geometry.index.count, (50 * 50 + 4 * 50) * 6, 'the skirt stays in the original mesh batch');
});

test('skirts cover the coarse overview while the neighbouring root payload loads', async () => {
  const { sizeTerrainSkirts } = await terrainRenderer();
  const field = { minX: 0, minZ: -250, step: 5, columns: 51, rows: 101, heights: new Float32Array(51 * 101) };
  field.heights[50 * 51 + 1] = 12;
  // The 5 m payload captures the peak, but the overview misses it.
  const root = { bounds: [0, -250, 250, 0], error: 0 };
  const leaf = { bounds: [0, 0, 250, 250], error: 0 };
  sizeTerrainSkirts([leaf, root], [root], field);
  assert.equal(leaf.skirts[0], 15);
  assert.equal(leaf.skirts[1], 3);
});

test('skirts stop at the retained town boundary within a tile edge segment', async () => {
  const { three, tileGeometry } = await terrainRenderer();
  const tile = { bounds: [0, 0, 10, 10], skirts: [3, 3, 3, 3] };
  const town = { minX: 2, minZ: -1, maxX: 4, maxZ: 1, columns: 2, rows: 2, step: 2, heights: [0, 0, 0, 0] };
  const mesh = new three.Mesh(tileGeometry(new ArrayBuffer(3 * 3 * 5), tile, town, { napOrigin: 0 }, 3));
  const hits = x => new three.Raycaster(new three.Vector3(x, -1, -0.5), new three.Vector3(0, 0, 1), 0, 1)
    .intersectObject(mesh).length;
  assert.ok(hits(1));
  assert.equal(hits(3), 0);
  assert.ok(hits(4.5));
});

test('both terrain resolutions follow the municipal edge and retain holes', async () => {
  const { three, tileGeometry, triangulateTerrainBoundary } = await terrainRenderer();
  const boundary = triangulateTerrainBoundary([[
    [2.3, 0, 10, 0, 10, 10, 2.3, 10], [5.1, 4.1, 5.1, 6.2, 7.4, 6.2, 7.4, 4.1],
  ]]);
  const tile = { bounds: [0, 0, 10, 10], skirts: [3, 3, 3, 3], boundary };
  const town = { minX: -10, minZ: -10, maxX: -5, maxZ: -5 };
  for (const side of [13, 51]) {
    const mesh = new three.Mesh(tileGeometry(new ArrayBuffer(side * side * 5), tile, town, { napOrigin: 0 }, side));
    const hits = (x, z) => new three.Raycaster(new three.Vector3(x, 5, z), new three.Vector3(0, -1, 0))
      .intersectObject(mesh).length;
    assert.equal(hits(2.29, 3), 0);
    assert.ok(hits(2.31, 3));
    assert.equal(hits(5.11, 5), 0);
    assert.ok(hits(5.09, 5));
  }
});

test('measured woodland canopy reaches the terrain buffer and stays inside its outer edge', async () => {
  const { createCoverageIndex, edeCoverage } = await import('../js/ede-coverage.js');
  const terrain = createCoverageIndex(edeCoverage.terrainBoundary);
  const playable = createCoverageIndex(edeCoverage.playableBoundary);
  const { version, cells, cover } = json('ede-forest-canopy/manifest.json');
  assert.equal(version, 2);
  assert.equal(cover.step, 20);
  const image = canopyFile('cover.png');
  assert.equal(image.readUInt32BE(16) * 20, cover.bounds[2] - cover.bounds[0]);
  assert.equal(image.readUInt32BE(20) * 20, cover.bounds[3] - cover.bounds[1]);
  let exterior = 0;
  for (const { id, bounds, step, maxY } of cells) {
    assert.ok(Number.isFinite(maxY));
    const [west, north] = bounds;
    if (terrain.coversBounds(...bounds) && playable.coversBounds(...bounds)) continue;
    const data = canopyFile(id + '.bin');
    for (let i = 0; i < 2500; i += 23) {
      if (!data[i]) continue;
      const x = west + i % 50 * step, z = north + Math.floor(i / 50) * step;
      for (const dx of [0, step]) for (const dz of [0, step]) {
        assert.ok(terrain.contains(x + dx, z + dz), `outside terrain: ${id} ${x}/${z}`);
      }
      if (!playable.contains(x + step / 2, z + step / 2)) exterior++;
    }
  }
  assert.ok(exterior > 1000);
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
  for (const { id, bounds: [x, z, maxX, maxZ], step, children, neighborMask } of cells) {
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
    const occupied = (row, col) => Number(data[row * edge + col] > 0);
    tiles.set(`${step}/${x}/${z}`, { x, z, step, top, occupied, neighborMask });
  }
  const seams = new Set();
  for (const { x, z, step, top, neighborMask } of tiles.values()) {
    const east = tiles.get(`${step}/${x + edge * step}/${z}`);
    const south = tiles.get(`${step}/${x}/${z + edge * step}`);
    const westTile = tiles.get(`${step}/${x - edge * step}/${z}`);
    const northTile = tiles.get(`${step}/${x}/${z - edge * step}`);
    if (east || south) seams.add(step);
    for (let i = 0; i < edge; i++) {
      const expected = [northTile?.occupied(edge - 1, i), east?.occupied(i, 0),
        south?.occupied(0, i), westTile?.occupied(i, edge - 1)];
      for (const [side, bit] of expected.entries()) assert.equal(Math.floor(neighborMask[side] / 2 ** i) % 2, bit ?? 0);
    }
    for (let i = 0; i < side; i++) {
      if (east) assert.equal(top(i, edge), east.top(i, 0));
      if (south) assert.equal(top(edge, i), south.top(0, i));
    }
  }
  assert.deepEqual(seams, new Set([10, 20]));
});

test('canopy walls reach the ground along connected crowns and leave continued tile edges open', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const filename = path.resolve(__dirname, '../js/ede-forest-canopy.js');
  const source = readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
    .replace('export async function loadForestCanopy', 'async function loadForestCanopy');
  const { canopyGeometry } = loadModule(source, { filename, globals: { URL }, imports: {
    './ede-landscape-geometry.js': await import('../js/ede-landscape-geometry.js'),
    './ede-landscape-jobs.js': {}, './ede-grade.js': { expansionGradeCuts: () => [] },
    'three/webgpu': three, 'three/tsl': {}, './ede-scene-coordinates.js': { SCENE_NAP_ORIGIN: 0 },
    './terrain.js': { terrainHeightAt: () => 5 }, './tree-seasons.js': {}, './ede-snow.js': {},
    './ede-playable-boundary.js': {
      containsPlayablePoint: x => x < 250,
      playableBoundsCovered: (_minX, _minZ, maxX) => maxX < 250,
      playableBoundsOverlap: minX => minX < 250,
    },
  } });
  const buffer = new ArrayBuffer(2500 + 51 * 51 * 2);
  const mask = new Uint8Array(buffer, 0, 2500);
  mask[10 * 50] = mask[10 * 50 + 1] = mask[20 * 50 + 20] = 255;
  new Int16Array(buffer, 2500).fill(1500);
  const mesh = new three.Mesh(canopyGeometry(buffer, {
    bounds: [0, 0, 500, 500], step: 10, neighborMask: [0, 0, 0, 2 ** 10],
  }).geometry);
  const hits = (origin, direction) =>
    new three.Raycaster(new three.Vector3(...origin), new three.Vector3(...direction), 0, 7).intersectObject(mesh);
  const edge = hits([15, 7, 98], [0, 0, 1])[0];
  assert.ok(edge && edge.point.z > 100, 'the forest side curves inward toward its base');
  assert.equal(hits([15, 4, 98], [0, 0, 1]).length, 0, 'the edge follows the ground elevation');
  assert.equal(hits([-2, 7, 105], [1, 0, 0]).length, 0, 'a forest crossing the cell edge has no internal wall');
  assert.equal(hits([205, 7, 198], [0, 0, 1]).length, 0, 'isolated crowns stay out of the forest walls');
  assert.ok(hits([205, 17, 205], [0, -1, 0]).length, 'the measured crown surface is retained');
  assert.equal(hits([19.8, 17, 100.2], [0, -1, 0]).length, 0, 'outward corners are bevelled');
  const buffered = canopyGeometry(buffer, { bounds: [0, 0, 500, 500], step: 10, buffered: true }).geometry;
  const exterior = buffered.getAttribute('exteriorCanopy');
  assert.equal(exterior.count, buffered.getAttribute('position').count);
  assert.equal(exterior.getX(0), 0, 'interior canopy can yield to nearby individual trees');
  assert.equal(exterior.getX(50), 1, 'exterior canopy stays visible near the municipal edge');
});
