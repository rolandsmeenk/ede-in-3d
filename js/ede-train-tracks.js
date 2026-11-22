import { EDE_DATA } from './ede-geodata.js';
import { EDE_NORTH_RAIL, hasNorthRail } from './ede-north-rail-data.js';
import { getRailCorridors, railCorridorHeightAt, railHeightAt, RAIL_TOP } from './ede-grade.js';
import { terrainHeightAt } from './terrain.js';

const WAGENINGEN = 'ede-wageningen';
const CENTRUM = 'ede-centrum';
const KLOMP = 'de-klomp';
const LUNTEREN = 'lunteren';
const APPROACH_MARGIN = 120;

const eastbound = [
  431666248, 431660809, 458879661, 458879659, 431660820, 643484752,
  556549485, 1092211193, 1052080207, 1092211189, 556549460, 431925036
];
const westbound = [
  431666247, 6306101, 431662176, 458879660, 643484751, 643484754,
  458879658, 556549482, 431570154, 431533794, 431657554, 1092211191,
  431658944, 431533773, 556549455, 431925039
];
// Shared OSM endpoints continue both main tracks west past the De Klomp platforms.
const klompApproaches = [
  [431677499, 89448802, 431666249],
  [431672567, 6306043]
];
const klompStops = {
  '1': [-6780.56, -10.71],
  '2': [-6546.74, 62.94],
};
const sprinterEast = [431639755, 1052080205, 1054198061, 1092211189, 556549460, 431925036];
const sprinterWest = [431639755, 1052080205, 1092211190, 431658944, 431533773, 556549455, 431925039];
// The western crossover joins the eastbound approach at an interior map node.
const crossoverTo3 = [...eastbound.slice(0, 6), [556549485, -658, 1819.8], 1092211192, ...westbound.slice(7)];
const through4East = [...eastbound.slice(0, 8), 431533734, ...sprinterEast];
const through4West = [...westbound.slice(0, 9), 89438305, ...sprinterWest];
const valleilijn = [431762038, 431865751, 556549500, 431533902, 556549466, 227837719, 431638734];

// Project the centers of the BGT passenger platforms onto the corresponding rails.
// Track 1's western berth and the Arnhem Sprinter berth sit on separate approaches.
const stopsByPlatform = {
  '1': [120, 2039],
  '3': [177, 2067],
  '4': [177, 2075],
  '5': [177, 2092]
};
const centrumStop = [-247, 317];

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const samePoint = (a, b) => a.x === b.x && a.z === b.z;

function buildAlignment(ids, ways, bounds) {
  const lines = ids.map(entry => {
    const [id, splitX, splitZ] = Array.isArray(entry) ? entry : [entry];
    const way = ways.get(`w${id}`);
    if (!way || way.tunnel) throw new Error(`Unavailable Ede passenger rail w${id}`);
    const points = [];
    for (let i = 0; i < way.pts.length; i += 2) points.push({ x: way.pts[i], z: way.pts[i + 1] });
    if (splitX !== undefined) {
      const split = points.findIndex(point => point.x === splitX && point.z === splitZ);
      if (split < 1) throw new Error(`Unavailable Ede passenger rail junction on ${way.id}`);
      points.length = split + 1;
    }
    return { way, points };
  });
  const [first, second] = lines;
  const connectedAtStart = samePoint(first.points[0], second.points[0])
    || samePoint(first.points[0], second.points.at(-1));
  if (connectedAtStart) first.points.reverse();

  const segments = [];
  let length = 0, last = first.points[0];
  for (const { way, points } of lines) {
    if (!samePoint(last, points[0])) points.reverse();
    if (!samePoint(last, points[0])) throw new Error(`Disconnected Ede passenger rail ${way.id}`);
    for (const end of points.slice(1)) {
      const dx = end.x - last.x, dz = end.z - last.z;
      const span = Math.hypot(dx, dz);
      if (span > 0) {
        segments.push({ ...last, dx, dz, span, distance: length, endDistance: length + span, way, end });
        length += span;
      }
      last = end;
    }
  }

  // These corridors enter and leave the map only once per side.
  let start = Infinity, end = -Infinity;
  for (const segment of segments) {
    let from = 0, to = 1;
    for (const [position, delta, min, max] of [
      [segment.x, segment.dx, bounds[0], bounds[2]],
      [segment.z, segment.dz, bounds[1], bounds[3]]
    ]) {
      if (!delta) {
        if (position < min || position > max) to = -1;
        continue;
      }
      const a = (min - position) / delta, b = (max - position) / delta;
      from = Math.max(from, Math.min(a, b));
      to = Math.min(to, Math.max(a, b));
    }
    if (from <= to) {
      start = Math.min(start, segment.distance + from * segment.span);
      end = Math.max(end, segment.distance + to * segment.span);
    }
  }
  if (!(end > start)) throw new Error('Ede passenger rail misses the playable map');

  function positionAt(distance, out) {
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (distance < segments[mid].endDistance) hi = mid;
      else lo = mid + 1;
    }
    const segment = segments[lo];
    const t = (distance - segment.distance) / segment.span;
    out.x = segment.x + segment.dx * t;
    out.z = segment.z + segment.dz * t;
    return segment;
  }

  function project(x, z, wayId) {
    let best = { distance: start, errorSquared: Infinity };
    for (const segment of segments) {
      if (segment.endDistance < start || segment.distance > end || (wayId && segment.way.id !== wayId)) continue;
      const t = clamp(
        ((x - segment.x) * segment.dx + (z - segment.z) * segment.dz) / (segment.span ** 2),
        Math.max(0, (start - segment.distance) / segment.span),
        Math.min(1, (end - segment.distance) / segment.span)
      );
      const errorSquared = (segment.x + segment.dx * t - x) ** 2 + (segment.z + segment.dz * t - z) ** 2;
      if (errorSquared < best.errorSquared) best = { distance: segment.distance + segment.span * t, errorSquared };
    }
    return { distance: best.distance, error: Math.sqrt(best.errorSquared) };
  }

  if (lines.every(({ way }) => getRailCorridors().has(way.id))) {
    return { start, end, project, positionAt, elevationAt: (distance, { x, z }, segment) =>
      (railCorridorHeightAt(segment.way.id, x, z) ?? terrainHeightAt(x, z)) + RAIL_TOP };
  }

  // Interpolate the legacy height samples at the edge of a local fitted profile.
  const intervals = Math.ceil((end - start) / 2);
  const elevationStep = (end - start) / intervals;
  const heights = new Float32Array(intervals + 1);
  const position = {};
  for (let i = 0; i < heights.length; i++) {
    const distance = start + i * elevationStep;
    const segment = positionAt(distance, position);
    const { x, z } = position;
    let height = railHeightAt(segment.way.id, x, z);
    if (height === undefined && segment.way.bridge) {
      const a = terrainHeightAt(segment.x, segment.z);
      const b = terrainHeightAt(segment.end.x, segment.end.z);
      height = a + (b - a) * (distance - segment.distance) / segment.span;
    }
    heights[i] = (height ?? terrainHeightAt(x, z)) + RAIL_TOP;
  }
  function elevationAt(distance) {
    const index = (distance - start) / elevationStep;
    const i = Math.min(Math.floor(index), heights.length - 2);
    return heights[i] + (heights[i + 1] - heights[i]) * (index - i);
  }
  return { start, end, project, positionAt, elevationAt };
}

function trainPath(id, route, direction, platform, alignment, terminal, klompPlatform) {
  const { start, end } = alignment;
  const fromAlignment = distance => direction === 1 ? distance - start : end - distance;
  const before = {}, after = {};
  const path = {
    id, route, direction, terminal, length: end - start, stops: {},
    sample(distance, out = {}) {
      const d = direction === 1 ? start + distance : end - distance;
      const position = clamp(d, start, end);
      const segment = alignment.positionAt(position, out);
      alignment.positionAt(Math.max(start, position - 5), before);
      alignment.positionAt(Math.min(end, position + 5), after);
      out.y = alignment.elevationAt(position, out, segment);
      out.heading = Math.atan2(direction * (before.x - after.x), direction * (before.z - after.z));
      return out;
    },
    project(x, z, wayId) {
      const hit = alignment.project(x, z, wayId);
      return { distance: fromAlignment(hit.distance), error: hit.error };
    }
  };
  path.stops[WAGENINGEN] = { distance: path.project(...stopsByPlatform[platform]).distance, platform };
  if (klompPlatform) {
    const { distance } = path.project(...klompStops[klompPlatform]);
    path.stops[KLOMP] = { distance, platform: klompPlatform };
  }
  if (route === 'rs34') {
    path.stops[CENTRUM] = { distance: path.project(...centrumStop).distance, platform: '1' };
    // OVapi boarding coordinates for Ede-Wageningen stops 3133741 and 3133742.
    path.stops[WAGENINGEN].sections = {
      '1a': path.project(-45.21, 1984.22).distance,
      '1b': path.project(150.17, 2040.8).distance
    };
  }
  return path;
}

function addLunterenBerth(path, platform) {
  const { wayId, stop, number } = platform;
  path.stops[LUNTEREN] = { distance: path.project(...stop, wayId).distance, platform: number };
  const [northSwitch, southSwitch] = EDE_NORTH_RAIL.switches.map(point => path.project(...point).distance);
  const stationApproach = path.project(-245.5, 1883.9).distance;
  // The two single tracks meet at Lunteren, where an opposing train can wait on
  // its own platform. Ede Centrum lies inside the southern single-track section.
  path.blocks = path.direction === 1 ? [
    { id: 'lunteren-north', from: 0, to: northSwitch },
    { id: 'lunteren-south', from: southSwitch, to: stationApproach },
  ] : [
    { id: 'lunteren-south', from: stationApproach, to: southSwitch },
    { id: 'lunteren-north', from: northSwitch, to: path.length },
  ];
}

export function buildEdeTrainTracks() {
  const ways = new Map(EDE_DATA.railways.map(way => [way.id, way]));
  const [minX, minZ, maxX, maxZ] = EDE_DATA.meta.bounds;
  const bounds = [minX - APPROACH_MARGIN, minZ - APPROACH_MARGIN, maxX + APPROACH_MARGIN, maxZ + APPROACH_MARGIN];
  const extendsToKlomp = klompApproaches.flat().every(id => ways.has(`w${id}`));
  const klompEast = extendsToKlomp ? '2' : undefined;
  const klompWest = extendsToKlomp ? '1' : undefined;
  const mainAlignment = (ids, side) => buildAlignment(extendsToKlomp ? [...klompApproaches[side], ...ids] : ids, ways, bounds);
  const track5 = mainAlignment(eastbound, 0);
  const track3 = mainAlignment(westbound, 1);
  const valleilijnBounds = [bounds[0], bounds[1], 230, bounds[3]];
  const northern = hasNorthRail(EDE_DATA);
  const rs34 = direction => {
    const id = direction === 1 ? 'rs34-south' : 'rs34-north';
    const platform = EDE_NORTH_RAIL.platforms.find(berth => berth.number === (direction === 1 ? '1' : '2'));
    const prefix = northern ? [1299229167, 431725851, 227525838, Number(platform.wayId.slice(1)), 431760968] : [];
    const track = buildAlignment([...prefix, ...valleilijn], ways, valleilijnBounds);
    const path = trainPath(id, 'rs34', direction, '1', track, WAGENINGEN);
    if (northern) addLunterenBerth(path, platform);
    return path;
  };
  const paths = [
    trainPath('main-5-east', 'main', 1, '5', track5, undefined, klompEast),
    trainPath('main-3-west', 'main', -1, '3', track3, undefined, klompWest),
    trainPath('main-4-east', 'main', 1, '4', buildAlignment(sprinterEast, ways, bounds), WAGENINGEN),
    trainPath('main-4-west', 'main', -1, '4', buildAlignment(sprinterWest, ways, bounds), WAGENINGEN),
    trainPath('main-3-east', 'main', 1, '3', mainAlignment(crossoverTo3, 0), undefined, klompEast),
    trainPath('main-5-west', 'main', -1, '5', track5, undefined, klompEast),
    trainPath('main-4-through-east', 'main', 1, '4', mainAlignment(through4East, 0), undefined, klompEast),
    trainPath('main-4-through-west', 'main', -1, '4', mainAlignment(through4West, 1), undefined, klompWest),
    rs34(1), rs34(-1)
  ];

  function match(fix, { route, direction, platform, terminal, preferredPath, previous } = {}) {
    const { x, z, bearing, speed, timestamp } = fix;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const platformCode = String(platform?.platform ?? platform ?? '').trim().toLowerCase().replace(/^1a$/, '1');
    const platformStation = platform?.station ?? WAGENINGEN;
    const elapsed = timestamp - previous?.timestamp;
    if (elapsed < 0) return null;
    const recent = previous?.path && (Number.isNaN(elapsed) || elapsed <= 180);
    const matchRoute = route ?? (recent ? previous.path.route : undefined);
    const matchDirection = direction ?? (recent ? previous.path.direction : undefined);
    const useBearing = Number.isFinite(bearing) && bearing >= 0 && bearing <= 360 && !(speed < 2);
    const bearingRadians = bearing * Math.PI / 180;
    let best = null, bestScore = Infinity;

    for (const path of paths) {
      if ((matchRoute && path.route !== matchRoute) || (matchDirection && path.direction !== matchDirection)) continue;
      if (terminal != null && Boolean(path.terminal) !== terminal) continue;
      if (platformCode && path.stops[platformStation]?.platform !== platformCode) continue;
      const hit = path.project(x, z);
      if (hit.error > 70) continue;
      const point = path.sample(hit.distance);
      const agreement = useBearing ? Math.cos(point.heading + bearingRadians) : 1;
      if (agreement < 0.2) continue;
      let score = hit.error + 14 * (1 - agreement) - (path === preferredPath ? 1.75 : 0);

      if (recent && previous.path.direction === path.direction && previous.path.route === path.route) {
        let oldDistance = previous.distance;
        if (path !== previous.path) {
          const oldPoint = previous.path.sample(previous.distance);
          const shared = path.project(oldPoint.x, oldPoint.z);
          if (shared.error > 1.25) continue;
          oldDistance = shared.distance;
          score += 3;
        }
        const progress = hit.distance - oldDistance;
        if (progress < -35 || (elapsed >= 0 && progress > 60 * elapsed + 80)) continue;
        if (progress < 0) score += -0.2 * progress;
      }

      if (score < bestScore) {
        bestScore = score;
        best = { ...point, ...hit, path, timestamp };
      }
    }
    return best;
  }

  return { paths, match };
}
