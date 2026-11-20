const assert = require('node:assert/strict');
const test = require('node:test');

test('football markings and both goals stay within a small pitch', async () => {
  const { sportLayout } = await import('../js/ede-sport-layouts.js');
  const pitch = sportLayout(['soccer'], 52, 32);
  assert.equal(pitch.equipment.length, 2);
  assert.equal(pitch.equipment[0].kind, 'goal');
  assert.equal(pitch.equipment[0].dir, 1);
  assert.equal(pitch.equipment[1].dir, -1);
  assert.ok(pitch.equipment[0].width < 7.32);
  assert.ok(pitch.lines.concat(pitch.fills).flatMap(line => line.points).every(([u, v]) => Math.abs(u) < 26 && Math.abs(v) < 16));
  assert.ok(pitch.lines.some(line => line.points.length === 25), 'centre circle');
  assert.equal(pitch.fills.length, 3, 'centre and two penalties');
});

test('shared courts show a second paint colour without duplicating equipment', async () => {
  const { sportLayout } = await import('../js/ede-sport-layouts.js');
  const court = sportLayout(['multi', 'basketball', 'soccer', 'basketball'], 30, 18);
  assert.equal(court.sport, 'basketball');
  assert.equal(court.equipment.length, 2);
  assert.ok(court.equipment.every(item => item.kind === 'basket'));
  assert.ok(court.lines.some(line => line.color === 0xefc35b));
  assert.equal(sportLayout(['equestrian'], 40, 25), null);
});

test('base and foul-line positions honor the surveyed baseball home plate', async () => {
  const { sportLayout } = await import('../js/ede-sport-layouts.js');
  const baselineLength = (layout, home) => {
    const [first] = layout.fills.filter(fill => fill.points.length === 4 && fill.color === 0xf5f3e9);
    const [a, b, c, d] = first.points;
    const centre = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4];
    return Math.hypot(centre[0] - home, centre[1]);
  };
  const baseball = sportLayout(['baseball'], 145, 100, { homeU: -42 });
  const softball = sportLayout(['softball'], 85, 80, { homeFrom: -1, homeU: 33 });
  assert.deepEqual(baseball.lines[0].points[0], [-42, 0]);
  assert.deepEqual(softball.lines[0].points[0], [33, 0]);
  assert.ok(baseball.fills.some(fill => fill.color === 0x658b53));
  assert.ok(!softball.fills.some(fill => fill.color === 0x658b53));
  assert.ok(Math.abs(baselineLength(baseball, -42) - 27.432) < 1e-6);
  assert.ok(Math.abs(baselineLength(softball, 33) - 18.288) < 1e-6);
});

test('tennis uses an ITF service box and sprint tracks honor mapped lane counts', async () => {
  const { sportLayout } = await import('../js/ede-sport-layouts.js');
  const tennis = sportLayout(['tennis'], 32, 17);
  assert.equal(tennis.equipment[0].height, 1.07);
  assert.ok(tennis.lines.some(line => line.points.every(([u]) => u === 6.4)));
  assert.ok(tennis.lines.some(line => line.points.every(([, v]) => v === 8.23 / 2)));
  const sprint = sportLayout(['athletics'], 115, 11, { athletics: 'sprint', lanes: 8 });
  assert.equal(sprint.lines.filter(line => line.points.every(([, v]) => v === line.points[0][1])).length, 9);
  const runway = sportLayout(['athletics'], 46, 2, { athletics: 'long_jump', lanes: 1 });
  assert.equal(runway.lines.length, 0);
});
