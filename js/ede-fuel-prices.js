const CBS_PRICES = 'https://opendata.cbs.nl/ODataApi/OData/80416ENG/TypedDataSet';
const REFRESH_MS = 60 * 60 * 1000;
const CBS_FIELDS = { e10: 'Euro95_1', diesel: 'Diesel_2', lpg: 'LPG_3' };

// CBS/Travelcard, 16 November 2026, CC BY 4.0. The date controls whether a refresh supersedes this baseline.
export const BUNDLED_FUEL_BASELINE = { day: '20261116', e10: 2.151, diesel: 2.294, lpg: 1.028 };

// Rounded group medians of local deviations from ANWB's national reference, sampled 22 November 2026.
// The simulation shares each adjustment across the group instead of storing individual pump readings.
const OFFSETS = {
  discount: { e10: -0.05, diesel: -0.025 },
  local: { e10: -0.025 },
  lunteren: { e10: -0.025, diesel: -0.05 },
};

export function estimateFuelPrice(baseline, profile, fuel) {
  const average = baseline[fuel];
  return Number.isFinite(average) ? Math.max(0, average + (OFFSETS[profile]?.[fuel] ?? 0)) : null;
}

export function parseFuelBaseline(payload, throughDay) {
  if (!Array.isArray(payload?.value)) return null;
  let latest = null;
  for (const row of payload.value) {
    const day = row?.Periods;
    if (typeof day !== 'string' || !/^\d{8}$/.test(day) || day > throughDay || day <= (latest?.day ?? '')) continue;
    if (!Object.values(CBS_FIELDS).every(field => Number.isFinite(row[field]) && row[field] > 0 && row[field] < 10)) continue;
    latest = { day, e10: row.Euro95_1, diesel: row.Diesel_2, lpg: row.LPG_3 };
  }
  return latest;
}

export function watchFuelBaseline(update, page = document) {
  let lastRequest = -Infinity;
  let day = BUNDLED_FUEL_BASELINE.day;
  const dateKey = ms => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');

  async function refresh() {
    const now = Date.now();
    if (page.hidden || now - lastRequest < REFRESH_MS) return;
    lastRequest = now;
    const url = new URL(CBS_PRICES);
    url.searchParams.set('$select', ['Periods', ...Object.values(CBS_FIELDS)].join(','));
    // StatLine ignores descending order on this endpoint. Bound the result by date and select it locally.
    url.searchParams.set('$filter', `Periods ge '${dateKey(now - 21 * 86400000)}'`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (!response.ok) return;
      const baseline = parseFuelBaseline(await response.json(), dateKey(now));
      if (baseline && baseline.day > day) {
        day = baseline.day;
        update(baseline);
      }
    } catch {
      // Keep displaying estimates from the last usable national observation.
    }
  }

  page.addEventListener('visibilitychange', refresh);
  setInterval(refresh, REFRESH_MS);
  void refresh();
}
