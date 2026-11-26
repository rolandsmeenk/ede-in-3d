// Use the same directed edge keys as the browser, including map topology at junctions.
import { readFileSync } from 'node:fs';
import { EDE_DATA } from '../js/ede-geodata.js';
import { buildRoadNetwork } from '../js/road-network.js';
import { streetRoadKey, streetPathKey } from '../js/ede-street-features.js';
import { BICYCLE, CAR, FOOT } from '../js/road-access.js';
import { setEdeMotorwayLanes } from '../js/ede-motorway-lanes.js';
import { prepareEdeBusPaths } from '../js/ede-bus-traffic.js';
import { mappedRoadPath } from '../js/ede-lane-geometry.js';

setEdeMotorwayLanes(JSON.parse(readFileSync(new URL('../assets/ede-motorway-lanes.json', import.meta.url), 'utf8')));

const streetFeatures = process.argv.includes('--street-features');
const laneFitting = process.argv.includes('--lane-fitting');
const grade = streetFeatures || laneFitting ? JSON.parse(readFileSync(new URL('../assets/ede-grade.json', import.meta.url), 'utf8')) : null;
const info = console.info;
console.info = console.error;
const { edges, activeTravel, paintEdges, connector, alternateBusMove } = buildRoadNetwork([], [], [], grade);
console.info = info;
const roads = new Map(EDE_DATA.roads.map(road => [road.id, road]));
const records = edges.filter(edge => laneFitting ? edge.wayId : streetFeatures ? edge.wayId && !edge.boundary : edge.modes & CAR).map(edge => {
  const road = roads.get(edge.wayId);
  return {
    key: streetRoadKey(edge), a: [edge.from.x, edge.from.z], b: [edge.to.x, edge.to.z],
    layer: edge.layer, bridge: edge.bridge, tunnel: edge.underpass, lanes: edge.lanes,
    way: edge.wayId, kind: road?.kind, name: road?.name, oneway: !!road?.oneway,
    ...((streetFeatures || laneFitting) && { modes: edge.modes, width: edge.laneDefinition?.width ?? road?.width ?? edge.half * 2,
      laneDefinition: edge.laneDefinition, sourceRoadKey: edge.sourceRoadKey, sourceRoadSpan: edge.sourceRoadSpan,
      sourceRoadStart: edge.sourceRoadStart, sourceRoadEnd: edge.sourceRoadEnd }),
    ...(laneFitting && { inset: [edge.sx, edge.sz, edge.len], axis: [edge.dx, edge.dz],
      offsetWidths: edge.driveLanes?.map(lane => lane.width), laneModes: edge.laneModes,
      openLanes: edge.driveLanes?.map(lane => edge.laneDefinition.lanes.indexOf(lane)),
      direction: edge.direction, span: edge.span, boundary: edge.boundary, busOnly: edge.busOnly,
      surveyedStop: !!edge.stopBar,
      mappedPath: edge.roadName === 'Apeldoornseweg' ? mappedRoadPath(edge) : undefined,
      shape: [!!edge.from.shape, !!edge.to.shape], id: edge.id })
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
let moves, paint, busLanes;
if (laneFitting) {
  moves = [];
  paint = Object.fromEntries(paintEdges.filter(e => e.wayId).map(e => [streetRoadKey(e), [e.sx, e.sz, e.len]]));
  const booked = new Map();
  busLanes = {};
  function addMove(edge, lane, next, nextLane, turn, bus) {
    if (!edge.wayId || !next.wayId) return;
    const key = [edge.id, lane, next.id, nextLane].join('/');
    if (booked.has(key)) {
      if (bus) booked.get(key)[7] = true;
      return;
    }
    const c = connector(edge, lane, next, nextLane);
    const row = [edge.id, lane, next.id, nextLane, c.len, [c.x0, c.z0, c.x1, c.z1, c.x2, c.z2, c.x3, c.z3], turn, bus];
    booked.set(key, row);
    moves.push(row);
  }
  for (const edge of edges) for (const move of edge.moves) {
    move.out.forEach((nextLane, lane) => {
      if (nextLane >= 0) addMove(edge, lane, move.to, nextLane, move.turn, false);
    });
  }
  const busRoutes = JSON.parse(readFileSync(new URL('../assets/ede-bus-routes.json', import.meta.url), 'utf8'));
  for (const { legs } of prepareEdeBusPaths(busRoutes, edges, alternateBusMove).values()) {
    for (const { road, lane } of legs) {
      const used = busLanes[road.id] ??= [];
      if (!used.includes(lane)) used.push(lane);
    }
    for (let i = 0; i < legs.length - 1; i++) {
      const a = legs[i], b = legs[i + 1];
      addMove(a.road, a.lane, b.road, b.lane, a.move.turn, true);
    }
  }
}
process.stdout.write(JSON.stringify({ bounds, geographicBounds, lonLatAffine, edges: records,
  ...(streetFeatures && { paths }), ...(laneFitting && { moves, paint, busLanes }) }));
