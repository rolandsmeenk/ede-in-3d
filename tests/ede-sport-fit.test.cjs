const assert = require('node:assert/strict');
const test = require('node:test');

const close = (actual, expected, tolerance = 1e-5) => {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

test('sports fitting keeps the long axis of a traced court and is independent of ring order', async () => {
  const { fitSportField } = await import('../js/ede-sport-fit.js');
  const c = Math.cos(0.37), s = Math.sin(0.37);
  const corners = [[-15,-8],[15,-8],[15,8],[-15,8]]
    .map(([u,v]) => [1725.4 + c * u - s * v, -523.6 + s * u + c * v]);
  const fit = fitSportField({ sports: ['basketball'], ring: [...corners, corners[0]].flat() });
  assert.ok(fit);
  close(fit.x, 1725.4);
  close(fit.z, -523.6);
  close(fit.ux, c);
  close(fit.uz, s);
  close(fit.length, 29.84);
  close(fit.width, 15.84);
  assert.deepEqual(fitSportField({ ring: [...corners].reverse().flat() }), fit);
  assert.equal(fitSportField({ ring: [0,0,1,1,2,2] }), null);
});

test('sports lines are cut at every outer boundary and hole', async () => {
  const { clipSportLine } = await import('../js/ede-sport-fit.js');
  const points = pairs => pairs.map(([x,z]) => ({x,z}));
  const outer = points([[0,0],[15,0],[15,10],[10,10],[10,4],[8,4],[8,10],[0,10]]);
  const hole = points([[3,5],[5,5],[5,7],[3,7]]);
  const pieces = clipSportLine([-5,6], [20,6], { outer, holes: [hole] });
  assert.equal(pieces.length, 3);
  for (const [i, interval] of [[0,[0,3]],[1,[5,8]],[2,[10,15]]]) {
    close(pieces[i][0][0], interval[0]);
    close(pieces[i][1][0], interval[1]);
    assert.equal(pieces[i][0][1], 6);
  }
});

test('baseball axes and home plates fit the rounded backstop of a mapped field', async () => {
  const { fitSportField } = await import('../js/ede-sport-fit.js');
  const record = {
    id: 'w113726375', sports: ['baseball'],
    ring: [-455.8,3436.5,-410.6,3459.7,-396,3473.4,-387.2,3491,-384.4,3510.8,-388.5,3530.1,
      -410.8,3574.5,-502.8,3543.9,-510,3539.3,-514.9,3531.7,-514.6,3521.6,-509.8,3512.8],
  };
  const general = fitSportField(record);
  assert.ok(general.ux > 0.90 && general.uz < -0.20);
  assert.ok(general.homeU < -30 && general.homeU > -general.length / 2 + 9);
  const home = [-495.909,3526.145];
  const toward = [-479.698,3520.468];
  const reviewed = fitSportField({ ...record, diamond: { home, toward } });
  close(reviewed.x + reviewed.homeU * reviewed.ux, home[0]);
  close(reviewed.z + reviewed.homeU * reviewed.uz, home[1]);
  close(reviewed.ux * (toward[1] - home[1]) - reviewed.uz * (toward[0] - home[0]), 0);
});
