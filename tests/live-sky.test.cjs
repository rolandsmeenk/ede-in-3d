const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

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

test('Live Time blends in the Night fill and uses the complete Night preset after dusk', async () => {
  const { LightingSystem } = loadModule(readFileSync(join(__dirname, '../js/lighting.js'), 'utf8'), { imports: {
    'three/webgpu': await import('../vendor/three/build/three.core.js'),
    'three/tsl': {},
    'three/addons/objects/SkyMesh.js': {},
    'three/addons/lights/SunLight.js': {},
    'three/addons/lights/SunLightNode.js': {},
    './tsl-materials.js': { cityUniforms: { uWindowLights: { value: { set() {} } } } },
    './live-sky.js': await liveSky,
    './ede-window-lights.js': await import('../js/ede-window-lights.js'),
  } });
  const lighting = Object.create(LightingSystem.prototype);
  lighting.applyValues = (preset) => { lighting.basePreset = preset; };
  lighting.applyPreset('midnight');
  const night = lighting.basePreset;

  lighting.applyLive(new Date('2026-06-21T20:45:00Z'));
  assert.ok(lighting.basePreset.sunIntensity > 0 && lighting.basePreset.sunIntensity < night.sunIntensity);
  assert.ok(lighting.basePreset.skySunDir.y < 0);
  assert.equal(lighting.basePreset.showSunDisc, 0);

  lighting.applyLive(new Date('2026-11-21T22:15:00Z'));
  assert.equal(lighting.basePreset, night);
  assert.equal(lighting.live, true);
});

test('the Ede clock follows Amsterdam standard and daylight saving time', async () => {
  const { formatEdeTime } = await liveSky;
  assert.equal(formatEdeTime(new Date('2026-12-21T11:35:00Z')), '12:35');
  assert.equal(formatEdeTime(new Date('2026-06-21T11:39:00Z')), '13:39');
});

test('window schedules use Amsterdam time and unwind gradually after the evening', async () => {
  const { liveWindowLights, windowLightKey } = await import('../js/ede-window-lights.js');
  const lights = (utc, elevation = -10) => liveWindowLights(new Date(utc), elevation);
  const evening = lights('2026-11-19T20:00:00Z');
  const later = lights('2026-11-19T22:00:00Z');
  const overnight = lights('2026-11-20T02:00:00Z');
  assert.ok(evening[0] > later[0] && later[0] > overnight[0]);
  assert.deepEqual(lights('2026-06-25T19:00:00Z'), evening, '21:00 in Amsterdam on both Thursdays');
  assert.ok(lights('2026-11-21T17:00:00Z')[1] < lights('2026-11-19T17:00:00Z')[1]);
  assert.deepEqual(lights('2026-11-19T12:00:00Z', 14), [0, 0, 0]);
  const { edeSun } = await liveSky;
  const winter = '2026-11-19T16:00:00Z', summer = '2026-06-25T15:00:00Z';
  assert.ok(lights(winter, edeSun(new Date(winter)).elevation)[0] > 0, 'winter at 17:00');
  assert.deepEqual(lights(summer, edeSun(new Date(summer)).elevation), [0, 0, 0], 'summer at 17:00');
  assert.equal(Math.floor(windowLightKey({ id: 'w1', kind: 'yes', bagUse: 'office' })), 2);
  assert.equal(windowLightKey({ id: 'w1', kind: 'house' }), windowLightKey({ id: 'w1', bagUse: 'home' }, 30, 12));
  assert.equal(windowLightKey({ id: 'w2', kind: 'shed' }), 0);
});
