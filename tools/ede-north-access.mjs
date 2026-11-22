// Route the signed reserves using the mapped limits from OSM.
const WEKEROMSE_ZAND = 10385589;
const EAST_OF_HOGE_VALKSEDIJK = 753667279;
const DE_VALOUWE = 10373126;
// Temporary fence cross-checked against the municipal closure map and 2026 PDOK imagery.
// https://www.ede.nl/in-de-gemeente-ede/zandafgraving-goudsberg
export const GOUDSBERG_FENCE = 1530443258;
const TRAIL = /^(path|track|footway|bridleway)$/;
const CYCLE_ALLOW = /^(yes|designated|permissive|official)$/;
const ALL_ACCESS = ['access', 'vehicle', 'motor_vehicle', 'motorcar', 'goods', 'bus', 'psv', 'bicycle', 'foot'];

function closedRing(points) {
  return points?.length > 3
    && points[0].lon === points.at(-1).lon && points[0].lat === points.at(-1).lat;
}

function contains(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > point.lat) !== (b.lat > point.lat)
      && point.lon < a.lon + (b.lon - a.lon) * (point.lat - a.lat) / (b.lat - a.lat))
      inside = !inside;
  }
  return inside;
}

function area(outer, holes = []) {
  return {
    minLon: Math.min(...outer.map(p => p.lon)),
    maxLon: Math.max(...outer.map(p => p.lon)),
    minLat: Math.min(...outer.map(p => p.lat)),
    maxLat: Math.max(...outer.map(p => p.lat)),
    contains: p => contains(outer, p) && !holes.some(ring => contains(ring, p)),
  };
}

function reserve(relation, outerId) {
  const members = (relation?.members ?? []).filter(m => closedRing(m.geometry));
  const holes = members.filter(m => m.role === 'inner').map(m => m.geometry);
  return members.filter(m => m.role === 'outer' && (!outerId || outerId === m.ref))
    .map(m => area(m.geometry, holes.filter(ring => contains(m.geometry, ring[0]))));
}

// Estimate the share of the way inside the signed polygon. Sampling along the
// segment avoids classifying a perimeter path from a single boundary vertex.
function insideLengthShare(points, areas) {
  if (!areas.length || points.length < 2) return 0;
  const lons = points.map(p => p.lon), lats = points.map(p => p.lat);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const candidates = areas.filter(a => a.minLon <= maxLon && a.maxLon >= minLon
    && a.minLat <= maxLat && a.maxLat >= minLat);
  if (!candidates.length) return 0;
  let total = 0, inside = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    // Metres per degree at Ede, for sampling spacing and length weights only.
    const length = Math.hypot((b.lon - a.lon) * 68_400, (b.lat - a.lat) * 111_260);
    const steps = Math.ceil(length / 12);
    total += length;
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps;
      const p = { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
      if (candidates.some(region => region.contains(p))) inside += length / steps;
    }
  }
  return total ? inside / total : 0;
}

function denied(tags, keys) {
  const result = { ...tags };
  for (const key of keys) {
    result[key] = 'no';
    for (const suffix of [':forward', ':backward']) {
      if (Object.hasOwn(result, key + suffix)) result[key + suffix] = 'no';
    }
  }
  return result;
}

export function createNorthAccess(osm) {
  // GLK advises cycling around the fenced eastern reserve. The western
  // woodland allows cycling on its trails, per the mapped access signage.
  // https://www.glk.nl/gebied/wekeromse-zand
  const wekerom = reserve(osm.elements.find(e => e.type === 'relation' && e.id === WEKEROMSE_ZAND),
    EAST_OF_HOGE_VALKSEDIJK);
  const valouwe = reserve(osm.elements.find(e => e.type === 'relation' && e.id === DE_VALOUWE));
  const fence = osm.elements.find(e => e.type === 'way' && e.id === GOUDSBERG_FENCE);
  const quarry = closedRing(fence?.geometry) ? [area(fence.geometry)] : [];

  return way => {
    const tags = way.tags ?? {};
    const points = way.geometry ?? [];
    if (!tags.highway || !points.length) return tags;
    if (insideLengthShare(points, quarry) > 0) return denied(tags, ALL_ACCESS);
    // The adjacent segments carry access=no from the same 2026 field survey.
    if (way.id === 912165168 && tags.note === 'pad afgesloten doorbomen en takken')
      return denied(tags, ALL_ACCESS);
    if (!TRAIL.test(tags.highway)) return tags;

    // De Valouwe's mapped sign permits walkers. Keep existing way-level
    // pedestrian and private-access tags and specific permitted cycle links.
    const valouweCycleException = ['bicycle', 'bicycle:forward', 'bicycle:backward']
      .some(key => CYCLE_ALLOW.test(tags[key]));
    const bicycleDenied = tags.bicycle === 'no' && !valouweCycleException;
    if (!bicycleDenied && (insideLengthShare(points, wekerom) > 0.5
      || !valouweCycleException && insideLengthShare(points, valouwe) > 0.5))
      return denied(tags, ['bicycle']);
    return tags;
  };
}
