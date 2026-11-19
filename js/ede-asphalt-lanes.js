import * as THREE from 'three/webgpu';
import { EDE_DATA } from './ede-geodata.js';
import { nearestEdeRoad } from './ede-geometry.js';
import { resolveEdeRoadLanes } from './ede-road-lanes.js';
import { motorwayLanesAt } from './ede-motorway-lanes.js';
import { MOTOR } from './road-access.js';

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

// Mapped pavement polygons can span multiple streets. Match each draped
// triangle to a road axis so a lane coordinate never interpolates across roads.
export function addAsphaltLanes(geometry, segment, layer) {
  if (!segment && layer !== undefined && geometry.index) {
    const expanded = geometry.toNonIndexed();
    geometry.dispose();
    geometry = expanded;
  }
  const positions = geometry.getAttribute('position');
  const data = new Float32Array(positions.count * 4);
  const set = (i, section, band) => {
    const x = positions.getX(i) - section.a.x, z = positions.getZ(i) - section.a.z;
    const across = -section.uz * x + section.ux * z;
    const along = section.ux * x + section.uz * z;
    const offset = i * 4;
    data[offset] = (across - band.origin) / band.width;
    data[offset + 1] = band.width;
    data[offset + 2] = band.count;
    const junctionDistance = Math.min(band.startJunction ? along : Infinity,
      band.endJunction ? section.len - along : Infinity);
    data[offset + 3] = THREE.MathUtils.smoothstep(junctionDistance, 1.0, 6.0);
  };

  if (segment && !segment.pedestrian) {
    const band = laneBand(segment);
    if (band) for (let i = 0; i < positions.count; i++) set(i, segment, band);
  } else if (layer !== undefined) {
    for (let i = 0; i + 2 < positions.count; i += 3) {
      const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
      const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
      const section = nearestEdeRoad(x, z, 13, undefined, layer);
      const band = section && laneBand(section);
      if (!band || section.distance > section.width / 2 + 0.9) continue;
      for (let vertex = i; vertex < i + 3; vertex++) set(vertex, section, band);
    }
  }

  geometry.setAttribute('asphaltLanes', new THREE.BufferAttribute(data, 4));
  return geometry;
}
