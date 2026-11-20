import { EDE_DATA } from './ede-geodata.js';

const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const EXPIRE_MS = 60 * 60 * 1000;
const PRESET_WIND = Object.freeze({ windSpeed: 18, windDirection: 225 });
const MAANDERBROEK = { latitude: 52.03207, longitude: 5.61268 };
const HUB_WEIGHT = (99.5 - 80) / (120 - 80);
const PARK_FIELDS = ['wind_speed_80m', 'wind_direction_80m', 'wind_speed_120m', 'wind_direction_120m'];
const CURRENT_FIELDS = [
  'temperature_2m', 'weather_code', 'cloud_cover', 'rain', 'showers', 'snowfall',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'
];

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
  return Object.freeze({
    source: 'Open-Meteo', observedAt,
    fetchedAt: Number.isFinite(town.fetchedAt) ? town.fetchedAt : now,
    interval: p.interval, temperature: p.temperature_2m, code: p.weather_code, cloudCover: p.cloud_cover,
    rain: p.rain, showers: p.showers, snowfall: p.snowfall,
    windSpeed: p.wind_speed_10m, windDirection: p.wind_direction_10m, windGusts: p.wind_gusts_10m,
    ...(turbineWind && { turbineWind })
  });
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
      current: [...CURRENT_FIELDS, ...PARK_FIELDS].join(','),
      timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius',
      wind_speed_unit: 'kmh', precipitation_unit: 'mm'
    });
    response = await fetch(url, options);
  }
  if (!response.ok) throw new Error(`Open-Meteo weather HTTP ${response.status}`);
  return response.json();
}

function weatherTargets(reading) {
  if (!reading) return null;
  const hourly = 3600 / reading.interval;
  const rainRate = (reading.rain + reading.showers) * hourly;
  const snowRate = reading.snowfall * hourly;
  const condition = weatherCondition(reading.code);
  const rain = Math.max(-Math.expm1(-rainRate / 2.5),
    ['Rain', 'Showers', 'Thunderstorms', 'Drizzle'].includes(condition) ? 0.12 : 0);
  const snow = Math.max(-Math.expm1(-snowRate / 0.65), condition === 'Snow' ? 0.14 : 0);
  const bearing = reading.windDirection * Math.PI / 180;
  const wind = Math.min(25, (reading.windSpeed + Math.max(0, reading.windGusts - reading.windSpeed) * 0.25) / 3.6);
  return {
    cloud: reading.cloudCover / 100, fog: condition === 'Fog' ? 1 : 0, rain, snow,
    wetness: rainRate > 0 ? 1 - 0.81 * Math.exp(-rainRate / 3) : 0,
    // The bearing is where the wind comes from. Ede uses +X east and +Z south.
    windX: -Math.sin(bearing) * wind, windZ: Math.cos(bearing) * wind
  };
}

function approach(value, target, dt, seconds) {
  return Math.abs(value - target) < 0.002 ? target : value + (target - value) * -Math.expm1(-dt / seconds);
}

export function createWeatherTransition() {
  let target = null;
  const effects = { blend: 0, cloud: 0, fog: 0, rain: 0, snow: 0, wetness: 0, windX: 0, windZ: 0 };
  return {
    setReading(reading) {
      target = weatherTargets(reading);
      if (target && effects.blend === 0) {
        for (const key of ['cloud', 'fog', 'windX', 'windZ']) effects[key] = target[key];
        effects.wetness = 0;
      }
    },
    update(dt) {
      if (!target && effects.blend === 0 && effects.rain === 0 && effects.snow === 0) return effects;
      effects.blend = approach(effects.blend, target ? 1 : 0, dt, 0.85);
      effects.rain = approach(effects.rain, target?.rain ?? 0, dt, 0.8);
      effects.snow = approach(effects.snow, target?.snow ?? 0, dt, 1.05);
      if (target) {
        effects.cloud = approach(effects.cloud, target.cloud, dt, 1.25);
        effects.fog = approach(effects.fog, target.fog, dt, 1.25);
        effects.windX = approach(effects.windX, target.windX, dt, 1.8);
        effects.windZ = approach(effects.windZ, target.windZ, dt, 1.8);
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
    const nextActive = status === 'fresh' || status === 'stale' ? current : null;
    if (nextActive !== active) {
      active = nextActive;
      transition.setReading(active);
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
    get state() { return state; },
    get activeReading() { return active; },
    get windReading() { return active ?? PRESET_WIND; },
    get turbineWind() { return active?.turbineWind ?? active ?? PRESET_WIND; }
  };
}
