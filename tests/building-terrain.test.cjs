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
}

class BufferGeometry {
  attributes = {};
  setAttribute(name, value) { this.attributes[name] = value; }
  setIndex() {}
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

test('BAG seats each feature on its own low edge and preserves its roof and horizontal position', () => {
  const { bakeTile } = loadModule(read('bag3d.js').replaceAll('export async function', 'async function'), {
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
      './terrain.js': { terrainHeightAt: (x) => 10 + x / 2 }
    }
  });
  const positions = [4, 58, 1, 0, 58.125, 2, 2, 67, 3, 20, 79, 4, 21, 85, 5];
  const source = {
    attributes: {
      position: new BufferAttribute(positions, 3),
      normal: new BufferAttribute(new Array(positions.length).fill(0), 3),
      _feature_id_0: new BufferAttribute([0, 0, 0, 1, 1], 1)
    }
  };
  const scene = {
    updateMatrixWorld() {},
    traverse(visit) { visit({ isMesh: true, geometry: source }); }
  };
  const [baked] = bakeTile({ scene }, null);
  assert.deepEqual(Array.from(baked.attributes.position.array), [
    4, 9.875, 1, 0, 10, 2, 2, 18.875, 3, 20, 20, 4, 21, 26, 5
  ]);
  assert.deepEqual(Array.from(baked.attributes.buildingHeight.array), [0, 0.125, 9, 0, 6]);
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
