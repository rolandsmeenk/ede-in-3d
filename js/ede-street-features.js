import { roadEdgeKey } from './road-network.js';

export function streetRoadKey(edge) {
  return `${roadEdgeKey(edge)}|${edge.wayId}|${edge.layer ?? 0}`;
}

export function streetPathKey(track, direction, mode) {
  const a = { x: track.ax, z: track.az };
  const b = { x: a.x + track.ux * track.len, z: a.z + track.uz * track.len };
  return `path:${mode}:${streetRoadKey({
    from: direction > 0 ? a : b, to: direction > 0 ? b : a, wayId: track.wayId, layer: track.layer
  })}`;
}

export function indexStreetFeatures(asset) {
  if (asset.version !== 1 || ![asset.signs, asset.bumps, asset.crossings].every(Array.isArray)) {
    throw new Error('Invalid Ede street features');
  }
  const byEdge = new Map(), byId = new Map();
  for (const [type, features] of [['sign', asset.signs], ['bump', asset.bumps], ['crossing', asset.crossings]]) {
    for (const feature of features) {
      if (byId.has(feature.id)) throw new Error(`Duplicate street feature ${feature.id}`);
      byId.set(feature.id, feature);
      for (const edge of feature.edges) {
        if (!byEdge.has(edge.key)) byEdge.set(edge.key, []);
        byEdge.get(edge.key).push({ ...edge, type, feature });
      }
    }
  }
  for (const matches of byEdge.values()) matches.sort((a, b) => a.from - b.from || a.to - b.to);
  const forEdge = (key) => byEdge.get(key) ?? [];
  return {
    ...asset, forEdge, forRoad: (edge) => forEdge(streetRoadKey(edge)),
    forPath: (track, direction, mode) => forEdge(streetPathKey(track, direction, mode)),
    byId: (id) => byId.get(id)
  };
}

export async function loadEdeStreetFeatures() {
  const response = await fetch(new URL('../assets/ede-street-features.json.gz', import.meta.url));
  if (!response.ok) throw new Error(`Ede street features returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Some servers apply Content-Encoding and the browser has already inflated the file.
  const body = new Response(bytes);
  const json = bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body;
  return indexStreetFeatures(await json.json());
}
