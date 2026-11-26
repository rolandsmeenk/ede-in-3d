// Ede map in local metres around Oude Kerk. © OpenStreetMap contributors (ODbL).
import { edeCoverage } from './ede-coverage.js';
import { EDE_ROAD_TAGS } from './ede-road-tags.js';
import { EDE_FUEL_FALLBACK_FOOTPRINTS } from './ede-fuel-sites.js';
import { FRANKENENG_DOWNSTREAM } from './ede-water-levels.js';

const mapUrl = new URL('../assets/ede-map-v1.json.gz', import.meta.url);
const shorelineUrl = new URL('../assets/ede-shorelines.json.gz', import.meta.url);
const yearsUrl = new URL('../assets/ede-building-years.json.gz', import.meta.url);
const northUrl = new URL('../assets/ede-north-v1.json.gz?v=20261122-municipal', import.meta.url);
const corridorsUrl = new URL('../assets/ede-corridors-v1.json.gz', import.meta.url);
const windowUsesUrl = new URL('../assets/ede-window-uses.json.gz', import.meta.url);
const municipalityUrl = new URL('../assets/ede-municipality-v1.json.gz?v=20261122-municipal', import.meta.url);
const completionUrl = new URL('../assets/ede-complete-v1.json.gz', import.meta.url);
const mapLayers = ['buildings', 'roads', 'railways', 'water', 'parks', 'squares', 'trees', 'signals'];
const mapGraphs = ['roadGraph', 'activeGraph'];
export let EDE_AERIAL_INPUTS;
export function clearAerialInputs() {
  EDE_AERIAL_INPUTS = null;
}

export async function readMapAsset(url, optional = false) {
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
  const grass = data.parks.find(({ id }) => id === 'w853986890');
  if (grass && shoreline.water.some(({ id }) => id === 'water91')) {
    data.water = [...shoreline.water, FRANKENENG_DOWNSTREAM];
    grass.holes = [...(grass.holes ?? []), FRANKENENG_DOWNSTREAM.ring];
  }
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
  const { meta } = data;
  const extensions = new Map((corridors.railExtensions ?? []).map(row => [row.id, row]));
  if (corridors.north && (!(corridors.bounds?.[1] < meta.bounds[1]) ||
      [0, 2, 3].some(i => corridors.bounds[i] !== meta.bounds[i]) ||
      !arrays.every(key => Array.isArray(corridors[key])) ||
      !['arrivals', 'routes', 'zones'].every(key => Array.isArray(corridors.detail?.[key])) ||
      !['roadGraph', 'activeGraph'].every(key =>
        ['nodes', 'links', 'names'].every(field => Array.isArray(corridors[key]?.[field]))) ||
      [...extensions.keys()].some(id => !data.railways.some(row => row.id === id)))) {
    throw new Error('Invalid northern map extension');
  }
  if (extensions.size) data.railways = data.railways.map(way => extensions.get(way.id) ?? way);
  if (corridors.north) {
    data.northStreetDetail = corridors.streetDetail ?? [];
    data.northTrees = corridors.trees;
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
    baseBounds: meta.baseBounds ?? meta.bounds,
    baseBuildingCount: meta.baseBuildingCount ?? original.buildings,
    baseRoadCount: meta.baseRoadCount ?? original.roads,
    baseRoadNodeCount: meta.baseRoadNodeCount ?? original.roadNodes / 2,
    baseParkCount: meta.baseParkCount ?? baseParkCount,
    bounds: corridors.bounds,
    geographicBounds: corridors.geographicBounds,
    corridorDetail: corridors.north ? {
      arrivals: [...meta.corridorDetail.arrivals, ...corridors.detail.arrivals],
      routes: [...meta.corridorDetail.routes, ...corridors.detail.routes],
      zones: corridors.detail.zones,
    } : corridors.detail,
    ...(corridors.north && { north: true, northStart: original.bounds[1] }),
  });
}

function municipalBase(data) {
  return {
    bounds: data.meta.bounds,
    counts: mapLayers.map(key => data[key].length),
    graphs: mapGraphs.map(key => [data[key].nodes.length, data[key].links.length]),
  };
}

function applyCompletion(data, completion) {
  if (completion.version !== 1 || JSON.stringify(municipalBase(data)) !== JSON.stringify(completion.base)) {
    throw new Error('Ede completion bake does not match the existing map assets');
  }
  for (const key of mapLayers) {
    const { add, replace } = completion.layers[key];
    for (const [index, replacement] of replace) data[key][index] = replacement;
    data[key] = data[key].concat(add);
  }
  for (const key of mapGraphs) data[key] = completion.graphs[key];
  Object.assign(data.meta, { bounds: completion.bounds, geographicBounds: completion.geographicBounds,
    areas: completion.areas, fullMunicipality: true, osmCompletion: completion.source });
  if (completion.travelBounds && edeCoverage) {
    data.meta.travelBounds = completion.travelBounds;
    data.meta.travelBoundary = edeCoverage.buildingBoundary;
  }
}

function applyMunicipalCoverage(data, patch) {
  const prefix = municipalBase(data);
  if (patch.version !== 1 || JSON.stringify(prefix) !== JSON.stringify(patch.base)) {
    throw new Error('Ede municipal bake does not match the expanded map');
  }
  const roadIndices = [];
  for (const key of mapLayers) {
    const changes = new Map(patch.layers[key].changes);
    const rows = [];
    data[key].forEach((row, index) => {
      if (key === 'roads') roadIndices.push(rows.length);
      rows.push(...(changes.get(key === 'water' ? row.id : index) ?? [row]));
    });
    data[key] = rows;
    data.meta.counts[key] = rows.length;
  }
  for (const key of mapGraphs) {
    const graph = data[key], layer = patch.graphs[key];
    const coords = graph.nodes.concat(layer.addNodes), drop = new Set(layer.dropNodes);
    const nodes = [], indices = [], controls = {};
    for (let i = 0; i < coords.length / 2; i++) {
      if (drop.has(i)) continue;
      const index = nodes.length / 2;
      indices[i] = index;
      if (graph.controls?.[i]) controls[index] = graph.controls[i];
      nodes.push(coords[i * 2], coords[i * 2 + 1]);
    }
    const changes = new Map(layer.changes);
    graph.links = graph.links.flatMap((link, index) => {
      const rows = changes.get(index);
      return (rows ?? [link]).map(([a, b, name, width, lanes, dir, inner, road, ...flags]) =>
        [indices[a], indices[b], name, width, lanes, dir, inner, rows ? road : roadIndices[road], ...flags]);
    });
    graph.nodes = nodes;
    if (graph.controls) graph.controls = controls;
  }
  Object.assign(data.meta, patch.prefix, { municipality: patch.source, playableBoundary: patch.boundary });
}

async function loadMap() {
  const appleMobile = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const compactMap = appleMobile && new URLSearchParams(globalThis.location?.search ?? '').get('quality') !== 'standard';
  // Load and apply map patches sequentially so peak decompression/parse memory stays bounded on mobile.
  const data = await readMapAsset(mapUrl);
  if (data?.meta?.city !== 'Ede' || !Array.isArray(data.roads) ||
      !Array.isArray(data.buildings) || !data.roadGraph || !data.activeGraph) {
    throw new Error('Invalid Ede map asset');
  }
  const shoreline = await readMapAsset(shorelineUrl, true).catch(error => {
    console.warn('[Ede shorelines] using OSM geometry:', error);
    return null;
  });
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
  const years = await readMapAsset(yearsUrl, true).catch(error => {
    console.warn('[Ede BAG years] using the default façade palette:', error);
    return null;
  });
  if (years) applyBuildingYears(data.buildings, years);
  // The RGB palette is keyed to the original OSM IDs and original segment counts.
  EDE_AERIAL_INPUTS = { buildings: data.buildings, roads: data.roads };
  for (const { id, ring, holes } of EDE_FUEL_FALLBACK_FOOTPRINTS) {
    const building = data.buildings.find(row => row.id === id);
    if (building) Object.assign(building, { ring, holes });
  }
  for (const road of data.roads) Object.assign(road, EDE_ROAD_TAGS[road.id]);
  if (!compactMap) {
    const corridors = await readMapAsset(corridorsUrl, true).catch(error => {
      console.warn('[Ede corridors] using the city extent:', error);
      return null;
    });
    if (corridors) applyCorridors(data, corridors);
    const north = corridors ? await readMapAsset(northUrl, true).catch(error => {
      console.warn('[Ede north] using the existing extent:', error);
      return null;
    }) : null;
    if (north?.north === true) {
      try {
        applyCorridors(data, north);
      } catch (error) {
        console.warn('[Ede north] using the existing extent:', error);
      }
    }
    const completion = await readMapAsset(completionUrl, true);
    if (completion) {
      applyCompletion(data, completion);
      applyMunicipalCoverage(data, completion.municipality);
    } else if (data.meta.north) {
      const municipality = await readMapAsset(municipalityUrl, true);
      if (municipality) applyMunicipalCoverage(data, municipality);
    }
  }
  const windowUses = await readMapAsset(windowUsesUrl, true).catch(error => {
    console.warn('[Ede building uses] using OSM tags:', error);
    return null;
  });
  if (windowUses?.version === 1) {
    const uses = new Map();
    for (const use of ['unlit', 'home', 'office', 'shop', 'mixed']) {
      const ids = windowUses.uses?.[use];
      if (Array.isArray(ids)) for (const id of ids) uses.set(id, use);
    }
    for (const building of data.buildings) {
      const use = uses.get(building.id);
      if (use) building.bagUse = use;
    }
  }
  return data;
}

export const EDE_DATA = await loadMap();
