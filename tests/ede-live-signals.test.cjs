const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');
const test = require('node:test');

const { loadModule } = require('./helpers/module.cjs');
const liveSignalsAsset = require('../assets/ede-live-signals.json');

const readSource = relPath => readFileSync(join(__dirname, '..', relPath), 'utf8');

async function loadLiveSignalStack() {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const TSL = await import('../vendor/three/build/three.tsl.js');
  const utils = loadModule(readSource('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), {
    imports: { '../../../build/three.core.js': THREE },
  });
  const atlas = loadModule(readSource('js/live-signal-atlas.js'), {
    globals: { Float32Array },
    imports: { 'three/webgpu': THREE },
  });
  const feedSource = readSource('js/live-signal-feed.js')
    .replaceAll('import.meta.url', '"https://example.test/js/live-signal-feed.js"');
  const feed = loadModule(feedSource, {
    globals: { URL, Date, setInterval, clearInterval, setTimeout },
    imports: { './live-signal-atlas.js': atlas },
    filename: 'live-signal-feed.js',
  });
  const materials = loadModule(readSource('js/live-led-signal-material.js'), {
    imports: { 'three/webgpu': THREE, 'three/tsl': TSL },
  });
  const builders = loadModule(readSource('js/live-signal-builders.js'), {
    globals: { Float32Array, Date },
    imports: {
      'three/webgpu': THREE,
      'three/addons/utils/BufferGeometryUtils.js': utils,
      './live-signal-atlas.js': atlas,
      './live-led-signal-material.js': materials,
      './live-signal-feed.js': feed,
    },
  });
  return { THREE, TSL, atlas, feed, materials, builders };
}

test('NDW MSI legend parser maps A01-*, F01, F02, F08, and J33 codes to valid atlas UV rects and flasher masks', async () => {
  const { atlas, feed } = await loadLiveSignalStack();
  const { parseMsiLegendCode, MSI_LEGEND_CODES, MSI_UV_RECTS } = atlas;

  const seenRects = new Set();
  for (const code of MSI_LEGEND_CODES) {
    const parsed = parseMsiLegendCode(code);
    assert.equal(parsed.code, code);
    assert.deepEqual(parsed.uvRect, MSI_UV_RECTS[code]);
    const [u, v, du, dv] = parsed.uvRect;
    assert.ok(u >= 0 && u + du <= 1 + 1e-9, `${code} u bounds`);
    assert.ok(v >= 0 && v + dv <= 1 + 1e-9, `${code} v bounds`);
    assert.ok(du > 0 && dv > 0, `${code} positive UV cell size`);
    const rectKey = parsed.uvRect.join(',');
    assert.ok(!seenRects.has(rectKey), `duplicate UV rect for ${code}`);
    seenRects.add(rectKey);
  }

  // Speed limits A01-50..100
  for (const speed of [50, 70, 80, 90, 100]) {
    const parsed = parseMsiLegendCode(`A01-${speed}`);
    assert.equal(parsed.speedLimitKmh, speed);
    assert.equal(parsed.flasherMask, 0);
    assert.equal(parsed.laneClosed, false);
    assert.equal(parseMsiLegendCode(String(speed)).code, `A01-${speed}`);
  }

  // Lane closures, merges, end-of-restrictions, and queue warning
  assert.equal(parseMsiLegendCode('F01').laneClosed, true);
  assert.equal(parseMsiLegendCode('F01').flasherMask, 1);
  assert.equal(parseMsiLegendCode('F02', 'left').code, 'F02-L');
  assert.equal(parseMsiLegendCode('F02', 'left').mergeDirection, 'left');
  assert.equal(parseMsiLegendCode('F02', 'left').flasherMask, 1);
  assert.equal(parseMsiLegendCode('F02', 'right').code, 'F02-R');
  assert.equal(parseMsiLegendCode('F02', 'right').mergeDirection, 'right');
  assert.equal(parseMsiLegendCode('F02', 'right').flasherMask, 1);
  assert.equal(parseMsiLegendCode('F08').flasherMask, 0);
  assert.equal(parseMsiLegendCode('J33').flasherMask, 1);

  // XML DATEX II VmsPublication parsing
  const gantryId = liveSignalsAsset.msiGantries[0].id;
  const xml = `
    <VmsPublication>
      <vmsUnit id="${gantryId}">
        <vms><laneNumber>1</laneNumber><pictogramDescription>F01</pictogramDescription></vms>
        <vms><laneNumber>2</laneNumber><pictogramDescription>A01-70</pictogramDescription><flashingBeacon>true</flashingBeacon></vms>
      </vmsUnit>
    </VmsPublication>`;
  const parsedXml = feed.parseNdwMsiXml(xml, 1_000_000);
  assert.equal(parsedXml.length, 2);
  assert.equal(parsedXml[0].legend, 'F01');
  assert.equal(parsedXml[0].flasherMask, 1);
  assert.equal(parsedXml[1].legend, 'A01-70');
  assert.equal(parsedXml[1].flasherMask, 1);
});

test('VRI state controller prevents conflicting green phases and falls back smoothly when live SPaT is unavailable', async () => {
  const { feed } = await loadLiveSignalStack();
  let now = 1_700_000_000_000;
  const controller = feed.createLiveSignalController(liveSignalsAsset, { now: () => now });

  // 1. Verify deterministic fallback never sets conflicting axes to green/amber simultaneously across a full cycle.
  for (let t = 0; t < 60; t += 0.5) {
    controller.update(t, now, { nightFactor: 0.1 });
    for (const inter of liveSignalsAsset.vriIntersections) {
      let axis0Go = false;
      let axis1Go = false;
      for (const sg of inter.signalGroups) {
        if (sg.kind !== 'motor') continue;
        const st = controller.getVriGroupState(inter.id, sg.signalGroupId).state;
        const active = feed.isGreenSpatState(st) || feed.isAmberSpatState(st);
        if (active) {
          if (sg.axis === 0) axis0Go = true;
          else axis1Go = true;
        }
      }
      assert.ok(!(axis0Go && axis1Go), `Conflict detected at ${inter.id} t=${t}s`);
    }
  }

  // 2. Inject a malformed live SPaT update requesting BOTH axis 0 and axis 1 green on the same intersection.
  const multiAxis = liveSignalsAsset.vriIntersections.find(inter => {
    const axes = new Set(inter.signalGroups.filter(sg => sg.kind === 'motor').map(sg => sg.axis));
    return axes.has(0) && axes.has(1);
  });
  assert.ok(multiAxis, 'Expected at least one multi-axis VRI intersection in Ede');

  const sg0 = multiAxis.signalGroups.find(sg => sg.kind === 'motor' && sg.axis === 0);
  const sg1 = multiAxis.signalGroups.find(sg => sg.kind === 'motor' && sg.axis === 1);

  controller.applySpatSnapshot({
    vri: [{
      intersectionId: multiAxis.id,
      expiresAt: now + 10_000,
      signalGroups: [
        { signalGroupId: sg0.signalGroupId, state: 'PROTECTED_MOVEMENT_ALLOWED', likelyTime: 8.5 },
        { signalGroupId: sg1.signalGroupId, state: 'PROTECTED_MOVEMENT_ALLOWED', likelyTime: 8.5 },
      ],
    }],
  }, now);

  controller.update(10, now);
  assert.equal(controller.getVriGroupState(multiAxis.id, sg0.signalGroupId).state, feed.SPAT_STATES.PROTECTED_MOVEMENT_ALLOWED);
  assert.equal(controller.getVriGroupState(multiAxis.id, sg1.signalGroupId).state, feed.SPAT_STATES.STOP_AND_REMAIN);
  assert.ok(controller.stats.conflictInterventions >= 1);

  // 3. Advance wall clock past SPaT expiry and verify smooth fallback to deterministic controller.
  now += 20_000;
  controller.update(12, now);
  assert.equal(controller.getVriGroupState(multiAxis.id, sg0.signalGroupId).source, 'fallback');

  // 4. Verify late-night flashing amber on minor junctions.
  const minor = liveSignalsAsset.vriIntersections.find(inter => inter.minor);
  if (minor) {
    controller.update(15, now, { localHour: 2.0 });
    const motorSg = minor.signalGroups.find(sg => sg.kind === 'motor');
    assert.equal(controller.getVriGroupState(minor.id, motorSg.signalGroupId).state, feed.SPAT_STATES.FLASHING_AMBER);
  }
});

test('instance buffers update in-place without GPU buffer reallocation and stay well within 16.7 ms frame budget', async () => {
  const { THREE, feed, builders } = await loadLiveSignalStack();
  const scene = new THREE.Scene();
  let now = 1_700_000_000_000;
  const controller = feed.createLiveSignalController(liveSignalsAsset, { now: () => now });
  const system = builders.buildLiveSignalSystem(scene, controller, {
    includeVriHardware: true,
    uploadHz: 15,
  });

  assert.equal(system.stats.msiInstances, liveSignalsAsset.counts.msiHeads);
  assert.ok(system.stats.vriLenses > 0);
  assert.ok(system.msiFaceMesh.isInstancedMesh);
  assert.ok(system.vriLensMesh.isInstancedMesh);

  // Snapshot underlying TypedArray references before updates.
  const msiUvRef = system.msiBuffers.uvAttr.array;
  const msiFlashRef = system.msiBuffers.flashAttr.array;
  const msiBrightRef = system.msiBuffers.brightAttr.array;
  const vriUvRef = system.vriBuffers.uvAttr.array;
  const vriFlashRef = system.vriBuffers.flashAttr.array;
  const vriBrightRef = system.vriBuffers.brightAttr.array;

  // Apply a live MSI update to verify it propagates into the in-place buffer.
  const firstGantry = liveSignalsAsset.msiGantries[0];
  controller.applyMsiSnapshot({
    msi: [{ gantryId: firstGantry.id, laneIndex: 1, legend: 'F01', expiresAt: now + 60_000 }],
  }, now);

  // Run 60 frames (~4 full seconds at 15 Hz syncs) and measure worst/average frame update time.
  const iterations = 60;
  let maxFrameMs = 0;
  const startTotal = performance.now();
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    system.update(1 / 15, i * (1 / 15), now + i * 67, {
      sunElevationY: 0.35,
      nightFactor: 0.1,
      trafficDemand: 0.85,
    });
    const elapsedMs = performance.now() - t0;
    if (elapsedMs > maxFrameMs) maxFrameMs = elapsedMs;
  }
  const avgFrameMs = (performance.now() - startTotal) / iterations;

  // Exact same Float32Array instances -> zero GPU buffer reallocations.
  assert.strictEqual(system.msiBuffers.uvAttr.array, msiUvRef);
  assert.strictEqual(system.msiBuffers.flashAttr.array, msiFlashRef);
  assert.strictEqual(system.msiBuffers.brightAttr.array, msiBrightRef);
  assert.strictEqual(system.vriBuffers.uvAttr.array, vriUvRef);
  assert.strictEqual(system.vriBuffers.flashAttr.array, vriFlashRef);
  assert.strictEqual(system.vriBuffers.brightAttr.array, vriBrightRef);

  // Confirm F01 flasher mask & brightness propagated into slot 0.
  assert.equal(system.msiBuffers.flashArray[0], 1);
  assert.equal(system.msiBuffers.brightArray[0], 1);
  assert.equal(system.stats.syncCount, iterations);

  // Confirm well within the 16.7 ms frame budget (average & worst-case).
  assert.ok(avgFrameMs < 16.7, `Average update ${avgFrameMs.toFixed(2)} ms exceeded 16.7 ms budget`);
  assert.ok(maxFrameMs < 16.7, `Max update ${maxFrameMs.toFixed(2)} ms exceeded 16.7 ms budget`);

  system.dispose();
});
