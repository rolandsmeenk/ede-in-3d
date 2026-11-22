const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadModule } = require('./helpers/module.cjs');
const test = require('node:test');

const assets = resolve(__dirname, '../assets/ede-murals');
const readJSON = file => readFile(file, 'utf8').then(JSON.parse);

test('the mural asset matches the offline wall catalogue and uses bundled textures', async () => {
  const { bakeMurals } = await import('../tools/build-ede-murals.mjs');
  const sites = (await Promise.all(['centre', 'tunnels', 'flats', 'structures'].map(part =>
    readJSON(resolve(__dirname, `../tools/data/ede-murals-${part}.json`))))).flat();
  const baked = await bakeMurals(sites);
  const runtime = await readJSON(resolve(assets, 'placements-v1.json'));
  assert.deepEqual(JSON.parse(JSON.stringify(baked)), runtime);
  assert.ok(runtime.sites.some(site => site.atlases.some(atlas => atlas.f?.length === atlas.p.length)));
  assert.ok(runtime.sites.find(site => site.id === 'riedel-silos').atlases[0].p.length > 4 * 3);
  assert.ok(!runtime.sites.some(site => site.id.includes('pathe')));
});


test('Groot Derxsgoed uses its modeled east-wall paint plane with the fallback building excluded', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const { sites } = await readJSON(resolve(assets, 'placements-v1.json'));
  const site = sites.find(site => site.id === 'groot-derxsgoed');
  const modulePath = resolve(__dirname, '../js/ede-murals.js');
  const source = (await readFile(modulePath, 'utf8')).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(modulePath).href));
  class TextureLoader {
    async loadAsync() {
      return new three.Texture({ width: 16, height: 16 });
    }
  }
  const { createEdeMurals } = loadModule(source, {
    imports: { 'three/webgpu': { ...three, TextureLoader } },
    globals: { URL, fetch: async () => ({ ok: true, json: async () => ({ version: 1, sites: [site] }) }) },
    filename: modulePath,
  });
  const scene = new three.Scene();
  const murals = createEdeMurals(scene, { isFallbackVisible: () => false });
  const player = { x: site.bounds[0], y: site.bounds[1], z: site.bounds[2] };
  murals.update(player, 0);
  await new Promise(resolve => setImmediate(resolve));
  murals.update(player, 200);
  await new Promise(resolve => setImmediate(resolve));
  const [mesh] = scene.children[0].children;
  assert.equal(murals.statistics.resident, 1);
  assert.deepEqual(mesh.geometry.getAttribute('position').array, new Float32Array(site.atlases[0].f));
});
