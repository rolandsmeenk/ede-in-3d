const assert = require('node:assert/strict');
const test = require('node:test');

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
