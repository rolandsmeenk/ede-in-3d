// Ede map in local metres around Oude Kerk. © OpenStreetMap contributors (ODbL).
import { EDE_ROAD_TAGS } from './ede-road-tags.js';

const mapUrl = new URL('../assets/ede-map-v1.json.gz', import.meta.url);

async function loadMap() {
  let bytes;
  if (mapUrl.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    bytes = await readFile(mapUrl);
  } else {
    const response = await fetch(mapUrl);
    if (!response.ok) throw new Error(`Ede map returned HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  // Static hosts may send the packed file as-is or decode it using Content-Encoding.
  const body = new Response(bytes);
  const json = bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body;
  const data = await json.json();
  if (data?.meta?.city !== 'Ede' || !Array.isArray(data.roads) ||
      !Array.isArray(data.buildings) || !data.roadGraph || !data.activeGraph) {
    throw new Error('Invalid Ede map asset');
  }
  for (const road of data.roads) Object.assign(road, EDE_ROAD_TAGS[road.id]);
  return data;
}

export const EDE_DATA = await loadMap();
