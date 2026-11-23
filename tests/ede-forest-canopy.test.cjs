const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { setImmediate: flush } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { loadModule } = require('./helpers/module.cjs');

const canopyFile = join(__dirname, '../js/ede-forest-canopy.js');
const side = 51;
function canopyCell(cells) {
  const buffer = new ArrayBuffer(2500 + side * side * 2);
  const mask = new Uint8Array(buffer, 0, 2500);
  const heights = new DataView(buffer, 2500);
  for (const [x, z] of cells) mask[z * 50 + x] = 255;
  for (let i = 0; i < side * side; i++) heights.setInt16(i * 2, 4254, true);
  return buffer;
}

async function models(globals = {}) {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const code = readFileSync(canopyFile, 'utf8').replace('import.meta.url', 'canopyUrl')
    .replace('export async function loadForestCanopy', 'async function loadForestCanopy');
  return { three, ...loadModule(code, {
    filename: canopyFile,
    imports: {
      './ede-landscape-geometry.js': await import('../js/ede-landscape-geometry.js'),
      './ede-landscape-jobs.js': {},
      'three/webgpu': three, 'three/tsl': tsl,
      './ede-scene-coordinates.js': { SCENE_NAP_ORIGIN: 22.54 },
      './ede-playable-boundary.js': { playableBoundsCovered: () => true },
      './terrain.js': { terrainHeightAt: () => 0 },
      './tree-seasons.js': {},
    },
    globals: { URL, AbortController, canopyUrl: pathToFileURL(canopyFile), ...globals },
  }) };
}

test('canopy shoulders taper inward and adjoining crown polygons use matching seam vertices', async () => {
  const { canopyGeometry } = await models();
  const { geometry, outlines } = canopyGeometry(canopyCell([[5, 5], [6, 5], [5, 6], [6, 6]]),
    { bounds: [0, 0, 500, 500], step: 10, neighborMask: [0, 0, 0, 0] });
  const { position, normal } = geometry.attributes;
  const shoulder = outlines.get(5 * 50 + 5).find(i => position.getX(i) === 60 && position.getZ(i) === 50);
  assert.ok(shoulder);
  assert.ok(position.getY(shoulder) < 20 && position.getY(shoulder) > 12);
  assert.ok(normal.getY(shoulder) > 0 && normal.getZ(shoulder) < 0);
  const top = 5 * side + 6;
  assert.equal(position.getY(top), 20);
  assert.ok(position.getZ(top) > position.getZ(shoulder));
  assert.ok(position.getZ(shoulder + 2) > position.getZ(shoulder), 'the wall bends back under the crown');
  assert.ok(Math.abs(position.getY(shoulder + 2) - 0.18) < 1e-6);

  const left = canopyGeometry(canopyCell([[49, 10], [49, 11]]),
    { bounds: [-500, 0, 0, 500], step: 10, neighborMask: [0, 2 ** 10, 0, 0] });
  const right = canopyGeometry(canopyCell([[0, 10]]),
    { bounds: [0, 0, 500, 500], step: 10, neighborMask: [0, 0, 0, 2 ** 10 + 2 ** 11] });
  const seam = (g, i) => [...g.geometry.attributes.position.array.slice(i * 3, i * 3 + 3)];
  assert.deepEqual(seam(left, 11 * side + 50), seam(right, 11 * side));
  assert.ok(seam(left, 11 * side + 50)[2] < 110, 'the rounded shoulder travels along the stitched seam');
});

test('canopy tiles hold the visible level while loading and crossfade both directions', async () => {
  let now = 0;
  const requests = new Map();
  const { three, createForestCanopy } = await models({
    performance: { now: () => now },
    fetch: url => new Promise(resolve => requests.set(url.pathname.split('/').pop(), resolve)),
  });
  const source = [
    { id: 'parent', bounds: [0, 0, 1000, 1000], step: 20, children: ['west', 'east'] },
    { id: 'west', bounds: [0, 0, 500, 500], step: 10 },
    { id: 'east', bounds: [500, 0, 1000, 500], step: 10 },
  ];
  const canopy = createForestCanopy(new three.Scene(), source, false);
  const camera = new three.PerspectiveCamera(60, 1.5, 1, 8000);
  const update = (z, time) => {
    now = time;
    camera.position.set(500, 200, z);
    camera.lookAt(500, 20, 500);
    camera.updateMatrixWorld();
    canopy.update(camera, {});
  };
  async function resolve(id) {
    const reply = requests.get(id + '.bin');
    assert.ok(reply, 'requested ' + id);
    reply({ ok: true, arrayBuffer: async () => canopyCell([[10, 10]]) });
    await flush();
  }
  const visible = () => canopy.group.children.filter(tile => tile.visible)
    .map(tile => tile.userData.lodRange.toArray());

  update(2400, 0);
  await resolve('parent');
  update(2400, 30);
  assert.deepEqual(visible(), [[0, 1]]);
  update(2100, 140);
  await resolve('west');
  update(2100, 180);
  assert.deepEqual(visible(), [[0, 1]], 'both detailed tiles must be ready');
  await resolve('east');
  update(2100, 210);
  assert.deepEqual(visible(), [[0, 1], [0, 0], [0, 0]]);
  update(2100, 410);
  assert.deepEqual(visible(), [[0.5, 1], [0, 0.5], [0, 0.5]]);
  update(2100, 610);
  assert.deepEqual(visible(), [[0, 1], [0, 1]]);

  update(2400, 720);
  update(2400, 920);
  assert.deepEqual(visible(), [[0.5, 1], [0, 0.5], [0, 0.5]]);
  update(2400, 1120);
  assert.deepEqual(visible(), [[0, 1]]);
});
