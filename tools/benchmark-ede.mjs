// Start an isolated Chrome with --remote-debugging-port=9297 and serve the checkout locally.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [output = '/tmp/ede-benchmark.json', origin = 'http://127.0.0.1:8990', port = '9297', ...variants] = process.argv.slice(2);
const repeats = Number(process.env.EDE_BENCH_RUNS || 3);
const frameCount = Number(process.env.EDE_BENCH_FRAMES || 75);
const startupOnly = process.env.EDE_BENCH_STARTUP_ONLY === '1';
const cacheMode = process.env.EDE_BENCH_CACHE;
const caches = cacheMode === 'cold' || cacheMode === 'warm' ? [cacheMode] :
  process.env.EDE_BENCH_WARM_ONLY === '1' ? ['warm'] : ['cold', 'warm'];
const freezeTraffic = process.env.EDE_BENCH_TRAFFIC !== 'active';
const [width, height] = (process.env.EDE_BENCH_VIEWPORT || '1600x900').split('x').map(Number);
const viewport = { width, height, deviceScaleFactor: 1, mobile: false };
const freezeClock = Date.parse('2026-11-19T13:00:00+01:00');
const suite = process.env.EDE_BENCH_SCENARIOS || 'standard';
const screenshots = process.env.EDE_BENCH_SCREENSHOTS;
const tileDelay = Number(process.env.EDE_BENCH_TILE_DELAY_MS || 0);
const noHttpCache = process.env.EDE_BENCH_NO_HTTP_CACHE === '1';
const forceWebGL = process.env.EDE_BENCH_BACKEND === 'webgl';
const settleMs = Number(process.env.EDE_BENCH_SETTLE_MS ?? 600);
const expansionOnly = suite === 'expansion';
const municipalCoverage = suite === 'municipality-coverage';
if (screenshots) await mkdir(screenshots, { recursive: true });

function facadeWalk(name, a, b, distance, lookHeight) {
  const dx = b[0] - a[0], dz = b[1] - a[1], width = Math.hypot(dx, dz);
  const tx = dx / width, tz = dz / width;
  const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
  const at = (along, out) => [x + tx * along - tz * out, 1.65, z + tz * along + tx * out];
  return { name, from: at(-distance * 0.8, distance), to: at(distance * 0.6, distance * 0.75), look: [x, lookHeight, z], facade: true };
}

// [x, metres above the AHN ground, z] in the Oude Kerk scene coordinate frame.
const station = { name: 'station', from: [36, 4, 2102], to: [85, 4, 2119], look: [154, 2, 2170] };
const newLandmarks = suite === 'expansion-landmarks' ? (await Promise.all([
  import('../js/ede-ginkel-landmark-surveys.js').then(mod => mod.EDE_GINKEL_LANDMARKS),
  import('../js/ede-reemst-landmark-survey.js').then(mod => mod.EDE_REEMST_LANDMARKS),
  import('../js/ede-west-expansion-surveys.js').then(mod => mod.EDE_WEST_EXPANSION_LANDMARKS),
  import('../js/ede-zonneoord-surveys.js').then(mod => mod.EDE_ZONNEOORD_LANDMARKS),
])).flat() : suite === 'lunteren-landmarks'
  ? (await Promise.all([
    import('../js/ede-lunteren-survey.js').then(mod => mod.EDE_LUNTEREN_LANDMARKS),
    import('../js/ede-lunteren-school-sites.js').then(mod => mod.EDE_LUNTEREN_SCHOOL_LANDMARKS),
    import('../js/ede-lunteren-church-sites.js').then(mod => mod.LUNTEREN_CHURCH_SITES),
  ])).flat() : null;
const shots = newLandmarks ? newLandmarks.flatMap(site => {
  const { id, name, x, z, height, focusHeight, approach } = site;
  const dx = approach.x - x, dz = approach.z - z;
  const distance = Math.hypot(dx, dz);
  const cameraSeparation = Math.max(24, distance * 1.2) / distance;
  const altitude = Math.max(18, height * 1.65);
  const origin = [x + dx * cameraSeparation, altitude, z + dz * cameraSeparation];
  return [
    { name: name + ' approach', arrival: id, travel: ['person'] },
    { name: name + ' elevated', from: origin, to: [origin[0] - dz * 0.15, altitude, origin[2] + dx * 0.15],
      look: [x, focusHeight ?? Math.min(12, height / 2), z] },
  ];
}) : suite === 'lunteren' ? [
  { name: 'Lunteren centre', arrival: 'lunteren-centrum', travel: ['person'] },
  { name: 'Station Lunteren', arrival: 'station-lunteren', travel: ['person'] },
  { name: 'Goudsberg woodland approach', arrival: 'goudsberg', travel: ['person'] },
  { name: 'De Valouwe trailhead', arrival: 'de-valouwe', travel: ['person'] },
  { name: 'Wekeromse Zand trailhead', arrival: 'wekeromse-zand', travel: ['person'] },
  { name: 'Stationsstraat drive', travel: ['car', -3343.7, -4314.3, 1.75] },
  { name: 'Edeseweg cycle', travel: ['cyclist', 2099.2, -5751.8, -0.206] },
  { name: 'A30 Lunteren drive', travel: ['car', -4937.1, -3647.1, -2.757] },
  { name: 'Lunteren to Goudsberg helicopter', from: [-3280, 65, -4310], to: [-1757, 38, -6218],
    look: [-3235, 1, -4450], lookTo: [-1734, 1, -6112] },
  { name: 'Lunteren to Wekeromse Zand jump', from: [-3480, 4, -4265], to: [1482, 52, -5740],
    look: [1720, 1, -5830], jump: true },
] : expansionOnly ? [
  { name: 'Doesburgermolen approach', arrival: 'doesburgermolen', travel: ['person'] },
  { name: 'Veenendaal-De Klomp rail and forecourt', arrival: 'veenendaal-de-klomp',
    from: [-5280, 24, 384], to: [-6600, 15, 10], look: [-6150, 1, 180], lookTo: [-6682, 3, 6] },
  { name: 'N224 to Ginkelse Heide', from: [1990, 22, 240], to: [4245, 17, 961],
    look: [3190, 5, 690], lookTo: [4352, 6, 1000], changeSeason: true },
  { name: 'Ginkelse Heide sheepfold walk', arrival: 'schaapskooi-ginkelse-heide', travel: ['person'] },
  { name: 'Juffrouw Tok arrival', arrival: 'juffrouw-tok', travel: ['person'] },
  { name: 'De Mossel woodland landing', arrival: 'mossel',
    from: [4790, 85, -1240], to: [6151, 2.5, -1802], look: [5450, 6, -1280], lookTo: [6167, 4, -1817] },
  { name: 'Planken Wambuis approach', arrival: 'planken-wambuis',
    from: [6590, 20, 1450], to: [7842, 2.5, 1681], look: [7300, 3, 1590], lookTo: [7856, 5, 1704] },
] : suite === 'bag' ? [
  { name: 'Fast helicopter pass', from: [-1400, 95, 660], to: [-515, 95, 848],
    look: [-940, 18, 860], lookTo: [-140, 17, 1035], waitForBag: true },
] : municipalCoverage ? [
  { name: 'Oude Kerk walking control', travel: ['person', -37, 20.02, 1.214] },
  { name: 'Wekerom coverage control', from: [2600, 32, -7350], to: [2720, 37, -7358], look: [2740, 2, -7340] },
  { name: 'Harskamp drive', roadArrival: ['car', 5494, -9250] },
  { name: 'Bennekom walk', roadArrival: ['person', 339, 5154] },
  { name: 'Former cutoff flight', from: [2600, 100, -6830], to: [5494, 90, -9250], look: [5750, 4, -9410], jump: true },
  { name: 'Hoenderloo eastward flight', from: [13780, 100, -7600], to: [13929, 100, -7681],
    look: [14650, 5, -7690], lookTo: [15150, 5, -7800] },
  { name: 'Veenendaal gray building fringe', from: [-6540, 130, 155], to: [-6770, 140, 140],
    look: [-7530, 8, 130], lookTo: [-7650, 8, 150] },
] : suite === 'municipal' ? [
  { name: 'De Oude Hofstede walk', from: [-594, 1.65, 3344], to: [-590, 1.65, 3350], look: [-578, 1.25, 3371] },
  { name: 'De Oude Hofstede aerial', from: [-624, 39, 3356], to: [-617, 27, 3360], look: [-577, 1, 3379] },
  { name: 'Proosdijpark walk', from: [-1363, 1.65, 596], to: [-1367, 1.65, 589], look: [-1382, 1.2, 582] },
  { name: 'Proosdijpark aerial', from: [-1430, 37, 618], to: [-1418, 25, 613], look: [-1383, 1, 581] },
  { name: 'Residential litter bins', from: [-857, 1.65, 773], to: [-854.5, 1.65, 779.2], look: [-853.1, 0.6, 784] },
  { name: 'HEMA shopping walk', from: [-73, 1.65, 82], to: [-69, 1.65, 77], look: [-64.3, 0.72, 77.7] },
  { name: 'Kuiperplein ACV cluster', from: [-293.4, 1.65, 18.3], to: [-294.5, 1.65, 19.6], look: [-298.85, 0.68, 21.92] },
] : suite === 'trees' ? [
  { name: 'Low helicopter pass', from: [335, 22, 777], to: [446, 24, 708], look: [641, 16, 608] },
  { name: 'Climb through old cutoff', from: [668, 17, 768], to: [686, 80, 738], look: [909, 16, 558] },
  { name: 'Fast sideways pan', from: [852, 55, 632], to: [895, 56, 630], look: [525, 15, 649], lookTo: [1110, 12, 576], pan: true },
  { name: 'Woodland landing', from: [1094, 96, 1503], to: [1010, 2.0, 1469], look: [944, 3.5, 1394] },
  { name: 'De Vuurvogel walk', from: [-769, 1.66, 767], to: [-766, 1.66, 771], look: [-754, 4, 783] },
  { name: 'N224 provincial trees', from: [321, 5, -539], to: [425, 5, -484], look: [585, 9, -389] },
  { name: 'Season change', from: [-769, 1.66, 767], to: [-769, 1.66, 767], look: [-754, 4, 783], changeSeason: true },
] : suite === 'landmarks' ? [
  { name: 'Hoekelum bridge', from: [330, 1.7, 3443], to: [338, 1.7, 3427], look: [352, 5, 3393] },
  { name: 'NIZO entrance', from: [-639, 1.7, -636], to: [-623, 1.7, -643], look: [-631, 5, -671] },
  { name: 'NIZO from above', from: [-520, 79, -640], to: [-541, 72, -654], look: [-650, 6, -733] },
  { name: 'Hospital entrance', from: [-1663, 1.7, 2653], to: [-1680, 1.7, 2631], look: [-1746, 5, 2613] },
  { name: 'Hospital from above', from: [-1558, 97, 2730], to: [-1590, 87, 2700], look: [-1777, 11, 2625] },
  { name: 'De Eder Kuil', from: [468, 1.7, 681], to: [485, 1.7, 668], look: [520, 3.5, 628] },
  { name: 'De ReeHorst', from: [7, 1.7, 2400], to: [5, 1.7, 2424], look: [-40, 5, 2407] },
  { name: 'Buitenzorg', from: [-261, 1.7, -309], to: [-268, 1.7, -326], look: [-294, 5, -293] },
  { name: 'Johannus', from: [-3140, 1.7, 2059], to: [-3122, 1.7, 2058], look: [-3053, 6, 2077] },
  { name: 'Technova', from: [-662, 1.7, 2748], to: [-685, 1.7, 2743], look: [-640, 5, 2701] },
  { name: 'Gasfabriek', from: [-448, 1.7, 705], to: [-427, 1.7, 699], look: [-431, 5, 668] },
  { name: 'Tesqua courts', from: [-2056, 55, 1346], to: [-2025, 47, 1360], look: [-1903, 5, 1344] },
] : suite === 'facades' ? [
  facadeWalk('Kolkakkerweg terraced houses', [-495.26, 678.68], [-492.83, 684.06], 7, 2.6),
  facadeWalk('Kolkakkerweg apartments', [-468.49, 777.45], [-488.63, 787.81], 13, 3.6),
  facadeWalk('Torenstraat storefront', [-44.66, -5.50], [-55.49, -10.00], 7, 2.4),
  facadeWalk('Oude Kerk west entrance', [-24.63, -13.35], [-27.15, -3.66], 9, 4.6),
  facadeWalk('Shopping street', [-86.95, -23.08], [-99.42, -28.27], 9, 3.0),
] : suite === 'lane-fits' ? [
  { name: 'Maanderbroek A12 east', way: 'w750476158', from: [-4256, 2.4, 2138], to: [-4216, 2.4, 2164], look: [-4137, 2, 2216] },
  { name: 'Maanderbroek A30', from: [-4174, 10, 2190], to: [-4168, 8, 2138], look: [-4166, 1.5, 2083] },
  { name: 'A12 exit 24', way: 'w723962249', from: [-1386, 2.4, 3481], to: [-1420, 2.4, 3476], look: [-1455, 2.2, 3470] },
  { name: 'Akulaan turn pocket', from: [149, 4.5, 2289], to: [115, 4.5, 2280], look: [70, 2, 2268] },
  { name: 'Nachtegaallaan', from: [-800, 3, 779], to: [-762, 3, 770], look: [-724, 2, 759] },
  { name: 'Frans Halslaan', way: 'w840619077', from: [-1430, 3, 3235], to: [-1460, 3, 3239], look: [-1480, 2, 3243] },
  { name: 'Albertstunnel', way: 'w6952984', from: [105, 2.4, 2012], to: [101, 2.4, 2041], look: [101, 1.6, 2086] },
] : suite === 'town-detail' ? [
  { name: 'Oude Kerkplein walk', travel: ['person', -37, 20.02, 1.214] },
  { name: 'Victoriavijver bank walk', travel: ['person', -1553.7, 697.58, 3.025] },
  { name: 'Kolkakkerweg cycle', travel: ['cyclist', -893, 863.2, 1.736] },
  { name: 'Polar Bearsplein walk', travel: ['person', 186.5, 2164, -0.256] },
  { name: 'Albertstunnel cycle', way: 'w25098905', travel: ['cyclist', 98.17, 2041.51, -0.084] },
  { name: 'Albertstunnel drive', travel: ['car', 104.1, 2042, -0.09, -6.69] },
  { name: 'Sysseltsepad bridge cycle', way: 'w1115504037', travel: ['cyclist', 772.46, 2219.37, 0.25] },
  { name: 'A30 Maanderbroek drive', travel: ['car', -4173.75, 2155, -0.04, -7.35] },
] : suite === 'motorway' ? [
  { name: 'Maanderbroek A12 east', way: 'w750476158', from: [-4256, 2.4, 2138], to: [-4216, 2.4, 2164], look: [-4137, 2, 2216] },
  { name: 'Maanderbroek A12 west', way: 'w493246904', from: [-3976, 2.4, 2303], to: [-4016, 2.4, 2278], look: [-4122, 2, 2209] },
  { name: 'De Poortwachter upper north', way: 'w6921137', from: [-1397, 2.2, 3534], to: [-1402, 2.2, 3503], look: [-1409, 2, 3452] },
  { name: 'De Poortwachter upper south', way: 'w25551033', from: [-1429, 2.2, 3455], to: [-1424, 2.2, 3486], look: [-1415, 2, 3548], time: 'midnight' },
  { name: 'De Poortwachter lower east', way: 'w723962252', from: [-1450, 2.2, 3487], to: [-1419, 2.2, 3491], look: [-1375, 2, 3498] },
  { name: 'De Poortwachter lower west', way: 'w723962249', from: [-1386, 2.2, 3481], to: [-1418, 2.2, 3477], look: [-1446, 2, 3472], time: 'midnight' },
  { name: 'A12 Ede exit approach', way: 'w1212023125', from: [-1434, 2.4, 3664], to: [-1404, 2.4, 3666], look: [-1396, 2.2, 3666] },
  { name: 'A12 Ede exit on-ramp', way: 'w1121900829', from: [-1403, 2.4, 3650], to: [-1432, 2.4, 3649], look: [-1455, 2.2, 3648] },
  { name: 'A30 Ede-Noord south', way: 'w6960119', from: [-3599, 2.4, 39], to: [-3602, 2.4, 85], look: [-3604, 2.2, 114] },
  { name: 'A30 Ede-Noord north', way: 'w6960136', from: [-3590, 2.4, 92], to: [-3587, 2.4, 47], look: [-3585, 2.2, 24] },
] : suite === 'parcel-map' ? [
  { name: 'Kernhem aerial pass', from: [-3410, 122, -302], to: [-2972, 122, -422],
    look: [-3272, 1, -465], lookTo: [-2960, 1, -560] },
  { name: 'Kolkakkerweg residential walk', from: [-881, 1.7, 861.2], to: [-840, 1.7, 855.2],
    look: [-863.3, 1.0, 852.1], lookTo: [-824.7, 1.0, 845.6] },
  { name: 'Frankeneng business perimeter', from: [-3253, 2.3, 1314.8], to: [-3274, 2.3, 1316.7],
    look: [-3255.2, 1.1, 1303.5], lookTo: [-3269.5, 1.1, 1302.2] },
  { name: 'De Klomp aerial jump', from: [-6920, 40, -18], to: [-6795, 34, 20],
    look: [-6840, 1.7, -53], lookTo: [-6745, 1.7, -5] },
] : suite === 'parcels' ? [
  { name: 'Bemmelsewaard walking view', from: [-3198, 1.65, -446], to: [-3128, 1.65, -436],
    look: [-3192, 1.1, -455], lookTo: [-3133, 1.1, -448] },
  { name: 'Kelvinstraat parcel view', from: [-3128, 2, 1834], to: [-3154, 2, 1804],
    look: [-3156, 1.8, 1824], lookTo: [-3195, 1.8, 1799] },
  { name: 'Kelvinstraat drive', travel: ['car', -3145, 1864, 0.04] },
  { name: 'Kernhem aerial pass', from: [-3410, 122, -302], to: [-2972, 122, -422],
    look: [-3272, 1, -465], lookTo: [-2960, 1, -560] },
  { name: 'Asakkerweg transformer house', from: [145.6, 1.65, -781.5], to: [144, 1.65, -779.5],
    look: [136.045, 2.55, -781.052] },
  { name: 'Oranjelaan transformer house', from: [-57.0, 1.65, 2077.0], to: [-55.8, 1.65, 2075.4],
    look: [-55.968, 2.1, 2065.198] },
] : suite === 'detail' ? [
  { name: 'Oude Kerkplein walk', travel: ['person', -37, 20.02, 1.214] },
  { name: 'Kolkakkerweg cycle', travel: ['cyclist', -893, 863.2, 1.736] },
  { name: 'A30 Maanderbroek drive', travel: ['car', -4173.75, 2155, -0.04, -7.35] },
  { name: 'A12 Edeseweg drive', travel: ['car', 125, 3709.5, -1.72, 0.63] },
] : suite === 'ahn' ? [
  { name: 'bospoorttunnel', from: [153, 3, -623], to: [119, 2.5, -632], look: [106, 0.8, -615] },
  { name: 'stadspoort', from: [-1462, 3, 3178], to: [-1458, 2.5, 3145], look: [-1457, 1.2, 3116] },
  station,
  { name: 'raadhuisstraat', from: [169, 2.5, -10], to: [173, 2.5, 12], look: [177, 1.4, 28] },
  { name: 'albertstunnel drive', travel: ['car', 104.1, 2042, -0.09, -6.69] },
  { name: 'camera jump', from: [85, 4, 2119], to: [173, 2.5, 12], look: [177, 1.4, 28], jump: true },
] : [
  station,
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
    const state = await evaluate(`(() => {
      const app = window.__slopwaw;
      if (!app?.ready) return null;
      const detail = app.importedDetail?.stats;
      return {
        ms: app.firstFrameAt, stages: app.init, backend: app.backend, quality: app.graphics?.quality,
        bagMeshes: app.scene.getObjectByName('bag3d-buildings')?.children.length ?? 0,
        ...(app.exteriorBag && { exteriorBag: { ...app.exteriorBag } }),
        terrainTiles: app.terrainTiles && { ...app.terrainTiles }, forestCanopy: app.forestCanopy && { ...app.forestCanopy },
        trees: app.treeInventory && {...app.treeInventory, planted: app.treeStats?.trees},
        detail: detail && { bgt: detail.bgt, municipal: detail.municipal, motorway: detail['1gis'] ?? detail.dtb, signs: detail.nbd,
          parcel: detail.parcel, utility: detail.utility, unresolved: detail.unresolved.length },
      };
    })()`);
    if (state) return state;
    await delay(250);
  }
  throw new Error(await evaluate("document.querySelector('#loading-status')?.textContent || 'Game did not start'"));
}

function sampleShot(shot, frames) {
  return evaluate(`(${async (shot, frames, freezeTraffic, treeAudit, coverageAudit, settleMs) => {
    const app = window.__slopwaw;
    const { terrainHeightAt, getExpansionTerrain } = await import('./js/terrain.js');
    const shotStarted = performance.now();
    if (shot.roadArrival) {
      const { nearestDrivingPoint } = await import('./js/city-config.js');
      const [mode, x, z] = shot.roadArrival;
      const road = nearestDrivingPoint(x, z);
      if (!road || Math.hypot(road.x - x, road.z - z) > 125) {
        throw new Error(shot.name + ' is missing a nearby mapped road');
      }
      shot.travel = [mode, road.x, road.z, road.heading];
    }
    const { gradeWayAt } = await import('./js/ede-grade.js');
    const frame = () => new Promise(requestAnimationFrame);
    const ground = ([x, y, z]) => [x, y + ((shot.way && gradeWayAt(shot.way, x, z, 18)?.y) ?? terrainHeightAt(x, z)), z];
    const wait = async count => { for (let i = 0; i < count; i++) await frame(); };
    const controller = app.controllerManager;
    const from = shot.from && ground(shot.from), to = shot.to && ground(shot.to), look = shot.look && ground(shot.look);
    const lookTo = shot.lookTo && ground(shot.lookTo);
    app.time(shot.time || 'midday');
    if (shot.changeSeason) app.perf?.setTreeSeason?.('summer');
    let arrival;
    if (shot.arrival) {
      const loc = app.TELEPORT_LOCATIONS[shot.arrival];
      if (!loc?.focus) throw new Error('Missing scenic arrival ' + shot.arrival);
      app.mode('person');
      const destination = await app.teleport(shot.arrival);
      arrival = { x: destination.x, z: destination.z, clearance: Math.hypot(destination.x - loc.x, destination.z - loc.z) };
      if (arrival.clearance > 22) throw new Error(shot.arrival + ' failed to reach its mapped approach');
    }
    if (shot.travel && !shot.arrival) {
      const [mode, x, z, heading, height] = shot.travel;
      const deck = shot.way && gradeWayAt(shot.way, x, z, 4);
      app.mode(mode);
      const destination = controller.teleportActiveTo(x, z, heading, height ?? deck?.y);
      if (coverageAudit) {
        arrival = { x: destination.x, z: destination.z, clearance: Math.hypot(destination.x - x, destination.z - z) };
        if (shot.roadArrival && arrival.clearance > 22) throw new Error(shot.name + ' could not reach its mapped road');
      }
      app.cameraSystem.resetForTeleport();
      app.camera('chase');
    } else if (!shot.travel) app.setCamera(...from, ...look);
    if (app.perf) app.perf.setTrafficUpdates(true);
    const bagGroup = app.scene.getObjectByName('bag3d-buildings');
    const bagCoversLook = () => Boolean(bagGroup?.children.some(tile =>
      tile.children.some(mesh => {
        const box = mesh.geometry?.boundingBox;
        return box && look[0] >= box.min.x - 1 && look[0] <= box.max.x + 1
          && look[2] >= box.min.z - 1 && look[2] <= box.max.z + 1;
      })
    ));
    if (shot.facade) {
      const deadline = performance.now() + 5500;
      while (!bagCoversLook() && performance.now() < deadline) await frame();
    }
    if (shot.waitForBag) {
      const deadline = performance.now() + 18000;
      while (!(bagGroup?.userData.stats?.completed > 0) && performance.now() < deadline) await frame();
    }
    const streamsIdle = () => !(app.terrainTiles?.loading || app.forestCanopy?.loading || app.exteriorBag?.inFlight);
    const settle = async () => {
      const start = performance.now(), timeout = start + 8000;
      let idleSince = start;
      while (performance.now() < timeout) {
        await frame();
        if (!streamsIdle()) idleSince = performance.now();
        if (performance.now() - idleSince >= settleMs) return true;
      }
      return false;
    };
    let settled;
    if (coverageAudit && settleMs > 0) {
      if (shot.jump) {
        app.setCamera(...to, ...look);
        await settle();
        app.setCamera(...from, ...look);
      }
      settled = await settle();
    } else await wait(36);
    const bagAtStart = shot.waitForBag && bagGroup ? { ...bagGroup.userData.stats } : undefined;
    const streamedBytes = () => (bagGroup?.userData.stats?.geometryBytes ?? 0) +
      (app.terrainTiles?.residentBytes ?? 0) + (app.forestCanopy?.residentBytes ?? 0);
    let peakStreamedGeometryBytes = streamedBytes();
    const terrainGroup = coverageAudit && app.scene.getObjectByName('EdeTerrainQuadtree');
    const exteriorGroup = coverageAudit && app.scene.getObjectByName('ede-exterior-bag');
    let peakTerrainResidentBytes = app.terrainTiles?.residentBytes ?? 0;
    let exteriorBuildings = 0;
    const textureBytes = () => {
      const s = bagGroup?.userData.stats;
      return (s?.maskTextureBytes ?? 0) + (s?.photoTextureBytes ?? 0) + (s?.surfaceTextureBytes ?? 0);
    };
    let facadeTextureBytes = shot.facade ? textureBytes() : undefined;
    const trafficUpdate = app.trafficSystem.update, trainUpdate = app.trainSystem?.update;
    if (app.perf) app.perf.setTrafficUpdates(!freezeTraffic);
    else if (freezeTraffic) {
      app.trafficSystem.update = () => {};
      if (app.trainSystem) app.trainSystem.update = () => {};
    }
    app.perf?.reset();
    const times = [], draws = [], triangles = [];
    const visibleTrees = [], shadowBatches = [], qualityLevels = new Set();
    const treeStats = treeAudit ? app.treeStats : undefined;
    let uploads = treeStats?.uploadBytes ?? 0, uploadCells = treeStats?.uploadedCells ?? 0;
    let previousUpload = uploads, maxUpload = 0, maxTransitions = 0, biggestCountChange = 0;
    let seasonChangeFrame;
    let last = await frame();
    const start = shot.travel && controller.getActiveEntity().position.clone();
    const sampleCount = shot.travel ? frames * 2 : frames;
    if (shot.travel && !shot.arrival) controller.setTouchInput('forward', 0.75);
    for (let i = 1; i <= sampleCount; i++) {
      if (!shot.travel) {
        const t = shot.jump ? 1 : i / sampleCount;
        const xyz = from.map((p, k) => p + (to[k] - p) * t);
        if (shot.jump && i === 1) app.setCamera(...to, ...look);
        else app.cameraSystem.fixedPos.set(...xyz);
        if (lookTo) {
          const turn = shot.pan ? Math.max(0, Math.min(1, (t - 0.3) * 5)) : t;
          app.cameraSystem.fixedLook.set(...look.map((p, k) => p + (lookTo[k] - p) * turn));
        }
      }
      const saveChange = shot.changeSeason && i === Math.ceil(sampleCount / 2);
      if (saveChange) app.perf?.setTreeSeason?.('winter');
      const now = await frame();
      if (saveChange) seasonChangeFrame = now - last;
      times.push(now - last);
      last = now;
      draws.push(app.renderer.info.render.drawCalls);
      triangles.push(app.renderer.info.render.triangles);
      peakStreamedGeometryBytes = Math.max(peakStreamedGeometryBytes, streamedBytes());
      if (coverageAudit) {
        peakTerrainResidentBytes = Math.max(peakTerrainResidentBytes, app.terrainTiles?.residentBytes ?? 0);
        exteriorBuildings = Math.max(exteriorBuildings, exteriorGroup ? exteriorGroup.children.reduce(
          (count, mesh) => count + (mesh.userData.buildings ?? 0), 0) : 0);
      }
      if (treeStats) {
        const visible = treeStats.visibleTrees ?? 0;
        if (visibleTrees.length) biggestCountChange = Math.max(biggestCountChange, Math.abs(visible - visibleTrees.at(-1)));
        visibleTrees.push(visible);
        shadowBatches.push(treeStats.shadowBatches ?? 0);
        qualityLevels.add(treeStats.qualityLevel);
        const bytes = treeStats.uploadBytes ?? 0;
        maxUpload = Math.max(maxUpload, bytes - previousUpload);
        previousUpload = bytes;
        maxTransitions = Math.max(maxTransitions, treeStats.transitions ?? 0);
      }
      if (shot.facade && i % 10 === 0) facadeTextureBytes = Math.max(facadeTextureBytes, textureBytes());
    }
    if (shot.travel) controller.resetInput();
    const stats = a => {
      a.sort((a, b) => a - b);
      return { average: a.reduce((sum, x) => sum + x, 0) / a.length,
        median: a[Math.ceil(a.length * 0.5) - 1], p95: a[Math.ceil(a.length * 0.95) - 1], max: a.at(-1) };
    };
    const profiler = await app.perf?.report();
    if (app.perf) app.perf.setTrafficUpdates(true);
    else {
      app.trafficSystem.update = trafficUpdate;
      if (app.trainSystem) app.trainSystem.update = trainUpdate;
    }
    const coverage = treeStats ? {
      uploadBytes: (treeStats.uploadBytes ?? 0) - uploads,
      uploadJobs: (treeStats.uploadedCells ?? 0) - uploadCells,
      maxUpload, maxTransitions, biggestCountChange,
      visibleTrees: stats(visibleTrees), shadowBatches: stats(shadowBatches),
      qualityLevels: [...qualityLevels], lastVisibleByLod: treeStats.visibleByLod, seasonChangeFrame
    } : undefined;
    const bag = bagGroup?.userData.stats;
    const facadeRequests = shot.facade && performance.getEntriesByType('resource').flatMap(entry => {
      const path = new URL(entry.name).pathname;
      return path.startsWith('/assets/ede-facade') ? [path] : [];
    });
    const terrainRequests = coverageAudit && performance.getEntriesByType('resource').filter(entry =>
      entry.startTime >= shotStarted && new URL(entry.name).pathname.includes('/ede-terrain-tiles/'));
    const terrainCoverage = coverageAudit ? {
      settledBeforeSample: settled,
      manifestVersion: getExpansionTerrain()?.manifest.version ?? null,
      residentBytes: peakTerrainResidentBytes,
      transferBytes: terrainRequests.reduce((total, entry) => total + entry.transferSize, 0),
      requests: terrainRequests.length,
      visibleTiles: terrainGroup ? terrainGroup.children.filter(mesh => mesh.visible).length : 0,
    } : undefined;
    const exteriorBag = coverageAudit ? {
      ...app.exteriorBag, peakBuildings: exteriorBuildings,
      visibleTiles: exteriorGroup ? exteriorGroup.children.filter(mesh => mesh.visible).length : 0,
    } : undefined;
    const travelledMetres = start ? controller.getActiveEntity().position.distanceTo(start) : undefined;
    const drivenMetres = shot.travel?.[0] === 'car' ? travelledMetres : undefined;
    return { frameMs: stats(times), drawCalls: stats(draws), triangles: stats(triangles), profiler, bag, bagAtStart,
      travelledMetres, drivenMetres, coverage, arrival, terrainCoverage, exteriorBag, parcelTiles: app.parcelTiles && { ...app.parcelTiles }, peakStreamedGeometryBytes, terrainTiles: app.terrainTiles, forestCanopy: app.forestCanopy,
      ...(shot.facade && { bagCoversLook: bagCoversLook(), facadeTextureBytes,
        facadeRequests: [...new Set(facadeRequests)], textureCount: app.renderer.info.memory?.textures }) };
  }})(${JSON.stringify(shot)}, ${frames}, ${freezeTraffic}, ${suite === 'trees'}, ${municipalCoverage}, ${settleMs})`);
}

async function run(search, cache, trial) {
  if (cache === 'cold') await send('Network.clearBrowserCache');
  const absolute = /^https?:\/\//.test(search);
  const url = new URL(absolute ? search : origin);
  if (!absolute) url.search = search;
  if (url.searchParams.get('perf') === '1') url.searchParams.set('bench', '1');
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
    if (forceWebGL && startup.backend !== 'WebGL fallback') throw new Error(`Expected WebGL fallback, got ${startup.backend}`);
    startup.wireBytes = wireBytes;
    startup.peakMemory = { ...memory };
    const samples = [];
    if (!startupOnly && (cache === 'warm' || expansionOnly || municipalCoverage)) {
      for (const shot of shots) {
        samples.push({ name: shot.name, ...await sampleShot(shot, frameCount) });
        if (screenshots && ['facades', 'trees', 'municipal', 'municipality-coverage', 'expansion', 'parcels', 'parcel-map', 'expansion-landmarks', 'lunteren', 'lunteren-landmarks'].includes(suite)) {
          const label = shot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
          const variant = suite === 'trees'
            ? [url.port, url.searchParams.get('treeInventory'), url.searchParams.get('treeQuality'), url.searchParams.get('treeSeason'), trial].filter(v => v != null).join('-')
            : suite === 'municipal' ? [url.port, url.searchParams.get('municipalDetail') ?? 'on', trial].join('-')
              : ['parcels', 'parcel-map'].includes(suite) ? [url.searchParams.get('parcelDetail') ?? 'on', url.searchParams.get('parcelTiles') ?? 'on',
                url.searchParams.get('utilityDetail') ?? 'on', trial].join('-')
                : url.port;
          await writeFile(join(screenshots, `${variant}-${label}.jpg`), Buffer.from(data, 'base64'));
        }
      }
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
  await send('Page.bringToFront');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: noHttpCache });
  await send('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
  await send('Emulation.setDeviceMetricsOverride', viewport);
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    if (!location.protocol.startsWith('http')) return;
    if (${forceWebGL}) Object.defineProperty(navigator, 'gpu', { value: undefined });
    localStorage.removeItem('slop-ede-player-state');
    if (${municipalCoverage} || ${JSON.stringify(suite)} === 'facades') performance.setResourceTimingBufferSize(3000);
    const delay = ${tileDelay};
    if (delay > 0) {
      const request = window.fetch.bind(window);
      window.fetch = async (input, ...args) => {
        const url = String(input?.url ?? input);
        if (/\\/ede-(?:terrain-tiles|forest-canopy)\\/\\d+_-?\\d+_-?\\d+\\.bin$/.test(url)) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        return request(input, ...args);
      };
    }
    Date.now = () => ${freezeClock};
    let seed = 0x45de;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  })()` });
  const results = [];
  for (let trial = 0; trial < repeats; trial++) {
    const choices = variants.length ? variants : ['perf=1&quality=standard', 'perf=1'];
    for (const search of trial % 2 ? [...choices].reverse() : choices) {
      for (const cache of caches) {
        const result = await run(search, cache, trial);
        results.push({ trial, ...result });
        await writeFile(output, JSON.stringify({ suite, viewport, freezeClock, freezeTraffic, tileDelay, noHttpCache, forceWebGL, settleMs, results }, null, 2));
        console.log(`${search || 'default'} ${cache} ${Math.round(result.startup.ms)} ms`, result.samples.map(s => [s.name, s.frameMs.median, s.frameMs.p95]));
      }
    }
  }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  if (expansionOnly && !freezeTraffic) {
    const missed = results.filter(run => run.startup.quality === 'fast' &&
      !run.search.includes('forestCanopy=off') && !run.search.includes('terrainTiles=off'))
      .flatMap(run => run.samples.filter(sample => sample.drawCalls.average > 800));
    if (missed.length) throw new Error('800-draw average exceeded: ' +
      missed.map(sample => `${sample.name} (${Math.round(sample.drawCalls.average)})`).join(', '));
  }
} finally {
  socket.close();
}
