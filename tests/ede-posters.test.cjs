const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('Ede posters roll over on Tuesday at Amsterdam midnight in both seasons', async () => {
  const time = await import('../js/ede-transit-time.js');
  const { edePosterWeek } = loadModule(readFileSync(join(__dirname, '../js/ede-posters.js'), 'utf8'), {
    imports: {
      'three/webgpu': {}, 'three/addons/utils/BufferGeometryUtils.js': {},
      './ede-transit-time.js': time, './ede-poster-sites.js': {}, './ede-advertising.js': { BEZOEK_EDE: {} },
    },
  });
  const weekAt = iso => edePosterWeek(time.localClock(Date.parse(iso) / 1000).date);
  for (const [before, after] of [
    ['2026-07-20T21:59:59Z', '2026-07-20T22:00:00Z'],
    ['2026-11-23T22:59:59Z', '2026-11-23T23:00:00Z'],
  ]) {
    assert.equal(weekAt(after), weekAt(before) + 1);
    assert.equal(weekAt(new Date(Date.parse(after) + 6 * time.DAY * 1000)), weekAt(after));
  }
});
