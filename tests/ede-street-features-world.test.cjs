const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');
const { loadModule } = require('./helpers/module.cjs');

async function loadWorld(overlapsEdeTravelPavement = () => false) {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const { texture } = await import('../vendor/three/build/three.tsl.js');
  const filename = join(__dirname, '../js/ede-street-features-world.js');
  const source = readFileSync(filename, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
    .replace('export async function', 'async function') + '\nexport { buildEdeStreetFeaturesWorld, collectSigns, matrixGantryMount };';
  const world = loadModule(source, { filename, imports: {
    'three/webgpu': THREE,
    'three/tsl': { texture },
    './ede-grade.js': { gradeProfileAt: () => null, gradeWayAt: id => id === 'grade' ? { y: 8 } : null },
    './terrain.js': { terrainHeightAt: () => 2 },
    './ede-curbs.js': await import('../js/ede-curbs.js'),
    './tsl-materials.js': { createRoadSurfaceMaterial: () => new THREE.MeshStandardNodeMaterial() },
    './ede-geometry.js': { nearestEdeRoad: () => null, overlapsEdeTravelPavement }
  } });
  return { THREE, ...world };
}

test('zebra evidence controls paint independently from signals, with measured footprints and raised refuge arms', async () => {
  const { THREE, buildEdeStreetFeaturesWorld } = await loadWorld();
  const feature = { x: 0, z: 0, tangent: [1, 0], wayId: 'source-road', renderWay: 'grade', layer: 1 };
  const bump = { ...feature, id: 'raised', height: 0.10, length: 6, width: 8, profile: 'table',
    footprint: [[-3, -4], [-3, 1.6], [3, 3.4], [3, -4]] };
  const crossing = { ...feature, id: 'surveyed', length: 2, width: 8, control: 'signal', bumpId: bump.id, segments: [
    { ends: [[0, -4], [0, -1]], width: 3, markings: 'zebra', markingEvidence: 'osm' },
    { ends: [[0, 1], [0, 4]], width: 3, markings: 'zebra', markingEvidence: 'vop',
      footprint: [[-0.5, 1], [-0.5, 4], [0.7, 4], [0.7, 1]] }
  ] };
  const scene = new THREE.Scene();
  const unpainted = [
    { ...feature, id: 'control-only', x: 10, length: 2, width: 6, control: 'zebra' },
    { ...feature, id: 'source-missing', x: 20, length: 2, width: 6, control: 'zebra', markings: 'zebra', marked: true },
    { ...feature, id: 'dashes', x: 30, length: 2, width: 6, control: 'signal', markings: 'dashes' },
    { ...feature, id: 'no-profile', x: 40, length: 2, width: 6, renderWay: 'unmodelled', markings: 'zebra', markingEvidence: 'osm' },
  ];
  const { group } = await buildEdeStreetFeaturesWorld(scene, { bumps: [bump], crossings: [crossing, ...unpainted] });
  assert.equal(scene.getObjectByName('EdeStreetFeatures'), group);
  assert.equal(group.userData.crossings, 1);
  assert.equal(group.children.length, 2);
  const [table, paint] = group.children;
  const yOf = ({ geometry }) => Array.from(geometry.attributes.position.array).filter((_, i) => i % 3 === 1);
  assert.ok(Math.abs(Math.max(...yOf(table)) - 8.163) < 1e-4);
  assert.ok(Math.abs(Math.max(...yOf(paint)) - 8.183) < 1e-4);
  const ray = new THREE.Raycaster(new THREE.Vector3(0.05, 10, 2.45), new THREE.Vector3(0, -1, 0));
  assert.ok(Math.abs(ray.intersectObject(paint)[0].point.y - ray.intersectObject(table)[0].point.y - 0.02) < 1e-4);
  const position = paint.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    assert.ok(Math.abs(z) >= 1);
    assert.ok(z < 0 || (x >= -0.5001 && x <= 0.7001));
  }
});

test('the Diedenweg zebra keeps its center refuge unpainted', async t => {
  const { setEdeCurbs } = await import('../js/ede-curbs.js');
  const { THREE, buildEdeStreetFeaturesWorld } = await loadWorld();
  const read = name => JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets', name))));
  const baked = read('ede-curbs-v1.json.gz');
  const [id, gap] = Object.entries(baked.paintGaps)[0];
  const crossing = read('ede-street-features.json.gz').crossings.find(row => row.id === id);
  setEdeCurbs(baked);
  t.after(() => setEdeCurbs(null));
  const { group } = await buildEdeStreetFeaturesWorld(new THREE.Scene(), { crossings: [crossing] });
  assert.equal(group.userData.zebras, 1);
  const [{ geometry }] = group.children;
  const { position } = geometry.attributes;
  const [dx, dz] = crossing.tangent;
  const sides = new Set();
  for (let i = 0; i < position.count; i++) {
    const across = ((position.getZ(i) - crossing.z) * dx - (position.getX(i) - crossing.x) * dz) / Math.hypot(dx, dz);
    assert.ok(Math.abs(across) >= gap - 0.001);
    sides.add(Math.sign(across));
  }
  assert.deepEqual(sides, new Set([-1, 1]));
});

test('the baked Klinkenbergerweg landings meet the rendered table at both seams', async t => {
  const { setEdeCurbs, curbHeightAt } = await import('../js/ede-curbs.js');
  const { THREE, buildEdeStreetFeaturesWorld } = await loadWorld();
  const read = name => JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets', name))));
  const baked = read('ede-curbs-v1.json.gz');
  setEdeCurbs(baked);
  t.after(() => setEdeCurbs(null));
  const { bumps, crossings } = read('ede-street-features.json.gz');
  const bump = bumps.find(b => b.id === baked.table);
  await buildEdeStreetFeaturesWorld(new THREE.Scene(), {
    bumps: [bump], crossings: crossings.filter(c => c.bumpId === bump.id)
  });
  const [a, b] = [[18.8, 1325.45], [30.2, 1322.31]];
  for (let i = 0; i <= 2400; i++) {
    const t = i / 2400;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    assert.ok(Math.abs(curbHeightAt(x, z, 2, 0) - 2.143) < 1e-5, `mismatched landing near ${x}, ${z}`);
  }
  assert.equal(Object.keys(baked.tactile).length, 2);
});

test('explicit crossing patterns draw distinct geometry without inventing markings at signals', async () => {
  const { THREE, buildEdeStreetFeaturesWorld } = await loadWorld();
  const make = (x, markings, extra = {}) => ({
    x, z: 0, tangent: [1, 0], id: `markings-${x}`, width: 6.3, length: 2.5,
    sources: [{ source: 'osm', markings }], markings, ...extra
  });
  const { group } = await buildEdeStreetFeaturesWorld(new THREE.Scene(), { crossings: [
    make(5, 'dashes', { control: 'signal', marked: false }),
    make(10, 'dots', { marked: false }),
    make(15, 'zebra:double', { marked: true }),
    make(20, 'zebra:paired', { marked: true }),
    make(25, 'zebra:bicolour', { marked: true, markingColour: '#eecc66;red' }),
    make(30, 'zebra;dots', { marked: true }),
    make(35, 'no', { control: 'signal' }),
    make(40, null, { control: 'signal' }),
    make(45, 'dots', { sources: [], control: 'signal' }),
    make(50, 'dashes', { markingReview: 'conflicting-markings' }),
    make(55, 'lines:paired', { marked: false }),
  ] }, [
    { layer: 0, function: 'verkeerseiland', polygons: [[[5.8, -1.45, 6.5, -1.45, 6.5, -0.4, 5.8, -0.4]]] },
    { layer: 0, function: 'voetpad', polygons: [[[8.6, -0.5, 9, -0.5, 9, 0.6, 8.6, 0.6]]] },
    { layer: 1, function: 'verkeerseiland', polygons: [[[5.8, -0.4, 6.5, -0.4, 6.5, 0.4, 5.8, 0.4]]] }
  ]);
  assert.equal(group.userData.crossings, 7);
  assert.equal(group.userData.zebras, 4);

  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  function paintAt(x, z) {
    ray.ray.origin.set(x, 10, z);
    return ray.intersectObjects(group.children)[0]?.object.material.color.getHex();
  }
  assert.ok(paintAt(5 + 1.19, 0));
  assert.ok(paintAt(5 - 1.19, 0.21));
  assert.equal(paintAt(5 + 1.19, -0.90), undefined);
  assert.ok(paintAt(5 - 1.19, -0.90));
  assert.equal(paintAt(5, 0), undefined);
  assert.equal(paintAt(5 + 1.19, 0.43), undefined);
  assert.ok(paintAt(10 + 1.1, 0.315));
  assert.equal(paintAt(10 - 1.1, 0.315), undefined);
  assert.equal(paintAt(10 + 1.1, 0.52), undefined);
  assert.equal(paintAt(10, 0.315), undefined);
  assert.ok(paintAt(15 - 0.8, -2.625));
  assert.ok(paintAt(15 + 0.8, -2.625));
  assert.equal(paintAt(15, -2.625), undefined);
  assert.ok(paintAt(20, -2.625));
  assert.ok(paintAt(20, -1.575));
  assert.equal(paintAt(20, -0.525), undefined);
  assert.ok(paintAt(20, 0.525));
  assert.equal(paintAt(25, -2.625), 0xeecc66);
  assert.equal(paintAt(25, -1.575), 0xff0000);
  assert.equal(paintAt(25, -0.525), 0xeecc66);
  assert.ok(paintAt(30, -2.625));
  assert.ok(paintAt(30 + 1.10, 0.315));
  for (const x of [35, 40, 45, 50]) assert.equal(paintAt(x + 1.15, 0.315), undefined);
  for (const offset of [0.925, 1.185]) assert.ok(paintAt(55 + offset, 0.37));
  assert.equal(paintAt(55 + 1.055, 0.37), undefined);
});

test('every explicitly painted crossing in the shipped asset reaches the mapped paint layer', async () => {
  const { THREE, buildEdeStreetFeaturesWorld } = await loadWorld();
  const { gunzipSync } = require('node:zlib');
  const asset = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets/ede-street-features.json.gz'))));
  const { surfaces } = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets/ede-road-surfaces.json.gz'))));
  const { group } = await buildEdeStreetFeaturesWorld(new THREE.Scene(), { crossings: asset.crossings }, surfaces);
  const marked = new Set(['dashes', 'dots', 'zebra']);
  assert.equal(group.userData.crossings, asset.crossings.filter(row => marked.has(row.markings)).length);
  assert.equal(group.userData.zebras, asset.crossings.filter(row => row.markings === 'zebra').length);
  assert.ok(group.children.every(mesh => mesh.material.name === 'Ede crossing paint'));
});


test('a matrix face shares the surveyed beam and clears a destination sign on its approach', async () => {
  const { matrixGantryMount } = await loadWorld();
  const sign = { x: 10, z: 1, layer: 1 };
  const gantry = { level: 1, x: 0, z: 0, ux: 1, uz: 0, length: 20, beam: 8, halfDepth: 0.5,
    panels: [{ x: 10, y: 8.5, z: 1, angle: 0, width: 5, height: 3 }] };
  const wrongLevel = { ...gantry, z: 0.8, level: 0 };
  const mount = matrixGantryMount(sign, [0, 1], [wrongLevel, gantry]);
  assert.equal(mount.gantry, gantry);
  assert.equal(mount.x, 10);
  assert.equal(mount.z, 0.5);
  assert.ok(Math.abs(mount.y - 6.61) < 1e-6);
  const opposite = matrixGantryMount(sign, [0, -1], [gantry]);
  assert.equal(opposite.z, -0.5);
  assert.ok(Math.abs(opposite.y - 7.44) < 1e-6);
  assert.equal(matrixGantryMount({ ...sign, x: 21 }, [0, 1], [gantry]), null);
});

test('a surveyed matrix board hangs directly under the beam with a short vertical bracket', async () => {
  const { THREE, collectSigns } = await loadWorld();
  const sign = { x: 10, z: 1.4, bearing: 180, placement: 'ABOVE', rvvCode: 'A3', faceKey: 'A3' };
  const atlas = { width: 80, height: 60, frames: { A3: [0, 0, 80, 60] }, map: new THREE.Texture() };
  const gantry = { level: 0, x: 0, z: 0, ux: 1, uz: 0, length: 20, beam: 8, halfDepth: 0.5, panels: [] };
  const faces = [], bracket = { positions: [], normals: [] };
  const stats = collectSigns([sign], atlas, (_material, _sign, points) => faces.push(...points), () => bracket, [gantry]);

  assert.equal(stats.mounted, 1);
  assert.equal(faces.length, 8);
  assert.ok(faces.every(([x, , z]) => Math.abs(x - sign.x) <= 0.44 && z > 0.5 && z < 0.56));
  assert.ok(bracket.positions.length > 0);
  for (let i = 0; i < bracket.positions.length; i += 3) {
    const [x, y, z] = bracket.positions.slice(i, i + 3);
    assert.ok(Math.abs(x - sign.x) < 0.06 && Math.abs(z - 0.5) < 0.06 && y >= 7.67 && y <= gantry.beam);
  }
});

test('a gantry can span the sunken lanes of its own motorway at Exit 24', async () => {
  const { matrixGantryMount } = await loadWorld();
  const { gunzipSync } = require('node:zlib');
  const readAsset = name => JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets', name + '.json.gz'))));
  const data = readAsset('ede-1gis-detail').features.find(feature => feature.id === '1gis:31:2102711040');
  const [[x, z], [endX, endZ]] = data.points;
  const length = Math.hypot(endX - x, endZ - z);
  const gantry = { ...data, x, z, length, ux: (endX - x) / length, uz: (endZ - z) / length,
    halfDepth: 0.8, beam: data.beamY - 22.54, panels: [] };
  const signs = readAsset('ede-street-features').signs.filter(sign =>
    sign.placement === 'ABOVE' && sign.rvvCode === 'A3' && Math.abs(sign.x - x) < 8 && Math.abs(sign.z - z) < length);
  assert.equal(signs.length, 3);
  for (const sign of signs) {
    assert.equal(sign.layer, -1);
    const bearing = sign.bearing * Math.PI / 180;
    const facing = [Math.sin(bearing), -Math.cos(bearing)];
    assert.equal(matrixGantryMount(sign, facing, [gantry])?.gantry, gantry);
    assert.equal(matrixGantryMount({ ...sign, roadName: 'Rijksweg A30' }, facing, [gantry]), null);
  }
});

test('nearby roadside signs share a lamp above its street-name board', async () => {
  const { THREE, collectSigns } = await loadWorld();
  const common = { kind: 'traffic', faceKey: 'B1', bearing: 0, placement: 'ALONG', z: 0 };
  const signs = [{ ...common, id: 'one', x: 0.12 }, { ...common, id: 'two', x: 0.26, bearing: 90 }];
  const atlas = { width: 80, height: 80, frames: { B1: [0, 0, 80, 80] }, map: new THREE.Texture() };
  const lamp = { kind: 'lamp', x: 0.2, z: 0, layer: 0, baseY: 2, topY: 10, radius: 0.11, reservedTop: 4.665 };
  const otherDeck = { ...lamp, x: 0.12, layer: 1 };
  const geometry = { positions: [], normals: [] }, faces = [];
  const stats = collectSigns(signs, atlas, (_material, _feature, points) => faces.push(points), () => geometry, [], [otherDeck, lamp]);
  assert.equal(stats.count, 2);
  assert.equal(stats.stackedRoadsidePoles, 1);
  assert.equal(stats.sharedSupports.length, 1);
  assert.equal(stats.sharedSupports[0].layer, 0);
  assert.equal(stats.sharedSupports[0].signs.join('/'), 'one/two');
  assert.ok(faces.flat().every(([, y]) => y > lamp.reservedTop));
  assert.ok(Math.min(...faces[2].map(([, y]) => y)) > Math.max(...faces[0].map(([, y]) => y)));
  assert.ok(Math.min(...geometry.positions.filter((_, i) => i % 3 === 1)) > 4, 'only brackets should be drawn');
});

test('co-located boards use a clear gantry leg and keep an independent pole when it would overhang the road', async () => {
  const sign = { id: 'gantry-sign', faceKey: 'D2', x: 0.25, z: 0, bearing: 0, placement: 'ALONG' };
  const support = { kind: 'gantry', x: -0.15, z: 0, layer: 0, baseY: 2, topY: 8, topX: 0.85, radius: 0.20 };
  for (const blocked of [false, true]) {
    const { THREE, collectSigns } = await loadWorld((x, z) => blocked && z < -0.1);
    const atlas = { width: 64, height: 64, frames: { D2: [0, 0, 64, 64] }, map: new THREE.Texture() };
    const pile = { positions: [], normals: [] };
    const stats = collectSigns([sign], atlas, () => {}, () => pile, [], [support]);
    assert.equal(stats.count, 1);
    assert.equal(stats.sharedSupports.length, blocked ? 0 : 1);
    if (blocked) assert.equal(Math.min(...pile.positions.filter((_, i) => i % 3 === 1)), 2);
  }
});
