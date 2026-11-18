const amsterdamClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
});
const limitValue = value => Number.isFinite(value) && value > 0 && value <= 150;
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));

function cityClock(ms) {
  const [weekday, , hour, , minute] = amsterdamClock.formatToParts(ms).map(part => part.value);
  return { minute: Number(hour) * 60 + Number(minute), weekday };
}

export function scheduledLimit(rule, minute) {
  if (!Array.isArray(rule) || !limitValue(rule[0])) return undefined;
  const [base, alternate, start, end] = rule;
  if (!limitValue(alternate) || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || start >= 1440 || end < 0 || end > 1440 || start === end) return base;
  // WKD MAXSHD applies inside the window and MAXSHD_ALT outside it.
  return (start < end ? minute >= start && minute < end : minute >= start || minute < end) ? base : alternate;
}

function demandProfile({ minute, weekday }) {
  const hour = minute / 60;
  if (hour < 5 || hour >= 23) return 0.21;
  if (hour < 6.5 || hour >= 21) return 0.44;
  if (weekday !== 'Sat' && weekday !== 'Sun' && ((hour >= 7 && hour < 9) || (hour >= 16 && hour < 18.5))) return 1.14;
  return 0.84;
}

export async function loadEdePostedSpeeds() {
  const response = await fetch(new URL('../assets/ede-posted-speeds.json', import.meta.url));
  if (!response.ok) throw new Error(`Posted speed limits: HTTP ${response.status}`);
  const asset = await response.json();
  if (asset.version !== 1 || !asset.edges || typeof asset.edges !== 'object') {
    throw new Error('Invalid posted speed limits');
  }
  return asset.edges;
}

// Each value is attached to one directed edge. All parsing, time-zone work and smoothing run
// on the wall clock outside the animation loop, even when the lighting is set to a manual preset.
export function createEdeRoadTraffic(posted = {}, now = Date.now) {
  const byKey = new Map();
  const states = new WeakMap();
  let observations = [], restrictions = [], busFeedHandler;
  let timeOfDay = cityClock(now());
  let profile = demandProfile(timeOfDay);
  let lastRefresh = now();
  let localRules = [];

  function bind(edges, edgeKey) {
    for (const edge of edges) {
      const key = edgeKey(edge);
      const state = {
        fallbackKmh: limitValue(edge.limits?.speed) ? edge.limits.speed : 50,
        lanes: edge.ambientLanes?.length || edge.vanLanes?.length || 1,
        rule: posted[key], limit: 0, temporary: Infinity, closed: false,
        flow: profile, speed: 0, speedWeight: 0
      };
      if (!byKey.has(key)) byKey.set(key, state);
      else {
        const existing = byKey.get(key);
        if (existing) {
          existing.rule = undefined;
          existing.limit = existing.fallbackKmh / 3.6;
        }
        state.rule = undefined;
        byKey.set(key, null); // Ambiguous stacked geometry cannot use a source match.
      }
      states.set(edge, state);
      state.limit = (scheduledLimit(state.rule, timeOfDay.minute) ?? state.fallbackKmh) / 3.6;
    }
    localRules = edges.map(edge => states.get(edge)).filter(state => state.rule?.length > 1);
  }

  const smoothed = new Set();
  const limited = new Set();
  const accepted = new Map();

  function refresh(at = now()) {
    if (Math.floor(at / 60000) !== Math.floor(lastRefresh / 60000)) {
      timeOfDay = cityClock(at);
      profile = demandProfile(timeOfDay);
      for (const state of localRules) {
        state.limit = (scheduledLimit(state.rule, timeOfDay.minute) ?? state.fallbackKmh) / 3.6;
      }
    }
    const step = 1 - Math.exp(-clamp((at - lastRefresh) / 1000, 0, 30) / 14);
    lastRefresh = at;
    for (const state of limited) {
      state.closed = false;
      state.temporary = Infinity;
    }
    limited.clear();
    for (const r of restrictions) {
      const state = byKey.get(r.key);
      if (!state || !(r.startsAt <= at && r.expiresAt > at)) continue;
      state.closed ||= r.closed === true;
      if (limitValue(r.limitKmh)) state.temporary = Math.min(state.temporary, r.limitKmh / 3.6);
      limited.add(state);
    }

    accepted.clear();
    for (const observation of observations) {
      const state = byKey.get(observation.key);
      if (!state || observation.expiresAt <= at || observation.observedAt > at + 60000) continue;
      if ((accepted.get(state)?.observedAt ?? -Infinity) >= observation.observedAt) continue;
      accepted.set(state, observation);
      smoothed.add(state);
    }
    for (const state of smoothed) {
      const row = accepted.get(state);
      const flow = row?.flowPerHour;
      const speed = row?.speedKmh;
      const reference = state.lanes * (state.limit >= 18 ? 560 : state.limit >= 11 ? 340 : 200);
      const targetFlow = Number.isFinite(flow) && flow >= 0 ? clamp(flow / reference, 0, 2.2) : profile;
      const hasSpeed = Number.isFinite(speed) && speed >= 0 && speed <= 180;
      state.flow += (targetFlow - state.flow) * step;
      const weight = hasSpeed ? 0.8 : 0;
      if (hasSpeed) {
        const observed = Math.max(1.2, speed / 3.6);
        state.speed = state.speedWeight < 0.001 ? observed : state.speed + (observed - state.speed) * step;
      }
      state.speedWeight += (weight - state.speedWeight) * step;
      if (!row && Math.abs(state.flow - profile) < 0.01 && state.speedWeight < 0.01) {
        state.speedWeight = 0;
        smoothed.delete(state);
      }
    }
  }

  function setSnapshot(snapshot) {
    if (snapshot?.version !== 1) return false;
    if (Array.isArray(snapshot.observations)) {
      observations = snapshot.observations.filter(o => typeof o?.key === 'string' &&
        Number.isFinite(o.observedAt) && Number.isFinite(o.expiresAt));
    }
    if (Array.isArray(snapshot.restrictions)) {
      restrictions = snapshot.restrictions.filter(r => typeof r?.key === 'string' &&
        Number.isFinite(r.startsAt) && Number.isFinite(r.expiresAt));
    }
    if (Array.isArray(snapshot.buses?.vehicles)) busFeedHandler?.(snapshot.buses);
    refresh();
    return true;
  }

  return {
    bind, refresh, setSnapshot,
    onBusFeed(handler) { busFeedHandler = handler; },
    get profile() { return profile; },
    isClosed: edge => states.get(edge)?.closed === true,
    limit: edge => {
      const state = states.get(edge);
      return state ? Math.min(state.limit, state.temporary) : Infinity;
    },
    demand: edge => {
      const state = states.get(edge);
      return state && smoothed.has(state) ? state.flow : profile;
    },
    cruise: (edge, fallback) => {
      const state = states.get(edge);
      return state?.speedWeight ? fallback + (state.speed - fallback) * state.speedWeight : fallback;
    }
  };
}

export function watchEdeTraffic(traffic) {
  const url = new URL('../api/ede-traffic', import.meta.url);
  let next = 0, pending = false, unavailable = false;
  async function poll() {
    const now = Date.now();
    traffic.refresh(now);
    if (document.hidden || unavailable || pending || now < next) return;
    next = now + 12000;
    pending = true;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (response.status === 404) unavailable = true; // Static hosting supports the local simulation.
      else if (response.ok) traffic.setSnapshot(await response.json());
    } catch { /* The last successful readings expire independently. */ }
    finally { pending = false; }
  }
  setInterval(poll, 1000);
  document.addEventListener('visibilitychange', poll);
  poll();
}
