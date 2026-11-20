// Match appearance to the published BAG identifier and then to a wall plane within the feature.
const bagNumber = (id) => typeof id === 'string' && /^(?:NL\.IMBAG\.Pand\.)?\d{16}$/.test(id)
  ? id.slice(-16) : null;

function indexWalls(walls) {
  const byId = new Map();
  for (const wall of walls ?? []) {
    const id = bagNumber(wall.bagId);
    if (!id || ![wall.a, wall.b].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
        || !Number.isFinite(wall.minY) || !Number.isFinite(wall.height) || wall.height <= 0
        || !Array.isArray(wall.openings)) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(wall);
  }
  return byId;
}

export const isMotorwayFacade = wall => Boolean(wall.a12 || wall.motorway);

let facadeIndex;

async function readFacadePayload(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = new Response(bytes);
  return (bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body).json();
}

export async function loadEdeMotorwayFallbacks() {
  const corridors = await Promise.all(['a12', 'a30'].map(async motorway => {
    try {
      const response = await fetch(new URL(`../assets/ede-${motorway}-fallbacks.json.gz`, import.meta.url));
      const data = await readFacadePayload(response);
      if (data.version !== 1 || !data.buildings || typeof data.buildings !== 'object' || Array.isArray(data.buildings)) {
        throw new Error('Invalid fallback façade data');
      }
      return data.buildings;
    } catch (error) {
      console.warn(`[facades] using basic ${motorway.toUpperCase()} fallback walls:`, error.message);
      return {};
    }
  }));
  const [a12, a30] = corridors;
  for (const [id, edges] of Object.entries(a30)) a12[id] = { ...edges, ...a12[id] };
  return a12;
}

export function loadEdeFacades() {
  facadeIndex ??= readEdeFacades().catch(error => {
    facadeIndex = null;
    throw error;
  });
  return facadeIndex;
}

async function readEdeFacades() {
  const source = new URL('../assets/ede-facades.json', import.meta.url);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.version !== 2 || !Number.isFinite(data.tileSize) || data.tileSize < 64 ||
      !data.tiles || typeof data.tiles !== 'object' || Array.isArray(data.tiles)) throw new Error('Invalid Ede façade index');
  const recent = new Map();
  const corridorTiles = [data.a12Tiles, data.a30Tiles].filter(Boolean);
  const tile = (uri) => {
    if (!/^ede-facades\/[a-zA-Z0-9_-]+\.json(?:\.gz)?$/.test(uri)) return null;
    let pending = recent.get(uri);
    if (!pending) pending = fetch(new URL(uri, source)).then(readFacadePayload).then(payload => {
      if (payload.version !== 2 || !Array.isArray(payload.walls)) throw new Error(`Invalid façade tile ${uri}`);
      return indexWalls(payload.walls);
    }).catch(error => {
      recent.delete(uri);
      console.warn('[facades] using procedural walls for unavailable parameters:', error.message);
      return null;
    });
    recent.delete(uri);
    recent.set(uri, pending);
    if (recent.size > 12 + 6 * corridorTiles.length) recent.delete(recent.keys().next().value);
    return pending;
  };
  return { async forBounds({ min, max }) {
    const { tileSize } = data;
    const margin = 12;
    const grid = n => Math.floor(n / tileSize);
    const selected = [], corridors = [];
    for (let z = grid(min.z - margin); z <= grid(max.z + margin); z++) {
      for (let x = grid(min.x - margin); x <= grid(max.x + margin); x++) {
        const cell = `${x},${z}`;
        const record = tile(data.tiles[cell]);
        if (record) selected.push(record);
        for (const layer of corridorTiles) {
          const pending = tile(layer[cell]);
          if (pending) corridors.push(pending);
        }
      }
    }
    const byId = new Map();
    for (const values of await Promise.all(selected)) for (const [id, walls] of values ?? []) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(...walls);
    }
    for (const values of await Promise.all(corridors)) for (const [id, walls] of values ?? []) {
      const previous = byId.get(id) ?? [];
      for (const wall of walls) {
        const index = previous.findIndex(row => row.wallId === wall.wallId ||
          Math.abs((row.baseOffset ?? 0) - (wall.baseOffset ?? 0)) < 0.15 &&
          Math.hypot(row.a[0] - wall.a[0], row.a[1] - wall.a[1]) < 0.3 &&
          Math.hypot(row.b[0] - wall.b[0], row.b[1] - wall.b[1]) < 0.3);
        if (index < 0) previous.push(wall);
        else if (previous[index].status !== 'observed' && previous[index].wallType !== 'shared'
            && (wall.status === 'observed' || !isMotorwayFacade(previous[index]))) previous[index] = wall;
      }
      byId.set(id, previous);
    }
    return byId;
  } };
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

export async function readBagBuildYears(gltf) {
  const parser = gltf.parser;
  const metadata = parser?.json.extensions?.EXT_structural_metadata;
  return Promise.all((metadata?.propertyTables ?? []).map(async ({ class: className, count, properties }) => {
    const storage = properties.oorspronkelijkbouwjaar;
    const definition = metadata.schema?.classes?.[className]?.properties?.oorspronkelijkbouwjaar;
    if (storage?.values === undefined || definition?.componentType !== 'INT32' || definition.type !== 'SCALAR') return;
    const values = await parser.getDependency('bufferView', storage.values);
    if (values.byteLength < count * 4) return;
    const years = new Uint16Array(count), data = new DataView(values);
    for (let i = 0; i < count; i++) {
      const year = data.getInt32(i * 4, true);
      if (year >= 1000 && year < 2100 && year !== definition.noData) years[i] = year;
    }
    return years;
  }));
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

export function archRise(opening) {
  const arch = opening.arch ?? opening.shape;
  if (!arch || arch === 'rect' || arch === 'rectangle') return 0;
  const height = typeof arch === 'number' ? arch : opening.width * (arch === 'pointed' ? 0.7 : 0.5);
  return Math.max(0, Math.min(height, opening.height * 0.65));
}

function archCurve(t, pointed) {
  return pointed ? (1 - t ** 2) ** 0.78 * (1 - t * 0.23) : Math.sqrt(1 - t ** 2);
}

export function openingTop(opening, u) {
  const t = Math.min(1, Math.abs((u - opening.x) * 2 / opening.width - 1));
  const rise = archRise(opening);
  return opening.y + opening.height - rise * (1 - archCurve(t, (opening.arch ?? opening.shape) === 'pointed'));
}

function openingOutline(opening) {
  const { x, y, width, height } = opening;
  const points = [[x, y], [x + width, y]];
  if (!archRise(opening)) return [...points, [x + width, y + height], [x, y + height]];
  for (let i = 12; i >= 0; i--) {
    const u = x + width * (1 - Math.cos(Math.PI * i / 12)) / 2;
    points.push([u, openingTop(opening, u)]);
  }
  return points;
}

// Partition a wall triangle into the opening and the remaining faces in its local plane.
export function cutFacadeOpening(triangle, opening) {
  return partitionWall(triangle, openingOutline(opening));
}

function partitionWall(triangle, outline) {
  let inside = triangle;
  const outside = [];
  for (let i = 0; i < outline.length && inside.length >= 3; i++) {
    const [u, v] = outline[i], [r, t] = outline[(i + 1) % outline.length];
    const distance = ([x, y]) => (r - u) * (y - v) - (t - v) * (x - u);
    const kept = [], removed = [];
    let a = inside.at(-1), da = distance(a.local);
    for (const b of inside) {
      const db = distance(b.local);
      if ((da >= 0) !== (db >= 0)) {
        const fraction = da / (da - db);
        const interpolate = key => a[key].map((n, i) => n + (b[key][i] - n) * fraction);
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

export function applyBagFacades(...args) {
  const work = applyBagFacadeChunks(...args);
  let step;
  do step = work.next(); while (!step.done);
  return step.value;
}

function* applyBagFacadeChunks(geometry, featureIds, targets, ground, atlas, projectUv, linearColor) {
  const { position, normal, color, buildingHeight, edeFacadeLayout, edeFacadeBay } = geometry.attributes;
  const originalCount = position.count;
  const input = geometry.index?.array;
  const count = input?.length ?? originalCount;
  const index = i => input ? input[i] : i;
  const positionAt = i => [position.getX(i), position.getY(i), position.getZ(i)];
  const frames = new Map(), groups = new Map();
  const useCount = new Uint16Array(originalCount);
  for (const [id, walls] of targets) frames.set(id, walls.map(wall => facadeFrame(wall, ground.get(id)))
    .filter(frame => frame.width > 0 && atlas.rects.has(frame.wall)));
  for (let i = 0; i + 2 < count; i += 3) {
    if (i % 768 === 0) yield;
    const first = index(i), second = index(i + 1), third = index(i + 2);
    useCount[first]++;
    useCount[second]++;
    useCount[third]++;
    if (first >= featureIds.count) continue;
    const feature = Math.round(featureIds.getX(first));
    if (!frames.has(feature)) continue;
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
  const added = { position: [], normal: [], color: [], buildingHeight: [], facadeUv: [], facadeStyle: [], facadeRelief: [] };
  const customStride = { facadeUv: 3, facadeStyle: 3, facadeRelief: 2 };
  const originalAttributes = Object.fromEntries(Object.entries(customStride).map(([name, stride]) =>
    [name, new Float32Array(originalCount * stride)]));
  const matched = [];
  let recesses = 0;
  const add = (point, norm, rgb, height, uv, style, relief = [0, 0]) => {
    const id = originalCount + added.buildingHeight.length;
    added.position.push(...point); added.normal.push(...norm); added.color.push(...rgb);
    added.buildingHeight.push(height); added.facadeUv.push(...uv);
    added.facadeStyle.push(...style); added.facadeRelief.push(...relief);
    return id;
  };
  function fan(vertices) {
    for (let i = 1; i + 1 < vertices.length; i++) extraIndex.push(vertices[0], vertices[i], vertices[i + 1]);
  }
  for (const [frame, triangles] of groups) {
    yield;
    const { wall, nx, nz, tx, tz } = frame;
    const first = triangles[0].ids[0];
    const base = buildingHeight.getX(first) - triangles[0].verts[0][1];
    const useProceduralColor = wall.status !== 'observed' && !isMotorwayFacade(wall) && edeFacadeLayout?.getX(first) > 0;
    const eaves = edeFacadeBay?.getY(first);
    // Fall back to roofline-aware procedural openings when an inferred atlas would clip a window.
    if (useProceduralColor && eaves > 0 && wall.openings.some(opening =>
      opening.kind === 'window' && base + opening.y + opening.height > eaves + 0.05)) continue;
    const wallColor = useProceduralColor ? null : linearColor(wall.wallColor);
    const rect = atlas.rects.get(wall), newId = new Map();
    const paletteRow = atlas.rows.get(wall);
    const materialOrigin = frame.x * tx + frame.z * tz;
    const surfaceUv = ([u, v]) => [materialOrigin + u, frame.y + v, paletteRow];
    const localUses = new Map();
    for (const { ids } of triangles) for (const id of ids) localUses.set(id, (localUses.get(id) ?? 0) + 1);
    const uv = point => projectUv(wall, rect, ...point, frame.y);
    const frontNormal = [nx, 0, nz];
    const vertexColor = i => wallColor ?? [color.getX(i), color.getY(i), color.getZ(i)];
    const physical = atlas.physical.has(wall) ? wall.openings.flatMap((opening, index) => {
      if (opening.kind === 'panel') return [];
      const detail = wall.detail?.opening === index ? wall.detail : null;
      const depth = opening.depth ?? detail?.depth ?? (opening.kind === 'window' ? 0.12 : 0.16);
      if (!(depth >= 0.055 && depth <= 1.5 && opening.width >= 0.25 && opening.height >= 0.4 &&
          opening.x >= 0.02 && opening.x + opening.width <= frame.width - 0.02 &&
          opening.y >= 0 && opening.y + opening.height <= wall.height - 0.03)) return [];
      return [{ ...opening, depth, surround: opening.surround ?? detail?.surround, outline: openingOutline(opening) }];
    }).slice(0, 32) : [];
    const source = triangles.map(({ points, verts }) => points.map((position, j) => ({ position, local: verts[j] })));
    const cuts = [];
    for (const opening of physical) {
      yield;
      const overdraw = cuts.some(accepted => opening.x < accepted.x + accepted.width &&
        opening.x + opening.width > accepted.x && opening.y < accepted.y + accepted.height &&
        opening.y + opening.height > accepted.y);
      if (overdraw) continue;
      const area = source.reduce((sum, polygon) => sum + localArea(partitionWall(polygon, opening.outline).inside), 0);
      const expected = localArea(opening.outline.map(local => ({ local })));
      if (area >= expected * 0.985) cuts.push(opening);
    }
    const offset = triangles[0].verts.reduce((sum, [, , d]) => sum + d, 0) / 3;
    for (let k = 0; k < triangles.length; k++) {
      if (k % 32 === 0) yield;
      const { i, ids, points, verts } = triangles[k];
      let pieces = [source[k]];
      const inserts = [];
      for (const opening of cuts) {
        pieces = pieces.flatMap(polygon => {
          const part = partitionWall(polygon, opening.outline);
          if (localArea(part.inside) < 1e-7) return [polygon];
          inserts.push([part.inside, opening.depth]);
          return part.outside.filter(fragment => localArea(fragment) > 1e-7);
        });
      }
      if (inserts.length) {
        nextIndex.set([ids[0], ids[0], ids[0]], i);
        const rgb = vertexColor(ids[0]);
        for (const [piece, depth] of [...pieces.map(polygon => [polygon, 0]), ...inserts]) fan(piece.map(p =>
          add(p.position, frontNormal, rgb, base + p.local[1], uv(p.position),
            surfaceUv(p.local), [-nx * depth, -nz * depth])));
      } else {
        for (let j = 0; j < 3; j++) {
          const id = ids[j], point = points[j];
          if (!newId.has(id)) {
            const pixel = uv(point), style = surfaceUv(verts[j]);
            if (localUses.get(id) === useCount[id]) {
              if (wallColor) color.array.set(wallColor, id * 3);
              originalAttributes.facadeUv.set(pixel, id * 3);
              originalAttributes.facadeStyle.set(style, id * 3);
              newId.set(id, id);
            } else {
              newId.set(id, add(point, [normal.getX(id), normal.getY(id), normal.getZ(id)],
                vertexColor(id), buildingHeight.getX(id), pixel, style));
            }
          }
          nextIndex[i + j] = newId.get(id);
        }
      }
    }
    const masonry = vertexColor(triangles[0].ids[0]);
    const quad = (corners, norm, rgb, layer = 2) => {
      const ids = corners.map(([u, v, d]) => add(facadePoint(frame, u, v, offset), norm, rgb, base + v,
        [0, 0, layer], surfaceUv([u, v]), [nx * d, nz * d]));
      fan(ids); fan([...ids].reverse());
    };
    for (const opening of cuts) {
      const { x, y, width, depth, outline } = opening;
      recesses++;
      for (let j = 0; j < outline.length; j++) {
        const [u, v] = outline[j], [r, t] = outline[(j + 1) % outline.length];
        const length = Math.hypot(r - u, t - v);
        if (length < 1e-5) continue;
        const side = [-(t - v) / length * tx, (r - u) / length, -(t - v) / length * tz];
        quad([[u,v,0],[r,t,0],[r,t,-depth],[u,v,-depth]], side, masonry.map(c => c * 0.76));
      }
      const sill = Math.min(opening.sill ?? 0, y, 0.22);
      if (sill > 0.025) {
        const rgb = linearColor(opening.sillColor ?? wall.sillColor) ?? [0.39, 0.36, 0.32];
        const left = Math.max(x - 0.055, 0), right = Math.min(x + width + 0.055, frame.width);
        quad([[left,y-sill,0.075],[right,y-sill,0.075],[right,y,0.075],[left,y,0.075]], frontNormal, rgb, 3);
        quad([[left,y,0],[right,y,0],[right,y,0.075],[left,y,0.075]], [0,1,0], rgb, 3);
      }
      const trim = Math.min(opening.surround ?? 0, 0.30, x, frame.width - x - width);
      if (trim > 0.015) {
        const rgb = linearColor(opening.surroundColor ?? wall.surroundColor) ?? masonry.map(c => c * 1.18);
        // Scale the same opening contour into a projecting surround, including its arch crown.
        const centre = x + width / 2;
        const outer = ([u, v]) => [u + (u - centre) * (2 * trim / width),
          v + (v - y) * Math.min(trim, wall.height - y - opening.height) / opening.height, 0.035];
        for (let j = 1; j < outline.length; j++) {
          const a = outline[j], b = outline[(j + 1) % outline.length];
          quad([outer(a), outer(b), [...b, 0.035], [...a, 0.035]], frontNormal, rgb, 3);
        }
      }
    }
    matched.push(wall);
  }
  if (!matched.length) return null;
  const BufferAttribute = position.constructor, finalCount = originalCount + added.buildingHeight.length;
  for (const [name, values] of Object.entries(added)) {
    yield;
    const old = geometry.attributes[name];
    const stride = old?.itemSize ?? customStride[name];
    const combined = new Float32Array(finalCount * stride);
    combined.set(old?.array ?? originalAttributes[name]);
    combined.set(values, originalCount * stride);
    geometry.setAttribute(name, new BufferAttribute(combined, stride));
  }
  // Added vertices sample the atlas. Their procedural attributes can be zero.
  if (finalCount > originalCount) for (const name of ['edeFacadeLayout', 'edeFacadeBay']) {
    const attribute = geometry.attributes[name];
    if (!attribute) continue;
    const padded = new Float32Array(finalCount * attribute.itemSize);
    padded.set(attribute.array);
    geometry.setAttribute(name, new BufferAttribute(padded, attribute.itemSize));
  }
  const Index = finalCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new Index(nextIndex.length + extraIndex.length);
  indices.set(nextIndex); indices.set(extraIndex, nextIndex.length);
  geometry.setIndex(new BufferAttribute(indices, 1));
  return { matched, recesses };
}

export { applyBagFacadeChunks };
