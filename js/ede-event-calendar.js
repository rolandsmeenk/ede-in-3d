import { shiftDate, weekday } from './ede-transit-time.js';

const events = [
  {
    id: 'kings-day', title: 'Koningsdag', location: 'Ede Centrum', zone: 'centrum', teleport: 'oudekerk',
    hours: [9 * 60, 17 * 60],
    source: 'https://www.edecentrum.nl/nieuwsartikel/koningsdag-kleedjesmarkt-ede-centrum/',
    website: 'edecentrum.nl', background: '#762808', accent: '#ffd07d',
    editions: year => year >= 2018 ? [[kingsDayDate(year)]] : [],
  },
  {
    id: 'heideweek', title: 'Heideweek', location: 'Gemeente Ede', zone: 'centrum', teleport: 'oudekerk',
    source: 'https://www.bezoek-ede.nl/plan-je-bezoek/tips-ede-bezoeken/heideweek-ede',
    website: 'heideweek.nl', background: '#422161', accent: '#f3b0ed',
    editions: [['2026-08-21', '2026-08-29'], ['2027-08-20', '2027-08-28']],
  },
  {
    id: 'airborne', title: 'Airborne Ede', location: 'Ginkelse Heide', zone: 'ginkelse-heide', teleport: 'airborne-monument-ginkel',
    hours: [9 * 60, 16 * 60],
    source: 'https://www.ede.nl/in-de-gemeente-ede/airborne-ede-maand/airborne-luchtlandingen-en-herdenking',
    website: 'ede.nl', background: '#431b2a', accent: '#e5c3aa',
    editions: [['2026-09-19'], ['2027-09-18']],
  },
  {
    id: 'christmas-market', title: 'Kerstmarkt', location: 'Oude Kerk', zone: 'centrum', teleport: 'oudekerk',
    hours: [12 * 60, 17 * 60],
    source: 'https://www.edecentrum.nl/evenementen/kerstmarkt/',
    website: 'edecentrum.nl', background: '#15392f', accent: '#f6ce86',
    editions: [['2026-12-19']],
  },
];

export function kingsDayDate(year) {
  const april27 = `${year}-04-27`;
  return weekday(april27) === 0 ? shiftDate(april27, -1) : april27;
}

export function edeEvents(year) {
  return events.flatMap(({ editions, ...event }) => {
    const dates = typeof editions === 'function' ? editions(year) : editions;
    return dates.filter(([start]) => start.startsWith(`${year}-`))
      .map(([start, end = start]) => ({ ...event, start, end }));
  }).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export function activeEdeEvents(date, minute) {
  return edeEvents(Number(date.slice(0, 4))).filter(event => {
    const [open, close] = event.hours ?? [12 * 60, 22 * 60];
    return event.start <= date && date <= event.end && minute >= open && minute < close;
  });
}

export function upcomingEdeEvents(date, minute) {
  const year = Number(date.slice(0, 4));
  const monthDay = date.slice(5);
  const horizon = `${year + 1}-${monthDay === '02-29' ? '02-28' : monthDay}`;
  return [year - 1, year, year + 1].flatMap(edeEvents).filter(event =>
    event.start <= horizon && (event.end > date || (event.end === date && (!event.hours || minute < event.hours[1]))));
}

const shortDate = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateLabel = date => shortDate.format(new Date(`${date}T00:00:00Z`));

export function edeEventCampaign(date) {
  const year = Number(date.slice(0, 4));
  const candidates = [year - 1, year, year + 1].flatMap(edeEvents).filter(event => event.background);
  const active = candidates.find(event => event.start <= date && date <= event.end);
  const event = active ?? candidates.find(event => shiftDate(event.start, -14) <= date && date < event.start);
  if (!event) return null;
  const dates = event.start === event.end ? dateLabel(event.start) : `${dateLabel(event.start)} – ${dateLabel(event.end)}`;
  return {
    brand: active ? (event.start === event.end ? 'Vandaag in Ede' : 'Nu in Ede') : 'Binnenkort in Ede',
    title: event.title,
    detail: `${dates} · ${event.location}`,
    website: event.website,
    background: event.background,
    accent: event.accent,
  };
}
