import * as THREE from 'three/webgpu';

export const FIELD_TILE_SIZE = 512;
const MAX_DRAPE_EDGE = 16;

export function containsFieldPoint({ rings }, x, z) {
  // Even-odd containment treats all interior rings as holes.
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > z) !== (b.y > z) && x < (b.x - a.x) * (z - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function decodeFieldTile(rows, tile, fields) {
  const [west, north] = tile.bounds;
  return rows.flatMap(([id, packed]) => {
    const field = fields.get(id);
    if (!field || !packed.length) return [];
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const rings = packed.map(flat => {
      const ring = [];
      for (let i = 0; i < flat.length; i += 2) {
        const x = west + flat[i] / 4, z = north + flat[i + 1] / 4;
        if (ring.at(-1)?.x === x && ring.at(-1).y === z) continue;
        ring.push(new THREE.Vector2(x, z));
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], z);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], z);
      }
      if (ring.length > 1 && ring[0].equals(ring.at(-1))) ring.pop();
      return ring;
    });
    return rings[0].length >= 3 ? [{ field, rings: rings.filter(ring => ring.length >= 3), bounds }] : [];
  });
}

export function buildFieldTile(parts, heightAt, [west, north, east, south]) {
  const positions = [], rows = [], edges = [], wallNormals = [], baseIndices = [], maizeIndices = [], spans = [];

  for (const { field, rings } of parts) {
    const first = positions.length / 3;
    const [outer, ...holes] = rings;
    const outline = rings.flat();
    const vertices = new Map();
    const boundary = field.family === 'maize' ? new Map() : null;

    function vertex(point) {
      const { x, y: z } = point;
      const key = `${x}/${z}`;
      if (vertices.has(key)) return vertices.get(key);
      const index = positions.length / 3;
      positions.push(x, heightAt(x, z) + (field.code ? 0.08 : 0.12), z);
      rows.push(x * field.cos + z * field.sin, -x * field.sin + z * field.cos);
      edges.push(0);
      vertices.set(key, index);
      return index;
    }

    function drape(a, b, c) {
      const ab = a.distanceToSquared(b), bc = b.distanceToSquared(c), ca = c.distanceToSquared(a);
      const longest = Math.max(ab, bc, ca);
      if (longest > MAX_DRAPE_EDGE ** 2) {
        if (bc > ab && bc >= ca) return drape(b, c, a);
        if (ca > ab && ca > bc) return drape(c, a, b);
        const middle = new THREE.Vector2().addVectors(a, b).multiplyScalar(0.5);
        drape(a, middle, c);
        drape(middle, b, c);
        return;
      }
      const indices = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0
        ? [vertex(a), vertex(c), vertex(b)] : [vertex(a), vertex(b), vertex(c)];
      baseIndices.push(...indices);
      if (boundary) {
        maizeIndices.push(...indices);
        for (let i = 0; i < 3; i++) {
          const a = indices[i], b = indices[(i + 1) % 3];
          if (!boundary.delete(`${b}/${a}`)) boundary.set(`${a}/${b}`, [a, b]);
        }
      }
    }

    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outer, holes)) drape(outline[a], outline[b], outline[c]);
    if (boundary) for (const [a, b] of boundary.values()) {
      const ax = positions[a * 3], az = positions[a * 3 + 2];
      const bx = positions[b * 3], bz = positions[b * 3 + 2];
      // Clipped edges can continue into the next tile. Leave those cuts open.
      if ((ax === bx && (ax === west || ax === east)) || (az === bz && (az === north || az === south))) continue;
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      const start = positions.length / 3;
      for (const index of [a, b]) {
        const [x, y, z] = positions.slice(index * 3, index * 3 + 3);
        positions.push(x, y, z, x, y - 0.10, z);
        rows.push(rows[index * 2], rows[index * 2 + 1], rows[index * 2], rows[index * 2 + 1]);
        edges.push(1, 2);
      }
      wallNormals.push([start, -dz / length, dx / length]);
      maizeIndices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
    }
    if (positions.length / 3 > first) spans.push({ first, end: positions.length / 3, field });
  }

  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  base.setAttribute('fieldRow', new THREE.Float32BufferAttribute(rows, 2));
  base.setAttribute('fieldEdge', new THREE.Float32BufferAttribute(edges, 1));
  for (const [name, size] of [['fieldStage', 4], ['fieldColor', 3], ['fieldBloom', 4]]) {
    base.setAttribute(name, new THREE.BufferAttribute(new Float32Array(positions.length / 3 * size), size)
      .setUsage(THREE.DynamicDrawUsage));
  }
  base.setIndex(baseIndices);
  base.computeVertexNormals();
  for (const [first, x, z] of wallNormals) {
    for (let i = first; i < first + 4; i++) base.attributes.normal.setXYZ(i, x, 0, z);
  }
  base.computeBoundingBox();
  let canopy = null;
  if (maizeIndices.length) {
    canopy = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(base.attributes)) canopy.setAttribute(name, attribute);
    canopy.setIndex(maizeIndices);
    canopy.boundingBox = base.boundingBox.clone();
    canopy.boundingBox.max.y += 4;
    canopy.boundingSphere = canopy.boundingBox.getBoundingSphere(new THREE.Sphere());
  }
  return { base, canopy, spans };
}
