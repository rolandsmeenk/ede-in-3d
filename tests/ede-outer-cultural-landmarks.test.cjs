const assert = require('node:assert/strict');
const test = require('node:test');

test('all eight outer cultural, village and barracks landmarks are registered with valid 3DBAG shells', async () => {
  const { EDE_OUTER_CULTURAL_LANDMARKS } = await import('../js/ede-outer-cultural-sites.js');
  const { OUTER_CULTURAL_SURVEYS } = await import('../js/ede-outer-cultural-survey.js');
  const { EDE_MODELED_LANDMARKS } = await import('../js/ede-landmark-sites.js');
  const { TELEPORT_LOCATIONS } = await import('../js/city-config.js');

  const expectedIds = [
    'kroller-muller-museum',
    'alexanderkerk-bennekom',
    'kijk-luistermuseum',
    'hervormde-kerk-harskamp',
    'park-paviljoen',
    'arthur-koolkazerne',
    'elias-beeckmankazerne',
    'jachthuis-sint-hubertus',
  ];

  assert.equal(EDE_OUTER_CULTURAL_LANDMARKS.length, expectedIds.length);
  const byId = new Map(EDE_OUTER_CULTURAL_LANDMARKS.map(s => [s.id, s]));
  const modeledIds = new Set(EDE_MODELED_LANDMARKS.map(s => s.id));

  for (const id of expectedIds) {
    const site = byId.get(id);
    assert.ok(site, `missing site ${id}`);
    assert.equal(site.worldSpace, true, `${id} should be worldSpace 3DBAG shell`);
    assert.ok(Array.isArray(site.bagIds) && site.bagIds.length >= 1, `${id} should declare bagIds`);
    assert.ok(Array.isArray(site.surveyFootprints) && site.surveyFootprints.length >= 1, `${id} should declare surveyFootprints`);
    assert.ok(modeledIds.has(id), `${id} should be included in EDE_MODELED_LANDMARKS`);
    const tp = TELEPORT_LOCATIONS[id];
    assert.ok(tp && Number.isFinite(tp.x) && Number.isFinite(tp.z), `TELEPORT_LOCATIONS[${id}] should exist`);
    if (id !== 'jachthuis-sint-hubertus') {
      const shells = OUTER_CULTURAL_SURVEYS[id];
      assert.ok(Array.isArray(shells) && shells.length === site.bagIds.length);
      for (const shell of shells) {
        assert.ok(shell.points.length >= 8 && shell.faces.length >= 6, `${id} shell should have 3D geometry`);
      }
    }
  }
});
