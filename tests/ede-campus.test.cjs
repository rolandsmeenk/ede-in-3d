const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

test('the CHE covered footway follows the terrain and shares the modeled bridge soffit', async ({ mock }) => {
  const { loadTerrain, terrainHeightAt } = await import('../js/terrain.js');
  mock.method(globalThis, 'fetch', async () => new Response(readFileSync(join(__dirname, '../assets/ede-ahn.bin'))));
  await loadTerrain();

  const { CHE_BRIDGE_SOFFIT, constrainEdeCamera, getEdeBuildingPassages, gradeProfileAt } = await import('../js/ede-grade.js');
  const way = 'w961378352';
  const { profile, sections } = getEdeBuildingPassages().get(way);
  assert.equal(profile.modeled, true);
  for (const { a, b } of sections) for (const [x, z] of [[a.x, a.z], [(a.x + b.x) / 2, (a.z + b.z) / 2], [b.x, b.z]]) {
    const ground = terrainHeightAt(x, z);
    for (const kind of ['person', 'cyclist']) {
      const surface = gradeProfileAt(x, z, kind, undefined, ground, way);
      assert.equal(surface.id, way);
      assert.equal(surface.y, ground);
      assert.equal(surface.roof, CHE_BRIDGE_SOFFIT);
      assert.ok(surface.roof - surface.y > 4.2);
    }
    const eye = { x, y: 5, z };
    constrainEdeCamera({ type: 'person', heading: 0, position: { x, y: ground, z } }, eye);
    assert.equal(eye.y, CHE_BRIDGE_SOFFIT - 0.25);
  }
});
