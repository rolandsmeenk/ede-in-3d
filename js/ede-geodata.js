// Ede map in local metres around Oude Kerk. © OpenStreetMap contributors (ODbL).
import { EDE_ROAD_TAGS } from './ede-road-tags.js';
import { EDE_FUEL_FALLBACK_FOOTPRINTS } from './ede-fuel-sites.js';

const mapUrl = new URL('../assets/ede-map-v1.json.gz', import.meta.url);
const shorelineUrl = new URL('../assets/ede-shorelines.json.gz', import.meta.url);
const yearsUrl = new URL('../assets/ede-building-years.json.gz', import.meta.url);
const corridorsUrl = new URL('../assets/ede-corridors-v1.json.gz', import.meta.url);

async function readMapAsset(url, optional = false) {
  let bytes;
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    try {
      bytes = await readFile(url);
    } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
  } else {
    const response = await fetch(url);
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`Ede asset ${url.pathname} returned HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  // Static hosts may send the packed file as-is or decode it using Content-Encoding.
  const body = new Response(bytes);
  const json = bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body;
  return json.json();
}

function applyShorelines(data, shoreline) {
  const groups = ['parks', 'squares'];
  const sameList = (a, b) => a?.length === b.length && a.every((value, i) => value === b[i]);
  if (shoreline.version !== 1 || !Array.isArray(shoreline.water)
      || !sameList(shoreline.base?.bounds, data.meta.bounds)
      || !sameList(shoreline.base?.counts, [data.water.length, ...groups.map(group => data[group].length)])) {
    throw new Error('Ede shoreline asset does not match the OSM map');
  }
  for (const group of groups) {
    if (!Array.isArray(shoreline.land?.[group]) ||
        shoreline.land[group].some(([index, id, fragments]) =>
          data[group][index]?.id !== id || !Array.isArray(fragments))) {
      throw new Error('Ede shoreline asset does not match the OSM land IDs');
    }
  }
  const replace = (group) => {
    const patches = new Map(shoreline.land[group].map(([index, , fragments]) => [index, fragments]));
    return data[group].flatMap((row, index) => patches.has(index)
      ? patches.get(index).map(fragment => ({ ...row, ...fragment })) : [row]);
  };
  data.parks = replace('parks');
  data.squares = replace('squares');
  data.water = shoreline.water;
  for (const group of ['water', ...groups]) data.meta.counts[group] = data[group].length;
}

function applyBuildingYears(buildings, table) {
  let orderedIds = 2166136261;
  for (const { id } of buildings) {
    for (let i = 0; i < id.length; i++) orderedIds = Math.imul(orderedIds ^ id.charCodeAt(i), 16777619);
    orderedIds = Math.imul(orderedIds ^ 10, 16777619);
  }
  if (table.version !== 1 || table.orderedIds !== (orderedIds >>> 0)
    || !Array.isArray(table.years) || table.years.length !== buildings.length) {
    console.warn('[Ede BAG years] building-year asset does not match the OSM map');
    return;
  }
  for (const [i, year] of table.years.entries()) {
    if (Number.isInteger(year) && year >= 1000 && year < 2100) buildings[i].buildYear = year;
  }
}

function applyCorridors(data, corridors) {
  const arrays = ['buildings', 'roads', 'railways', 'water', 'parks', 'squares', 'trees', 'signals'];
  const original = corridors.base;
  if (corridors.version !== 1 || original?.buildings !== data.buildings.length
      || original?.roads !== data.roads.length || original?.roadNodes !== data.roadGraph.nodes.length
      || original?.activeNodes !== data.activeGraph.nodes.length
      || !data.meta.bounds.every((bound, index) => bound === original.bounds?.[index])) {
    throw new Error('Ede corridor asset does not match the OSM map');
  }
  const baseParkCount = data.parks.length;
  for (const key of arrays) {
    data[key] = data[key].concat(corridors[key]);
    data.meta.counts[key] = data[key].length;
  }
  for (const key of ['roadGraph', 'activeGraph']) {
    for (const field of ['nodes', 'links', 'names']) data[key][field] = data[key][field].concat(corridors[key][field]);
    if (corridors[key].controls) Object.assign(data[key].controls, corridors[key].controls);
  }
  Object.assign(data.meta, {
    baseBounds: data.meta.bounds,
    baseBuildingCount: original.buildings,
    baseRoadCount: original.roads,
    baseRoadNodeCount: original.roadNodes / 2,
    baseParkCount,
    bounds: corridors.bounds,
    geographicBounds: corridors.geographicBounds,
    corridorDetail: corridors.detail,
  });
}

async function loadMap() {
  const [data, shoreline, years, corridors] = await Promise.all([
    readMapAsset(mapUrl),
    readMapAsset(shorelineUrl, true).catch(error => {
      console.warn('[Ede shorelines] using OSM geometry:', error);
      return null;
    }),
    readMapAsset(yearsUrl, true).catch(error => {
      console.warn('[Ede BAG years] using the default façade palette:', error);
      return null;
    }),
    readMapAsset(corridorsUrl, true).catch(error => {
      console.warn('[Ede corridors] using the city extent:', error);
      return null;
    }),
  ]);
  if (data?.meta?.city !== 'Ede' || !Array.isArray(data.roads) ||
      !Array.isArray(data.buildings) || !data.roadGraph || !data.activeGraph) {
    throw new Error('Invalid Ede map asset');
  }
  if (shoreline) {
    try {
      applyShorelines(data, shoreline);
    } catch (error) {
      console.warn('[Ede shorelines] using OSM geometry:', error);
    }
  }
  // PDOK aerial imagery shows that the former pond at RWZI Ede was filled.
  data.water = data.water.filter(({ id, ring }) => id !== 'water171'
    || ring[0] < -3500 || ring[0] > -3410 || ring[1] < 740 || ring[1] > 836);
  data.meta.counts.water = data.water.length;
  if (years) applyBuildingYears(data.buildings, years);
  for (const { id, ring, holes } of EDE_FUEL_FALLBACK_FOOTPRINTS) {
    const building = data.buildings.find(row => row.id === id);
    if (building) Object.assign(building, { ring, holes });
  }
  for (const road of data.roads) Object.assign(road, EDE_ROAD_TAGS[road.id]);
  if (corridors) applyCorridors(data, corridors);
  return data;
}

export const EDE_DATA = await loadMap();
