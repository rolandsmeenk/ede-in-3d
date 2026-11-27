import { DAY, dateEpoch, localClock, localMidnight, shiftDate, weekday } from './ede-transit-time.js';
import { activeEdeEvents, kingsDayDate } from './ede-event-calendar.js';

export function parseAmsterdamPreview(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const [, date, hour, minute] = match;
  const utc = dateEpoch(date);
  if (date < '1970-01-01' || date > '2099-12-31' || !Number.isFinite(utc) || shiftDate(date, 0) !== date) return null;
  const seconds = Number(hour) * 3600 + Number(minute) * 60;
  const next = localMidnight(shiftDate(date, 1)) - DAY;
  const today = localMidnight(date);
  // Both offsets are possible on the autumn clock-change day. Prefer the earlier matching instant.
  for (const midnight of [Math.min(today, next), Math.max(today, next)]) {
    const epoch = midnight + seconds;
    const local = localClock(epoch);
    if (local.date === date && local.seconds === seconds) return new Date(epoch * 1000);
  }
  return null;
}

export function clockTime(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function easterSunday(year) {
  // Gregorian computus.
  const century = Math.floor(year / 100), golden = year % 19, within = year % 100;
  const leapCenturies = Math.floor(century / 4);
  const correction = Math.floor((century - Math.floor((century + 8) / 25) + 1) / 3);
  const moon = (19 * golden + century - leapCenturies - correction + 15) % 30;
  const sunday = (32 + 2 * (century % 4) + 2 * Math.floor(within / 4) - moon - within % 4) % 7;
  const excess = Math.floor((golden + 11 * moon + 22 * sunday) / 451);
  const encoded = moon + sunday - 7 * excess + 114;
  return `${year}-0${Math.floor(encoded / 31)}-${String(encoded % 31 + 1).padStart(2, '0')}`;
}

export function createEdeCityActivity({ date, seconds }, { calendar, season, daylight, weather, heavyRain, weatherAvailable }) {
  const minute = Math.floor(seconds / 60);
  let holiday = false, schoolHoliday = false;
  if (calendar) {
    const year = Number(date.slice(0, 4)), monthDay = date.slice(5);
    const easter = easterSunday(year);
    holiday = ['01-01', '12-25', '12-26'].includes(monthDay) || date === kingsDayDate(year) ||
      [0, 1, 39, 49, 50].some(offset => date === shiftDate(easter, offset)) ||
      (monthDay === '05-05' && year % 5 === 0);
    schoolHoliday = holiday || monthDay === '05-05' || date === shiftDate(easter, -2);
  }
  return {
    date, minute, weekday: weekday(date), calendar, season, daylight,
    weather, heavyRain, weatherAvailable, holiday, schoolHoliday,
    events: calendar ? activeEdeEvents(date, minute) : [],
  };
}
