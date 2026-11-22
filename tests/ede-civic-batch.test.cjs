const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');

test('the four civic landmarks match their replacement footprints and public approaches', async () => {
  const { EDE_DATA, TELEPORT_LOCATIONS, toPts, pointInPoly } = await import('../js/city-config.js');
  const { EDE_MODELED_LANDMARKS, landmarkBagExclusions, modeledLandmarkFootprints } =
    await import('../js/ede-landmark-sites.js');
  for (const [id, bag] of Object.entries({
    westhoffhuis: '0228100000075047',
    'marnix-college': '0228100000004719',
    'brandweerkazerne-lunteren': '0228100000009538',
    'kulturhus-wekerom': '0228100000075900',
  })) {
    const site = EDE_MODELED_LANDMARKS.find(row => row.id === id);
    assert.ok(site, id);
    assert.deepEqual(site.bagIds, [bag]);
    assert.ok(EDE_DATA.buildings.some(building => building.id === site.osmId), id);
    const arrival = TELEPORT_LOCATIONS[id];
    assert.equal(arrival.x, site.approach.x);
    assert.equal(arrival.z, site.approach.z);
    const { outer } = modeledLandmarkFootprints(site)[0];
    assert.equal(pointInPoly(outer, arrival.x, arrival.z), false);
    const ids = landmarkBagExclusions({
      min: { x: Math.min(...outer.map(p => p.x)), z: Math.min(...outer.map(p => p.z)) },
      max: { x: Math.max(...outer.map(p => p.x)), z: Math.max(...outer.map(p => p.z)) },
    });
    assert.ok(ids.has(bag), id);
  }

  const paving = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets/ede-north-paving.json.gz'))));
  const { x, z } = TELEPORT_LOCATIONS['kulturhus-wekerom'];
  assert.ok(paving.surfaces.some(({ function: use, layer, polygons }) => layer === 0 && use === 'voetpad'
    && polygons.some(([outer, ...holes]) => pointInPoly(toPts(outer), x, z)
      && !holes.some(hole => pointInPoly(toPts(hole), x, z)))));
  assert.ok(paving.covered.w1446864183?.length);
});
