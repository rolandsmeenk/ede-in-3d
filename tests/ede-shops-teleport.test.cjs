const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('EDE_SHOPS covers Ede and its outer villages within the playable boundary', async () => {
  const { EDE_SHOPS } = await import('../js/ede-shops.js');
  const { containsPlayablePoint } = await import('../js/ede-playable-boundary.js');

  assert.ok(EDE_SHOPS.length >= 700, `expected >= 700 municipal shops, got ${EDE_SHOPS.length}`);
  for (const [name, x, z, kind] of EDE_SHOPS) {
    assert.ok(typeof name === 'string' && name.length > 0);
    assert.ok(Number.isFinite(x) && Number.isFinite(z));
    assert.ok(containsPlayablePoint(x, z), `shop ${name} (${x}, ${z}) should be inside playable boundary`);
    assert.ok(typeof kind === 'string' && kind.length > 0);
  }

  const villages = [
    ['Centrum', 0, 0, 1500, 100],
    ['Bennekom', 365, 5425, 2000, 50],
    ['Lunteren', -3410, -4206, 2000, 40],
    ['Otterlo', 6977, -6100, 2000, 15],
    ['Wekerom', 3050, -7400, 2000, 5],
    ['Harskamp', 5900, -10500, 2500, 10],
    ['Ederveen', -6357, -2164, 2000, 5],
  ];
  for (const [label, cx, cz, radius, minCount] of villages) {
    const count = EDE_SHOPS.filter(([, x, z]) => Math.hypot(x - cx, z - cz) < radius).length;
    assert.ok(count >= minCount, `${label} should have >= ${minCount} shops, got ${count}`);
  }
});

test('area buttons and village map landmarks have valid teleport arrivals', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/data-teleport="([^"]+)"/g)].map(m => m[1]);
  const { NYC_LANDMARKS, TELEPORT_LOCATIONS } = await import('../js/city-config.js');
  const mapIds = ['kulturhus-wekerom', 'harskamp-bevrijding-veluwe'];
  for (const id of mapIds) {
    assert.ok(NYC_LANDMARKS.some(site => site.id === id && !site.hideOnMap), `${id} is available from the map`);
  }
  for (const id of [...ids, ...mapIds]) {
    const loc = TELEPORT_LOCATIONS[id];
    assert.ok(loc && Number.isFinite(loc.x) && Number.isFinite(loc.z), `TELEPORT_LOCATIONS[${id}] should be defined`);
  }
});
