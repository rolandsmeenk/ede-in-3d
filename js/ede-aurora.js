import { EDE_DATA } from './ede-geodata.js';

const NOAA_OVATION = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const MINUTE_MS = 60_000;
const RAD = Math.PI / 180;
const { lat0: EDE_LAT, lon0: EDE_LON } = EDE_DATA.meta.lonLatAffine;
const EARTH_RADIUS_KM = 6371;
const VIEW_DISTANCE_KM = 1000;
const SIN_EDE_LAT = Math.sin(EDE_LAT * RAD);
const COS_EDE_LAT = Math.cos(EDE_LAT * RAD);
const VIEW_LATITUDE_SPAN = VIEW_DISTANCE_KM / (RAD * EARTH_RADIUS_KM);

export function isAuroraFresh(reading, now = Date.now()) {
  if (!reading) return false;
  const { observedAt, forecastAt } = reading;
  return Number.isFinite(observedAt) && Number.isFinite(forecastAt) &&
    observedAt > now - 30 * MINUTE_MS && observedAt <= now + 5 * MINUTE_MS &&
    forecastAt >= observedAt && forecastAt <= observedAt + 90 * MINUTE_MS &&
    forecastAt <= now + 90 * MINUTE_MS;
}

function timestamp(value) {
  return typeof value === 'string' && value.endsWith('Z') ? Date.parse(value) : NaN;
}

function elevation(angle, altitude) {
  const radius = EARTH_RADIUS_KM + altitude;
  return Math.atan2(radius * Math.cos(angle) - EARTH_RADIUS_KM, radius * Math.sin(angle)) / RAD;
}

export function parseAurora(payload, now = Date.now()) {
  const result = {
    strength: 0, bearing: 0, elevation: 0,
    observedAt: timestamp(payload?.['Observation Time']),
    forecastAt: timestamp(payload?.['Forecast Time'])
  };
  if (!isAuroraFresh(result, now)) throw new Error('Invalid or stale NOAA aurora forecast');
  if (!Array.isArray(payload.coordinates)) throw new Error('Invalid NOAA aurora grid');

  let validCells = 0;
  let eastSum = 0;
  let northSum = 0;
  let elevationSum = 0;
  let weightSum = 0;
  for (const cell of payload.coordinates) {
    if (!Array.isArray(cell) || cell.length !== 3) continue;
    const [longitude, latitude, intensity] = cell;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(intensity) ||
        longitude < -180 || longitude > 360 || latitude < -90 || latitude > 90 ||
        intensity < 0 || intensity > 100) continue;
    validCells++;
    if (intensity <= 10 || Math.abs(latitude - EDE_LAT) > VIEW_LATITUDE_SPAN) continue;

    const lat = latitude * RAD;
    const lonDelta = (longitude - EDE_LON) * RAD;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const cosLonDelta = Math.cos(lonDelta);
    const east = cosLat * Math.sin(lonDelta);
    const north = COS_EDE_LAT * sinLat - SIN_EDE_LAT * cosLat * cosLonDelta;
    const horizontal = Math.hypot(east, north);
    const cosAngle = SIN_EDE_LAT * sinLat + COS_EDE_LAT * cosLat * cosLonDelta;
    const angle = Math.atan2(horizontal, cosAngle);
    const distance = angle * EARTH_RADIUS_KM;
    // A 1° cell may be centered just south of Ede while covering the sky overhead.
    if (distance > VIEW_DISTANCE_KM || (north < 0 && distance > 65)) continue;

    const top = elevation(angle, 250);
    if (top <= 0) continue;
    const bottom = Math.max(0, elevation(angle, 100));
    const center = (bottom + top) / 2;
    // shortcut: heuristic visibility weight, calibrate if local aurora observation data becomes available.
    const reach = distance / VIEW_DISTANCE_KM;
    const threshold = 10 + 25 * reach;
    const weightedIntensity = (intensity - threshold) / (100 - threshold);
    const score = weightedIntensity * (1 - 0.65 * reach) * Math.min(1, center / 10);
    if (score <= 0) continue;

    result.strength = Math.max(result.strength, score);
    const weight = score ** 3;
    eastSum += horizontal > 1e-12 ? east / horizontal * weight : 0;
    northSum += horizontal > 1e-12 ? north / horizontal * weight : 0;
    elevationSum += center * weight;
    weightSum += weight;
  }
  if (!validCells) throw new Error('Invalid NOAA aurora grid');
  if (weightSum > 0) {
    result.bearing = (Math.atan2(eastSum, northSum) / RAD + 360) % 360;
    result.elevation = elevationSum / weightSum;
  }
  return result;
}

export async function fetchAurora(signal) {
  const timeout = AbortSignal.timeout(8000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(NOAA_OVATION, {
    signal: requestSignal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
  });
  if (!response.ok) throw new Error(`NOAA aurora forecast request failed (${response.status})`);
  const payload = await response.json();
  requestSignal.throwIfAborted();
  return parseAurora(payload);
}
