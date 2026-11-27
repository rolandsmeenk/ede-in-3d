const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = name => readFileSync(join(__dirname, '../js', name), 'utf8');

test('the Kernhem loop has directional posts and mapped gates, and the cycling layer has oriented junctions', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const data = loadModule(source('ede-recreation-route-data.js'));
  const { DOESBURGERMOLENPAD: trail, DOESBURGERMOLENPAD_LENGTH: length,
    DOESBURGERMOLENPAD_GATES: gates, EDE_CYCLE_LINKS: links, EDE_CYCLE_JUNCTIONS: junctions } = data;
  assert.equal(trail[0], trail.at(-2));
  assert.equal(trail[1], trail.at(-1));
  assert.ok(Math.hypot(trail[0] + 974, trail[1] + 759) < 100);
  assert.ok(length > 9000 && length < 9300);
  assert.ok(links.length > 400 && junctions.length > 35);
  assert.ok(junctions.some(([number]) => number === '60'));
  for (const [, x, z, dx, dz] of junctions) {
    assert.ok(Number.isFinite(x) && Number.isFinite(z));
    assert.ok(Math.abs(Math.hypot(dx, dz) - 1) < 0.0001);
  }
  const { buildEdeRecreationRoutes, doesburgermolenpadMarkers } = loadModule(source('ede-recreation-routes.js'), {
    imports: { 'three/webgpu': THREE, './ede-recreation-route-data.js': data },
    globals: { document: { createElement: () => ({ getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} }) }) } },
  });
  const markers = doesburgermolenpadMarkers();
  assert.equal(markers[0].index, 0);
  assert.ok(markers.length > 30);
  const scene = new THREE.Scene();
  const group = buildEdeRecreationRoutes(scene, () => 3, () => true);
  assert.equal(group.parent, scene);
  assert.equal(group.children.filter(item => item.name.startsWith('Doesburgermolenpad · ')).length, gates.length);
  assert.equal(group.children.filter(item => item.name.startsWith('Cycling junction ')).length, junctions.length);
  assert.ok(group.children.every(item => item.position.y === 3 && item.children.length >= 3));
});
