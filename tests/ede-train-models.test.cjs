const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('train bodies fit their runs and the bogies sit on the rails', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const { TRAIN_CONSISTS } = await import('../js/ede-train-traffic.js');
  const source = file => readFileSync(join(__dirname, '..', file), 'utf8');
  const utils = loadModule(source('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), { imports: { three: THREE } });
  const { makeTrainModels } = loadModule(source('js/ede-train-models.js'), {
    globals: { Float32Array },
    imports: {
      'three/webgpu': THREE,
      'three/addons/utils/BufferGeometryUtils.js': utils,
      './ede-train-traffic.js': { TRAIN_CONSISTS }
    }
  });

  const models = makeTrainModels();
  for (const [type, consist] of Object.entries(TRAIN_CONSISTS)) {
    const { length, cars, cab, rearCab, coach } = models[type];
    assert.equal(length, consist.length);
    assert.equal(cars, consist.cars);
    for (const geometry of [cab, rearCab, coach]) {
      const { min, max } = geometry.boundingBox;
      assert.ok(Math.abs(min.y) < 1e-6, type);
      assert.ok(max.y < 4.78 && Math.max(-min.x, max.x) < 1.56, type);
      assert.ok(min.z >= -length / 2 - 1e-5 && max.z <= length / 2 + 1e-5, type);
      assert.ok(geometry.index.count > 1000 && geometry.index.count < 20000, type);
    }
    const front = cab.getAttribute('trainGlow').array;
    const rear = rearCab.getAttribute('trainGlow').array;
    assert.ok(front.some((value, i) => i % 3 === 1 && value > .5), type);
    assert.ok(rear.some((value, i) => i % 3 === 0 && value > .5 && rear[i + 1] < .1), type);
    assert.ok(coach.getAttribute('trainGlow').array.every(value => value === 0), type);
  }
});
