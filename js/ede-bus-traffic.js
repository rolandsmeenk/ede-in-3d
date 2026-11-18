import { roadEdgeKey } from './road-network.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function prepareEdeBusPaths(schedule, edges) {
  const byKey = new Map(edges.map((edge) => [roadEdgeKey(edge), edge]));
  const references = (schedule?.edges || []).map((key) => byKey.get(key));
  const paths = new Map();
  let missing = 0;
  for (const variant of schedule?.variants || []) {
    for (const slice of variant.slices) {
      const legs = slice.legs.map((leg) => ({ ...leg, road: references[leg.edge] }));
      const usable = legs.length && legs.every(({ road, lane }, i) =>
        road && lane >= 0 && lane < road.lanes.length && (!legs[i + 1] ||
          road.moves.some((move) => move.to === legs[i + 1].road && move.out[lane] === legs[i + 1].lane)));
      if (!usable) {
        missing++;
        continue;
      }
      const stops = (slice.stops || []).map(({ index, leg, at }) => {
        const { road, lane } = legs[leg];
        const stop = variant.stops[index];
        const side = (stop.x - road.sx) * road.rx + (stop.z - road.sz) * road.rz - road.lanes[lane];
        return { index, leg, at: clamp(at, 0, road.len), side, stop };
      });
      paths.set(slice, { legs, stops });
    }
  }
  if (missing) console.warn(`[buses] ${missing} route sections differ from the current road graph`);
  return paths;
}

export function busEntryAt(path, distance, initial) {
  const { legs, stops } = path;
  const stop = initial && stops.find(({ stop }) => Math.abs(stop.distance - distance) < 0.05);
  if (stop) return { leg: stop.leg, at: stop.at, stop: stops.indexOf(stop) };
  const leg = initial ? Math.max(0, legs.findIndex(({ end }) => end >= distance)) : 0;
  const { start, end, from, to, road } = legs[leg];
  const progress = initial && end > start ? clamp((distance - start) / (end - start), 0, 1) : 0;
  const at = clamp(from + (to - from) * progress, 0, road.len);
  const nextStop = stops.findIndex((stop) => stop.leg > leg || (stop.leg === leg && stop.at >= at - 0.1));
  return { leg, at, stop: nextStop < 0 ? stops.length : nextStop };
}
