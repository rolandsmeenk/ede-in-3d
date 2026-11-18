// Use the same directed edge keys as the browser, including map topology at junctions.
import { EDE_DATA } from '../js/ede-geodata.js';
import { buildRoadNetwork, roadEdgeKey } from '../js/road-network.js';
import { CAR } from '../js/road-access.js';

const info = console.info;
console.info = console.error;
const { edges } = buildRoadNetwork([], []);
console.info = info;
const roads = new Map(EDE_DATA.roads.map(road => [road.id, road]));
const records = edges.filter(edge => edge.modes & CAR).map(edge => {
  const road = roads.get(edge.wayId);
  return {
    key: `${roadEdgeKey(edge)}|${edge.wayId}|${edge.layer}`, a: [edge.from.x, edge.from.z], b: [edge.to.x, edge.to.z],
    layer: edge.layer, bridge: edge.bridge, tunnel: edge.underpass, lanes: edge.lanes,
    way: edge.wayId, kind: road?.kind, name: road?.name, oneway: !!road?.oneway,
  };
});
const { bounds, geographicBounds, lonLatAffine } = EDE_DATA.meta;
process.stdout.write(JSON.stringify({ bounds, geographicBounds, lonLatAffine, edges: records }));
