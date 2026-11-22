const assert = require('node:assert/strict');
const test = require('node:test');

test('Frankeneng uses each gauge independently and falls back for invalid or stale values', async () => {
  const { resolveFrankenengLevels } = await import('../js/ede-water-levels.js');
  const { SCENE_NAP_ORIGIN } = await import('../js/ede-scene-coordinates.js');
  const now = Date.parse('2026-11-22T15:00:00Z');
  const layer = { editingInfo: { dataLastEditDate: now - 60000 } };
  const row = (Code, AssignedValue) => ({ attributes: { Code, AssignedValue } });
  const result = { features: [row('WS000611', 6.24), row('WS000610', 6.68), row('WS000612', 6.64)] };
  const live = resolveFrankenengLevels(layer, result, now);
  assert.deepEqual(live.map(v => v.nap), [6.68, 6.24]);
  for (const { nap, y, publishedAt } of live) {
    assert.equal(y, nap - SCENE_NAP_ORIGIN);
    assert.equal(publishedAt, layer.editingInfo.dataLastEditDate);
  }

  const fallback = resolveFrankenengLevels();
  assert.deepEqual(fallback.map(v => v.nap), [6.65, 6.25]);
  for (const value of [null, undefined, '6.24', -19.99, 8]) {
    const bad = { features: [result.features[1], row('WS000611', value)] };
    assert.deepEqual(resolveFrankenengLevels(layer, bad, now), [live[0], fallback[1]]);
  }
  assert.deepEqual(resolveFrankenengLevels(layer, { features: [result.features[0]] }, now), [fallback[0], live[1]]);
  assert.deepEqual(resolveFrankenengLevels(layer, result, now + 45 * 60000), fallback);
  assert.deepEqual(resolveFrankenengLevels({ editingInfo: { dataLastEditDate: now + 360000 } }, result, now), fallback);
});
