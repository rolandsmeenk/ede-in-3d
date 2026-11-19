// Ede map in local metres around Oude Kerk. © OpenStreetMap contributors (ODbL).
import { EDE_ROAD_TAGS } from './ede-road-tags.js';

const mapUrl = new URL('../assets/ede-map-v1.json.gz', import.meta.url);
const shorelineUrl = new URL('../assets/ede-shorelines.json.gz', import.meta.url);

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

async function loadMap() {
  const [data, shoreline] = await Promise.all([
    readMapAsset(mapUrl),
    readMapAsset(shorelineUrl, true).catch(error => {
      console.warn('[Ede shorelines] using OSM geometry:', error);
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
  for (const road of data.roads) Object.assign(road, EDE_ROAD_TAGS[road.id]);
  return data;
}

export const EDE_DATA = await loadMap();
