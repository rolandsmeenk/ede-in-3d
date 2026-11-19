const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('precipitation reuses one capped mesh and follows camera exposure through tunnel portals', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const grade = await import('../js/ede-grade.js');
  const transparentEffectMRT = tsl.mrt({ normal: tsl.vec4(0), metalRough: tsl.vec4(0) });
  const { createWeatherPrecipitation } = loadModule(
    readFileSync(join(__dirname, '../js/weather-precipitation.js'), 'utf8'),
    { imports: {
      'three/webgpu': THREE, 'three/tsl': tsl,
      './ede-grade.js': grade, './tsl-materials.js': { transparentEffectMRT }
    } }
  );
  const floor = { width: 3, modes: ['foot'], points: [[0, 0, -3], [0, 30, -3]], covered: [[5, 10], [15, 20]] };
  grade.setEdeGrade({ sites: [{
    id: 'underpass', kind: 'underpass', clearance: 4,
    profiles: [{ ...floor, id: 'walkway' }], excavation: { ...floor, width: 12 }
  }] });
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  rig.add(camera);
  rig.position.x = 5;
  const precipitation = createWeatherPrecipitation(scene);
  const mesh = scene.children[0];
  const weather = { rain: 1, snow: 0, windX: 3, windZ: -5 };

  const move = (z, y = -1) => {
    camera.position.set(0, y, z);
    precipitation.update(1 / 60, camera, weather);
    return mesh.count;
  };
  const rainCount = move(3);
  assert.ok(rainCount > 0 && rainCount <= 1200);
  assert.equal(move(8), 0);
  assert.equal(mesh.visible, false);
  assert.equal(move(12), rainCount);
  assert.equal(move(17), 0);
  assert.equal(move(17, 3), rainCount);
  assert.equal(mesh.visible, true);

  weather.snow = 1;
  assert.equal(move(22), rainCount);
  weather.rain = 0;
  const snowCount = move(22);
  assert.ok(snowCount > 0 && snowCount < rainCount);
  weather.snow = 0;
  assert.equal(move(22), 0);
  assert.equal(mesh.visible, false);
  assert.equal(scene.children.length, 1);
  assert.equal(scene.children[0], mesh);
  assert.equal(mesh.material.depthTest, true);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.mrtNode, transparentEffectMRT);
});

test('mapped decks and open sheds block precipitation below the roof and leave openings exposed', async () => {
  const grade = await import('../js/ede-grade.js');
  const rectangle = (a, b) => [{ x: a, z: a }, { x: b, z: a }, { x: b, z: b }, { x: a, z: b }];
  grade.setEdeStructureRoofs([{
    minX: 85, minZ: 85, maxX: 115, maxZ: 115, outer: rectangle(85, 115), holes: [rectangle(92, 108)],
    height: (x, z) => 4 + (x - 85) * .1
  }]);
  try {
    assert.equal(grade.isUnderEdeRoof(90, 2, 100), true);
    assert.equal(grade.isUnderEdeRoof(90, 5, 100), false);
    assert.equal(grade.isUnderEdeRoof(100, 2, 100), false);
    assert.equal(grade.isUnderEdeRoof(120, 2, 100), false);
  } finally {
    grade.setEdeStructureRoofs([]);
  }
});
