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
  function forRoad(edge) {
    const key = streetRoadKey(edge);
    const current = forEdge(key);
    const source = forEdge(edge.sourceRoadKey);
    if (!source.length || !(edge.sourceRoadEnd > edge.sourceRoadStart)) return current;
    const left = edge.sourceRoadSpan * edge.sourceRoadStart;
    const right = edge.sourceRoadSpan * edge.sourceRoadEnd;
    if (!(right > left)) return current;
    const span = edge.span ?? Math.hypot(edge.to.x - edge.from.x, edge.to.z - edge.from.z);
    const scale = span / (right - left);
    const resolved = new Set(current.map(match => match.feature.id));
    const inherited = source.filter(match => match.to >= left && match.from <= right && !resolved.has(match.feature.id))
      .map(match => ({ ...match, key, from: Math.max(0, match.from - left) * scale,
        to: (Math.min(right, match.to) - left) * scale }));
    return inherited.length ? [...current, ...inherited].sort((a, b) => a.from - b.from || a.to - b.to) : current;
  }
  return {
    ...asset, forEdge, forRoad,
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
