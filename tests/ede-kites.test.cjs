const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = path => readFileSync(join(__dirname, '..', path), 'utf8');

async function makeKiteScene() {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const utils = loadModule(source('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), { imports: { '../../../build/three.core.js': three } });
  const pedestrians = loadModule(source('js/pedestrians.js'), { imports: {
    'three/webgpu': three, 'three/tsl': tsl, 'three/addons/utils/BufferGeometryUtils.js': utils
  } });
  const wind = loadModule(source('js/ede-wind-props.js'), { imports: { 'three/webgpu': three } });
  const { createKiteFlyers } = loadModule(source('js/ede-kites.js'), { imports: {
    'three/webgpu': three, './ede-wind-props.js': wind, './pedestrians.js': pedestrians
  } });
  const scene = new three.Scene();
  const system = createKiteFlyers(scene, () => 4);
  scene.matrixWorldAutoUpdate = false;
  const group = scene.getObjectByName('Ginkelse Heide kite flyers');
  const camera = new three.Vector3(4301, 6, 1158);
  const breezy = { windDirection: 270, windSpeed: 18, windGusts: 22 };
  return { three, system, group, camera, breezy };
}

test('Ginkelse Heide kites use the local wind and lower their tethered sails in calm or strong gusts', async () => {
  const { three, system, group, camera, breezy } = await makeKiteScene();
  camera.set(0, 6, 0);
  system.update(0.05, camera, breezy);
  assert.equal(group.visible, false);
  assert.equal(group.children.length, 0);

  camera.set(4301, 6, 1158);
  system.update(0.05, camera, breezy);
  const sails = group.children.filter(object => object.name === 'Kite sail and tail');
  const cords = group.children.filter(object => object.name === 'Kite line');
  assert.equal(sails.length, 3);
  assert.equal(cords.length, 3);
  const sail = sails[1];
  const vertices = cords[1].geometry.getAttribute('position');
  const hand = new three.Vector3().fromBufferAttribute(vertices, 0);
  const tip = new three.Vector3().fromBufferAttribute(vertices, vertices.count - 1);
  const bridle = new three.Vector3(0, 0.09, 0.15).applyMatrix4(sail.matrixWorld);
  assert.ok(bridle.distanceTo(sail.position) < 0.2);
  assert.ok(tip.distanceTo(bridle) < 0.001);
  assert.ok(hand.y > 5 && hand.y < 6);
  assert.ok(sail.position.x > camera.x + 10 && sail.position.y > 12);
  const update = reading => {
    for (let i = 0; i < 180; i++) system.update(0.05, camera, reading);
  };
  update({ ...breezy, windDirection: 90 });
  assert.ok(sail.position.x < camera.x - 10);
  update({ ...breezy, windGusts: 60 });
  assert.ok(sail.position.y < 4.4);
  update(breezy);
  assert.ok(sail.position.y > 12);
  update({ windDirection: 270, windSpeed: 0 });
  assert.ok(sail.position.y < 4.4);
  camera.set(0, 6, 0);
  system.update(0.05, camera, breezy);
  assert.equal(group.visible, false);
});

test('Ginkelse Heide kite activity follows local daylight, weather and the Airborne programme', async () => {
  const { system, group, camera, breezy } = await makeKiteScene();
  const activity = {
    date: '2026-07-11', weekday: 6, minute: 14 * 60, daylight: true, weather: 'dry',
    weatherAvailable: true, season: 'summer', events: []
  };
  const assertCount = (count, context = {}, wind = breezy) => {
    system.update(0.05, camera, wind, { ...activity, ...context });
    assert.equal(group.visible, count > 0);
    for (const name of ['Kite sail and tail', 'Kite line']) {
      assert.equal(group.children.filter(child => group.visible && child.visible && child.name === name).length, count);
    }
  };

  assertCount(0, { daylight: false });
  assert.equal(group.children.length, 0);
  assertCount(3);
  assertCount(1, { weekday: 5 });
  assertCount(3, { weekday: 0, season: 'spring' });
  assertCount(0, { minute: 12 * 60 - 1 });
  assertCount(3, { minute: 12 * 60 });
  assertCount(0, { minute: 18 * 60 });
  assertCount(0, { season: 'autumn' });
  assertCount(0, { weatherAvailable: false });
  for (const weather of ['rain', 'snow', 'fog']) assertCount(0, { weather });
  assertCount(0, { weather: 'frost' });
  assertCount(1, { weekday: 5, weather: 'frost' });
  assertCount(0, { events: [{ id: 'airborne', zone: 'ginkelse-heide' }] });
  assertCount(3, { events: [{ id: 'heideweek', zone: 'ede' }] });
  assertCount(0, { weatherAvailable: false });
  assertCount(0, {}, { ...breezy, windSpeed: 10 });
  assertCount(3, {}, { ...breezy, windSpeed: 11 });
  assertCount(3, {}, { ...breezy, windSpeed: 35, windGusts: 49 });
  assertCount(0, { weatherAvailable: false });
  assertCount(0, {}, { ...breezy, windSpeed: 36 });
  assertCount(0, {}, { ...breezy, windGusts: 50 });

  assertCount(3);
  camera.x += 260;
  assertCount(3);
  camera.x += 16;
  assertCount(0);
  camera.x -= 16;
  assertCount(0);
  camera.x -= 10;
  assertCount(3);
});

test('Visible kites land when the wind becomes unsuitable', async () => {
  const { system, group, camera, breezy } = await makeKiteScene();
  const activity = {
    date: '2026-07-10', weekday: 5, minute: 14 * 60, daylight: true, weather: 'dry',
    weatherAvailable: true, season: 'summer', events: []
  };
  const update = (wind, context = activity) => system.update(0.05, camera, wind, context);

  for (const wind of [
    { ...breezy, windSpeed: 0, windGusts: 0 },
    { ...breezy, windSpeed: 36, windGusts: 36 },
    { ...breezy, windGusts: 55 }
  ]) {
    update(wind);
    assert.equal(group.visible, false);
    update(breezy);
    const sail = group.children.find(child => child.name === 'Kite sail and tail');
    assert.ok(sail.position.y > 10);
    update(wind);
    assert.equal(group.visible, true);
    assert.ok(sail.position.y > 8);
    for (let i = 0; i < 62; i++) update(wind);
    assert.equal(group.visible, true);
    assert.ok(sail.position.y < 4.5);
    for (let i = 0; i < 20; i++) update(wind);
    assert.equal(group.visible, false);
  }

  update(breezy);
  update({ ...breezy, windGusts: 55 });
  assert.equal(group.visible, true);
  update({ ...breezy, windGusts: 55 }, { ...activity, weather: 'rain' });
  assert.equal(group.visible, false);
});
