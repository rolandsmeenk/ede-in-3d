const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports) {
  return loadModule(readFileSync(join(__dirname, '../js/', name), 'utf8'), { imports, filename: name });
}

function contains(ring, { x, z }) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [ax, az] = [ring[i], ring[i + 1]], [bx, bz] = [ring[j], ring[j + 1]];
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
  }
  return inside;
}

test('Lunteren church surveys replace their matching outlines and build finite batched facades', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const terrainModule = await import('../js/terrain.js');
  const heights = gunzipSync(readFileSync(join(__dirname, '../assets/ede-terrain-tiles/collision.bin.gz')));
  const field = terrainModule.decodeTerrain(heights.buffer.slice(heights.byteOffset, heights.byteOffset + heights.byteLength));
  const terrain = { terrainHeightAt: (x, z) => terrainModule.sampleTerrain(field, x, z) };
  const materials = { createFacadeSurfaceTexture: () => ({ texture: new three.DataTexture() }) };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': materials,
  });
  const coordinates = load('ede-scene-coordinates.js');
  const clocks = load('ede-clock-model.js', {
    'three/webgpu': three, 'three/tsl': tsl,
    './tsl-materials.js': { cityUniforms: { uInteriorGlow: tsl.uniform(0.48) } },
  });
  const { createAdditionalChurch } = load('ede-church-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './ede-civic-landmarks.js': civic, './ede-scene-coordinates.js': coordinates,
    './ede-facade-material.js': materials, './ede-wind-props.js': {},
    './ede-clock-model.js': clocks,
  });
  const { LUNTEREN_CHURCH_SITES: sites } = load('ede-lunteren-church-sites.js');
  const { LUNTEREN_CHURCH_STYLES: styles } = load('ede-lunteren-church-models.js', {
    'three/webgpu': three, './terrain.js': terrain, './ede-scene-coordinates.js': coordinates,
  });
  const { buildings } = JSON.parse(gunzipSync(readFileSync(join(__dirname, '../assets/ede-north-v1.json.gz'))));
  assert.equal(sites.length, 5);
  assert.deepEqual([...sites.map(site => site.id)].sort(), Object.keys(styles).sort());
  assert.equal(new Set(sites.flatMap(site => site.bagIds)).size, sites.length);
  for (const site of sites) {
    const fallback = buildings.find(row => row.id === site.osmId);
    assert.ok(fallback, site.id);
    const { ground: [footprint], points } = site.churchSurvey;
    for (const index of footprint) {
      const [x, , z] = points[index];
      let nearest = Infinity;
      for (let i = 0; i < fallback.ring.length; i += 2) {
        nearest = Math.min(nearest, Math.hypot(fallback.ring[i] - x, fallback.ring[i + 1] - z));
      }
      assert.ok(nearest < 3, site.id);
    }
    assert.ok(site.mapScenic && site.focusHeight > 0, site.id);
    assert.ok(buildings.every(row => !contains(row.ring, site.approach)), site.id);
    const model = createAdditionalChurch(site, site.churchSurvey, styles[site.id]);
    assert.equal(model.children.length, 2, site.id);
    assert.equal(model.userData.colliders.length, 1, site.id);
    assert.equal(model.userData.colliders[0].polygon.outer.length, site.churchSurvey.ground[0].length, site.id);
    const [shell, facade] = model.children;
    assert.equal(facade.userData.nearDetail, 175, site.id);
    assert.ok(facade.children[0].geometry.attributes.position.count > 250, site.id);
    for (const mesh of [shell, facade.children[0]]) {
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite), site.id);
      assert.ok(mesh.geometry.attributes.normal.array.every(Number.isFinite), site.id);
    }
    const { min, max } = shell.geometry.boundingBox;
    assert.ok(min.y < terrain.terrainHeightAt(site.x, site.z) + 0.25, site.id);
    assert.ok(max.y > site.churchSurvey.base + site.height - coordinates.SCENE_NAP_ORIGIN - 0.05, site.id);
  }
});

test('tower clocks read clockwise from outside and advance the hour hand between hours', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const { addClockDetails, clockFace } = load('ede-clock-model.js', {
    'three/webgpu': three, 'three/tsl': tsl,
    './tsl-materials.js': { cityUniforms: { uInteriorGlow: tsl.uniform(0.48) } },
  });
  const group = new three.Group();
  const signs = [1, -1];
  addClockDetails(group, signs.map(sign => clockFace((u, y, depth) => [u, y, sign * (2 + depth)], 1, 0xf0deae)));
  const mesh = group.children[0];
  assert.equal(mesh.count, 28);
  const update = mesh.userData.setClockMinutes;
  update(210); // 03:30
  const matrix = new three.Matrix4();
  const direction = (index) => {
    mesh.getMatrixAt(index, matrix);
    return new three.Vector3(0, 1, 0).transformDirection(matrix);
  };
  for (const [index, sign] of signs.entries()) {
    const hour = direction(index * 2);
    assert.ok(Math.abs(hour.x - sign * Math.sin(7 * Math.PI / 12)) < 1e-6);
    assert.ok(Math.abs(hour.y - Math.cos(7 * Math.PI / 12)) < 1e-6);
    assert.ok(direction(index * 2 + 1).y < -0.99999);
  }
  const positionOfFirstHourMark = direction(4);
  assert.ok(positionOfFirstHourMark.y > 0.99999);
  const version = mesh.instanceMatrix.version;
  update(210);
  assert.equal(mesh.instanceMatrix.version, version);
  update(211);
  assert.equal(mesh.instanceMatrix.version, version + 1);
  assert.ok(positionOfFirstHourMark.equals(direction(4)));
});
