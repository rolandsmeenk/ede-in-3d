import { EDE_DATA } from './ede-geodata.js';

const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const EXPIRE_MS = 60 * 60 * 1000;
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

export function parseWeather(payload, now = Date.now()) {
  const p = payload?.current;
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
  return Object.freeze({
    source: 'Open-Meteo', observedAt,
    fetchedAt: Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : now,
    interval: p.interval, temperature: p.temperature_2m, code: p.weather_code, cloudCover: p.cloud_cover,
    rain: p.rain, showers: p.showers, snowfall: p.snowfall,
    windSpeed: p.wind_speed_10m, windDirection: p.wind_direction_10m, windGusts: p.wind_gusts_10m
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
      latitude: lat0, longitude: lon0, current: CURRENT_FIELDS.join(','),
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
  return { setEnabled, update: transition.update, get state() { return state; }, get activeReading() { return active; } };
}
