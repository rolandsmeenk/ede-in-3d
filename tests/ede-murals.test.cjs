const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
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
