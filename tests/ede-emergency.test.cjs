const assert = require('node:assert/strict');
const test = require('node:test');

test('fresh dispatches use a same-town street or an approximate town location only once', async () => {
  const { createEmergencyAlerts } = await import('../js/ede-emergency.js');
  const { createEdeRoadTraffic } = await import('../js/ede-road-traffic.js');
  const road = (x, z) => ({
    roadName: 'Teststraat', from: { x: x - 10, z }, to: { x: x + 10, z }, ambientLanes: [0]
  });
  let now = Date.UTC(2026, 10, 22, 18);
  const queue = createEmergencyAlerts([road(-3480, -4250), road(370, 30)], () => now);
  const traffic = createEdeRoadTraffic({}, () => now);
  traffic.onEmergencyFeed(queue.accept);
  const alert = { id: 'one', service: 'fire', place: 'ede', street: 'teststraat', publishedAt: now - 2000 };
  const feed = { version: 1, emergency: [
    alert, alert,
    { ...alert, id: 'two', service: 'ambulance', place: 'lunteren', street: undefined },
    { ...alert, id: 'expired', publishedAt: now - 620_000 },
    { ...alert, id: 'future', publishedAt: now + 60_000 },
    { ...alert, id: 'outside', place: 'unknown' },
  ] };
  assert.equal(traffic.setSnapshot(feed), true);
  const [fire] = queue.nearby(0, 0);
  assert.deepEqual([fire.x, fire.z, fire.service], [370, 30, 'fire']);
  const [ambulance] = queue.nearby(-3470, -4220);
  assert.equal(ambulance.id, 'two');
  queue.sent(fire);
  traffic.setSnapshot(feed);
  assert.deepEqual(queue.nearby(0, 0), []);
  queue.retry(ambulance);
  assert.deepEqual(queue.nearby(-3470, -4220), []);
  now += 9000;
  assert.equal(queue.nearby(-3470, -4220).length, 1);
  now += 600_000;
  assert.deepEqual(queue.nearby(-3470, -4220), []);
});
