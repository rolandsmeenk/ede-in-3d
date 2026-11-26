import { EDE_DATA } from './ede-geodata.js';
import { edeSun, formatEdeTime } from './live-sky.js';

const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const EXPIRE_MS = 60 * 60 * 1000;
const RINK_HISTORY_HOURS = 48;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WINTER_PRESET_TEMPERATURE = -4;
const SNOW_MELT_DEGREE_SECONDS = 420;
const ICE_FREEZE_DEGREE_SECONDS = 240;
const ICE_THAW_DEGREE_SECONDS = 360;
const PRESET_WIND = Object.freeze({ windSpeed: 18, windDirection: 225 });
const dry = { interval: 900, rain: 0, showers: 0, snowfall: 0, windGusts: 22, ...PRESET_WIND };
const breezy = { windSpeed: 39, windDirection: 250, windGusts: 58 };
const rain = { code: 63, cloudCover: 97, rain: 0.9 };
const weatherPresets = {
  clear: { ...dry, code: 0, cloudCover: 8 },
  cloudy: { ...dry, code: 3, cloudCover: 83 },
  windy: { ...dry, ...breezy, code: 2, cloudCover: 55 },
  rain: { ...dry, ...rain },
  'wind-and-rain': { ...dry, ...rain, ...breezy },
  fog: { ...dry, code: 45, cloudCover: 85, windSpeed: 6, windGusts: 9 },
  snow: { ...dry, code: 73, cloudCover: 94, snowfall: 0.32, windSpeed: 12, windGusts: 18 },
};
const MAANDERBROEK = { latitude: 52.03207, longitude: 5.61268 };
const HUB_WEIGHT = (99.5 - 80) / (120 - 80);
const PARK_FIELDS = ['wind_speed_80m', 'wind_direction_80m', 'wind_speed_120m', 'wind_direction_120m'];
const CURRENT_FIELDS = [
  'temperature_2m', 'weather_code', 'cloud_cover', 'rain', 'showers', 'snowfall',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'
];

const PHOTO_FIELDS = ['relative_humidity_2m', 'dew_point_2m'];
const MOON_FIELDS = 'moonrise,moonset,moon_phase';

const weatherTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', timeZoneName: 'short', hourCycle: 'h23'
});
export const formatWeatherTime = ms => weatherTime.format(ms);

export function weatherCondition(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([80, 81, 82].includes(code)) return 'Showers';
  if ([95, 96, 99].includes(code)) return 'Thunderstorms';
  return 'Cloud conditions';
}

function trafficCondition(reading, temperature) {
  const condition = reading && weatherCondition(reading.code);
  if (condition === 'Snow' || reading?.snowfall > 0) return 'snow';
  if (temperature <= 0 || [56, 57, 66, 67].includes(reading?.code)) return 'frost';
  if (condition === 'Fog') return 'fog';
  if (reading?.rain > 0 || reading?.showers > 0 ||
      ['Rain', 'Showers', 'Thunderstorms', 'Drizzle'].includes(condition)) return 'rain';
  return 'dry';
}

function parseTurbineWind(park, time) {
  if (park?.time !== time || !PARK_FIELDS.every(key => Number.isFinite(park[key]))) return;
  const { wind_speed_80m: low, wind_speed_120m: high, wind_direction_80m: from, wind_direction_120m: to } = park;
  if (low < 0 || high < 0 || from < 0 || from > 360 || to < 0 || to > 360) return;

  const turn = (to - from + 540) % 360 - 180;
  return Object.freeze({
    windSpeed: low + (high - low) * HUB_WEIGHT,
    windDirection: (from + turn * HUB_WEIGHT + 360) % 360,
    atHubHeight: true
  });
}

function changeRinkIce(cover, temperature, hours) {
  // Visual coverage rises with accumulated frost and melts faster in a thaw.
  const rate = temperature < 0 ? -temperature / 72 : -temperature / 36;
  return Math.max(0, Math.min(1, cover + rate * hours));
}

function rinkIceFromHistory(hourly, time, temperature) {
  const times = hourly?.time, temperatures = hourly?.temperature_2m;
  if (!Array.isArray(times) || !Array.isArray(temperatures) || times.length !== temperatures.length) return;
  const windowStart = time - RINK_HISTORY_HOURS * HOUR_SECONDS;
  let cover = 0, latestEnd;
  for (const [i, start] of times.entries()) {
    if (!Number.isInteger(start) || start + HOUR_SECONDS <= windowStart || start >= time) continue;
    const end = Math.min(time, start + HOUR_SECONDS);
    const sample = end === start + HOUR_SECONDS ? temperatures[i] : temperature;
    if (!Number.isFinite(sample) || sample < -100 || sample > 70 || start < (latestEnd ?? -Infinity)) continue;
    if (latestEnd !== undefined && latestEnd !== start) cover = 0;
    const hours = (end - Math.max(start, windowStart)) / HOUR_SECONDS;
    cover = changeRinkIce(cover, sample, hours);
    latestEnd = end;
  }
  // Between hourly samples, use the latest current reading for the partial hour.
  if (latestEnd === undefined || time - latestEnd >= HOUR_SECONDS) return;
  return changeRinkIce(cover, temperature, (time - latestEnd) / HOUR_SECONDS);
}

export function presetRinkIce(season) {
  return changeRinkIce(0, season === 'winter' ? WINTER_PRESET_TEMPERATURE : 10, RINK_HISTORY_HOURS);
}

function parseLunarDays(daily) {
  if (!Array.isArray(daily?.time)) return [];
  return daily.time.flatMap((start, i) => {
    const phase = daily.moon_phase?.[i];
    if (!Number.isInteger(start) || !Number.isFinite(phase) || phase < 0 || phase > 1) return [];
    const eventTime = time => Number.isInteger(time) && time >= start && time < start + DAY_SECONDS ? time : null;
    return [Object.freeze({ start, phase, rise: eventTime(daily.moonrise?.[i]), set: eventTime(daily.moonset?.[i]) })];
  });
}

export function parseWeather(payload, now = Date.now()) {
  const [town, park] = Array.isArray(payload) ? payload : [payload];
  const p = town?.current;
  if (!p || !CURRENT_FIELDS.every(key => Number.isFinite(p[key]))) throw new Error('Incomplete weather reading');
  const observedAt = p.time * 1000;
  if (!Number.isInteger(p.time) || observedAt <= 0 || observedAt > now + 5 * 60 * 1000 ||
      !Number.isFinite(p.interval) || p.interval < 60 || p.interval > 3600 ||
      !Number.isInteger(p.weather_code) || p.weather_code < 0 || p.weather_code > 99 ||
      p.cloud_cover < 0 || p.cloud_cover > 100 || p.temperature_2m < -100 || p.temperature_2m > 70 ||
      p.wind_direction_10m < 0 || p.wind_direction_10m > 360 ||
      [p.rain, p.showers, p.snowfall, p.wind_speed_10m, p.wind_gusts_10m].some(value => value < 0)) {
    throw new Error('Invalid weather reading');
  }
  const turbineWind = parseTurbineWind(park?.current ?? town.parkWind, p.time);
  const rinkIce = rinkIceFromHistory(town.hourly, p.time, p.temperature_2m);
  const { relative_humidity_2m: humidity, dew_point_2m: dewPoint } = p;
  const lunarDays = parseLunarDays(town.daily);
  return Object.freeze({
    source: 'Open-Meteo', observedAt,
    fetchedAt: Number.isFinite(town.fetchedAt) ? town.fetchedAt : now,
    interval: p.interval, temperature: p.temperature_2m, code: p.weather_code, cloudCover: p.cloud_cover,
    rain: p.rain, showers: p.showers, snowfall: p.snowfall,
    windSpeed: p.wind_speed_10m, windDirection: p.wind_direction_10m, windGusts: p.wind_gusts_10m,
    ...(turbineWind && { turbineWind }), ...(rinkIce !== undefined && { rinkIce }),
    ...(Number.isFinite(humidity) && humidity >= 0 && humidity <= 100 && { humidity }),
    ...(Number.isFinite(dewPoint) && dewPoint >= -100 && dewPoint <= 70 && { dewPoint }),
    ...(lunarDays.length && { lunarDays: Object.freeze(lunarDays) })
  });
}

export function photogenicWeather(reading, now = Date.now()) {
  if (!reading || now - reading.observedAt >= STALE_MS) return [];
  const { elevation } = edeSun(new Date(now));
  const { cloudCover, temperature, humidity, dewPoint, windSpeed } = reading;
  const cloudOktas = cloudCover * 8 / 100;
  const condition = weatherCondition(reading.code);
  const thunder = condition === 'Thunderstorms';
  const rainy = reading.rain + reading.showers > 0 || ['Drizzle', 'Rain', 'Showers'].includes(condition);
  const moments = [];

  if (thunder && elevation > 0 && elevation < 15) moments.push('Storm light (view from indoors)');
  if (!rainy && cloudOktas >= 1 && cloudOktas <= 6 && elevation > -4 && elevation < 12) moments.push('Possible red sky');
  if (!rainy && windSpeed <= 7.2 && temperature - dewPoint <= 2 && elevation > 0 && elevation < 15) {
    moments.push('Possible mist in low sunlight');
  }
  if (temperature >= -8 && temperature <= 0 && humidity >= 90 && windSpeed <= 10.8 && elevation > -6 && elevation < 15) {
    moments.push('Possible rime or hoar frost');
  }
  if (rainy && !thunder && cloudOktas <= 6 && elevation > 2 && elevation < 42) {
    moments.push('Possible rainbow (look away from the sun)');
  }
  if (cloudOktas <= 2 && elevation > 0 && elevation < 6) moments.push('Golden hour');
  if (cloudOktas <= 2 && elevation >= -8 && elevation <= -4) moments.push('Blue hour');
  if (!rainy && cloudOktas >= 4 && cloudOktas <= 6 && elevation > 0 && elevation < 10) {
    moments.push('Possible sunbeams through clouds');
  }
  if (condition === 'Snow' && temperature <= 2 && cloudOktas <= 5 && elevation > 5) moments.push('Snow in sunlight');

  const time = now / 1000;
  const day = reading.lunarDays?.find(({ start }) => start <= time && time < start + DAY_SECONDS);
  if (day) {
    const illuminated = (1 - Math.cos(2 * Math.PI * day.phase)) / 2;
    if (illuminated >= 0.95 && cloudOktas <= 6) {
      let lastRise = -Infinity, lastSet = -Infinity, nextRise = Infinity;
      for (const { rise, set } of reading.lunarDays) {
        if (rise !== null && rise <= time) lastRise = Math.max(lastRise, rise);
        if (set !== null && set <= time) lastSet = Math.max(lastSet, set);
        if (rise !== null && rise > time) nextRise = Math.min(nextRise, rise);
      }
      if (lastRise > lastSet) moments.push('Nearly full moon');
      else if (nextRise - time <= 3 * HOUR_SECONDS) {
        moments.push('Nearly full moon rises at ' + formatEdeTime(nextRise * 1000));
      }
    }
    if (illuminated <= 0.1 && cloudOktas <= 1 && elevation < -18 && humidity <= 85) {
      moments.push('Clear, dark sky for stargazing');
    }
  }
  return moments;
}

async function fetchWeather(signal) {
  const options = { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), cache: 'no-store' };
  let response = await fetch(new URL('../api/ede-weather', import.meta.url), options);
  if (response.status === 404 || response.status === 405) {
    // Static hosts can obtain the same current weather without a local API.
    const { lat0, lon0 } = EDE_DATA.meta.lonLatAffine;
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: [lat0, MAANDERBROEK.latitude].join(','),
      longitude: [lon0, MAANDERBROEK.longitude].join(','),
      current: [...CURRENT_FIELDS, ...PARK_FIELDS, ...PHOTO_FIELDS].join(','),
      hourly: 'temperature_2m', past_hours: RINK_HISTORY_HOURS, forecast_hours: 1,
      daily: MOON_FIELDS, past_days: 1, forecast_days: 2,
      timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius',
      wind_speed_unit: 'kmh', precipitation_unit: 'mm'
    });
    response = await fetch(url, options);
  }
  if (!response.ok) throw new Error(`Open-Meteo weather HTTP ${response.status}`);
  return response.json();
}

function windVector(reading) {
  const bearing = reading.windDirection * Math.PI / 180;
  const gust = Math.max(0, (reading.windGusts ?? reading.windSpeed) - reading.windSpeed);
  const speed = Math.min(25, (reading.windSpeed + gust * 0.25) / 3.6);
  // The bearing is where the wind comes from. Ede uses +X east and +Z south.
  return { windX: -Math.sin(bearing) * speed, windZ: Math.cos(bearing) * speed };
}

const defaultWind = windVector(PRESET_WIND);

function weatherTargets(reading, temperature) {
  if (!reading) return null;
  const hourly = 3600 / reading.interval;
  const rainRate = (reading.rain + reading.showers) * hourly;
  const snowRate = reading.snowfall * hourly;
  const condition = weatherCondition(reading.code);
  const rain = Math.max(-Math.expm1(-rainRate / 2.5),
    ['Rain', 'Showers', 'Thunderstorms', 'Drizzle'].includes(condition) ? 0.12 : 0);
  const snow = Math.max(-Math.expm1(-snowRate / 0.65), condition === 'Snow' ? 0.14 : 0);
  return {
    cloud: reading.cloudCover / 100, fog: condition === 'Fog' ? 1 : 0, rain, snow,
    snowCover: Math.min(1, snow / 0.8) * Math.max(0, Math.min(1, (3 - (temperature ?? 0)) / 3)),
    wetness: Math.max(rain * 0.65, rainRate > 0 ? 1 - 0.81 * Math.exp(-rainRate / 3) : 0),
    ...windVector(reading)
  };
}

function approach(value, target, dt, seconds) {
  return Math.abs(value - target) < 0.002 ? target : value + (target - value) * -Math.expm1(-dt / seconds);
}

export function createWeatherTransition() {
  let target = null;
  let iceRate = 0, snowMeltSeconds = 0;
  let rinkTarget = 0, rinkDegrees = 1;
  const effects = {
    blend: 0, cloud: 0, fog: 0, rain: 0, raining: false, snow: 0, snowCover: 0,
    waterIce: 0, rinkIce: 0, wetness: 0, ...defaultWind
  };
  return {
    setReading(reading, temperature = reading?.temperature, rinkIce = reading?.rinkIce ?? 0) {
      target = weatherTargets(reading, temperature);
      const degrees = temperature ?? 0;
      snowMeltSeconds = degrees > 0 ? SNOW_MELT_DEGREE_SECONDS / degrees : 0;
      iceRate = -degrees / (degrees < 0 ? ICE_FREEZE_DEGREE_SECONDS : ICE_THAW_DEGREE_SECONDS);
      rinkTarget = rinkIce;
      // A new historical estimate can change even when the current reading is near zero.
      rinkDegrees = Math.max(1, Math.abs(degrees));
      effects.raining = (target?.rain ?? 0) > 0;
      if (target && effects.blend === 0) {
        for (const key of ['cloud', 'fog']) effects[key] = target[key];
        effects.wetness = 0;
      }
    },
    update(dt) {
      const wind = target ?? defaultWind;
      effects.windX = approach(effects.windX, wind.windX, dt, 1.8);
      effects.windZ = approach(effects.windZ, wind.windZ, dt, 1.8);
      const snowTarget = target?.snowCover ?? 0;
      if (snowTarget > effects.snowCover) effects.snowCover = approach(effects.snowCover, snowTarget, dt, 10);
      else if (snowMeltSeconds > 0) effects.snowCover = approach(effects.snowCover, snowTarget, dt, snowMeltSeconds);
      effects.waterIce = Math.max(0, Math.min(1, effects.waterIce + iceRate * dt));
      const rinkDelta = rinkTarget - effects.rinkIce;
      if (rinkDelta) {
        const rinkStep = rinkDegrees * dt / (rinkDelta > 0 ? ICE_FREEZE_DEGREE_SECONDS : ICE_THAW_DEGREE_SECONDS);
        effects.rinkIce = rinkStep >= Math.abs(rinkDelta) ? rinkTarget
          : effects.rinkIce + Math.sign(rinkDelta) * rinkStep;
      }
      if (!target && effects.blend === 0 && effects.rain === 0 && effects.snow === 0) return effects;
      effects.blend = approach(effects.blend, target ? 1 : 0, dt, 0.85);
      effects.rain = approach(effects.rain, target?.rain ?? 0, dt, 0.8);
      effects.snow = approach(effects.snow, target?.snow ?? 0, dt, 1.05);
      if (target) {
        effects.cloud = approach(effects.cloud, target.cloud, dt, 1.25);
        effects.fog = approach(effects.fog, target.fog, dt, 1.25);
        effects.wetness = approach(effects.wetness, target.wetness, dt, effects.wetness < target.wetness ? 6 : 75);
      }
      return effects;
    }
  };
}

export function createLiveWeather({ onChange, request = fetchWeather, now = Date.now, page = document } = {}) {
  const transition = createWeatherTransition();
  let state = Object.freeze({ enabled: false, status: 'off', current: null });
  let enabled = false;
  let current = null;
  let active = null;
  let preset = null;
  let sceneReading = null, sceneTemperature, presetTemperature, presetIce = 0;
  let roadConditions = 'dry';
  let failed = false;
  let nextFetch = 0;
  let pending;
  let timer;

  function tick() {
    clearTimeout(timer);
    const at = now();
    const age = current ? at - current.observedAt : 0;
    const status = !enabled ? 'off'
      : !current ? failed ? 'unavailable' : 'loading'
      : age >= EXPIRE_MS ? 'expired' : age >= STALE_MS ? 'stale' : 'fresh';
    active = status === 'fresh' || status === 'stale' ? current : null;
    const nextReading = enabled ? active : preset;
    const temperature = enabled ? active?.temperature : presetTemperature;
    if (nextReading !== sceneReading || temperature !== sceneTemperature) {
      sceneReading = nextReading;
      sceneTemperature = temperature;
      roadConditions = trafficCondition(sceneReading, sceneTemperature);
      transition.setReading(sceneReading, sceneTemperature, enabled ? active?.rinkIce ?? 0 : presetIce);
    }
    const displayed = enabled ? current : null;
    if (state.status !== status || state.current !== displayed || state.enabled !== enabled) {
      state = Object.freeze({ enabled, status, current: displayed });
      onChange?.(state);
    }
    if (!enabled || page.hidden) return;
    if (!pending && at >= nextFetch) void refresh();
    let next = pending ? Infinity : nextFetch;
    if (current && age < EXPIRE_MS) {
      next = Math.min(next, current.observedAt + (age < STALE_MS ? STALE_MS : EXPIRE_MS));
    }
    if (Number.isFinite(next)) timer = setTimeout(tick, Math.max(1, next - now()));
  }

  async function refresh() {
    const controller = new AbortController();
    pending = controller;
    try {
      const payload = await request(controller.signal);
      if (pending !== controller) return;
      const reading = parseWeather(payload, now());
      if (reading.observedAt >= (current?.observedAt ?? 0)) current = reading;
      failed = false;
      nextFetch = now() + REFRESH_MS;
    } catch {
      if (pending !== controller) return;
      failed = true;
      nextFetch = now() + RETRY_MS;
    } finally {
      if (pending === controller) {
        pending = undefined;
        tick();
      }
    }
  }

  function setEnabled(value) {
    if (enabled === value) return;
    enabled = value;
    if (enabled) {
      failed = false;
      nextFetch = 0;
    } else {
      pending?.abort();
      pending = undefined;
    }
    tick();
  }

  page.addEventListener('visibilitychange', tick);
  return {
    setEnabled, update: transition.update,
    setPreset(id, season) {
      preset = Object.hasOwn(weatherPresets, id) ? weatherPresets[id] : null;
      presetTemperature = season === 'winter' ? WINTER_PRESET_TEMPERATURE : 10;
      presetIce = presetRinkIce(season);
      if (!enabled) tick();
    },
    get state() { return state; },
    get activeReading() { return active; },
    get trafficCondition() { return roadConditions; },
    get windReading() { return sceneReading ?? PRESET_WIND; },
    get turbineWind() { return sceneReading?.turbineWind ?? sceneReading ?? PRESET_WIND; }
  };
}
