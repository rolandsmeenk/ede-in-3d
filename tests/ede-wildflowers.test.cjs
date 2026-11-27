const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = path => readFileSync(join(__dirname, '..', path), 'utf8');

test('De Ginkel flowers follow habitat, bloom and daylight with camera-local repeatable placements', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const utils = loadModule(source('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), {
    imports: { '../../../build/three.core.js': three },
  });
  const { createEdeWildflowers } = loadModule(source('js/ede-wildflowers.js'), {
    imports: { 'three/webgpu': three, 'three/addons/utils/BufferGeometryUtils.js': utils },
  });
  const scene = new three.Scene();
  scene.matrixWorldAutoUpdate = false;
  const system = createEdeWildflowers(scene, {
    bounds: [-100, -50, 100, 50],
    habitatAt: x => x < -16 ? 'dry-heath' : x < 0 ? 'damp-heath' : x < 16 ? 'mown-grass' : 'woodland-edge',
    heightAt: (x, z) => x * 0.01 + z * 0.03,
    tracks: [{ points: [[-4, 0], [0, 0], [5, 0]], width: 2 }],
  });
  const group = scene.getObjectByName('De Ginkel flowers and ground detail');
  system.update({ x: 400, z: 0 });
  assert.equal(group.visible, false);
  assert.equal(group.children.length, 0);

  const count = name => group.getObjectByName(name).count;
  const daisy = 'Madeliefje open';
  const camera = { x: 0, z: 0 };
  const summer = { month: 8, daylight: 1, bloom: { calluna: 0.95, erica: 0.76, tormentil: 0.5, daisy: 0.5 } };
  const firstPosition = new three.Matrix4();
  system.update(camera, summer);
  assert.equal(group.visible, true);
  for (const name of [daisy, 'Struikhei blossom', 'Gewone dophei bells', 'Tormentil flowers',
    'Woodland edge scrub', 'Woodland edge leaf litter']) {
    assert.ok(count(name) > 0, name);
  }
  const daisyMesh = group.getObjectByName(daisy);
  const daisyCount = daisyMesh.count;
  daisyMesh.getMatrixAt(0, firstPosition);
  const [, y, z] = firstPosition.elements.slice(12);
  assert.ok(Math.abs(y - firstPosition.elements[12] * 0.01 - z * 0.03 - 0.006) < 0.000001);

  const tracks = group.getObjectByName('Sheepfold worn tracks');
  const colors = tracks.children[0].geometry.getAttribute('color');
  assert.equal(colors.itemSize, 4);
  assert.equal(colors.getW(0), 0);
  assert.ok(colors.getW(32) > 0);

  system.update(camera, { ...summer, daylight: 0 });
  assert.equal(count(daisy), 0);
  assert.equal(count('Madeliefje closed'), daisyCount);
  system.update(camera, { month: 1, daylight: 1 });
  assert.equal(count(daisy), 0);
  assert.equal(count('Struikhei blossom'), 0);
  assert.equal(count('Gewone dophei bells'), 0);
  assert.ok(count('Struikhei foliage') > 0);
  assert.ok(count('Gewone dophei foliage') > 0);

  system.update({ x: 120, z: 0 }, summer);
  assert.equal(count(daisy), 0);
  system.update(camera, summer);
  const restored = new three.Matrix4();
  daisyMesh.getMatrixAt(0, restored);
  assert.deepEqual(restored.elements, firstPosition.elements);
  assert.equal(count(daisy), daisyCount);

  const heather = ['Struikhei foliage', 'Struikhei blossom', 'Gewone dophei foliage', 'Gewone dophei bells']
    .map(name => group.getObjectByName(name));
  system.update(camera, summer, { x: 50, z: 0 });
  const distantCounts = heather.map(mesh => mesh.count);
  const player = { x: -12, z: 0 };
  system.update(camera, summer, player);
  for (const [i, mesh] of heather.entries()) {
    assert.ok(mesh.count > distantCounts[i], mesh.name);
    for (let j = distantCounts[i]; j < mesh.count; j++) {
      mesh.getMatrixAt(j, restored);
      const [px, , pz] = restored.elements.slice(12);
      assert.ok(Math.hypot(px - player.x, pz - player.z) < 18, mesh.name);
      if (px >= -4 && px <= 5) assert.ok(Math.abs(pz) >= 1.25, mesh.name);
    }
  }
  assert.equal(count(daisy), daisyCount);
  system.update(camera, summer, { x: 50, z: 0 });
  assert.deepEqual(heather.map(mesh => mesh.count), distantCounts);
});
