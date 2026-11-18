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

export function roadAccess(id, t, match = {}, evidence) {
  const highway = t.highway;
  const busway = highway === 'busway';
  const major = /^(motorway|trunk)(?:_link)?$/.test(highway) || t.motorroad === 'yes';
  const road = PUBLIC_ROAD.test(highway);
  let defaults = road ? MOTOR | (major ? 0 : BICYCLE | FOOT) : 0;
  if (highway === 'service') defaults = MOTOR | BICYCLE | FOOT;
  if (highway === 'track') defaults = BICYCLE | FOOT;
  if (/^(footway|pedestrian|steps|path|bridleway)$/.test(highway)) defaults = FOOT;
  if (highway === 'cycleway') defaults = BICYCLE | (SIDEWALK.test(t.sidewalk) ||
    ['left', 'right', 'both'].some(side => t['sidewalk:' + side] === 'yes') ? FOOT : 0);
  const confirmedCyclePath = /^(path|footway|track|bridleway)$/.test(highway) && evidence?.kind === 'cycle';
  const localBusOnly = id === 1231194487 || id === 1231194486;
  if (busway || localBusOnly) defaults = BUS;
  const motorDir = t.oneway === '-1' ? -1 : /^(yes|1|true)$/.test(t.oneway) ||
    (!t.oneway && (major && highway.startsWith('motorway') || t.junction === 'roundabout')) ? 1 : 0;
  const bikeDir = t['oneway:bicycle'] === 'no' ? 0 : t['oneway:bicycle'] === '-1' ? -1 : t['oneway:bicycle'] === 'yes' ? 1
    : Object.keys(t).some(k => k.startsWith('cycleway') && (t[k].startsWith('opposite') ||
      k.endsWith(':oneway') && (t[k] === 'no' || t[k] === '-1' && motorDir === 1 || t[k] === 'yes' && motorDir === -1))) ? 0 : motorDir;
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
      const enabled = explicit ? ALLOW.has(explicit) : ((defaults & mode) || mode === BICYCLE && confirmedCyclePath && wkdDirection?.fiets === 'J')
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

// Offsets are measured to the right of the OSM way, independent of direction of travel.
export function cycleFacilities(tags, modes, roadWidth, evidence, match = {}) {
  const allowed = modes.map(mode => !!(mode & BICYCLE));
  if (!allowed.some(Boolean)) return [];
  const highway = tags.highway;
  const width = Number(tags.width) || evidence?.width || 2.5;
  if (highway === 'cycleway' || /^(path|footway|track|bridleway)$/.test(highway) &&
      (tags.bicycle === 'designated' || /^NL:G1[123]/.test(tags.traffic_sign || '') ||
        evidence?.kind === 'cycle' && (ALLOW.has(tags.bicycle) || [0, 1].some(d => match[d]?.fiets === 'J'))) ||
      tags.cycleway === 'crossing' && ALLOW.has(tags.bicycle)) {
    return [{ offset: 0, width, allowed, kind: 'path' }];
  }

  const lanes = [];
  const motorDir = tags.oneway === '-1' ? -1 : /^(yes|1|true)$/.test(tags.oneway) ? 1 : 0;
  for (const [side, sign] of [['left', -1], ['right', 1]]) {
    const value = tags['cycleway:' + side] ?? tags['cycleway:both'] ?? tags.cycleway;
    if (value !== 'lane' && value !== 'track') continue;
    if (!tags['cycleway:' + side] && !tags['cycleway:both'] && motorDir && sign !== motorDir) continue;
    const detail = key => tags['cycleway:' + side + ':' + key] ?? tags['cycleway:both:' + key] ?? tags['cycleway:' + key];
    if (DENY.has(detail('bicycle')) || DENY.has(detail('access'))) continue;
    if (value === 'lane' && detail('lane') && detail('lane') !== 'exclusive') continue;
    const direction = detail('oneway');
    const dir = direction === 'no' ? 0 : direction === '-1' ? -1 : /^(yes|true|1)$/.test(direction) ? 1 : motorDir || sign;
    const atGrade = (!tags.bridge || tags.bridge === 'no') && (!tags.tunnel || tags.tunnel === 'no')
      && tags.covered !== 'yes' && !Number(tags.layer);
    const unspecified = atGrade && value === 'lane' && !direction && !tags.oneway && !tags['oneway:bicycle']
      && !tags['cycleway:left'] && !tags['cycleway:right'] && !tags['cycleway:both'];
    const strip = unspecified && !match.cycleStripStale && match.cycleStrip?.some((present, d) => present && allowed[d])
      ? match.cycleStrip : null;
    const laneAllowed = allowed.map((yes, d) => yes && (!dir || dir === 1 - 2 * d) && (!strip || strip[d]));
    if (!laneAllowed.some(Boolean)) continue;
    const laneWidth = Number(detail('width')) || (value === 'track' ? 2.5 : 1.7);
    const offset = sign * (roadWidth / 2 + (value === 'track' ? 0.5 + laneWidth / 2 : -laneWidth / 2));
    lanes.push({ offset, width: laneWidth, allowed: laneAllowed, kind: value });
  }
  return lanes;
}

export function readWkd(directory, project, cycleStripFile, asOf = new Date()) {
  if (!directory && !cycleStripFile) return () => ({});
  const read = (source) => {
    const data = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (!Array.isArray(data.features) || data.numberMatched > data.features.length) throw new Error('Incomplete WKD ' + source);
    return data;
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
  if (directory) {
    insert(read(path.join(directory, 'verkeerstypen.json')).features, 'access');
    insert(read(path.join(directory, 'hoogtebeperkingen.json')).features, 'height');
  }
  const stripSource = cycleStripFile && fs.existsSync(cycleStripFile) ? read(cycleStripFile) : null;
  const age = +asOf - Date.parse(stripSource?.release);
  const stripsStale = !(age >= 0 && age <= 366 * 86400000);
  if (stripSource) insert(stripSource.features, 'strip');
  return (points, tagged) => {
    const samples = [], heights = [], stripSamples = [];
    for (let k = 1; k < points.length; k++) {
      const [ax, az] = points[k - 1], [bx, bz] = points[k];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1) continue;
      const num = Math.ceil(len / 8);
      for (let i = 0; i < num; i++) {
        const x = ax + dx * (i + 0.5) / num, z = az + dz * (i + 0.5) / num;
        let closest = null, score = 3.25, other = 4.5;
        let strip = null, stripScore = 2.25, stripOther = 3.5;
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
          if (s.type === 'strip') {
            if (rank < stripScore) {
              if (strip && strip.s.properties.wvk_id !== s.properties.wvk_id) stripOther = Math.min(stripOther, stripScore);
              stripScore = rank;
              strip = { s, dot };
            } else if (strip?.s.properties.wvk_id !== s.properties.wvk_id) stripOther = Math.min(stripOther, rank);
            continue;
          }
          if (rank < score) {
            if (closest && closest.s.properties.wvk_id !== s.properties.wvk_id) other = score;
            score = rank;
            closest = { s, dot };
          } else if (closest?.s.properties.wvk_id !== s.properties.wvk_id) other = Math.min(other, rank);
        }
        samples.push(closest && other - score >= 0.8 ? closest : null);
        if (strip && stripOther - stripScore >= 0.8 && (!samples.at(-1) || closest.s.properties.wvk_id === strip.s.properties.wvk_id)) {
          const { fts_sug_h: forward, fts_sug_t: reverse } = strip.s.properties;
          if (['0', '1'].includes(forward) && ['0', '1'].includes(reverse)) {
            stripSamples.push(strip.dot > 0 ? forward + reverse : reverse + forward);
          }
        }
      }
    }
    const result = heights.length ? { height: Math.min(...heights) } : {};
    if (stripSamples.length >= 2 && stripSamples.length >= samples.length * 0.8 && stripSamples.every(value => value === stripSamples[0])) {
      result.cycleStrip = [...stripSamples[0]].map(flag => flag === '1');
      result.cycleStripStale = stripsStale;
    }
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
