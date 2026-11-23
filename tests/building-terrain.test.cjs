const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const read = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
}

class BufferGeometry {
  attributes = {};
  setAttribute(name, value) { this.attributes[name] = value; }
  setIndex(value) { this.index = value; }
  computeBoundingBox() {
    const { array } = this.attributes.position;
    this.boundingBox = { min: { x: Infinity, z: Infinity }, max: { x: -Infinity, z: -Infinity } };
    const { min, max } = this.boundingBox;
    for (let i = 0; i < array.length; i += 3) {
      min.x = Math.min(min.x, array[i]); max.x = Math.max(max.x, array[i]);
      min.z = Math.min(min.z, array[i + 2]); max.z = Math.max(max.z, array[i + 2]);
    }
  }
  computeBoundingSphere() {}
}

class Vector3 {
  fromBufferAttribute({ array }, i) {
    [this.x, this.y, this.z] = array.slice(i * 3, i * 3 + 3);
    return this;
  }
  applyMatrix4() { return this; }
  applyMatrix3() { return this; }
  normalize() { return this; }
}

function loadBag({ blocks = [], aerial = {}, grade = {}, three, facadeStubs = {},
  facadeStyle = () => null, isEdeShed = () => false, globals = {}, meta = {}, landmarks = {}, boundary = {} } = {}) {
  return loadModule(read('bag3d.js').replaceAll('export async function', 'async function'), {
    globals,
    imports: {
      'three/webgpu': three ?? {
        BufferGeometry, BufferAttribute, Vector3,
        Matrix4: class { multiplyMatrices() { return this; } },
        Matrix3: class { getNormalMatrix() { return this; } },
        Color: class { setHSL() { this.r = this.g = this.b = 0.5; } }
      },
      'three/tsl': {},
      'three/addons/loaders/GLTFLoader.js': {},
      'three/addons/libs/meshopt_decoder.module.js': {},
      './ede-scene-coordinates.js': loadModule(read('ede-scene-coordinates.js')),
      './ede-bag-exterior.js': { loadBagBoundaryOwnership: async () => null },
      './ede-playable-boundary.js': { playableBoundsCovered: () => true, playableBoundsOverlap: () => true, ...boundary },
      './nyc-geodata.js': { GEO: { ede: { meta: { bounds: [0, 0, 30, 30], ...meta } } } },
      './city-config.js': { BLOCKS: blocks },
      './building-collision.js': loadModule(read('building-collision.js')),
      './terrain.js': { terrainHeightAt: (x) => 10 + x / 2 },
      './ede-grade.js': { buildingPassageCuts: () => [], ...grade },
      './ede-building-bases.js': { EDE_BUILDING_BASES: [] },
      './ede-neighbourhood-facades.js': { edeFacadeAt: facadeStyle, isEdeShed },
      './ede-window-lights.js': { windowLightKey: () => 1.25 },
      './ede-landmark-sites.js': { landmarkBagExclusions: () => new Map(), landmarkBuildingCuts: () => [], ...landmarks },
      './ede-facades.js': { readBagBuildYears: async () => [], ...facadeStubs },
      './ede-facade-material.js': facadeStubs,
      './aerial-colors.js': { getAerialColors: () => false, ...aerial }
    }
  });
}

test('one surveyed building base shifts every BAG primitive and leaves neighbouring features alone', () => {
  const record = { bagId: '0228100000073270', y: 0.20 };
  const { bakeTile } = loadBag({ facadeStubs: { meshBagFacadeFeatures: (_, mesh, tables) => tables[mesh.table] } });
  const mesh = (table, rows, features) => ({ table, isMesh: true, geometry: { attributes: {
    position: new BufferAttribute(rows, 3), normal: new BufferAttribute(rows.map(() => 1), 3),
    _feature_id_0: new BufferAttribute(features, 1)
  } } });
  const pieces = [mesh(0, [4, 101, 1, 4, 105, 1, 14, 500, 5], [2, 2, 7]),
    mesh(1, [4, 106, 1, 4, 108, 1, 14, 508, 5], [8, 8, 7])];
  const gltf = { scene: { updateMatrixWorld() {}, traverse(fn) { pieces.forEach(fn); } } };
  const original = bakeTile(gltf, {});
  const corrected = bakeTile(gltf, {}, null, null, [new Map([[2, record]]), new Map([[8, record]])]);
  const target = [[0.2, 4.2], [5.2, 7.2]];
  corrected.forEach(({ attributes }, i) => {
    for (let j = 0; j < 2; j++) {
      assert.ok(Math.abs(attributes.position.getY(j) - target[i][j]) < 1e-5);
    }
    assert.equal(attributes.position.getY(2), original[i].attributes.position.getY(2));
  });
});

test('BAG gables use their eaves as the top of the window area', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { bakeTile } = loadBag({ three: T, facadeStyle: () => ({ color: 0x995a45, layout: [3, 2.85, 0.6, 0.56] }) });
  const wall = new T.BufferGeometry();
  wall.setAttribute('position', new T.Float32BufferAttribute([
    0,0,0, 6,0,0, 6,5.6,0, 3,8.8,0, 0,5.6,0
  ], 3));
  wall.setAttribute('normal', new T.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1], 3));
  wall.setAttribute('_feature_id_0', new T.Float32BufferAttribute([0,0,0,0,0], 1));
  wall.setIndex([0, 1, 2, 0, 2, 4, 4, 2, 3]);
  const scene = new T.Group();
  scene.add(new T.Mesh(wall));
  const [geometry] = bakeTile({ scene }, new T.Matrix4());
  const bay = geometry.attributes.edeFacadeBay;
  assert.equal(bay.count, 5);
  assert.deepEqual(Array.from({ length: bay.count }, (_, i) => bay.getX(i)), [0, 2, 2, 1, 0]);
  for (let i = 0; i < bay.count; i++) {
    assert.ok(Math.abs(bay.getY(i) - 5.6) < 1e-5);
    assert.equal(bay.getZ(i), 1.25);
  }
});

test('sheds outside neighbourhood styles replace matching BAG meshes and keep adjacent houses', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { isEdeShed } = loadModule(read('ede-neighbourhood-facades.js'), {
    imports: { './city-config.js': { toPts: () => [] }, './ede-geometry.js': {} }
  });
  assert.equal(isEdeShed({ kind: 'shed' }, 4), true);
  assert.equal(isEdeShed({ kind: 'yes', heightSource: 'default' }, 18), true);
  assert.equal(isEdeShed({ kind: 'yes', heightSource: 'default' }, 48), false);
  assert.equal(isEdeShed({ kind: 'house', heightSource: 'default' }, 18), false);
  assert.equal(isEdeShed({ kind: 'barn' }, 455), false);
  assert.equal(isEdeShed({ kind: 'yes', name: 'Utility building', heightSource: 'default' }, 18), false);
  const block = {
    osmId: 'shed', area: 9, minX: 0, minZ: 0, maxX: 3, maxZ: 3, holes: [],
    poly: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }],
    source: { kind: 'shed' }
  };
  const { bakeTile } = loadBag({ three: T, blocks: [block], isEdeShed });
  const src = new T.BufferGeometry();
  src.setAttribute('position', new T.Float32BufferAttribute([
    0,0,0, 3,0,0, 0,8,3,
    -2,0,0, 5,0,0, 0,8,3
  ], 3));
  src.setAttribute('normal', new T.Float32BufferAttribute(new Float32Array(18).fill(0), 3));
  src.setAttribute('_feature_id_0', new T.Float32BufferAttribute([0,0,0,1,1,1], 1));
  const scene = new T.Group();
  scene.add(new T.Mesh(src));
  const [geometry] = bakeTile({ scene }, new T.Matrix4());
  assert.deepEqual(Array.from(geometry.index.array), [3, 4, 5]);
});

test('BAG coverage requires building geometry rather than the tile bounds', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { coveredFallbackBuildings } = loadBag({ three: T });
  const square = (id, x, z, size) => ({ id, minX: x, minZ: z, maxX: x + size, maxZ: z + size,
    footprints: [{ pts: [{ x, z }, { x: x + size, z }, { x: x + size, z: z + size }, { x, z: z + size }], holes: [] }] });
  const a = new T.PlaneGeometry(5, 5).rotateX(-Math.PI / 2).translate(2.5, 0, 2.5);
  const b = new T.PlaneGeometry(5, 5).rotateX(-Math.PI / 2).translate(17.5, 0, 2.5);
  a.computeBoundingBox();
  b.computeBoundingBox();
  const fallback = { quadtree: { queryRange: () => [square('present', 0, 0, 5), square('gap', 6, 0, 7), square('partial', 13, 0, 5)] } };
  assert.deepEqual(Array.from(coveredFallbackBuildings([a, b], fallback)), ['present']);
});

const frame = { lon0: 5.67, lat0: 52.04, x: [0, 68600, 0], z: [0, 0, -111300] };

function sceneEcef(T, x, z, height = 0, affine = frame) {
  const { unprojectScene } = loadModule(read('ede-scene-coordinates.js'));
  const { lon, lat } = unprojectScene(affine, x, z);
  const phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
  const e2 = 0.0066943799901413165;
  const n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return new T.Vector3(
    (n + height) * Math.cos(phi) * Math.cos(lambda), (n + height) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - e2) + height) * Math.sin(phi)
  );
}

test('BAG follows parent, external tileset, and glTF node matrices before projecting into the scene', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { bakeTile, selectTileRecords, gltfToEcefMatrix, projectEcefToScene } = loadBag({
    three: T, meta: { bounds: [-100, -100, 100, 100], lonLatAffine: frame }, globals: { URL },
  });
  const center = sceneEcef(T, 25, -45, 100);
  const parent = new T.Matrix4().makeRotationZ(0.7).setPosition(center);
  const child = new T.Matrix4().makeTranslation(25, -12, 17);
  const local = new T.Matrix4().makeScale(1, 2, 3);
  const nested = new T.Matrix4().makeTranslation(-5, -2, 3);
  const expected = parent.clone().multiply(child).multiply(local);
  const box = [0, 0, 0, 50, 0, 0, 0, 50, 0, 0, 0, 50];
  const request = [];
  const [tile] = await selectTileRecords({ fetchJson: async url => {
    request.push(url);
    if (request.length === 1) return { root: {
      boundingVolume: { box }, transform: parent.toArray(),
      children: [{ boundingVolume: { box }, transform: child.toArray(), content: { uri: 'region/sub.json' } }]
    } };
    return { root: {
      boundingVolume: { box }, transform: local.toArray(), content: { uri: '../building.glb' }
    } };
  } });
  assert.ok(request[1].endsWith('/region/sub.json'));
  assert.ok(tile.url.endsWith('/lod22/building.glb'));
  assert.deepEqual(tile.transform.elements, expected.elements);

  const geometry = new T.PlaneGeometry(4, 4);
  const mesh = new T.Mesh(geometry);
  mesh.position.set(3, 4, 5);
  const root = new T.Group(), node = new T.Group();
  node.matrixAutoUpdate = false;
  node.matrix.copy(nested);
  root.add(node.add(mesh));
  const convert = p => projectEcefToScene(frame, p);
  const content = gltfToEcefMatrix(tile.transform);
  const [result] = bakeTile({ scene: root }, content, null, null, null, null, null, convert);
  const sourcePosition = new T.Vector3().fromBufferAttribute(geometry.attributes.position, 0);
  const expectedPosition = convert(sourcePosition.applyMatrix4(mesh.matrixWorld).applyMatrix4(content));
  const position = result.attributes.position;
  assert.ok(Math.abs(position.getX(0) - expectedPosition.x) < 1e-5);
  assert.ok(Math.abs(position.getZ(0) - expectedPosition.z) < 1e-5);
  assert.ok(tile.bounds.containsPoint(new T.Vector3(position.getX(0), position.getY(0), position.getZ(0))));
  const independentControl = convert(sceneEcef(T, 80, 78, 125));
  assert.ok(Math.hypot(independentControl.x - 80, independentControl.z - 78) < 1e-7);
  assert.ok(Math.abs(independentControl.y - 125) < 1e-7);
});

test('ECEF controls agree with the stored geographic affine at every playable corner', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const [west, north, east, south] = EDE_DATA.meta.bounds;
  const affine = EDE_DATA.meta.lonLatAffine;
  const { projectEcefToScene } = loadBag({ three: T });
  for (const [x, z] of [[0, 0], [west, north], [west, south], [east, north], [east, south]]) {
    const p = projectEcefToScene(affine, sceneEcef(T, x, z, 75, affine));
    assert.ok(Math.hypot(p.x - x, p.z - z) < 1e-7);
    assert.ok(Math.abs(p.y - 75) < 1e-7);
  }
});

test('BAG starts from fallback, bounds downloads, cancels stale work on a jump, and restores evicted coverage', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { createBagBuildingStream, gltfToEcefMatrix } = loadBag({ three: T,
    meta: { bounds: [-200, -200, 2200, 200], lonLatAffine: frame },
    globals: { performance, URL, AbortController, setTimeout, document: { hidden: false }, console },
    facadeStubs: { loadEdeFacades: async () => null, createBagFacadeMaterial: () => new T.MeshBasicMaterial() }
  });
  const toGltf = gltfToEcefMatrix(new T.Matrix4()).invert();
  function tile(x, extent, uri) {
    const center = sceneEcef(T, x, 0);
    const box = [...center.toArray(), extent, 0, 0, 0, extent, 0, 0, 0, extent];
    return { boundingVolume: { box }, ...(uri && { content: { uri } }) };
  }
  const root = { ...tile(800, 1600), children: [tile(0, 20, 'start.glb'), tile(75, 20, 'cancel.glb'), tile(170, 20, 'queue.glb'), tile(1800, 20, 'jump.glb')] };
  const pending = [];
  const loadBuffer = (url, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    pending.push({ url, signal, resolve });
  });
  const loader = { async parseAsync(buffer) {
    const x = new Float64Array(buffer)[0];
    const geo = new T.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
    const mesh = new T.Mesh(geo);
    mesh.matrixAutoUpdate = false;
    const center = sceneEcef(T, x, 0);
    const axes = [sceneEcef(T, x + 1, 0), sceneEcef(T, x, 0, 1), sceneEcef(T, x, 1)];
    const toEcef = new T.Matrix4().makeBasis(...axes.map(v => v.sub(center))).setPosition(center);
    mesh.matrix.multiplyMatrices(toGltf, toEcef);
    return { scene: new T.Group().add(mesh) };
  } };
  const changes = [];
  const fallback = {
    replaceBuildings(ids, loaded) { changes.push([Array.from(ids), loaded]); },
    quadtree: { queryRange(x) { return [{ id: x > 1000 ? 'jump' : 'start', minX: x - 4, maxX: x + 4, minZ: -4, maxZ: 4,
      footprints: [{ pts: [{ x: x - 4, z: -4 }, { x: x + 4, z: -4 }, { x: x + 4, z: 4 }, { x: x - 4, z: 4 }], holes: [] }] }]; } }
  };
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(55, 1, 0.1, 2000);
  const focus = x => { camera.position.set(x, 6, 45); camera.lookAt(x, 0, 0); };
  const stream = createBagBuildingStream(scene, { fallback, fetchJson: async () => ({ root }), loader, loadBuffer });
  const { update, stats, setEnabled, dispose } = stream.userData;
  const drain = () => new Promise(resolve => setTimeout(resolve, 4));
  assert.equal(stats.resident, 0);
  focus(0);
  update(camera);
  await drain();
  update(camera);
  assert.deepEqual(pending.map(p => p.url.split('/').at(-1)), ['start.glb', 'cancel.glb']);
  pending[0].resolve(new Float64Array([0]).buffer);
  await drain();
  update(camera);
  await drain();
  assert.deepEqual(changes, [[['start'], true]]);
  let released = false;
  stream.children[0].children[0].geometry.addEventListener('dispose', () => { released = true; });
  focus(1800);
  update(camera);
  assert.equal(released, true);
  assert.deepEqual(changes.at(-1), [['start'], false]);
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(pending.at(-1).url.endsWith('jump.glb'), true);
  pending.at(-1).resolve(new Float64Array([1800]).buffer);
  await drain();
  update(camera);
  await drain();
  assert.deepEqual(changes.at(-1), [['jump'], true]);
  setEnabled(false);
  assert.equal(stats.resident, 0);
  assert.equal(stats.geometryBytes, 0);
  assert.deepEqual(changes.at(-1), [['jump'], false]);
  dispose();
  assert.equal(stream.parent, null);
});

test('BAG replaces only the named landmark features in a shared tile', () => {
  const { bakeTile } = loadBag({ facadeStubs: { meshBagFacadeFeatures: (_, mesh, tables) => tables[mesh.table] } });
  const mesh = { table: 0, isMesh: true, geometry: { attributes: {
    position: new BufferAttribute([1,0,0, 2,0,0, 2,2,0, 3,0,0, 4,0,0, 4,2,0], 3),
    normal: new BufferAttribute([0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1], 3),
    _feature_id_0: new BufferAttribute([6,6,6, 7,7,7], 1),
  } } };
  const gltf = { scene: { updateMatrixWorld() {}, traverse(fn) { fn(mesh); } } };
  const [kept] = bakeTile(gltf, {}, null, null, null, [new Map([[6, true]])]);
  assert.deepEqual(Array.from(kept.index.array), [3, 4, 5]);
  assert.equal(bakeTile(gltf, {}, null, null, null, [new Map([[6, true], [7, true]])]).length, 0);
});

test('a municipal edge tile retains only complete in-bounds BAG features', () => {
  const { bakeTile } = loadBag({ boundary: { playableBoundsCovered: (minX, minZ, maxX) => maxX <= 3.5 } });
  const mesh = { isMesh: true, geometry: { attributes: {
    position: new BufferAttribute([1,0,0, 2,0,0, 2,2,0, 3,0,0, 4,0,0, 4,2,0], 3),
    normal: new BufferAttribute([0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1], 3),
    _feature_id_0: new BufferAttribute([6,6,6, 7,7,7], 1),
  } } };
  const gltf = { scene: { updateMatrixWorld() {}, traverse(fn) { fn(mesh); } } };
  const [kept] = bakeTile(gltf, {}, null, null, null, null, null, null, true);
  assert.deepEqual(Array.from(kept.index.array), [0, 1, 2]);
});

test('a landmark switches visible models without hiding its static sun-shadow silhouette', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const { CivicBatch, addLandmarkLod } = loadModule(read('ede-civic-landmarks.js'), {
    imports: {
      'three/webgpu': three, 'three/tsl': await import('../vendor/three/build/three.tsl.js'),
      './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': {}, './terrain.js': {},
      './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
    },
  });
  const { setupSceneCulling, SHADOW_PROXY_LAYER } = loadModule(read('scene-culling.js'), {
    imports: { 'three/webgpu': three },
  });
  const scene = new three.Scene(), landmark = new three.Group();
  const batch = new CivicBatch();
  batch.solid(new three.BoxGeometry(10, 7, 13).translate(5, 3.5, 7), 0x786057);
  const closeUp = new three.Mesh(new three.BoxGeometry(10, 7, 13, 3, 3, 3), new three.MeshBasicMaterial());
  closeUp.castShadow = true;
  landmark.add(closeUp);
  scene.add(landmark);
  addLandmarkLod(landmark, batch, 180);
  const camera = new three.PerspectiveCamera(), shadowCamera = new three.OrthographicCamera();
  setupSceneCulling(scene, [landmark], { getViewportCount: () => 1, getCamera: () => shadowCamera });
  const { silhouette, detailedModel } = landmark.userData.landmarkLod;
  const proxy = scene.children.find(object => object.userData.shadowProxy);
  assert.ok(proxy);
  assert.equal(proxy.geometry.attributes.position.count, 36);
  assert.equal(closeUp.castShadow, false);
  assert.equal(silhouette.castShadow, false);
  assert.equal(silhouette.geometry.attributes.position.count, proxy.geometry.attributes.position.count);
  silhouette.visible = false;
  assert.equal(detailedModel.visible, true);
  assert.equal(proxy.visible && proxy.castShadow, true);
  assert.equal(proxy.layers.isEnabled(SHADOW_PROXY_LAYER), true);
  assert.equal(proxy.layers.test(camera.layers), false);
  assert.equal(proxy.layers.test(shadowCamera.layers), true);
});

test('aerial town tiles keep their shells across the map boundary and restore street detail when descending', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const { createExpansionCulling } = loadModule(read('scene-culling.js'), {
    imports: { 'three/webgpu': THREE },
  });
  const scene = new THREE.Scene();
  const roots = ['EdeCityGrid', 'EdeCityBlocks', 'EdeLandmarks', 'EdeGradeWorld'].map(name => {
    const group = new THREE.Group();
    group.name = name;
    scene.add(group);
    return group;
  });
  const [ground, buildings, landmarks, grade] = roots;
  const mesh = (group, name, x) => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
    object.name = name;
    object.position.set(x, 40, 1000);
    group.add(object);
    return object;
  };
  const terrain = mesh(ground, 'Ede legacy terrain', 750);
  const rail = mesh(ground, 'Ede rails', 750);
  const water = mesh(ground, 'Water', 750);
  water.userData.keepInAerial = true;
  const paving = mesh(ground, 'Paving', 750);
  const chimney = mesh(landmarks, 'ENKA chimney', 750);
  const deck = mesh(grade, 'Rail deck', 750);
  const walls = mesh(buildings, 'Detailed walls', 750);
  const roofs = mesh(buildings, 'Detailed roofs', 750);
  const shell = mesh(buildings, 'Aerial shell', 750);
  walls.userData.buildingTile = roofs.userData.buildingTile = shell.userData.buildingTile =
    { minX: 610, maxX: 890, minZ: 960, maxZ: 1040 };
  shell.userData.aerialBuildingProxy = true;
  shell.visible = false;
  roofs.visible = false; // A resident BAG tile owns these roofs.
  scene.updateMatrixWorld(true);

  const culling = createExpansionCulling(roots, [0, 0, 3000, 2000], () => 40);
  const camera = new THREE.PerspectiveCamera();
  const at = (x, altitude) => {
    camera.position.set(x, 40 + altitude, 1000);
    culling.update(camera);
  };
  const rendered = object => object.visible && object.layers.isEnabled(0);
  for (const altitude of [40, 100]) {
    for (const x of [2999, 3001, 2999]) {
      at(x, altitude);
      assert.ok(rendered(shell));
      assert.equal(culling.stats.aerialShells, 1);
      assert.ok([walls, roofs, paving].every(object => !object.layers.isEnabled(0)));
      assert.ok([terrain, rail, water, chimney, deck].every(rendered));
    }
  }

  at(750, 40);
  assert.ok(rendered(walls));
  assert.ok(!rendered(shell));
  at(1935, 30);
  assert.ok(rendered(walls) && !rendered(shell));
  at(1935, 36);
  assert.ok(rendered(shell) && !rendered(walls));
  at(1935, 17);
  assert.ok(!rendered(shell));
  assert.ok(rendered(walls) && rendered(paving));
  assert.ok(roofs.layers.isEnabled(0) && !roofs.visible);

  at(2999, 2);
  assert.ok(rendered(shell));
  assert.ok(!rendered(walls) && !rendered(paving));
  assert.ok([terrain, rail, water, chimney, deck].every(rendered));
});

test('surveyed landmarks exclude only their surveyed buildings across both building sources', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const landmarks = await import('../js/ede-landmark-sites.js');
  const { ESTATE_SURVEY } = await import('../js/ede-estate-survey.js');
  const { NIZO_SURVEY, GELDERSE_VALLEI_SURVEY } = await import('../js/ede-research-survey.js');
  const { INDUSTRIAL_SKYLINE_SHELLS } = await import('../js/ede-industrial-skyline-survey.js');
  const { KUIL_SHELLS, PALLAS_SHELLS, TECHNOVA_SHELLS, TESQUA_SHELLS } = await import('../js/ede-next-survey.js');
  const { REEHORST, BUITENZORG, JOHANNUS } = await import('../js/ede-venue-survey.js');
  const { PUBLIC_LANDMARK_SURVEYS } = await import('../js/ede-public-survey.js');
  const { SCHOOL_SURVEYS } = await import('../js/ede-school-survey.js');
  const { SPORT_LANDMARK_SURVEYS } = await import('../js/ede-sport-landmark-survey.js');
  const { AMSTERDAMSEWEG_SURVEYS } = await import('../js/ede-amsterdamseweg-survey.js');
  const { NIJVERHEIDPLEIN_SURVEYS } = await import('../js/ede-nijverheidplein-survey.js');
  const { EDE_STATIONSWEG_LANDMARKS, STATIONSWEG_SURVEYS } = await import('../js/ede-stationsweg-survey.js');
  const { EDE_RESTAURANT_ROW_LANDMARKS, RESTAURANT_ROW_SURVEYS } = await import('../js/ede-restaurant-row-survey.js');
  const { RESTAURANT_ESTATE_SURVEYS } = await import('../js/ede-restaurant-estate-survey.js');
  const { POMPHUIS_SHELL } = await import('../js/ede-pomphuis-survey.js');
  const { OTHER_CHURCH_SHELLS } = await import('../js/ede-other-church-shells.js');
  const { CHURCH_STYLES } = await import('../js/ede-church-styles.js');
  assert.deepEqual(Object.keys(CHURCH_STYLES).sort(), Object.keys(OTHER_CHURCH_SHELLS).sort());
  const sites = new Map(landmarks.EDE_MODELED_LANDMARKS.map(site => [site.id, site]));
  const osm = new Set(EDE_DATA.buildings.map(building => building.id));
  const newSites = [
    ['hoekelum', ['castle', 'coach'].map(key => ESTATE_SURVEY[key])],
    ['nizo', [...NIZO_SURVEY, ...INDUSTRIAL_SKYLINE_SHELLS['nizo-north']]], ['ziekenhuis', GELDERSE_VALLEI_SURVEY],
    ['openluchttheater', KUIL_SHELLS],
    ['reehorst', [REEHORST]], ['buitenzorg', [BUITENZORG]], ['johannus-orgelbouw', [JOHANNUS]],
    ['technova', TECHNOVA_SHELLS],
    ['gasfabriek', ['works', 'purifier', 'wkeeper'].map(key => ESTATE_SURVEY[key])],
    ['tesqua', TESQUA_SHELLS], ['pallas-athene', PALLAS_SHELLS],
    ...Object.entries(OTHER_CHURCH_SHELLS).map(([id, shell]) => [id, [shell]]),
    ...Object.entries(PUBLIC_LANDMARK_SURVEYS), ...Object.entries(SCHOOL_SURVEYS),
    ...Object.entries(SPORT_LANDMARK_SURVEYS),
    ...Object.entries(AMSTERDAMSEWEG_SURVEYS), ...Object.entries(NIJVERHEIDPLEIN_SURVEYS),
    ...EDE_STATIONSWEG_LANDMARKS.map(site => [site.id, site.bagIds.map(id => STATIONSWEG_SURVEYS[id])]),
    ...EDE_RESTAURANT_ROW_LANDMARKS.map(site => [site.id, site.bagIds.map(id => RESTAURANT_ROW_SURVEYS[id])]),
    ...Object.entries(RESTAURANT_ESTATE_SURVEYS), ['het-pomphuis', [POMPHUIS_SHELL]],
  ];
  const museumplein = landmarks.landmarkBagExclusions({ min: { x: -240, z: 331 }, max: { x: -212, z: 357 } });
  assert.ok(!museumplein.has('0228100000058648') && !museumplein.has('0228100000068490'),
    'Villa Brutus conservatory keeps both existing restaurant and neighbour shells');
  for (const [key, models] of newSites) {
    const site = sites.get(key);
    assert.equal(site.bagIds.length, models.length);
    for (const id of [site.osmId, ...(site.annexOsmIds ?? [])]) assert.ok(osm.has(id), id);
    for (const [i, model] of models.entries()) {
      const id = model.id ?? model.bag ?? model.bagId ?? site.bagIds[i];
      assert.ok(site.bagIds.includes(id));
      const vertices = model.points ?? model.vertices;
      const xs = vertices.map(p => p[0]), zs = vertices.map(p => p[2]);
      const box = { min: { x: Math.min(...xs), z: Math.min(...zs) }, max: { x: Math.max(...xs), z: Math.max(...zs) } };
      const excluded = landmarks.landmarkBagExclusions(box);
      assert.ok(excluded.has(id), id);
      assert.equal(excluded.has('0228100000999999'), false);
    }
  }
});

test('Concordia replaces the four surveyed building features without excluding its neighbors', async () => {
  const { CONCORDIA_SURVEY } = await import('../js/ede-concordia-survey.js');
  const { EDE_MODELED_LANDMARKS, landmarkBagExclusions, modeledLandmarkFootprints } = await import('../js/ede-landmark-sites.js');
  const site = EDE_MODELED_LANDMARKS.find(item => item.id === 'concordiamolen');
  const bounds = { min: { x: -423, z: -126 }, max: { x: -358, z: -63 } };
  const surveyed = Object.values(CONCORDIA_SURVEY).map(part => part.id).sort();
  assert.deepEqual([...landmarkBagExclusions(bounds).keys()].sort(), surveyed);
  assert.equal(modeledLandmarkFootprints(site).length, surveyed.length + 1);
  assert.ok(!landmarkBagExclusions(bounds).has('0228100000000210')); // Molenstaete and Concordiastaete
});

test('BAG removes the old ENKA shaft and keeps geometry outside its mapped footprint', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const landmarks = await import('../js/ede-landmark-sites.js');
  const { x, z } = landmarks.EDE_MODELED_LANDMARKS.find(site => site.id === 'grote-enka-schoorsteen');
  const { carveBagBuildingPassages } = loadBag({ three, landmarks });
  const facade = new three.PlaneGeometry(14, 82).translate(x, 41, z);
  facade.computeBoundingBox();
  carveBagBuildingPassages(facade);
  const mesh = new three.Mesh(facade, new three.MeshBasicMaterial({ side: three.DoubleSide }));
  const wallAt = (dx, y) => new three.Raycaster(new three.Vector3(x + dx, y, z - 1), new three.Vector3(0, 0, 1))
    .intersectObject(mesh).length > 0;
  assert.equal(wallAt(5.25, 3), false);
  assert.equal(wallAt(5.25, 75), false);
  assert.equal(wallAt(6, 3), true);
});

test('BAG clears the Raadhuisstraat portal below its posted soffit and preserves the upper facade', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const grade = await import('../js/ede-grade.js');
  const { profile } = grade.getEdeBuildingPassages().get('w274278314');
  const { carveBagBuildingPassages } = loadBag({ grade, three });
  const [a, b] = profile.points;
  const origin = new three.Vector3(a[0], 0, a[1]);
  const direction = new three.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize();
  const side = new three.Vector3(direction.z, 0, -direction.x);
  const position = [-6, 6].flatMap(offset => [0, 8].flatMap(y =>
    origin.clone().addScaledVector(side, offset).setY(y).toArray()));
  const facade = new three.BufferGeometry();
  facade.setAttribute('position', new three.Float32BufferAttribute(position, 3));
  facade.setAttribute('buildingHeight', new three.Float32BufferAttribute([0, 8, 0, 8], 1));
  facade.setIndex([0, 2, 1, 1, 2, 3]);
  facade.computeBoundingBox();
  carveBagBuildingPassages(facade);
  facade.computeBoundingSphere();
  const mesh = new three.Mesh(facade, new three.MeshBasicMaterial({ side: three.DoubleSide }));
  const intersects = (y, offset = 0) => new three.Raycaster(
    origin.clone().addScaledVector(direction, -2).addScaledVector(side, offset).setY(y), direction
  ).intersectObject(mesh).length > 0;
  assert.equal(intersects(4.1), false);
  assert.equal(intersects(4.3), true);
  assert.equal(intersects(1.5, 5), true);
  const { position: vertices, buildingHeight } = facade.attributes;
  assert.ok(vertices.count > 4);
  for (let i = 0; i < vertices.count; i++) assert.equal(vertices.getY(i), buildingHeight.getX(i));
});

test('fitted passages cut two openings through the same BAG facade and retain the slab between them', async t => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const grade = await import('../js/ede-grade.js');
  const prior = grade.getEdeGrade();
  t.after(() => grade.setEdeGrade(prior));
  grade.setEdeGrade({ sites: [0, 5].map((y, i) => ({
    id: i, kind: i ? 'bridge' : 'underpass', profiles: [{ id: `opening-${i}`, modes: ['foot'], points: [[0, -6, y], [0, 6, y]],
      width: 4, covered: [2, 10], clearance: 2.5, cutBuildings: true }]
  })) });
  const { carveBagBuildingPassages } = loadBag({ grade, three });
  const facade = new three.PlaneGeometry(12, 12).translate(0, 4, 0);
  facade.computeBoundingBox();
  carveBagBuildingPassages(facade);
  const mesh = new three.Mesh(facade, new three.MeshBasicMaterial({ side: three.DoubleSide }));
  const wallAt = (y, x = 0.2) => new three.Raycaster(new three.Vector3(x, y, -2), new three.Vector3(0, 0, 1))
    .intersectObject(mesh).length > 0;
  assert.equal(wallAt(-0.5), true);
  assert.equal(wallAt(1), false);
  assert.equal(wallAt(4), true);
  assert.equal(wallAt(6), false);
  assert.equal(wallAt(8), true);
  assert.equal(wallAt(6, 3), true);
});

function bakeGeometry(bakeTile, geometry) {
  const scene = {
    updateMatrixWorld() {},
    traverse(visit) { visit({ isMesh: true, geometry }); }
  };
  return bakeTile({ scene }, null)[0];
}

test('BAG seats each feature on its own low edge and preserves its roof and horizontal position', () => {
  const { bakeTile } = loadBag();
  const positions = [4, 58, 1, 0, 58.125, 2, 2, 67, 3, 20, 79, 4, 21, 85, 5];
  const source = {
    attributes: {
      position: new BufferAttribute(positions, 3),
      normal: new BufferAttribute(new Array(positions.length).fill(0), 3),
      _feature_id_0: new BufferAttribute([0, 0, 0, 1, 1], 1)
    }
  };
  const baked = bakeGeometry(bakeTile, source);
  assert.deepEqual(Array.from(baked.attributes.position.array), [
    4, 9.875, 1, 0, 10, 2, 2, 18.875, 3, 20, 20, 4, 21, 26, 5
  ]);
  assert.deepEqual(Array.from(baked.attributes.buildingHeight.array), [0, 0.125, 9, 0, 6]);
});

test('BAG colors roofs once per feature and keeps shared wall vertices and undersides procedural', () => {
  const mappedTint = [0.25, 0.125, 0.125], estimatedTint = [0.375, 0.25, 0.25];
  const roofIds = [], points = [];
  const { bakeTile } = loadBag({
    blocks: [{
      osmId: 'roof-id', minX: -1, maxX: 9, minZ: -1, maxZ: 9, area: 100,
      poly: [{ x: -1, z: -1 }, { x: 9, z: -1 }, { x: 9, z: 9 }, { x: -1, z: 9 }], holes: []
    }],
    aerial: {
      getAerialColors: () => true,
      sampleRoofColor(id, out) {
        roofIds.push(id);
        out.splice(0, 3, ...mappedTint);
        return true;
      },
      sampleGroundColor(x, z, out) {
        const samples = [[0.0625, 0.0625, 0.0625], estimatedTint, [1, 1, 1], estimatedTint];
        out.splice(0, 3, ...samples[points.length]);
        points.push([x, z]);
        return true;
      }
    }
  });
  const positions = [0, 6, 0, 0, 6, 8, 8, 6, 0, 0, 0, 0, 8, 0, 0, 0, 0, 8];
  const shifted = positions.map((value, i) => i % 3 === 0 ? value + 20 : value);
  const index = [0, 1, 2, 0, 3, 1, 3, 4, 5];
  const source = {
    index: new BufferAttribute([...index, ...index.map(i => i + 6)], 1),
    attributes: {
      position: new BufferAttribute([...positions, ...shifted], 3),
      normal: new BufferAttribute(new Array(positions.length * 2).fill(0), 3),
      _feature_id_0: new BufferAttribute([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], 1)
    }
  };
  const baked = bakeGeometry(bakeTile, source);
  assert.deepEqual(roofIds, ['roof-id']);
  assert.equal(points.length, 4);
  assert.ok(points.every(([x, z]) => x > 20 && z > 0 && x + z < 28));
  assert.equal(baked.attributes.position.count, 16);
  const vertices = Array.from(baked.index.array);
  const color = vertices.flatMap(i => Array.from(baked.attributes.color.array.slice(i * 3, i * 3 + 3)));
  assert.deepEqual(color.slice(0, 9), [...mappedTint, ...mappedTint, ...mappedTint]);
  assert.deepEqual(color.slice(9, 27), new Array(18).fill(0.5));
  assert.deepEqual(color.slice(27, 36), [...estimatedTint, ...estimatedTint, ...estimatedTint]);
  assert.deepEqual(color.slice(36), new Array(18).fill(0.5));
  assert.deepEqual(vertices.map(i => baked.attributes.buildingHeight.getX(i)), [
    6, 6, 6, 6, 0, 6, 0, 0, 0, 6, 6, 6, 6, 0, 6, 0, 0, 0
  ]);
});

test('Kernhem roof colours apply to pitched BAG faces when aerial imagery is unavailable', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const tiles = 0xb85b36;
  const { bakeTile } = loadBag({ three: T, facadeStyle: () => ({ color: 0x995a45, layout: [3, 3, 0.6, 0.56], roofColor: tiles }) });
  const source = new T.BufferGeometry();
  source.setAttribute('position', new T.Float32BufferAttribute([0,6,0, 0,6,6, 6,9,0, -6,6,0, 0,0,0], 3));
  source.setAttribute('normal', new T.Float32BufferAttribute([0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0], 3));
  source.setAttribute('_feature_id_0', new T.Float32BufferAttribute([0,0,0,0,0], 1));
  source.setIndex([0, 1, 2, 0, 3, 1, 0, 4, 1]);
  const scene = new T.Group();
  scene.add(new T.Mesh(source));
  const [baked] = bakeTile({ scene }, new T.Matrix4());
  const { color } = baked.attributes;
  const reds = Array.from(baked.index.array, i => color.getX(i));
  const expectedRed = new T.Color(tiles).r;
  assert.ok(reds.slice(0, 3).every(red => Math.abs(red - expectedRed) < 1e-5));
  assert.ok(reds.slice(3).every(red => Math.abs(red - expectedRed) > 0.05));
});

test('OSM roofs use their mapped tint on the slopes and the existing color on gable ends', () => {
  const source = read('buildings.js');
  const imports = Object.fromEntries(Array.from(source.matchAll(/from '([^']+)';/g), ([, specifier]) => [specifier, {}]));
  imports['three/webgpu'] = { BufferAttribute };
  imports['./ede-building-bases.js'] = { EDE_BUILDING_BASES: [] };
  let sampledId;
  const tint = [0.25, 0.125, 0.125], fallback = [0.125, 0.25, 0.375];
  imports['./aerial-colors.js'] = {
    sampleRoofColor(id, out) {
      sampledId = id;
      if (id !== 'roof-id') return false;
      out.splice(0, 3, ...tint);
      return true;
    }
  };
  const { colorEdeRoof } = loadModule(`${source}\nexport { colorEdeRoof };`, { imports });
  const roof = new BufferGeometry();
  roof.setAttribute('normal', new BufferAttribute([0.6, 0.8, 0, 1, 0, 0, 0, -1, 0], 3));
  colorEdeRoof(roof, 'roof-id', fallback, []);
  assert.equal(sampledId, 'roof-id');
  assert.deepEqual(Array.from(roof.attributes.color.array), [...tint, ...fallback, ...fallback]);
  colorEdeRoof(roof, 'unmapped', fallback, []);
  assert.deepEqual(Array.from(roof.attributes.color.array), [...fallback, ...fallback, ...fallback]);
  const tiles = [0.5, 0.25, 0.125];
  colorEdeRoof(roof, 'roof-id', fallback, [], tiles);
  assert.equal(sampledId, 'unmapped');
  assert.deepEqual(Array.from(roof.attributes.color.array), [...tiles, ...fallback, ...fallback]);
});

test('shop signs keep the same wall position and inherit facade or local street height', () => {
  const { createShopSigns } = loadModule(read('shop-signs.js'), {
    imports: {
      'three/webgpu': {
        BufferGeometry, Float32BufferAttribute: BufferAttribute,
        CanvasTexture: class {},
        MeshBasicNodeMaterial: class {},
        Mesh: class {
          userData = {};
          constructor(geometry) { this.geometry = geometry; }
        }
      },
      './ede-shops.js': { EDE_SHOPS: [['Shop', 6, -1]] },
      './city-config.js': { waterAt: () => false },
      './terrain.js': { terrainHeightAt: (x) => 20 + x / 2 }
    },
    globals: {
      document: {
        createElement: () => ({
          getContext: () => ({ fillRect() {}, fillText() {}, measureText: () => ({ width: 50 }) })
        })
      }
    }
  });
  const building = { ring: [0, 0, 12, 0, 12, 6, 0, 6] };
  const osm = createShopSigns([building], new Map([[building, 26]])).geometry.attributes.position.array;
  const bag = createShopSigns([building]).geometry.attributes.position.array;
  for (let i = 0; i < osm.length; i += 3) {
    assert.deepEqual([osm[i], osm[i + 2]], [bag[i], bag[i + 2]]);
    assert.equal(osm[i + 1] - bag[i + 1], 3);
  }
  assert.ok(Math.abs((bag[1] + bag[7]) / 2 - (23 + 3.4)) < 1e-8);
});

test('authoritative BAG ownership keeps whole Ede-majority geometry and removes the exterior ID', () => {
  const boundary = { playableBoundsCovered: (minX, minZ, maxX) => maxX <= 3.5 };
  const { bakeTile } = loadBag({ boundary, facadeStubs: { meshBagFacadeFeatures: (_, mesh, tables) => tables[mesh.table] } });
  const mesh = { table: 0, isMesh: true, geometry: { attributes: {
    position: new BufferAttribute([1,0,0, 2,0,0, 2,2,0, 3,0,0, 4,0,0, 4,2,0], 3),
    normal: new BufferAttribute([0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1], 3),
    _feature_id_0: new BufferAttribute([6,6,6, 7,7,7], 1),
  } } };
  const gltf = { scene: { updateMatrixWorld() {}, traverse(fn) { fn(mesh); } } };
  const [kept] = bakeTile(gltf, {}, null, null, null, null, null, null, true, [new Map([[6, -1], [7, 1]])]);
  assert.deepEqual(Array.from(kept.index.array), [3, 4, 5]);
});

test('exterior BAG tiles share the map footprints and keep a courtyard in the fallback', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { buildExteriorBagTile } = loadModule(read('ede-bag-exterior.js').replace('import.meta.url', 'moduleUrl'), {
    globals: { URL, moduleUrl: 'https://example.test/js/ede-bag-exterior.js' },
    imports: { 'three/webgpu': T, './terrain.js': {} },
  });
  const id = '0228100000000000';
  const footprint = { id, minX: 100, maxX: 110, minZ: 200, maxZ: 210,
    polygons: [[[100,200, 110,200, 110,210, 100,210], [102,202, 102,204, 104,204, 104,202]]] };
  const footprints = new Map([[id, footprint]]);
  const ground = (x, z) => (x - 100) / 10 + (z - 200) / 10;
  const fallback = buildExteriorBagTile([[id, 'height', null, 4, [], []]], footprints, 100, 200, ground);
  const { position, normal } = fallback.attributes;
  const { start, count } = fallback.groups[1];
  let roofArea = 0;
  for (let i = start; i < start + count; i += 3) {
    const ax = position.getX(i), az = position.getZ(i);
    const ux = position.getX(i + 1) - ax, uz = position.getZ(i + 1) - az;
    const vx = position.getX(i + 2) - ax, vz = position.getZ(i + 2) - az;
    roofArea += (uz * vx - ux * vz) / 2;
    assert.equal(position.getY(i), 5);
    assert.equal(normal.getY(i), 1);
  }
  assert.equal(roofArea, 96);
  const detail = buildExteriorBagTile([
    [id, '2.2', 2, null, [0,0,0, 100,0,0, 0,120,0], [0,120,0, 100,180,0, 0,120,100]],
  ], footprints, 100, 200, ground).attributes.position;
  assert.equal(detail.getY(0), -0.25);
  assert.equal(detail.getY(3), Math.fround(3.2));
  assert.equal(detail.getY(4), Math.fround(3.8));
});


test('exterior BAG tiles and gray map footprints share one record per BAG ID', () => {
  const directory = join(__dirname, '../assets/ede-bag-exterior');
  const packed = name => JSON.parse(gunzipSync(readFileSync(join(directory, name))));
  const index = JSON.parse(readFileSync(join(directory, 'index.json')));
  const footprints = packed('footprints.json.gz');
  const ownership = new Map(packed('ownership.json.gz'));
  const tiles = index.tiles.flatMap(([, , name]) => packed(name));
  const ids = new Set(tiles.map(([id]) => id));
  assert.equal(ids.size, tiles.length);
  assert.equal(ids.size, footprints.length);
  assert.equal(ids.size, Object.values(index.counts).reduce((a, b) => a + b, 0));
  for (const { id } of footprints) {
    assert.ok(ids.has(id), id);
    assert.equal(ownership.get(id), false, id);
  }
  const overlap = tiles.find(([id]) => id === '0228100000068408');
  assert.equal(overlap[1], '2.2');
  assert.ok(overlap[4].length && overlap[5].length);
});

test('gray BAG colliders exist independently of meshes and preserve courtyard holes', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { buildExteriorBagColliders } = loadModule(read('ede-bag-exterior.js').replace('import.meta.url', 'moduleUrl'), {
    globals: { URL, moduleUrl: 'https://example.test/js/ede-bag-exterior.js' },
    imports: { 'three/webgpu': T, './terrain.js': {} },
  });
  const { polygonContains } = loadModule(read('building-collision.js'));
  const square = { minX: 100, maxX: 110, minZ: 200, maxZ: 210, height: 9, sourceGround: 2,
    polygons: [[[100,200, 110,200, 110,210, 100,210], [102,202, 102,204, 104,204, 104,202]]] };
  const [collider] = buildExteriorBagColliders([square], (x, z) => (x - 100) / 10 + (z - 200) / 10);
  assert.equal(collider.minY, -0.25);
  assert.equal(collider.maxY, 11);
  assert.ok(polygonContains(collider.polygon, 105, 205));
  assert.ok(!polygonContains(collider.polygon, 103, 203));
});
