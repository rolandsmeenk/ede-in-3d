import { BICYCLE, BUS, CAR, MOTOR, VAN } from './road-access.js?v=20261122-startup';

const DIRECTIONS = ['forward', 'backward'];
const LANE_CONTROLS = ['access', 'vehicle', 'motor_vehicle', 'motorcar', 'goods', 'bus', 'psv'];
const RESTRICTED = new Set(['no', 'private', 'destination', 'customers', 'delivery', 'permit', 'agricultural', 'forestry']);
const TURN_CLASS = { left: 'L', slight_left: 'L', sharp_left: 'L', through: 'S', merge_to_left: 'S',
  merge_to_right: 'S', right: 'R', slight_right: 'R', sharp_right: 'R', reverse: 'U' };
const ROAD_MARKINGS = /^(motorway|trunk|primary|secondary|tertiary)(?:_link)?$/;
const UNMARKED_SURFACE = /^(unpaved|gravel|fine_gravel|dirt|earth|ground|grass|sand|mud|compacted)$/;
const validCount = value => /^\d+$/.test(String(value)) && Number(value) <= 15 ? Number(value) : null;
const meters = value => Number(String(value ?? '').trim().replace(',', '.').replace(/\s*m$/, '')) || 0;
const bgtWidth = road => road.bgtWidth ?? road.bgt?.width;

export function edeBikeFacilities(road) {
  const width = bgtWidth(road) || road.width;
  const dedicated = road.cycle || [];
  const advisory = (road.cycleAdvisory || []).filter(strip => !dedicated.some(lane => lane.kind === 'lane' &&
    Math.sign(lane.offset) === Math.sign(strip.offset)));
  return [...dedicated, ...advisory].map(lane => (lane.kind === 'lane' || lane.kind === 'advisory') && lane.width < width
    ? { ...lane, offset: Math.sign(lane.offset) * ((width - lane.width) / 2) }
    : lane);
}

// Lateral offsets are measured to the right of travel, and lane indices increase from left to right.
export function resolveEdeRoadLanes(road, modes, official = []) {
  const tags = road.laneTags || {};
  const enabled = modes.map(mask => !!(mask & MOTOR));
  const both = enabled.every(Boolean);
  const oneWay = road.oneway ? Number(!!road.reverse) : both ? -1 : enabled.indexOf(true);
  const read = (key, d) => tags[`${key}:lanes:${DIRECTIONS[d]}`] ?? (d === oneWay ? tags[`${key}:lanes`] : undefined);
  const bgt = bgtWidth(road);
  const width = bgt || road.width;
  const widthSource = bgt ? 'bgt' : meters(tags.width) ? 'osm' : 'class';
  const bikes = edeBikeFacilities(road).filter(lane => (lane.kind === 'lane' || lane.kind === 'advisory') &&
    lane.width > 0 && lane.width < width).map(lane => ({ ...lane, permissions: BICYCLE }));
  // A dedicated lane takes space out of the motor carriageway. Advisory paint shares the available width.
  let left = -width / 2, right = width / 2;
  for (const lane of bikes) {
    if (lane.kind !== 'lane') continue;
    if (lane.offset < 0) left = Math.max(left, lane.offset + lane.width / 2);
    if (lane.offset > 0) right = Math.min(right, lane.offset - lane.width / 2);
  }
  if (right <= left) { left = -width / 2; right = width / 2; }
  const centerCount = both ? validCount(tags['lanes:both_ways']) ?? 0 : 0;
  const laneTags = enabled.map((_, d) => Object.fromEntries(['turn', ...LANE_CONTROLS].map(key => [key, read(key, d)?.split('|')])));
  const legacy = !road.laneTags && { motorway: 4, trunk: 4, primary: 2, secondary: 2, tertiary: 2,
    residential: 2, unclassified: 2, living_street: 1, service: 1 }[road.kind?.replace(/_link$/, '')];
  const total = validCount(tags.lanes) ?? (legacy && legacy !== road.lanes ? validCount(road.lanes) : null);
  const count = enabled.map((yes, d) => {
    if (!yes) return { lanes: 0, source: 'access', confidence: 'high' };
    const confirmed = validCount(official[d]?.lanes);
    const directional = validCount(tags[`lanes:${DIRECTIONS[d]}`]);
    const listed = road.laneModes?.[d]?.length ?? Math.max(0, ...Object.values(laneTags[d]).map(values => values?.length || 0));
    if (confirmed > 0) return { lanes: confirmed, source: 'weggeg', confidence: 'high', evidence: official[d] };
    if (directional > 0) return { lanes: directional, source: 'osm-direction', confidence: 'high' };
    if (total > 0 && !both) return { lanes: total, source: 'osm', confidence: 'high' };
    if (listed > 0) return { lanes: listed, source: 'osm-lane-tags', confidence: 'high' };
    return null;
  });
  const available = right - left;
  const fast = /^(motorway|trunk)(?:_link)?$/.test(road.kind);
  for (const d of [0, 1]) {
    if (count[d]) continue;
    const inferred = total > 0 && (count[1 - d] ? total - centerCount - count[1 - d].lanes : Math.ceil((total - centerCount) / 2));
    const target = fast ? 3.55 : both ? 3.0 : 3.75;
    const estimate = Math.max(1, Math.floor(available / (both ? 2 : 1) / target));
    count[d] = inferred > 0 ? { lanes: inferred, source: 'osm-split', confidence: 'medium' }
      : { lanes: estimate, source: 'width', confidence: 'low' };
  }
  const totalCount = count[0].lanes + count[1].lanes + centerCount;
  const laneWidth = Math.min(3.6, available / totalCount);
  const band = (left + right - laneWidth * totalCount) / 2;
  const markings = tags.lane_markings !== 'no' && !UNMARKED_SURFACE.test(road.surface || '');
  return count.map(({ lanes: n, ...evidence }, d) => {
    const sign = 1 - 2 * d;
    const offset = i => sign * (band + (i + 0.5) * laneWidth);
    const turnTags = laneTags[d].turn;
    const knownModes = road.laneModes?.[d];
    const lanes = Array.from({ length: n }, (_, i) => {
      const turns = turnTags?.length === n ? turnTags[i].split(';').filter(turn => TURN_CLASS[turn]) : [];
      let permissions = (knownModes?.[i] ?? modes[d]) & modes[d] & MOTOR;
      if (Object.values(laneTags[d]).some(values => values?.length === n)) {
        const at = key => laneTags[d][key]?.length === n ? laneTags[d][key][i] : undefined;
        const access = at('motor_vehicle') || at('vehicle') || at('access');
        const car = at('motorcar'), van = at('goods') || car, bus = at('bus') || at('psv');
        for (const [mode, value] of [[CAR, car], [VAN, van], [BUS, bus]]) {
          if (RESTRICTED.has(value || access)) permissions &= ~mode;
        }
        if (bus === 'designated' && (!access || RESTRICTED.has(access))) {
          if (!car || RESTRICTED.has(car)) permissions &= ~CAR;
          if (!van || RESTRICTED.has(van)) permissions &= ~VAN;
        }
      }
      return { offset: offset(d ? count[1].lanes - 1 - i : count[1].lanes + centerCount + i), width: laneWidth,
        permissions, busOnly: permissions === BUS, turns: turns.length ? turns : null };
    });
    const centers = Array.from({ length: centerCount }, (_, i) => ({ offset: offset(count[1].lanes + i), width: laneWidth,
      permissions: modes[0] & modes[1] & MOTOR }));
    return { count: n, totalCount, width, widthSource, ...evidence, fast,
      markings: markings && (tags.lane_markings === 'yes' || evidence.source !== 'width' || ROAD_MARKINGS.test(road.kind)),
      lanes, centers, bikes: bikes.filter(lane => lane.allowed[d]).map(lane => ({ ...lane, offset: sign * lane.offset })) };
  });
}

export function permittedTurn(lane, turn, cross) {
  if (!lane?.turns) return true;
  return lane.turns.some(tag => TURN_CLASS[tag] === turn ||
    tag === 'slight_left' && turn === 'S' && cross < -0.1 || tag === 'slight_right' && turn === 'S' && cross > 0.1);
}

export function shareTurn(a, b) {
  return a?.turns && b?.turns && a.turns.some(turn => b.turns.some(other => TURN_CLASS[turn] === TURN_CLASS[other]));
}
