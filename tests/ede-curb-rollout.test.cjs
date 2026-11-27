const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

const read = name => JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets', name + '.json.gz'))));
const packs = ['ede-road-surfaces', 'ede-corridor-paving', 'ede-north-paving', 'ede-fringe-paving', 'ede-terrain-paving'];
const pilot = read('ede-curbs-v1');
const map = read('ede-curbs-v2');

test('municipal curb records use unique ground-level sidewalk and refuge shapes in every relevant paving pack', () => {
  const seen = new Set();
  const shapes = { ...map.flat, ...map.tops };
  assert.equal(map.version, 2);
  for (const field of ['sites', 'profiles', 'table', 'gradeProfiles', 'tactile', 'driveways', 'paintGaps']) {
    assert.deepEqual(map[field], pilot[field]);
  }
  for (const [i, name] of packs.entries()) {
    let count = 0;
    for (const row of read(name).surfaces) {
      const parts = shapes[row.id];
      if (!parts) continue;
      assert.equal(row.layer, 0);
      assert.ok(['voetpad', 'verkeerseiland'].includes(row.function));
      assert.ok(['tegels', 'gebakken klinkers', 'betonstraatstenen'].includes(row.plus_fysiek_voorkomen));
      assert.ok(!seen.has(row.id), row.id);
      assert.ok(Object.keys(parts).every(part => row.polygons[part]));
      seen.add(row.id);
      count++;
    }
    if (i < 4) assert.ok(count > 0, name);
    else assert.equal(count, 0);
  }
  assert.equal(seen.size, Object.keys(shapes).length);
});

test('municipal constant and sloped paving use the same values for rendering and travel', async () => {
  const THREE = await import('../vendor/three/build/three.core.js');
  const { bindEdeCurbPaving, curbHeightAt, curbGeometryFor, setEdeCurbs } = await import('../js/ede-curbs.js');
  const { buildPavingTile } = await import('../js/ede-paving-worker.js');
  const { createTerrainSampler } = await import('../js/terrain.js');
  const context = { terrain: { minX: 0, minZ: 0, maxX: 20, maxZ: 20, step: 10, columns: 3, rows: 3,
    heights: new Float32Array([0, 1, 2, 1, 2, 3, 2, 3, 4]) }, patches: [], expansion: null };
  const constant = [1, 3, 5, 3, 5, 8, 1, 8], hole = [2, 4, 2, 5, 3, 5, 3, 4];
  const outer = [7, 4, 14, 4, 14, 8, 7, 8];
  const ramp = [7, .065, 4, 7, .065, 8, 14, .185, 8, 7, .065, 4, 14, .185, 8, 14, .185, 4];
  const data = { version: 2, roadLift: 0.065, profiles: {}, flat: { square: { 0: .185 } },
    tops: { ramp: { 0: ramp }, missing: { 0: ramp } } };
  setEdeCurbs(data);
  bindEdeCurbPaving([{ id: 'square', layer: 0, polygons: [[constant, hole]] },
    { id: 'ramp', layer: 0, polygons: [[outer]] }]);
  const sampler = createTerrainSampler(context);
  const chunks = buildPavingTile({ context, roads: new Map(), ground: [], jobs: [
    { outer: constant, holes: [hole], angle: Math.PI / 2, material: 'mapped', style: 2, cuts: [], rise: .065, top: curbGeometryFor('square', 0) },
    { outer, holes: [], angle: Math.PI / 2, material: 'mapped', style: 2, cuts: [], rise: .065, top: curbGeometryFor('ramp', 0) }
  ] });
  const [{ attributes }, wall] = chunks;
  assert.equal(wall.material, 'curb');
  const values = name => attributes.find(([attr]) => attr === name)[1];
  const position = values('position'), uv = values('uv');
  assert.ok(values('pavingStyle').every(value => value === 2));
  for (let i = 0, j = 0; i < position.length; i += 3, j += 2) {
    assert.ok(Math.abs(uv[j] - position[i + 2]) < 1e-5);
    assert.ok(Math.abs(uv[j+1] + position[i]) < 1e-5);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  for (const [x, z] of [[2, 6], [7, 6], [10.5, 6], [13.5, 6]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 12, z), new THREE.Vector3(0, -1, 0));
    const expected = curbHeightAt(x, z, sampler.terrainHeightAt(x, z), 0);
    assert.ok(Math.abs(ray.intersectObject(mesh)[0].point.y - expected) < 1e-5);
    assert.equal(curbHeightAt(x, z, 0, -1), undefined);
    assert.equal(curbHeightAt(x, z, 0, 1), undefined);
    assert.equal(curbHeightAt(x, z, 0, 0, false), undefined);
  }
  assert.equal(curbHeightAt(2.5, 4.5, 0, 0), undefined);
  bindEdeCurbPaving([]);
  assert.equal(curbHeightAt(10.5, 6, 0, 0), undefined);
});
