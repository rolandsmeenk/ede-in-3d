// Start an isolated Chrome with --remote-debugging-port=9297 and serve the checkout locally.
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const [output = '/tmp/ede-benchmark.json', origin = 'http://127.0.0.1:8990', port = '9297', ...variants] = process.argv.slice(2);
const repeats = Number(process.env.EDE_BENCH_RUNS || 3);
const frameCount = Number(process.env.EDE_BENCH_FRAMES || 75);
const startupOnly = process.env.EDE_BENCH_STARTUP_ONLY === '1';
const freezeTraffic = process.env.EDE_BENCH_TRAFFIC !== 'active';
const viewport = { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false };
const freezeClock = Date.parse('2026-11-19T13:00:00+01:00');

// [x, metres above the AHN ground, z] in the Oude Kerk scene coordinate frame.
const shots = [
  { name: 'station', from: [36, 4, 2102], to: [85, 4, 2119], look: [154, 2, 2170] },
  { name: 'kuiperplein', from: [-246, 4, 108], to: [-218, 4, 92], look: [-192, 2, 108] },
  { name: 'kolkakkerweg', from: [-910, 3, 866], to: [-831, 3, 854], look: [-754, 2, 842] },
  { name: 'helicopter', from: [-665, 148, 406], to: [-156, 166, 114], look: [8, 8, -16] },
  { name: 'camera jump', from: [85, 4, 2119], to: [-831, 3, 854], look: [-754, 2, 842], jump: true },
];

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
const target = pages.find(page => page.type === 'page');
if (!target) throw new Error('Open a tab in the isolated Chrome instance.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0, wireBytes = 0;
const pending = new Map();
const failures = [];
socket.addEventListener('message', ({ data }) => {
  const reply = JSON.parse(data);
  if (pending.has(reply.id)) {
    pending.get(reply.id)(reply);
    pending.delete(reply.id);
  }
  if (reply.method === 'Network.loadingFinished') wireBytes += reply.params.encodedDataLength;
  if (reply.method === 'Runtime.exceptionThrown') failures.push(reply.params.exceptionDetails.text);
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, ({ error, result }) => error ? reject(new Error(error.message)) : resolve(result));
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(result.description || exceptionDetails.text);
  return result.value;
}

async function playable() {
  for (let i = 0; i < 360; i++) {
    const state = await evaluate(`window.__slopwaw?.ready ? {
      ms: __slopwaw.firstFrameAt, stages: __slopwaw.init, backend: __slopwaw.backend,
      quality: __slopwaw.graphics?.quality,
      bagMeshes: __slopwaw.scene.getObjectByName('bag3d-buildings')?.children.length ?? 0
    } : null`);
    if (state) return state;
    await delay(250);
  }
  throw new Error(await evaluate("document.querySelector('#loading-status')?.textContent || 'Game did not start'"));
}

function sampleShot(shot, frames) {
  return evaluate(`(${async (shot, frames, freezeTraffic) => {
    const app = window.__slopwaw;
    const { terrainHeightAt } = await import('./js/terrain.js');
    const frame = () => new Promise(requestAnimationFrame);
    const ground = ([x, y, z]) => [x, y + terrainHeightAt(x, z), z];
    const wait = async count => { for (let i = 0; i < count; i++) await frame(); };
    const from = ground(shot.from), to = ground(shot.to), look = ground(shot.look);
    app.time('midday');
    app.setCamera(...from, ...look);
    if (app.perf) app.perf.setTrafficUpdates(true);
    await wait(36);
    const trafficUpdate = app.trafficSystem.update, trainUpdate = app.trainSystem?.update;
    if (app.perf) app.perf.setTrafficUpdates(!freezeTraffic);
    else if (freezeTraffic) {
      app.trafficSystem.update = () => {};
      if (app.trainSystem) app.trainSystem.update = () => {};
    }
    app.perf?.reset();
    const times = [], draws = [], triangles = [];
    let last = await frame();
    for (let i = 1; i <= frames; i++) {
      const t = shot.jump ? 1 : i / frames;
      const xyz = from.map((p, k) => p + (to[k] - p) * t);
      if (shot.jump && i === 1) app.setCamera(...to, ...look);
      else app.cameraSystem.fixedPos.set(...xyz);
      const now = await frame();
      times.push(now - last);
      last = now;
      draws.push(app.renderer.info.render.drawCalls);
      triangles.push(app.renderer.info.render.triangles);
    }
    const stats = a => {
      a.sort((a, b) => a - b);
      return { median: a[Math.ceil(a.length * 0.5) - 1], p95: a[Math.ceil(a.length * 0.95) - 1], max: a.at(-1) };
    };
    const profiler = await app.perf?.report();
    if (app.perf) app.perf.setTrafficUpdates(true);
    else {
      app.trafficSystem.update = trafficUpdate;
      if (app.trainSystem) app.trainSystem.update = trainUpdate;
    }
    const bag = app.scene.getObjectByName('bag3d-buildings')?.userData.stats;
    return { frameMs: stats(times), drawCalls: stats(draws), triangles: stats(triangles), profiler, bag };
  }})(${JSON.stringify(shot)}, ${frames}, ${freezeTraffic})`);
}

async function run(search, cache) {
  if (cache === 'cold') await send('Network.clearBrowserCache');
  const url = new URL(origin);
  url.search = search;
  if (url.searchParams.get('perf') === '1') url.searchParams.set('bench', '1');
  await send('Page.navigate', { url: 'about:blank' });
  wireBytes = 0;
  failures.length = 0;
  const memory = { jsHeap: 0, backingStorage: 0, combined: 0 };
  let done = false;
  const sampleMemory = (async () => {
    while (!done) {
      const { usedSize, backingStorageSize = 0 } = await send('Runtime.getHeapUsage');
      memory.jsHeap = Math.max(memory.jsHeap, usedSize);
      memory.backingStorage = Math.max(memory.backingStorage, backingStorageSize);
      memory.combined = Math.max(memory.combined, usedSize + backingStorageSize);
      await delay(200);
    }
  })();
  try {
    await send('Page.navigate', { url: url.href });
    const startup = await playable();
    startup.wireBytes = wireBytes;
    startup.peakMemory = { ...memory };
    const samples = [];
    if (!startupOnly && cache === 'warm') {
      for (const shot of shots) samples.push({ name: shot.name, ...await sampleShot(shot, frameCount) });
    }
    return { search, cache, startup, peakMemory: memory, wireBytes, samples, errors: [...failures] };
  } finally {
    done = true;
    await sampleMemory;
  }
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
  await send('Emulation.setDeviceMetricsOverride', viewport);
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    if (!location.protocol.startsWith('http')) return;
    localStorage.removeItem('slop-ede-player-state');
    Date.now = () => ${freezeClock};
    let seed = 0x45de;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  })()` });
  const results = [];
  for (let trial = 0; trial < repeats; trial++) {
    const choices = variants.length ? variants : ['perf=1&quality=standard', 'perf=1'];
    for (const search of trial % 2 ? [...choices].reverse() : choices) {
      for (const cache of ['cold', 'warm']) {
        const result = await run(search, cache);
        results.push({ trial, ...result });
        await writeFile(output, JSON.stringify({ viewport, freezeClock, freezeTraffic, results }, null, 2));
        console.log(`${search || 'default'} ${cache} ${Math.round(result.startup.ms)} ms`, result.samples.map(s => [s.name, s.frameMs.median, s.frameMs.p95]));
      }
    }
  }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
} finally {
  socket.close();
}
