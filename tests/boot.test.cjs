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
  for (const src of links) {
    assert.match(src, /^\.\/js\/[\w-]+\.js(?:\?v=[\w-]+)?$/, 'each preload addresses a local module');
    const source = readFileSync(join(__dirname, '..', src.split('?')[0]), 'utf8');
    const imports = src === entries[0][1]
      ? /\bimport\(['"](\.[^'"]+)['"]\)/g
      : /(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g;
    for (const [, specifier] of source.matchAll(imports)) {
      const url = new URL(specifier, new URL(src, base));
      assert.ok(urls.has(url.href), `${src} imports an unpreloaded or mismatched URL: ${specifier}`);
    }
  }
});

test('a failed entry import stops the loading spinner and offers a retry', async () => {
  const vm = require('node:vm');
  const startup = readFileSync(join(__dirname, '../js/startup.js'), 'utf8');
  const failure = new SyntaxError('missing exported binding');
  let logged, reloads = 0, retry;
  const elements = {
    'loading-status': { textContent: 'Loading city code and data...' },
    'loading-overlay': { classList: new Set() },
    'loading-retry': { hidden: true, addEventListener: (event, handler) => { if (event === 'click') retry = handler; } }
  };
  await vm.runInNewContext(startup.replace(/^import\(/, 'loadModule('), {
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
