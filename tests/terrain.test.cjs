const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('the built AHN asset covers Ede and retains metres relative to Oude Kerk', async () => {
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const raw = readFileSync(path.join(__dirname, '../assets/ede-ahn.bin'));
  const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const terrain = decodeTerrain(bytes);
  const [minX, minZ, maxX, maxZ] = EDE_DATA.meta.baseBounds ?? EDE_DATA.meta.bounds;
  assert.ok(terrain.minX <= minX && terrain.minZ <= minZ && terrain.maxX >= maxX && terrain.maxZ >= maxZ);
  assert.equal(sampleTerrain(terrain, 0, 0), 0);
  assert.ok(Math.abs(terrain.napOrigin - 22.54) < 0.01);
  assert.ok(terrain.minY < -10 && terrain.maxY > 20);
  assert.throws(() => decodeTerrain(bytes.slice(0, 80)), /Invalid AHN terrain asset/);
});

test('the theatre, motorway and cycling patches stitch into the 12 m AHN grid', async ({ mock }) => {
  const { loadTerrain, getTerrainPatch, getTerrainPatches, sampleTerrain, terrainHeightAt } = await import('../js/terrain.js');
  mock.method(globalThis, 'fetch', async url => new Response(readFileSync(url)));
  const coarse = await loadTerrain();
  const { WVEDE_CIRCUIT } = await import('../js/ede-wvede-circuit-survey.js');
  const [theatre, embankment, cyclingCircuit] = getTerrainPatches();
  assert.equal(coarse.step, 12);
  for (const [patch, step] of [[theatre, 3], [embankment, 3], [cyclingCircuit, 2]]) {
    assert.equal(patch.step, step);
    for (let z = patch.minZ; z <= patch.maxZ; z += 1) {
      for (const x of [patch.minX, patch.maxX]) {
        assert.ok(Math.abs(sampleTerrain(coarse, x, z) - sampleTerrain(patch, x, z)) <= 0.00501);
      }
    }
    for (let x = patch.minX; x <= patch.maxX; x += 1) {
      for (const z of [patch.minZ, patch.maxZ]) {
        assert.ok(Math.abs(sampleTerrain(coarse, x, z) - sampleTerrain(patch, x, z)) <= 0.00501);
      }
    }
  }
  for (const [x, z] of WVEDE_CIRCUIT) assert.equal(getTerrainPatch(x, z), cyclingCircuit);
  assert.ok(terrainHeightAt(476, 651) - terrainHeightAt(476, 627) > 8);
  for (const [x, z] of [[-2500, 3120], [-2300, 3200], [-1900, 3333]]) {
    assert.equal(getTerrainPatch(x, z), embankment);
    assert.ok(terrainHeightAt(x, z) - terrainHeightAt(x, z + 36) > 8);
    assert.ok(terrainHeightAt(x, z) - terrainHeightAt(x, z - 35) > 7);
    assert.ok(terrainHeightAt(x, z) - sampleTerrain(coarse, x, z) > 1);
  }
  assert.ok(terrainHeightAt(-1716, 3379) - terrainHeightAt(-1716, 3392) > 6);
});

test('draped faces keep their offset across terrain cells and both sides of the diagonal', async () => {
  const { sampleTerrain } = await import('../js/terrain.js');
  const terrain = {
    step: 10, columns: 3, rows: 2, minX: 0, minZ: 0,
    heights: [0, 1, 7, 3, 8, 2]
  };
  const heightAt = (x, z) => sampleTerrain(terrain, x, z);
  assert.ok(Math.abs(heightAt(2, 3) - 1.1) < 1e-8);
  assert.ok(Math.abs(heightAt(8, 7) - 4.9) < 1e-8);

  class Attribute {
    constructor(array, size) { this.array = array; this.count = array.length / size; }
    getX(i) { return this.array[i * 3]; }
    getY(i) { return this.array[i * 3 + 1]; }
    getZ(i) { return this.array[i * 3 + 2]; }
  }
  class Geometry {
    attributes = {};
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    computeVertexNormals() {}
    dispose() {}
  }
  const source = readFileSync(path.join(__dirname, '../js/ede-geometry.js'), 'utf8');
  const { drapeEdeSurface } = loadModule(source.replace('export function* edeTerrainGeometries', 'function* edeTerrainGeometries'), {
    imports: {
      'three/webgpu': { BufferGeometry: Geometry, BufferAttribute: Attribute, Float32BufferAttribute: Attribute },
      './city-config.js': {},
      './terrain.js': { getTerrain: () => terrain, getTerrainPatch: () => null, terrainHeightAt: heightAt },
      './ede-grade.js': {}
    }
  });
  const surface = new Geometry();
  const offset = 0.06;
  surface.setAttribute('position', new Attribute([2, offset, 1, 4, offset, 9, 18, offset, 4], 3));
  const draped = drapeEdeSurface(surface).getAttribute('position');
  let area = 0;
  assert.ok(draped.count > 3);
  for (let i = 0; i < draped.count; i += 3) {
    const points = [i, i + 1, i + 2].map(j => [draped.getX(j), draped.getY(j), draped.getZ(j)]);
    const [[ax, , az], [bx, , bz], [cx, , cz]] = points;
    const expected = heightAt((ax + bx + cx) / 3, (az + bz + cz) / 3);
    const actual = (points[0][1] + points[1][1] + points[2][1]) / 3;
    assert.ok(Math.abs(actual - expected - offset) < 1e-6);
    area += Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
  }
  assert.ok(Math.abs(area - 61) < 1e-6);
});

test('surveyed station footway shares a continuous grade with pavement in both directions', async () => {
  const THREE = await import('../vendor/three/build/three.core.js');
  const terrain = await import('../js/terrain.js');
  const grade = await import('../js/ede-grade.js');
  const file = name => readFileSync(path.join(__dirname, '../assets', name));
  const load = globalThis.fetch;
  try {
    globalThis.fetch = async url => new Response(readFileSync(url));
    await terrain.loadTerrain();
  } finally {
    globalThis.fetch = load;
  }
  const { sites } = JSON.parse(file('ede-ahn-surfaces.json'));
  grade.setEdeGrade({ sites });
  const profile = sites[0].profiles[0];
  const [wayId] = profile.wayIds;
  const [x, z] = profile.points[0];
  const [endX, endZ] = profile.points.at(-1);
  const length = Math.hypot(endX - x, endZ - z);
  const dx = (endX - x) / length, dz = (endZ - z) / length;
  const point = (s, t = 0) => [x + dx * s - dz * t, z + dz * s + dx * t];
  const ground = (x, z) => grade.gradeWayAt(wayId, x, z)?.y ?? terrain.terrainHeightAt(x, z);
  const heading = Math.atan2(dx, dz);
  for (let i = 0; i <= 100; i++) {
    const [px, pz] = point(length * i / 100);
    const y = ground(px, pz);
    assert.ok(y >= terrain.terrainHeightAt(px, pz));
    for (const direction of [heading, heading + Math.PI]) {
      assert.ok(Math.abs((grade.gradeProfileAt(px, pz, 'person', direction, y)?.y ?? y) - y) < 0.0001);
    }
    if (i > 0 && i < 100) assert.ok(grade.gradeProfileAt(px, pz, 'person', heading, y));
    for (const t of [-1.5, 1.5]) {
      const side = point(length * i / 100, t);
      assert.equal(ground(...side), terrain.terrainHeightAt(...side));
    }
  }
  for (const end of [point(0), point(length), point(-0.02), point(length + 0.02)]) {
    assert.ok(Math.abs(ground(...end) - terrain.terrainHeightAt(...end)) < 0.0001);
  }
  const source = readFileSync(path.join(__dirname, '../js/ede-geometry.js'), 'utf8');
  const geometry = loadModule(source.replace('export function* edeTerrainGeometries', 'function* edeTerrainGeometries'), {
    imports: { 'three/webgpu': THREE, './city-config.js': {}, './terrain.js': terrain, './ede-grade.js': grade },
  });
  const asPoint = ([x, z]) => ({x, z});
  const input = geometry.edeStrip(asPoint(point(-2)), asPoint(point(length + 2)), 1.5, 0.055);
  const mesh = geometry.drapeEdeSurface(input, true, wayId).getAttribute('position');
  let area = 0, maxError = 0;
  for (let i = 0; i < mesh.count; i += 3) {
    const j = i + 1, k = i + 2;
    const x = (mesh.getX(i) + mesh.getX(j) + mesh.getX(k)) / 3;
    const y = (mesh.getY(i) + mesh.getY(j) + mesh.getY(k)) / 3;
    const z = (mesh.getZ(i) + mesh.getZ(j) + mesh.getZ(k)) / 3;
    maxError = Math.max(maxError, Math.abs(y - ground(x, z) - 0.055));
    area += Math.abs((mesh.getX(j) - mesh.getX(i)) * (mesh.getZ(k) - mesh.getZ(i))
      - (mesh.getX(k) - mesh.getX(i)) * (mesh.getZ(j) - mesh.getZ(i))) / 2;
  }
  assert.ok(maxError < 0.025, `pavement height error ${maxError}`);
  assert.ok(Math.abs(area - (length + 4) * 3) < 0.001, `footway area ${area}`);
  assert.ok(mesh.count < 1000, `footway vertices ${mesh.count}`);

  const adjacent = geometry.edeStrip(asPoint(point(-2)), asPoint(point(length + 2)), 1.5, 0.065);
  const mapped = geometry.drapeEdeSurface(adjacent, true, undefined, true).getAttribute('position');
  assert.equal(mapped.count, mesh.count);
  for (let i = 0; i < mapped.count; i++) {
    assert.equal(mapped.getX(i), mesh.getX(i));
    assert.equal(mapped.getZ(i), mesh.getZ(i));
    assert.ok(Math.abs(mapped.getY(i) - mesh.getY(i) - 0.01) < 0.0001);
  }

  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { resolveEdeRoadLanes } = await import('../js/ede-road-lanes.js');
  const adjoiningRoad = EDE_DATA.roads.find(road => road.id === profile.wayIds[1]);
  const [ax, az, bx, bz] = adjoiningRoad.pts;
  const roadLength = Math.hypot(bx - ax, bz - az);
  const [ux, uz] = [(bx - ax) / roadLength, (bz - az) / roadLength];
  for (const [direction, layout] of resolveEdeRoadLanes(adjoiningRoad, adjoiningRoad.modes).entries()) {
    for (const { offset } of layout.lanes) {
      for (const wheel of [-1.18, 0, 1.18]) {
        const across = (offset + wheel) * (direction ? -1 : 1);
        for (let s = 0; s <= roadLength; s += 0.25) {
          const x = ax + ux * s - uz * across, z = az + uz * s + ux * across;
          assert.equal(grade.gradeWayAt(adjoiningRoad.id, x, z, 1.2), null);
        }
      }
    }
  }
});
