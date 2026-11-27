const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const importMap = html.match(/<script type="importmap">([^]*?)<\/script>/);
const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"\s*\/>/g)];
const entries = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)];

test('city module preloads start after the import map and before stylesheets', () => {
  assert.ok(importMap);
  assert.ok(preloads.length > 0);
  const stylesheetIndex = html.indexOf('rel="stylesheet"');
  for (const preload of preloads) {
    assert.ok(importMap.index < preload.index);
    assert.ok(preload.index < stylesheetIndex);
  }
  assert.equal(entries.length, 1);
  assert.ok(importMap.index < entries[0].index);
  assert.ok(entries[0].index < stylesheetIndex, 'the module graph starts loading early too');
  const { imports } = JSON.parse(importMap[1]);
  assert.equal(imports.three, imports['three/webgpu'], 'Three.js aliases share one module instance');
  for (const specifier of ['three', 'three/tsl']) {
    assert.match(imports[specifier], /^\.\/vendor\/three\//);
    assert.ok(readFileSync(join(__dirname, '..', imports[specifier])).length, 'Three.js loads offline');
  }
});

test('native module entry and imports share canonical preloaded URLs on GitHub Pages', () => {
  const links = preloads.map((match) => match[1]);
  assert.equal(new Set(links).size, links.length, 'each module is preloaded once');
  assert.equal(entries.length, 1);
  assert.match(entries[0][1], /^\.\/js\/startup\.js\?v=[\w-]+$/);
  assert.ok(links.includes(entries[0][1]));
  assert.equal([...html.matchAll(/<script\b/g)].length, 2, 'only the import map and native entry are needed');
  const base = 'https://example.test/slop-newyork/';
  const urls = new Set(links.map((src) => new URL(src, base).href));
  const { imports: mappings } = JSON.parse(importMap[1]);
  for (const name of ['ede-curbs', 'ede-road-surfaces', 'city-grid', 'ede-paving-client']) {
    assert.match(mappings[`./js/${name}.js`] ?? '', new RegExp(`^\\./js/${name}\\.js\\?v=[\\w-]+$`),
      `${name} uses a fresh URL when the curb data format changes`);
  }
  const localMappings = new Map(Object.entries(mappings)
    .filter(([specifier]) => specifier.startsWith('./js/'))
    .map(([specifier, target]) => [new URL(specifier, base).href, new URL(target, base).href]));
  for (const [specifier, target] of localMappings) {
    assert.ok(urls.has(target), `the resolved URL is preloaded: ${target}`);
    assert.ok(!urls.has(specifier), `the old URL is not preloaded: ${specifier}`);
  }
  for (const src of links) {
    assert.match(src, /^\.\/(?:js\/[\w-]+\.js|vendor\/three\/build\/three\.core\.js)(?:\?v=[\w-]+)?$/, 'each preload addresses a local module');
    const source = readFileSync(join(__dirname, '..', src.split('?')[0]), 'utf8');
    const imports = src === entries[0][1]
      ? /\bimport\(['"](\.[^'"]+)['"]\)/g
      : /(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g;
    for (const [, specifier] of source.matchAll(imports)) {
      const url = new URL(specifier, new URL(src, base));
      assert.ok(urls.has(localMappings.get(url.href) ?? url.href), `${src} imports an unpreloaded or mismatched URL: ${specifier}`);
    }
  }
});

test('Custom and Photo scenes expose separate controls and Live is a third mode', async () => {
  const { PHOTO_WEATHER_PRESETS } = await import('../js/ede-weather.js');
  const optionsIn = (id) => [...html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1]
    .matchAll(/<option value="([^"]*)"/g)].map(([, value]) => value);
  assert.deepEqual([...html.matchAll(/data-environment="([^"]+)"/g)].map(([, mode]) => mode), ['live', 'custom', 'photo']);
  const custom = html.match(/<div[^>]*id="environment-custom"[^>]*>([^]*?)<\/div>/)[1];
  const photo = html.match(/<div[^>]*id="environment-photo-scenes" hidden>([^]*?)<\/div>/)[1];
  assert.deepEqual([...custom.matchAll(/<select id="([^"]+)"/g)].map(([, id]) => id), [
    'environment-time', 'environment-season', 'environment-weather',
  ]);
  assert.deepEqual([...photo.matchAll(/<select id="([^"]+)"/g)].map(([, id]) => id), ['environment-photo']);
  assert.deepEqual(optionsIn('environment-photo'), Object.keys(PHOTO_WEATHER_PRESETS));
  for (const scene of Object.values(PHOTO_WEATHER_PRESETS)) {
    assert.ok(optionsIn('environment-season').includes(scene.season));
    assert.ok(optionsIn('environment-time').includes(scene.time));
    assert.ok(scene.summary);
  }
  assert.match(custom, /id="environment-preview" type="datetime-local"/);
  assert.match(html, /popovertarget="agenda-popover"/);
  assert.match(html, /id="agenda-list"/);
  const manualWeather = optionsIn('environment-weather');
  assert.ok(manualWeather.includes('default'));
  assert.ok(manualWeather.every((id) => !Object.hasOwn(PHOTO_WEATHER_PRESETS, id)));
});

test('a failed entry import stops the loading spinner and offers a retry', async () => {
  const vm = require('node:vm');
  const startup = readFileSync(join(__dirname, '../js/startup.js'), 'utf8');
  const failure = new SyntaxError('missing exported binding');
  let logged, reloads = 0, retry;
  const elements = {
    'loading-status': { textContent: 'Getting Ede ready…' },
    'loading-overlay': { classList: new Set() },
    'loading-retry': { hidden: true, addEventListener: (event, handler) => { if (event === 'click') retry = handler; } }
  };
  await vm.runInNewContext(startup.replace(/\bimport\(/, 'loadModule('), {
    loadModule: () => Promise.reject(failure),
    console: { error: (_label, error) => { logged = error; } },
    document: { getElementById: id => elements[id] },
    window: { location: { reload: () => { reloads++; } } }
  });
  assert.equal(logged, failure);
  assert.match(elements['loading-status'].textContent, /couldn’t load/);
  assert.ok(elements['loading-overlay'].classList.has('has-error'));
  assert.equal(elements['loading-retry'].hidden, false);
  retry();
  assert.equal(reloads, 1);
});

test('postcards pause for the loading screen and arrive decoded at three-second intervals', async () => {
  const vm = require('node:vm');
  const startup = readFileSync(join(__dirname, '../js/startup.js'), 'utf8');
  const cards = [];
  const gallery = {
    append(card) { cards.push(card); },
    get childElementCount() { return cards.length; },
    get firstElementChild() { return { remove: () => cards.shift() }; }
  };
  let decodeFirstCard, finishGame, nextArrival;
  let introFinished = false;
  const firstImageReady = new Promise(resolve => { decodeFirstCard = resolve; });
  const game = new Promise(resolve => { finishGame = resolve; });
  const startupResult = vm.runInNewContext(startup.replace(/\bimport\(/, 'loadModule('), {
    loadModule: async () => ({ initApp: () => game }),
    Image: class {
      decode() { return this.src.endsWith('/oude-kerk-sunbeams.webp') ? firstImageReady : Promise.resolve(); }
    },
    document: {
      getElementById: id => id === 'loading-postcards' ? gallery : undefined,
      createElement: () => ({ dataset: {}, append(...children) { this.children = children; } }),
    },
    setTimeout(callback, delay) {
      assert.equal(delay, introFinished ? 3000 : 1100);
      nextArrival = callback;
      return callback;
    },
    clearTimeout(callback) { if (callback === nextArrival) nextArrival = undefined; }
  });

  await new Promise(setImmediate);
  assert.equal(cards.length, 0);
  const introduceFirstCard = nextArrival;
  nextArrival = undefined;
  introFinished = true;
  introduceFirstCard();
  await new Promise(setImmediate);
  assert.equal(cards.length, 0);
  assert.equal(nextArrival, undefined);
  decodeFirstCard();
  await new Promise(setImmediate);
  assert.equal(cards.length, 1);
  const seen = [];
  const arrivals = 12;
  for (let i = 0; i < arrivals; i++) {
    const { children: [image, caption], dataset } = cards.at(-1);
    assert.ok(readFileSync(join(__dirname, '..', image.src)).length);
    assert.ok(image.alt);
    assert.equal(caption.lang, 'nl');
    assert.match(caption.textContent, /!$/);
    assert.equal(dataset.position, i % 4);
    assert.equal(cards.length, Math.min(i + 1, 4));
    seen.push(image.src);
    if (i < arrivals - 1) {
      const arrive = nextArrival;
      nextArrival = undefined;
      arrive();
      await new Promise(setImmediate);
    }
  }
  assert.deepEqual(seen.slice(0, 6).map(path => path.split('/').at(-1)), [
    'oude-kerk-sunbeams.webp', 'ede-wageningen-storm.webp', 'ede-overview-rainbow.webp',
    'middelpunt-stone.webp', 'hoekelum-snowfall.webp', 'huis-kernhem-mist.webp',
  ]);
  assert.equal(seen[0], seen[6]);
  assert.equal(seen[3], seen[9]);
  assert.deepEqual(seen.filter(file => file.includes('hoekelum')), ['./assets/loading-postcards/hoekelum-snowfall.webp']);

  finishGame();
  await startupResult;
  assert.equal(nextArrival, undefined);
});
