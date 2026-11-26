import { localClock } from './ede-transit-time.js';

// Prominent historic bell towers in Gemeente Ede (Oude Kerk scene coordinates: x east, z south).
export const EDE_BELL_TOWERS = Object.freeze([
  { id: 'oude-kerk', name: 'Oude Kerk', x: 0, z: 0, belfryHeight: 32, pitch: 0.90, carillon: true, range: 650 },
  { id: 'oude-kerk-lunteren', name: 'Oude Kerk Lunteren', x: -3410.36, z: -4206.54, belfryHeight: 24, pitch: 1.00, carillon: false, range: 520 },
  { id: 'oude-kerk-otterlo', name: 'Oude Kerk Otterlo', x: 6977.6, z: -6100.6, belfryHeight: 19, pitch: 1.08, carillon: false, range: 480 },
  { id: 'alexanderkerk-bennekom', name: 'Oude of Sint-Alexanderkerk', x: 333.31, z: 5339.9, belfryHeight: 19, pitch: 0.96, carillon: false, range: 500 },
]);

export const EDE_SHEEPFOLDS = Object.freeze([
  { id: 'schaapskooi-ginkelse-heide', x: 4337.48, z: 1071.32, range: 135 },
  { id: 'schaapskooi-de-kreel', x: 3327, z: 75, range: 120 },
]);

export const EDE_WINDMILLS = Object.freeze([
  { id: 'concordiamolen', x: -390.65, z: -101.70, hubHeight: 16, range: 95 },
  { id: 'keetmolen', x: -77.55, z: 1808.7, hubHeight: 15, range: 95 },
  { id: 'doesburgermolen', x: -1553.53, z: -1787.15, hubHeight: 13, range: 95 },
  { id: 'molen-de-hoop', x: -3571.92, z: -4904.07, hubHeight: 14, range: 95 },
  { id: 'walderveense-molen', x: -8098.45, z: -7414.7, hubHeight: 13, range: 95 },
]);

// Traditional Dutch-style carillon voorslag motifs (semitones relative to C5).
export const CARILLON_MOTIFS = Object.freeze({
  quarter: [
    { semitone: 4, offset: 0.0, gain: 0.85 },
    { semitone: 2, offset: 0.52, gain: 0.82 },
    { semitone: 0, offset: 1.04, gain: 0.88 },
    { semitone: -5, offset: 1.56, gain: 0.92 },
  ],
  half: [
    { semitone: 0, offset: 0.0, gain: 0.84 },
    { semitone: 4, offset: 0.50, gain: 0.86 },
    { semitone: 2, offset: 1.00, gain: 0.84 },
    { semitone: -5, offset: 1.50, gain: 0.90 },
    { semitone: 0, offset: 2.35, gain: 0.86 },
    { semitone: 2, offset: 2.85, gain: 0.88 },
    { semitone: 4, offset: 3.35, gain: 0.92 },
    { semitone: 0, offset: 3.85, gain: 0.96 },
  ],
  hour: [
    { semitone: 7, offset: 0.0, gain: 0.88 },
    { semitone: 4, offset: 0.48, gain: 0.84 },
    { semitone: 5, offset: 0.96, gain: 0.86 },
    { semitone: 2, offset: 1.44, gain: 0.84 },
    { semitone: 4, offset: 2.18, gain: 0.88 },
    { semitone: 2, offset: 2.66, gain: 0.85 },
    { semitone: 0, offset: 3.14, gain: 0.90 },
    { semitone: -5, offset: 3.62, gain: 0.95 },
  ],
});

// Dutch municipal bell quiet hours: silent between 23:00 and 07:00 local time.
export function isBellQuietHour(hour) {
  return hour < 7 || hour >= 23;
}

export function sampleHeathAt(heath, x, z) {
  if (!heath?.texture?.image?.data) return 0;
  const { width, height, data } = heath.texture.image;
  const u = (x - heath.minX) / heath.sizeX;
  const v = (z - heath.minZ) / heath.sizeZ;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  const col = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
  const row = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
  return data[row * width + col] / 255;
}

// Compute blade-pass frequency (Hz) and normalized wind load (0..1) for a wind turbine or historic mill.
export function rotorAudioParams(windSpeedKmh, isTurbine) {
  const mps = Number.isFinite(windSpeedKmh) ? Math.max(0, windSpeedKmh) / 3.6 : 0;
  if (isTurbine) {
    // Siemens SWT-3.2-101 cut-in 3 m/s, cut-out 25 m/s, 6.5–19 RPM, 3 blades => 0.325–0.95 Hz blade-pass.
    if (mps < 3 || mps > 25) return { bladeHz: 0, load: 0 };
    const frac = Math.min(1, (mps - 3) / 9);
    const rpm = 6.5 + frac * 12.5;
    return { bladeHz: (rpm * 3) / 60, load: 0.25 + frac * 0.75 };
  }
  // Historic 4-sail Dutch windmills turn in moderate winds (~2.5–14 m/s), ~6–16 RPM => 0.4–1.07 Hz.
  if (mps < 2.5 || mps > 15) return { bladeHz: 0, load: 0 };
  const frac = Math.min(1, (mps - 2.5) / 8.5);
  const rpm = 6 + frac * 10;
  return { bladeHz: (rpm * 4) / 60, load: 0.16 + frac * 0.48 };
}

// Schedules quarter-hour, half-hour, and full-hour chimes for nearby Ede church towers.
export function createBellScheduler(towers = EDE_BELL_TOWERS) {
  let lastSlot = null;
  return {
    reset() {
      lastSlot = null;
    },
    poll(epochSeconds, listener, terrainHeightAt) {
      const clock = localClock(epochSeconds);
      const slot = Math.floor(clock.seconds / 900);
      const slotKey = `${clock.date}:${slot}`;
      if (lastSlot === null) {
        lastSlot = slotKey;
        return [];
      }
      if (slotKey === lastSlot) return [];
      lastSlot = slotKey;

      const hour = Math.floor(clock.seconds / 3600) % 24;
      if (isBellQuietHour(hour)) return [];
      const quarter = slot % 4; // 0 = :00, 1 = :15, 2 = :30, 3 = :45
      const events = [];
      for (const tower of towers) {
        const dx = tower.x - listener.x;
        const dz = tower.z - listener.z;
        if (dx * dx + dz * dz > tower.range * tower.range) continue;
        const y = (terrainHeightAt ? terrainHeightAt(tower.x, tower.z) : 0) + tower.belfryHeight;
        const base = { id: tower, x: tower.x, y, z: tower.z, seed: tower.x * 0.013 + tower.z * 0.017 + slot };
        if (quarter === 0) {
          const strikes = hour % 12 || 12;
          if (tower.carillon) {
            events.push({ kind: 'carillon', source: base, range: tower.range, ref: 24,
              options: { notes: CARILLON_MOTIFS.hour, intensity: 0.72 } });
            events.push({ kind: 'churchBell', source: base, range: tower.range, ref: 28,
              options: { pitch: tower.pitch, strikes, spacing: 1.75, delay: 4.9, intensity: 0.88 } });
          } else {
            events.push({ kind: 'churchBell', source: base, range: tower.range, ref: 24,
              options: { pitch: tower.pitch, strikes, spacing: 1.7, delay: 0, intensity: 0.78 } });
          }
        } else if (quarter === 2) {
          if (tower.carillon) {
            events.push({ kind: 'carillon', source: base, range: tower.range, ref: 24,
              options: { notes: CARILLON_MOTIFS.half, intensity: 0.65 } });
            events.push({ kind: 'churchBell', source: base, range: tower.range, ref: 26,
              options: { pitch: tower.pitch * 1.1892, strikes: 1, delay: 4.8, intensity: 0.72 } });
          } else {
            events.push({ kind: 'churchBell', source: base, range: tower.range, ref: 22,
              options: { pitch: tower.pitch * 1.1892, strikes: 1, delay: 0, intensity: 0.68 } });
          }
        } else if (tower.carillon) {
          events.push({ kind: 'carillon', source: base, range: tower.range, ref: 22,
            options: { notes: CARILLON_MOTIFS.quarter, intensity: 0.56 } });
        }
      }
      return events;
    }
  };
}
