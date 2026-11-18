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
  computeBoundingBox() {}
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

function loadBag({ blocks = [], aerial = {} } = {}) {
  return loadModule(read('bag3d.js').replaceAll('export async function', 'async function'), {
    imports: {
      'three/webgpu': {
        BufferGeometry, BufferAttribute, Vector3,
        Matrix4: class { multiplyMatrices() { return this; } },
        Matrix3: class { getNormalMatrix() { return this; } },
        Color: class { setHSL() { this.r = this.g = this.b = 0.5; } }
      },
      'three/tsl': {},
      'three/addons/loaders/GLTFLoader.js': {},
      'three/addons/libs/meshopt_decoder.module.js': {},
      './nyc-geodata.js': { GEO: { ede: { meta: { bounds: [0, 0, 30, 30] } } } },
      './city-config.js': { BLOCKS: blocks },
      './building-collision.js': loadModule(read('building-collision.js')),
      './terrain.js': { terrainHeightAt: (x) => 10 + x / 2 },
      './aerial-colors.js': { getAerialColors: () => false, ...aerial }
    }
  });
}

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
