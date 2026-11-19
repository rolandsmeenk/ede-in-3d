// Export the same directed edges and lane turns used by the traffic simulator.
import { readFileSync } from 'node:fs';
import { EDE_DATA } from '../js/ede-geodata.js';
import { buildRoadNetwork, roadEdgeKey } from '../js/road-network.js';
import { BUS, VEHICLE_CLEARANCE, fitsRoad } from '../js/road-access.js';
import { setEdeMotorwayLanes } from '../js/ede-motorway-lanes.js';

setEdeMotorwayLanes(JSON.parse(readFileSync(new URL('../assets/ede-motorway-lanes.json', import.meta.url), 'utf8')));

const info = console.info;
console.info = console.error;
const { edges, connector, alternateBusMove } = buildRoadNetwork([], []);
console.info = info;
const point = ({ x, z }) => ({ x, z });
const busEdges = new Set(edges.filter(e => (e.modes & BUS) && fitsRoad(VEHICLE_CLEARANCE.bus, e.limits, BUS)));
const allowsLane = (edge, i) => i >= 0 && (!edge.laneModes || (edge.laneModes[i] & BUS));
const records = [...busEdges].map((e) => ({
  id: e.id, key: roadEdgeKey(e), from: point(e.from), to: point(e.to),
  x0: e.x0, z0: e.z0, sx: e.sx, sz: e.sz, dx: e.dx, dz: e.dz,
  rx: e.rx, rz: e.rz, span: e.span, len: e.len, lanes: e.lanes,
  laneMask: e.lanes.map((_, i) => !!allowsLane(e, i)),
  moves: e.moves.filter(move => busEdges.has(move.to) && (move.modes & BUS)).map(move => {
    const { to, out, osmTurn } = move;
    // Station services need to select the bus lane or prepare for the signed movement at the next short link.
    let stationLanes;
    if (e.wayId === 'w1193451514' && to.wayId === 'w1156964960') {
      stationLanes = to.lanes.flatMap((_, i) => to.laneModes?.[i] === BUS ? [i] : []);
    } else if (e.wayId === 'w620928503' && to.wayId === 'w1193451510') stationLanes = [1];
    else if (e.wayId === 'w620928502' && to.wayId === 'w620928503') stationLanes = [1, 2];
    const alternatives = stationLanes && e.lanes.map((_, i) => stationLanes.filter(j =>
      j < to.lanes.length && j !== out[i] && alternateBusMove(e, move, i, j)));
    return { to: to.id, osmTurn, out: out.map((j, i) => allowsLane(e, i) && allowsLane(to, j) ? j : -1), alternatives,
      connectorLengths: out.map((j, i) => j < 0 ? null : connector(e, i, to, j).len) };
  }),
}));
process.stdout.write(JSON.stringify({ bounds: EDE_DATA.meta.bounds, edges: records }));
