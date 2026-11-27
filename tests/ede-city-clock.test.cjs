const assert = require('node:assert/strict');
const test = require('node:test');

test('Amsterdam previews validate civil time and select the earlier autumn occurrence', async () => {
  const { parseAmsterdamPreview } = await import('../js/ede-city-clock.js');
  const iso = value => parseAmsterdamPreview(value)?.toISOString();
  assert.equal(iso('2027-03-28T02:30'), undefined);
  assert.equal(iso('2027-03-28T03:30'), '2027-03-28T01:30:00.000Z');
  assert.equal(iso('2027-10-31T02:30'), '2027-10-31T00:30:00.000Z');
  assert.equal(iso('2027-10-31T03:30'), '2027-10-31T02:30:00.000Z');
  assert.equal(iso('2027-12-19T00:05'), '2027-12-18T23:05:00.000Z');
  for (const value of ['2027-02-29T13:00', '2027-11-27T24:00', '2027-11-27', '0001-01-01T00:00']) {
    assert.equal(iso(value), undefined);
  }
});

test('event activity respects Amsterdam programme hours while campaigns last all day', async () => {
  const { edeEventCampaign, upcomingEdeEvents } = await import('../js/ede-event-calendar.js');
  const { createEdeCityActivity } = await import('../js/ede-city-clock.js');
  const clock = { date: '2027-09-18', seconds: 9 * 3600 };
  const activity = (seconds, calendar = true) => createEdeCityActivity({ ...clock, seconds }, { calendar });
  assert.equal(activity(clock.seconds - 1).events.length, 0);
  assert.equal(activity(clock.seconds).events[0].zone, 'ginkelse-heide');
  assert.equal(activity(16 * 3600).events.length, 0);
  assert.equal(activity(clock.seconds, false).events.length, 0);
  assert.equal(edeEventCampaign(clock.date).title, 'Airborne Ede');
  assert.equal(upcomingEdeEvents(clock.date, 16 * 60).some(event => event.id === 'airborne'), false);
  assert.deepEqual(upcomingEdeEvents('2026-11-27', 0).map(event => event.id),
    ['christmas-market', 'kings-day', 'heideweek', 'airborne']);
});

test('public holiday profiles recur without making every holiday a commuter day off', async () => {
  const { createEdeCityActivity } = await import('../js/ede-city-clock.js');
  const get = (date, calendar = true) => createEdeCityActivity({ date, seconds: 8 * 3600 }, { calendar });
  for (const date of ['2027-01-01', '2027-03-29', '2025-04-26', '2027-05-06', '2027-05-17', '2027-12-25', '2030-05-05']) {
    assert.equal(get(date).holiday, true, date);
  }
  for (const date of ['2027-03-26', '2027-05-05']) {
    assert.equal(get(date).holiday, false, date);
    assert.equal(get(date).schoolHoliday, true, date);
  }
  assert.equal(get('2027-03-29', false).schoolHoliday, false);
});
