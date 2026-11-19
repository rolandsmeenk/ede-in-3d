const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
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

function loadBag({ blocks = [], aerial = {}, grade = {}, three, facadeStubs = {}, globals = {}, meta = {}, landmarks = {} } = {}) {
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
      './nyc-geodata.js': { GEO: { ede: { meta: { bounds: [0, 0, 30, 30], ...meta } } } },
      './city-config.js': { BLOCKS: blocks },
      './building-collision.js': loadModule(read('building-collision.js')),
      './terrain.js': { terrainHeightAt: (x) => 10 + x / 2 },
      './ede-grade.js': { buildingPassageCuts: () => [], ...grade },
      './ede-building-bases.js': { EDE_BUILDING_BASES: [] },
      './ede-landmark-sites.js': { landmarkBagExclusions: () => new Map(), landmarkBuildingCuts: () => [], ...landmarks },
      './ede-facades.js': facadeStubs,
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

test('BAG starts from fallback, bounds downloads, cancels stale work on a jump, and restores evicted coverage', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { createBagBuildingStream, ecefToLocalMatrix, gltfToLocalMatrix } = loadBag({ three: T,
    meta: { bounds: [-200, -200, 2200, 200], lonLatAffine: { lon0: 5.67, lat0: 52.04, x: [0, 68600], z: [0, 0, -111300] } },
    globals: { performance, URL, AbortController, setTimeout, document: { hidden: false }, console },
    facadeStubs: { loadEdeFacades: async () => null, createBagFacadeMaterial: () => new T.MeshBasicMaterial() }
  });
  const toEcef = ecefToLocalMatrix().invert(), toGltf = gltfToLocalMatrix().invert();
  function tile(x, extent, uri) {
    const center = new T.Vector3(x, 0, 0).applyMatrix4(toEcef);
    const axes = [[extent, 0, 0], [0, extent, 0], [0, 0, extent]];
    const box = [...center.toArray(), ...axes.flatMap(offset => new T.Vector3(x + offset[0], offset[1], offset[2])
      .applyMatrix4(toEcef).sub(center).toArray())];
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
    const geo = new T.PlaneGeometry(10, 10).rotateX(-Math.PI / 2).translate(x, 0, 0);
    const mesh = new T.Mesh(geo);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(toGltf);
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
