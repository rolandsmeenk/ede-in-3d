import {
  MSI_DEFAULT_FLASHER_MASK,
  MSI_UV_RECTS,
  VRI_UV_RECTS,
  parseMsiLegendCode,
} from './live-signal-atlas.js';

export const SPAT_STATES = Object.freeze({
  DARK: 'DARK',
  STOP_AND_REMAIN: 'STOP_AND_REMAIN',
  PERMISSIVE_MOVEMENT_ALLOWED: 'PERMISSIVE_MOVEMENT_ALLOWED',
  PROTECTED_MOVEMENT_ALLOWED: 'PROTECTED_MOVEMENT_ALLOWED',
  PRE_MOVEMENT: 'PRE_MOVEMENT',
  STOP_THEN_PROCEED: 'STOP_THEN_PROCEED',
  FLASHING_AMBER: 'FLASHING_AMBER',
});

const SPAT_NORMALIZE = Object.freeze({
  dark: SPAT_STATES.DARK,
  DARK: SPAT_STATES.DARK,
  'stop-And-Remain': SPAT_STATES.STOP_AND_REMAIN,
  STOP_AND_REMAIN: SPAT_STATES.STOP_AND_REMAIN,
  red: SPAT_STATES.STOP_AND_REMAIN,
  'permissive-Movement-Allowed': SPAT_STATES.PERMISSIVE_MOVEMENT_ALLOWED,
  PERMISSIVE_MOVEMENT_ALLOWED: SPAT_STATES.PERMISSIVE_MOVEMENT_ALLOWED,
  'protected-Movement-Allowed': SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED,
  PROTECTED_MOVEMENT_ALLOWED: SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED,
  green: SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED,
  'pre-Movement': SPAT_STATES.PRE_MOVEMENT,
  PRE_MOVEMENT: SPAT_STATES.PRE_MOVEMENT,
  'stop-Then-Proceed': SPAT_STATES.STOP_THEN_PROCEED,
  STOP_THEN_PROCEED: SPAT_STATES.STOP_THEN_PROCEED,
  amber: SPAT_STATES.STOP_THEN_PROCEED,
  yellow: SPAT_STATES.STOP_THEN_PROCEED,
  'caution-Conflicting-Traffic': SPAT_STATES.FLASHING_AMBER,
  FLASHING_AMBER: SPAT_STATES.FLASHING_AMBER,
  'flashing-amber': SPAT_STATES.FLASHING_AMBER,
});

export function normalizeSpatState(raw) {
  if (raw == null) return SPAT_STATES.DARK;
  return SPAT_NORMALIZE[String(raw).trim()] ?? SPAT_STATES.DARK;
}

export function isGreenSpatState(state) {
  return state === SPAT_STATES.PERMISSIVE_MOVEMENT_ALLOWED || state === SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED;
}

export function isAmberSpatState(state) {
  return state === SPAT_STATES.PRE_MOVEMENT || state === SPAT_STATES.STOP_THEN_PROCEED;
}

export function spatToTrafficPhase(state) {
  if (isGreenSpatState(state)) return 'green';
  if (isAmberSpatState(state)) return 'amber';
  if (state === SPAT_STATES.FLASHING_AMBER) return 'flashing-amber';
  if (state === SPAT_STATES.DARK) return 'dark';
  return 'red';
}

export function spatToVriAspectCode(state, kind = 'motor', movement = 'all') {
  if (state === SPAT_STATES.DARK) return 'DARK';
  if (kind === 'pedestrian') {
    return isGreenSpatState(state) ? 'PED_GREEN' : 'PED_RED';
  }
  if (kind === 'cyclist') {
    if (isGreenSpatState(state)) return 'CYCLIST_GREEN';
    if (isAmberSpatState(state) || state === SPAT_STATES.FLASHING_AMBER) return 'CYCLIST_AMBER';
    return 'CYCLIST_RED';
  }
  const color = isGreenSpatState(state)
    ? 'GREEN'
    : (isAmberSpatState(state) || state === SPAT_STATES.FLASHING_AMBER)
      ? 'AMBER'
      : 'RED';
  if (movement === 'left') return `${color}_LEFT`;
  if (movement === 'straight') return `${color}_STRAIGHT`;
  if (movement === 'right') return `${color}_RIGHT`;
  return color;
}

/**
 * Parse NDW MSI JSON payload (proxy or direct JSON).
 */
export function parseNdwMsiJson(payload, nowMs = Date.now()) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.msi) ? payload.msi : [];
  const results = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const gantryId = item.gantryId ?? item.vmsUnitId ?? item.id;
    if (!gantryId) continue;
    const laneIndex = Math.max(1, Math.round(Number(item.laneIndex ?? item.lane ?? 1)));
    const parsed = parseMsiLegendCode(item.legend ?? item.code ?? item.pictogram, item.direction);
    const expiresAt = Number.isFinite(item.expiresAt) ? item.expiresAt : nowMs + 180_000;
    results.push({
      gantryId: String(gantryId),
      laneIndex,
      legend: parsed.code,
      uvRect: parsed.uvRect,
      flasherMask: item.flashers === false ? 0 : (item.flashers === true ? 1 : parsed.flasherMask),
      speedLimitKmh: parsed.speedLimitKmh,
      laneClosed: parsed.laneClosed,
      mergeDirection: parsed.mergeDirection,
      expiresAt,
    });
  }
  return results;
}

/**
 * Lightweight DATEX II MSI XML parser (no DOMParser dependency so it works in Node tests too).
 */
export function parseNdwMsiXml(xmlText, nowMs = Date.now()) {
  if (typeof xmlText !== 'string' || !xmlText.includes('vms')) return [];
  const results = [];
  const unitRegex = /<(?:\w+:)?vmsUnit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?vmsUnit>/gi;
  let unitMatch;
  while ((unitMatch = unitRegex.exec(xmlText)) !== null) {
    const gantryId = unitMatch[1];
    const body = unitMatch[2];
    const vmsRegex = /<(?:\w+:)?vms\b[^>]*>([\s\S]*?)<\/(?:\w+:)?vms>/gi;
    let vmsMatch;
    while ((vmsMatch = vmsRegex.exec(body)) !== null) {
      const block = vmsMatch[1];
      const laneMatch = /<(?:\w+:)?laneNumber>(\d+)<\/(?:\w+:)?laneNumber>/i.exec(block);
      const codeMatch = /<(?:\w+:)?(?:pictogramDescription|vmsLegendCode|legendCode)>([^<]+)<\//i.exec(block);
      const dirMatch = /<(?:\w+:)?(?:pictogramDirection|direction)>([^<]+)<\//i.exec(block);
      const flashMatch = /<(?:\w+:)?flashingBeacon>([^<]+)<\//i.exec(block);
      const parsed = parseMsiLegendCode(codeMatch?.[1], dirMatch?.[1]);
      const flashers = flashMatch ? /^(true|1)$/i.test(flashMatch[1].trim()) : parsed.flasherMask > 0;
      results.push({
        gantryId,
        laneIndex: laneMatch ? Math.max(1, Number(laneMatch[1])) : 1,
        legend: parsed.code,
        uvRect: parsed.uvRect,
        flasherMask: flashers ? 1 : 0,
        speedLimitKmh: parsed.speedLimitKmh,
        laneClosed: parsed.laneClosed,
        mergeDirection: parsed.mergeDirection,
        expiresAt: nowMs + 180_000,
      });
    }
  }
  return results;
}

/**
 * Parse Talking Traffic / NDW SPaT JSON into normalized intersection signal group states.
 */
export function parseTalkingTrafficSpat(payload, nowMs = Date.now()) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.vri)
      ? payload.vri
      : Array.isArray(payload?.intersections)
        ? payload.intersections
        : Array.isArray(payload?.kruispunten)
          ? payload.kruispunten
          : [];
  const results = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const intersectionId = item.intersectionId ?? item.kruispunt_id ?? item.id;
    if (!intersectionId) continue;
    const expiresAt = Number.isFinite(item.expiresAt) ? item.expiresAt : nowMs + 30_000;
    const rawGroups = item.signalGroups ?? item.states ?? [];
    const signalGroups = [];
    for (const sg of rawGroups) {
      if (!sg || typeof sg !== 'object') continue;
      const signalGroupId = sg.signalGroupId ?? sg.signalGroup ?? sg.id;
      if (!signalGroupId) continue;
      const state = normalizeSpatState(sg.state ?? sg.eventState);
      const likelyTime = Number.isFinite(Number(sg.likelyTime)) ? Number(sg.likelyTime) : null;
      signalGroups.push({ signalGroupId: String(signalGroupId), state, likelyTime });
    }
    if (signalGroups.length > 0) {
      results.push({ intersectionId: String(intersectionId), expiresAt, signalGroups });
    }
  }
  return results;
}

async function loadEdeLiveSignals() {
  const response = await fetch(new URL('../assets/ede-live-signals.json', import.meta.url));
  if (!response.ok) throw new Error(`Ede live signals asset returned HTTP ${response.status}`);
  const asset = await response.json();
  if (asset?.version !== 1 || !Array.isArray(asset.msiGantries) || !Array.isArray(asset.vriIntersections)) {
    throw new Error('Invalid Ede live signals asset');
  }
  return asset;
}

export { loadEdeLiveSignals };

/**
 * Compute deterministic, conflict-free phase state for one intersection at time `simTime`.
 * Guarantees axis 0 (N-S) and axis 1 (E-W) are never green or amber simultaneously
 * by enforcing a 2.0 s all-red clearance interval between phases.
 */
export function evaluateDeterministicVriPhase(intersection, simTime, { nightFlashing = false } = {}) {
  if (nightFlashing && intersection.minor) {
    return {
      axis0: SPAT_STATES.FLASHING_AMBER,
      axis1: SPAT_STATES.FLASHING_AMBER,
      ped0: SPAT_STATES.DARK,
      ped1: SPAT_STATES.DARK,
      likelyTime0: null,
      likelyTime1: null,
    };
  }
  const cycle = Math.max(30, Number(intersection.cycleSeconds) || 60);
  const offset = Number(intersection.offsetSeconds) || 0;
  const t = (((simTime + offset) % cycle) + cycle) % cycle;

  const half = cycle * 0.5;
  const amberDuration = 3.0;
  const allRedClearance = 2.0;
  const greenDuration = Math.max(8.0, half - amberDuration - allRedClearance);

  let axis0 = SPAT_STATES.STOP_AND_REMAIN;
  let axis1 = SPAT_STATES.STOP_AND_REMAIN;
  let ped0 = SPAT_STATES.STOP_AND_REMAIN;
  let ped1 = SPAT_STATES.STOP_AND_REMAIN;
  let likelyTime0 = 0;
  let likelyTime1 = 0;

  if (t < greenDuration) {
    axis0 = SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED;
    ped0 = t < Math.min(9.0, greenDuration - 4.0) ? SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED : SPAT_STATES.STOP_AND_REMAIN;
    likelyTime0 = greenDuration - t;
    likelyTime1 = half - t;
  } else if (t < greenDuration + amberDuration) {
    axis0 = SPAT_STATES.STOP_THEN_PROCEED;
    likelyTime0 = greenDuration + amberDuration - t;
    likelyTime1 = half - t;
  } else if (t < half) {
    // All-red clearance interval.
    likelyTime0 = cycle - t;
    likelyTime1 = half - t;
  } else if (t < half + greenDuration) {
    axis1 = SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED;
    ped1 = (t - half) < Math.min(9.0, greenDuration - 4.0) ? SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED : SPAT_STATES.STOP_AND_REMAIN;
    likelyTime0 = cycle - t;
    likelyTime1 = half + greenDuration - t;
  } else if (t < half + greenDuration + amberDuration) {
    axis1 = SPAT_STATES.STOP_THEN_PROCEED;
    likelyTime0 = cycle - t;
    likelyTime1 = half + greenDuration + amberDuration - t;
  } else {
    // All-red clearance interval before axis 0.
    likelyTime0 = cycle - t;
    likelyTime1 = cycle + half - t;
  }

  return { axis0, axis1, ped0, ped1, likelyTime0, likelyTime1 };
}

/**
 * Enforce conflict-free invariant on an intersection's signal group state map:
 * axis 0 and axis 1 motor groups may never both be green/amber at the same time.
 */
export function enforceVriConflictGuard(intersection, stateByGroupId) {
  let axis0Active = false;
  let axis1Active = false;
  for (const sg of intersection.signalGroups) {
    if (sg.kind !== 'motor') continue;
    const state = stateByGroupId.get(sg.signalGroupId);
    if (isGreenSpatState(state) || isAmberSpatState(state)) {
      if (sg.axis === 0) axis0Active = true;
      else axis1Active = true;
    }
  }
  if (axis0Active && axis1Active) {
    // Safety interlock: force axis 1 (and its ped/cyclist groups) to STOP_AND_REMAIN.
    for (const sg of intersection.signalGroups) {
      if (sg.axis !== 0) {
        stateByGroupId.set(sg.signalGroupId, SPAT_STATES.STOP_AND_REMAIN);
      }
    }
    return true;
  }
  return false;
}

export function createLiveSignalController(asset = { msiGantries: [], vriIntersections: [] }, { now = Date.now } = {}) {
  const msiGantries = asset.msiGantries ?? [];
  const vriIntersections = asset.vriIntersections ?? [];

  // Flat pre-allocated MSI head state table (zero per-frame allocations).
  const msiHeads = [];
  const msiHeadById = new Map();
  const msiHeadsByGantry = new Map();
  const msiHeadsByWay = new Map();

  for (const gantry of msiGantries) {
    const gantryHeads = [];
    for (const head of gantry.heads ?? []) {
      const entry = {
        id: head.id,
        gantryId: gantry.id,
        route: gantry.route,
        wayId: gantry.wayId ?? null,
        laneIndex: head.laneIndex,
        x: head.x,
        z: head.z,
        yaw: head.yaw,
        beamY: gantry.beamY,
        level: gantry.level ?? 0,
        legend: 'BLANK',
        uvRect: MSI_UV_RECTS.BLANK,
        flasherMask: 0,
        speedLimitKmh: null,
        laneClosed: false,
        mergeDirection: null,
        liveExpiresAt: 0,
        source: 'fallback',
      };
      msiHeads.push(entry);
      msiHeadById.set(entry.id, entry);
      gantryHeads.push(entry);
      if (entry.wayId) {
        if (!msiHeadsByWay.has(entry.wayId)) msiHeadsByWay.set(entry.wayId, []);
        msiHeadsByWay.get(entry.wayId).push(entry);
      }
    }
    msiHeadsByGantry.set(gantry.id, gantryHeads);
  }

  // Flat VRI intersection + signal group state table.
  const intersectionById = new Map();
  const vriGroupStates = new Map(); // `${intersectionId}/${sgId}` -> mutable state object
  const liveSpatOverrides = new Map(); // intersectionId -> { expiresAt, states: Map<sgId, { state, likelyTime }> }

  for (const intersection of vriIntersections) {
    intersectionById.set(intersection.id, intersection);
    for (const sg of intersection.signalGroups ?? []) {
      const key = `${intersection.id}/${sg.signalGroupId}`;
      vriGroupStates.set(key, {
        intersectionId: intersection.id,
        signalGroupId: sg.signalGroupId,
        axis: sg.axis,
        kind: sg.kind,
        movement: sg.movement ?? 'all',
        state: SPAT_STATES.STOP_AND_REMAIN,
        aspectCode: spatToVriAspectCode(SPAT_STATES.STOP_AND_REMAIN, sg.kind, sg.movement),
        uvRect: VRI_UV_RECTS.RED,
        likelyTime: null,
        flashing: 0,
        source: 'fallback',
      });
    }
  }

  // Scratch map reused inside update() to avoid GC allocations.
  const scratchGroupStates = new Map();
  let lastMsiUpdateMs = 0;
  let lastVriUpdateMs = 0;
  let feedStatus = 'offline';
  let conflictInterventions = 0;

  function applyMsiSnapshot(payload, atMs = now()) {
    const records = typeof payload === 'string' ? parseNdwMsiXml(payload, atMs) : parseNdwMsiJson(payload, atMs);
    let applied = 0;
    for (const rec of records) {
      const heads = msiHeadsByGantry.get(rec.gantryId);
      if (!heads) continue;
      for (const head of heads) {
        if (head.laneIndex !== rec.laneIndex) continue;
        head.legend = rec.legend;
        head.uvRect = rec.uvRect;
        head.flasherMask = rec.flasherMask;
        head.speedLimitKmh = rec.speedLimitKmh;
        head.laneClosed = rec.laneClosed;
        head.mergeDirection = rec.mergeDirection;
        head.liveExpiresAt = rec.expiresAt;
        head.source = 'live';
        applied++;
      }
    }
    if (applied > 0) {
      lastMsiUpdateMs = atMs;
      feedStatus = 'live';
    }
    return applied;
  }

  function applySpatSnapshot(payload, atMs = now()) {
    const records = parseTalkingTrafficSpat(payload, atMs);
    let applied = 0;
    for (const rec of records) {
      const intersection = intersectionById.get(rec.intersectionId);
      if (!intersection) continue;
      const map = new Map();
      for (const sg of rec.signalGroups) {
        map.set(sg.signalGroupId, { state: sg.state, likelyTime: sg.likelyTime });
      }
      liveSpatOverrides.set(rec.intersectionId, { expiresAt: rec.expiresAt, states: map });
      applied++;
    }
    if (applied > 0) {
      lastVriUpdateMs = atMs;
      feedStatus = 'live';
    }
    return applied;
  }

  function setSnapshot(snapshot, atMs = now()) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    let count = 0;
    if (snapshot.msi) count += applyMsiSnapshot(snapshot.msi, atMs);
    if (snapshot.vri || snapshot.intersections) count += applySpatSnapshot(snapshot.vri ?? snapshot.intersections, atMs);
    return count > 0;
  }

  /**
   * Deterministic fallback for A12/A30 MSI heads when live NDW MSI data is absent/expired.
   * Responds to optional traffic congestion / road closures if supplied, otherwise shows
   * realistic clear or peak-hour speed advisories.
   */
  function updateMsiFallback(atMs, { trafficDemand = 0.7, speedRestrictions = null } = {}) {
    for (let i = 0; i < msiHeads.length; i++) {
      const head = msiHeads[i];
      if (head.liveExpiresAt > atMs) continue;
      let code = 'BLANK';
      const restriction = speedRestrictions?.get(head.wayId);
      if (restriction?.closed) {
        code = head.laneIndex === 1 ? 'F01' : 'F02-R';
      } else if (Number.isFinite(restriction?.limitKmh)) {
        const kmh = restriction.limitKmh <= 55 ? 50
          : restriction.limitKmh <= 75 ? 70
            : restriction.limitKmh <= 85 ? 80
              : restriction.limitKmh <= 95 ? 90 : 100;
        code = `A01-${kmh}`;
      } else if (trafficDemand >= 1.1) {
        code = 'A01-70';
      } else if (trafficDemand >= 0.95) {
        code = 'A01-90';
      }
      const parsed = parseMsiLegendCode(code);
      head.legend = parsed.code;
      head.uvRect = parsed.uvRect;
      head.flasherMask = MSI_DEFAULT_FLASHER_MASK[parsed.code] ?? 0;
      head.speedLimitKmh = parsed.speedLimitKmh;
      head.laneClosed = parsed.laneClosed;
      head.mergeDirection = parsed.mergeDirection;
      head.source = 'fallback';
    }
  }

  function update(simTimeSeconds, atMs = now(), { nightFactor = 0, localHour = null, trafficDemand = 0.7, speedRestrictions = null } = {}) {
    const nightFlashing = localHour != null
      ? (localHour < 5.5 || localHour >= 23.5)
      : nightFactor > 0.78;

    updateMsiFallback(atMs, { trafficDemand, speedRestrictions });

    for (let i = 0; i < vriIntersections.length; i++) {
      const intersection = vriIntersections[i];
      const override = liveSpatOverrides.get(intersection.id);
      const useLive = override && override.expiresAt > atMs;
      const fallback = useLive ? null : evaluateDeterministicVriPhase(intersection, simTimeSeconds, { nightFlashing });

      scratchGroupStates.clear();
      const groups = intersection.signalGroups;
      for (let g = 0; g < groups.length; g++) {
        const sg = groups[g];
        let state;
        if (useLive) {
          state = override.states.get(sg.signalGroupId)?.state ?? SPAT_STATES.STOP_AND_REMAIN;
        } else if (sg.kind === 'pedestrian') {
          state = sg.axis === 0 ? fallback.ped0 : fallback.ped1;
        } else {
          state = sg.axis === 0 ? fallback.axis0 : fallback.axis1;
        }
        scratchGroupStates.set(sg.signalGroupId, state);
      }

      if (enforceVriConflictGuard(intersection, scratchGroupStates)) {
        conflictInterventions++;
      }

      for (let g = 0; g < groups.length; g++) {
        const sg = groups[g];
        const entry = vriGroupStates.get(`${intersection.id}/${sg.signalGroupId}`);
        const state = scratchGroupStates.get(sg.signalGroupId);
        const aspectCode = spatToVriAspectCode(state, sg.kind, sg.movement);
        entry.state = state;
        entry.aspectCode = aspectCode;
        entry.uvRect = VRI_UV_RECTS[aspectCode] ?? VRI_UV_RECTS.DARK;
        entry.flashing = state === SPAT_STATES.FLASHING_AMBER ? 1 : 0;
        entry.source = useLive ? 'live' : 'fallback';
        entry.likelyTime = useLive
          ? (override.states.get(sg.signalGroupId)?.likelyTime ?? null)
          : (sg.axis === 0 ? fallback.likelyTime0 : fallback.likelyTime1);
      }
    }
  }

  /**
   * Spatial lookup for AI traffic agents approaching a signalized intersection.
   * Returns 'green' | 'amber' | 'red' | 'flashing-amber' | 'dark' or null if no VRI matches.
   */
  function queryIntersectionPhase(x, z, axisIndex, maxDist = 55) {
    let best = null;
    let bestD2 = maxDist * maxDist;
    for (let i = 0; i < vriIntersections.length; i++) {
      const inter = vriIntersections[i];
      const dx = x - inter.center[0];
      const dz = z - inter.center[1];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = inter;
      }
    }
    if (!best) return null;
    for (let g = 0; g < best.signalGroups.length; g++) {
      const sg = best.signalGroups[g];
      if (sg.kind === 'motor' && sg.axis === axisIndex) {
        const entry = vriGroupStates.get(`${best.id}/${sg.signalGroupId}`);
        return entry ? spatToTrafficPhase(entry.state) : null;
      }
    }
    return null;
  }

  /**
   * Query active motorway MSI state for AI traffic agents on A12 / A30.
   */
  function queryMotorwaySignal(wayId, x, z, laneIndex = 1, maxDist = 140) {
    const candidates = wayId ? msiHeadsByWay.get(wayId) : null;
    if (!candidates || candidates.length === 0) return null;
    let best = null;
    let bestD2 = maxDist * maxDist;
    for (let i = 0; i < candidates.length; i++) {
      const h = candidates[i];
      if (laneIndex != null && h.laneIndex !== laneIndex) continue;
      const dx = x - h.x;
      const dz = z - h.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = h;
      }
    }
    if (!best) return null;
    return {
      legend: best.legend,
      speedLimitKmh: best.speedLimitKmh,
      speedLimitMs: best.speedLimitKmh != null ? best.speedLimitKmh / 3.6 : Infinity,
      laneClosed: best.laneClosed,
      mergeDirection: best.mergeDirection,
      flasherMask: best.flasherMask,
    };
  }

  return {
    msiGantries,
    msiHeads,
    vriIntersections,
    vriGroupStates,
    applyMsiSnapshot,
    applySpatSnapshot,
    setSnapshot,
    update,
    queryIntersectionPhase,
    queryMotorwaySignal,
    getMsiHeadState: id => msiHeadById.get(id) ?? null,
    getVriGroupState: (intersectionId, signalGroupId) => vriGroupStates.get(`${intersectionId}/${signalGroupId}`) ?? null,
    setTestMsiPattern(mode = 'demo', laneFilter = null, durationMs = 3_600_000) {
      const expiresAt = now() + durationMs;
      const demoLegends = ['F01', 'F02-R', 'A01-70', 'J33', 'A01-90', 'F08'];
      const key = String(mode ?? 'BLANK').trim();
      const isDemo = key.toLowerCase() === 'demo';
      let updated = 0;
      for (const head of msiHeads) {
        if (laneFilter != null && head.laneIndex !== laneFilter) continue;
        const code = isDemo ? demoLegends[(head.laneIndex - 1) % demoLegends.length] : key;
        const parsed = parseMsiLegendCode(code);
        head.legend = parsed.code;
        head.uvRect = parsed.uvRect;
        head.flasherMask = parsed.flasherMask;
        head.speedLimitKmh = parsed.speedLimitKmh;
        head.laneClosed = parsed.laneClosed;
        head.mergeDirection = parsed.mergeDirection;
        head.liveExpiresAt = parsed.code === 'BLANK' ? 0 : expiresAt;
        head.source = parsed.code === 'BLANK' ? 'fallback' : 'test';
        updated++;
      }
      return updated;
    },
    get stats() {
      return {
        msiGantries: msiGantries.length,
        msiHeads: msiHeads.length,
        vriIntersections: vriIntersections.length,
        vriSignalGroups: vriGroupStates.size,
        feedStatus,
        lastMsiUpdateMs,
        lastVriUpdateMs,
        conflictInterventions,
      };
    },
  };
}

/**
 * Configurable live feed watcher supporting polling (default `/api/ede-signals`)
 * or a custom HTTPS proxy / WebSocket endpoint with graceful offline fallback.
 */
export function watchLiveSignals(controller, { endpoint, pollIntervalMs = 5000 } = {}) {
  let url = new URL('../api/ede-signals', import.meta.url);
  if (endpoint) {
    try {
      const remote = new URL(endpoint);
      if ((remote.protocol === 'https:' || remote.protocol === 'wss:') && !remote.username && !remote.password) {
        url = remote;
      }
    } catch { /* Fall back to same-origin endpoint. */ }
  }

  if (url.protocol === 'wss:' && typeof WebSocket !== 'undefined') {
    let ws = null;
    let closed = false;
    function connect() {
      if (closed) return;
      try {
        ws = new WebSocket(url.href);
        ws.onmessage = event => {
          try {
            controller.setSnapshot(JSON.parse(event.data));
          } catch { /* Ignore malformed frames. */ }
        };
        ws.onclose = () => {
          if (!closed) setTimeout(connect, pollIntervalMs * 2);
        };
      } catch { /* Offline fallback remains active. */ }
    }
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }

  let pending = false;
  let unavailable = false;
  async function poll() {
    if ((typeof document !== 'undefined' && document.hidden) || unavailable || pending) return;
    pending = true;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4500), cache: 'no-store' });
      if (response.status === 404) unavailable = true;
      else if (response.ok) controller.setSnapshot(await response.json());
    } catch { /* Graceful fallback continues without interruption. */ }
    finally { pending = false; }
  }

  const timer = setInterval(poll, pollIntervalMs);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', poll);
  }
  poll();
  return () => {
    clearInterval(timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', poll);
    }
  };
}
