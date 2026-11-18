const assert = require('node:assert/strict');
const { test } = require('node:test');

const variant = {
  id: '303-out', line: '303', headsign: 'Arnhem',
  stops: [0, 200, 600].map((distance) => ({ distance })),
  slices: [{ legs: [{ start: 50, end: 200 }] }, { legs: [{ start: 400, end: 550 }] }]
};

function fixture(services, trips) {
  return {
    firstDate: services[0], lastDate: services.at(-1), services,
    variants: [{
      ...variant,
      trips: trips.map(([id, departure, dates]) => ({ id, departure, dates, stops: [[-30, 0], [120, 180], [420, 420]] }))
    }]
  };
}

test('bus schedule interpolates travel between stops, holds at stops and only serves mapped slices', async () => {
  const { createEdeBusSchedule } = await import('../js/ede-bus-schedule.js');
  const data = fixture(['2026-11-18'], [['weekday', 9 * 3600, [0]]]);
  const { tripsAt } = createEdeBusSchedule(data, new Date('2026-11-18T08:01:00Z'));
  const [entering] = tripsAt(0);
  assert.equal(entering.key, '2026-11-18/303-out/weekday/0');
  assert.equal(entering.variant.headsign, 'Arnhem');
  assert.equal(entering.startOffset, 30);
  assert.equal(entering.endOffset, 180);
  assert.equal(entering.distance, 100);
  assert.equal(tripsAt(80)[0].distance, 200);
  assert.deepEqual(tripsAt(130), []);
  assert.equal(tripsAt(130, 15)[0].distance, 200);
  assert.equal(tripsAt(230, 15)[0].distance, 400);
  assert.equal(tripsAt(260)[0].key, '2026-11-18/303-out/weekday/1');
  assert.ok(Math.abs(tripsAt(260)[0].distance - 433.3333333) < 1e-6);
  assert.deepEqual(tripsAt(340), []);
});

test('bus schedule retains previous-day runs after midnight and uses dated service patterns', async () => {
  const { createEdeBusSchedule } = await import('../js/ede-bus-schedule.js');
  const data = fixture(['2026-11-18', '2026-11-19'], [
    ['wednesday-night', 24 * 3600, [0]], ['thursday-morning', 9 * 3600, [1]]
  ]);
  const { tripsAt } = createEdeBusSchedule(data, new Date('2026-11-18T23:01:00Z'));
  assert.equal(tripsAt(0)[0].key, '2026-11-18/303-out/wednesday-night/0');
  assert.equal(tripsAt(9 * 3600)[0].key, '2026-11-19/303-out/thursday-morning/0');
  assert.deepEqual(tripsAt(3600), []);
});

test('bus schedule starts at the next in-map service and can replay a matching archived weekday', async () => {
  const { createEdeBusSchedule } = await import('../js/ede-bus-schedule.js');
  const data = fixture(['2026-11-18', '2026-11-19'], [['archived', 9 * 3600, [0]]]);
  const { tripsAt } = createEdeBusSchedule(data, new Date('2026-11-25T07:00:00Z'));
  assert.equal(tripsAt(0)[0].key, '2026-11-25/303-out/archived/0');
  assert.equal(tripsAt(0)[0].secondsSinceDeparture, 30);
  assert.equal(tripsAt(0)[0].distance, 50);
});

test('bus service offsets use Amsterdam noon on a clock-change day', async () => {
  const { createEdeBusSchedule } = await import('../js/ede-bus-schedule.js');
  const data = fixture(['2026-03-29'], [['sunday', 8 * 3600, [0]]]);
  const { tripsAt } = createEdeBusSchedule(data, new Date('2026-03-29T06:02:00Z'));
  assert.equal(tripsAt(0)[0].secondsSinceDeparture, 120);
  assert.equal(tripsAt(0)[0].distance, 200);
});
