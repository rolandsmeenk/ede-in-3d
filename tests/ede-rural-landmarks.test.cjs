const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports) {
  return loadModule(readFileSync(join(__dirname, '../js', name), 'utf8'), { imports, filename: name });
}

test('rural landmarks use mapped footprints, reachable arrivals and finite models', async () => {
  const [three, tsl, terrainModule, survey, mapping, registry, coverage] = await Promise.all([
    import('../vendor/three/build/three.webgpu.js'),
    import('../vendor/three/build/three.tsl.js'),
    import('../js/terrain.js'),
    import('../js/ede-rural-landmark-survey.js'),
    import('../js/city-config.js'),
    import('../js/ede-landmark-sites.js'),
    import('../js/ede-playable-boundary.js'),
  ]);
  const heights = gunzipSync(readFileSync(join(__dirname, '../assets/ede-terrain-tiles/collision.bin.gz')));
  const field = terrainModule.decodeTerrain(heights.buffer.slice(heights.byteOffset, heights.byteOffset + heights.byteLength));
  const terrain = { getTerrain: () => field, terrainHeightAt: (x, z) => terrainModule.sampleTerrain(field, x, z) };
  const engine = { 'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain };
  const civic = load('ede-civic-landmarks.js', {
    ...engine, './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] },
    './ede-geodata.js': { EDE_DATA: {} }, './ede-wind-props.js': {}, './aerial-colors.js': {},
    './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const { RURAL_LANDMARK_FACTORIES } = load('ede-rural-landmarks.js', {
    ...engine, './ede-civic-landmarks.js': civic, './ede-rural-landmark-survey.js': survey,
    './ede-survey-landmark.js': load('ede-survey-landmark.js', { ...engine, './ede-civic-landmarks.js': civic }),
    './ede-windmill.js': load('ede-windmill.js', engine),
  });
  const osmIds = new Set(mapping.EDE_DATA.buildings.map(({ id }) => id));
  for (const site of survey.EDE_RURAL_LANDMARKS) {
    const { id, x, z, bagIds, surveyFootprints } = site;
    assert.ok(registry.EDE_MODELED_LANDMARKS.includes(site), id);
    assert.ok(mapping.NYC_LANDMARKS.some(landmark => landmark.id === id && !landmark.hideOnMap), id);
    const arrival = mapping.TELEPORT_LOCATIONS[id];
    assert.ok(arrival?.focus && coverage.containsPlayablePoint(arrival.x, arrival.z), id);
    assert.ok([site.osmId, ...site.annexOsmIds].every(osmId => osmIds.has(osmId)), id);
    const exclusions = registry.landmarkBagExclusions({
      min: { x: x - 50, z: z - 50 }, max: { x: x + 50, z: z + 50 },
    });
    assert.ok(bagIds.every(bagId => exclusions.has(bagId)), id);

    const model = RURAL_LANDMARK_FACTORIES[id](surveyFootprints, site);
    const ground = terrain.terrainHeightAt(x, z);
    if (!site.worldSpace) {
      model.position.set(x, ground, z);
      model.rotation.y = site.heading;
    } else {
      assert.equal(model.userData.colliders.length, surveyFootprints.length, id);
      for (const collider of model.userData.colliders) {
        assert.ok(arrival.x < collider.minX || arrival.x > collider.maxX ||
          arrival.z < collider.minZ || arrival.z > collider.maxZ, id);
      }
    }
    const bounds = new three.Box3().setFromObject(model);
    assert.ok(bounds.min.x < x && bounds.max.x > x && bounds.min.z < z && bounds.max.z > z, id);
    const roof = site.worldSpace
      ? Math.max(...survey.RURAL_LANDMARK_SURVEYS[id].flatMap(({ points }) => points.map(point => point[1])))
      : ground + site.height;
    assert.ok(bounds.min.y <= ground && bounds.max.y >= roof - 0.05, id);
    model.traverse(object => {
      if (object.isMesh) assert.ok(object.geometry.attributes.position.array.every(Number.isFinite), id);
    });
    if (id === 'walderveense-molen') {
      const sails = model.getObjectByName('Windmill sails');
      const cap = model.getObjectByName('Windmill cap');
      const start = sails.rotation.z;
      cap.userData.updateWind(1, { windSpeed: 20, windDirection: 270 });
      assert.notEqual(sails.rotation.z, start);
    }
  }
});
