import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { CROSSWALK } from './road-network.js';
import { gradeProfileAt, gradeWayAt } from './ede-grade.js';
import { terrainHeightAt } from './terrain.js';
import { createRoadSurfaceMaterial } from './tsl-materials.js';
import { nearestEdeRoad } from './ede-geometry.js';

const CELL = 320;
const OVERLAP_CELL = 24;
const ROAD_LIFT = 0.063;
const PAINT_LIFT = 0.02;
const TRIANGLES = [0, 1, 2, 0, 2, 3];

const wayOf = feature => feature.renderWay ?? feature.wayId ?? feature.edges?.[0]?.way;
const layerOf = feature => feature.layer ?? feature.edges?.[0]?.layer ?? 0;
const isMarked = crossing => crossing.marked ?? crossing.control === 'zebra';
const hasSurface = feature => feature.tangent?.length === 2
  && [feature.x, feature.z, feature.length, feature.width, ...feature.tangent].every(Number.isFinite)
  && feature.length > 0 && feature.width > 0 && Math.hypot(...feature.tangent) > 0;

function surfaceHeight(feature, x, z, reach = 1.2) {
  const way = gradeWayAt(wayOf(feature), x, z, reach);
  if (way) return way.y;
  const layer = layerOf(feature);
  if (layer || feature.bridge || feature.tunnel) {
    const kind = layer > 0 || feature.bridge ? 'bridge' : 'underpass';
    const heading = feature.tangent && Math.atan2(...feature.tangent);
    const profile = gradeProfileAt(x, z, 'motor', heading);
    if (profile?.kind === kind) return profile.y;
  }
  return terrainHeightAt(x, z);
}

function roadFrame({ x, z, tangent: [dx, dz] }) {
  const magnitude = Math.hypot(dx, dz);
  dx /= magnitude;
  dz /= magnitude;
  return {
    dx, dz,
    at: (s, t) => [x + dx * s - dz * t, z + dz * s + dx * t],
    along: (px, pz) => (px - x) * dx + (pz - z) * dz,
    across: (px, pz) => (pz - z) * dx - (px - x) * dz
  };
}

function bumpSurface(bump) {
  const frame = roadFrame(bump);
  const footprint = bump.footprint?.length >= 3
    ? bump.footprint.map(([x, z]) => [frame.along(x, z), frame.across(x, z)]) : null;
  const halfLength = footprint ? Math.max(...footprint.map(([s]) => Math.abs(s))) : bump.length / 2;
  const halfWidth = footprint ? Math.max(...footprint.map(([, t]) => Math.abs(t))) : bump.width / 2;
  const ramp = Math.min(1.25, halfLength * 0.55);
  const edgeSlope = Math.min(0.36, halfWidth * 0.35);
  const amountAt = (s, t) => {
    if (Math.abs(s) >= halfLength || Math.abs(t) > halfWidth + 1e-6) return 0;
    const distance = halfLength - Math.abs(s);
    if (bump.profile === 'table') return bump.height * Math.min(1, distance / ramp);
    const rise = (1 + Math.cos(Math.PI * s / halfLength)) / 2;
    const across = bump.profile === 'cushion' ? Math.min(1, (halfWidth - Math.abs(t)) / edgeSlope) : 1;
    return bump.height * rise * Math.max(0, across);
  };
  const baseAt = (x, z) => surfaceHeight(bump, x, z) + ROAD_LIFT;
  const heightAt = (x, z) => baseAt(x, z) + amountAt(frame.along(x, z), frame.across(x, z));
  return { frame, footprint, halfLength, halfWidth, ramp, edgeSlope, baseAt, heightAt };
}

function clipRing(ring, axis, cut, side) {
  if (!ring.length) return ring;
  const out = [];
  let a = ring[ring.length - 1];
  let da = (a[axis] - cut) * side;
  for (const b of ring) {
    const db = (b[axis] - cut) * side;
    if ((da >= 0) !== (db >= 0)) {
      const u = da / (da - db);
      out.push(a.map((value, i) => value + (b[i] - value) * u));
    }
    if (db >= 0) out.push(b);
    a = b;
    da = db;
  }
  return out;
}

function splitFootprint(footprint, axes, emit) {
  const triangles = THREE.ShapeUtils.triangulateShape(footprint.map(p => new THREE.Vector2(...p)), []);
  function visit(ring, axis) {
    if (ring.length < 3) return;
    if (axis === 2) {
      for (let i = 2; i < ring.length; i++) emit(ring[0], ring[i - 1], ring[i]);
      return;
    }
    const min = Math.min(...ring.map(p => p[axis])), max = Math.max(...ring.map(p => p[axis]));
    for (let i = 1; i < axes[axis].length; i++) {
      const a = axes[axis][i - 1], b = axes[axis][i];
      if (b <= min || a >= max || b - a < 1e-5) continue;
      visit(clipRing(clipRing(ring, axis, a, 1), axis, b, -1), axis + 1);
    }
  }
  for (const triangle of triangles) {
    const points = triangle.map(i => footprint[i]);
    const [[ax, az], [bx, bz], [cx, cz]] = points;
    if ((bx - ax) * (cz - az) > (bz - az) * (cx - ax)) points.reverse();
    visit(points, 0);
  }
}

function crossingFrame(crossing) {
  const frame = roadFrame(crossing);
  let t0 = -crossing.width / 2, t1 = crossing.width / 2, s0 = 0, s1 = 0;
  if (crossing.ends?.length === 2) {
    const ends = crossing.ends.map(p => ({ t: frame.across(...p), s: frame.along(...p) })).sort((a, b) => a.t - b.t);
    if (ends[1].t - ends[0].t >= 1) {
      // Limit surveyed path endpoints to the mapped carriageway, including on skew approaches.
      const width = Math.min(crossing.width, ends[1].t - ends[0].t);
      const mid = (ends[0].t + ends[1].t) / 2;
      t0 = mid - width / 2;
      t1 = mid + width / 2;
      const skew = (ends[1].s - ends[0].s) / (ends[1].t - ends[0].t);
      s0 = ends[0].s + (t0 - ends[0].t) * skew;
      s1 = ends[0].s + (t1 - ends[0].t) * skew;
    }
  }
  const start = t0, end = t1;
  const alongAt = t => s0 + (s1 - s0) * (t - start) / (end - start);
  const center = (t0 + t1) / 2;
  const [x, z] = frame.at(alongAt(center), center);
  const road = nearestEdeRoad(x, z, 15, wayOf(crossing));
  if (road) {
    const lateral = (px, pz) => (pz - road.z) * road.ux - (px - road.x) * road.uz;
    const from = lateral(...frame.at(s0, t0)), to = lateral(...frame.at(s1, t1));
    const extent = Math.abs(frame.dz * road.ux - frame.dx * road.uz) * crossing.length / 2;
    const half = road.width / 2 - extent - 0.07;
    if (half > 0 && Math.abs(to - from) >= (end - start) * 0.5) {
      const a = start + (-half - from) * (end - start) / (to - from);
      const b = start + (half - from) * (end - start) / (to - from);
      const low = Math.max(start, Math.min(a, b)), high = Math.min(end, Math.max(a, b));
      if (high - low > 0.5) { t0 = low; t1 = high; }
    }
  }
  return { ...frame, t0, t1, alongAt };
}

function createZebraLookup(crossings) {
  const cells = new Map();
  const key = (x, z) => `${x}/${z}`;
  for (const crossing of crossings) {
    const frame = crossingFrame(crossing);
    const from = frame.at(frame.alongAt(frame.t0), frame.t0), to = frame.at(frame.alongAt(frame.t1), frame.t1);
    const padding = crossing.length / 2 + CROSSWALK / 2 + 2;
    const low = axis => Math.floor((Math.min(from[axis], to[axis]) - padding) / OVERLAP_CELL);
    const high = axis => Math.floor((Math.max(from[axis], to[axis]) + padding) / OVERLAP_CELL);
    for (let x = low(0); x <= high(0); x++) for (let z = low(1); z <= high(1); z++) {
      const cell = key(x, z);
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push({ crossing, frame });
    }
  }
  return (x, z, edge) => (cells.get(key(Math.floor(x / OVERLAP_CELL), Math.floor(z / OVERLAP_CELL))) || [])
    .some(({ crossing, frame }) => {
      if (layerOf(crossing) !== (edge.layer ?? 0) || Math.abs(frame.dx * edge.dx + frame.dz * edge.dz) < 0.82) return false;
      // The other half of a divided street can be an independently painted crossing.
      const across = frame.across(x, z);
      if (across < frame.t0 - 0.6 || across > frame.t1 + 0.6) return false;
      return Math.abs(frame.along(x, z) - frame.alongAt(across)) < (crossing.length + CROSSWALK - 0.3) / 2;
    });
}

function collectRoadSurfaces({ bumps = [], crossings = [] }, quad) {
  const asphalt = createRoadSurfaceMaterial();
  const paint = new THREE.MeshStandardNodeMaterial({ color: 0xe6e2d6, roughness: 0.78 });
  const marked = crossings.filter(crossing => isMarked(crossing) && hasSurface(crossing));
  const strips = marked.flatMap(crossing => !crossing.segments?.length ? [crossing]
    : crossing.segments.filter(segment => segment.marked !== false).map(segment => ({
      ...crossing, ...segment,
      renderWay: segment.renderWay ?? (segment.wayId && segment.wayId !== crossing.wayId ? segment.wayId : crossing.renderWay)
    })));
  const bumpPlanes = new Map(strips.filter(crossing => crossing.bumpId).map(crossing => [crossing.bumpId, []]));
  const surfacePoint = (frame, heightAt, s, t) => {
    const [x, z] = frame.at(s, t);
    return [x, heightAt(x, z), z];
  };
  const rectangle = (frame, heightAt, s0, s1, t0, t1) => [
    surfacePoint(frame, heightAt, s0, t0), surfacePoint(frame, heightAt, s0, t1),
    surfacePoint(frame, heightAt, s1, t1), surfacePoint(frame, heightAt, s1, t0)
  ];
  const splits = (a, b, step) => {
    const count = Math.max(1, Math.ceil((b - a) / step));
    return Array.from({ length: count + 1 }, (_, i) => a + (b - a) * i / count);
  };

  const raisedSurfaces = bumps.filter(bump => hasSurface(bump) && bump.height > 0);
  for (const bump of raisedSurfaces) {
    const { frame, footprint, halfLength, halfWidth, ramp, edgeSlope, heightAt, baseAt } = bumpSurface(bump);
    const planes = bumpPlanes.get(bump.id);
    const top = points => {
      quad(asphalt, bump, points);
      if (planes) {
        planes.push([points[0], points[1], points[2]]);
        if (points.length === 4) planes.push([points[0], points[2], points[3]]);
      }
    };
    const sParts = splits(-halfLength, halfLength, Math.max(0.8, halfLength / 6));
    const tParts = splits(-halfWidth, halfWidth, 2.8);
    if (bump.profile === 'table') sParts.push(-halfLength + ramp, halfLength - ramp);
    if (bump.profile === 'cushion') tParts.push(-halfWidth + edgeSlope, halfWidth - edgeSlope);
    sParts.sort((a, b) => a - b);
    tParts.sort((a, b) => a - b);
    if (footprint) {
      splitFootprint(footprint, [sParts, tParts], (...points) => {
        top(points.map(([s, t]) => surfacePoint(frame, heightAt, s, t)));
      });
      const signed = footprint.reduce((sum, [s, t], i) => {
        const [a, b] = footprint[(i + 1) % footprint.length];
        return sum + s * b - t * a;
      }, 0);
      footprint.forEach(([s, t], i) => {
        const [a, b] = footprint[(i + 1) % footprint.length];
        const span = Math.hypot(a - s, b - t);
        if (span < 1e-5) return;
        const sections = splits(0, 1, 0.8 / span);
        const point = (height, u) => surfacePoint(frame, height, s + (a - s) * u, t + (b - t) * u);
        for (let j = 1; j < sections.length; j++) {
          const p = sections[j - 1], q = sections[j];
          const face = [point(baseAt, p), point(baseAt, q), point(heightAt, q), point(heightAt, p)];
          if (signed > 0) face.reverse();
          quad(asphalt, bump, face);
        }
      });
      continue;
    }
    for (let i = 1; i < sParts.length; i++) {
      const a = sParts[i - 1], b = sParts[i];
      if (b - a < 1e-5) continue;
      for (let j = 1; j < tParts.length; j++) {
        if (tParts[j] - tParts[j - 1] > 1e-5) top(rectangle(frame, heightAt, a, b, tParts[j - 1], tParts[j]));
      }
      if (bump.profile === 'cushion') continue;
      for (const t of [-halfWidth, halfWidth]) {
        const points = [surfacePoint(frame, baseAt, a, t), surfacePoint(frame, heightAt, a, t),
          surfacePoint(frame, heightAt, b, t), surfacePoint(frame, baseAt, b, t)];
        if (t > 0) points.reverse();
        quad(asphalt, bump, points);
      }
    }
  }

  for (const crossing of strips) {
    const frame = crossingFrame(crossing);
    const heightAt = (x, z) => surfaceHeight(crossing, x, z) + ROAD_LIFT + PAINT_LIFT;
    // Clip paint to the actual raised triangles so it follows a skew or irregular ramp edge exactly.
    const planes = bumpPlanes.get(crossing.bumpId)?.map(triangle => triangle.map(([x, y, z]) => {
      const t = frame.across(x, z);
      return [frame.along(x, z) - frame.alongAt(t), t, y];
    })) ?? [];
    const skewedFrame = { at: (s, t) => frame.at(s + frame.alongAt(t), t) };
    const count = Math.max(1, Math.round((frame.t1 - frame.t0) / 1.05));
    const pitch = (frame.t1 - frame.t0) / count, half = Math.min(0.27, pitch * 0.29);
    const s = splits(-crossing.length / 2, crossing.length / 2, 0.25);
    for (let i = 0; i < count; i++) {
      const middle = frame.t0 + pitch * (i + 0.5);
      const left = middle - half, right = middle + half;
      for (let j = 1; j < s.length; j++) {
        quad(paint, crossing, rectangle(skewedFrame, heightAt, s[j - 1], s[j], left, right));
      }
      for (const triangle of planes) {
        let band = clipRing(triangle, 0, s[0], 1);
        band = clipRing(band, 0, s.at(-1), -1);
        band = clipRing(band, 1, left, 1);
        band = clipRing(band, 1, right, -1);
        if (band.length < 3) continue;
        const vertices = band.map(([s, t, y]) => {
          const [x, z] = skewedFrame.at(s, t);
          return [x, y + PAINT_LIFT, z];
        });
        for (let j = 2; j < vertices.length; j++) quad(paint, crossing, [vertices[0], vertices[j - 1], vertices[j]]);
      }
    }
  }
  return { marked, strips, raisedSurfaces };
}

async function loadFaceAtlas() {
  const metadataUrl = new URL('../assets/ede-street-sign-faces.json', import.meta.url);
  const imageUrl = new URL('../assets/ede-street-sign-faces.png', import.meta.url);
  const [metadata, map] = await Promise.all([
    fetch(metadataUrl).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${metadataUrl.pathname}`);
      return response.json();
    }),
    new THREE.TextureLoader().loadAsync(imageUrl.href)
  ]);
  if (metadata.width !== map.image.width || metadata.height !== map.image.height || !metadata.frames) {
    map.dispose();
    throw new Error('Ede sign atlas dimensions disagree');
  }
  map.colorSpace = THREE.SRGBColorSpace;
  map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false;
  return { ...metadata, map };
}

function labelAtlas(labels) {
  if (!labels.size) return null;
  const columns = 8, width = 248, height = 80, scale = 0.75;
  const canvas = document.createElement('canvas');
  canvas.width = columns * width * scale;
  canvas.height = Math.ceil(labels.size / columns) * height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const frames = new Map();
  let i = 0;
  for (const [key, { label, blue }] of labels) {
    const x = (i % columns) * width + 3, y = Math.floor(i / columns) * height + 3;
    i++;
    frames.set(key, [x * scale, y * scale, (width - 6) * scale, (height - 6) * scale]);
    ctx.fillStyle = blue ? '#154887' : '#f6f4ed';
    ctx.fillRect(x, y, width - 6, height - 6);
    ctx.strokeStyle = blue ? '#f4f5f4' : '#252525';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, width - 12, height - 12);
    ctx.font = 'bold 25px Arial, sans-serif';
    const lines = [''];
    for (const word of label.split(/\s+/)) {
      const line = lines.at(-1);
      const candidate = line ? `${line} ${word}` : word;
      if (line && lines.length < 3 && ctx.measureText(candidate).width > width - 22) lines.push(word);
      else lines[lines.length - 1] = candidate;
    }
    const font = Math.min(30, 60 / lines.length);
    ctx.font = `bold ${font}px Arial, sans-serif`;
    ctx.fillStyle = ctx.strokeStyle;
    lines.forEach((line, j) => ctx.fillText(line, x + (width - 6) / 2,
      y + (height - 6) / 2 + (j - (lines.length - 1) / 2) * font, width - 22));
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false;
  return { width: canvas.width, height: canvas.height, frames, map };
}

function signBearing(sign) {
  if (Number.isFinite(sign.bearing)) {
    // Survey headings use degrees clockwise from north, which is world -Z.
    const angle = sign.bearing * Math.PI / 180;
    return [Math.sin(angle), -Math.cos(angle)];
  }
  const road = nearestEdeRoad(sign.x, sign.z, 18);
  if (!road) return [0, -1];
  if (sign.kind !== 'traffic') {
    const offset = road.uz * (road.x - sign.x) - road.ux * (road.z - sign.z);
    const side = Math.sign(offset) || 1;
    return [road.uz * side, -road.ux * side];
  }
  const right = (sign.z - road.z) * road.ux - (sign.x - road.x) * road.uz;
  const side = road.road.oneway || right >= 0 ? -1 : 1;
  return [road.ux * side, road.uz * side];
}

function signMaterials(map) {
  const front = new THREE.MeshStandardNodeMaterial({ map, alphaTest: 0.45, roughness: 0.72 });
  const back = new THREE.MeshStandardNodeMaterial({ color: 0x70777c, alphaTest: 0.45, metalness: 0.32, roughness: 0.76 });
  back.opacityNode = texture(map).a;
  return { front, back };
}

function collectSigns(signs, atlas, quad, batch) {
  const labels = new Map(), poles = new Map();
  const addLabel = (label, blue = false) => {
    if (typeof label !== 'string' || !label.trim() || /onleesbaar/i.test(label)) return;
    const key = `${blue}/${label.trim()}`;
    labels.set(key, { label: label.trim(), blue });
    return key;
  };
  for (const sign of signs) {
    const official = atlas?.frames[sign.faceKey];
    const label = !official && addLabel(sign.label ?? sign.text, sign.kind !== 'traffic');
    if (!official && !label) continue;
    const plates = [];
    for (const extra of sign.supplementarySigns || []) {
      const region = atlas?.frames[extra.faceKey];
      const text = !region && addLabel(typeof extra === 'string' ? extra : extra.text ?? extra.label);
      if (region || text) plates.push({ region, text });
    }
    const key = `${Math.round(sign.x * 5)}/${Math.round(sign.z * 5)}/${layerOf(sign)}/${sign.placement ?? 'ALONG'}`;
    if (!poles.has(key)) poles.set(key, []);
    poles.get(key).push({ sign, official, label, plates });
  }
  if (!poles.size) return 0;
  const labelsAtlas = labelAtlas(labels);
  const officialMaterials = atlas && signMaterials(atlas.map);
  const labelMaterials = labelsAtlas && signMaterials(labelsAtlas.map);
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x767e83, metalness: 0.5, roughness: 0.63 });
  const tube = new THREE.CylinderGeometry(0.031, 0.039, 1, 7).translate(0, 0.5, 0);
  const { position, normal } = tube.attributes;
  const up = new THREE.Vector3(0, 1, 0), along = new THREE.Vector3(), vertex = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  function tubeBetween(pile, a, b, radiusScale) {
    const length = along.fromArray(b).sub(vertex.fromArray(a)).length();
    if (length < 0.01) return;
    rotation.setFromUnitVectors(up, along.normalize());
    scale.set(radiusScale, length, radiusScale);
    for (const i of tube.index.array) {
      vertex.fromBufferAttribute(position, i).multiply(scale).applyQuaternion(rotation);
      pile.positions.push(a[0] + vertex.x, a[1] + vertex.y, a[2] + vertex.z);
      vertex.fromBufferAttribute(normal, i).applyQuaternion(rotation);
      pile.normals.push(vertex.x, vertex.y, vertex.z);
    }
  }

  function board(sign, [nx, nz], y, frame, library, materials, maxWidth, maxHeight, depth) {
    const [x, t, w, h] = frame;
    const scale = Math.min(maxWidth / w, maxHeight / h);
    const hw = w * scale / 2, hh = h * scale / 2;
    const u0 = x / library.width, u1 = (x + w) / library.width;
    const v0 = 1 - (t + h) / library.height, v1 = 1 - t / library.height;
    const points = (offset) => [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) =>
      [sign.x + nz * a + nx * offset, y + b, sign.z - nx * a + nz * offset]);
    quad(materials.front, sign, points(depth), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    quad(materials.back, sign, points(depth - 0.014).reverse(), [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
  }

  let count = 0;
  for (const boards of poles.values()) {
    const { sign: post } = boards[0];
    const ground = surfaceHeight(post, post.x, post.z, 3.5);
    const overhead = post.placement === 'ABOVE';
    const grade = overhead ? gradeWayAt(wayOf(post), post.x, post.z, 3.5) : null;
    const profile = grade?.span?.profile;
    const at = grade?.span?.at + grade?.along;
    const portal = profile?.site.kind === 'underpass' && profile.covers.some(([low, high]) => at >= low - 2 && at <= high + 2);
    const roof = portal ? (profile.clearance || profile.site.clearance || 3) : undefined;
    const clearance = post.rvvCode === 'C19' ? Number.parseFloat(String(post.blackCode ?? '').replace(',', '.')) : NaN;
    const mount = portal ? roof - 0.73 - boards[0].plates.length * 0.245
      : overhead ? (Number.isFinite(clearance) ? Math.max(2.4, clearance + 0.1) : 5.2) : 1.8;
    const depth = portal ? 0.3 : 0.055;
    const directions = new Map();
    let top = 2.25;
    for (const { sign, official, label, plates } of boards) {
      const forward = signBearing(sign);
      const direction = Math.round(Math.atan2(...forward) * 6);
      const deck = directions.get(direction) ?? mount;
      const mainHeight = official ? 0.66 : 0.3;
      const mainY = ground + deck + mainHeight / 2 + plates.length * 0.245;
      if (official) board(sign, forward, mainY, official, atlas, officialMaterials, 0.88, mainHeight, depth);
      else board(sign, forward, mainY, labelsAtlas.frames.get(label), labelsAtlas, labelMaterials, 1.35, mainHeight, depth);
      for (const [i, { region, text }] of plates.entries()) {
        const py = mainY - mainHeight / 2 - 0.135 - i * 0.245;
        if (region) board(sign, forward, py, region, atlas, officialMaterials, 0.64, 0.22, depth);
        else board(sign, forward, py, labelsAtlas.frames.get(text), labelsAtlas, labelMaterials, 0.7, 0.22, depth);
      }
      const end = mainY - ground + mainHeight / 2;
      directions.set(direction, end + 0.055);
      top = Math.max(top, end - 0.035);
      count++;
    }
    const pile = batch(steel, post);
    let x = post.x, z = post.z;
    if (portal) {
      const [nx, nz] = signBearing(post);
      tubeBetween(pile, [x + nx * (depth - 0.04), ground + top - 0.19, z + nz * (depth - 0.04)],
        [x, ground + roof + 0.10, z], 1.7);
      continue;
    }
    if (overhead) {
      const [nx, nz] = signBearing(post);
      const road = nearestEdeRoad(post.x, post.z, 18);
      const [rx, rz] = post.roadPoint && post.nwbDistance < 18 ? post.roadPoint : [road?.x ?? x, road?.z ?? z];
      const offset = (x - rx) * nz - (z - rz) * nx;
      const side = Math.sign(offset) || 1;
      const shift = Math.max(1.2, (road?.width ?? 7) / 2 + 0.9 - Math.abs(offset));
      x += nz * side * shift;
      z -= nx * side * shift;
      const y = ground + top - 0.18;
      tubeBetween(pile, [x, y, z], [post.x, y, post.z], 2.5);
    }
    tubeBetween(pile, [x, surfaceHeight(post, x, z, 3.5), z], [x, ground + top, z], overhead ? 3 : 1);
  }
  tube.dispose();
  return count;
}

export async function buildEdeStreetFeaturesWorld(scene, features) {
  const signs = features.signs ?? [];
  let atlas;
  if (signs.some(sign => sign.faceKey)) {
    try {
      atlas = await loadFaceAtlas();
    } catch (error) {
      console.warn('[street features] RVV face atlas unavailable:', error);
    }
  }
  const group = new THREE.Group();
  group.name = 'EdeStreetFeatures';
  const batches = new Map();
  const firstMesh = new Map();
  function batch(material, { x, z }) {
    const key = `${material.id}/${Math.floor(x / CELL)}/${Math.floor(z / CELL)}`;
    if (!batches.has(key)) batches.set(key, { material, positions: [], normals: [], uv: [] });
    return batches.get(key);
  }
  function quad(material, feature, points, uvs) {
    const output = batch(material, feature);
    for (const i of points.length === 3 ? [0, 1, 2] : TRIANGLES) {
      output.positions.push(...points[i]);
      if (uvs) output.uv.push(...uvs[i]);
    }
  }
  const { marked, strips, raisedSurfaces } = collectRoadSurfaces(features, quad);
  const signsDrawn = collectSigns(signs, atlas, quad, batch);

  for (const { material, positions, normals, uv } of batches.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (uv.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (normals.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'EdeStreetFeaturesChunk';
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = uv.length || normals.length ? 380 : 620;
    if (firstMesh.has(material)) mesh.userData.sharesPipelineWith = firstMesh.get(material);
    else firstMesh.set(material, mesh);
    group.add(mesh);
  }
  group.userData = { signs: signsDrawn, bumps: raisedSurfaces.length, crossings: marked.length, batches: batches.size };
  scene.add(group);
  return { group, replacesZebra: createZebraLookup(strips) };
}
