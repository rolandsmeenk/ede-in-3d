const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const source = ['traffic.js', 'pedestrian-system.js']
  .map((file) => readFileSync(join(__dirname, '../js', file), 'utf8')).join('\n');
function productionFunction(name, context) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present`);
  return vm.runInNewContext(`(${match[0].trim()})`, context);
}

for (const [hasView, inView, draw] of [[true, false, false], [true, true, true], [false, false, true]]) {
  test(`pedestrian gait always advances; pose generation follows drawing (${hasView}, ${inView})`, () => {
    let args, drawn = 0;
    const ped = { x: 10, z: 20, ux: 0, uz: 1, dir: 1, dodge: 0, dodgeTarget: 0, diveStart: -Infinity,
      rig: { update(...values) { args = values; } } };
    const renderPed = productionFunction('renderPed', {
      hasView, visible: () => inView, pedGround: () => 0, focusX: 0, focusZ: 0, clock: 0, PEDESTRIAN_DIVE_DURATION: 2.5,
      pedCrowd: { add(rig) { assert.equal(rig, ped.rig); drawn++; } }
    });
    renderPed(ped, 1 / 60);
    assert.equal(args[0], 1 / 60);
    assert.equal(args[1], ped.x);
    assert.equal(args[2], ped.z);
    assert.equal(args[5], ped);
    assert.equal(args[7], draw);
    assert.equal(args[8], -1);
    assert.equal(drawn, draw ? 1 : 0);
  });
}

test('hidden pedestrians finish their dive without drawing or changing the escape heading', () => {
  let args;
  const ped = { x: 10, z: 20, ux: 0, uz: 1, dir: 1, dodge: 1.8, dodgeTarget: 1.8,
    diveStart: 9.5, diveHeading: Math.PI / 2, rig: { update(...values) { args = values; } } };
  const context = {
    hasView: true, visible: () => false, pedGround: () => 0, focusX: 0, focusZ: 0,
    clock: 10, PEDESTRIAN_DIVE_DURATION: 2.5,
    pedCrowd: { add() { assert.fail('hidden pedestrians must not be drawn'); } }
  };
  const renderPed = productionFunction('renderPed', context);
  renderPed(ped, 1 / 60);
  assert.equal(args[3], ped.diveHeading);
  assert.equal(args[7], false);
  assert.equal(args[8], 0.5);
  context.clock = 12;
  renderPed(ped, 1 / 60);
  assert.equal(args[3], 0);
  assert.equal(args[7], false);
  assert.equal(args[8], -1);
});

function sparkHarness(updates = 3, terrainHeightAt = () => 0) {
  const sparks = Array.from({ length: 120 }, () => ({ life: 0 }));
  const writes = [];
  const zero = { zero: true };
  const dummy = { matrix: {} };
  for (const key of ['position', 'rotation', 'scale']) dummy[key] = { set(...values) { dummy.matrix[key] = values; } };
  dummy.updateMatrix = () => {};
  let uploads = 0, range = 0;
  const attr = {
    itemSize: 16,
    clearUpdateRanges() { range = 0; },
    addUpdateRange(offset, count) { assert.equal(offset, 0); range = count; },
    set needsUpdate(value) { if (value) uploads++; }
  };
  const sparkInst = {
    instanceMatrix: attr,
    setMatrixAt(index, matrix) { writes.push({ index, matrix: JSON.parse(JSON.stringify(matrix)) }); }
  };
  const context = { MAX_SPARKS: 120, sparks, sparkInst, dummy, zero, updates, terrainHeightAt };
  const flag = productionFunction('flagRange', {});
  context.flagRange = flag;
  return {
    sparks, writes, sparkInst,
    update: productionFunction('updateSparks', context),
    uploads: () => uploads,
    range: () => range
  };
}

test('idle collision sparks write and upload nothing after warm-up', () => {
  const h = sparkHarness();
  for (let frame = 0; frame < 60; frame++) h.update(1 / 60);
  assert.equal(h.writes.length, 0);
  assert.equal(h.uploads(), 0);
  assert.equal(h.sparkInst.count, 0);
  assert.equal(h.sparkInst.visible, false);
});

for (const frame of [1, 2]) {
  test(`spark shader warm-up keeps one degenerate visible instance on frame ${frame}`, () => {
    const h = sparkHarness(frame);
    h.update(1 / 60);
    assert.deepEqual(h.writes, [{ index: 0, matrix: { zero: true } }]);
    assert.equal(h.sparkInst.count, 1);
    assert.equal(h.sparkInst.visible, true);
    assert.equal(h.range(), 16);
  });
}

test('live sparks preserve motion, bounce and fade while packing only live matrices', () => {
  const h = sparkHarness();
  h.sparks[13] = { x: 2, y: 0.04, z: 3, vx: 1, vy: -2, vz: 4, life: 0.1, maxLife: 0.4 };
  h.sparks[80] = { x: 0, y: 2, z: 0, vx: 0, vy: 3, vz: 0, life: 0.2, maxLife: 0.4 };
  h.update(0.05);
  const bounced = h.sparks[13];
  assert.equal(bounced.x, 2.05);
  assert.equal(bounced.y, 0.03);
  assert.equal(bounced.z, 3.2);
  assert.equal(bounced.vx, 0.78);
  assert.equal(bounced.vz, 3.12);
  assert.ok(Math.abs(bounced.vy - 1.395) < 1e-12);
  assert.ok(Math.abs(h.sparks[80].y - 2.095) < 1e-12);
  assert.deepEqual(h.writes.map((write) => write.index), [0, 1]);
  assert.deepEqual(h.writes[0].matrix.position, [2.05, 0.03, 3.2]);
  assert.equal(h.writes[0].matrix.scale[0], 0.125);
  assert.equal(h.writes[0].matrix.scale[1], 0.125);
  assert.equal(h.sparkInst.count, 2);
  assert.equal(h.range(), 32);
  assert.equal(h.uploads(), 1);
  // An expiring particle retains the original zero-life fade on its last simulated frame, then disappears.
  h.update(0.2);
  assert.equal(h.sparkInst.count, 2);
  assert.equal(h.writes.at(-1).matrix.scale[0], 0);
  const uploads = h.uploads();
  h.update(1 / 60);
  assert.equal(h.sparkInst.count, 0);
  assert.equal(h.sparkInst.visible, false);
  assert.equal(h.uploads(), uploads);
});


test('NPC walking and crosswalk ground adapt to the terrain under each foot', () => {
  const pedGround = productionFunction('pedGround', {
    terrainHeightAt: (x, z) => 12 + x * 0.25 + z * 0.5, SIDEWALK_Y: 0.22, CROSSWALK_Y: 0.012
  });
  const ped = { ax: 0, az: 0, ux: 0, uz: 1, len: 12 };
  assert.equal(pedGround(ped, 2, 4), 14.72);
  ped.node = {};
  assert.equal(pedGround(ped, 2, 4), 14.512);
  assert.equal(pedGround(ped, 3, 1), 13.47);
});

test('NPC vehicle grade and wheels follow a sloped road', () => {
  const terrainHeightAt = (x, z) => 25 + x * 0.2 + z * 0.1;
  const v = { x: 10, z: 20, y: 29, axle: 1.4, halfWidth: 0.85, steer: 0, wheelSpin: 0 };
  productionFunction('fitVehicleGrade', { terrainHeightAt })(v, 0, 1);
  assert.ok(Math.abs(v.roadPitch + Math.atan(0.1)) < 1e-12);
  assert.ok(Math.abs(v.roadRoll - Math.atan(0.2)) < 1e-12);

  const wheels = [];
  const dummy = {
    matrix: {}, scale: { set() {} }, rotation: { set() {} }, updateMatrix() {},
    position: { set(x, y, z) { dummy.matrix.position = [x, y, z]; } }
  };
  const inst = { setMatrixAt(i, matrix) { wheels.push(matrix.position); } };
  const radius = 0.35;
  productionFunction('placeWheels', { dummy, terrainHeightAt })(v, 0, 0, v.roadRoll, radius, 0.8, 1.4, inst, inst);
  assert.equal(wheels.length, 4);
  for (const [x, y, z] of wheels) assert.equal(y, terrainHeightAt(x, z) + radius);
});

test('collision sparks bounce at elevated ground', () => {
  const h = sparkHarness(3, () => 42);
  h.sparks[13] = { x: 2, y: 42.04, z: 3, vx: 1, vy: -2, vz: 4, life: 0.1, maxLife: 0.4 };
  h.update(0.05);
  assert.equal(h.sparks[13].y, 42.03);
  assert.equal(h.writes[0].matrix.position[1], 42.03);
});

test('street audio uses the simulated elevations of vehicles and walkers below scene zero', () => {
  const { CityAudioSources } = loadModule(readFileSync(join(__dirname, '../js/audio-sources.js'), 'utf8'), {
    imports: { './city-config.js': {}, './terrain.js': { terrainHeightAt: () => -40 } }
  });
  const rig = { speed: 1, feet: [{ py: -39.78 }, { py: -39.78 }] };
  const player = { type: 'person', position: { x: 0, y: -40, z: 0 }, mesh: {}, rig, verticalVel: 0 };
  const car = { x: 5, y: -39, z: 12, speed: 3, driver: { a: 2 }, engine: 'sedan', edge: { to: {} } };
  const ped = { x: 1, y: -39.78, z: 2, rig, placed: true };
  const audio = new CityAudioSources({
    controllerManager: { entities: { player }, keys: {}, getActiveEntity: () => player, getGroundHeight: () => -40 },
    trafficSystem: { cars: [car], buses: [], peds: [ped] }, highwayTraffic: { cars: [] }, streetDetails: { audioSignals: [] }
  });
  const snapshot = audio.collect({ x: 0, y: -39, z: 0 }, 0);
  assert.equal(snapshot.motors[0].y, -38.3);
  assert.equal(snapshot.people.find(source => source.id === player).grounded, true);
  assert.equal(snapshot.people.find(source => source.id === ped).y, -39.78);
});

test('player car audio follows the drivable surface beneath covered terrain', () => {
  const { CityAudioSources } = loadModule(readFileSync(join(__dirname, '../js/audio-sources.js'), 'utf8'), {
    imports: { './city-config.js': {}, './terrain.js': { terrainHeightAt: () => 14 } }
  });
  const player = { type: 'car', position: { x: 0, y: 8, z: 0 }, mesh: {}, speed: 20 };
  const audio = new CityAudioSources({
    controllerManager: {
      entities: { player }, keys: {}, getActiveEntity: () => player,
      getGroundHeight(x, z, type, y) {
        assert.equal(type, 'car');
        assert.equal(y, player.position.y);
        return x < 10 ? 8 : 14;
      }
    },
    trafficSystem: { cars: [], buses: [], peds: [] }, highwayTraffic: { cars: [] }, streetDetails: { audioSignals: [] }
  });
  const listener = { x: 0, y: 10, z: 0 };
  const [source] = audio.collect(listener, 0).motors;
  assert.equal(source.id, player);
  assert.equal(source.y, 8.7);
  assert.equal(source.speed, 20);
  player.position.x = 10;
  assert.equal(audio.collect(listener, 1).motors.length, 0);
});
