import fs from 'node:fs';
import path from 'node:path';
import { CAR, VAN, BUS, BICYCLE, FOOT, MOTOR } from '../js/road-access.js';

const ALLOW = new Set(['yes', 'designated', 'permissive', 'official']);
const DENY = new Set(['no', 'private', 'destination', 'customers', 'delivery', 'permit',
  'agricultural', 'forestry', 'use_sidepath', 'dismount']);
const KEYS = [
  [CAR, ['motorcar', 'motor_vehicle', 'vehicle', 'access'], 'auto'],
  [VAN, ['goods', 'motorcar', 'motor_vehicle', 'vehicle', 'access'], 'auto'],
  [BUS, ['bus', 'psv', 'motor_vehicle', 'vehicle', 'access'], 'autobs'],
  [BICYCLE, ['bicycle', 'vehicle', 'access'], 'fiets'],
  [FOOT, ['foot', 'access'], 'vtgngr'],
];

const PUBLIC_ROAD = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)(?:_link)?$/;
const SIDEWALK = /^(yes|both|left|right)$/;
const LIMITS = { maxheight: 'height', maxwidth: 'width', maxweight: 'weight', maxlength: 'length',
  maxaxleload: 'axleLoad', maxspeed: 'speed' };
// Both line 3 directions use these Braamberg/Valkenberg links beyond the signed PSV section.
const GTFS_LINE_3_ACCESS = new Set([24744178, 45514435]);

export function roadAccess(id, t, match = {}) {
  const highway = t.highway;
  const busway = highway === 'busway';
  const major = /^(motorway|trunk)(?:_link)?$/.test(highway) || t.motorroad === 'yes';
  const road = PUBLIC_ROAD.test(highway);
  let defaults = road ? MOTOR | (major ? 0 : BICYCLE | FOOT) : 0;
  if (highway === 'service') defaults = MOTOR | BICYCLE | FOOT;
  if (highway === 'track') defaults = BICYCLE | FOOT;
  if (/^(footway|pedestrian|steps|path|bridleway)$/.test(highway)) defaults = FOOT;
  if (highway === 'cycleway') defaults = BICYCLE | (SIDEWALK.test(t.sidewalk) ? FOOT : 0);
  const localBusOnly = id === 1231194487 || id === 1231194486;
  if (busway || localBusOnly) defaults = BUS;
  const motorDir = t.oneway === '-1' ? -1 : /^(yes|1|true)$/.test(t.oneway) ||
    (!t.oneway && (major && highway.startsWith('motorway') || t.junction === 'roundabout')) ? 1 : 0;
  const bikeDir = t['oneway:bicycle'] === 'no' || Object.keys(t).some(k => k.startsWith('cycleway') && t[k].startsWith('opposite'))
    ? 0 : t['oneway:bicycle'] === '-1' ? -1 : t['oneway:bicycle'] === 'yes' ? 1 : motorDir;
  const footDir = t['oneway:foot'] === '-1' ? -1 : t['oneway:foot'] === 'yes' ? 1 : 0;
  const busDir = t['oneway:bus'] === 'no' || t['oneway:psv'] === 'no' ? 0
    : t['oneway:bus'] === '-1' ? -1 : t['oneway:bus'] === 'yes' ? 1 : motorDir;
  const modes = [0, 0], limits = {};
  for (const [mode, keys, field] of KEYS) {
    const dir = mode === BICYCLE ? bikeDir : mode === FOOT ? footDir : mode === BUS ? busDir : motorDir;
    for (let d = 0; d < 2; d++) {
      if (dir && dir !== 1 - 2 * d) continue;
      const direction = d ? 'backward' : 'forward';
      const explicit = keys.flatMap((key) => [t[key + ':' + direction], t[key]]).find((v) => ALLOW.has(v) || DENY.has(v));
      const wkdDirection = match[d];
      const markedLanes = Number(t['lanes:' + direction]) > 0;
      const roadDirection = road && field !== 'vtgngr' && field !== 'fiets'
        && (markedLanes || wkdDirection?.auto === 'N' && wkdDirection?.autobs === 'N'
          && t.highway !== 'residential' && t.highway !== 'living_street');
      const enabled = explicit ? ALLOW.has(explicit) : (defaults & mode)
        && (busway || localBusOnly || mode === BUS && GTFS_LINE_3_ACCESS.has(id) || roadDirection || wkdDirection?.[field] !== 'N');
      if (enabled) modes[d] |= mode;
    }
  }
  for (const [tag, key] of Object.entries(LIMITS)) {
    const read = (v) => {
      const n = /^\s*([\d]+(?:[.,]\d+)?)\s*(m|t|km\/h|mph)?\s*$/.exec(v);
      return n ? Number(n[1].replace(',', '.')) * (n[2] === 'mph' ? 1.609344 : 1) : v === 'none' ? null : undefined;
    };
    const value = read(t[tag]);
    const bus = read(t[tag + ':bus'] ?? t[tag + ':psv']);
    if (value !== undefined && value !== null) limits[key] = value;
    if (bus !== undefined) (limits.bus ||= {})[key] = bus;
  }
  if (match.height != null && !(limits.height <= match.height)) limits.height = match.height;
  if (match.speed != null && limits.speed == null) limits.speed = match.speed;
  // Ede's traffic decision bars longer vehicles from the station forecourt and bus bays except scheduled buses.
  if (t.name === 'Polar Bearsplein' && highway === 'service') { limits.length ??= 10; (limits.bus ||= {}).length = null; }
  const laneModes = modes.map((mask, d) => {
    const direction = d ? 'backward' : 'forward';
    const get = (k) => t[k + ':lanes:' + direction] ?? (motorDir === 1 - 2 * d ? t[k + ':lanes'] : null);
    const access = get('access')?.split('|'), bus = (get('bus') ?? get('psv'))?.split('|');
    const motor = get('motor_vehicle')?.split('|'), car = get('motorcar')?.split('|'), van = get('goods')?.split('|');
    if (!access && !bus && !motor && !car && !van) return null;
    const values = [[CAR, car], [VAN, van ?? car], [BUS, bus]];
    return Array.from({ length: Math.max(access?.length || 0, motor?.length || 0, car?.length || 0, van?.length || 0, bus?.length || 0) }, (_, i) => {
      let allowed = 0;
      for (const [mode, tags] of values) {
        if (!(mask & mode)) continue;
        const value = tags?.[i] || motor?.[i] || access?.[i];
        if (!DENY.has(value)) allowed |= mode;
      }
      return allowed;
    });
  });
  return { modes, limits, laneModes, sidewalk: t.sidewalk ?? null,
    sidewalkSides: [t['sidewalk:left'] ?? t['sidewalk:both'], t['sidewalk:right'] ?? t['sidewalk:both']] };
}

export function readWkd(directory, project) {
  if (!directory) return () => ({});
  const read = (name) => {
    const data = JSON.parse(fs.readFileSync(path.join(directory, name + '.json'), 'utf8'));
    if (!Array.isArray(data.features) || data.numberMatched > data.features.length) throw new Error('Incomplete WKD ' + name);
    return data.features;
  };
  const cell = 32, index = new Map();
  const insert = (features, type) => {
    for (const { properties, geometry } of features) {
      for (const coords of geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates) {
        for (let i = 1; i < coords.length; i++) {
          const [x, z] = project(...coords[i - 1]), [bx, bz] = project(...coords[i]);
          const dx = bx - x, dz = bz - z, len = Math.hypot(dx, dz);
          if (len < 0.1) continue;
          const seg = { x, z, ux: dx / len, uz: dz / len, len, properties, type };
          for (let ix = Math.floor((Math.min(x, bx) - 4) / cell); ix <= Math.floor((Math.max(x, bx) + 4) / cell); ix++) {
            for (let iz = Math.floor((Math.min(z, bz) - 4) / cell); iz <= Math.floor((Math.max(z, bz) + 4) / cell); iz++) {
              const k = ix * 100000 + iz;
              if (!index.has(k)) index.set(k, []);
              index.get(k).push(seg);
            }
          }
        }
      }
    }
  };
  insert(read('verkeerstypen'), 'access');
  insert(read('hoogtebeperkingen'), 'height');
  return (points, tagged) => {
    const samples = [], heights = [];
    for (let k = 1; k < points.length; k++) {
      const [ax, az] = points[k - 1], [bx, bz] = points[k];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1) continue;
      const num = Math.ceil(len / 8);
      for (let i = 0; i < num; i++) {
        const x = ax + dx * (i + 0.5) / num, z = az + dz * (i + 0.5) / num;
        let closest = null, score = 3.25, other = 4.5;
        for (const s of index.get(Math.floor(x / cell) * 100000 + Math.floor(z / cell)) || []) {
          const dot = (dx * s.ux + dz * s.uz) / len;
          if (Math.abs(dot) < 0.86) continue;
          const t = (x - s.x) * s.ux + (z - s.z) * s.uz;
          if (t < -1 || t > s.len + 1) continue;
          const d = Math.hypot(x - s.x - s.ux * t, z - s.z - s.uz * t);
          if (s.type === 'height') {
            const h = Number(s.properties.bep_waarde);
            // C19 beside a through road may apply to a parallel car park entrance.
            if (s.properties.wvk_id !== 348301191 && d < (tagged ? 3 : 1.5) && h > 0) heights.push(h);
            continue;
          }
          const rank = d + (1 - Math.abs(dot)) * 4;
          if (rank < score) {
            if (closest && closest.s.properties.wvk_id !== s.properties.wvk_id) other = score;
            score = rank;
            closest = { s, dot };
          } else if (closest?.s.properties.wvk_id !== s.properties.wvk_id) other = Math.min(other, rank);
        }
        samples.push(closest && other - score >= 0.8 ? closest : null);
      }
    }
    const result = heights.length ? { height: Math.min(...heights) } : {};
    if (samples.length < 2 || samples.filter(Boolean).length < samples.length * 0.8) return result;
    for (let d = 0; d < 2; d++) {
      result[d] = {};
      for (const field of ['auto', 'autobs', 'fiets', 'vtgngr']) {
        const values = samples.filter(Boolean).map(({ s, dot }) => s.properties[field + '_' + ((dot > 0) !== !!d ? 'h' : 't')]);
        if (values.every((v) => v === values[0])) result[d][field] = values[0];
      }
    }
    return result;
  };
}
