const assert = require('node:assert/strict');
const test = require('node:test');

const roadTrafficModule = import('../js/ede-road-traffic.js');
const areaModule = import('../js/traffic-area.js');

test('the same carriageway can have separate Amsterdam-time caps by direction', async () => {
  const { createEdeRoadTraffic } = await roadTrafficModule;
  let now = Date.parse('2026-06-15T03:59:00Z');
  const east = { key: 'east', limits: { speed: 80 } }, west = { key: 'west', limits: { speed: 80 } };
  const traffic = createEdeRoadTraffic({ east: [100, 120, 360, 1140], west: [90] }, () => now);
  traffic.bind([east, west], edge => edge.key);
  assert.equal(Math.round(traffic.limit(east) * 3.6), 120);
  now += 60000; // 06:00 CEST
  traffic.refresh();
  assert.equal(Math.round(traffic.limit(east) * 3.6), 100);
  assert.equal(Math.round(traffic.limit(west) * 3.6), 90);
  now = Date.parse('2026-12-15T04:59:00Z');
  traffic.refresh();
  assert.equal(Math.round(traffic.limit(east) * 3.6), 120); // 05:59 CET
  now += 60000;
  traffic.refresh();
  assert.equal(Math.round(traffic.limit(east) * 3.6), 100);
});

test('measurements and temporary controls stay directional, smooth, and expire independently', async () => {
  const { createEdeRoadTraffic } = await roadTrafficModule;
  let now = Date.parse('2026-11-19T10:30:00Z');
  const east = { key: 'east' }, west = { key: 'west' };
  const traffic = createEdeRoadTraffic({ east: [50], west: [70] }, () => now);
  traffic.bind([east, west], edge => edge.key);
  traffic.setSnapshot({ version: 1, observations: [{
    key: 'east', flowPerHour: 0, speedKmh: 10, expiresAt: now + 30000, observedAt: now
  }], restrictions: [
    { key: 'east', limitKmh: 20, startsAt: now, expiresAt: now + 40000 },
    { key: 'west', closed: true, startsAt: now, expiresAt: now + 15000 }
  ] });
  assert.equal(Math.round(traffic.limit(east) * 3.6), 20);
  assert.equal(Math.round(traffic.limit(west) * 3.6), 70);
  assert.equal(traffic.isClosed(west), true);
  assert.equal(traffic.isClosed(east), false);
  assert.equal(traffic.hasObservedFlow(east), true);
  assert.equal(traffic.hasObservedFlow(west), false);
  assert.equal(traffic.cruise(east, 12), 12);
  now += 10000;
  traffic.refresh();
  assert.ok(traffic.cruise(east, 12) < 10);
  assert.equal(traffic.cruise(west, 12), 12);
  assert.ok(traffic.demand(east) < traffic.demand(west));
  now += 40000;
  traffic.refresh();
  assert.equal(Math.round(traffic.limit(east) * 3.6), 50);
  assert.equal(traffic.isClosed(west), false);
  assert.equal(traffic.hasObservedFlow(east), false);
  const retiringSpeed = traffic.cruise(east, 12);
  for (let i = 0; i < 15; i++) { now += 10000; traffic.refresh(); }
  assert.ok(retiringSpeed < 12);
  assert.equal(traffic.cruise(east, 12), 12);
  assert.equal(traffic.demand(east), traffic.demand(west));
});

test('a long road contributes only its local clipped length and spawn choices follow area weight', async () => {
  const { localSegmentLength, pickByArea } = await areaModule;
  assert.equal(localSegmentLength(500, 0, 200, 0, 0, 1, 0, 5000), 400);
  assert.equal(localSegmentLength(500, 201, 200, 0, 0, 1, 0, 5000), 0);
  const candidates = [{ segment: 'local cycle path', end: 20 }, { segment: 'wide cycle path', end: 80 }];
  assert.equal(pickByArea(candidates, () => 0.24), 'local cycle path');
  assert.equal(pickByArea(candidates, () => 0.25), 'wide cycle path');
});

test('subdividing a curve preserves the original carriageway traffic controls', async () => {
  const { createEdeRoadTraffic } = await roadTrafficModule;
  const now = Date.parse('2026-11-19T10:30:00Z');
  const first = { key: 'east-a', sourceRoadKey: 'east' };
  const second = { key: 'east-b', sourceRoadKey: 'east' };
  const west = { key: 'west' };
  const traffic = createEdeRoadTraffic({ east: [100], 'east-b': [90], west: [120] }, () => now);
  traffic.bind([first, second, west], edge => edge.key);
  assert.equal(Math.round(traffic.limit(first) * 3.6), 100);
  assert.equal(Math.round(traffic.limit(second) * 3.6), 90);
  traffic.setSnapshot({ version: 1, restrictions: [
    { key: 'east', limitKmh: 70, startsAt: now, expiresAt: now + 10000 },
    { key: 'east-b', closed: true, startsAt: now, expiresAt: now + 10000 }
  ] });
  assert.equal(Math.round(traffic.limit(first) * 3.6), 70);
  assert.equal(Math.round(traffic.limit(second) * 3.6), 70);
  assert.equal(traffic.isClosed(first), false);
  assert.equal(traffic.isClosed(second), true);
  assert.equal(Math.round(traffic.limit(west) * 3.6), 120);
});
