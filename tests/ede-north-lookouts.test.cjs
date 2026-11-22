const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports) {
  return loadModule(readFileSync(join(__dirname, '../js/', name), 'utf8'), { imports, filename: name });
}

function horizontalClearance({ obb }, { x, z }) {
  const { cx, cz, cs, sn, hx, hz } = obb;
  const dx = x - cx, dz = z - cz;
  return Math.hypot(Math.max(0, Math.abs(dx * cs - dz * sn) - hx), Math.max(0, Math.abs(dx * sn + dz * cs) - hz));
}

test('Wekerom lookouts align with their paths and can be climbed and descended on foot', async ({ mock }) => {
  mock.method(globalThis, 'fetch', async url => new Response(readFileSync(url)));
  const [three, tsl, terrain, { EDE_DATA }, grade] = await Promise.all([
    import('../vendor/three/build/three.webgpu.js'), import('../vendor/three/build/three.tsl.js'),
    import('../js/terrain.js'), import('../js/ede-geodata.js'), import('../js/ede-grade.js'),
  ]);
  await terrain.loadTerrain({ expanded: true });
  await grade.loadEdeGrade();
  const { terrainHeightAt } = terrain;
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain, './bag3d.js': {},
    './ede-grade.js': grade, './ede-geodata.js': { EDE_DATA },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  });
  const { EDE_NORTH_LOOKOUTS } = load('ede-north-lookout-sites.js');
  const { EDE_NORTH_LOOKOUT_FACTORIES } = load('ede-north-lookouts.js', {
    'three/webgpu': three, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
  });
  const midpoint = (a, b) => civic.along(a, b, 0.5);

  for (const site of EDE_NORTH_LOOKOUTS) {
    const model = EDE_NORTH_LOOKOUT_FACTORIES[site.id]([], site);
    const bounds = new three.Box3().setFromObject(model);
    assert.ok(bounds.min.x < site.x && bounds.max.x > site.x);
    assert.ok(bounds.min.z < site.z && bounds.max.z > site.z);
    assert.ok(bounds.min.y < terrainHeightAt(site.x, site.z) + 0.3);
    assert.ok(Math.abs(bounds.max.y - terrainHeightAt(site.x, site.z) - site.height) < 0.32);
    assert.equal(model.children.length, 1);

    const { colliders, platforms } = model.userData;
    grade.setEdePlatforms(platforms);
    const surface = suffix => platforms.find(platform => platform.id === site.id + '-' + suffix);
    const leg = ({ outer: [a, b, c, d] }) => [midpoint(a, b), midpoint(c, d)];
    const isBult = site.id === 'uitkijktoren-de-bult';
    const [entry, firstEnd] = leg(surface(isBult ? 'lower-stair' : 'stair'));
    const mappedApproach = EDE_DATA.roads.find(road => road.id === (isBult ? 'w989856076' : 'w982255917'));
    assert.ok(Math.hypot(entry.x - mappedApproach.pts.at(-2), entry.z - mappedApproach.pts.at(-1)) < 2.5);
    const expectedDeck = surface('deck').height();
    const route = [entry, firstEnd];
    if (isBult) {
      const [secondStart, secondEnd] = leg(surface('upper-stair'));
      route.push({ x: 1853.08, z: -5442.01 }, secondStart, secondEnd,
        midpoint(midpoint(...surface('deck').outer.slice(0, 2)), midpoint(...surface('deck').outer.slice(2))));
    } else {
      const [p, q, e, d] = surface('turn').outer;
      const door = midpoint(p, d);
      const hall = midpoint(midpoint(p, q), midpoint(d, e));
      route.push(hall, door, { x: site.x, z: site.z - 0.6 });
    }
    route.unshift(civic.along(firstEnd, entry, 1.22));
    let y = terrainHeightAt(route[0].x, route[0].z);
    function check(from, to) {
      const count = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.05);
      for (let j = 1; j <= count; j++) {
        const point = civic.along(from, to, (j - 0.001) / count);
        const reference = y;
        y = grade.gradeHeightAt(point.x, point.z, y, 'person');
        assert.ok(Math.abs(y - reference) < 0.16, `${site.id} grade at ${JSON.stringify(point)}: ${reference} -> ${y}`);
        assert.ok(y >= terrainHeightAt(point.x, point.z) - 0.06);
        for (const collider of colliders) {
          if (collider.minY >= y + 1.9 || collider.maxY <= y) continue;
          const clearance = horizontalClearance(collider, point);
          assert.ok(clearance > 0.48, `${site.id} route clips a guard at ${JSON.stringify(point)} (${clearance.toFixed(2)})`);
        }
      }
    }
    for (let i = 1; i < route.length; i++) check(route[i - 1], route[i]);
    assert.ok(Math.abs(y - expectedDeck) < 0.01);
    for (let i = route.length - 1; i > 0; i--) check(route[i], route[i - 1]);
    assert.ok(Math.abs(y - terrainHeightAt(route[0].x, route[0].z)) < 0.07);
    assert.equal(grade.gradeProfileAt(route.at(-1).x, route.at(-1).z, 'motor', undefined, expectedDeck), null);
  }
});
