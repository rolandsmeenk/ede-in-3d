const assert = require('node:assert/strict');
const test = require('node:test');

test('every registry crop profile has a finite seasonal state', async () => {
  const { FIELD_CROP_CODES, FIELD_PROFILES, fieldCropState } = await import('../js/ede-field-phenology.js');
  assert.equal(Object.keys(FIELD_CROP_CODES).length, 103);
  assert.equal(fieldCropState(99, '2025-06-19'), null);
  assert.equal(fieldCropState(259, undefined), null);
  for (const [code, name] of Object.entries(FIELD_CROP_CODES)) {
    assert.ok(FIELD_PROFILES[name]?.source, code);
    for (let month = 1; month <= 12; month++) {
      const date = `2025-${String(month).padStart(2, '0')}-15`;
      const { stage, height, cover, color, bloom } = fieldCropState(code, date, 0xc9857f1b);
      assert.ok(stage && height >= 0 && cover >= 0 && cover <= 1, `${code} ${date}`);
      assert.ok(Number.isInteger(color) && color >= 0 && color <= 0xffffff);
      assert.ok(bloom >= 0 && bloom <= 1);
    }
  }
  assert.equal(fieldCropState(2631, '2025-07-15').family, 'retain');
  assert.equal(fieldCropState(3801, '2025-07-15').family, 'soil');
});

test('maize closes in summer and drops to stubble on the crop-specific harvest date', async () => {
  const { fieldCropState } = await import('../js/ede-field-phenology.js');
  const silage = date => fieldCropState(259, date);
  assert.equal(silage('2025-04-12').height, 0);
  assert.ok(silage('2025-05-20').height > 0.08);
  assert.ok(silage('2025-07-26').height > 2);
  assert.ok(silage('2025-07-26').cover > 0.9);
  assert.equal(silage('2025-07-26').stage, 'tassel');
  assert.ok(silage('2025-09-29').height > 2);
  assert.ok(silage('2025-09-30').height < 0.2);
  assert.ok(fieldCropState(316, '2025-10-02').height > 2);
  assert.equal(silage('2025-11-30').stage, 'winter-cover');
  assert.notDeepEqual(fieldCropState(259, '2025-06-20', 2), fieldCropState(259, '2025-06-20', 8));
  const day = fieldCropState(259, '2025-06-20', 2);
  fieldCropState(259, '2025-12-30', 2);
  assert.deepEqual(fieldCropState(259, '2026-06-20', 2), day);
  assert.deepEqual(fieldCropState(259, '2028-02-29', 2), fieldCropState(259, '2028-02-28', 2));
});

test('managed grass regrows between cuts while a natural meadow stands into late summer', async () => {
  const { fieldCropState } = await import('../js/ede-field-phenology.js');
  assert.ok(fieldCropState(265, '2025-05-09').height > 0.3);
  assert.equal(fieldCropState(265, '2025-05-10').stage, 'cut');
  assert.ok(fieldCropState(265, '2025-05-10').height < 0.1);
  assert.ok(fieldCropState(265, '2025-06-23').height > 0.3);
  assert.ok(fieldCropState(332, '2025-09-03').height > 0.6);
});

test('flower mixes keep their named species while seasonal blooms and standing stems change', async () => {
  const { FIELD_FLOWER_MIXES, fieldFlowerState } = await import('../js/ede-field-phenology.js');
  assert.equal(FIELD_FLOWER_MIXES.A6.species.length, 12);
  assert.equal(FIELD_FLOWER_MIXES.G1.species.length, 25);
  assert.equal(FIELD_FLOWER_MIXES.G3.species.length, 28);
  assert.equal(FIELD_FLOWER_MIXES['ginkel-margin'].evidence, 'local-reference');
  assert.equal(FIELD_FLOWER_MIXES['ginkel-observed'].evidence, 'observed');
  assert.deepEqual(fieldFlowerState('unknown', '2025-06-14'), []);
  const bloom = (mix, name, date) => fieldFlowerState(mix, date).find(s => s.name === name).bloom;
  assert.ok(bloom('G3', 'Cardamine pratensis', '2025-04-19') > 0.8);
  assert.ok(bloom('G3', 'Filipendula ulmaria', '2025-07-12') > bloom('G3', 'Filipendula ulmaria', '2025-04-19'));
  assert.ok(bloom('A6', 'Centaurea cyanus', '2025-06-14') > 0.85);
  const summer = fieldFlowerState('ginkel-margin', '2025-07-20');
  const winter = fieldFlowerState('ginkel-margin', '2025-12-20');
  assert.deepEqual(summer.map(s => s.name), winter.map(s => s.name));
  assert.ok(winter.every(s => s.bloom === 0 && s.structure > 0.4));
});
