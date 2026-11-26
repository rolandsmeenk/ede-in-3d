import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';

export const FRANKENENG_DOWNSTREAM = {
  id: 'frankeneng-water-downstream', name: 'Nieuwe Wetering', kind: 'water', holes: [],
  // Active BGT waterdeel 15747567-3938-5819-9832-219e997593e6, within 25 m of WS000611.
  ring: [
    -3801.30, 2370.61, -3796.43, 2374.78, -3789.77, 2378.80, -3785.26, 2382.19,
    -3784.74, 2384.76, -3784.98, 2386.09, -3787.46, 2389.84, -3783.60, 2392.25,
    -3781.19, 2389.46, -3779.75, 2388.61, -3778.19, 2388.48, -3775.78, 2389.53,
    -3769.62, 2393.85, -3761.25, 2398.82, -3759.65, 2396.55, -3772.95, 2388.09,
    -3775.16, 2386.27, -3777.72, 2382.06, -3778.02, 2381.78, -3778.47, 2382.48,
    -3778.72, 2382.32, -3778.00, 2381.21, -3779.57, 2380.18, -3780.29, 2381.29,
    -3780.54, 2381.12, -3780.29, 2380.73, -3781.46, 2380.09, -3790.13, 2376.29,
    -3800.10, 2368.83,
  ],
};

// PDOK IMWA weir KST-1106 separates the reaches. Limits bound the modeled channel.
export const FRANKENENG_GAUGES = [
  { code: 'WS000610', waterId: 'water91', fallbackNap: 6.65, minNap: 6.04, maxNap: 7.0 },
  { code: 'WS000611', waterId: FRANKENENG_DOWNSTREAM.id, fallbackNap: 6.25, minNap: 5.84, maxNap: 6.95 },
];

export async function loadEdePondLevels() {
  const response = await fetch(new URL('../assets/ede-pond-levels.json', import.meta.url));
  if (!response.ok) throw new Error(`Pond levels HTTP ${response.status}`);
  const asset = await response.json();
  if (asset.version !== 1 || !asset.levels || Array.isArray(asset.levels)) throw new Error('Invalid Ede pond levels');
  const levels = new Map();
  for (const [id, entry] of Object.entries(asset.levels)) {
    const [nap, code] = Array.isArray(entry) ? entry : [];
    if (!Number.isFinite(nap) || nap < -5 || nap > 120) throw new Error(`Invalid pond level ${id}`);
    levels.set(id, { nap, code, y: nap - SCENE_NAP_ORIGIN });
  }
  return levels;
}

const SERVICE = 'https://services1.arcgis.com/ug8NBKcLHVNmdmdt/arcgis/rest/services/1ee052d2-43ba-4c3c-8e80-40bcea8c6405/FeatureServer/0';
const REFRESH_MS = 5 * 60 * 1000;
const EXPIRE_MS = 45 * 60 * 1000;

export function resolveFrankenengLevels(layer, result, now = Date.now()) {
  // ArcGIS reports one publication time for the entire layer.
  const publishedAt = layer?.editingInfo?.dataLastEditDate;
  const fresh = Number.isFinite(publishedAt) && publishedAt > 0 &&
    publishedAt <= now + REFRESH_MS && now - publishedAt < EXPIRE_MS;
  const rows = Array.isArray(result?.features) ? result.features : [];
  return FRANKENENG_GAUGES.map(gauge => {
    const nap = fresh ? rows.find(row => row?.attributes?.Code === gauge.code)?.attributes.AssignedValue : undefined;
    const live = Number.isFinite(nap) && nap >= gauge.minNap && nap <= gauge.maxNap;
    const level = live ? nap : gauge.fallbackNap;
    return { code: gauge.code, waterId: gauge.waterId, nap: level, y: level - SCENE_NAP_ORIGIN,
      publishedAt: live ? publishedAt : null };
  });
}

export function watchFrankenengLevels(update, page = document) {
  const lifetime = new AbortController();
  let lastRequest = -Infinity;
  let pending = false;
  const fields = new URLSearchParams({
    f: 'json', returnGeometry: 'false', outFields: 'Code,AssignedValue',
    where: `Code IN (${FRANKENENG_GAUGES.map(({ code }) => `'${code}'`).join(',')})`,
  });

  async function refresh() {
    const now = Date.now();
    if (lifetime.signal.aborted || pending || page.hidden || now - lastRequest < REFRESH_MS) return;
    lastRequest = now;
    pending = true;
    try {
      const options = { cache: 'no-store', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]) };
      const [layer, result] = await Promise.all([`${SERVICE}?f=json`, `${SERVICE}/query?${fields}`].map(async url => {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`Water level HTTP ${response.status}`);
        return response.json();
      }));
      if (!lifetime.signal.aborted) update(resolveFrankenengLevels(layer, result));
    } catch {
      if (!lifetime.signal.aborted) update(resolveFrankenengLevels());
    } finally {
      pending = false;
    }
  }

  page.addEventListener('visibilitychange', refresh);
  const timer = setInterval(refresh, REFRESH_MS);
  void refresh();
  return () => {
    lifetime.abort();
    clearInterval(timer);
    page.removeEventListener('visibilitychange', refresh);
  };
}
