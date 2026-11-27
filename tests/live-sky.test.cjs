const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const liveSky = import('../js/live-sky.js');
const lunarSky = import('../js/ede-moon.js');

function shadowOnLevelGround([x, y, z]) {
  assert.ok(y > 0);
  return [-x / y, -z / y];
}

test('Moon position, angular size and phase agree with JPL Horizons at Oude Kerk', async () => {
  const { edeMoon } = await lunarSky;
  const { edeSun } = await liveSky;
  // JPL Horizons, target 301, airless apparent AZ and EL, site 5.671553 E / 52.0460029 N.
  const samples = [
    ['2026-06-21T20:00Z', 222.850353, 26.754057, 49.28167, 1861.219],
    ['2026-11-26T12:00Z', 342.387018, -9.631354, 94.79510, 1987.038],
    ['2026-11-26T16:39Z', 40.524278, -1.699697, 93.40971, 1990.575],
    ['2026-11-26T16:55Z', 43.543380, -0.138034, 93.33003, 1991.452],
    ['2026-11-26T23:00Z', 112.346804, 49.175373, 91.73571, 2016.139],
    ['2026-12-09T12:00Z', 182.137872, 9.445979, 0.41051, 1773.225],
  ];
  for (const [utc, azimuth, elevation, illuminated, diameter] of samples) {
    const date = new Date(utc);
    const moon = edeMoon(date);
    const sun = edeSun(date).direction;
    const phase = (1 - moon.direction.reduce((sum, axis, i) => sum + axis * sun[i], 0)) * 50;
    assert.ok(Math.abs(moon.azimuth - azimuth) < 0.12, `azimuth at ${utc}`);
    assert.ok(Math.abs(moon.elevation - elevation) < 0.12, `elevation at ${utc}`);
    assert.ok(Math.abs(moon.angularRadius * 2 * 648000 / Math.PI - diameter) < 5, `diameter at ${utc}`);
    assert.ok(Math.abs(phase - illuminated) < 0.5, `illuminated fraction at ${utc}`);
    assert.ok(Math.abs(Math.hypot(...moon.direction) - 1) < 1e-12);
  }
  assert.ok(edeMoon(new Date('2026-11-26T16:39Z')).direction[1] < 0);
  assert.ok(edeMoon(new Date('2026-11-26T16:55Z')).direction[1] > 0, 'near-horizon refraction lifts the apparent disc');
});

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
  const THREE = await import('../vendor/three/build/three.core.js');
  const { LightingSystem } = loadModule(readFileSync(join(__dirname, '../js/lighting.js'), 'utf8'), { imports: {
    'three/webgpu': THREE,
    'three/tsl': {},
    'three/addons/objects/SkyMesh.js?v=20261127-volume-clouds': {},
    'three/addons/lights/SunLight.js': {},
    'three/addons/lights/SunLightNode.js': {},
    './tsl-materials.js': { cityUniforms: { uWindowLights: { value: { set() {} } } } },
    './ede-snow.js': { snowCover: { value: 0 } },
    './live-sky.js': await liveSky,
    './ede-moon.js': await lunarSky,
    './ede-photo-sky.js': {},
    './ede-clouds.js?v=20261127-volume-clouds': {},
    './ede-window-lights.js': await import('../js/ede-window-lights.js'),
  } });
  const lighting = Object.create(LightingSystem.prototype);
  lighting.uShowMoon = { value: 0 };
  lighting.uMoonDirection = { value: new THREE.Vector3() };
  lighting.uMoonSun = { value: new THREE.Vector3() };
  lighting.uMoonRadius = { value: 0 };
  lighting.uCloudMoonlight = { value: 0 };
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

  lighting.applyLive(new Date('2026-11-26T18:00:00Z'));
  assert.equal(lighting.uShowMoon.value, 1);
  const rising = lighting.uMoonDirection.value.clone();
  lighting.applyLive(new Date('2026-11-26T23:00:00Z'));
  assert.ok(lighting.uMoonDirection.value.y > rising.y, 'the Moon keeps moving in the Night preset blend');
  assert.ok(lighting.uCloudMoonlight.value > 0.8, 'the high, nearly full Moon lights the cloud layer');
  lighting.applyLive(new Date('2026-11-26T14:50:00Z'));
  assert.equal(lighting.uShowMoon.value, 0, 'below the horizon');
  assert.equal(lighting.uCloudMoonlight.value, 0);
  lighting.applyLive(new Date('2026-06-21T20:00:00Z'));
  assert.equal(lighting.uShowMoon.value, 1, 'the Moon can appear during daylight');
  assert.equal(lighting.uCloudMoonlight.value, 0, 'direct sunlight takes over at dawn');
  lighting.applyPreset('midnight');
  assert.equal(lighting.uShowMoon.value, 0);
  lighting.envRenderTarget = {};
  lighting.applyPreset('golden');
  const goldenSun = lighting.basePreset.sunDir;
  lighting.applyPreset('golden', false, 14);
  assert.ok(Math.abs(Math.asin(lighting.basePreset.sunDir.y) * 180 / Math.PI - 14) < 1e-6);
  lighting.applyPreset('golden');
  assert.equal(lighting.basePreset.sunDir, goldenSun);
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

test('window emission is off in both daylight presets and fades in after sunset in Live Time', async () => {
  const { liveWindowLights, PRESET_WINDOW_LIGHTS } = await import('../js/ede-window-lights.js');
  assert.deepEqual(PRESET_WINDOW_LIGHTS.golden, [0, 0, 0]);
  assert.deepEqual(PRESET_WINDOW_LIGHTS.midday, [0, 0, 0]);
  assert.ok(PRESET_WINDOW_LIGHTS.twilight.every(level => level > 0));
  assert.ok(PRESET_WINDOW_LIGHTS.midnight.every(level => level > 0));
  const date = new Date('2026-11-19T16:00:00Z');
  for (const elevation of [7, 2, 0, -0.83]) assert.deepEqual(liveWindowLights(date, elevation), [0, 0, 0]);
  const dusk = liveWindowLights(date, -2);
  const night = liveWindowLights(date, -4);
  assert.ok(dusk.every((level, i) => level > 0 && level < night[i]));
});
