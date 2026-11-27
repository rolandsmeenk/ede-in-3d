const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { structures } = require('../assets/ede-bgt.json');

const read = name => readFileSync(join(__dirname, '../js', name), 'utf8');

test('Ede-Wageningen bay stays on the BGT platform and displays Amsterdam departure times', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const transit = await import('../js/ede-transit-time.js');
  const { CivicBatch } = loadModule(read('ede-civic-landmarks.js'), { imports: {
    'three/webgpu': THREE, 'three/tsl': await import('../vendor/three/build/three.tsl.js'),
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': {}, './terrain.js': {},
    './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {}, './ede-wind-props.js': {},
  } });
  const canvases = [];
  const terrainHeightAt = x => x < 148 ? -1 : -0.165;
  const { buildEdeStationBay } = loadModule(read('ede-station-bay.js'), {
    imports: { 'three/webgpu': THREE, './ede-civic-landmarks.js': { CivicBatch }, './ede-transit-time.js': transit,
      './terrain.js': { terrainHeightAt } },
    globals: { document: { createElement() {
      const canvas = { labels: [], getContext: () => ({ fillRect() {}, fillText(label) { canvas.labels.push(label); } }) };
      canvases.push(canvas);
      return canvas;
    } } },
  });
  const id = 'L0004.38486c4e2b4b489997fe54ed8e1753b8';
  const ring = structures.find(row => row.ids.includes(id)).polygons[0][0];
  const outer = ring.filter((_, i) => i % 2 === 0).map((x, i) => ({ x, z: ring[i * 2 + 1] }));
  const height = x => -0.45 + (x - 140) * 0.01;
  const bay = buildEdeStationBay([{ id, outer, height: () => -1, renderedHeight: height }]);
  assert.equal(buildEdeStationBay([]), null);
  assert.equal(bay.colliders.length, 6);
  const [a, b] = outer;
  const inward = (x, z) => ((b.z - a.z) * (x - a.x) - (b.x - a.x) * (z - a.z)) / Math.hypot(b.x - a.x, b.z - a.z);
  for (const shape of bay.colliders) {
    assert.ok(inward(shape.minX, shape.maxZ) > 3);
    assert.ok(inward(shape.maxX, shape.minZ) < 6);
  }

  const tactile = bay.group.getObjectByName('Spoor 1 tactile guide and platform edge').geometry.attributes.position;
  for (let i = 0; i < tactile.count; i++) {
    const x = tactile.getX(i), y = tactile.getY(i), z = tactile.getZ(i);
    assert.ok(inward(x, z) > 0.15 && inward(x, z) < 1);
    const surface = Math.max(height(x), terrainHeightAt(x) - 0.025);
    assert.ok(y > surface && y < surface + 0.03);
  }
  const time = Date.parse('2027-08-19T10:12:00Z') / 1000;
  bay.display.update([{ departure: time, scheduled: time - 180, platform: '1b', live: true }]);
  assert.ok(canvases[0].labels.includes('1'));
  for (const label of ['12:12', '1b', 'Amersfoort Centraal', '+3']) assert.ok(canvases[1].labels.includes(label));
  const length = canvases[1].labels.length;
  bay.display.update([{ departure: time, scheduled: time - 180, platform: '1b', live: true }]);
  assert.equal(canvases[1].labels.length, length);
});
