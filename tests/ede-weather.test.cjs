const assert = require('node:assert/strict');
const test = require('node:test');
const { setImmediate } = require('node:timers/promises');

const observedAt = Date.parse('2026-11-19T08:30:00Z');
const minute = 60000;
const reading = (values = {}, date = observedAt) => ({
  fetchedAt: date + 15000,
  current: {
    time: date / 1000, interval: 900, temperature_2m: 9.6, weather_code: 0, cloud_cover: 0,
    rain: 0, showers: 0, snowfall: 0, wind_speed_10m: 16, wind_direction_10m: 270,
    wind_gusts_10m: 32, ...values
  }
});

test('current conditions preserve model time, source and wind and format Ede time in winter and summer', async () => {
  const { formatWeatherTime, parseWeather } = await import('../js/ede-weather.js');
  const data = parseWeather(reading(), observedAt);
  assert.deepEqual(data, {
    source: 'Open-Meteo', observedAt, fetchedAt: observedAt + 15000, interval: 900,
    temperature: 9.6, code: 0, cloudCover: 0, rain: 0, showers: 0, snowfall: 0,
    windSpeed: 16, windDirection: 270, windGusts: 32
  });
  assert.ok(Object.isFrozen(data));
  assert.match(formatWeatherTime(observedAt), /09:30/);
  assert.match(formatWeatherTime(Date.parse('2026-07-19T08:30:00Z')), /10:30/);
  assert.throws(() => parseWeather(reading({ wind_gusts_10m: null }), observedAt));
  assert.throws(() => parseWeather(reading({ cloud_cover: 101 }), observedAt));
  assert.throws(() => parseWeather(reading({}, observedAt + 6 * minute), observedAt));
});

test('photogenic weather combines fresh local light with weather and lunar conditions', async () => {
  const { parseWeather, photogenicWeather } = await import('../js/ede-weather.js');
  const at = time => Date.parse(`2026-11-26T${time}:00Z`);
  const moments = (time, values, daily) => {
    const now = at(time);
    return photogenicWeather(parseWeather({ ...reading(values, now), daily }, now), now);
  };

  assert.deepEqual(moments('06:50', { cloud_cover: 25 }), ['Blue hour']);
  assert.deepEqual(moments('06:50', { cloud_cover: 26 }), []);
  assert.deepEqual(moments('08:00'), ['Golden hour']);
  assert.deepEqual(moments('08:00', { weather_code: 3, cloud_cover: 100 }), []);
  assert.deepEqual(moments('08:00', { weather_code: 2, cloud_cover: 60 }),
    ['Possible red sky', 'Possible sunbeams through clouds']);
  assert.deepEqual(moments('08:30', {
    weather_code: 48, cloud_cover: 85, temperature_2m: -2,
    relative_humidity_2m: 96, dew_point_2m: -2.5, wind_speed_10m: 7.2
  }), ['Possible mist in low sunlight', 'Possible rime or hoar frost']);
  assert.deepEqual(moments('08:30', {
    cloud_cover: 85, temperature_2m: 4, dew_point_2m: 3, wind_speed_10m: 7.3
  }), []);
  assert.deepEqual(moments('08:30', { weather_code: 80, cloud_cover: 75 }),
    ['Possible rainbow (look away from the sun)']);
  assert.deepEqual(moments('08:30', { weather_code: 95, cloud_cover: 70, showers: 1 }),
    ['Storm light (view from indoors)']);
  assert.deepEqual(moments('08:30', { weather_code: 85, cloud_cover: 50, temperature_2m: 2 }),
    ['Possible red sky', 'Possible sunbeams through clouds', 'Snow in sunlight']);

  const start = at('00:00') / 1000;
  const daily = {
    time: [start - 86400, start], moon_phase: [0.49, 0.5],
    moonrise: [start - 7200, at('20:00') / 1000], moonset: [null, at('06:00') / 1000]
  };
  assert.deepEqual(moments('03:00', {}, daily), ['Nearly full moon']);
  assert.deepEqual(moments('16:00', { cloud_cover: 40 }, daily), []);
  assert.deepEqual(moments('18:00', {}, daily), ['Nearly full moon rises at 21:00']);
  assert.deepEqual(moments('22:00', {}, daily), ['Nearly full moon']);
  const newMoon = { ...daily, moon_phase: [0.09, 0.1] };
  assert.deepEqual(moments('18:00', { relative_humidity_2m: 85 }, newMoon), ['Clear, dark sky for stargazing']);
  assert.deepEqual(moments('18:00', { relative_humidity_2m: 86 }, newMoon), []);
  assert.deepEqual(moments('18:00'), []);

  const now = at('08:00');
  const invalidOptional = parseWeather(reading({ relative_humidity_2m: 120, dew_point_2m: null }, now), now);
  assert.equal(invalidOptional.humidity, undefined);
  assert.equal(invalidOptional.dewPoint, undefined);
  const stale = parseWeather(reading({}, now - 30 * minute), now);
  assert.deepEqual(photogenicWeather(stale, now), []);
});

test('static hosting requests photography inputs alongside the existing weather fields', async t => {
  const { createLiveWeather } = await import('../js/ede-weather.js');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return requests.length === 1 ? { status: 404 } : { ok: true, json: async () => [reading(), {}] };
  });
  const weather = createLiveWeather({
    now: () => observedAt, page: { hidden: false, addEventListener() {} }
  });
  t.after(() => weather.setEnabled(false));
  weather.setEnabled(true);
  await setImmediate();
  assert.equal(weather.state.status, 'fresh');
  assert.match(requests[0].pathname, /api\/ede-weather$/);
  const forecast = requests[1];
  assert.equal(forecast.hostname, 'api.open-meteo.com');
  assert.ok(forecast.searchParams.get('current').split(',').includes('dew_point_2m'));
  assert.equal(forecast.searchParams.get('daily'), 'moonrise,moonset,moon_phase');
  assert.equal(forecast.searchParams.get('past_hours'), '48');
});

test('rink ice accumulates through frost and recedes through thaw without using forecasts', async () => {
  const { parseWeather, presetRinkIce } = await import('../js/ede-weather.js');
  const hour = 3600;
  const time = observedAt / 1000;
  const starts = Array.from({ length: 49 }, (_, i) => time - (48 - i) * hour);
  const cover = (past, temperature = past.at(-1)) => parseWeather({
    ...reading({ temperature_2m: temperature }),
    hourly: { time: starts, temperature_2m: [...past, -35] }
  }, observedAt).rinkIce;
  assert.equal(cover(Array(48).fill(4)), 0);
  assert.ok(cover([...Array(47).fill(4), -1]) < 0.02);
  assert.equal(cover(Array(48).fill(-4)), 1);
  assert.ok(Math.abs(cover([...Array(42).fill(-4), ...Array(6).fill(3)]) - 0.5) < 1e-9);
  assert.equal(cover([...Array(36).fill(-4), ...Array(12).fill(4)]), 0);
  assert.equal(parseWeather(reading({ temperature_2m: -8 }), observedAt).rinkIce, undefined);
  assert.equal(presetRinkIce('winter'), 1);
  assert.equal(presetRinkIce('summer'), 0);
});

test('clear, overcast, rainy, snowy and foggy weather blend toward their scene settings', async () => {
  const { createWeatherTransition, parseWeather } = await import('../js/ede-weather.js');
  const transition = createWeatherTransition();
  const set = values => transition.setReading(parseWeather(reading(values), observedAt));

  assert.equal(transition.update(1).blend, 0);
  set({});
  const clear = { ...transition.update(12) };
  assert.ok(clear.blend > .99 && clear.cloud === 0 && clear.fog === 0 && clear.rain === 0 && clear.snow === 0);
  assert.ok(clear.windX > 5 && Math.abs(clear.windZ) < 0.005);

  set({ weather_code: 3, cloud_cover: 100 });
  const overcast = { ...transition.update(1) };
  assert.ok(overcast.cloud > 0 && overcast.cloud < 1);
  assert.ok(transition.update(10).cloud > .99);

  set({ weather_code: 80, cloud_cover: 100, rain: 2, showers: 2 });
  const onset = { ...transition.update(.25) };
  assert.equal(onset.raining, true);
  assert.ok(onset.wetness > 0 && onset.wetness < 0.05);
  const rain = { ...transition.update(8.75) };
  assert.ok(rain.rain > .99 && rain.snow === 0 && rain.wetness > .75 && rain.wetness < 1);

  set({ weather_code: 73, cloud_cover: 90, snowfall: .9 });
  const afterRain = { ...transition.update(.01) };
  assert.equal(afterRain.raining, false);
  assert.ok(afterRain.wetness > rain.wetness * .99 && afterRain.rain > .9);
  const snow = { ...transition.update(9.99) };
  assert.ok(snow.snow > .99 && snow.rain < .001);
  assert.ok(snow.wetness > rain.wetness * .85 && snow.wetness < rain.wetness);

  set({ weather_code: 45, cloud_cover: 80 });
  const fog = { ...transition.update(15) };
  assert.ok(fog.fog > .99 && fog.snow < .001 && fog.wetness < snow.wetness);

  transition.setReading(null);
  assert.ok(transition.update(.5).blend > 0);
  transition.update(12);
  assert.equal(transition.update(.01).blend, 0);
});

test('drizzle with no measurable accumulation still darkens the pavement gently', async () => {
  const { createWeatherTransition, parseWeather } = await import('../js/ede-weather.js');
  const transition = createWeatherTransition();
  transition.setReading(parseWeather(reading({ weather_code: 51 }), observedAt));
  const damp = transition.update(25);
  assert.equal(damp.raining, true);
  assert.ok(damp.wetness > 0.05 && damp.wetness < 0.1);
  transition.setReading(null);
  assert.equal(transition.update(.01).raining, false);
});

test('visible refresh retains stale weather through an outage and expires it at the model age limit', async t => {
  const { createLiveWeather } = await import('../js/ede-weather.js');
  let now = observedAt, calls = 0, fail = false, onVisibility;
  const page = { hidden: false, addEventListener(event, callback) {
    assert.equal(event, 'visibilitychange');
    onVisibility = callback;
  } };
  const weather = createLiveWeather({ now: () => now, page, request: async () => {
    calls++;
    if (fail) throw new Error('Unavailable');
    return reading({ weather_code: 48 });
  } });
  t.after(() => weather.setEnabled(false));
  assert.equal(weather.state.status, 'off');
  const preset = weather.windReading;
  assert.deepEqual(preset, { windSpeed: 18, windDirection: 225 });
  assert.equal(calls, 0);
  weather.setEnabled(true);
  assert.equal(weather.state.status, 'loading');
  await setImmediate();
  assert.equal(weather.state.status, 'fresh');
  assert.equal(weather.activeReading, weather.state.current);
  assert.equal(weather.windReading, weather.state.current);
  assert.equal(calls, 1);
  assert.equal(weather.trafficCondition, 'fog');
  assert.ok(weather.update(10).fog > .99);

  fail = true;
  page.hidden = true;
  now += 31 * minute;
  onVisibility();
  assert.equal(calls, 1);
  assert.equal(weather.state.status, 'stale');
  page.hidden = false;
  onVisibility();
  await setImmediate();
  assert.equal(calls, 2);
  assert.equal(weather.state.status, 'stale');
  assert.equal(weather.state.current.observedAt, observedAt);
  assert.equal(weather.activeReading, weather.state.current);
  assert.equal(weather.windReading, weather.state.current);
  assert.ok(weather.update(10).blend > .99);

  now += 29 * minute;
  onVisibility();
  await setImmediate();
  assert.equal(weather.state.status, 'expired');
  assert.equal(weather.activeReading, null);
  assert.equal(weather.windReading, preset);
  assert.equal(weather.trafficCondition, 'dry');
  assert.equal(weather.state.current.observedAt, observedAt);
  weather.update(15);
  assert.equal(weather.update(.01).blend, 0);
});

test('turning Live Weather off cancels an in-flight read and a late response cannot update the scene', async () => {
  const { createLiveWeather } = await import('../js/ede-weather.js');
  let resolve, signal;
  const weather = createLiveWeather({ now: () => observedAt, page: { hidden: false, addEventListener() {} },
    request: nextSignal => {
      signal = nextSignal;
      return new Promise(done => { resolve = done; });
    }
  });
  weather.setEnabled(true);
  weather.setEnabled(false);
  assert.equal(signal.aborted, true);
  resolve(reading());
  await setImmediate();
  assert.deepEqual(weather.state, { enabled: false, status: 'off', current: null });
  assert.equal(weather.activeReading, null);
  assert.equal(weather.update(10).blend, 0);
});

test('traffic reacts to preset frost and to fresh snowfall or freezing rain in Live', async t => {
  const { createLiveWeather } = await import('../js/ede-weather.js');
  let sample = { weather_code: 66, temperature_2m: 1 };
  const weather = createLiveWeather({
    now: () => observedAt, page: { hidden: false, addEventListener() {} },
    request: async () => reading(sample)
  });
  t.after(() => weather.setEnabled(false));
  weather.setPreset('rain', 'autumn');
  assert.equal(weather.trafficCondition, 'rain');
  weather.setPreset('default', 'winter');
  assert.equal(weather.trafficCondition, 'frost');
  weather.setEnabled(true);
  await setImmediate();
  assert.equal(weather.trafficCondition, 'frost');
  weather.setEnabled(false);
  sample = { weather_code: 85, temperature_2m: 2 };
  weather.setEnabled(true);
  await setImmediate();
  assert.equal(weather.trafficCondition, 'snow');
  weather.setEnabled(false);
  assert.equal(weather.trafficCondition, 'frost');
});

test('preset wind, rain and snow drive the scene offline and return after Live is turned off', async t => {
  const { createLiveWeather } = await import('../js/ede-weather.js');
  let calls = 0;
  const weather = createLiveWeather({ now: () => observedAt, page: { hidden: false, addEventListener() {} },
    request: async () => { calls++; return reading({ wind_speed_10m: 0 }); }
  });
  t.after(() => weather.setEnabled(false));
  weather.setPreset('wind-and-rain');
  assert.equal(calls, 0);
  assert.equal(weather.activeReading, null);
  assert.ok(weather.windReading.windSpeed > 30);
  assert.equal(weather.turbineWind, weather.windReading);
  assert.ok(weather.update(12).raining);
  assert.ok(weather.update(12).wetness > .5);
  weather.setEnabled(true);
  await setImmediate();
  assert.equal(weather.windReading.windSpeed, 0);
  weather.setPreset('snow');
  assert.equal(weather.windReading.windSpeed, 0);
  weather.setEnabled(false);
  assert.equal(calls, 1);
  const snow = weather.update(12);
  assert.ok(snow.snow > .75 && !snow.raining);
  assert.equal(weather.state.current, null);
});

test('calm live wind overrides the preset breeze until Live Weather is switched off', async t => {
  const { createLiveWeather } = await import('../js/ede-weather.js');
  const weather = createLiveWeather({
    now: () => observedAt, page: { hidden: false, addEventListener() {} },
    request: async () => reading({ wind_speed_10m: 0, wind_gusts_10m: 0 })
  });
  t.after(() => weather.setEnabled(false));
  const preset = weather.windReading;
  const fallback = { ...weather.update(0) };
  assert.ok(fallback.windX > 0 && fallback.windZ < 0);
  assert.ok(Math.abs(Math.hypot(fallback.windX, fallback.windZ) - 5) < 1e-10);
  weather.setEnabled(true);
  assert.equal(weather.windReading, preset);
  await setImmediate();
  assert.equal(weather.windReading, weather.state.current);
  assert.equal(weather.windReading.windSpeed, 0);
  const calming = { ...weather.update(1.8) };
  assert.ok(calming.windX > 0 && calming.windX < fallback.windX);
  weather.update(30);
  const calm = weather.update(0);
  assert.equal(Math.hypot(calm.windX, calm.windZ), 0);
  weather.setEnabled(false);
  assert.equal(weather.windReading, preset);
  weather.update(30);
  const restored = weather.update(0);
  assert.equal(restored.windX, fallback.windX);
  assert.equal(restored.windZ, fallback.windZ);
});

test('Maanderbroek hub wind stays separate from town wind and follows the shortest change in bearing', async t => {
  const { createLiveWeather, parseWeather } = await import('../js/ede-weather.js');
  const city = reading({ wind_speed_10m: 6.1 });
  const park = { time: city.current.time, wind_speed_80m: 18.6, wind_speed_120m: 19.5,
    wind_direction_80m: 359, wind_direction_120m: 1 };
  const weather = createLiveWeather({
    now: () => observedAt, page: { hidden: false, addEventListener() {} },
    request: async () => [city, { current: park }]
  });
  t.after(() => weather.setEnabled(false));
  weather.setEnabled(true);
  await setImmediate();
  assert.equal(weather.windReading.windSpeed, 6.1);
  assert.ok(Math.abs(weather.turbineWind.windSpeed - 19.03875) < 1e-6);
  assert.ok(Math.abs(weather.turbineWind.windDirection - 359.975) < 1e-6);
  assert.equal(weather.turbineWind.atHubHeight, true);
  assert.deepEqual(parseWeather({ ...city, parkWind: park }, observedAt).turbineWind, weather.turbineWind);
  assert.equal(parseWeather({ ...city, parkWind: { ...park, time: park.time - 900 } }, observedAt).turbineWind, undefined);
  assert.equal(parseWeather({ ...city, parkWind: { ...park, wind_speed_120m: null } }, observedAt).turbineWind, undefined);
  weather.setEnabled(false);
  assert.equal(weather.turbineWind, weather.windReading);
});

test('snow outlasts the flakes and temperature controls how fast water freezes and thaws', async () => {
  const { createLiveWeather, createWeatherTransition } = await import('../js/ede-weather.js');
  const weather = createLiveWeather({ page: { hidden: false, addEventListener() {} } });
  weather.setPreset('snow', 'winter');
  const onset = { ...weather.update(3) };
  assert.ok(onset.snow > onset.snowCover && onset.snowCover > 0);
  const settled = weather.update(27).snowCover;
  assert.ok(settled > 0.9);
  weather.setPreset('default', 'winter');
  const afterFlakes = weather.update(5);
  assert.ok(afterFlakes.snow < 0.01);
  assert.equal(afterFlakes.snowCover, settled);
  const cold = weather.update(25);
  assert.equal(cold.snowCover, settled, 'settled snow stays after snowfall stops in freezing weather');
  assert.equal(cold.waterIce, 1, 'Winter freezes the water even in default weather');
  weather.setPreset('default', 'spring');
  const thaw = weather.update(12);
  assert.ok(thaw.snowCover < settled && thaw.waterIce < 1);
  assert.equal(weather.update(30).waterIce, 0);

  const transition = createWeatherTransition();
  const at = (temperature, seconds) => {
    transition.setReading({ temperature, interval: 900, code: 0, rain: 0, showers: 0, snowfall: 0, cloudCover: 0 });
    return transition.update(seconds).waterIce;
  };
  assert.equal(at(-1, 30), 0.125);
  assert.equal(at(-4, 30), 0.625);
  assert.equal(at(0, 30), 0.625);
  assert.ok(at(4, 30) < 0.625);
});

test('settled snow melts faster at higher temperatures above zero', async () => {
  const { createWeatherTransition, parseWeather } = await import('../js/ede-weather.js');
  const snowfall = parseWeather(reading({ temperature_2m: -4, weather_code: 73, snowfall: 0.9 }), observedAt);
  const remaining = temperature => {
    const transition = createWeatherTransition();
    transition.setReading(snowfall);
    const settled = transition.update(40).snowCover;
    transition.setReading(null, temperature);
    return transition.update(42).snowCover / settled;
  };

  assert.equal(remaining(-2), 1);
  assert.equal(remaining(0), 1);
  const mild = remaining(2), warm = remaining(10), hot = remaining(20);
  assert.ok(mild < 1 && warm < mild && hot < warm);
  assert.ok(Math.abs(warm - Math.exp(-1)) < 1e-9);
});

test('outdoor rinks freeze and thaw gradually in presets and converge to the live history estimate', async () => {
  const { createLiveWeather, createWeatherTransition, parseWeather } = await import('../js/ede-weather.js');
  const presets = createLiveWeather({ page: { hidden: false, addEventListener() {} } });
  presets.setPreset('default', 'winter');
  assert.equal(presets.update(0).rinkIce, 0);
  assert.equal(presets.update(30).rinkIce, 0.5);
  assert.equal(presets.update(30).rinkIce, 1);
  presets.setPreset('default', 'spring');
  assert.equal(presets.update(0).rinkIce, 1);
  assert.equal(presets.update(18).rinkIce, 0.5);
  assert.equal(presets.update(18).rinkIce, 0);

  const live = createWeatherTransition();
  const warmReading = parseWeather(reading({ temperature_2m: 3 }), observedAt);
  live.setReading({ ...warmReading, rinkIce: 0.5 });
  assert.equal(live.update(0).rinkIce, 0);
  assert.equal(live.update(20).rinkIce, 0.25);
  assert.equal(live.update(40).rinkIce, 0.5);
  assert.equal(live.update(60).waterIce, 0);
  live.setReading({ ...warmReading, rinkIce: 0 });
  assert.equal(live.update(30).rinkIce, 0.25);
  assert.equal(live.update(30).rinkIce, 0);
});
