const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

test('the opt-in lane overlay samples the simulation lanes and legal connectors', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const { createTrafficLaneDebug } = loadModule(readFileSync(join(__dirname, '../js/ede-traffic-lane-debug.js'), 'utf8'), {
    imports: { 'three/webgpu': THREE, './ede-lane-geometry.js': await import('../js/ede-lane-geometry.js'),
      './traffic-area.js': await import('../js/traffic-area.js') },
  });
  const edge = (id, x) => ({ id, sx: x, sz: 0, dx: 1, dz: 0, rx: 0, rz: 1, len: 12, lanes: [1, -1],
    ambientLanes: [], ambientMoves: [], vanLanes: [], vanMoves: [], refuseLanes: [], refuseMoves: [],
    to: { x: x + 12, z: 0 } });
  const first = edge(0, 0), second = edge(1, 16);
  first.ambientLanes.push(0);
  first.fittedLanes = [{ samples: [0, 0, 4, 0, 3.4, 12, 12, 4, 12, 3.4], tangent: [1, 0, 1, 0], len: 12 }];
  first.ambientMoves.push({ to: second, out: [0, -1] });
  second.ambientLanes.push(0);
  const calls = [];
  const scene = new THREE.Scene();
  const overlay = createTrafficLaneDebug(scene, { busPaths: new Map(), roadGround: () => 3,
    network: { edges: [first, second], connector: (...move) => { calls.push(move); return { len: 4 }; },
      curvePoint: (_curve, s, out) => Object.assign(out, { x: 12 + s, z: 4 - s * .75, dx: .8, dz: -.6 }) } });
  const mesh = scene.getObjectByName('Traffic lane debug');
  overlay.update({ x: 0, z: 0 });
  assert.equal(mesh.visible, false);
  assert.equal(mesh.geometry.getAttribute('position'), undefined);
  overlay.setEnabled(true);
  overlay.update({ x: 0, z: 0 });
  assert.equal(mesh.visible, true);
  assert.deepEqual(calls, [[first, 0, second, 0]]);
  const vertices = mesh.geometry.getAttribute('position');
  assert.ok(Math.abs(vertices.getY(0) - 3.28) < 1e-5);
  assert.ok(Math.abs(vertices.getZ(0) - 3.905) < 1e-5);
  assert.ok(mesh.geometry.drawRange.count > 0);
  overlay.update({ x: 5, z: 0 });
  assert.equal(calls.length, 1);
  overlay.update({ x: 500, z: 0 });
  assert.equal(mesh.visible, false);
  assert.equal(mesh.geometry.drawRange.count, 0);
  overlay.setEnabled(false);
  overlay.update({ x: 0, z: 0 });
  assert.equal(mesh.visible, false);
});
