const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

test('the CHE and ENKA covered ways share their modeled bridge soffits', async ({ mock }) => {
  const { loadTerrain, terrainHeightAt } = await import('../js/terrain.js');
  mock.method(globalThis, 'fetch', async url => new Response(readFileSync(url)));
  await loadTerrain();

  const { CHE_BRIDGE_SOFFIT, ENKA_PORTAL_SOFFIT, constrainEdeCamera, getEdeBuildingPassages, gradeProfileAt } = await import('../js/ede-grade.js');
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
  for (const id of ['w494663072', 'w494663075']) {
    const passage = getEdeBuildingPassages().get(id);
    assert.equal(passage.profile.modeled, true, 'keep generic side walls out of the open arch');
    for (const { a, b, roofAt } of passage.sections) {
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      assert.equal(roofAt(x, z), ENKA_PORTAL_SOFFIT);
    }
  }
});
