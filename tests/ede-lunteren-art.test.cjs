const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports) {
  return loadModule(readFileSync(join(__dirname, '../js/', name), 'utf8'), { imports, filename: name });
}

test('Lunteren artwork fits public approaches without replacing nearby buildings', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const terrainModule = await import('../js/terrain.js');
  const bytes = readFileSync(join(__dirname, '../assets/ede-terrain-tiles/collision.bin'));
  const field = terrainModule.decodeTerrain(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const terrain = { terrainHeightAt: (x, z) => terrainModule.sampleTerrain(field, x, z) };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] }, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const sites = await import('../js/ede-lunteren-art-sites.js');
  const { LANDMARK_SITES, TELEPORT_LOCATIONS } = await import('../js/city-config.js');
  const { EDE_LUNTEREN_ART_LANDMARK_FACTORIES: models } = load('ede-lunteren-art.js', {
    'three/webgpu': three, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    './ede-lunteren-art-sites.js': sites,
  });
  assert.deepEqual(Object.keys(models), sites.EDE_LUNTEREN_ART_LANDMARKS.map(site => site.id));
  for (const site of sites.EDE_LUNTEREN_ART_LANDMARKS) {
    const model = models[site.id]([], site);
    const bounds = new three.Box3().setFromObject(model);
    assert.ok(model.userData.colliders, site.id);
    assert.ok(site.worldSpace && site.mapScenic && !site.surveyFootprints.length, site.id);
    assert.deepEqual(LANDMARK_SITES[site.name].ring, [], site.id);
    assert.equal(LANDMARK_SITES[site.name].h, site.height, site.id);
    assert.deepEqual(TELEPORT_LOCATIONS[site.id].focus.x, site.x, site.id);
    assert.deepEqual(TELEPORT_LOCATIONS[site.id].focus.z, site.z, site.id);
    assert.ok(!bounds.isEmpty(), site.id);
    assert.ok(bounds.max.y > terrain.terrainHeightAt(site.x, site.z), site.id);
    const { x, z } = site.approach;
    assert.ok(Math.hypot(x - site.x, z - site.z) > 2, site.id);
    for (const c of model.userData.colliders) {
      assert.ok(x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ, site.id);
    }
    let meshes = 0;
    model.traverse(child => {
      if (!child.isMesh) return;
      meshes++;
      assert.ok(child.geometry.getAttribute('position').array.every(Number.isFinite), site.id);
    });
    assert.ok(meshes <= 2, site.id);

    if (site.id === 'de-meander-lunteren') {
      assert.ok(bounds.max.x - bounds.min.x > 245, 'inlaid waterline reaches the station forecourt');
      const positions = model.children[0].geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const height = positions.getY(i) - terrain.terrainHeightAt(positions.getX(i), positions.getZ(i));
        assert.ok(height > 0.065 && height < 0.09, 'inlays sit just above the modeled pavement');
      }
    }
    if (site.id === 'goudsberg-pijlpunt-nieuwe-erf') {
      const heading = Math.atan2(site.x - (-1731.46), site.z - (-6113.77));
      assert.ok(Math.abs(site.heading - heading) < 0.03, 'the wedge points at the surveyed Middelpunt');
    }
  }
});
