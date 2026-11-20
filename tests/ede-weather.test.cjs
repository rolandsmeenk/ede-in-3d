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

test('clear, overcast, rainy, snowy and foggy weather blend toward their scene settings', async () => {
  const { createWeatherTransition, parseWeather } = await import('../js/ede-weather.js');
  const transition = createWeatherTransition();
  const set = values => transition.setReading(parseWeather(reading(values), observedAt));

  assert.equal(transition.update(1).blend, 0);
  set({});
  const clear = { ...transition.update(12) };
  assert.ok(clear.blend > .99 && clear.cloud === 0 && clear.fog === 0 && clear.rain === 0 && clear.snow === 0);
  assert.ok(clear.windX > 5 && Math.abs(clear.windZ) < 1e-10);

  set({ weather_code: 3, cloud_cover: 100 });
  const overcast = { ...transition.update(1) };
  assert.ok(overcast.cloud > 0 && overcast.cloud < 1);
  assert.ok(transition.update(10).cloud > .99);

  set({ weather_code: 80, cloud_cover: 100, rain: 2, showers: 2 });
  const rain = { ...transition.update(9) };
  assert.ok(rain.rain > .99 && rain.snow === 0 && rain.wetness > .75 && rain.wetness < 1);

  set({ weather_code: 73, cloud_cover: 90, snowfall: .9 });
  const snow = { ...transition.update(10) };
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
  assert.equal(calls, 0);
  weather.setEnabled(true);
  assert.equal(weather.state.status, 'loading');
  await setImmediate();
  assert.equal(weather.state.status, 'fresh');
  assert.equal(weather.activeReading, weather.state.current);
  assert.equal(calls, 1);
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
  assert.ok(weather.update(10).blend > .99);

  now += 29 * minute;
  onVisibility();
  await setImmediate();
  assert.equal(weather.state.status, 'expired');
  assert.equal(weather.activeReading, null);
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
