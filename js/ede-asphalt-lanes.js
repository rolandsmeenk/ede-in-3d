import * as THREE from 'three/webgpu';
import { EDE_DATA } from './ede-geodata.js';
import { nearestEdeRoad } from './ede-geometry.js';
import { resolveEdeRoadLanes } from './ede-road-lanes.js';
import { motorwayLanesAt } from './ede-motorway-lanes.js';
import { applyAsphaltLanes } from './ede-asphalt-attributes.js';
import { MOTOR } from './road-access.js?v=20261122-startup';

const laneBands = new WeakMap();
const directions = [0, 1];
const modesFor = road => road.modes ?? directions.map(d => !road.oneway || d === Number(!!road.reverse) ? MOTOR : 0);
let junctions;

function junctionDegrees() {
  if (junctions) return junctions;
  junctions = new Map();
  for (const road of EDE_DATA.roads) {
    if (!road.nodeIds?.length || !modesFor(road).some(modes => modes & MOTOR)) continue;
    const layer = road.layer ?? 0;
    for (const [i, node] of road.nodeIds.entries()) {
      const key = layer + '/' + node;
      const ends = i === 0 || i === road.nodeIds.length - 1;
      junctions.set(key, (junctions.get(key) ?? 0) + (ends ? 1 : 2));
    }
  }
  return junctions;
}

function laneBand({ road, a, b, segmentIndex }) {
  let bands = laneBands.get(road);
  if (!bands) laneBands.set(road, bands = new Map());
  if (bands.has(segmentIndex)) return bands.get(segmentIndex);
  const definitions = resolveEdeRoadLanes(road, modesFor(road), directions.map(d => motorwayLanesAt(road, d, a, b)));
  const [forward, backward] = definitions;
  const lanes = [...forward.lanes, ...forward.centers, ...backward.lanes.map(lane => ({ ...lane, offset: -lane.offset }))];
  const degrees = junctionDegrees();
  const layer = road.layer ?? 0;
  const band = lanes.length ? {
    origin: Math.min(...lanes.map(lane => lane.offset)),
    width: lanes[0].width,
    count: lanes.length,
    startJunction: degrees.get(layer + '/' + road.nodeIds?.[segmentIndex]) > 2,
    endJunction: degrees.get(layer + '/' + road.nodeIds?.[segmentIndex + 1]) > 2,
  } : null;
  bands.set(segmentIndex, band);
  return band;
}

export function addAsphaltLanes(geometry, segment, layer) {
  return applyAsphaltLanes(THREE, geometry, segment, layer, nearestEdeRoad, laneBand);
}

export function describePavingLane(segment) {
  const { a, len, ux, uz, width, pedestrian, road } = segment;
  return { a, len, ux, uz, width, pedestrian, road: { layer: road.layer },
    band: pedestrian ? null : laneBand(segment) };
}
