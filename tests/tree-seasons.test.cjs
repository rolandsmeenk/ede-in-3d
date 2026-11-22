const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/tree-seasons.js'), 'utf8');

async function seasons() {
  const { Color, Vector4 } = await import('../vendor/three/build/three.webgpu.js');
  return loadModule(source, { imports: {
    'three/webgpu': { Color, Vector4 },
    'three/tsl': { floor: Math.floor, uniform: value => ({ value }), uniformArray: values => ({ element: i => values[i] }) }
  } });
}

test('live seasons follow Amsterdam midnight using the civil date through daylight saving time and leap years', async () => {
  const { amsterdamDayOfYear, getTreeSeason, setTreeSeason, refreshTreeSeason, seasonPresetFor } = await seasons();
  const before = new Date('2024-03-31T21:59:59Z');
  const after = new Date('2024-03-31T22:00:00Z');
  assert.equal(amsterdamDayOfYear(before), 90);
  assert.equal(amsterdamDayOfYear(after), 91);
  assert.equal(amsterdamDayOfYear(new Date('2025-12-31T23:15:00Z')), 0);
  assert.equal(setTreeSeason('today', before), 90);
  assert.equal(refreshTreeSeason(after), 91);
  assert.equal(setTreeSeason('winter', before), 14);
  assert.equal(refreshTreeSeason(after), 14);
  assert.equal(getTreeSeason(), 'winter');
  assert.equal(seasonPresetFor(new Date('2026-05-31T21:59:59Z')), 'spring');
  assert.equal(seasonPresetFor(new Date('2026-05-31T22:00:00Z')), 'summer');
});

test('Ginkelse Heide sheep are shorn on the second Saturday in June and regrow fleece for winter', async () => {
  const { sheepFleeceInfluences, setTreeSeason, refreshTreeSeason } = await seasons();
  for (const lastUnshornEvening of ['2024-06-07T21:59:59Z', '2026-06-12T21:59:59Z']) {
    const before = new Date(lastUnshornEvening);
    setTreeSeason('today', before);
    assert.equal(sheepFleeceInfluences[0], 1);
    refreshTreeSeason(new Date(before.getTime() + 1000));
    assert.equal(sheepFleeceInfluences[0], 0);
  }

  setTreeSeason('today', new Date('2026-07-10T12:00:00Z'));
  assert.equal(sheepFleeceInfluences[0], 0);
  setTreeSeason('summer');
  const lateSummerWool = sheepFleeceInfluences[0];
  assert.ok(lateSummerWool > 0 && lateSummerWool < 0.5);
  setTreeSeason('autumn');
  assert.ok(sheepFleeceInfluences[0] > lateSummerWool && sheepFleeceInfluences[0] < 1);
  setTreeSeason('winter');
  assert.equal(sheepFleeceInfluences[0], 1);
  setTreeSeason('spring');
  assert.equal(sheepFleeceInfluences[0], 1);
});

test('heather blooms in late summer in Amsterdam and in the Summer preset', async () => {
  const { TREE_SEASONS, heatherBloom, setTreeSeason, refreshTreeSeason } = await seasons();
  setTreeSeason('today', new Date('2025-07-23T12:00:00Z'));
  assert.equal(heatherBloom.value, 0);
  refreshTreeSeason(new Date('2025-08-17T12:00:00Z'));
  const opening = heatherBloom.value;
  assert.ok(opening > 0 && opening < 1);
  refreshTreeSeason(new Date('2025-08-29T12:00:00Z'));
  assert.equal(heatherBloom.value, 1);
  refreshTreeSeason(new Date('2025-09-14T12:00:00Z'));
  assert.ok(heatherBloom.value > 0 && heatherBloom.value < opening);
  assert.equal(Object.hasOwn(TREE_SEASONS, 'heather-bloom'), false);
  setTreeSeason('summer', new Date('2025-12-29T12:00:00Z'));
  assert.equal(heatherBloom.value, 1);
  setTreeSeason('winter');
  assert.equal(heatherBloom.value, 0);
});

test('the heath mask preserves polygon holes and uses more specific BGT terrain classes', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const heathSource = readFileSync(join(__dirname, '../js/ede-heath.js'), 'utf8');
  const { rasterizeHeath } = loadModule(heathSource, { imports: { 'three/webgpu': three } });
  const rect = (a, b, c, d) => [a, b, c, b, c, d, a, d];
  const features = [{ kind: 'heath', ring: rect(0, 0, 32, 32), holes: [rect(8, 8, 24, 24)] },
    { kind: 'grass', ring: rect(0, 0, 40, 40) }];
  const landCover = { minX: 8, minZ: 0, sizeX: 16, sizeZ: 16,
    texture: { image: { width: 2, height: 2, data: [1, 0, 0, 2] } } };
  const { pixels, width } = rasterizeHeath(features, [0, 0, 40, 40], landCover);
  const at = (x, z) => pixels[(1 + z) * width + x + 1];
  assert.equal(at(0, 0), 255, 'OSM heath');
  assert.equal(at(1, 0), 0, 'BGT woodland');
  assert.equal(at(1, 1), 0, 'OSM polygon hole');
  assert.equal(at(2, 1), 255, 'BGT heath');
  assert.equal(at(4, 4), 0, 'ordinary grass');
  assert.ok(pixels.slice(0, width).every(value => value === 0));
});

test('group profiles differ through spring and autumn, with evergreen coverage through winter', async () => {
  const { treePhenology } = await seasons();
  for (let group = 0; group <= 7; group++) {
    assert.equal(treePhenology(group, 195).leaves, 1);
    assert.equal(treePhenology(group, 195).turned, 0);
    assert.equal(treePhenology(group, 14).leaves, group === 1 ? 1 : 0);
  }
  assert.ok(treePhenology(2, 105).leaves > treePhenology(6, 105).leaves);
  assert.ok(treePhenology(2, 289).turned > treePhenology(6, 289).turned);
  assert.ok(treePhenology(6, 315).leaves > treePhenology(2, 315).leaves);
  assert.deepEqual({ ...treePhenology(255, 115) }, { ...treePhenology(0, 115) });
});

test('season changes replace neither the packed instance data nor the GPU palette objects', async () => {
  const { packTreeStyle, treeSeasonNodes, setTreeSeason } = await seasons();
  const generic = packTreeStyle(3, 0.53, 0);
  const evergreen = packTreeStyle(3, 0.53);
  const oak = packTreeStyle(0, 0.53, 6);
  assert.equal(Math.floor(generic) % 4, 3);
  assert.equal(Math.floor(generic / 4), 0);
  assert.equal(Math.floor(evergreen / 4), 1);
  assert.equal(Math.floor(oak / 4), 6);
  assert.ok(Math.abs((oak % 1) - 0.53) < 1e-7);

  const shaderStyle = style => ({ div: n => style / n });
  setTreeSeason('summer');
  const deciduous = treeSeasonNodes(shaderStyle(oak));
  const conifer = treeSeasonNodes(shaderStyle(evergreen));
  assert.deepEqual(deciduous.toArray(), [1, 1, 1, 1]);
  assert.deepEqual(conifer.toArray(), [1, 1, 1, 1]);

  setTreeSeason('autumn');
  assert.equal(treeSeasonNodes(shaderStyle(oak)), deciduous);
  assert.ok(deciduous.x > 1);
  setTreeSeason('winter');
  assert.equal(deciduous.w, 0);
  assert.deepEqual(conifer.toArray(), [1, 1, 1, 1]);
});
