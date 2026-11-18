// Match appearance to the published BAG identifier and then to a wall plane within the feature.
const bagNumber = (id) => typeof id === 'string' && /^(?:NL\.IMBAG\.Pand\.)?\d{16}$/.test(id)
  ? id.slice(-16) : null;

export async function loadEdeFacades() {
  const response = await fetch(new URL('../assets/ede-facades.json', import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.version !== 1 || !Array.isArray(data.walls)) throw new Error('Invalid Ede façade asset');
  const byId = new Map();
  const walls = data.walls.filter(wall => {
    const id = bagNumber(wall.bagId);
    if (!id || ![wall.a, wall.b].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
        || !Number.isFinite(wall.minY) || !Number.isFinite(wall.height) || wall.height <= 0
        || !Array.isArray(wall.openings)) return false;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(wall);
    return true;
  });
  return { walls, byId };
}

const scalarSize = { UINT8: 1, UINT16: 2, UINT32: 4 };
const readOffset = (view, i, step) => step === 1 ? view.getUint8(i)
  : step === 2 ? view.getUint16(i * 2, true) : view.getUint32(i * 4, true);

export async function readBagFacadeFeatures(gltf, byId) {
  const parser = gltf.parser;
  const tables = parser?.json.extensions?.EXT_structural_metadata?.propertyTables || [];
  const result = await Promise.all(tables.map(async ({ count, properties }) => {
    const named = properties.identificatie;
    const step = scalarSize[named?.stringOffsetType ?? 'UINT32'];
    if (named?.stringOffsets === undefined || !step) return new Map();
    const [values, offsets] = await Promise.all([named.values, named.stringOffsets]
      .map(i => parser.getDependency('bufferView', i)));
    if ((count + 1) * step > offsets.byteLength) return new Map();
    const view = new DataView(offsets), ids = new Uint8Array(values);
    const decoder = new TextDecoder();
    const found = new Map();
    for (let i = 0; i < count; i++) {
      const start = readOffset(view, i, step), end = readOffset(view, i + 1, step);
      if (!(end > start && end <= ids.length)) continue;
      const number = bagNumber(decoder.decode(ids.subarray(start, end)));
      const walls = byId.get(number);
      if (walls) found.set(i, walls);
    }
    return found;
  }));
  return result;
}

export function meshBagFacadeFeatures(gltf, mesh, tables) {
  const ext = mesh.userData?.gltfExtensions?.EXT_mesh_features;
  const assoc = gltf.parser?.associations?.get(mesh);
  const definition = gltf.parser?.json.meshes?.[assoc?.meshes]?.primitives?.[assoc?.primitives];
  const feature = (ext ?? definition?.extensions?.EXT_mesh_features)?.featureIds?.find(f => f.attribute === 0);
  return tables[feature?.propertyTable ?? (tables.length === 1 ? 0 : -1)];
}

export function facadeFrame(wall, baseY) {
  const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1];
  const width = Math.hypot(dx, dz);
  return {
    wall, width, tx: dx / width, tz: dz / width, nx: -dz / width, nz: dx / width,
    y: Number.isFinite(wall.baseOffset) ? baseY + wall.baseOffset : wall.minY,
    x: wall.a[0], z: wall.a[1]
  };
}

function wallCoordinates(frame, [x, y, z]) {
  const dx = x - frame.x, dz = z - frame.z;
  return [dx * frame.tx + dz * frame.tz, y - frame.y, dx * frame.nx + dz * frame.nz];
}

export function matchBagWall(frames, points, normal) {
  let best = 0.4, found;
  for (const frame of frames) {
    if (normal[0] * frame.nx + normal[2] * frame.nz < 0.86) continue;
    const verts = points.map(point => wallCoordinates(frame, point));
    if (verts.some(([u, v]) => u < -0.35 || u > frame.width + 0.35 || v < -0.40 || v > frame.wall.height + 0.40)) continue;
    const distance = Math.max(...verts.map((point) => Math.abs(point[2])));
    if (distance >= best) continue;
    best = distance;
    found = { frame, verts };
  }
  return found;
}

function faceNormal([a, b, c]) {
  const [u, v, w] = b.map((n, i) => n - a[i]);
  const [x, y, z] = c.map((n, i) => n - a[i]);
  const cross = [v * z - w * y, w * x - u * z, u * y - v * x];
  const length = Math.hypot(...cross);
  if (length < 1e-6 || Math.abs(cross[1]) > length * 0.15) return null;
  return cross.map(n => n / length);
}

// Partition a wall triangle into the opening and the remaining faces in its local plane.
export function cutFacadeOpening(triangle, { x, y, width, height }) {
  let inside = triangle;
  const outside = [];
  for (const [axis, limit, side] of [[0, x, 1], [0, x + width, -1], [1, y, 1], [1, y + height, -1]]) {
    if (inside.length < 3) break;
    const kept = [], removed = [];
    let a = inside.at(-1), da = side * (a.local[axis] - limit);
    for (const b of inside) {
      const db = side * (b.local[axis] - limit);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        const interpolate = (key) => a[key].map((n, i) => n + (b[key][i] - n) * t);
        const point = { local: interpolate('local'), position: interpolate('position') };
        kept.push(point);
        removed.push(point);
      }
      (db >= 0 ? kept : removed).push(b);
      a = b; da = db;
    }
    inside = kept;
    if (removed.length >= 3) outside.push(removed);
  }
  return { inside, outside };
}

const localArea = polygon => Math.abs(polygon.reduce((sum, { local: [x, y] }, i) => {
  const [bx, by] = polygon[(i + 1) % polygon.length].local;
  return sum + x * by - y * bx;
}, 0)) * 0.5;

export function facadePoint(frame, u, v, offset = 0) {
  return [frame.x + u * frame.tx + offset * frame.nx, frame.y + v,
    frame.z + u * frame.tz + offset * frame.nz];
}

export function applyBagFacades(geometry, featureIds, targets, ground, atlas, projectUv, linearColor) {
  const { position, normal, color, buildingHeight } = geometry.attributes;
  const originalCount = position.count;
  const input = geometry.index?.array;
  const count = input?.length ?? originalCount;
  const index = i => input ? input[i] : i;
  const positionAt = i => [position.getX(i), position.getY(i), position.getZ(i)];
  const frames = new Map(), groups = new Map();
  for (const [id, walls] of targets) frames.set(id, walls.map(wall => facadeFrame(wall, ground.get(id)))
    .filter(frame => frame.width > 0 && atlas.rects.has(frame.wall)));
  for (let i = 0; i + 2 < count; i += 3) {
    const first = index(i);
    if (first >= featureIds.count) continue;
    const feature = Math.round(featureIds.getX(first));
    if (!frames.has(feature)) continue;
    const second = index(i + 1), third = index(i + 2);
    if (second >= featureIds.count || third >= featureIds.count ||
      Math.round(featureIds.getX(second)) !== feature || Math.round(featureIds.getX(third)) !== feature) continue;
    const ids = [first, second, third];
    const points = ids.map(positionAt);
    const surfaceNormal = faceNormal(points);
    const match = surfaceNormal && matchBagWall(frames.get(feature), points, surfaceNormal);
    if (!match) continue;
    const { frame, verts } = match;
    if (!groups.has(frame)) groups.set(frame, []);
    groups.get(frame).push({ i, ids, points, verts });
  }
  if (!groups.size) return null;

  const nextIndex = Uint32Array.from(input ?? { length: count }, (value, i) => input ? value : i);
  const extraIndex = [];
  const added = { position: [], normal: [], color: [], buildingHeight: [], facadeUv: [] };
  const panels = [];
  const matched = [];
  let recesses = 0;
  const add = (point, norm, rgb, height, uv) => {
    const id = originalCount + added.buildingHeight.length;
    added.position.push(...point); added.normal.push(...norm); added.color.push(...rgb);
    added.buildingHeight.push(height); added.facadeUv.push(...uv);
    return id;
  };
  function fan(vertices) {
    for (let i = 1; i + 1 < vertices.length; i++) extraIndex.push(vertices[0], vertices[i], vertices[i + 1]);
  }
  for (const [frame, triangles] of groups) {
    const { wall, nx, nz, tx, tz } = frame;
    const wallColor = linearColor(wall.wallColor);
    const rect = atlas.rects.get(wall), newId = new Map();
    const uv = point => projectUv(wall, rect, ...point, frame.y);
    const frontNormal = [nx, 0, nz];
    const vertexColor = i => wallColor ?? [color.getX(i), color.getY(i), color.getZ(i)];
    const base = buildingHeight.getX(triangles[0].ids[0]) - triangles[0].verts[0][1];
    const opening = wall.openings[wall.detail?.opening];
    const depth = wall.detail?.depth;
    const physical = opening && wall.status === 'observed' && depth >= 0.08 && depth <= 1.5
      && opening.x >= 0.02 && opening.x + opening.width <= frame.width - 0.02
      && opening.y >= 0 && opening.y + opening.height <= wall.height - 0.03;
    const clipped = physical ? triangles.map(({ points, verts }) =>
      cutFacadeOpening(points.map((position, j) => ({ position, local: verts[j] })), opening)) : [];
    const cut = physical && clipped.reduce((sum, p) => sum + localArea(p.inside), 0) >= opening.width * opening.height * 0.97;
    const offset = triangles[0].verts.reduce((sum, [, , d]) => sum + d, 0) / 3;
    for (let k = 0; k < triangles.length; k++) {
      const { i, ids, points } = triangles[k];
      const piece = cut && clipped[k];
      if (piece && localArea(piece.inside) > 1e-5) {
        nextIndex.set([ids[0], ids[0], ids[0]], i);
        const rgb = vertexColor(ids[0]);
        for (const fragment of piece.outside) fan(fragment.map(p =>
          add(p.position, frontNormal, rgb, base + p.local[1], uv(p.position))));
        fan(piece.inside.map(p => {
          const position = [p.position[0] - nx * depth, p.position[1], p.position[2] - nz * depth];
          return add(position, frontNormal, rgb, base + p.local[1], uv(p.position));
        }));
      } else {
        for (let j = 0; j < 3; j++) {
          const id = ids[j], point = points[j];
          if (!newId.has(id)) newId.set(id, add(point, [normal.getX(id), normal.getY(id), normal.getZ(id)],
            vertexColor(id), buildingHeight.getX(id), uv(point)));
          nextIndex[i + j] = newId.get(id);
        }
      }
    }
    if (cut) {
      recesses++;
      const { x, y, width, height } = opening;
      const rgb = vertexColor(triangles[0].ids[0]).map(c => c * 0.74);
      const quad = (corners, norm, color) => {
        const ids = corners.map(([u, v, d]) => add(facadePoint(frame, u, v, offset + d), norm, color, base + v, [0, 0, 1]));
        fan(ids); fan([...ids].reverse()); // Reveal planes face the opening from both traversal directions.
      };
      const jamb = (u, norm) => quad([[u,y,0],[u,y+height,0],[u,y+height,-depth],[u,y,-depth]], norm, rgb);
      const cross = (v, ny) => quad([[x,v,0],[x+width,v,0],[x+width,v,-depth],[x,v,-depth]], [0, ny, 0], rgb);
      jamb(x, [tx,0,tz]); jamb(x+width, [-tx,0,-tz]); cross(y, 1); cross(y+height, -1);
      const trim = Math.min(wall.detail.surround || 0, 0.30, x, frame.width - x - width, wall.height - y - height);
      if (trim > 0.015) {
        const strip = (left, bottom, right, top) => quad([[left,bottom,0.045],[right,bottom,0.045],
          [right,top,0.045],[left,top,0.045]], frontNormal, rgb.map(c => c * 1.14));
        strip(x-trim,y,x,y+height); strip(x+width,y,x+width+trim,y+height);
        strip(x-trim,y+height,x+width+trim,y+height+trim);
      }
    }
    for (const photo of wall.photos || []) panels.push({ frame, offset: offset - (cut && photo.recessed ? depth : 0), photo });
    matched.push(wall);
  }
  const BufferAttribute = position.constructor, finalCount = originalCount + added.buildingHeight.length;
  for (const [name, values] of Object.entries(added)) {
    const old = geometry.attributes[name];
    const stride = old?.itemSize ?? 3;
    const combined = new Float32Array(finalCount * stride);
    if (old) combined.set(old.array);
    combined.set(values, originalCount * stride);
    geometry.setAttribute(name, new BufferAttribute(combined, stride));
  }
  const Index = finalCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new Index(nextIndex.length + extraIndex.length);
  indices.set(nextIndex); indices.set(extraIndex, nextIndex.length);
  geometry.setIndex(new BufferAttribute(indices, 1));
  return { matched, recesses, panels };
}
