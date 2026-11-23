const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = path => readFileSync(join(__dirname, '..', path), 'utf8');

test('Ginkelse Heide kites use the local wind and lower their tethered sails in calm or strong gusts', async () => {
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
  const camera = new three.Vector3(0, 6, 0);
  const breezy = { windDirection: 270, windSpeed: 18, windGusts: 22 };
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
