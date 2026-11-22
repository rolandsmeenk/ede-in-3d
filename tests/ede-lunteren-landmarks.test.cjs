const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports, globals) {
  return loadModule(readFileSync(join(__dirname, '../js/', name), 'utf8'), { imports, globals, filename: name });
}

function hits({ minX, maxX, minY, maxY, minZ, maxZ, obb }, x, y, z) {
  if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ) return false;
  if (!obb) return true;
  const dx = x - obb.cx, dz = z - obb.cz;
  return Math.abs(dx * obb.cs - dz * obb.sn) < obb.hx && Math.abs(dx * obb.sn + dz * obb.cs) < obb.hz;
}

test('Lunteren models are grounded, batched, and replace only the surveyed footprints', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const terrainModule = await import('../js/terrain.js');
  const heights = readFileSync(join(__dirname, '../assets/ede-terrain-tiles/collision.bin'));
  const field = terrainModule.decodeTerrain(heights.buffer.slice(heights.byteOffset, heights.byteOffset + heights.byteLength));
  const terrain = { getTerrain: () => field, terrainHeightAt: (x, z) => terrainModule.sampleTerrain(field, x, z) };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] }, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const survey = load('ede-lunteren-survey.js');
  const rail = load('ede-north-rail-data.js');
  const { LUNTEREN_LANDMARK_FACTORIES: factories } = load('ede-lunteren-landmarks.js', {
    './ede-clock-model.js': load('ede-clock-model.js', {
      'three/webgpu': three, 'three/tsl': tsl,
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: tsl.uniform(0.48) } },
    }),
    'three/webgpu': three, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    './ede-north-rail-data.js': rail, './ede-lunteren-survey.js': survey,
    './ede-survey-landmark.js': load('ede-survey-landmark.js', {
      './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    }),
    './ede-windmill.js': load('ede-windmill.js', { 'three/webgpu': three }),
  });
  assert.equal(survey.EDE_LUNTEREN_LANDMARKS.length, 11);
  for (const site of survey.EDE_LUNTEREN_LANDMARKS) {
    const model = factories[site.id](site.surveyFootprints, site);
    const bounds = new three.Box3().setFromObject(model);
    assert.equal(bounds.isEmpty(), false, site.id);
    assert.ok(bounds.min.x <= site.x && bounds.max.x >= site.x, site.id);
    assert.ok(bounds.min.z <= site.z && bounds.max.z >= site.z, site.id);
    assert.ok(bounds.min.y <= terrain.terrainHeightAt(site.x, site.z) + 0.3, site.id);
    let meshes = 0;
    model.traverse(object => {
      if (!object.isMesh) return;
      meshes++;
      assert.ok(object.geometry.attributes.position.array.every(Number.isFinite), site.id);
    });
    assert.ok(meshes <= 5, site.id);
    if (site.bagIds) {
      assert.equal(model.userData.colliders.filter(collider => collider.polygon).length, site.bagIds.length);
      assert.equal(site.surveyFootprints.length, site.bagIds.length);
    } else {
      assert.equal(site.bagIds, undefined);
      assert.equal(site.osmId, undefined);
    }
    const { x, z } = site.approach;
    assert.equal(model.userData.colliders.some(collider =>
      hits(collider, x, terrain.terrainHeightAt(x, z) + 0.8, z)), false, site.id);
    if (site.id === 'oude-kerk-lunteren') {
      assert.ok(bounds.max.y > 30.5 && bounds.max.y < 32, 'spire is within the AHN roof envelope and finial allowance');
    }
    if (site.id === 'station-lunteren') {
      const poles = model.userData.colliders.filter(collider => !collider.polygon);
      assert.equal(poles.length, 7);
      const platform = rail.EDE_NORTH_RAIL.platforms.find(p => p.number === '1');
      for (const pole of poles) assert.ok(Math.abs(pole.minY - platform.slope[0][2]) < 0.06);
    }
    if (site.id === 'middelpunt-van-nederland') {
      assert.equal(model.userData.platforms.length, 6);
      for (const platform of model.userData.platforms) {
        for (const { x, z } of platform.outer) {
          assert.ok(platform.height(x, z) > terrain.terrainHeightAt(x, z) + 0.05);
        }
      }
      const [tx, tz] = survey.LUNTEREN_STRUCTURES.middelpuntLime;
      assert.equal(model.userData.colliders.some(collider =>
        hits(collider, tx, terrain.terrainHeightAt(tx, tz) + 0.30, tz)), false, 'bench keeps the lime trunk free');
      const [cx, cz] = survey.LUNTEREN_STRUCTURES.middelpuntRing;
      for (const degrees of [5.3, 92.6, 214.2]) {
        const angle = degrees * Math.PI / 180;
        for (let r = 8.4; r <= 13.1; r += 0.2) {
          const x = cx + Math.sin(angle) * r, z = cz + Math.cos(angle) * r;
          assert.equal(model.userData.colliders.some(collider =>
            hits(collider, x, terrain.terrainHeightAt(x, z) + 0.28, z)), false, `entrance at ${degrees}°`);
        }
      }
    }
    if (site.id !== 'hessenhut') continue;
    const [start, ...landings] = model.userData.platforms;
    const sections = [start, ...landings.slice(0, 3)];
    let previousEnd;
    for (const section of sections) {
      const { outer: [a, b, c, d] } = section;
      const entry = civic.along(a, b, 0.5), exit = civic.along(c, d, 0.5);
      if (previousEnd) {
        assert.ok(Math.hypot(previousEnd.x - entry.x, previousEnd.z - entry.z) < 0.001);
        assert.ok(Math.abs(previousEnd.y - section.height(entry.x, entry.z)) < 0.001);
      }
      for (let i = 0; i <= 10; i++) {
        const p = civic.along(entry, exit, i / 10), y = section.height(p.x, p.z);
        assert.ok(y >= terrain.terrainHeightAt(p.x, p.z) - 0.055, `approach buried at ${p.x} ${p.z}`);
        assert.equal(model.userData.colliders.some(collider => hits(collider, p.x, y + 0.55, p.z)), false,
          `railing blocks centre of ${section.id}`);
      }
      previousEnd = { ...exit, y: section.height(exit.x, exit.z) };
    }
    const lower = landings.at(-2), upper = landings.at(-1);
    assert.ok(upper.height() - lower.height() > 2);
    assert.ok(Math.abs(previousEnd.y - upper.height()) < 0.001, 'last stair joins the upper deck');
  }
});
