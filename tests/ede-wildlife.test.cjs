const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const load = (name, imports) => loadModule(readFileSync(join(__dirname, '../js', name), 'utf8'), { imports, filename: name });
const activity = load('ede-wildlife-activity.js');
const routes = load('ede-wildlife-routes.js');
const warm = { date: '2026-07-12', weather: 'dry', temperature: 22, windSpeed: 9 };
const daylight = { ...warm, minute: 12 * 60, sunElevation: 45 };
const twilight = { ...warm, minute: 21 * 60, sunElevation: -4 };

test('wildlife follows the displayed date, daylight, weather and habitat', () => {
  const select = activity.wildlifeActivity;
  assert.ok(select(daylight).skylark);
  assert.ok(select(daylight).butterfly);
  assert.ok(!select(daylight).nightjar);
  assert.ok(select(twilight).nightjar);
  assert.ok(!select(twilight).skylark);
  assert.ok(!select({ ...twilight, minute: 4 * 60 }).nightjar);
  assert.ok(!select({ ...twilight, date: '2026-02-12' }).nightjar);
  assert.ok(!select({ ...daylight, weather: 'rain' }).butterfly);
  assert.ok(!select({ ...daylight, temperature: 12 }).butterfly);
  assert.ok(!select({ ...daylight, windSpeed: 28 }).butterfly);

  const ginkel = { x: 4285, z: 1200 };
  const wambuis = { x: 7500, z: 120 };
  const seed = select(daylight).seed;
  assert.ok(activity.findWildlifeSite('skylark', ginkel, () => ({ heath: true }), seed));
  assert.equal(activity.findWildlifeSite('skylark', ginkel, () => ({ heath: true, edge: true }), seed), null);
  assert.equal(activity.findWildlifeSite('butterfly', ginkel, () => ({ heath: true }), seed), null);
  assert.ok(activity.findWildlifeSite('butterfly', ginkel, (x) => ({ heath: x < 4285, sand: x >= 4285 }), seed));
  assert.ok(activity.findWildlifeSite('nightjar', ginkel, () => ({ edge: true }), seed));
  assert.ok(activity.findWildlifeSite('mammal', wambuis, () => ({ edge: true }), seed));
  assert.equal(activity.findWildlifeSite('mammal', ginkel, () => ({ edge: true }), seed), null);

  const outcomes = new Set(Array.from({ length: 30 }, (_, i) => select({
    ...twilight, date: `2026-07-${String(i + 1).padStart(2, '0')}`,
  }).mammal));
  assert.ok(outcomes.has(null) && outcomes.has('red-deer') && outcomes.has('wild-boar'));
});

test('mapped heath and woodland edges support encounters from public scene approaches', async () => {
  const { createEdeHabitatSampler, decodeEdeNatureHabitats } = await import('../js/ede-nature-habitats.js');
  const data = gunzipSync(readFileSync(join(__dirname, '../assets/ede-nature-habitats.bin.gz')));
  const cover = createEdeHabitatSampler(decodeEdeNatureHabitats(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
  const habitatAt = (x, z) => {
    const kind = cover(x, z);
    return { heath: kind === 'dry-heath' || kind === 'damp-heath', grass: kind === 'grassland',
      sand: kind === 'sand', woodland: kind === 'woodland', edge: kind === 'woodland-edge' };
  };
  const ginkel = { x: 4279, z: 1009 };
  const wambuis = { x: 7519, z: 123 };
  const summer = { ...daylight, date: '2026-08-27', calendar: false, season: 'summer' };
  const { seed, butterfly, skylark } = activity.wildlifeActivity(summer);
  assert.ok(butterfly && skylark);
  assert.ok(activity.wildlifeActivity({ ...summer, minute: 1230, sunElevation: -3 }).nightjar);
  assert.ok(activity.findWildlifeSite('butterfly', ginkel, habitatAt, seed));
  assert.ok(activity.findWildlifeSite('skylark', ginkel, habitatAt, seed));
  assert.ok(activity.findWildlifeSite('nightjar', ginkel, habitatAt, seed));
  assert.ok(activity.findWildlifeSite('mammal', wambuis, habitatAt, seed));
});

test('the two flocks follow their own timed routes and return from grazing', () => {
  const [ginkel, kreel] = routes.EDE_FLOCK_ROUTES;
  const pose = {};
  for (const route of [ginkel, kreel]) {
    const first = route.path[0], last = route.path.at(-1);
    routes.sampleFlock(route, route.departure - 60, 0, 0, true, pose);
    assert.ok(!pose.walking && Math.hypot(pose.x - first[0], pose.z - first[1]) < 13);
    routes.sampleFlock(route, route.departure + 45, 0, 0, true, pose);
    assert.ok(pose.walking && Math.hypot(pose.x - first[0], pose.z - first[1]) > 15);
    routes.sampleFlock(route, 12 * 3600, 0, 0, true, pose);
    assert.ok(pose.grazing && Math.hypot(pose.x - last[0], pose.z - last[1]) < 22);
    routes.sampleFlock(route, route.arrival + 60, 0, 0, true, pose);
    assert.ok(!pose.walking && Math.hypot(pose.x - first[0], pose.z - first[1]) < 13);
  }
  assert.ok(kreel.departure > ginkel.departure);
});

test('camera-local flock models reuse their geometry and update fleece and spatial sound', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': {},
    './bag3d.js': {}, './ede-grade.js': {}, './ede-geodata.js': {},
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const sheepFleeceInfluences = [0];
  const models = load('ede-wildlife-models.js', { 'three/webgpu': three, './ede-civic-landmarks.js': civic,
    './tree-seasons.js': { sheepFleeceInfluences } });
  const { createEdeWildlife } = load('ede-wildlife.js', {
    'three/webgpu': three, './ede-wildlife-models.js': models,
    './ede-wildlife-activity.js': activity, './ede-wildlife-routes.js': routes,
  });
  const scene = new three.Scene();
  scene.matrixWorldAutoUpdate = false;
  const system = createEdeWildlife(scene, () => 5, () => ({ heath: true }));
  const root = scene.getObjectByName('Ede seasonal wildlife');
  system.update(.1, { x: 0, y: 7, z: 0 }, daylight);
  assert.equal(root.children.length, 0);
  const camera = { x: 4325, y: 7, z: 1076 };
  system.update(.1, camera, { ...daylight, minute: 8 * 60 });
  const flock = root.getObjectByName('Ginkelse Heide sheep flock');
  assert.ok(flock.visible);
  const mesh = flock.getObjectByName('Seasonal fleece');
  const matrix = new three.Matrix4();
  mesh.getMatrixAt(0, matrix);
  const shornScale = new three.Vector3().setFromMatrixScale(matrix);
  const source = system.soundSources.find(({ kind }) => kind === 'sheep');
  assert.ok(source.x > 4320 && source.x < 4333);
  sheepFleeceInfluences[0] = 1;
  system.update(.1, camera, daylight);
  mesh.getMatrixAt(0, matrix);
  assert.ok(new three.Vector3().setFromMatrixScale(matrix).y > shornScale.y * 1.5);
  assert.ok(source.x < 4300 && source.z > 1105);
  const skylark = root.getObjectByName('Skylark');
  assert.ok(skylark.visible && skylark.matrixWorld.elements[13] > 9);
  assert.ok(system.soundSources.some(({ kind }) => kind === 'skylark'));
  system.update(.1, { x: 3323, y: 7, z: 92 }, daylight);
  assert.ok(!flock.visible && root.getObjectByName('De Kreel sheep flock').visible);
});
