import { edeMarketState } from './ede-market-schedule.js';

const MARKETS = {
  marktplein: [-119, -53, 350], stadspoort: [-1541, 3175, 125], bennekom: [350, 5301, 125],
};
const NIGHTLIFE = [-205, 155, 290];
const CENTRUM = [-110, 55, 470];
const GINKELSE_HEIDE = [4286, 1019, 560];
const HOEKELUM = [125, 3450, 550];

function within(x, z, [cx, cz, radius]) {
  return (x - cx) ** 2 + (z - cz) ** 2 < radius ** 2;
}

export function edeActivity(activity) {
  if (!activity) return null;
  const {minute, weekday, holiday, schoolHoliday, daylight, weather, heavyRain, events = []} = activity;
  const weekend = weekday === 6 || weekday === 0;
  const workingDay = !weekend && !holiday;
  const morning = workingDay && minute >= 390 && minute < 552;
  const afternoon = workingDay && minute >= 870 && minute < 1110;
  const { openSite } = edeMarketState(activity);
  const market = openSite === 'marktplein';
  const marketZone = MARKETS[openSite];
  const nightlife = (minute >= 1200 && (weekday === 5 || weekday === 6)) ||
    (minute < 120 && (weekday === 6 || weekday === 0));
  const recreation = (weekend || holiday) && daylight && minute >= 540 && minute < 1080 &&
    !heavyRain && ['dry', 'frost'].includes(weather);
  const centrumEvent = events.some(event => event.zone === 'centrum' && event.id !== 'airborne');
  const heideEvent = events.some(event => event.zone === 'ginkelse-heide');
  const demand = minute < 300 || minute >= 1380 ? .21 :
    minute < 390 || minute >= 1260 ? .44 : morning || afternoon ? 1.14 : .84;
  const weatherFactor = heavyRain ? .6 : weather === 'rain' || weather === 'snow' ? .8 : 1;
  return {
    weekday, holiday, schoolHoliday, minute, morning, afternoon, market, nightlife, recreation, centrumEvent, heideEvent,
    road: demand * (holiday ? .74 : schoolHoliday && (morning || afternoon) ? .84 : 1),
    travel: Math.min(1, .24 + .76 * demand),
    active(x, z) {
      const local = Math.max(
        marketZone && within(x, z, marketZone) ? 1.65 : 1,
        nightlife && within(x, z, NIGHTLIFE) ? 2.25 : 1,
        recreation && (within(x, z, GINKELSE_HEIDE) || within(x, z, HOEKELUM)) ? 1.50 : 1,
        centrumEvent && within(x, z, CENTRUM) ? 2.10 : 1,
        heideEvent && within(x, z, GINKELSE_HEIDE) ? 2.10 : 1);
      return local * weatherFactor;
    },
    parking(x, z) {
      return Math.max(
        marketZone && within(x, z, marketZone) ? .11 : 0,
        nightlife && within(x, z, NIGHTLIFE) ? .18 : 0,
        centrumEvent && within(x, z, CENTRUM) ? .22 : 0);
    }
  };
}
