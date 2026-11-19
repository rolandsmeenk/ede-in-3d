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
