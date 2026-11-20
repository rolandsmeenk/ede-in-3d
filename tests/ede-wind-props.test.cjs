const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/ede-wind-props.js'), 'utf8');

test('a vane and a flag point to opposite sides in each cardinal wind', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const { createWindVane, createWindFlag } = loadModule(source, { imports: { 'three/webgpu': three } });
  const vane = createWindVane('Test vane', 10, 20, 30, [[0, 0], [0.3, 0], [0, 0.2]], 0xaaaaaa);
  const flag = createWindFlag(new three.MeshStandardNodeMaterial(), 0);
  const forward = object => new three.Vector3(1, 0, 0).transformDirection(object.matrixWorld);

  for (const [windDirection, x, z] of [[0, 0, -1], [90, 1, 0], [180, 0, 1], [270, -1, 0]]) {
    const reading = { windDirection, windSpeed: 25 };
    for (let i = 0; i < 180; i++) {
      vane.userData.updateWind(0.05, reading);
      flag.userData.updateWind(0.05, reading);
    }
    assert.ok(forward(vane).distanceTo(new three.Vector3(x, 0, z)) < 0.002);
    assert.ok(forward(flag).distanceTo(new three.Vector3(-x, 0, -z)) < 0.002);
  }
  assert.deepEqual(vane.position.toArray(), [10, 20, 30]);

  const positions = flag.geometry.getAttribute('position');
  const anchor = [positions.getX(0), positions.getY(0), positions.getZ(0)];
  const tip = 16;
  const inWind = [positions.getX(tip), positions.getY(tip), positions.getZ(tip)];
  flag.userData.updateWind(0.1, { windDirection: 270, windSpeed: 25 });
  assert.notEqual(positions.getZ(tip), inWind[2]);

  const lastHeading = flag.rotation.y;
  flag.userData.updateWind(10, { windDirection: 90, windSpeed: 0 });
  assert.equal(flag.rotation.y, lastHeading);
  assert.deepEqual([positions.getX(0), positions.getY(0), positions.getZ(0)], anchor);
  assert.ok(positions.getX(tip) < inWind[0] / 4);
  assert.ok(positions.getY(tip) < inWind[1] - 1);
});
