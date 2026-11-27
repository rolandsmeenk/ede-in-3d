const CENTRUM = 'ede-centrum';
const TAU = Math.PI * 2;
const cues = {
  trainApproach: { range: 125, ref: 13, intensity: 0.58 },
  trainBrake: { range: 105, ref: 12, intensity: 0.73 },
  trainDoors: { range: 65, ref: 8, intensity: 0.68 },
  trainDeparture: { range: 100, ref: 12, intensity: 0.65 },
};

function arrivalPhase(train, at) {
  if (train.plan.trip.operator !== 'RRReis') return null;
  const stop = train.plan.anchors?.find(anchor => anchor.station === CENTRUM);
  if (!stop) return null;
  const remaining = stop.distance - train.distance;
  const arrival = stop.arrival + (train.plan.offset ?? 0), departure = stop.departure + (train.plan.offset ?? 0);
  if (train.speed > 1.2 && at >= arrival - 45 && at < departure) {
    if (remaining > 72 && remaining <= 153) return 'trainApproach';
    if (remaining > 3 && remaining <= 72) return 'trainBrake';
  }
  if (Math.abs(remaining) < 2.5 && train.speed <= 1.2 &&
      at >= arrival - 0.6 && at < Math.min(departure, arrival + 6)) return 'trainDoors';
  if (remaining <= 1 && remaining > -42 && train.speed > 1.2 &&
      at >= departure && at < departure + 14) return 'trainDeparture';
  return null;
}

export function createValleilijnArrivalSounds() {
  const heard = new WeakMap();
  return (trains, at, listener, emit) => {
    // The effects belong to Ede Centrum's stop cycle, even with both lines in earshot.
    if (Math.hypot(listener.x + 247, listener.z - 317) > 240) return;
    for (const train of trains) {
      const kind = arrivalPhase(train, at);
      if (!kind) continue;
      let visit = heard.get(train);
      if (visit?.key !== train.plan.key) {
        visit = { key: train.plan.key, played: new Set() };
        heard.set(train, visit);
      }
      if (visit.played.has(kind)) continue;
      const stop = train.plan.path.stops[CENTRUM];
      let position = null, nearest = Infinity;
      // Pick an actual carriage so the warning comes from the side of the platform the listener is standing on.
      for (const offset of [-19.4, 0, 19.4]) {
        const sample = train.plan.path.sample(kind === 'trainDoors' ? stop.distance + offset : train.distance + offset);
        const distance = Math.hypot(listener.x - sample.x, listener.y - sample.y - 1.5, listener.z - sample.z);
        if (distance < nearest) { position = sample; nearest = distance; }
      }
      const options = cues[kind];
      if (nearest > options.range) continue;
      if (emit(kind, { id: train, x: position.x, y: position.y + 1.5, z: position.z,
        heading: position.heading, seed: Number(train.plan.trip.number) || 0 }, { ...options, follow: true })) {
        visit.played.add(kind);
      }
    }
  };
}

export function createValleilijnCueBuffers(ctx, makeBuffer, randomSource) {
  const smooth = x => {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
  };
  function railNoise(seed, lowHz, highHz) {
    const noise = randomSource(seed);
    const a = 1 - Math.exp(-TAU * lowHz / ctx.sampleRate), b = 1 - Math.exp(-TAU * highHz / ctx.sampleRate);
    let low = 0, high = 0;
    return () => {
      const n = 2 * noise() - 1;
      low += a * (n - low);
      high += b * (n - high);
      return high - low;
    };
  }

  const approach = railNoise(534, 62, 410);
  const brake = railNoise(535, 340, 4600);
  const door = railNoise(536, 240, 2500);
  const departure = railNoise(537, 35, 610);
  return {
    trainApproach: makeBuffer(ctx, 3.7, t => {
      const wheel = (0.7 + 0.3 * Math.cos(TAU * (13 * t - 0.4 * t * t))) * approach();
      const traction = 0.09 * Math.sin(TAU * (91 * t - 2.3 * t * t));
      return (wheel + traction) * smooth(t / 1.6) * smooth((3.7 - t) / 0.75);
    }, 0.49),
    trainBrake: makeBuffer(ctx, 3.3, t => {
      const squeal = Math.sin(TAU * (1240 * t - 122 * t * t + 4 * Math.sin(t * 9)));
      const flange = Math.sin(TAU * (1440 * t - 46 * t * t));
      return (brake() * 0.46 + (squeal + flange * 0.26) * smooth((t - 0.55) / 0.47) * 0.17)
        * smooth(t / 0.45) * smooth((3.3 - t) / 1.1);
    }, 0.45),
    trainDoors: makeBuffer(ctx, 1.65, t => {
      const local = t % 0.175;
      const warning = t < 0.525 ? Math.sin(TAU * 1760 * local) * smooth(local / 0.009) * smooth((0.106 - local) / 0.025) : 0;
      const slide = door() * smooth((t - 0.52) / 0.16) * smooth((1.42 - t) / 0.16);
      const latch = door() * smooth((t - 1.37) / 0.008) * Math.exp(-Math.max(0, t - 1.39) * 31);
      return warning * 0.22 + slide * 0.52 + latch * 0.55;
    }, 0.48),
    trainDeparture: makeBuffer(ctx, 4.1, t => {
      const inverter = TAU * (103 * t + 29 * t * t + 1.5 * smooth((t - 1.4) / 0.28));
      const traction = 0.25 * Math.sin(inverter) + 0.12 * Math.sin(2 * inverter) + 0.07 * Math.sin(3 * inverter);
      return (traction + departure() * (0.18 + t * 0.075)) * smooth(t / 0.72) * smooth((4.1 - t) / 1.5);
    }, 0.5),
  };
}
