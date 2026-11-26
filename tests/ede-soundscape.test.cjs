const assert = require('node:assert/strict');
const test = require('node:test');

function createMockAudioContext(sampleRate = 16000) {
  const started = [];
  const makeParam = (value = 0) => ({
    value,
    automationRate: 'a-rate',
    setValueAtTime(v) { this.value = v; },
    setTargetAtTime(v) { this.value = v; },
    cancelScheduledValues() {},
  });
  const makeNode = (extra = {}) => ({
    ...extra,
    connect(dest) { return dest; },
    disconnect() {},
  });
  return {
    sampleRate,
    currentTime: 10,
    state: 'running',
    started,
    createBuffer(channels, count, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(count));
      return { duration: count / rate, length: count, sampleRate: rate, getChannelData: ch => data[ch] };
    },
    createGain() { return makeNode({ gain: makeParam(1) }); },
    createBiquadFilter() {
      return makeNode({
        type: 'lowpass',
        frequency: makeParam(350),
        detune: makeParam(0),
        Q: makeParam(1),
        gain: makeParam(0),
      });
    },
    createBufferSource() {
      const src = makeNode({
        buffer: null,
        loop: false,
        playbackRate: makeParam(1),
        onended: null,
        start(when = 0) { started.push({ buffer: this.buffer, when, rate: this.playbackRate.value }); },
        stop() {},
      });
      return src;
    },
  };
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

test('train and turbine motor voices synthesize non-empty resources and update cleanly', async () => {
  const { createSynthResources, createMotorVoice } = await import('../js/audio-synthesis.js');
  const ctx = createMockAudioContext();
  const resources = createSynthResources(ctx);

  assert.ok(rms(resources.trainHum.getChannelData(0)) > 0.2, 'trainHum has audible energy');
  assert.ok(rms(resources.bladeSwish.getChannelData(0)) > 0.2, 'bladeSwish has audible energy');

  const out = ctx.createGain();
  const train = createMotorVoice(ctx, resources, 'train', out);
  train.update({ speed: 28, load: 0.7, doppler: 1.04, seed: 0.3 }, 10);
  train.dispose();

  const turbine = createMotorVoice(ctx, resources, 'turbine', out);
  turbine.update({ speed: 0.65, load: 0.8, doppler: 1.0, seed: 0.5 }, 10);
  turbine.dispose();
});

test('Ede soundscape event buffers and playback work for bells, carillon, crossing, birds and sheep', async () => {
  const { createSynthResources } = await import('../js/audio-synthesis.js');
  const { createEventResources, playEvent } = await import('../js/audio-events.js');
  const ctx = createMockAudioContext();
  const resources = createEventResources(ctx, createSynthResources(ctx));
  const out = ctx.createGain();

  assert.ok(rms(resources.crossingBell.getChannelData(0)) > 0.05);
  assert.ok(rms(resources.churchBell.getChannelData(0)) > 0.05);
  assert.ok(rms(resources.carillonBell.getChannelData(0)) > 0.05);
  assert.equal(resources.birds.length, 3);
  for (const buf of resources.birds) assert.ok(rms(buf.getChannelData(0)) > 0.02);
  assert.equal(resources.sheep.length, 2);
  for (const buf of resources.sheep) assert.ok(rms(buf.getChannelData(0)) > 0.02);

  ctx.started.length = 0;
  const carillon = playEvent(ctx, resources, 'carillon', out, {
    notes: [{ semitone: 0, offset: 0 }, { semitone: 4, offset: 0.5 }, { semitone: 7, offset: 1.0 }],
    intensity: 0.7,
  });
  assert.equal(ctx.started.length, 3);
  assert.ok(carillon.endTime > ctx.currentTime + 1.0);
  carillon.dispose(true);

  ctx.started.length = 0;
  const bell = playEvent(ctx, resources, 'churchBell', out, { strikes: 3, spacing: 1.5, pitch: 0.9 });
  assert.equal(ctx.started.length, 3);
  assert.ok(bell.endTime > ctx.currentTime + 3.0);
  bell.dispose(true);

  for (const kind of ['crossingBell', 'bird', 'sheep']) {
    ctx.started.length = 0;
    const ev = playEvent(ctx, resources, kind, out, { intensity: 0.6, seed: 3 });
    assert.equal(ctx.started.length, 1, `${kind} should trigger one buffer`);
    ev.dispose(true);
  }
});

test('bell scheduler chimes Oude Kerk carillon and obeys night quiet hours', async () => {
  const { createBellScheduler } = await import('../js/ede-soundscape.js');
  const scheduler = createBellScheduler();
  const centrum = { x: 20, y: 2, z: -15 };

  // 2026-06-15 11:59:50 CEST (UTC+2) -> 09:59:50Z
  const beforeNoon = Date.parse('2026-06-15T09:59:50Z') / 1000;
  const atNoon = Date.parse('2026-06-15T10:00:05Z') / 1000;
  assert.deepEqual(scheduler.poll(beforeNoon, centrum), []);
  const noonEvents = scheduler.poll(atNoon, centrum);
  assert.equal(noonEvents.length, 2, 'Oude Kerk plays carillon voorslag + 12 hour strikes');
  assert.equal(noonEvents[0].kind, 'carillon');
  assert.equal(noonEvents[1].kind, 'churchBell');
  assert.equal(noonEvents[1].options.strikes, 12);

  // Quarter past noon: Oude Kerk carillon only
  const atQuarter = Date.parse('2026-06-15T10:15:05Z') / 1000;
  const quarterEvents = scheduler.poll(atQuarter, centrum);
  assert.equal(quarterEvents.length, 1);
  assert.equal(quarterEvents[0].kind, 'carillon');

  // Quiet hours at 23:00 CEST (21:00Z): silent
  scheduler.reset();
  const beforeLate = Date.parse('2026-06-15T20:59:50Z') / 1000;
  const atLate = Date.parse('2026-06-15T21:00:05Z') / 1000;
  scheduler.poll(beforeLate, centrum);
  assert.deepEqual(scheduler.poll(atLate, centrum), []);
});

test('sampleHeathAt and rotorAudioParams behave cleanly across bounds', async () => {
  const { sampleHeathAt, rotorAudioParams } = await import('../js/ede-soundscape.js');
  const heath = {
    minX: 0, minZ: 0, sizeX: 100, sizeZ: 100,
    texture: { image: { width: 2, height: 2, data: new Uint8Array([0, 255, 128, 0]) } },
  };
  assert.equal(sampleHeathAt(heath, 75, 25), 1);
  assert.equal(sampleHeathAt(heath, 25, 25), 0);
  assert.equal(sampleHeathAt(heath, -10, 10), 0);
  assert.equal(sampleHeathAt(null, 50, 50), 0);

  assert.equal(rotorAudioParams(5, true).load, 0, 'below 3 m/s cut-in');
  const activeTurbine = rotorAudioParams(25, true);
  assert.ok(activeTurbine.bladeHz > 0.3 && activeTurbine.load > 0.25);
  assert.equal(rotorAudioParams(100, true).load, 0, 'above 25 m/s cut-out');

  const activeMill = rotorAudioParams(20, false);
  assert.ok(activeMill.bladeHz > 0.35 && activeMill.load > 0.15);
});
