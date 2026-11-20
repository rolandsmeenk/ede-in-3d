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
    'three/tsl': { floor: Math.floor, uniformArray: values => ({ element: i => values[i] }) }
  } });
}

test('Today follows Amsterdam midnight using the civil date through daylight savings and leap years', async () => {
  const { amsterdamDayOfYear, getTreeSeason, setTreeSeason, refreshTreeSeason } = await seasons();
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
