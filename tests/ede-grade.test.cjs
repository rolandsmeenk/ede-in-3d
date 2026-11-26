const assert = require('node:assert/strict');
const test = require('node:test');

test('nearby rail lookup preserves reach and track order across cell boundaries', async () => {
  const { nearbyRailHeightAt, setEdeGrade } = await import('../js/ede-grade.js');
  setEdeGrade({ sites: [], railHeights: [
    { wayId: 'first', points: [[28, 47, 2], [68, 47, 2]] },
    { wayId: 'second', points: [[28, 49, 6], [68, 49, 6]] },
  ] });
  assert.equal(nearbyRailHeightAt(48, 48), 2);
  assert.equal(nearbyRailHeightAt(48, 52), 6);
  assert.equal(nearbyRailHeightAt(48, 79, 28), undefined);
  assert.equal(nearbyRailHeightAt(48, 79, 32), 6);
  assert.equal(nearbyRailHeightAt(48, 89, 40), 6);
});

test('native AHN crossing approaches tie into the terrain and retain concealed clearance', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { setEdeGrade, gradeWayAt, gradeProfileAt } = await import('../js/ede-grade.js');
  const grade = JSON.parse(readFileSync(join(__dirname, '../assets/ede-grade.json'), 'utf8'));
  setEdeGrade(grade);

  const northApproach = [[213.5, -722.5, 23.41], [179.6, -689.03, 21.53], [162.5, -672.2, 20.58]];
  for (const [x, z, nap] of northApproach) {
    assert.ok(Math.abs(gradeWayAt('w24994849', x, z).y + grade.datumNAP - nap) < 0.06);
  }
  const cycle = gradeProfileAt(106.28, -614.85, 'cyclist', undefined, -2.5);
  assert.equal(cycle.id, 'bospoorttunnel-lower-w24994852');
  assert.ok(Math.abs(cycle.roof - cycle.y - 2.1) < 0.01);

  for (const [way, x, z, nap] of [
    ['w25546152', -1458.53, 3188.7, 10.31], ['w262752272', -1448.93, 3189.56, 10.32],
    ['w25546152', -1456.8, 3199.57, 10.348], ['w262752272', -1446.96, 3201.92, 10.38],
  ]) {
    assert.ok(Math.abs(gradeWayAt(way, x, z).y + grade.datumNAP - nap) < 0.03);
  }
  const profiles = new Map(grade.sites.flatMap(site => site.profiles.map(p => [p.id, p.points])));
  assert.deepEqual(profiles.get('stadspoort-25546154').at(-1), profiles.get('frans-halslaan-lower-w6921141')[0]);
  assert.deepEqual(profiles.get('stadspoort-25546157')[0], profiles.get('frans-halslaan-lower-w6921140').at(-1));
});

test('surveyed approaches exclude canopy returns and preserve the lower Langekamppad', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { setEdeGrade, gradeProfileAt, gradeDeckAt } = await import('../js/ede-grade.js');
  const grade = JSON.parse(readFileSync(join(__dirname, '../assets/ede-grade.json'), 'utf8'));
  setEdeGrade(grade);
  const ids = new Set(['w959787174', 'w6954256', 'w925880061']);
  for (const profile of grade.sites.flatMap(site => site.profiles).filter(item =>
    ids.has(item.id.split('-').at(-1)))) {
    ids.delete(profile.id.split('-').at(-1));
    for (const [i, p] of profile.points.slice(1).entries()) {
      const q = profile.points[i];
      assert.ok(Math.abs(p[2] - q[2]) / Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.12, profile.id);
    }
  }
  assert.equal(ids.size, 0);
  const x = -3720, z = 880.5;
  const path = gradeProfileAt(x, z, 'cyclist', undefined, 8.57 - grade.datumNAP, 'a30-langekamppad');
  assert.ok(Math.abs(path.y + grade.datumNAP - 8.57) < 0.05);
  assert.ok(path.roof < gradeDeckAt(x, z, 2));
});

test('Albertstunnel carriageways and side paths do not overlap below the railway', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { setEdeGrade, gradeProfileAt, railHeightAt } = await import('../js/ede-grade.js');
  setEdeGrade(JSON.parse(readFileSync(join(__dirname, '../assets/ede-grade.json'), 'utf8')));
  for (const [x, z, road, path, rail] of [
    [98.82, 2059.17, 'southbound', 'west', 'w1052080207'],
    [99.23, 2054.97, 'southbound', 'west', 'w1052080205'],
    [115.86, 2065.17, 'northbound', 'east', 'w1052080207'],
    [116.41, 2059.75, 'northbound', 'east', 'w1052080205']
  ]) {
    const carriageway = gradeProfileAt(x, z, 'car', undefined, undefined, 'alberts-' + road);
    const sidewalk = gradeProfileAt(x, z, 'person', undefined, undefined, 'alberts-' + path + '-path');
    assert.ok(Number.isFinite(railHeightAt(rail, x, z)));
    assert.ok(!(carriageway && sidewalk));
  }
});

test('grade surfaces maintain independent contact and clip terrain only at open approaches', async () => {
  const { setEdeGrade, gradeHeightAt, gradeWayAt, constrainEdeCamera, gradeCuts, clipEdeGround } = await import('../js/ede-grade.js');
  const tunnel = { id: 'bike', width: 4, modes: ['bike', 'foot'], wayIds: ['w-bike'],
    clearance: 2.6, points: [[0, 0, 0], [0, 10, -3], [0, 20, -3], [0, 30, 0]], covered: [10, 20] };
  const bridge = { id: 'motor', width: 7, modes: ['motor'], wayIds: ['w-motor'],
    points: [[-20, 15, 4], [20, 15, 4]] };
  setEdeGrade({ sites: [{ id: 'under', kind: 'underpass', profiles: [tunnel] },
    { id: 'over', kind: 'bridge', profiles: [bridge] }] });
  assert.equal(gradeHeightAt(0, 15, -3, 'cyclist'), -3);
  assert.equal(gradeHeightAt(0, 15, 0, 'cyclist'), 0);
  assert.equal(gradeHeightAt(0, 15, 4, 'car'), 4);
  assert.equal(gradeHeightAt(0, 15, -3, 'car'), 0);
  assert.equal(gradeWayAt('w-bike', 0, 15).y, -3);
  const camera = { x: 6, y: 3, z: 15 };
  constrainEdeCamera({ type: 'cyclist', heading: 0, position: { x: 0, y: -3, z: 15 } }, camera);
  assert.ok(Math.abs(camera.x) <= 1.55 && camera.y < 0);
  assert.equal(gradeCuts({ minX: -1, maxX: 1, minZ: 12, maxZ: 18 }).length, 0);
  const polygon = [[-4, 2], [4, 2], [4, 8], [-4, 8]].map(([x, z]) => ({ x, z, y: 7 }));
  const cuts = gradeCuts({ minX: -4, maxX: 4, minZ: 2, maxZ: 8 });
  const area = points => Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.z - p.z * q.x;
  }, 0)) / 2;
  const clipped = clipEdeGround(polygon, cuts);
  assert.ok(clipped.flat().every(p => p.y === 7));
  assert.ok(Math.abs(clipped.reduce((sum, part) => sum + area(part), 0) - 24) < 1e-9);
});

test('fully modeled tunnels cut covered terrain and keep the bicycle bridge and rails above', async () => {
  const { setEdeGrade, gradeHeightAt, gradeDeckAt, gradeCuts, railHeightAt } = await import('../js/ede-grade.js');
  const lower = { id: 'tunnel-path', width: 4, modes: ['bike', 'foot'], points: [[0, 0, -3], [0, 20, -3]],
    covered: [5, 15] };
  const upper = { id: 'bridge-path', width: 4, modes: ['bike', 'foot'], points: [[-10, 9, 3], [10, 9, 3]] };
  setEdeGrade({ sites: [
    { id: 'under', kind: 'underpass', cutCoveredTerrain: true, profiles: [lower] },
    { id: 'over', kind: 'bridge', profiles: [upper] }
  ], railHeights: [
    { wayId: 'w-track', points: [[-10, 10, 1], [10, 10, 1]] },
    { wayId: 'w-track', points: [[100, 10, 2], [120, 10, 2]] }
  ] });
  assert.ok(gradeCuts({ minX: -1, maxX: 1, minZ: 9, maxZ: 11 }).length > 0);
  assert.equal(gradeHeightAt(0, 10, -3, 'cyclist'), -3);
  assert.equal(gradeHeightAt(0, 10, 3, 'cyclist'), 3);
  assert.equal(gradeDeckAt(0, 10), 3);
  assert.equal(railHeightAt('w-track', 0, 10), 1);
  assert.equal(railHeightAt('w-track', 110, 10), 2);
});

test('a trailing camera stays under the soffit until it crosses the exit', async () => {
  const { constrainEdeCamera, setEdeGrade } = await import('../js/ede-grade.js');
  const lower = { id: 'lower', width: 4, modes: ['bike'], points: [[0, 0, -1], [0, 10, -0.5], [0, 20, -0.5]],
    covered: [0, 10], clearance: 2.6 };
  setEdeGrade({ sites: [{ id: 'under', kind: 'underpass', profiles: [lower] }] });
  const entity = { type: 'cyclist', heading: 0, position: { x: 0, y: -0.5, z: 13 } };
  const camera = { x: 0, y: 3, z: 8 };
  constrainEdeCamera(entity, camera);
  assert.ok(Math.abs(camera.y - 1.75) < 1e-8);
  camera.z = 11;
  camera.y = 3;
  constrainEdeCamera(entity, camera);
  assert.equal(camera.y, 3);
});

test('a cut corridor has no terrain contact between its lower floor and fitted upper deck', async () => {
  const { gradeHeightAt, setEdeGrade } = await import('../js/ede-grade.js');
  const passage = { id: 'motor-lower', width: 4, modes: ['motor'], points: [[0, 0, -4], [0, 20, -4]],
    covered: [5, 15] };
  const deck = { id: 'bike-upper', width: 4, modes: ['bike'], points: [[-10, 10, 3], [10, 10, 3]] };
  setEdeGrade({ sites: [
    { id: 'under', kind: 'underpass', cutCoveredTerrain: true, profiles: [passage], excavation: { ...passage, width: 8 } },
    { id: 'over', kind: 'bridge', profiles: [deck] }
  ] });
  assert.equal(gradeHeightAt(3, 10, 0, 'cyclist'), -4);
  assert.equal(gradeHeightAt(3, 10, 3, 'cyclist'), 3);
  assert.equal(gradeHeightAt(4.5, 10, 0, 'cyclist'), 0);
});

test('Raadhuisstraat has 4.2 m of cover and keeps the passage floor at ground level', async () => {
  const grade = await import('../js/ede-grade.js');
  const passages = grade.getEdeBuildingPassages();
  for (const id of ['w274278314', 'w274278316']) {
    const { sections } = passages.get(id);
    const [{ a, b }] = sections;
    const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    const surface = grade.gradeProfileAt(x, z, 'car', 0, 0);
    assert.equal(surface.id, id);
    assert.equal(surface.y, 0);
    assert.equal(surface.roof, 4.2);
    assert.equal(grade.isUnderEdeRoof(x, 2, z), true);
    assert.equal(grade.isUnderEdeRoof(x, 5, z), false);
    const camera = { x, y: 5, z };
    grade.constrainEdeCamera({ type: 'car', heading: 0, position: { x, y: 0, z } }, camera);
    assert.ok(camera.y <= 3.95);
  }
});

test('a garage branch meets the aisle without a generated wall across either drive line', async () => {
  const { getEdeBuildingPassages, buildingPassageSideSpans } = await import('../js/ede-grade.js');
  const passages = getEdeBuildingPassages();
  const aisle = passages.get('w956231562');
  const branch = passages.get('w956231563');
  const point = branch.sections.at(-1).b;
  for (const { sections, profile } of [aisle, branch]) {
    const nearby = sections.filter(({ a }) => Math.hypot(point.x - a.x, point.z - a.z) < 8);
    assert.ok(nearby.some(({ a, b }) => ['left', 'right'].some(side => {
      const points = buildingPassageSideSpans(a[side], b[side], profile.id);
      const length = points.reduce((sum, [p, q]) => sum + Math.hypot(p.x - q.x, p.z - q.z), 0);
      return length < Math.hypot(a[side].x - b[side].x, a[side].z - b[side].z) - 0.1;
    })));
  }
});

test('the Lukkien roof deck supplies helicopter contact only inside its surveyed outline', async () => {
  const { LUKKIEN_HELIPAD: pad } = await import('../js/ede-lukkien-survey.js');
  const { constrainEdeCamera, gradeProfileAt, heliLandingHeightAt, setEdeHelipads } = await import('../js/ede-grade.js');
  setEdeHelipads([pad]);
  try {
    assert.equal(heliLandingHeightAt(pad.x, pad.z), pad.y);
    assert.equal(heliLandingHeightAt(pad.x - 15, pad.z), undefined);
    assert.equal(gradeProfileAt(pad.x, pad.z, 'person', 0, pad.y), null);
    const camera = { x: pad.x, y: pad.y - 2, z: pad.z };
    constrainEdeCamera({ type: 'helicopter', position: { x: pad.x, y: pad.y + 0.25, z: pad.z } }, camera);
    assert.equal(camera.y, pad.y + 0.55);
  } finally {
    setEdeHelipads([]);
  }
});

test('motorway fits keep surveyed decks, approach edges and covered road floors continuous', async ({ mock }) => {
  const { readFileSync } = require('node:fs');
  const terrain = await import('../js/terrain.js');
  const grade = await import('../js/ede-grade.js');
  mock.method(globalThis, 'fetch', async url => new Response(readFileSync(url)));
  await Promise.all([terrain.loadTerrain({ expanded: true }), grade.loadEdeGrade()]);
  const samples = [
    ['w6960104', -4168.4, 2254, 15.22],
    ['w6960110', -3981.4, 2375.4, 14.99],
    ['w6920865', 98.4, 3720.9, 23.24],
    ['w6919291', 1073, 3707.7, 28.84],
    ['w6952603', 2943, 2894.8, 38.31],
    ['w6850995', 3535, 2674.9, 31.39],
    ['w259328716', 5105, 2718.1, 25.36],
    ['w509484014', 6787, 2697.5, 31.00],
    ['w6960734', -4807.3, -3307, 16.15],
    ['w6960743', -5153.6, -4621.8, 16.46],
    ['w1092220607', -7235.8, -8492.4, 14.65],
    ['w509484018', -6151, 969.9, 7.39],
    ['w491674572', 8890, 2592.6, 32.75],
    ['w829732187', 7535.9, 2644.9, 32.38],
  ];
  const datum = grade.getEdeGrade().datumNAP;
  for (const [id, x, z, nap] of samples) {
    const fitted = grade.gradeWayAt(id, x, z);
    assert.ok(fitted && Math.abs(fitted.y + datum - nap) < 0.23, id);
  }
  const motorway = grade.getEdeGrade().sites.flatMap(site => site.profiles)
    .find(profile => profile.id === 'maanderbroek-a30-a12-upper-w6960104');
  const sections = grade.gradeSections(motorway);
  for (const edge of [sections[0].a, sections.at(-1).b]) {
    for (const { x, y, z } of [edge.left, edge, edge.right]) {
      assert.ok(Math.abs(y - terrain.terrainHeightAt(x, z)) < 1e-8);
    }
  }
  const [start, next] = motorway.points;
  const run = Math.hypot(next[0] - start[0], next[1] - start[1]);
  assert.equal(grade.gradeWayAt(motorway.wayIds[0], start[0] - (next[0] - start[0]) / run,
    start[1] - (next[1] - start[1]) / run, 1.2), null);
  const [x, z] = [7535.9, 2644.9];
  const covered = grade.gradeProfileAt(x, z, 'car', undefined, 32.38 - datum);
  assert.ok(covered.roof - covered.y > 5.1);
  assert.ok(grade.expansionGradeCuts({ minX: x - 1, maxX: x + 1, minZ: z - 1, maxZ: z + 1 })
    .some(cut => cut.ceiling >= covered.roof - 0.01));
  assert.ok(grade.isUnderEdeRoof(x, covered.y + 1, z));
  const coveredBounds = { minX: x - 0.1, maxX: x + 0.1, minZ: z - 0.1, maxZ: z + 0.1 };
  const wrongLevelPavement = [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]]
    .map(([dx, dz]) => ({ x: x + dx, y: covered.roof + 1, z: z + dz }));
  const residuals = grade.clipEdeGround(wrongLevelPavement, grade.gradeCuts(coveredBounds));
  for (const ring of residuals) {
    const area = ring.reduce((sum, point, i) => {
      const next = ring[(i + 1) % ring.length];
      return sum + (point.x - x) * (next.z - z) - (next.x - x) * (point.z - z);
    }, 0);
    assert.ok(Math.abs(area) < 1e-8);
  }
});
