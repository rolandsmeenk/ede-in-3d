const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const time = loadModule(readFileSync(join(__dirname, '../js/ede-transit-time.js'), 'utf8'), { globals: { Intl } });
const events = loadModule(readFileSync(join(__dirname, '../js/ede-event-calendar.js'), 'utf8'), {
  imports: { './ede-transit-time.js': time }, globals: { Intl },
});

const { edeSeasonalVisibility: active } = loadModule(
  readFileSync(join(__dirname, '../js/ede-seasonal-decorations.js'), 'utf8'), {
    imports: {
      'three/webgpu': {}, 'three/tsl': {}, './ede-civic-landmarks.js': {},
      './terrain.js': {}, './tsl-materials.js': {}, './ede-event-calendar.js': events, './ede-transit-time.js': time,
    },
  });

test('winter preview and dated displays preserve the historical Markt and the one-day market', () => {
  assert.equal(active(undefined, 'winter').marketLights, true);
  assert.equal(active(undefined, 'winter').christmasMarket, false);
  assert.equal(active('2025-12-19').marketLights, true);
  assert.equal(active('2026-12-19').marketLights, false);
  assert.equal(active('2026-12-19').christmasMarket, true);
  assert.equal(active('2026-12-20').christmasMarket, false);
  assert.equal(active('2027-01-06').winter, true);
  assert.equal(active('2027-01-07').winter, false);
});

test('flags follow their event dates and King’s Day moves off Sundays', () => {
  assert.equal(active('2026-08-24').heideweek, true);
  assert.equal(active('2026-08-30').heideweek, false);
  assert.equal(active('2027-08-20').heideweek, true);
  assert.equal(active('2027-08-29').heideweek, false);
  assert.equal(active('2026-09-30').airborne, true);
  assert.equal(active('2026-10-01').airborne, false);
  assert.equal(active('2025-04-26').kingsDay, true);
  assert.equal(active('2025-04-27').kingsDay, false);
  assert.equal(active('2026-04-27').kingsDay, true);
});
