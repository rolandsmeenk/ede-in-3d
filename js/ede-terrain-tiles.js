import * as THREE from 'three/webgpu';
import { attribute, mix } from 'three/tsl';
import { sampleGroundColor } from './aerial-colors.js';
import { cityUniforms, heathBloomColor } from './tsl-materials.js';
import { expansionSeamOffset, getExpansionTerrain, getTerrain, sampleTerrain } from './terrain.js';

const SIDE = 51;
const OVERVIEW_SIDE = 13;
const MAX_LOADS = 4;
const MAX_GEOMETRY_BYTES = 40 * 1024 * 1024;
const MAX_ACTIVE_TILES = 112;
const linear = Float32Array.from({ length: 256 }, (_, i) => THREE.ColorManagement.convert(
  new THREE.Color().setScalar(i / 255), THREE.SRGBColorSpace, THREE.LinearSRGBColorSpace
).r);

// An overview can be coarser than its baked root. Bound its edge error
// against the 5 m field at both sets of interpolation knots.
function overviewEdgeError(sample, start, end, step) {
  const intervals = OVERVIEW_SIDE - 1;
  const samples = Array.from({ length: OVERVIEW_SIDE }, (_, i) => sample(start + (end - start) * i / intervals));
  let error = 0;
  for (let at = start; at <= end; at += step) {
    const pos = (at - start) * intervals / (end - start);
    const i = Math.min(intervals - 1, Math.floor(pos));
    const height = samples[i] + (samples[i + 1] - samples[i]) * (pos - i);
    error = Math.max(error, Math.abs(sample(at) - height));
  }
  return error;
}

export function sizeTerrainSkirts(nodes, roots, field) {
  const rootSet = new Set(roots);
  const lines = new Map();
  for (const node of nodes) {
    const [west, north, east, south] = node.bounds;
    const borders = [
      [true, north, west, east], [false, east, north, south],
      [true, south, west, east], [false, west, north, south],
    ];
    node.skirts = [3, 3, 3, 3];
    for (const [edge, [horizontal, fixed, start, end]] of borders.entries()) {
      const key = horizontal ? `z/${fixed}` : `x/${fixed}`;
      if (!lines.has(key)) lines.set(key, [[], []]);
      const error = rootSet.has(node) ? Math.max(node.error, overviewEdgeError(
        at => horizontal ? sampleTerrain(field, at, fixed) : sampleTerrain(field, fixed, at),
        start, end, field.step
      )) : node.error;
      lines.get(key)[edge < 2 ? 0 : 1].push({ node, edge, start, end, error });
    }
  }
  for (const [oneSide, otherSide] of lines.values()) {
    for (const a of oneSide) for (const b of otherSide) {
      if (Math.max(a.start, b.start) >= Math.min(a.end, b.end)) continue;
      // Either neighbour can be the higher one. Include the seam adjustment and quantization.
      const depth = a.error + b.error + 3;
      a.node.skirts[a.edge] = Math.max(a.node.skirts[a.edge], depth);
      b.node.skirts[b.edge] = Math.max(b.node.skirts[b.edge], depth);
    }
  }
}

export function tileGeometry(bytes, tile, legacy, field, side = SIDE) {
  if (bytes.byteLength !== side * side * 5) throw new Error('Invalid AHN terrain tile size');
  const view = new DataView(bytes);
  const [minX, minZ, maxX, maxZ] = tile.bounds;
  const bakeLinear = side === SIDE;
  const detail = bakeLinear ? tile.detail : null;
  if (detail) side = (maxX - minX) / detail.step + 1;
  const step = (maxX - minX) / (side - 1);
  const positions = [], colors = [], indices = [];
  const decodeColor = value => bakeLinear ? Math.round(linear[value] * 255) : value;
  function vertex(x, y, z, r, g, b) {
    const index = positions.length / 3;
    positions.push(x, y - 0.025, z);
    colors.push(r, g, b, 255);
    return index;
  }
  if (detail) {
    // Match the existing aerial palette and triangle interpolation at tile edges.
    const ratio = (SIDE - 1) / (side - 1);
    const start = (minZ - detail.minZ) / step * detail.columns + (minX - detail.minX) / step;
    const colorAt = (index, band) => decodeColor(view.getUint8(index * 5 + band));
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const cx = Math.min(SIDE - 2, Math.floor(x * ratio)), cz = Math.min(SIDE - 2, Math.floor(z * ratio));
      const u = x * ratio - cx, v = z * ratio - cz;
      const index = cz * SIDE + cx;
      const color = band => {
        const b = colorAt(index + 1, band), c = colorAt(index + SIDE, band);
        const fromLower = u + v <= 1;
        const a = colorAt(fromLower ? index : index + SIDE + 1, band);
        return Math.round(fromLower ? a + (b - a) * u + (c - a) * v : a + (c - a) * (1 - u) + (b - a) * (1 - v));
      };
      vertex(minX + x * step, detail.heights[start + z * detail.columns + x], minZ + z * step, color(2), color(3), color(4));
    }
  } else {
    for (let z = 0, i = 0; z < side; z++) for (let x = 0; x < side; x++, i += 5) {
      const worldX = minX + x * step, worldZ = minZ + z * step;
      const elevation = (view.getInt16(i, true) - Math.round(field.napOrigin * 100)) / 100;
      vertex(worldX, elevation + expansionSeamOffset(worldX, worldZ),
        worldZ, decodeColor(view.getUint8(i + 2)),
        decodeColor(view.getUint8(i + 3)), decodeColor(view.getUint8(i + 4)));
    }
  }

  const pointAt = i => [positions[i * 3], positions[i * 3 + 1] + 0.025, positions[i * 3 + 2],
    colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2]];

  // The retained town rectangle owns its original grid and surveyed grades.
  const insideLegacy = (x, z) => x > legacy.minX && x < legacy.maxX && z > legacy.minZ && z < legacy.maxZ;
  const trim = minX < legacy.maxX && maxX > legacy.minX && minZ < legacy.maxZ && maxZ > legacy.minZ;
  const clip = (polygon, axis, edge, direction) => {
    const out = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = (a[axis] - edge) * direction, db = (b[axis] - edge) * direction;
      if (da >= 0) out.push(a);
      if ((da < 0) !== (db < 0)) {
        const t = da / (da - db);
        out.push(a.map((value, j) => value + (b[j] - value) * t));
      }
    }
    return out;
  };
  const planes = [[0, legacy.minX, 1], [0, legacy.maxX, -1], [2, legacy.minZ, 1], [2, legacy.maxZ, -1]];
  const edgeVertex = ([x, y, z, r, g, b]) => {
    if (x >= legacy.minX && x <= legacy.maxX && z >= legacy.minZ && z <= legacy.maxZ) {
      y = sampleTerrain(legacy, x, z);
    }
    return vertex(x, y, z, Math.round(r), Math.round(g), Math.round(b));
  };
  function triangle(a, b, c) {
    if (!trim) {
      indices.push(a, b, c);
      return;
    }
    const points = [a, b, c].map(pointAt);
    const outsideLegacy = planes.some(([axis, edge, sign]) => points.every(p => (p[axis] - edge) * sign <= 0));
    if (outsideLegacy) {
      indices.push(a, b, c);
      return;
    }
    if (points.every(([x, , z]) => insideLegacy(x, z))) return;
    let inside = points;
    for (const [axis, edge, direction] of planes) {
      const outside = clip(inside, axis, edge, -direction);
      if (outside.length >= 3) {
        const vertices = outside.map(edgeVertex);
        for (let i = 1; i + 1 < vertices.length; i++) indices.push(vertices[0], vertices[i], vertices[i + 1]);
      }
      inside = clip(inside, axis, edge, direction);
      if (inside.length < 3) break;
    }
  }
  for (let z = 0; z < side - 1; z++) for (let x = 0; x < side - 1; x++) {
    const a = z * side + x;
    triangle(a, a + side, a + 1);
    triangle(a + 1, a + side, a + side + 1);
  }

  // Skirt faces point toward the lower neighbour. Separate vertices keep
  // their normals out of the top surface shading.
  const perimeter = [
    Array.from({ length: side }, (_, i) => i),
    Array.from({ length: side }, (_, i) => i * side + side - 1),
    Array.from({ length: side }, (_, i) => side * side - 1 - i),
    Array.from({ length: side }, (_, i) => (side - 1 - i) * side),
  ];
  for (const [edgeIndex, edge] of perimeter.entries()) {
    const depth = tile.skirts[edgeIndex], axis = edgeIndex % 2 === 0 ? 0 : 2;
    const fixed = pointAt(edge[0])[2 - axis];
    const [start, end] = axis === 0 ? [legacy.minX, legacy.maxX] : [legacy.minZ, legacy.maxZ];
    const clipToTown = axis === 0 ? fixed > legacy.minZ && fixed < legacy.maxZ
      : fixed > legacy.minX && fixed < legacy.maxX;
    let lastPoint, lastPair;
    const addPair = ([x, y, z, r, g, b]) =>
      [vertex(x, y, z, r, g, b), vertex(x, y - depth, z, r, g, b)];
    function addSkirt(a, b) {
      if (a[axis] === b[axis]) return;
      const [topA, downA] = a[axis] === lastPoint ? lastPair : addPair(a);
      const [topB, downB] = addPair(b);
      indices.push(topA, topB, downA, downA, topB, downB);
      lastPoint = b[axis];
      lastPair = [topB, downB];
    }
    for (let i = 1; i < side; i++) {
      const a = pointAt(edge[i - 1]), b = pointAt(edge[i]);
      if (!clipToTown || Math.max(a[axis], b[axis]) <= start || Math.min(a[axis], b[axis]) >= end) {
        addSkirt(a, b);
        continue;
      }
      const clipEdge = (a, b, limit) => {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        const point = a.map((value, j) => value + t * (b[j] - value));
        point[axis] = limit;
        point[1] = sampleTerrain(legacy, point[0], point[2]);
        return point;
      };
      if (a[axis] < start || a[axis] > end) addSkirt(a, clipEdge(a, b, a[axis] < start ? start : end));
      if (b[axis] < start || b[axis] > end) addSkirt(clipEdge(b, a, b[axis] < start ? start : end), b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(colors, 4, true));
  const uv = new Float32Array(positions.length / 3 * 2);
  for (let i = 0; i < uv.length / 2; i++) {
    uv[i * 2] = positions[i * 3];
    uv[i * 2 + 1] = -positions[i * 3 + 2];
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createTerrainTiles(scene, heath) {
  const data = getExpansionTerrain();
  if (!data) return null;
  const { manifest, field, directory, detail } = data;
  const legacy = getTerrain();
  const nodes = new Map(Object.entries(manifest.tiles).map(([id, tile]) => [id, { ...tile, id }]));
  if (detail) {
    for (const tile of nodes.values()) {
      const [w, n, e, s] = tile.bounds;
      if (e - w === 250 && w >= detail.minX && n >= detail.minZ && e <= detail.maxX && s <= detail.maxZ) {
        tile.detail = detail;
      }
    }
  }
  const roots = manifest.roots.map(id => nodes.get(id));
  sizeTerrainSkirts(nodes.values(), roots, field);
  const group = new THREE.Group();
  group.name = 'EdeTerrainQuadtree';
  scene.add(group);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.93 });
  material.colorNode = heathBloomColor(attribute('color', 'vec4').rgb, heath).mul(mix(1, 0.78, cityUniforms.uRoadWetness));
  material.name = 'PDOK terrain tiles';
  const cameraMatrix = new THREE.Matrix4(), frustum = new THREE.Frustum();
  const box = new THREE.Box3();
  const lastCamera = new THREE.Vector3();
  const stats = { residentBytes: 0, peakResidentBytes: 0, visible: 0, loading: 0,
    collisionBytes: field.heights.byteLength + (detail?.heights.byteLength ?? 0) };
  const resident = new Set(), shown = new Set(), ready = [];
  let pending = 0, stamp = 0;
  function queue(node, now) {
    if (node.mesh || node.loading || node.retry > now || pending >= MAX_LOADS) return;
    node.loading = true;
    pending++;
    fetch(new URL(`${node.id}.bin`, directory)).then(response => {
      if (!response.ok) throw new Error(`AHN tile HTTP ${response.status}`);
      return response.arrayBuffer();
    }).then(buffer => ready.push({ node, buffer })).catch(error => {
      node.retry = performance.now() + 4000;
      node.loading = false;
      pending--;
      console.warn('[AHN terrain tile]', node.id, error);
    });
  }

  function overview(node) {
    if (node.mesh || node.overview) return;
    const [west, north, east, south] = node.bounds;
    const buffer = new ArrayBuffer(OVERVIEW_SIDE ** 2 * 5);
    const view = new DataView(buffer);
    const rgb = [0.14, 0.18, 0.10];
    for (let z = 0, offset = 0; z < OVERVIEW_SIDE; z++) for (let x = 0; x < OVERVIEW_SIDE; x++, offset += 5) {
      const px = west + x * (east - west) / (OVERVIEW_SIDE - 1);
      const pz = north + z * (south - north) / (OVERVIEW_SIDE - 1);
      view.setInt16(offset, Math.round((sampleTerrain(field, px, pz) + field.napOrigin) * 100), true);
      sampleGroundColor(px, pz, rgb);
      for (let j = 0; j < 3; j++) view.setUint8(offset + 2 + j, Math.round(rgb[j] * 255));
    }
    node.overview = new THREE.Mesh(tileGeometry(buffer, node, legacy, field, OVERVIEW_SIDE), material);
    node.overview.visible = false;
    node.overview.receiveShadow = true;
    group.add(node.overview);
  }

  function upload() {
    const job = ready.shift();
    if (!job) return;
    const { node, buffer } = job;
    try {
      const geometry = tileGeometry(buffer, node, legacy, field);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      mesh.visible = false;
      group.add(mesh);
      node.mesh = mesh;
      if (node.overview) {
        group.remove(node.overview);
        node.overview.geometry.dispose();
        node.overview = null;
      }
      node.bytesResident = geometry.index.array.byteLength + Object.values(geometry.attributes)
        .reduce((sum, attr) => sum + attr.array.byteLength, 0);
      resident.add(node);
      stats.residentBytes += node.bytesResident;
      stats.peakResidentBytes = Math.max(stats.peakResidentBytes, stats.residentBytes);
    } catch (error) {
      node.retry = performance.now() + 4000;
      console.warn('[AHN terrain tile]', node.id, error);
    } finally {
      node.loading = false;
      pending--;
    }
  }

  const distanceTo = (bounds, x, z) => Math.hypot(Math.max(bounds[0] - x, 0, x - bounds[2]),
    Math.max(bounds[1] - z, 0, z - bounds[3]));
  function update(camera, viewportHeight) {
    upload();
    stamp++;
    camera.updateMatrixWorld();
    cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(cameraMatrix, camera.coordinateSystem, camera.reversedDepth);
    const { x, y, z } = camera.position;
    const advanceX = THREE.MathUtils.clamp((x - lastCamera.x) * 14, -150, 150);
    const advanceZ = THREE.MathUtils.clamp((z - lastCamera.z) * 14, -150, 150);
    lastCamera.copy(camera.position);
    const near = Math.abs(y - sampleTerrain(field, x, z)) < 120 ? 300 : 180;
    const focal = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const now = performance.now();
    const next = new Set(), wanted = new Map();
    const score = node => distanceTo(node.bounds, x + advanceX, z + advanceZ);
    const desire = (node, priority) => wanted.set(node, Math.min(wanted.get(node) ?? Infinity, priority));
    let createOverview = true;
    function visit(node, root = false) {
      const [west, north, east, south] = node.bounds;
      const horizontal = distanceTo(node.bounds, x, z);
      box.min.set(west, field.minY - 10, north);
      box.max.set(east, field.maxY, south);
      const visible = frustum.intersectsBox(box);
      if (!visible && score(node) > near) return;
      node.used = stamp;
      if (!node.mesh) {
        desire(node, horizontal);
        if (root && visible) {
          if (createOverview && !node.overview) {
            overview(node);
            createOverview = false;
          }
          if (node.overview) next.add(node);
        }
        return;
      }
      const vertical = Math.max(field.minY - y, 0, y - field.maxY);
      const pixels = node.error * focal / Math.max(20, Math.hypot(horizontal, vertical));
      if (node.children?.length && (horizontal < near || pixels > 5) && next.size < MAX_ACTIVE_TILES) {
        const children = node.children.map(id => nodes.get(id)).sort((a, b) => score(a) - score(b));
        for (const child of children) {
          child.used = stamp;
          if (!child.mesh) desire(child, score(child));
        }
        if (children.every(child => child.mesh)) {
          for (const child of children) visit(child);
          return;
        }
      }
      if (visible) next.add(node);
    }
    for (const root of [...roots].sort((a, b) => score(a) - score(b))) visit(root, true);
    for (const [node] of [...wanted].sort((a, b) => a[1] - b[1])) {
      if (pending >= MAX_LOADS) break;
      queue(node, now);
    }
    for (const node of shown) {
      if (!next.has(node)) (node.mesh ?? node.overview).visible = false;
    }
    shown.clear();
    for (const node of next) {
      (node.mesh ?? node.overview).visible = true;
      shown.add(node);
    }
    if (stats.residentBytes > MAX_GEOMETRY_BYTES) {
      const oldest = [...resident].filter(node => !next.has(node) && node.used < stamp - 2).sort((a, b) => a.used - b.used);
      for (const node of oldest) {
        if (stats.residentBytes <= MAX_GEOMETRY_BYTES) break;
        group.remove(node.mesh);
        node.mesh.geometry.dispose();
        node.mesh = null;
        resident.delete(node);
        stats.residentBytes -= node.bytesResident;
      }
    }
    stats.visible = next.size;
    stats.loading = pending;
  }
  return { update, stats };
}
