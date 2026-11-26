export const EDE_RENDER_CELL = 750;

export function edeSpatialGroups(items, position = item => item) {
  const cells = new Map();
  for (const item of items) {
    const { x, z } = position(item);
    const key = `${Math.floor(x / EDE_RENDER_CELL)}/${Math.floor(z / EDE_RENDER_CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(item);
  }
  return cells.values();
}

export function edeGeometryGroups(geometries) {
  return edeSpatialGroups(geometries, geometry => {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    return { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 };
  });
}

export function edePoints(flat) {
  const points = [];
  for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i], z: flat[i + 1] });
  return points;
}

export function edeBounds(points) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z);
  }
  return b;
}

export function polygonGeometry(THREE, ring, holes = [], y = 0) {
  const shape = new THREE.Shape(ring.map(p => new THREE.Vector2(p.x, -p.z)));
  for (const hole of holes) if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, -p.z))));
  const geometry = new THREE.ShapeGeometry(shape, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

export function makeSurfaceGeometry(THREE, positions, indices, uv) {
  const geometry = new THREE.BufferGeometry();
  if (!uv) {
    uv = new Float32Array(positions.length / 3 * 2);
    for (let i = 0, j = 0; i < positions.length; i += 3) {
      uv[j++] = positions[i];
      uv[j++] = -positions[i + 2];
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (indices) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function clipSurface(points, signedDistance) {
  const result = [];
  let a = points[points.length - 1], da = signedDistance(a);
  for (const b of points) {
    const db = signedDistance(b);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
    if (db >= 0) result.push(b);
    a = b; da = db;
  }
  return result;
}

export const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

// Split planar overlays across both the grid lines and the cell diagonal, so
// their offsets stay above the same triangles used by rendering and physics.
export function emitSurface(polygon, positions, terrainHeightAt, lift = 0) {
  for (let i = 1; i + 1 < polygon.length; i++) {
    const a = polygon[0], b = polygon[i], c = polygon[i + 1];
    if (Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) < 1e-8) continue;
    for (const p of [a, b, c]) positions.push(p.x, p.y ?? terrainHeightAt(p.x, p.z) + lift, p.z);
  }
}

export function drapeSurface(THREE, terrain, grade, geometry, cutGrade, wayId, mappedPavement, keepAttribute, surfaceCuts) {
  const { getTerrain, getExpansionTerrain, getExpansionTerrainPatch, getTerrainPatch, terrainHeightAt } = terrain;
  const { gradeCuts, localGradeSurface, clipEdeGround } = grade;
  const field = getTerrain();
  if (!field || !geometry) return geometry;
  let outerField = getExpansionTerrain?.()?.field;
  const position = geometry.getAttribute('position'), index = geometry.index;
  if (!position.count) return geometry;
  const lift = position.getY(0), positions = [];
  const candidate = wayId && localGradeSurface(wayId);
  let local;
  let cuts = [];
  if (cutGrade || candidate || mappedPavement || outerField || surfaceCuts) {
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    const bounds = { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z };
    if (outerField && bounds.minX >= field.minX && bounds.maxX <= field.maxX
        && bounds.minZ >= field.minZ && bounds.maxZ <= field.maxZ) outerField = null;
    if (cutGrade) cuts = gradeCuts(bounds, wayId);
    if (surfaceCuts) cuts = cuts.concat(surfaceCuts(bounds));
    local = candidate || (mappedPavement && localGradeSurface(null, bounds));
    if (local && !overlaps(bounds, local)) local = null;
  }
  const emitCoarse = polygon => {
    if (!cuts.length) {
      emitSurface(polygon, positions, terrainHeightAt, lift);
      return;
    }
    const surface = polygon.map(p => ({ ...p, y: terrainHeightAt(p.x, p.z) + lift }));
    for (const part of clipEdeGround(surface, cuts)) emitSurface(part, positions, terrainHeightAt);
  };
  const emit = !local ? emitCoarse : polygon => {
    if (!overlaps(edeBounds(polygon), local)) return emitCoarse(polygon);
    // Preserve the original pavement outline and split only across the fitted portion.
    let pieces = [polygon];
    for (const [nx, nz, c] of local.planes) {
      const d = p => p.x * nx + p.z * nz - c;
      pieces = pieces.flatMap(piece => piece.some(p => d(p) > 1e-7) && piece.some(p => d(p) < -1e-7)
        ? [clipSurface(piece, d), clipSurface(piece, p => -d(p))] : [piece]);
    }
    for (const piece of pieces) {
      const surface = piece.map(p => ({ ...p, y: local.heightAt(p.x, p.z) + lift }));
      for (const part of cuts.length ? clipEdeGround(surface, cuts) : [surface]) emitSurface(part, positions, terrainHeightAt);
    }
  };
  const visit = (polygon, grid) => {
    if (polygon.length < 3) return;
    const { step, minX, minZ, columns, rows } = grid;
    const bounds = edeBounds(polygon);
    const x0 = Math.max(0, Math.floor((bounds.minX + 1e-6 - minX) / step) + 1);
    const z0 = Math.max(0, Math.floor((bounds.minZ + 1e-6 - minZ) / step) + 1);
    const x1 = Math.min(columns - 1, Math.floor((bounds.maxX - 1e-6 - minX) / step));
    const z1 = Math.min(rows - 1, Math.floor((bounds.maxZ - 1e-6 - minZ) / step));
    if (x1 >= x0 || z1 >= z0) {
      const d = x1 - x0 >= z1 - z0
        ? p => p.x - (minX + Math.floor((x0 + x1) / 2) * step)
        : p => p.z - (minZ + Math.floor((z0 + z1) / 2) * step);
      visit(clipSurface(polygon, d), grid);
      visit(clipSurface(polygon, p => -d(p)), grid);
      return;
    }
    const col = Math.floor(((bounds.minX + bounds.maxX) / 2 - minX) / step);
    const row = Math.floor(((bounds.minZ + bounds.maxZ) / 2 - minZ) / step);
    const cellX = minX + col * step, cellZ = minZ + row * step;
    const detail = grid === outerField && getExpansionTerrainPatch(cellX, cellZ);
    if (detail) {
      visit(polygon, detail);
      return;
    }
    const patch = grid === field && getTerrainPatch(cellX, cellZ);
    if (patch) {
      const fine = patch.step;
      const split = (piece, axis, edge) => {
        const d = p => p[axis] - edge;
        return piece.some(p => d(p) > 1e-6) && piece.some(p => d(p) < -1e-6)
          ? [clipSurface(piece, d), clipSurface(piece, p => -d(p))] : [piece];
      };
      let pieces = [polygon];
      for (let shift = fine; shift < step; shift += fine) {
        pieces = pieces.flatMap(piece => split(piece, 'x', cellX + shift));
        pieces = pieces.flatMap(piece => split(piece, 'z', cellZ + shift));
      }
      for (const piece of pieces) {
        const b = edeBounds(piece);
        const diagonal = cellX + cellZ + fine * (1 + Math.floor(((b.minX + b.maxX) / 2 - cellX) / fine) +
          Math.floor(((b.minZ + b.maxZ) / 2 - cellZ) / fine));
        const d = p => p.x + p.z - diagonal;
        emit(clipSurface(piece, d)); emit(clipSurface(piece, p => -d(p)));
      }
      return;
    }
    if (col >= 0 && col < columns - 1 && row >= 0 && row < rows - 1) {
      const diagonal = minX + minZ + (col + row + 1) * step;
      const d = p => p.x + p.z - diagonal;
      emit(clipSurface(polygon, d));
      emit(clipSurface(polygon, p => -d(p)));
    } else emit(polygon);
  };
  const boundaries = outerField && [[1, 0, field.minX], [-1, 0, -field.maxX],
    [0, 1, field.minZ], [0, -1, -field.maxZ]];
  function drapeTriangle(polygon) {
    if (boundaries) {
      for (const [nx, nz, limit] of boundaries) {
        const d = point => nx * point.x + nz * point.z - limit;
        if (polygon.every(p => d(p) >= 0)) continue;
        if (polygon.every(p => d(p) <= 0)) {
          visit(polygon, outerField);
          return;
        }
        visit(clipSurface(polygon, p => -d(p)), outerField);
        polygon = clipSurface(polygon, d);
      }
    }
    visit(polygon, field);
  }
  const count = index ? index.count : position.count;
  const source = keepAttribute && geometry.getAttribute(keepAttribute);
  const attributeValues = [];
  const vertexIndex = i => index ? index.getX(i) : i;
  const point = i => ({ x: position.getX(i), z: position.getZ(i) });
  for (let i = 0; i < count; i += 3) {
    const ia = vertexIndex(i), ib = vertexIndex(i + 1), ic = vertexIndex(i + 2);
    const a = point(ia), b = point(ib), c = point(ic);
    const start = positions.length;
    drapeTriangle([a, b, c]);
    if (!source || positions.length === start) continue;
    // Every emitted point stays on this source triangle in plan.
    const bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z;
    const det = bx * cz - bz * cx;
    for (let j = start; j < positions.length; j += 3) {
      const x = positions[j] - a.x, z = positions[j + 2] - a.z;
      const wb = (x * cz - z * cx) / det, wc = (bx * z - bz * x) / det;
      const wa = 1 - wb - wc;
      for (let k = 0; k < source.itemSize; k++) {
        attributeValues.push(wa * source.getComponent(ia, k) + wb * source.getComponent(ib, k) + wc * source.getComponent(ic, k));
      }
    }
  }
  geometry.dispose();
  const result = makeSurfaceGeometry(THREE, positions);
  if (source) result.setAttribute(keepAttribute, new THREE.Float32BufferAttribute(attributeValues, source.itemSize));
  return result;
}

