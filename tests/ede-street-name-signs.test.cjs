const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const { selectStreetNameSigns, selectStreetNamePoles } = loadModule(
  readFileSync(join(__dirname, '../js/ede-street-name-signs.js'), 'utf8'),
  { imports: { 'three/webgpu': {}, 'three/tsl': {}, './ede-geometry.js': {} } }
);

test('lamp-mounted boards have no citywide name cap and prefer the closest fallback', () => {
  const sampled = Array.from({ length: 75 }, (_, i) => ({ name: 'Street ' + i, sampled: true, distance: 5 }));
  const breelaan = { name: 'Breelaan', sampled: true, distance: 6 };
  const farther = { name: 'Beukenlaan', sampled: false, distance: 12 };
  const nearer = { ...farther, distance: 5 };
  const signs = selectStreetNameSigns([...sampled, breelaan, farther, nearer, { ...breelaan, sampled: false }]);
  assert.equal(signs.length, 77);
  assert.ok(signs.includes(breelaan));
  assert.ok(signs.includes(nearer));
  assert.ok(!signs.includes(farther));
});

test('an unsigned street gets one roadside pole when there is a safe site', () => {
  const segment = (name, z, road = {}) => ({
    a: { x: 0, z }, len: 20, ux: 1, uz: 0, width: 6, road: { name, kind: 'residential', ...road }
  });
  const poles = selectStreetNamePoles(
    [segment('Breelaan', 0), segment('Beukenlaan', 20), segment('Beukenlaan', 30),
      segment('Underpass', 40, { tunnel: true }), segment('Bridge', 50, { bridge: true }),
      segment('Blocked', 60), segment('Footpath', 70, { kind: 'footway' })],
    [{ name: 'Breelaan' }],
    (x, z) => x === 10 && (z < 20 || z > 67)
  );
  assert.deepEqual(Array.from(poles, ({ name, x, z }) => [name, x, z]),
    [['Beukenlaan', 10, 16.35], ['Footpath', 10, 73.65]]);
});
