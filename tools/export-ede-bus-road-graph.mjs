// Export the same directed edges and lane turns used by the traffic simulator.
import { EDE_DATA } from '../js/ede-geodata.js';
import { buildRoadNetwork, roadEdgeKey } from '../js/road-network.js';

const info = console.info;
console.info = console.error;
const { edges, connector } = buildRoadNetwork([], []);
console.info = info;
const point = ({ x, z }) => ({ x, z });
const records = edges.map((e) => ({
  id: e.id, key: roadEdgeKey(e), from: point(e.from), to: point(e.to), busOnly: !!e.busOnly,
  x0: e.x0, z0: e.z0, sx: e.sx, sz: e.sz, dx: e.dx, dz: e.dz,
  rx: e.rx, rz: e.rz, span: e.span, len: e.len, lanes: e.lanes,
  moves: e.moves.map(({ to, out }) => ({
    to: to.id, out, connectorLengths: out.map((j, i) => j < 0 ? null : connector(e, i, to, j).len),
  })),
}));
process.stdout.write(JSON.stringify({ bounds: EDE_DATA.meta.bounds, edges: records }));
