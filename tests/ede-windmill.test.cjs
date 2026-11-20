const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/ede-windmill.js'), 'utf8');
const dt = 1 / 60;

async function windmill(heading = 0, options) {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const { createWindmillRig } = loadModule(source, { imports: { 'three/webgpu': three } });
  const tower = new three.Group();
  tower.rotation.y = heading;
  const { cap, sails } = createWindmillRig(tower, 24.65, 4.90, 0.22, options);
  tower.updateMatrixWorld(true);
  return {
    tower, cap, sails,
    tick(reading, frames = 1) {
      for (let i = 0; i < frames; i++) cap.userData.updateWind(dt, reading);
    },
    front() {
      return new three.Vector3(0, 0, 1).transformDirection(cap.matrixWorld);
    }
  };
}

function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

test('the moving cap faces the source of the wind on Ede’s east/south axes', async () => {
  const mill = await windmill(1.96);
  for (const [windDirection, x, z] of [[0, 0, -1], [90, 1, 0], [180, 0, 1], [270, -1, 0]]) {
    mill.tick({ windDirection, windSpeed: 20 }, 1200);
    const front = mill.front();
    assert.ok(Math.abs(front.x - x) < 0.002, windDirection);
    assert.ok(Math.abs(front.z - z) < 0.002, windDirection);
  }
  assert.equal(mill.tower.rotation.y, 1.96);
});

test('the cap takes the short turn across north and the sails accelerate and coast to rest', async () => {
  const mill = await windmill(Math.PI);
  mill.tick({ windDirection: 350, windSpeed: 14 }, 900);
  const before = mill.cap.rotation.y;
  mill.tick({ windDirection: 10, windSpeed: 14 });
  const first = angleDifference(mill.cap.rotation.y, before);
  assert.ok(first < 0 && first > -0.01);
  mill.tick({ windDirection: 10, windSpeed: 14 }, 900);
  const speedAfter = windSpeed => {
    const reading = { windDirection: 10, windSpeed };
    mill.tick(reading, 900);
    const angle = mill.sails.rotation.z;
    mill.tick(reading);
    return angleDifference(mill.sails.rotation.z, angle) / dt;
  };
  assert.equal(speedAfter(0), 0);
  assert.equal(speedAfter(4), 0);
  const breeze = speedAfter(14);
  const strong = speedAfter(30);
  const capped = speedAfter(90);
  assert.ok(breeze > 0 && strong > breeze);
  assert.ok(capped >= strong && capped <= 16 * 2 * Math.PI / 60 + 0.001);

  const yaw = mill.cap.rotation.y;
  const angle = mill.sails.rotation.z;
  mill.tick(null);
  assert.ok(Math.abs(angleDifference(mill.sails.rotation.z, angle)) > 0);
  mill.tick(null, 1200);
  const stopped = mill.sails.rotation.z;
  mill.tick(null);
  assert.equal(mill.sails.rotation.z, stopped);
  assert.equal(mill.cap.rotation.y, yaw);
});

test('the A30 turbine profile faces into the wind and turns clockwise above its cut-in speed', async () => {
  const turbine = await windmill(0, { cutIn: 3, rotationSign: -1 });
  turbine.tick({ windDirection: 90, windSpeed: 10 }, 1200);
  assert.ok(turbine.front().x > 0.999);
  assert.equal(turbine.sails.rotation.z, 0);
  turbine.tick({ windDirection: 90, windSpeed: 20 }, 1200);
  const angle = turbine.sails.rotation.z;
  turbine.tick({ windDirection: 90, windSpeed: 20 });
  assert.ok(angleDifference(turbine.sails.rotation.z, angle) < 0);
});
