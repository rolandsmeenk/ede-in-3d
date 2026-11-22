const PLACES = new Map(Object.entries({
  ede: [0, 0, 5700],
  lunteren: [-3467, -4230, 2800],
  ederveen: [-6503, -1450, 2200],
  wekerom: [3049, -7304, 2300],
  otterlo: [7219, -6229, 2500],
  'de klomp': [-6683, 6, 1800],
  bennekom: [253, 5329, 2700],
  harskamp: [5576, -9618, 2000],
}));
const SERVICES = new Set(['police', 'ambulance', 'fire']);
const MAX_AGE = 10 * 60 * 1000;
const nameKey = name => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function createEmergencyAlerts(edges, now = Date.now) {
  const pending = new Map();
  const dispatched = new Map();
  let streets;

  function location(place, street) {
    const town = PLACES.get(nameKey(place));
    if (!town) return null;
    const [x, z, max] = town;
    if (typeof street !== 'string' || !street) return { x, z };
    if (!streets) {
      streets = new Map();
      for (const e of edges) {
        if (!e.roadName || e.layer || e.motorway || e.motorwayLink || !e.ambientLanes.length) continue;
        const name = nameKey(e.roadName);
        if (!streets.has(name)) streets.set(name, []);
        streets.get(name).push(e);
      }
    }
    let best = max, area = { x, z };
    for (const e of streets.get(nameKey(street)) ?? []) {
      const a = (e.from.x + e.to.x) / 2, b = (e.from.z + e.to.z) / 2;
      const d = Math.hypot(a - x, b - z);
      if (d >= best) continue;
      best = d;
      area = { x: a, z: b };
    }
    return area;
  }

  function expire(at) {
    for (const [id, row] of pending) if (row.expiresAt <= at) pending.delete(id);
    for (const [id, expiry] of dispatched) if (expiry <= at) dispatched.delete(id);
  }

  function accept(rows) {
    const at = now();
    expire(at);
    for (const alert of rows.slice(0, 30)) {
      if (typeof alert?.id !== 'string' || !SERVICES.has(alert.service) || typeof alert.place !== 'string' ||
          !Number.isFinite(alert.publishedAt) || alert.publishedAt > at + 5_000 ||
          alert.publishedAt + MAX_AGE <= at || dispatched.has(alert.id) || pending.has(alert.id)) continue;
      const area = location(alert.place, alert.street);
      if (!area) continue;
      pending.set(alert.id, { id: alert.id, service: alert.service,
        ...area, expiresAt: alert.publishedAt + MAX_AGE, retryAt: at });
    }
  }

  function nearby(x, z) {
    const at = now();
    expire(at);
    return [...pending.values()]
      .filter(row => row.retryAt <= at && Math.hypot(x - row.x, z - row.z) < 1000)
      .sort((a, b) => b.expiresAt - a.expiresAt);
  }

  function sent(row) {
    pending.delete(row.id);
    dispatched.set(row.id, row.expiresAt);
  }

  return { accept, nearby, sent, retry(row) { row.retryAt = now() + 8000; } };
}
