const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports) {
  return loadModule(readFileSync(join(__dirname, '../js', name), 'utf8'), { imports, filename: name });
}

test('memorials have registered map approaches and terrain-fitted geometry', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const bytes = readFileSync(join(__dirname, '../assets/ede-terrain-tiles/collision.bin'));
  const field = decodeTerrain(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const terrain = { terrainHeightAt: (x, z) => sampleTerrain(field, x, z) };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] }, './ede-geodata.js': {},
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { EDE_MODELED_LANDMARKS, modeledLandmarkFootprints } = await import('../js/ede-landmark-sites.js');
  const { TELEPORT_LOCATIONS } = await import('../js/city-config.js');
  const ids = new Set();
  for (const [zone, key, count] of [['paasberg', 'PAASBERG', 6], ['town', 'TOWN', 4], ['outer', 'OUTER', 8]]) {
    const sites = (await import(`../js/ede-${zone}-memorial-sites.js`))[`EDE_${key}_MEMORIALS`];
    const models = load(`ede-${zone}-memorials.js`, {
      'three/webgpu': three, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    })[`EDE_${key}_MEMORIAL_FACTORIES`];
    assert.equal(sites.length, count);
    assert.deepEqual(Object.keys(models).sort(), sites.map(({ id }) => id).sort());
    for (const site of sites) {
      const { id, name, x, z, approach } = site;
      assert.ok(!ids.has(id), id);
      ids.add(id);
      const enabled = !site.north || Boolean(EDE_DATA.meta.north);
      assert.equal(EDE_MODELED_LANDMARKS.some(row => row.id === id), enabled, id);
      if (!enabled) continue;
      assert.equal(modeledLandmarkFootprints(site).length, 0, id);
      const arrival = TELEPORT_LOCATIONS[id];
      assert.equal(arrival.x, approach.x, id);
      assert.equal(arrival.z, approach.z, id);
      assert.equal(arrival.focus.x, x, id);
      assert.equal(arrival.focus.z, z, id);

      const model = models[id]([], site);
      const ground = terrain.terrainHeightAt(x, z);
      if (!site.worldSpace) {
        model.position.set(x, ground, z);
        model.rotation.y = site.heading;
      }
      const bounds = new three.Box3().setFromObject(model);
      assert.ok(!bounds.isEmpty() && bounds.max.y > ground, name);
      assert.ok(Math.abs(bounds.getCenter(new three.Vector3()).x - x) < 12, name);
      model.traverse(child => {
        if (child.isMesh) assert.ok(child.geometry.getAttribute('position').array.every(Number.isFinite), name);
      });
      assert.ok(Array.isArray(model.userData.colliders), name);
      for (const collider of model.userData.colliders) {
        assert.ok(approach.x < collider.minX || approach.x > collider.maxX ||
          approach.z < collider.minZ || approach.z > collider.maxZ, `${name} arrival clears the memorial`);
      }
    }
  }
});
