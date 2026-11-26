const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { gunzipSync } = require('node:zlib');

const asset = name => readFileSync(resolve(__dirname, '../assets', name));
const baked = JSON.parse(gunzipSync(asset('ede-curbs-v1.json.gz')));
const close = (actual, expected, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('Kastelenlaan keeps both refuge paths open at the same carriageway height', async () => {
  const { setEdeCurbs, curbHeightAt } = await import('../js/ede-curbs.js');
  setEdeCurbs(baked);
  for (const [a, b] of [
    [[-1901.1, 597.4], [-1874.1, 585.6]],
    [[-1915, 564.4], [-1887, 552.2]],
  ]) {
    for (let i = 0; i <= 100; i++) {
      const x = a[0] + (b[0] - a[0]) * i / 100;
      const z = a[1] + (b[1] - a[1]) * i / 100;
      close(curbHeightAt(x, z, 4, 0), 4.065);
    }
  }
  close(curbHeightAt(-1890, 587, 4, 0), 4.185);
  close(curbHeightAt(-1890, 587, 4, 0, false), 4.065);
  assert.equal(curbHeightAt(-1890, 587, -3, -1), undefined);
  assert.equal(curbHeightAt(-1890, 587, 10, 1), undefined);
});

test('the driveway and sidewalk contacts meet the road and ramp in either direction', async () => {
  const { setEdeCurbs, curbHeightAt } = await import('../js/ede-curbs.js');
  setEdeCurbs(baked);
  for (const sign of [-1, 1]) {
    let previous;
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const t = sign > 0 ? i / steps : 1 - i / steps;
      const y = curbHeightAt(-232.1 - 0.7 * t, 1278.04 - 3.24 * t, 4, 0, false);
      if (previous !== undefined) assert.ok(Math.abs(y - previous) < 0.006);
      previous = y;
    }
  }
  close(curbHeightAt(-232.1, 1278.04, 4, 0, false), 4.065);
  close(curbHeightAt(-232.50, 1276.10, 4, 0, false), 4.185);
  close(curbHeightAt(-232.84, 1274.6, 4, 0, false), 4.065);
  close(curbHeightAt(-235, 1276.5, 4, 0), 4.185);
});

test('worker tops and curb faces agree with the same contact on a sloping terrain grid', async () => {
  const THREE = await import('../vendor/three/build/three.core.js');
  const { setEdeCurbs, curbHeightAt } = await import('../js/ede-curbs.js');
  const { buildPavingTile } = await import('../js/ede-paving-worker.js');
  const { createTerrainSampler, decodeTerrain } = await import('../js/terrain.js');
  const pavement = JSON.parse(gunzipSync(asset('ede-road-surfaces.json.gz')));
  const data = asset('ede-ahn.bin');
  const context = { terrain: decodeTerrain(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
    patches: [], expansion: null };
  const terrain = createTerrainSampler(context);
  const id = baked.driveways[0];
  const { polygons: [[outer, ...holes]], angle } = pavement.surfaces.find(item => item.id === id);
  const chunks = buildPavingTile({ context, roads: new Map(), ground: [], jobs: [
    { outer, holes, angle, top: baked.profiles[id][0], rise: baked.roadLift, cuts: [], material: 'mapped', style: 1 }
  ] });
  setEdeCurbs(baked);
  assert.deepEqual(chunks.map(({ material }) => material), ['mapped', 'curb']);
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.BufferAttribute(chunks[0].attributes.find(([name]) => name === 'position')[1], 3));
  const mesh = new THREE.Mesh(top, new THREE.MeshBasicMaterial());
  for (const [x, z] of [[-232.40, 1276.84], [-232.50, 1276.5], [-232.6, 1276.1], [-232.7, 1275.7]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0));
    close(ray.intersectObject(mesh)[0].point.y, curbHeightAt(x, z, terrain.terrainHeightAt(x, z), 0), 0.0003);
  }
});

test('a fitted deck over a ground curb retains its separate grade', async () => {
  const { setEdeCurbs } = await import('../js/ede-curbs.js');
  const { setEdeGrade, gradeHeightAt } = await import('../js/ede-grade.js');
  setEdeCurbs(baked);
  setEdeGrade({ sites: [{ id: 'synthetic-deck', kind: 'bridge', profiles: [{
    id: 'upper-path', width: 3, modes: ['foot', 'bike'],
    points: [[-1894, 587, 5], [-1886, 587, 5]]
  }] }] });
  close(gradeHeightAt(-1890, 587, 0, 'person'), 0.185);
  close(gradeHeightAt(-1890, 587, 5, 'person'), 5);
});

test('Albertstunnel retains both fitted elevations and grade-specific pavement offsets', async () => {
  const { setEdeCurbs } = await import('../js/ede-curbs.js');
  const { setEdeGrade, gradeHeightAt, gradeWayAt } = await import('../js/ede-grade.js');
  const grades = JSON.parse(asset('ede-grade.json'));
  setEdeGrade(grades);
  setEdeCurbs(baked);
  const roadXZ = [104.1, 2042];
  const pathXZ = [98.17, 2041.51];
  const road = gradeWayAt('w6952984', ...roadXZ).y;
  const path = gradeWayAt('w25098905', ...pathXZ).y;
  assert.ok(path - road > 0.95);
  close(gradeHeightAt(...roadXZ, road, 'car', 'alberts-southbound'), road + 0.055);
  close(gradeHeightAt(...pathXZ, path, 'cyclist', 'alberts-west-path'), path + 0.055);
});
