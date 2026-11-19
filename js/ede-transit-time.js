export const HOUR = 3600;
export const DAY = 24 * HOUR;
const amsterdam = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

export function localClock(epoch) {
  const parts = Object.fromEntries(amsterdam.formatToParts(epoch * 1000).map(({ type, value }) => [type, value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    seconds: Number(parts.hour) * HOUR + Number(parts.minute) * 60 + Number(parts.second)
  };
}

export function dateEpoch(date) {
  return Date.parse(`${date}T00:00:00Z`) / 1000;
}

export function shiftDate(date, days) {
  return new Date((dateEpoch(date) + days * DAY) * 1000).toISOString().slice(0, 10);
}

export function weekday(date) {
  return new Date(dateEpoch(date) * 1000).getUTCDay();
}

// For Amsterdam, midnight and noon local time and their UTC equivalents see the same offset.
export function localMidnight(date) {
  const utcMidnight = dateEpoch(date);
  return utcMidnight - localClock(utcMidnight).seconds;
}

export function serviceEpoch(date) {
  // GTFS offsets start twelve hours before local noon, including on clock-change days.
  const utcMidnight = dateEpoch(date);
  return utcMidnight + 12 * HOUR - localClock(utcMidnight + 12 * HOUR).seconds;
}
