const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('bus stop markers combine lines on a platform and retain the opposite curb', () => {
  const { collectEdeBusStops } = loadModule(readFileSync(join(__dirname, '../js/ede-bus-stops.js'), 'utf8'), {
    imports: {
      'three/webgpu': {},
      './ede-geodata.js': { EDE_DATA: { meta: { bounds: [0, 0, 20, 30] } } },
      './terrain.js': {}
    }
  });
  const platform = { id: 'outbound', name: 'Ede, Voorbeeld', platform: 'A', x: 10, z: 17 };
  const variants = [
    { line: '303', stops: [platform, { ...platform, id: 'regional', x: 500 }] },
    { line: '1', stops: [{ ...platform, id: 'duplicate-record' }] },
    { line: '1', stops: [{ ...platform, id: 'inbound', platform: 'B', x: 16 }] }
  ];
  const stops = collectEdeBusStops(variants);
  assert.equal(stops.length, 2);
  assert.equal(stops[0].name, platform.name);
  assert.equal(stops[0].platform, 'A');
  assert.equal(stops[0].lines.join(','), '1,303');
  assert.equal(stops[1].platform, 'B');
  assert.equal(stops[1].lines.join(','), '1');
  assert.equal(stops[1].x, 16);
  assert.equal(stops[1].z, 17);
});
