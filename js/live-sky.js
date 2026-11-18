import { EDE_DATA } from './ede-geodata.js';

const { lat0, lon0 } = EDE_DATA.meta.lonLatAffine;
const edeClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

export const formatEdeTime = (date) => edeClock.format(date);

// NOAA solar position, adapted from John Fewell's Slop Toronto (js/live-sky.js).
// Elevation is geometric, and azimuth runs clockwise from true north.
function solarPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
    0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad)); // minutes
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = (utcMin + eqTime + 4 * lon) % 1440; // true solar time (min)
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * rad;
  const la = lat * rad;
  const zen = Math.acos(Math.min(1, Math.max(-1, Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha))));
  let az = Math.acos(Math.min(1, Math.max(-1, ((Math.sin(la) * Math.cos(zen)) - Math.sin(decl)) / (Math.cos(la) * Math.sin(zen))))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { elevation: 90 - zen / rad, azimuth: az };
}

export function edeSun(date) {
  const { elevation, azimuth } = solarPosition(date, lat0, lon0);
  const az = azimuth * Math.PI / 180;
  const el = elevation * Math.PI / 180;
  const horizontal = Math.cos(el);
  // Ede's axes point east, up and south.
  return { elevation, direction: [horizontal * Math.sin(az), Math.sin(el), -horizontal * Math.cos(az)] };
}

// Toronto's elevation anchors and smooth cross-fades between neighboring presets.
const ANCHORS = [['midnight', -9], ['twilight', -1], ['golden', 10], ['midday', 32]];

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export function livePresetBlend(elevation) {
  for (let i = 1; i < ANCHORS.length; i++) {
    const [to, upper] = ANCHORS[i];
    if (elevation <= upper) {
      const [from, lower] = ANCHORS[i - 1];
      return { from, to, weight: smoothstep((elevation - lower) / (upper - lower)) };
    }
  }
  return { from: 'midday', to: 'midday', weight: 0 };
}

export function directSunFactor(elevation) {
  return smoothstep(elevation / 6);
}
