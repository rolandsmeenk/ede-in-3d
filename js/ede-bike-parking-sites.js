import { EDE_SCHOOL_LANDMARKS } from './ede-school-survey.js';
import { EDE_SHOPS } from './ede-shops.js';
import { EDE_SPORT_LANDMARKS } from './ede-sport-landmark-survey.js';

// OpenStreetMap contributors, ODbL. Geofabrik Gelderland extract, 2026-11-20.
// Row endpoints and counts are fitted samples inside the mapped parking ways.
// Point records use a short row around the mapped location.
const outdoorSites = [
  // The south entrance leads from the cycleway through the paved gap between the parking bays.
  { id: 'dulon-college', name: 'Dulon College', kind: 'school', secondary: true, access: 'school', mappedAccess: 'unknown',
    handoff: { wayId: 'w6953700', reach: 29, via: { x: -658.2, z: 2867.8 } }, rows: [
    ['w1564389498', -680.7, 2758.8, -676, 2776.1, 12],
    ['w1564389497', -674.7, 2792.5, -668.1, 2826.7, 22],
    ['w1564389496', -662.8, 2842.5, -659.3, 2859.1, 11],
  ] },
  { id: 'het-streek-college', name: 'Het Streek College', kind: 'school', secondary: true, access: 'school', mappedAccess: 'unknown',
    handoff: { wayId: 'w260907432', reach: 16 }, rows: [
    ['n11559537555', -167.8, 3149.5, -165.0, 3149.5, 3],
  ] },
  // The school confirms courtyard bike parking. Fit a sample on the paved side of the canopy.
  // The north gate approach starts on the Koekeltse Boslaan cycleway and follows the BGT footpath.
  { id: 'pallas-athene', name: 'Pallas Athene College', kind: 'school', secondary: true, access: 'school', source: 'survey',
    evidence: 'https://www.pallasathenecollege.nl/dinsdag-6-januari/',
    handoff: { wayId: 'w25179265', reach: 65, maxHeightDifference: 1.25, via: { x: -2125, z: 958 } }, rows: [
    ['G0228.fe246f333ff0d6d6e0400a0a35020533', -2119, 1003.0, -2105.5, 1000.8, 11],
    ['G0228.fe246f333ff0d6d6e0400a0a35020533', -2117.5, 1007.0, -2102.0, 1004.4, 13],
  ] },
  { id: 'ede-wageningen-noordplein', name: 'Ede-Wageningen · Noordplein', kind: 'station', access: 'public', mappedAccess: 'public',
    reportedCapacity: 1600, standType: 'two_tier',
    evidence: 'https://www.spoorzone-ede.nl/nieuws/opening-westtunnel-en-fietsenstalling-station-ede-wageningen',
    rows: [
      ['w1308852211', 25, 1978.6, 57, 1988.0, 23],
      ['w1308852211', 19, 1985.1, 55, 1995.7, 25],
      ['w1308852211', 16, 1991.5, 53, 2002.4, 25],
    ] },
  { id: 'ede-centrum', name: 'Station Ede Centrum', kind: 'station', access: 'public', mappedAccess: 'unknown', rows: [
    ['w1067217195', -258.8, 359.3, -265.3, 370.1, 9],
    ['w1067217196', -249.6, 342.7, -252.4, 346.7, 4],
  ] },
  { id: 'kuiperplein', name: 'Kuiperplein', kind: 'shops', access: 'public', mappedAccess: 'unknown', rows: [
    ['w1337350650', -240.7, 47.3, -261.7, 60.2, 18],
  ] },
  { id: 'parkweide', name: 'Winkelcentrum Parkweide', kind: 'shops', access: 'public', mappedAccess: 'unknown', reportedCapacity: 30, rows: [
    ['n3796934853', -1905.8, -557.4, -1904.4, -554.0, 4],
  ] },
  { id: 'sportpark-hoekelumse-eng', name: 'Sportpark Hoekelumse Eng', kind: 'sport', access: 'public', mappedAccess: 'unknown', rows: [
    ['n2523018299', -165.5, 3557.52, -165.5, 3558.82, 2],
  ] },
];

// NS south (w1156797030) has a building and a mapped layer of 1. The surface inventory
// cannot represent its interior levels or access, so neither its racks nor its capacity are sampled.
const contexts = [
  ...EDE_SCHOOL_LANDMARKS.map(site => ({ ...site, kind: 'school', reach: 70,
    secondary: site.id !== 'de-ontdekking' })),
  ...EDE_SPORT_LANDMARKS.map(site => ({ ...site, kind: 'sport', reach: 60 })),
  ...EDE_SHOPS.map(([name, x, z, type]) => ({ name, x, z, kind: 'shops', reach: type === 'shop' ? 40 : 22 })),
];

function contextAt(x, z) {
  let closest, distance = 1;
  for (const site of contexts) {
    const anchor = site.approach ?? site;
    const relativeDistance = Math.min(Math.hypot(site.x - x, site.z - z),
      Math.hypot(anchor.x - x, anchor.z - z)) / site.reach;
    if (relativeDistance >= distance) continue;
    closest = site;
    distance = relativeDistance;
  }
  return closest;
}

const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const pitch = 0.32;

function surfaceRack(feature) {
  return feature?.source === 'bgt' && feature.type === 'bikeRack' && feature.level === 0 &&
    typeof feature.id === 'string' && Array.isArray(feature.position) && feature.position.length === 2 && feature.position.every(Number.isFinite);
}

function overlapsBike(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (dx * dx + dz * dz >= 4) return false;
  const p = Math.abs(Math.cos(a.yaw - b.yaw)), q = Math.abs(Math.sin(a.yaw - b.yaw));
  return [a, b].every(({ yaw }) => {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    return Math.abs(dx * cos - dz * sin) < 0.26 * (1 + p) + 0.91 * q &&
      Math.abs(dx * sin + dz * cos) < 0.91 * (1 + p) + 0.26 * q;
  });
}

export function buildEdeBikeParkingSites(features = [], { placementAt, canPlace } = {}) {
  const racks = [...new Map(features.filter(surfaceRack).map(feature => [feature.id, feature])).values()].sort(byId);
  const allSlots = [];

  function place(feature, stand) {
    const [x, z] = feature.position, yaw = Number.isFinite(feature.angle) ? feature.angle : 0;
    const ground = placementAt?.(feature, x, z);
    if (placementAt && !Number.isFinite(ground)) return null;
    for (const side of [1, -1]) {
      const dx = side * pitch * Math.cos(yaw), dz = -side * pitch * Math.sin(yaw);
      const y = placementAt?.(feature, x + dx, z + dz);
      if (placementAt && (!Number.isFinite(y) || Math.abs(y - ground) > 0.24)) continue;
      const slot = { id: feature.id, rackId: feature.id, sourceId: feature.sourceId ?? feature.id,
        level: feature.level, x: x + dx, y, z: z + dz, yaw };
      if (stand) slot.stand = { x, y: ground, z, yaw, type: stand };
      if (canPlace?.(feature, slot) === false || allSlots.some(other =>
        (y === undefined || other.y === undefined || Math.abs(other.y - y) < 1.6) && overlapsBike(slot, other))) continue;
      allSlots.push(slot);
      return slot;
    }
    return null;
  }

  function finish(site, slots) {
    return { ...site, level: 0, capacity: slots.length, slots,
      x: slots.reduce((sum, slot) => sum + slot.x, 0) / slots.length,
      z: slots.reduce((sum, slot) => sum + slot.z, 0) / slots.length };
  }

  const sites = [];
  const remaining = new Set(racks);
  for (const first of racks) {
    if (!remaining.delete(first)) continue;
    const nearby = [first];
    for (const rack of nearby) {
      const [x, z] = rack.position;
      for (const next of remaining) {
        if (Math.hypot(next.position[0] - x, next.position[1] - z) > 28) continue;
        nearby.push(next);
        remaining.delete(next);
      }
    }

    const slots = nearby.map(feature => place(feature)).filter(Boolean);
    if (!slots.length) continue;
    const site = finish({ id: first.id, source: 'bgt', sourceIds: nearby.map(feature => feature.id),
      access: 'unknown', mappedAccess: 'unknown' }, slots);
    const context = contextAt(site.x, site.z);
    site.kind = context?.kind ?? 'public';
    if (context) site.name = context.name;
    if (context?.kind === 'school') {
      site.secondary = context.secondary;
      site.access = 'school';
    }
    sites.push(site);
  }

  for (const { rows, source = 'osm', standType = 'stands', ...site } of outdoorSites) {
    const slots = [];
    for (const [index, [sourceId, x, z, endX, endZ, count]] of rows.entries()) {
      const dx = endX - x, dz = endZ - z, angle = Math.atan2(-dz, dx);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const feature = { source, type: 'bikeRack', id: `${sourceId}/${index}/${i}`, sourceId,
          level: 0, angle, position: [x + dx * t, z + dz * t] };
        const slot = place(feature, standType);
        if (slot) slots.push(slot);
      }
    }
    if (slots.length) sites.push(finish({ ...site, source,
      sourceIds: [...new Set(rows.map(([sourceId]) => sourceId))] }, slots));
  }
  return sites;
}
