// The scene clock drives two independently simulated flock routes.
const GINKEL_SHEEP = [
  [-4.4, -9.2, 0.48, 1.02], [-2.5, -8.5, 1.86, 0.69], [2.1, -10.8, -0.63, 0.98],
  [3.8, -5.7, 2.28, 1.04], [-2.9, -3.2, -1.75, 0.96], [0.7, -2, 0.83, 1],
  [4.7, 2.1, -2.74, 0.91], [-3, 2.4, -0.3, 1.06], [-5.5, 7.4, -0.88, 1.03],
  [-3.7, 8.4, -1.42, 0.73], [0.4, 7.1, 2.96, 0.95], [3.6, 11, 1.34, 1.04],
];
const KREEL_SHEEP = [
  [-4.5, -1.2, 1.55, 1.03], [2.1, -3.3, 2.2, 0.91], [-5.1, 3.0, 2.85, 0.74],
  [2.3, 0.9, -0.67, 1.02], [-0.6, 4.4, -1.75, 1.04], [-4.0, 0.2, 0.82, 1],
  [4.4, 4.1, -2.11, 0.87], [0.5, 7, 0.2, 0.98], [-2.2, -4.6, 2.42, 1.06],
];

export const EDE_FLOCK_ROUTES = [
  {
    id: 'schaapskooi-ginkelse-heide', name: 'Ginkelse Heide sheep flock',
    path: [[4325, 1076], [4323, 1086], [4319.3, 1090.6], [4319.3, 1093], [4313, 1102], [4304, 1112], [4292, 1123], [4282, 1130]],
    sheep: GINKEL_SHEEP, departure: 9 * 3600 + 15 * 60, arrival: 16 * 3600 + 35 * 60, range: 135,
  },
  {
    id: 'schaapskooi-de-kreel', name: 'De Kreel sheep flock',
    path: [[3323, 92], [3312, 93], [3299, 94], [3283, 86], [3261, 82], [3238, 70]],
    sheep: KREEL_SHEEP, departure: 9 * 3600 + 40 * 60, arrival: 16 * 3600 + 5 * 60, range: 120,
  },
].map(route => {
  let length = 0;
  const segments = route.path.slice(1).map(([x, z], i) => {
    const [fromX, fromZ] = route.path[i];
    const dx = x - fromX, dz = z - fromZ;
    const span = Math.hypot(dx, dz);
    const segment = { fromX, fromZ, dx, dz, span, start: length };
    length += span;
    return segment;
  });
  return { ...route, segments, length };
});

const WALK_SPEED = 0.72;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = t => t * t * (3 - 2 * t);

export function sampleFlock(route, seconds, index, time, grazingDay, target) {
  const [yardX, yardZ] = route.path[0];
  const [fieldX, fieldZ] = route.path.at(-1);
  const [dx, dz, yaw, scale] = route.sheep[index];
  const delay = index * 1.7;
  const journey = route.length / WALK_SPEED;
  const out = seconds - route.departure - delay;
  const home = seconds - (route.arrival - journey - (route.sheep.length - 1) * 1.7) - delay;
  if (!grazingDay || out <= 0 || home >= journey) {
    Object.assign(target, { x: yardX + dx, z: yardZ + dz, yaw, scale, walking: false, grazing: true });
    return;
  }
  if (out >= journey && home <= 0) {
    const drift = time * (.10 + index * .002) + index * 2.1;
    Object.assign(target, { x: fieldX + dx * 1.32 + Math.sin(drift) * 1.3,
      z: fieldZ + dz * 1.3 + Math.cos(drift) * .95, yaw, scale, walking: false, grazing: true });
    return;
  }
  const returning = home > 0;
  const distance = (returning ? journey - home : out) * WALK_SPEED;
  const segment = route.segments.find(s => distance < s.start + s.span) ?? route.segments.at(-1);
  const t = clamp((distance - segment.start) / segment.span, 0, 1);
  const heading = Math.atan2(segment.dx, segment.dz);
  const yard = smooth(clamp(1 - distance / 10, 0, 1));
  const field = smooth(clamp(1 - (route.length - distance) / 15, 0, 1));
  const spread = (index % 2 ? 1 : -1) * .27;
  Object.assign(target, {
    x: segment.fromX + segment.dx * t + dx * (yard + field * 1.32) + Math.cos(heading) * spread * (1 - yard - field),
    z: segment.fromZ + segment.dz * t + dz * (yard + field * 1.30) - Math.sin(heading) * spread * (1 - yard - field),
    yaw: heading + (returning ? Math.PI : 0), scale, walking: true, grazing: false,
  });
}
