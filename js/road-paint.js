import * as THREE from 'three/webgpu';
import { createRoadPaintMaterial } from './tsl-materials.js';
import { fittedLanePoint } from './ede-lane-geometry.js';

// Road markings follow the lane layout and stop lines supplied by the road network.

const WHITE = new THREE.Color(0xe6e2d6);
const YELLOW = new THREE.Color(0xe8ad22);
const GREEN = new THREE.Color(0x2a8a4e);
const HEIGHT = 0.012; // above the asphalt
const PAINT_CELL_SIZE = 1200;
const PAINT_CULL_DISTANCE = 1650;
const PAINT_MAX_SEGMENT = 200;
const WIDEN_SPHERE_PAD = 16; // createRoadPaintMaterial widens thin distant strips up to 16x in screen space

// Spatial chunk builder shared by Manhattan street markings and perimeter highway markings (js/city-grid.js), so
// off-screen and distant (> 1.65 km) road paint is culled instead of transforming all 12.5 km of vertices every frame.
function createRoadPaintChunkBuilder(name, { cellSize = PAINT_CELL_SIZE, cullDistance = PAINT_CULL_DISTANCE, heightAt, preserveGBuffer } = {}) {
  const cells = new Map();

  function pushQuad(ax, ay, az, bx, by, bz, sx, sz, col, period, duty, u0, u1, edge) {
    const mx = (ax + bx) * 0.5;
    const mz = (az + bz) * 0.5;
    const key = (Math.floor(mx / cellSize) << 16) ^ (Math.floor(mz / cellSize) & 0xffff);
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { position: [], side: [], paint: [], colors: [], index: [] }));
    const i = cell.position.length / 3;
    for (const [x, y, z, s, u] of [[ax, ay, az, -1, u0], [ax, ay, az, 1, u0], [bx, by, bz, 1, u1], [bx, by, bz, -1, u1]]) {
      const edgeX = x + sx * s, edgeZ = z + sz * s;
      cell.position.push(edgeX, y + (heightAt?.(edgeX, edgeZ, edge) ?? 0), edgeZ);
      cell.side.push(sx * s, sz * s);
      cell.paint.push(u, period, duty);
      cell.colors.push(col.r, col.g, col.b);
    }
    cell.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  function strip3D(ax, ay, az, bx, by, bz, w, col, period = 1, duty = 1, phase = 0, flow = 1, edge) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const sx = ((az - bz) / len) * w * 0.5;
    const sz = ((bx - ax) / len) * w * 0.5;
    const parts = Math.max(1, Math.ceil(len / (heightAt ? 6 : PAINT_MAX_SEGMENT)));
    for (let k = 0; k < parts; k++) {
      const t0 = k / parts;
      const t1 = (k + 1) / parts;
      pushQuad(
        ax + (bx - ax) * t0,
        ay + (by - ay) * t0,
        az + (bz - az) * t0,
        ax + (bx - ax) * t1,
        ay + (by - ay) * t1,
        az + (bz - az) * t1,
        sx,
        sz,
        col,
        period,
        duty,
        phase + len * t0 * flow,
        phase + len * t1 * flow,
        edge
      );
    }
  }

  function build() {
    const group = new THREE.Group();
    group.name = name;
    const material = createRoadPaintMaterial(preserveGBuffer);
    let first = null;

    for (const cell of cells.values()) {
      if (!cell.index.length) continue;
      const vertCount = cell.position.length / 3;
      const normal = new Float32Array(cell.position.length);
      for (let i = 1; i < normal.length; i += 3) normal[i] = 1;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(cell.position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(cell.colors, 3));
      geometry.setAttribute('side', new THREE.Float32BufferAttribute(cell.side, 2));
      geometry.setAttribute('paint', new THREE.Float32BufferAttribute(cell.paint, 3));
      geometry.setIndex(
        vertCount <= 65535
          ? new THREE.Uint16BufferAttribute(cell.index, 1)
          : new THREE.Uint32BufferAttribute(cell.index, 1)
      );
      geometry.computeBoundingSphere();
      if (geometry.boundingSphere) geometry.boundingSphere.radius += WIDEN_SPHERE_PAD;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${name}Chunk`;
      mesh.receiveShadow = true;
      mesh.renderOrder = -1; // under the other see-through ground effects (contact shadows, headlight beams)
      mesh.userData.cullDistance = cullDistance;
      if (first) mesh.userData.sharesPipelineWith = first;
      else first = mesh;
      group.add(mesh);
    }
    return group;
  }

  return { strip3D, build };
}

function buildRoadPaint(scene, network, sharedBuilder = null, heightAt, { surveyed = [], preserveGBuffer } = {}) {
  const builder = sharedBuilder || createRoadPaintChunkBuilder('RoadMarkings', { heightAt, preserveGBuffer });
  const lines = [];
  const bends = new Map();
  const surveyByWay = new Map();
  const fittedRoads = new Map();

  // Flat strip w wide from a to b, with a dash pattern (period, duty cycle) running along it
  function strip(ax, az, bx, bz, w, col, period = 1, duty = 1, phase = 0, flow = 1, edge) {
    builder.strip3D(ax, HEIGHT, az, bx, HEIGHT, bz, w, col, period, duty, phase, flow, edge);
  }

  for (const mark of surveyed) {
    if (!mark.wayId || mark.points?.length < 2 || !mark.points?.every(p => p.length === 2 && p.every(Number.isFinite))) continue;
    if (!surveyByWay.has(mark.wayId)) surveyByWay.set(mark.wayId, []);
    const way = surveyByWay.get(mark.wayId);
    let phase = mark.phase ?? 0;
    for (let i = 1; i < mark.points.length; i++) {
      const a = mark.points[i - 1], b = mark.points[i];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.05) continue;
      strip(...a, ...b, mark.width ?? 0.16, WHITE, mark.period ?? 1, mark.duty ?? 1, phase, 1, mark);
      phase += length;
      way.push([a, b, length]);
    }
  }

  function drawUnsurveyed(line) {
    const { ends: [[x, z], [x1, z1]], len, w, col, period, duty, phase, flow, e } = line;
    const survey = e.laneDefinition?.fast && surveyByWay.get(e.wayId);
    if (!survey?.length || len < 0.05) {
      strip(x, z, x1, z1, w, col, period, duty, phase, flow, e);
      return;
    }
    const dx = (x1 - x) / len, dz = (z1 - z) / len;
    const project = ([px, pz]) => (px - x) * dx + (pz - z) * dz;
    const offset = ([px, pz]) => (px - x) * dz - (pz - z) * dx;
    const covered = [];
    for (const [a, b, length] of survey) {
      const from = project(a), to = project(b);
      if (Math.abs(to - from) < length * 0.8 || Math.max(Math.abs(offset(a)), Math.abs(offset(b))) > 1.25) continue;
      const lo = Math.max(0, Math.min(from, to)), hi = Math.min(len, Math.max(from, to));
      if (hi - lo > 0.05) covered.push([lo, hi]);
    }
    let cursor = 0;
    const draw = (a, b) => strip(x + dx * a, z + dz * a, x + dx * b, z + dz * b, w, col, period, duty, phase + a * flow, flow, e);
    for (const [lo, hi] of covered.sort((a, b) => a[0] - b[0])) {
      if (lo > cursor) draw(cursor, lo);
      cursor = Math.max(cursor, hi);
    }
    if (cursor < len) draw(cursor, len);
  }

  // Translate original paint offsets through the fitted lane band, including its opposite direction.
  const straightAt = (e, s, o) => [e.sx + e.dx * s + e.rx * o, e.sz + e.dz * s + e.rz * o];
  function at(e, s, o) {
    const rows = fittedRoads.get(e);
    if (!rows) return straightAt(e, s, o);
    let right = rows.findIndex(row => row.offset >= o);
    if (right < 0) right = rows.length;
    const sample = ({ edge, lane, width, offset }) => {
      const station = edge === e ? s : (e.sx + e.dx * s - edge.sx) * edge.dx + (e.sz + e.dz * s - edge.sz) * edge.dz;
      const p = fittedLanePoint(edge, lane, station, {});
      return { ...p, offset, widthRatio: edge.fittedLanes?.[lane] ? p.width / width : 1 };
    };
    if (right > 0 && right < rows.length) {
      const a = sample(rows[right - 1]), b = sample(rows[right]);
      const t = (o - a.offset) / (b.offset - a.offset);
      return [a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t];
    }
    const p = sample(rows[right === 0 ? 0 : right - 1]);
    const extra = (o - p.offset) * p.widthRatio * (rows[right === 0 ? 0 : right - 1].edge === e ? 1 : -1);
    return [p.x - p.dz * extra, p.z + p.dx * extra];
  }
  const along = (e, o, w, col, period = 1, duty = 1) => {
    const start = (e.sx - e.x0) * e.dx + (e.sz - e.z0) * e.dz;
    const fast = e.laneDefinition?.fast;
    const startAt = fast || e.from.shape ? -start : 0.9;
    const endAt = fast || e.to.shape ? e.span - start : e.len - 0.9;
    if (endAt - startAt < 0.1) return;
    const ends = [at(e, startAt, o), at(e, endAt, o)];
    lines.push({ e, o, w, col, period, duty, ends, startAt, endAt, joins: [] });
  };
  const across = (e, s, o0, o1, w, col, period, duty) => strip(...at(e, s, o0), ...at(e, s, o1), w, col, period, duty, 0, 1, e);
  function turnArrows(e) {
    if (!e.turnTagsAtEnd || e.to.shape || e.len < 9) return;
    for (const lane of e.laneDefinition.lanes) {
      const turns = lane.turns?.filter(turn => turn !== 'reverse');
      if (!turns?.length) continue;
      const s = e.len - 6;
      const o = lane.offset;
      const draw = (a, b, c, d) => strip(...at(e, s + a, o + b), ...at(e, s + c, o + d), 0.135, WHITE, 1, 1, 0, 1, e);
      draw(-1.2, 0, 0, 0);
      for (const turn of turns) {
        const side = turn.endsWith('right') ? 1 : turn.endsWith('left') ? -1 : 0;
        const forward = side && !turn.includes('_') ? 0.55 : 1.2;
        const across = side * Math.min(0.65, lane.width * 0.3);
        const length = Math.hypot(forward, across);
        const tipX = forward / length, tipZ = across / length;
        draw(0, 0, forward, across);
        for (const wing of [-0.22, 0.22]) {
          draw(forward, across, forward - tipX * 0.4 - tipZ * wing, across - tipZ * 0.4 + tipX * wing);
        }
      }
    }
  }
  const clearCentre = (e, o) => {
    if (!network.isRoadClear) return false;
    const steps = Math.max(1, Math.ceil((e.len - 1.8) / 2.5));
    for (let i = 0; i <= steps; i++) {
      const s = 0.9 + (e.len - 1.8) * i / steps;
      for (const offset of [o - 0.12, o + 0.12]) if (!network.isRoadClear(...at(e, s, offset), 0.15)) return false;
    }
    return true;
  };

  // The one or two directed edges of each road between a pair of intersections
  const roads = new Map();
  for (const e of network.paintEdges || network.edges) {
    const key = `${Math.min(e.from.id, e.to.id)}:${Math.max(e.from.id, e.to.id)}:${e.laneDefinition ? e.wayId : ''}`;
    if (roads.has(key)) roads.get(key).push(e);
    else roads.set(key, [e]);
  }

  for (const [e, back] of roads.values()) {
    if (e.fittedLanes || back?.fittedLanes) {
      for (const [forward, opposing] of back ? [[e, back], [back, e]] : [[e]]) {
        const rows = (edge, dir) => edge.lanes.map((offset, lane) => ({
          edge, lane, offset: offset * dir,
          width: edge.laneDefinition?.lanes.find(item => item.offset === offset)?.width ?? 3.4,
        }));
        fittedRoads.set(forward, [
          ...rows(forward, 1), ...(opposing ? rows(opposing, -1) : []),
        ].sort((a, b) => a.offset - b.offset));
      }
    }
    const firstLine = lines.length;
    const definition = e.laneDefinition;
    // Lanes of both directions, measured to the right of e, left to right
    const lanesOf = (edge, dir) => edge.laneDefinition
      ? edge.laneDefinition.lanes.map(lane => ({ ...lane, o: lane.offset * dir, dir }))
      : edge.lanes.map(o => ({ o: o * dir, dir }));
    const lanes = lanesOf(e, 1);
    if (back) lanes.push(...lanesOf(back, -1));
    if (definition) lanes.push(...definition.centers.map(lane => ({ ...lane, o: lane.offset, dir: 0 })));
    lanes.sort((p, q) => p.o - q.o);

    // Dashed white between lanes going the same way, double yellow between opposing ones
    // (nothing across a median or a lane closed off by an obstacle)
    for (let k = 0; k + 1 < lanes.length && (!definition || definition.markings || back?.laneDefinition?.markings); k++) {
      const p = lanes[k];
      const q = lanes[k + 1];
      const mid = (p.o + q.o) / 2;
      if (definition) {
        const busBoundary = !!p.busOnly !== !!q.busOnly;
        along(e, mid, definition.fast ? 0.16 : 0.12, WHITE,
          busBoundary ? 1 : definition.fast ? 12 : 8, busBoundary ? 1 : 0.25);
        continue;
      }
      if (q.o - p.o > 4.5 && (p.dir === q.dir || !clearCentre(e, mid))) continue;
      if (p.dir === q.dir) {
        along(e, mid, 0.13, WHITE, 12, 0.25);
      } else {
        along(e, mid - 0.12, 0.11, YELLOW);
        along(e, mid + 0.12, 0.11, YELLOW);
      }
    }

    if (definition) {
      if (definition.fast && lanes.length) {
        const left = lanes[0], right = lanes.at(-1);
        along(e, left.o - left.width / 2 + 0.08, 0.16, WHITE);
        along(e, right.o + right.width / 2 - 0.08, 0.16, WHITE);
      }
      const bikeBorders = new Set();
      for (const [edge, dir] of back ? [[e, 1], [back, -1]] : [[e, 1]]) {
        for (const bike of edge.laneDefinition.bikes) {
          const offset = (bike.offset - Math.sign(bike.offset) * bike.width / 2) * dir;
          const key = offset.toFixed(2);
          if (bikeBorders.has(key)) continue;
          bikeBorders.add(key);
          const advisory = bike.kind === 'advisory';
          along(e, offset, advisory ? 0.10 : 0.14, WHITE, advisory ? 2 : 1, advisory ? 0.5 : 1);
        }
        if (edge.laneDefinition.markings) turnArrows(edge);
      }
    }

    // Wide one-way avenues: edge line, then a buffer and a green bike lane along the curb on the side left free
    if (!e.wayId && !back && e.axis === 'ave' && lanes.length >= 4) {
      for (const [edge, sign] of [[lanes[lanes.length - 1].o + 1.8, 1], [lanes[0].o - 1.8, -1]]) {
        const curb = sign * e.half;
        if ((curb - edge) * sign < 3.5) continue;
        along(e, edge + sign * 0.2, 0.13, WHITE);
        along(e, curb - sign * 2.4, 0.13, WHITE);
        along(e, curb - sign * 1.3, 2.0, GREEN);
      }
    }

    // Stop bars across the lanes arriving at each stop line, from the centre line (or median) to the curb (none where a
    // street merely bends: a shape node of the centreline streets)
    for (const f of back ? [e, back] : [e]) {
      if (f.to.shape || definition?.fast || f.boundary || f.underpass || f.busOnly) continue;
      const physical = f.laneDefinition?.lanes;
      const left = physical ? physical[0].offset - physical[0].width / 2 : back ? Math.max(0, f.lanes[0] - 1.8) : -f.half;
      const right = physical ? physical.at(-1).offset + physical.at(-1).width / 2 : f.half;
      if (right - left > 0.2) across(f, f.len - 0.35, left + 0.1, right - 0.1, 0.45, WHITE);
    }

    for (const [end, node] of [[0, e.from], [1, e.to]]) {
      if (!node.shape) continue;
      if (!bends.has(node.id)) bends.set(node.id, []);
      bends.get(node.id).push({ e, end, lines: lines.slice(firstLine) });
    }
  }

  // At a simple bend, corresponding offset lines meet at a bounded miter, without an intersection-sized gap.
  for (const roadsAtBend of bends.values()) {
    if (roadsAtBend.length !== 2 || roadsAtBend.some(entry => fittedRoads.has(entry.e))) continue;
    const [a, b] = roadsAtBend;
    const sign = a.end === b.end ? -1 : 1;
    if ((a.e.dx * b.e.dx + a.e.dz * b.e.dz) * sign < 0.5) continue;
    for (const p of a.lines) {
      let q = null;
      let distance = 0.5;
      for (const line of b.lines) {
        const d = Math.abs(p.o - line.o * sign);
        if (!line.joins[b.end] && line.col === p.col && line.w === p.w && line.period === p.period &&
          line.duty === p.duty && d < distance) {
          q = line;
          distance = d;
        }
      }
      if (!q) continue;
      const A = p.ends[a.end];
      const B = q.ends[b.end];
      const dx = B[0] - A[0];
      const dz = B[1] - A[1];
      const cross = a.e.dx * b.e.dz - a.e.dz * b.e.dx;
      let join;
      if (Math.abs(cross) < 0.001) {
        if (Math.hypot(dx, dz) > 0.5) continue;
        join = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
      } else {
        const t = (dx * b.e.dz - dz * b.e.dx) / cross;
        const u = (dx * a.e.dz - dz * a.e.dx) / cross;
        const limit = Math.min(6, a.e.span * 0.25, b.e.span * 0.25);
        if (Math.abs(t) > limit || Math.abs(u) > limit) continue;
        join = [A[0] + a.e.dx * t, A[1] + a.e.dz * t];
      }
      p.ends[a.end] = q.ends[b.end] = join;
      p.joins[a.end] = [q, b.end];
      q.joins[b.end] = [p, a.end];
    }
  }

  // Continue the same dash phase around bends, even when adjacent road edges point in opposite directions.
  for (const line of lines) {
    // An unmatched marking keeps its original gap instead of extending towards a curb at a sharp bend.
    for (const end of [0, 1]) {
      if (!line.joins[end] && !line.e.laneDefinition?.fast) line.ends[end] = at(line.e, end ? line.e.len - 0.9 : 0.9, line.o);
    }
    line.len = Math.hypot(line.ends[1][0] - line.ends[0][0], line.ends[1][1] - line.ends[0][1]);
  }
  for (const root of lines) {
    if (root.phase !== undefined) continue;
    root.phase = 0;
    root.flow = 1;
    const stack = [root];
    while (stack.length) {
      const line = stack.pop();
      for (let end = 0; end < 2; end++) {
        if (!line.joins[end]) continue;
        const [next, nextEnd] = line.joins[end];
        if (next.phase !== undefined) continue;
        next.flow = line.flow * (end === nextEnd ? -1 : 1);
        next.phase = line.phase + end * line.len * line.flow - nextEnd * next.len * next.flow;
        next.phase = ((next.phase % next.period) + next.period) % next.period;
        stack.push(next);
      }
      if (fittedRoads.has(line.e)) {
        const { e, o, startAt, endAt } = line;
        const fitStart = e.laneDefinition?.fast || e.from.shape ? startAt : 0.9;
        const fitEnd = e.laneDefinition?.fast || e.to.shape ? endAt : e.len - 0.9;
        const pieces = Math.max(1, Math.ceil((fitEnd - fitStart) / 4));
        let a = at(e, fitStart, o), phase = line.phase;
        for (let i = 1; i <= pieces; i++) {
          const b = at(e, fitStart + (fitEnd - fitStart) * i / pieces, o);
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          drawUnsurveyed({ ...line, ends: [a, b], len, phase });
          a = b;
          phase += len * line.flow;
        }
      } else drawUnsurveyed(line);
    }
  }

  const group = builder.build();
  scene.add(group);
  return group;
}

export { buildRoadPaint, createRoadPaintChunkBuilder };
