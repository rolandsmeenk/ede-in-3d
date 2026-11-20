const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/ede-windmill.js'), 'utf8');
const dt = 1 / 60;

async function windmill(heading = 0, options) {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const { addWindmillSailcloth, createWindmillRig } = loadModule(source, { imports: { 'three/webgpu': three } });
  const tower = new three.Group();
  tower.rotation.y = heading;
  const hubHeight = options?.turbine ? 99.5 : 24.65;
  const { cap, sails } = createWindmillRig(tower, hubHeight, 4.90, 0.22, options);
  tower.updateMatrixWorld(true);
  return {
    tower, cap, sails,
    addCloth() {
      return addWindmillSailcloth(sails, { angle: 0.34, radii: [11.775, 11.85], root: 1.65, innerWidth: 0.92, outerWidth: 1.55 });
    },
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
  const capped = speedAfter(60);
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

test('Maanderbroek turbines start at 3 m/s at hub height and follow the Siemens speed range', async () => {
  const turbine = await windmill(0, { turbine: true });
  const rpmAt = (windSpeed, atHubHeight = false) => {
    const wind = { windDirection: 90, windSpeed, atHubHeight };
    turbine.tick(wind, 1200);
    const previous = turbine.sails.rotation.z;
    turbine.tick(wind);
    return angleDifference(turbine.sails.rotation.z, previous) / dt * 60 / (2 * Math.PI);
  };
  assert.equal(rpmAt(7), 0);
  assert.ok(turbine.front().x > 0.999);
  const light = rpmAt(9);
  assert.ok(light < -6.5 && light > -8, light);
  const breeze = rpmAt(18);
  assert.ok(breeze < -10 && breeze > -12, breeze);
  assert.ok(Math.abs(rpmAt(40) + 19) < 0.01);
  assert.equal(rpmAt(66), 0);
  assert.equal(rpmAt(9, true), 0);
  assert.ok(Math.abs(rpmAt(19.04, true) + 9.1) < 0.01);
  assert.equal(rpmAt(90, true), 0);
});

test('the four cloth panels move with the wooden sails, reef in stronger wind and furl at rest', async () => {
  const mill = await windmill();
  const cloth = mill.addCloth();
  assert.equal(cloth.parent, mill.sails);
  assert.equal(cloth.visible, false);
  mill.tick({ windDirection: 180, windSpeed: 18 }, 300);
  assert.equal(cloth.visible, true);
  assert.equal(cloth.geometry.drawRange.count, 96);
  const before = cloth.matrixWorld.elements.slice();
  mill.tick({ windDirection: 180, windSpeed: 30 }, 60);
  assert.equal(cloth.geometry.drawRange.count, 48);
  assert.notDeepEqual(cloth.matrixWorld.elements, before);
  mill.tick({ windDirection: 180, windSpeed: 48 });
  assert.equal(cloth.visible, false);
  assert.notEqual(mill.sails.rotation.z, 0);
  mill.tick({ windDirection: 180, windSpeed: 18 });
  assert.equal(cloth.visible, true);
  mill.tick({ windDirection: 180, windSpeed: 0 }, 1200);
  assert.equal(cloth.visible, false);
});
