// Use the same directed edge keys as the browser, including map topology at junctions.
import { readFileSync } from 'node:fs';
import { EDE_DATA } from '../js/ede-geodata.js';
import { buildRoadNetwork } from '../js/road-network.js';
import { streetRoadKey, streetPathKey } from '../js/ede-street-features.js';
import { BICYCLE, CAR, FOOT } from '../js/road-access.js';

const streetFeatures = process.argv.includes('--street-features');
const grade = streetFeatures && JSON.parse(readFileSync(new URL('../assets/ede-grade.json', import.meta.url), 'utf8'));
const info = console.info;
console.info = console.error;
const { edges, activeTravel } = buildRoadNetwork([], [], [], grade);
console.info = info;
const roads = new Map(EDE_DATA.roads.map(road => [road.id, road]));
const records = edges.filter(edge => streetFeatures ? edge.wayId && !edge.boundary : edge.modes & CAR).map(edge => {
  const road = roads.get(edge.wayId);
  return {
    key: streetRoadKey(edge), a: [edge.from.x, edge.from.z], b: [edge.to.x, edge.to.z],
    layer: edge.layer, bridge: edge.bridge, tunnel: edge.underpass, lanes: edge.lanes,
    way: edge.wayId, kind: road?.kind, name: road?.name, oneway: !!road?.oneway,
    ...(streetFeatures && { modes: edge.modes, width: road?.bgt?.width ?? road?.width ?? edge.half * 2 })
  };
});
const { bounds, geographicBounds, lonLatAffine } = EDE_DATA.meta;
const paths = [];
if (streetFeatures && activeTravel) {
  const [minX, minZ, maxX, maxZ] = bounds;
  const radius = Math.hypot(maxX - minX, maxZ - minZ);
  for (const [mode, search] of [[BICYCLE, activeTravel.bikes], [FOOT, activeTravel.foot]]) {
    const tracks = [];
    search((minX + maxX) / 2, (minZ + maxZ) / 2, radius, tracks);
    for (const track of tracks) {
      if (!track.wayId) continue;
      const start = [track.ax, track.az];
      const end = [track.ax + track.ux * track.len, track.az + track.uz * track.len];
      for (const [i, allowed] of track.allowed.entries()) {
        if (!allowed) continue;
        paths.push({
          key: streetPathKey(track, i ? -1 : 1, mode), a: i ? end : start, b: i ? start : end,
          way: track.wayId, layer: track.layer ?? 0, modes: mode, kind: track.kind, width: track.width,
          bridge: !!roads.get(track.wayId)?.bridge, tunnel: !!roads.get(track.wayId)?.tunnel,
          crossing: track.crossing && {
            osmId: track.crossing.osmId, control: track.crossing.control, wayIds: track.crossing.wayIds
          }
        });
      }
    }
  }
}
process.stdout.write(JSON.stringify({ bounds, geographicBounds, lonLatAffine, edges: records, ...(streetFeatures && { paths }) }));
