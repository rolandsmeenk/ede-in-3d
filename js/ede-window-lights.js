import { HOUR, localClock, weekday } from './ede-transit-time.js';

const home = [[0, .12], [2, .045], [5, .06], [7, .33], [10, .16], [15, .24], [18, .58], [21, .64], [23, .34], [24, .12]];
const office = [[0, .04], [6, .04], [8, .49], [9, .68], [16.5, .68], [18, .38], [20, .15], [22, .06], [24, .04]];
const shop = [[0, .06], [7, .06], [9, .59], [17, .57], [19, .31], [21, .14], [23, .06], [24, .06]];

export const PRESET_WINDOW_LIGHTS = {
  golden: [0, 0, 0], midday: [0, 0, 0], twilight: [.53, .23, .31], midnight: [.52, .09, .14],
};

function interpolate(profile, hour) {
  for (let i = 1; i < profile.length; i++) {
    const [end, b] = profile[i];
    if (hour <= end) {
      const [start, a] = profile[i - 1];
      return a + (b - a) * (hour - start) / (end - start);
    }
  }
  return profile[0][1];
}

export function liveWindowLights(date, elevation) {
  // Solar elevation is geometric. The visible sun sets at roughly −0.83°.
  const shade = Math.min(1, (-0.83 - elevation) / 3.17);
  if (shade <= 0) return PRESET_WINDOW_LIGHTS.midday;
  const local = localClock(date.getTime() / 1000);
  const hour = local.seconds / HOUR;
  const day = weekday(local.date);
  const weekend = day === 0 || day === 6;
  const darkness = shade * shade * (3 - 2 * shade);
  return [interpolate(home, hour), weekend ? .035 : interpolate(office, hour), interpolate(shop, hour) * (day === 0 ? .65 : 1)]
    .map(level => level * darkness);
}

const usageCodes = { unlit: 0, home: 1, office: 2, shop: 3, mixed: 4, unknown: 5 };
const osmUses = {
  house: 'home', apartments: 'home', detached: 'home', semidetached_house: 'home', terrace: 'home',
  residential: 'home', dormitory: 'home', office: 'office', commercial: 'office', school: 'office',
  college: 'office', university: 'office', retail: 'shop', supermarket: 'shop',
  garage: 'unlit', garages: 'unlit', shed: 'unlit', barn: 'unlit', industrial: 'unlit', warehouse: 'unlit',
  carport: 'unlit', farm_auxiliary: 'unlit', greenhouse: 'unlit', construction: 'unlit', parking: 'unlit',
};

// Integer part selects the schedule. The fraction keeps the same building pattern across views.
export function windowLightKey(building, x, z) {
  const use = building?.bagUse ?? osmUses[building?.kind] ?? 'unknown';
  if (use === 'unlit') return 0;
  const id = building?.id ?? `${Math.round(x)}/${Math.round(z)}`;
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return usageCodes[use] + ((hash >>> 0) % 8192) / 8192;
}
