import { createCoverageIndex } from './ede-boundary-index.js';
import { osmRoadMaterial } from './ede-road-surfaces.js';
import { EDE_WHITE_BIKE_SITES } from './ede-white-bike-sites.js';

// PDOK/RVO Nationale Parken, De Hoge Veluwe. Inset 2 m before simplifying by 1 m.
// https://api.pdok.nl/rvo/nationale-parken/ogc/v1/collections/nationaleparken/items/4c3aee4a-7435-52e3-b67a-ed9f2cbf5e99
const parkRing = [
  13369.303, -8767.742, 13345.599, -8787.413, 13326.431, -8798.237, 13296.282, -8804.911, 13254.831, -8809.555,
  13147.954, -8825.554, 13077.975, -8830.4, 12506.086, -8910.641, 12372.927, -8926.801, 12285.595, -8940.482,
  12115.343, -8959.055, 12069.496, -8965.905, 12028.182, -8968.344, 11938.687, -8966.727, 11890.74, -8962.671,
  11785.998, -8945.88, 11067.757, -8721.396, 11080.044, -8679.471, 11078.891, -8677.061, 10979.237, -8646.939,
  10977.658, -8649.28, 10984.299, -8668.798, 10984.36, -8678.848, 10619.211, -8553.005, 10150.488, -8387.401,
  10104.114, -8405.014, 9859.457, -8343.171, 9828.696, -8338.964, 9465.905, -8317.04, 9238.572, -8324.916,
  8985.159, -8328.563, 8625.259, -8339.343, 8531.638, -8289.901, 8490.175, -8259.683, 8446.278, -8218.413,
  7855.853, -7710.074, 7638.482, -7497.03, 7525.464, -7391.577, 7846.721, -6853.983, 7919.283, -6832.803,
  7925.355, -6331.455, 7894.034, -6178.796, 8418.07, -5074.724, 8586.944, -4897.094, 8678.893, -4843.37,
  8738.829, -4601.934, 8678.664, -4365.936, 8708.592, -4283.105, 8729.868, -4173.259, 8737.934, -4055.054,
  8753.84, -3448.157, 8387.738, -3399.018, 8359.64, -3392.688, 7934.965, -3188.324, 8139.192, -2788.75,
  8712.234, -1473.56, 9061.016, -660.321, 9063.194, -638.166, 9228.866, -263.595, 9269.651, -136.337,
  9282.462, -88.158, 9293.128, -59.869, 9424.616, 201.017, 9428.341, 212.369, 9441.825, 206.678,
  9443.963, 207.317, 9516.758, 315.987, 9591.474, 293.171, 9646.009, 392.662, 9644.955, 395.283,
  9530.857, 444.135, 9624.688, 685.587, 9762.215, 1022.985, 9794.439, 1077.566, 9822.341, 1110.236,
  9856.728, 1136.417, 9899.928, 1156.22, 9938.879, 1169.497, 10006.153, 1182.969, 10180.396, 1197.119,
  10293.711, 1210.918, 10391.734, 1215.878, 10433.547, 1222.755, 10601.237, 1267.518, 11090.934, 1417.018,
  11103.998, 1425.761, 11251.763, 1426.678, 11613.562, 1448.612, 11905.642, 1461.385, 12232.917, 1487.388,
  12239.499, 1441.187, 12241.5, 1439.469, 12329.761, 1449.12, 12330.596, 1451.177, 12322.067, 1492.564,
  12838.508, 1517.672, 13124.036, 1534.848, 13178.716, 1537.318, 13190.985, 1314.154, 13192.149, 1312.446,
  13572.077, 1336.506, 13489.234, 757.976, 12574.064, 459.274, 12408.041, 314.248, 12695.901, -660.066,
  13043.905, -682.872, 13111.937, -735.434, 12983.271, -890.11, 12955.074, -961.782, 13222.764, -1181.539,
  13274.726, -1490.188, 13005.229, -1906.654, 12959.842, -1959.327, 12959.552, -1961.493, 13105.565, -2094.953,
  13598.661, -2113.638, 13718.318, -2225.503, 13798.731, -3145.353, 13800.438, -3146.588, 14135.347, -3170.464,
  14230.952, -3468.439, 14287.282, -3471.213, 14234.64, -4046.725, 14218.539, -4248.009, 14208.328, -4353.144,
  14186.482, -4996.151, 14175.304, -5280.57, 14180.86, -6424.264, 14101.705, -6422.697, 14057.62, -6445.044,
  14022.418, -6469.62, 13963.342, -6536.438, 13965.832, -6596.443, 13970.988, -6608.583, 13978.171, -6613.248,
  14136.185, -6668.395, 14025.725, -7047.762, 14000.106, -7130.917, 13982.852, -7168.317, 13929.42, -7343.618,
  13922.99, -7372.413, 13900.16, -7547.335, 13847.374, -7738.192, 13701.174, -7709.204, 13673.078, -7822.609,
  13614.37, -7817.027, 13564.014, -7901.364, 13564.852, -7903.74, 13760.561, -8023.824, 13370.298, -8656.825,
  13370.936, -8659.327, 13448.43, -8714.562, 13435.219, -8735.644, 13410.773, -8725.745,
];
const area = createCoverageIndex([[parkRing]]);
const allowedTracks = new WeakMap();

function insidePark(track) {
  const { ax, az, ux, uz, len } = track;
  const bx = ax + ux * len, bz = az + uz * len;
  return area.coversBounds(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
}

export function whiteBikeTrack(track) {
  if (!allowedTracks.has(track)) {
    const material = osmRoadMaterial(track);
    const paved = material ? material !== 'gravel' && material !== 'sand'
      : track.surface === 'paved' || (!track.surface && (track.roadKind === 'cycleway' || track.kind === 'lane'));
    allowedTracks.set(track, !track.mountain && paved && insidePark(track));
  }
  return allowedTracks.get(track);
}

const entrances = EDE_WHITE_BIKE_SITES.filter(site => site.entrance);
const highlights = EDE_WHITE_BIKE_SITES.filter(site => !site.entrance);
const originWeights = new WeakMap();

export function whiteBikeOriginWeight(track, returns) {
  if (!originWeights.has(track)) {
    const x = track.ax + track.ux * track.len / 2, z = track.az + track.uz * track.len / 2;
    originWeights.set(track, [entrances, highlights].map(sites => {
      const distance = Math.min(...sites.map(site => Math.hypot(site.x - x, site.z - z)));
      return Math.max(0, 1 - distance / 550);
    }));
  }
  const [entrance, highlight] = originWeights.get(track);
  return .85 + .75 * ((1 - returns) * entrance + returns * highlight);
}

export function useWhiteBike(track, draw = Math.random) {
  return whiteBikeTrack(track) && draw() < .75;
}

export function whiteBikePath(path) {
  return path.every(({ track }) => track.kind === 'connector'
    ? !track.sharedRoad && insidePark(track) : whiteBikeTrack(track));
}

// Local opening and closing hours by calendar month: https://hogeveluwe.nl/plan-je-bezoek/openingstijden
const openingHours = [9, 9, 9, 8, 8, 8, 8, 8, 9, 9, 9, 9];
const closingHours = [18, 18, 18, 20, 21, 22, 22, 21, 20, 19, 18, 18];

export function hogeVeluweBikeReturns(activity) {
  return activity ? Math.max(0, Math.min(1, (activity.minute - 13 * 60) / 165)) : 0;
}

export function hogeVeluweBikeActivity(activity) {
  if (!activity) return 0;
  const { date, minute, weekday, holiday, schoolHoliday } = activity;
  const month = Number(date.slice(5, 7)) - 1;
  const sinceOpening = minute - openingHours[month] * 60;
  const untilClosing = closingHours[month] * 60 - minute;
  const busyDay = weekday === 0 || weekday === 6 || holiday || schoolHoliday;
  // Build toward midday and taper as bikes return. Hours are real; demand is illustrative.
  return Math.max(0, Math.min(1, sinceOpening / 150, untilClosing / 105)) * (busyDay ? 1 : .78);
}
