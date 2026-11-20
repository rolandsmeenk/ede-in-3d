const assert = require('node:assert/strict');
const test = require('node:test');
const { sites } = require('../tools/data/ede-playground-pilots.json');

test('surveyed play equipment uses reusable parts and only solid supports have colliders', async () => {
  const { playgroundEquipment } = await import('../js/ede-playground-equipment.js');
  const identities = new Set();
  for (const site of sites) {
    for (const feature of site.features) {
      assert.ok(!identities.has(feature.id), feature.id);
      identities.add(feature.id);
      if (feature.type !== 'playEquipment') continue;
      const parts = [], beams = [], bodies = [];
      assert.ok(playgroundEquipment(feature, (...row) => parts.push(row), (...row) => beams.push(row),
        (...row) => bodies.push(row)));
      assert.ok(parts.length > 0, feature.id);
      if (feature.model === 'slide') {
        assert.equal(bodies.length, 4, feature.id);
        assert.ok(bodies.every(([width, depth, height]) => width === 0.13 && depth === 0.13 && height > 0));
        const chute = beams.filter(row => row[5] === 'box' && row[6] === 0.075);
        assert.equal(chute.length, 2, feature.id);
        assert.deepEqual(chute[0][1], chute[1][0], 'inclined chute joins the runout');
      } else {
        assert.equal(bodies.length, 0, feature.id);
      }
    }
  }
  assert.ok(!playgroundEquipment({ model: 'unknown', width: 3, length: 3, height: 3 }, () => {}, () => {}, () => {}));
});
