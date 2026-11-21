import * as THREE from 'three/webgpu';
import { fittedLanePoint } from './ede-lane-geometry.js';
import { indexLocalRoads } from './traffic-area.js';

const REACH = 230;
const REBUILD_DISTANCE = 56;
const VERTEX_LIMIT = 48000;
const LIFT = 0.28;

export function createTrafficLaneDebug(scene, { network, busPaths, roadGround }) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.DoubleSide,
    depthWrite: false, fog: false, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Traffic lane debug';
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  scene.add(mesh);

  const fitted = new THREE.Color(0x38e9ff), fallback = new THREE.Color(0xffb027), bus = new THREE.Color(0xcf88ff);
  const edges = [], signals = [], schedules = new Map();
  const current = {}, previous = {};
  let query, positions, colors, length = 0, enabled = false;
  let lastX = Infinity, lastZ = Infinity;

  function prepare() {
    for (const { legs } of busPaths.values()) {
      for (let i = 0; i < legs.length; i++) {
        const { road, lane } = legs[i];
        if (!schedules.has(road)) schedules.set(road, { lanes: new Set(), turns: [] });
        const record = schedules.get(road);
        record.lanes.add(lane);
        const next = legs[i + 1];
        if (next && !next.road.unmodeledTunnel && !record.turns.some(move =>
          move.lane === lane && move.to === next.road && move.out === next.lane)) {
          record.turns.push({ lane, to: next.road, out: next.lane });
        }
      }
    }
    query = indexLocalRoads(network.edges.filter(edge => !edge.unmodeledTunnel &&
      (edge.ambientLanes.length || edge.vanLanes.length || edge.refuseLanes.length || schedules.has(edge))), []);
    positions = new THREE.BufferAttribute(new Float32Array(VERTEX_LIMIT * 3), 3).setUsage(THREE.DynamicDrawUsage);
    colors = new THREE.BufferAttribute(new Float32Array(VERTEX_LIMIT * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positions);
    geometry.setAttribute('color', colors);
  }

  function vertex(point, lateral, forward, color, shade) {
    positions.setXYZ(length, point.x - point.dz * lateral + point.dx * forward, point.y,
      point.z + point.dx * lateral + point.dz * forward);
    colors.setXYZ(length++, color.r * shade, color.g * shade, color.b * shade);
  }

  function trace(pointAt, edge, toEdge, start, end, halfWidth, color) {
    const intervals = Math.max(1, Math.ceil((end - start) / 2.4));
    const shade = toEdge ? 0.55 : 1;
    for (let i = 0; i <= intervals && length + 6 <= VERTEX_LIMIT; i++) {
      pointAt(start + (end - start) * i / intervals, current);
      current.y = roadGround(edge, current.x, current.z, toEdge) + LIFT;
      if (i) {
        vertex(previous, -halfWidth, 0, color, shade);
        vertex(previous, halfWidth, 0, color, shade);
        vertex(current, -halfWidth, 0, color, shade);
        vertex(previous, halfWidth, 0, color, shade);
        vertex(current, halfWidth, 0, color, shade);
        vertex(current, -halfWidth, 0, color, shade);
      }
      Object.assign(previous, current);
    }
    if (toEdge || end - start < 5) return;
    const arrows = Math.ceil((end - start) / 32);
    for (let i = 0; i < arrows && length + 3 <= VERTEX_LIMIT; i++) {
      pointAt(start + (end - start) * (i + 0.5) / arrows, current);
      current.y = roadGround(edge, current.x, current.z) + LIFT + 0.01;
      vertex(current, 0, 1.05, color, 1);
      vertex(current, -0.55, -0.6, color, 1);
      vertex(current, 0.55, -0.6, color, 1);
    }
  }

  function update({ x, z }) {
    if (!enabled || Math.hypot(x - lastX, z - lastZ) < REBUILD_DISTANCE) return;
    if (!query) prepare();
    lastX = x;
    lastZ = z;
    length = 0;
    query(x, z, REACH, edges, signals);
    const station = edge => (x - edge.sx) * edge.dx + (z - edge.sz) * edge.dz;
    const distance = edge => {
      const s = Math.max(0, Math.min(edge.len, station(edge)));
      return (edge.sx + s * edge.dx - x) ** 2 + (edge.sz + s * edge.dz - z) ** 2;
    };
    edges.sort((a, b) => distance(a) - distance(b));
    for (const edge of edges) {
      if (length + 6 > VERTEX_LIMIT) break;
      const s = station(edge), start = Math.max(0, s - REACH), end = Math.min(edge.len, s + REACH);
      const roadLanes = new Set([...edge.ambientLanes, ...edge.vanLanes, ...edge.refuseLanes]);
      const scheduled = schedules.get(edge);
      for (const lane of new Set([...roadLanes, ...(scheduled?.lanes ?? [])])) {
        const color = roadLanes.has(lane) ? (edge.fittedLanes?.[lane] ? fitted : fallback) : bus;
        trace((t, out) => fittedLanePoint(edge, lane, t, out), edge, null, start, end, 0.095, color);
      }
      if (Math.hypot(edge.to.x - x, edge.to.z - z) > REACH) continue;
      const seen = new Set();
      function turn(lane, to, out, busOnly = false) {
        const id = `${lane}/${to.id}/${out}`;
        if (out < 0 || seen.has(id) || length + 6 > VERTEX_LIMIT) return;
        seen.add(id);
        const curve = network.connector(edge, lane, to, out);
        if (curve.len <= 0) return;
        const color = busOnly ? bus : curve.samples ? fitted : fallback;
        trace((t, point) => network.curvePoint(curve, t, point), edge, to, 0, curve.len, 0.06, color);
      }
      for (const moves of [edge.ambientMoves, edge.vanMoves, edge.refuseMoves]) {
        for (const move of moves) move.out.forEach((out, lane) => turn(lane, move.to, out));
      }
      for (const { lane, to, out } of scheduled?.turns ?? []) turn(lane, to, out, true);
    }
    geometry.setDrawRange(0, length);
    mesh.visible = length > 0;
    if (!mesh.visible) return;
    for (const attribute of [positions, colors]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, length * 3);
      attribute.needsUpdate = true;
    }
  }

  return { update, setEnabled(value) {
    enabled = value;
    if (!enabled) mesh.visible = false;
    lastX = Infinity;
  } };
}
