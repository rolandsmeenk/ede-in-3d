import { projectFittedLane, fittedLanePoint } from './ede-lane-geometry.js';
import { CAR, VAN } from './road-access.js?v=20261122-startup';
import { findRoadTrip } from './ede-trips.js';
import { indexLocalRoads } from './traffic-area.js';

const length = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Quadratic joins keep the vehicle's heading continuous at field turns.
export function farmTrail(start, points, finish) {
  const pts = [[start.x, start.z], [start.x + 3 * start.dx, start.z + 3 * start.dz], ...points,
    [finish.x - 3 * finish.dx, finish.z - 3 * finish.dz], [finish.x, finish.z]]
    .filter((p, i, all) => i === 0 || length(p, all[i - 1]) >= 0.15);
  const samples = [pts[0]];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const before = length(a, p), after = length(p, b);
    const cut = Math.min(5.5, before * 0.4, after * 0.4);
    const sx = p[0] + (a[0] - p[0]) * cut / before, sz = p[1] + (a[1] - p[1]) * cut / before;
    const ex = p[0] + (b[0] - p[0]) * cut / after, ez = p[1] + (b[1] - p[1]) * cut / after;
    for (let j = 0; j <= 6; j++) {
      const t = j / 6, u = 1 - t;
      samples.push([u * u * sx + 2 * t * u * p[0] + t * t * ex, u * u * sz + 2 * t * u * p[1] + t * t * ez]);
    }
  }
  samples.push(pts.at(-1));
  const stations = [0];
  for (let i = 1; i < samples.length; i++) stations.push(stations[i - 1] + length(samples[i - 1], samples[i]));
  return { samples, stations, length: stations.at(-1) };
}

export function farmTrailPose(trail, at, out) {
  const { samples, stations } = trail;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stations[mid] <= at) lo = mid;
    else hi = mid;
  }
  const [ax, az] = samples[lo], [bx, bz] = samples[hi];
  const span = stations[hi] - stations[lo] || 1;
  const t = Math.min(1, Math.max(0, (at - stations[lo]) / span));
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.yaw = Math.atan2(bx - ax, bz - az);
  return out;
}

export function createServiceTrips(network, roadTraffic, sites, kind) {
  const lanes = kind + 'Lanes', moves = kind + 'Moves', farm = kind === 'tractor';
  const mode = kind === 'ambient' ? CAR : VAN;
  const localRoads = indexLocalRoads(network.edges.filter(e => e[lanes].length), []);
  function destination(site) {
    const [x, z] = farm ? site.path[0] : [site.x, site.z], nearby = [];
    localRoads(x, z, site.radius ?? 36, nearby, []);
    const goals = nearby.filter(e => !e.layer && (!site.wayIds || site.wayIds.includes(e.wayId))).flatMap(edge =>
      edge[lanes].flatMap(lane => {
        const entry = projectFittedLane(edge, lane, x, z, 0, edge.len, {});
        const distance = Math.hypot(entry.x - x, entry.z - z);
        if (distance > (site.radius ?? (farm ? 10 : 14))) return [];
        if (!farm) {
          const margin = site.radius ? 12 : kind === 'fire' ? 10 : 5;
          if (edge.len < 2 * margin) return [];
          if (!site.radius && (entry.station < margin || entry.station > edge.len - margin)) return [];
          const at = Math.min(edge.len - margin, Math.max(margin, entry.station));
          const pose = at === entry.station ? entry : fittedLanePoint(edge, lane, at, {});
          const stopDistance = Math.hypot(pose.x - x, pose.z - z);
          if (site.radius && stopDistance > site.radius) return [];
          // At the hospital, approach with the private emergency driveway on the right.
          if (site.path) {
            const [driveX, driveZ] = site.path[1];
            if ((driveZ - entry.z) * entry.dx - (driveX - entry.x) * entry.dz <= 0) return [];
          }
          return [{ edge, lane, at, x: pose.x, z: pose.z, distance: stopDistance, site }];
        }
        const [exitX, exitZ] = site.path.at(-1);
        const exit = projectFittedLane(edge, lane, exitX, exitZ, 0, edge.len, {});
        const sameSide = (z - entry.z) * entry.dx - (x - entry.x) * entry.dz;
        const at = entry.station - 7, out = exit.station + 7;
        if (sameSide < 0.35 || at < 6 || out > edge.len - 6 || out - at < 9 ||
            Math.hypot(exit.x - exitX, exit.z - exitZ) > 10) return [];
        const start = fittedLanePoint(edge, lane, at, {});
        const finish = fittedLanePoint(edge, lane, out, {});
        return [{ edge, lane, at, out, x: start.x, z: start.z, distance, site,
          trail: farmTrail(start, site.path, finish) }];
      })).sort((a, b) => a.distance - b.distance).slice(0, site.radius ? 18 : 6);
    return goals.length ? { site, goals } : null;
  }
  const rows = sites.map(destination).filter(Boolean);

  function route(v, row) {
    if (!row) return null;
    const plan = findRoadTrip(network, roadTraffic, {
      edge: v.edge, lane: v.lane, s: v.s, restriction: v.turnHistory
    }, row.goals, mode, {
      moves: edge => edge[moves], budget: farm ? 700 : 24000, range: farm ? 1800 : 22000,
    });
    return plan && { ...plan, row, index: 0 };
  }
  return { rows, route, destination };
}
