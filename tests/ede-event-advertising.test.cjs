const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = file => readFileSync(join(__dirname, '..', file), 'utf8');

test('published event campaigns switch at Amsterdam midnight and only cover the announced editions', async () => {
  const { localClock } = await import('../js/ede-transit-time.js');
  const { edeEventCampaign } = await import('../js/ede-event-calendar.js');
  const at = iso => edeEventCampaign(localClock(Date.parse(iso) / 1000).date);
  assert.equal(at('2026-12-04T22:59:59Z'), null);
  assert.equal(at('2026-12-04T23:00:00Z').brand, 'Binnenkort in Ede');
  assert.equal(at('2026-12-18T23:00:00Z').brand, 'Vandaag in Ede');
  assert.match(at('2026-12-18T23:00:00Z').detail, /19 dec.*Oude Kerk/);
  assert.equal(at('2026-12-19T23:00:00Z'), null);
  assert.equal(edeEventCampaign('2027-12-19'), null);
  assert.equal(edeEventCampaign('2025-04-26').title, 'Koningsdag');
  assert.equal(edeEventCampaign('2025-04-27'), null);
  assert.equal(at('2027-08-19T22:00:00Z').brand, 'Nu in Ede');
  assert.equal(at('2027-08-28T21:59:59Z').title, 'Heideweek');
  assert.equal(at('2027-08-28T22:00:00Z'), null);
  assert.equal(edeEventCampaign('2027-09-18').title, 'Airborne Ede');
});

test('shared ad textures and poster series follow the campaign and restore tourism artwork', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const utils = loadModule(source('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), {
    imports: { '../../../build/three.core.js': three },
  });
  const time = await import('../js/ede-transit-time.js');
  const { edeEventCampaign } = await import('../js/ede-event-calendar.js');
  const images = [];
  class Image {
    naturalWidth = 1200;
    naturalHeight = 800;
    decode() { return new Promise(resolve => images.push(resolve)); }
  }
  const document = {
    createElement() {
      const text = [];
      const noop = () => {};
      let translated = false;
      const stack = [];
      const context = {
        fillRect(x, y) { if (!translated && x === 0 && y === 0) text.length = 0; },
        fillText(value) { text.push(value); },
        createLinearGradient: () => ({ addColorStop: noop }),
        save() { stack.push(translated); }, restore() { translated = stack.pop(); }, fill: noop, beginPath: noop, moveTo: noop, lineTo: noop,
        rect: noop, clip: noop, drawImage: noop, translate() { translated = true; }, scale: noop,
      };
      return { text, getContext: () => context };
    },
  };
  const adSource = source('js/ede-advertising.js')
    .replace('import.meta.url', "'https://example.test/js/ede-advertising.js'")
    .replace('export async function setEdeAdArtwork', 'async function setEdeAdArtwork');
  const ads = loadModule(adSource, { imports: { 'three/webgpu': three }, globals: { document, Image, URL } });
  const scene = new three.Scene();
  const banner = ads.edeAdMaterial('banner').map.image.text;
  const portrait = ads.edeAdMaterial('portrait').map.image.text;
  const { buildEdePosters } = loadModule(source('js/ede-posters.js'), {
    imports: {
      'three/webgpu': three, 'three/addons/utils/BufferGeometryUtils.js': utils,
      './ede-transit-time.js': time, './ede-advertising.js': ads,
      './ede-poster-sites.js': { EDE_POSTER_SITES: [{ x: 0, z: 0, series: 'A' }] },
    },
    globals: { document, Image },
  });
  const posters = buildEdePosters(scene, [{ x: 0, z: 0, baseY: 0, topY: 3, kind: 'lamp', layer: 0 }], '2026-12-05');
  const atlas = scene.children[0].children[0].material.map.image.text;
  const display = date => {
    const campaign = edeEventCampaign(date);
    ads.setEdeAdCampaign(campaign);
    posters.setCampaign(date, campaign);
  };
  display('2026-12-05');
  for (const finish of images.splice(0)) finish();
  await Promise.resolve();
  for (const text of [banner, portrait]) assert.deepEqual(text.slice(0, 2), ['Binnenkort in Ede', 'Kerstmarkt']);
  assert.equal(atlas.filter(line => line === 'Kerstmarkt').length, 3);
  assert.equal(atlas.filter(line => line === 'Bezoek Ede').length, 3);

  display('2026-12-19');
  assert.equal(banner[0], 'Vandaag in Ede');
  assert.equal(portrait[0], 'Vandaag in Ede');
  assert.equal(atlas.filter(line => line === 'Vandaag in Ede').length, 3);

  display('2026-12-20');
  for (const text of [banner, portrait]) assert.deepEqual(text.slice(0, 2), ['Bezoek Ede', 'Ontdek Ede']);
  assert.equal(atlas.filter(line => line === 'Bezoek Ede').length, 6);
});
