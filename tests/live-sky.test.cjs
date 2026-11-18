const assert = require('node:assert/strict');
const test = require('node:test');

const liveSky = import('../js/live-sky.js');

function shadowOnLevelGround([x, y, z]) {
  assert.ok(y > 0);
  return [-x / y, -z / y];
}

test('a morning sun casts westward shadows and an afternoon sun casts eastward shadows in Ede', async () => {
  const { edeSun } = await liveSky;
  const morning = shadowOnLevelGround(edeSun(new Date('2026-06-21T07:00:00Z')).direction);
  const afternoon = shadowOnLevelGround(edeSun(new Date('2026-06-21T16:00:00Z')).direction);
  assert.ok(morning[0] < 0);
  assert.ok(afternoon[0] > 0);
});

test('solar-noon shadows point north and are longer in winter', async () => {
  const { edeSun } = await liveSky;
  const summer = shadowOnLevelGround(edeSun(new Date('2026-06-21T11:39:00Z')).direction);
  const winter = shadowOnLevelGround(edeSun(new Date('2026-12-21T11:35:00Z')).direction);
  assert.ok(summer[1] < 0 && winter[1] < 0);
  assert.ok(Math.hypot(...winter) > Math.hypot(...summer) * 6);
});

test('direct sunlight fades at dusk as the blend reaches the Night preset', async () => {
  const { edeSun, directSunFactor, livePresetBlend } = await liveSky;
  const evening = ['19:00', '19:30', '19:45', '19:55', '21:30'].map((time) =>
    edeSun(new Date(`2026-06-21T${time}:00Z`)).elevation);
  const [day, earlyDusk, lateDusk, afterSunset, night] = evening.map(directSunFactor);
  assert.equal(day, 1);
  assert.ok(earlyDusk < day && lateDusk < earlyDusk && lateDusk > 0);
  assert.equal(afterSunset, 0);
  assert.equal(night, 0);
  assert.deepEqual(livePresetBlend(evening.at(-1)), { from: 'midnight', to: 'twilight', weight: 0 });
});

test('the Ede clock follows Amsterdam standard and daylight saving time', async () => {
  const { formatEdeTime } = await liveSky;
  assert.equal(formatEdeTime(new Date('2026-12-21T11:35:00Z')), '12:35');
  assert.equal(formatEdeTime(new Date('2026-06-21T11:39:00Z')), '13:39');
});
