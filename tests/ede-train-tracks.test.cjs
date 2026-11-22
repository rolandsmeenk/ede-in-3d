const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const EDE = 'ede-wageningen';
const CENTRUM = 'ede-centrum';
const getTracks = () => import('../js/ede-train-tracks.js').then(({ buildEdeTrainTracks }) => buildEdeTrainTracks());
const delta = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const bearing = point => (-point.heading * 180 / Math.PI + 360) % 360;

test('passenger routes use connected alignments and distinct local berths', async () => {
  const { paths } = await getTracks();
  const find = id => paths.find(path => path.id === id);
  const east = find('main-5-east'), west = find('main-3-west');
  const south = find('rs34-south'), north = find('rs34-north');

  for (const path of [east, west, find('main-4-through-east'), find('main-4-through-west')]) {
    assert.equal(path.terminal, undefined);
    const { x: first } = path.sample(0), { x: last } = path.sample(path.length);
    assert.ok(Math.min(first, last) < -5412);
    assert.ok(Math.max(first, last) > 1981);
  }
  assert.ok(east.sample(0).x < east.sample(east.length).x);
  assert.ok(west.sample(0).x > west.sample(west.length).x);
  assert.equal(east.stops[EDE].platform, '5');
  assert.equal(west.stops[EDE].platform, '3');
  assert.ok(delta(east.sample(east.stops[EDE].distance), west.sample(west.stops[EDE].distance)) > 15);
  const east3 = find('main-3-east');
  assert.ok(delta(east.sample(500), east3.sample(500)) < 0.01);
  assert.ok(delta(east3.sample(east3.stops[EDE].distance), west.sample(west.stops[EDE].distance)) < 0.01);

  assert.equal(south.terminal, EDE);
  assert.equal(north.terminal, EDE);
  assert.ok(south.stops[CENTRUM].distance < south.stops[EDE].distance);
  assert.ok(north.stops[EDE].distance < north.stops[CENTRUM].distance);
  for (const stop of [EDE, CENTRUM]) {
    const a = south.sample(south.stops[stop].distance);
    const b = north.sample(north.stops[stop].distance);
    assert.equal(south.stops[stop].platform, '1');
    assert.ok(delta(a, b) < 0.01);
    assert.ok(Math.abs(1 + Math.cos(a.heading - b.heading)) < 1e-6);
  }

  for (const id of ['main-4-east', 'main-4-west', 'main-4-through-east', 'main-4-through-west']) {
    const path = find(id);
    assert.equal(path.stops[EDE].platform, '4');
    assert.ok(delta(path.sample(path.stops[EDE].distance), find('main-4-east').sample(find('main-4-east').stops[EDE].distance)) < 0.01);
    const distance = path.stops[EDE].distance;
    assert.ok(distance > 100 && (path.length - distance) > 100);
  }
});

async function loadLocalGrade() {
  const { loadTerrain } = await import('../js/terrain.js');
  const { setEdeGrade } = await import('../js/ede-grade.js');
  const grade = await readFile(path.join(__dirname, '../assets/ede-grade.json'), 'utf8');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => new Response(await readFile(url));
    await loadTerrain();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return setEdeGrade(JSON.parse(grade));
}

test('train wheels follow continuous rail height through full station berths', async () => {
  const { railHeightAt } = await import('../js/ede-grade.js');
  await loadLocalGrade();

  const { paths } = await getTracks();
  for (const path of paths) {
    const { distance, platform } = path.stops[EDE];
    let previous = path.sample(distance - 100);
    for (let offset = -99; offset <= 100; offset++) {
      const point = path.sample(distance + offset);
      const wayId = { '1': point.x <= 169.8 ? 'w227837719' : 'w431638734',
        '3': 'w431657554', '4': 'w1052080205', '5': 'w1052080207' }[platform];
      const rail = railHeightAt(wayId, point.x, point.z);
      assert.ok(Math.abs(point.y - (rail + 0.13)) < 0.006, path.id);
      assert.ok(Math.abs(point.y - previous.y) < 0.01, path.id);
      assert.ok(Math.abs(delta(point, previous) - 1) < 0.01, path.id);
      previous = point;
    }
  }
});

test('train wheels cross every measured public road surface and stay below the A30 deck', async () => {
  const { gradeCuts, gradeWayAt, railHeightAt } = await import('../js/ede-grade.js');
  const grade = await loadLocalGrade();
  const { paths } = await getTracks();
  const alignments = {
    w431666247: 'main-3-west', w431666248: 'main-5-east',
    w431762038: 'rs34-south', w431865751: 'rs34-south'
  };
  const alignmentFor = wayId => paths.find(path => path.id === (alignments[wayId] ??
    (wayId === 'w431760850' ? 'rs34-north' : 'rs34-south')));
  const levelSites = grade.sites.filter(site => site.kind === 'level');
  const legacy = levelSites.filter(site => !site.id.startsWith('north-'));
  const northern = levelSites.filter(site => site.id.startsWith('north-'));
  assert.equal(legacy.length, 14);
  assert.equal(legacy.reduce((total, site) => total + site.crossings.length, 0), 25);
  assert.equal(northern.length, 15);
  assert.equal(northern.reduce((total, site) => total + site.crossings.length, 0), 17);
  for (const site of levelSites) {
    for (const { x, z, y, railWayId, roadWayIds } of site.crossings) {
      const alignment = alignmentFor(railWayId);
      const { distance, error } = alignment.project(x, z, railWayId);
      const train = alignment.sample(distance);
      assert.ok(error < 0.5, site.id);
      assert.ok(Math.abs(train.y - (y + 0.055)) < 0.012, site.id);
      assert.ok(Math.abs(train.y - (railHeightAt(railWayId, train.x, train.z) + 0.13)) < 0.012, site.id);
      assert.ok(gradeCuts({ minX: x - 0.05, maxX: x + 0.05, minZ: z - 0.05, maxZ: z + 0.05 }).length, site.id);
      for (const wayId of roadWayIds) assert.ok(Math.abs(gradeWayAt(wayId, x, z)?.y - y) < 0.012, wayId);
      for (let offset = -42; offset < 42; offset++) {
        const a = alignment.sample(distance + offset), b = alignment.sample(distance + offset + 1);
        assert.ok(Math.abs(b.y - a.y) < 0.02, site.id);
      }
    }
  }

  const bridge = grade.sites.find(site => site.id === 'a30-rail-bridge');
  assert.equal(bridge.qa.length, 4);
  for (const { sample: [x, z, y] } of bridge.qa) {
    for (const railWayId of ['w431666247', 'w431666248']) {
      const alignment = alignmentFor(railWayId);
      const { distance } = alignment.project(x, z);
      const train = alignment.sample(distance);
      assert.ok(Math.abs(train.y + grade.datumNAP - 10.03) < 0.1, railWayId);
      assert.ok(y - train.y - 0.61 >= bridge.clearance, railWayId);
      for (let offset = -115; offset < 115; offset++) {
        const a = alignment.sample(distance + offset), b = alignment.sample(distance + offset + 1);
        assert.ok(Math.abs(b.y - a.y) < 0.003, railWayId);
      }
    }
  }
});

test('both mainline passenger routes keep a continuous grade through Keesom, Koepel and Soma', async () => {
  const grade = await loadLocalGrade();
  const { paths } = await getTracks();
  const crossings = [
    [-1747.5, 1491.5, 15.12],
    [-1248.2, 1642.9, 17.03],
    [-1004.8, 1713.6, 17.89]
  ];
  for (const id of ['main-5-east', 'main-3-west']) {
    const alignment = paths.find(path => path.id === id);
    for (const [x, z, nap] of crossings) {
      const { distance } = alignment.project(x, z);
      assert.ok(Math.abs(alignment.sample(distance).y + grade.datumNAP - nap) < 0.12, id);
      for (let offset = -50; offset < 50; offset++) {
        const a = alignment.sample(distance + offset), b = alignment.sample(distance + offset + 1);
        assert.ok(Math.abs(b.y - a.y) < 0.012, id);
      }
    }
  }
});

test('the whole rail network stays continuous and the Valleilijn mesh follows the train profile', async () => {
  const grade = await loadLocalGrade();
  const gradeAPI = await import('../js/ede-grade.js');
  const terrain = await import('../js/terrain.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const corridors = gradeAPI.getRailCorridors();
  const junctions = new Map();
  for (const way of EDE_DATA.railways.filter(way => !way.tunnel)) {
    const { points } = corridors.get(way.id);
    const nodes = new Map(points.map(([x, z, y]) => [`${x},${z}`, y]));
    for (let i = 0; i < way.pts.length; i += 2) {
      const key = `${way.pts[i]},${way.pts[i + 1]}`;
      // The northern approach clips the final long OSM way off map.
      if (way.pts[i + 1] < EDE_DATA.meta.bounds[1] - 123) continue;
      assert.ok(Number.isFinite(nodes.get(key)), way.id);
      if (junctions.has(key)) assert.equal(nodes.get(key), junctions.get(key), key);
      junctions.set(key, nodes.get(key));
    }
  }

  const { paths } = await getTracks();
  for (const route of paths) {
    let previous = route.sample(0);
    for (let distance = 1; distance < route.length; distance++) {
      const point = route.sample(distance);
      assert.ok(Math.abs(point.y - previous.y) <= 0.031, `${route.id} at ${distance} m`);
      previous = point;
    }
  }

  const { loadModule } = require('./helpers/module.cjs');
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const source = await readFile(path.join(__dirname, '../js/ede-geometry.js'), 'utf8');
  const { edeRailStrip } = loadModule(source.replace('export function* edeTerrainGeometries', 'function* edeTerrainGeometries'), {
    imports: { 'three/webgpu': THREE, './city-config.js': { EDE_DATA }, './terrain.js': terrain, './ede-road-surfaces.js': {}, './ede-grade.js': gradeAPI }
  });
  const wayId = 'w431533902';
  const { sections } = corridors.get(wayId);
  const route = paths.find(route => route.id === 'rs34-south');
  const geometry = edeRailStrip(sections, 0.045, gradeAPI.RAIL_TOP, 1.435 / 2);
  const vertices = geometry.getAttribute('position');
  for (let i = 0; i < sections.length; i++) {
    const { a, b } = sections[i];
    for (const [k, center] of [a, b].entries()) {
      const hit = route.project(center.x, center.z, wayId);
      const train = route.sample(hit.distance);
      assert.ok(hit.error < 0.001);
      assert.ok(Math.abs(train.y - vertices.getY(4 * i + 2 * k)) < 0.0001);
      assert.ok(Math.abs(train.y + grade.datumNAP - 21) < 0.3);
    }
  }
  geometry.dispose();
});

test('live observations honor bearing, platform and a previous connected path', async () => {
  const { paths, match } = await getTracks();
  const west = paths.find(path => path.id === 'main-3-west');
  const p4 = paths.find(path => path.id === 'main-4-through-west');
  const p4Station = p4.sample(p4.stops[EDE].distance);
  assert.equal(match({ ...p4Station, speed: 12, bearing: bearing(p4Station) },
    { route: 'main', platform: '4', terminal: false }).path, p4);
  assert.equal(match({ ...p4Station, speed: 12, bearing: (bearing(p4Station) + 180) % 360 },
    { route: 'main', direction: -1, platform: '4' }), null);
  assert.equal(match({ x: 0, z: 0 }, { route: 'main' }), null);

  const previous = match({ ...west.sample(500), timestamp: 1000 }, { route: 'main', direction: -1, platform: '3' });
  const next = match({ ...p4.sample(600), timestamp: 1010 }, { platform: '4', terminal: false, previous });
  assert.equal(next.path, p4);
  assert.ok(Math.abs(next.distance - 600) < 0.01);
  assert.equal(match({ ...p4.sample(430), timestamp: 1020 }, { previous: next }), null);
  assert.equal(match({ ...p4.sample(650), timestamp: 1008 }, { previous: next }), null);

  const atStation = match({ ...west.sample(west.stops[EDE].distance), timestamp: 2000 },
    { route: 'main', direction: -1, platform: '3' });
  assert.equal(match({ ...p4Station, timestamp: 2005 }, { platform: '4', terminal: false, previous: atStation }), null);
  const north = paths.find(path => path.id === 'rs34-north');
  const centrum = north.sample(north.stops[CENTRUM].distance);
  assert.equal(match({ ...centrum, timestamp: 3000 },
    { route: 'rs34', direction: -1, platform: { station: CENTRUM, platform: '1' } }).path, north);
});
