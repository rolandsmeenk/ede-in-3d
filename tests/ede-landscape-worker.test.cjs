const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');

test('worker tile buffers match synchronous terrain and canopy geometry across the town seam', async ({ mock }) => {
  const terrain = await import('../js/terrain.js');
  const geom = await import('../js/ede-landscape-geometry.js');
  mock.method(globalThis, 'fetch', async url => new Response(readFileSync(url)));
  const legacy = await terrain.loadTerrain({ expanded: true });
  const { field, detail, manifest, directory } = terrain.getExpansionTerrain();
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    global.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
    import(workerData).then(() => parentPort.on('message', data => self.onmessage({ data })));
  `, { eval: true, workerData: pathToFileURL(path.join(__dirname, '../js/ede-landscape-worker.js')).href });
  async function render(message) {
    const reply = once(worker, 'message');
    worker.postMessage(message, [message.buffer]);
    const [result] = await reply;
    assert.equal(result.error, undefined);
    return result;
  }
  try {
    const crossing = Object.entries(manifest.tiles).find(([, { bounds: [w, n, e, s] }]) =>
      n < legacy.maxZ && s > legacy.minZ && w < legacy.maxX && e > legacy.maxX);
    const detailed = Object.entries(manifest.tiles).find(([, { bounds: [w, n, e, s] }]) =>
      e - w === 250 && w >= detail.minX && n >= detail.minZ && e <= detail.maxX && s <= detail.maxZ);
    for (const [entry, detailField] of [[crossing, null], [detailed, detail]]) {
      const [id, tileData] = entry;
      const tile = { bounds: tileData.bounds, skirts: [5, 5, 5, 5], detail: detailField };
      const buffer = Uint8Array.from(readFileSync(new URL(id + '.bin', directory))).buffer;
      const direct = geom.buildTerrainGeometry(buffer, tile, legacy, field, terrain.expansionSeamOffset);
      const context = terrain.captureTerrainContext(tile.bounds);
      assert.ok(context.expansion.field.heights.length < field.heights.length);
      const { mesh } = await render({ type: 'terrain', buffer, tile: { ...tile, detail: Boolean(detailField) }, context });
      assert.deepEqual(mesh, geom.packLandscapeGeometry(direct));
    }
    const x = Math.floor(legacy.maxX / 500) * 500, z = Math.floor(legacy.minZ / 500) * 500 + 500;
    const tile = { bounds: [x, z, x + 500, z + 500], step: 10, buffered: true, neighborMask: [0, 0, 0, 0] };
    const buffer = new ArrayBuffer(2500 + 51 * 51 * 2);
    new Uint8Array(buffer, 0, 2500).fill(1);
    new Int16Array(buffer, 2500).fill(9000);
    const boundary = [[[x, z - 100, x + 250, z - 100, x + 250, z + 600, x, z + 600]]];
    const { createCoverageIndex } = await import('../js/ede-boundary-index.js');
    const index = createCoverageIndex(boundary);
    const direct = geom.buildCanopyGeometry(buffer, tile, {
      napOrigin: 22.54, terrainHeightAt: terrain.terrainHeightAt, containsPlayablePoint: index.contains,
      playableBoundsCovered: index.coversBounds, playableBoundsOverlap: index.overlapsBounds,
    });
    const context = terrain.captureTerrainContext([x - 10, z - 10, x + 510, z + 510]);
    const mask = direct.mask.slice();
    const result = await render({ type: 'canopy', buffer, tile, context, boundary, napOrigin: 22.54 });
    assert.deepEqual(result, { mesh: geom.packLandscapeGeometry(direct.geometry), mask, outlines: direct.outlines });
  } finally {
    await worker.terminate();
  }
});
