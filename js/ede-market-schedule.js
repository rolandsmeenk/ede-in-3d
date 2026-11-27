import { kingsDayDate } from './ede-event-calendar.js';
import { shiftDate } from './ede-transit-time.js';

// Gemeenteblad 2024, 241322, article 1. Individual holiday reschedules are not modeled.
const marketHours = {
  1: ['marktplein', 13 * 60],
  4: ['stadspoort', 13 * 60],
  5: ['bennekom', 13 * 60],
  6: ['marktplein', 17 * 60],
};

const marketClosed = ({ holiday, date }) => holiday && date?.slice(5) !== '05-05';

export function edeMarketState(activity) {
  const { date, weekday, minute, season, heavyRain, weather, events = [] } = activity ?? {};
  const market = marketHours[weekday];
  const scheduled = market && !marketClosed(activity);
  const openSite = scheduled && minute >= 8 * 60 && minute < market[1] ? market[0] : null;
  const fountain = season === 'summer' && minute >= 9 * 60 && minute < 21 * 60 &&
    weekday !== 1 && weekday !== 6 && date?.slice(5) !== '05-05' && !marketClosed(activity) &&
    !events.some(event => event.zone === 'centrum') && !heavyRain && weather !== 'frost' && weather !== 'snow';
  return { openSite, fountain: Boolean(fountain) };
}

export function edeMarketParkingArea(activity) {
  if (!activity) return null;
  const { date, minute, weekday, calendar } = activity;
  if (weekday === 4 && minute >= 8 * 60 && minute < 13 * 60 && !marketClosed(activity)) return 'osm-w25473495';
  if (weekday === 5 && minute < 15 * 60 && !marketClosed(activity)) return 'osm-w413998749';
  // Bennekom Centrum closes the market car park from Thursday 18:00 until Friday 15:00.
  if (weekday === 4 && minute >= 18 * 60) {
    const friday = shiftDate(date, 1);
    if (!calendar || (!['01-01', '12-25', '12-26'].includes(friday.slice(5)) &&
      friday !== kingsDayDate(Number(friday.slice(0, 4))))) return 'osm-w413998749';
  }
  return null;
}
