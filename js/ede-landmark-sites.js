import { EDE_DATA } from './ede-geodata.js';
import { EDE_FUEL_SITES } from './ede-fuel-sites.js';
import { OTHER_CHURCH_SHELLS } from './ede-other-church-shells.js';
import { EDE_PUBLIC_LANDMARKS } from './ede-public-survey.js';
import { EDE_SCHOOL_LANDMARKS } from './ede-school-survey.js';
import { EDE_SPORT_LANDMARKS } from './ede-sport-landmark-survey.js';

export const EDE_MODELED_LANDMARKS = [
  { id: 'concordiamolen', name: 'Concordiamolen', district: 'Centrum', road: 'Accesweg',
    osmId: 'w1412208401', annexOsmIds: ['w271545742', 'w271547371', 'w271549077', 'w271547126'],
    bagIds: ['0228100000009921', '0228100000033968', '0228100000065603', '0228100000045246'],
    x: -390.65, z: -101.70, heading: 1.96, height: 36, worldSpace: true },
  { id: 'stingerbol', name: 'Stingerbol', district: 'Stationsgebied', road: 'Bataljonlaan',
    osmId: 'w271575955', x: 412.20, z: 2007.99, heading: 1.754, height: 20 },
  { id: 'grote-enka-schoorsteen', name: 'Grote ENKA-schoorsteen', district: 'ENKA', road: 'Grote Schoorsteenplein',
    osmId: 'w56094542', x: 557.85, z: 2647.70, heading: 0, height: 85 },
  { id: 'kleine-enka-schoorsteen', name: 'Kleine ENKA-schoorsteen', district: 'ENKA', road: 'Twijnerij',
    osmId: 'w196375686', x: 601.30, z: 2462.15, heading: 0, height: 53 },
  { id: 'astrant', name: 'Astrant', district: 'Centrum', road: 'Kuiperplein',
    osmId: 'w271551819', x: -175.2, z: 92.3, heading: -1.044, height: 8.5, bagCutMargin: 0.25 },
  { id: 'pegasus-flat', name: 'Pegasusflat · Van Eekelenflat', district: 'Ede-Zuid', road: 'Jan Th. Tooroplaan',
    osmId: 'w271377198', x: -1559.88, z: 2346.27, heading: 0.121464, height: 40.4, bagCutMargin: 0.25 },
  { id: 'plantion', name: 'Plantion', district: 'Ede-West', road: 'Wellensiekstraat',
    osmId: 'w271151642', annexOsmIds: ['w271151018'], x: -3863.85, z: 960.07, heading: 0, height: 42,
    modelOrigin: { x: -4090, z: 970 }, colliderHeights: [17, 8.5], bagCutMargin: 1.2 },
  { id: 'johan-willem-friso', name: 'Johan Willem Friso-kazerne', district: 'Veluwse Poort', road: 'Frisopark',
    osmId: 'w271576736', x: 211.22, z: 1945.85, heading: -1.831, height: 16.44, baseY: 1.71, bagCutMargin: 0.35 },
  { id: 'enka-westhal', name: 'ENKA Westhal en Poortgebouw', district: 'ENKA', road: 'Akulaan',
    osmId: 'w271473159', bagIds: ['0228100000062084'], x: 471.2, z: 2287.5, height: 17.32, worldSpace: true },
  { id: 'mauritskazerne', name: 'Mauritskazerne', district: 'Veluwse Poort', road: 'Frisopark',
    osmId: 'w271576729', bagIds: ['0228100000004297'], x: 181, z: 1752.3, heading: -1.003285554, height: 16.20, baseY: 1.85 },
  { id: 'oudekerk', name: 'Oude Kerk', district: 'Centrum', road: 'Torenstraat',
    osmId: 'w271602340', bagIds: ['0228100000030468'], x: 0, z: 0, height: 48.75, worldSpace: true,
    excludeOsmIds: ['w968871667','w968871668','w968871669','w968871672','w968871673','w968871674','w968871675','w968871676','w968871677','w968871678'] },
  { id: 'edecentrum', name: 'Station Ede Centrum', district: 'Centrum', road: 'Telefoonweg',
    osmId: 'w271573214', annexOsmIds: ['w1067217197'], excludeOsmIds: ['w1300597356'],
    bagIds: ['0228100000013836', '0228100000091066'], x: -239.2, z: 322.4, height: 13.09, worldSpace: true },
  { id: 'huis-kernhem', name: 'Huis Kernhem', district: 'Kernhem', road: 'Kernhemseweg',
    osmId: 'w271586514', annexOsmIds: ['w271586534'], bagIds: ['0228100000058265', '0228100000005589'],
    x: -973.6, z: -759.5, height: 12.71, worldSpace: true },
  { id: 'de-vuurvogel', name: 'De Vuurvogel', district: 'Vogelbuurt', road: 'Nachtegaallaan',
    osmId: 'w271510322', bagIds: ['0228100000040685'], x: -766, z: 790, heading: -2.881, height: 7.02, baseY: -4.15 },
  { id: 'raadhuis', name: 'Raadhuis Ede', district: 'Centrum', road: 'Bergstraat',
    osmId: 'w271602720', bagIds: ['0228100000035709'], x: 249.54687, z: 38.12693, height: 29.55, worldSpace: true },
  { id: 'cultura', name: 'Cultura', district: 'Centrum', road: 'Molenstraat',
    osmId: 'w271549982', bagIds: ['0228100000002319'], x: -292.57691, z: -62.17194, height: 13, worldSpace: true },
  { id: 'riedel-silos', name: 'Riedel-silo’s', district: 'Frankeneng', road: 'Frankeneng',
    osmId: 'w271378505', bagIds: ['0228100000068828'], x: -1590.4, z: 1584.7, height: 18.7, worldSpace: true },
  { id: 'kappa-docie', name: 'Kappa Docie', district: 'Stationsgebied', road: 'Stationsweg',
    osmId: 'w271512171', bagIds: ['0228100000069623'], x: 45.9, z: 1940, height: 3.74, worldSpace: true },
  { id: 'stadspoort', name: 'Winkelcentrum Stadspoort', district: 'Rietkampen', road: 'Doctor Willem Dreeslaan',
    osmId: 'w271376070', bagIds: ['0228100000029361'], x: -1470.2, z: 3130.6, height: 15.3, worldSpace: true },
  { id: 'pathe-ede', name: 'Pathé Ede', district: 'Rietkampen', road: 'Laan der Verenigde Naties',
    osmId: 'w56105004', bagIds: ['0228100000046614'], x: -1590, z: 3369, height: 16.8, worldSpace: true },
  { id: 'lukkien', name: 'Lukkien', district: 'De Vallei', road: 'Copernicuslaan',
    osmId: 'w271178639', annexOsmIds: ['w271178396'], bagIds: ['0228100000026151', '0228100000026583'],
    x: -3217.36, z: 2637.95, height: 21, worldSpace: true },
  { id: 'keetmolen', name: 'De Keetmolen', district: 'Stationsgebied', road: 'Stationsweg',
    osmId: 'w271516049', bagIds: ['0228100000033366'],
    x: -77.55, z: 1808.7, height: 26.7, worldSpace: true },
  { id: 'de-peppel', name: 'Zwembad en Sporthal De Peppel', district: 'Veldhuizen', road: 'Peppelensteeg',
    osmId: 'w272136130', annexOsmIds: ['w272140810'], bagIds: ['0228100000002262', '0228100000005546'],
    x: -2192.31, z: 1115.62, height: 12, worldSpace: true },
  { id: 'che-campus', name: 'Christelijke Hogeschool Ede · Van der Knaaphal', district: 'Kenniscampus', road: 'Oude Kerkweg',
    osmId: 'r19854426', annexOsmIds: ['w403848890', 'w562784777'], bagIds: ['0228100000069159', '0228100000079375', '0228100000080700'],
    x: -508, z: 2915, height: 25.2, worldSpace: true },
  { id: 'nieuwe-kerk', name: 'Nieuwe Kerk', district: 'Maandereng', road: 'Verlengde Maanderweg',
    osmId: 'w271508052', bagIds: ['0228100000061089'],
    x: -567.5, z: 1050, height: 25, worldSpace: true },
  { id: 'noorderkerk', name: 'Noorderkerk · Edesche Concertzaal', district: 'Centrum', road: 'Amsterdamseweg',
    osmId: 'w271603299', bagIds: ['0228100000006233'],
    x: -214, z: -299, height: 26, worldSpace: true },
  { id: 'sint-antoniuskerk', name: 'Sint-Antonius van Paduakerk', district: 'Stationsgebied', road: 'Stationsweg',
    osmId: 'w271515555', bagIds: ['0228100000059773'],
    x: -94, z: 1697, height: 20, worldSpace: true },
  { id: 'beatrixkerk', name: 'Beatrixkerk', district: 'Ede-Zuid', road: 'Beatrixlaan',
    osmId: 'w271508047', bagIds: ['0228100000019922'],
    x: -639, z: 1370, height: 23, worldSpace: true },

  { id: 'hoekelum', name: 'Kasteel Hoekelum', district: 'Bennekom', road: 'Edeseweg',
    osmId: 'w271473106', annexOsmIds: ['w271473117'], bagIds: ['0228100000039432', '0228100000005600'],
    x: 355.2, z: 3393, height: 18, worldSpace: true, approach: { x: 330, z: 3432 } },
  { id: 'nizo', name: 'NIZO Food Research', district: 'Kernhem', road: 'Kernhemseweg',
    osmId: 'w271586838', annexOsmIds: ['w271586774', 'w271588010', 'w271588469', 'w271586695'],
    bagIds: ['0228100000013349', '0228100000031240', '0228100000033892', '0228100000036731', '0228100000070061'],
    x: -630, z: -682, height: 22, worldSpace: true, approach: { x: -638, z: -630 } },
  { id: 'ziekenhuis', name: 'Ziekenhuis Gelderse Vallei', district: 'Maandereng', road: 'Willy Brandtlaan',
    osmId: 'r13089665', bagIds: ['0228100000006511'], x: -1799, z: 2612, height: 27, worldSpace: true,
    approach: { x: -1680, z: 2619 } },
  { id: 'openluchttheater', name: 'De Eder Kuil', district: 'Burgemeestersbuurt', road: 'van Pabstlaan',
    osmId: 'w271575627', annexOsmIds: ['w271575773', 'w271575654'],
    bagIds: ['0228100000006512', '0228100000037062', '0228100000069647'],
    x: 471.52, z: 602.56, height: 12, worldSpace: true },
  { id: 'reehorst', name: 'De ReeHorst', district: 'Stationsgebied', road: 'Bennekomseweg',
    osmId: 'w271472015', bagIds: ['0228100000004736'], x: -42.95, z: 2408.85, height: 25.84, worldSpace: true,
    approach: { x: 15, z: 2418 } },
  { id: 'work-garden', name: 'Work Garden', district: 'Centrum', road: 'Grotestraat',
    osmId: 'w501079879', bagIds: ['0228100000077693'], x: -47.86, z: -226.77, height: 10.74, worldSpace: true,
    approach: { x: -56, z: -226.7 } },
  { id: 'buitenzorg', name: 'Buitenzorg', district: 'Centrum', road: 'Amsterdamseweg',
    osmId: 'w271549976', bagIds: ['0228100000042682'], x: -294.55, z: -293.6, height: 10.97, worldSpace: true,
    approach: { x: -302, z: -323 } },
  { id: 'johannus-orgelbouw', name: 'Johannus Orgelbouw', district: 'Frankeneng', road: 'Keplerlaan',
    osmId: 'w271177823', bagIds: ['0228100000034171'], x: -3053.95, z: 2076.7, height: 13.16, worldSpace: true },
  { id: 'technova', name: 'Technova College', district: 'Kenniscampus', road: 'Bovenbuurtweg',
    osmId: 'w731835032', annexOsmIds: ['w728425159', 'w728425160', 'w771284070'],
    bagIds: ['0228100000028941'], x: -654, z: 2702, height: 20.3, worldSpace: true,
    approach: { x: -594, z: 2731 } },
  { id: 'gasfabriek', name: 'De Gasfabriek', district: 'Centrum', road: 'Diamantstraat',
    osmId: 'w271516508', annexOsmIds: ['w271515352', 'w271509527'],
    bagIds: ['0228100000073672', '0228100000000200', '0228100000057655'],
    x: -431, z: 668, height: 17, worldSpace: true, approach: { x: -461, z: 675 } },
  { id: 'pallas-athene', name: 'Pallas Athene College', district: 'Veldhuizen', road: 'Koekeltse Boslaan',
    osmId: 'w272141214', bagIds: ['0228100000057211'], x: -2050, z: 994, height: 12.68, worldSpace: true,
    approach: { x: -2002, z: 988 } },
  { id: 'tesqua', name: 'Tesqua', district: 'Veldhuizen', road: 'Horsterweg',
    osmId: 'w272136145', bagIds: ['0228100000041390'], x: -1859, z: 1330, height: 11, worldSpace: true,
    approach: { x: -1856, z: 1283 } },

  { id: 'point-growth', name: 'Point Growth', district: 'Centrum', road: 'Torenstraat',
    osmId: 'n9013767172', x: -37.33, z: -12.96, heading: -1.57, height: 5 },
  { id: 'on-the-rocks', name: 'On the Rocks', district: 'Centrum', road: 'Bevrijdingsplein',
    osmId: 'n821108126', x: -104.9533, z: 258.9767, height: 1.62, worldSpace: true },

  { id: 'mausoleum', name: 'Mausoleum op de Paasberg', district: 'Paasberg', road: 'Vossenakker',
    osmId: 'w734726076', x: 490.82, z: 257.77, heading: -1.633, height: 3.91,
    approach: { x: 432.1, z: 233.8 } },

  { id: 'rwzi-ede', name: 'Rioolwaterzuivering Ede · Vijzelgemaal', district: 'Ede-West', road: 'Dwarsweg',
    osmId: 'w1466029086', annexOsmIds: ['w843579818', 'w272139262'],
    bagIds: ['0228100000100438', '0228100000008655'],
    x: -3504.52, z: 899.87, height: 10.25, worldSpace: true, approach: { x: -3561, z: 909 } },
  { id: 'oude-hofstede', name: 'Kinderboerderij De Oude Hofstede', district: 'Reehorst', road: 'Bovenbuurtweg',
    osmId: 'w271463467', annexOsmIds: ['w271462917', 'w271469978', 'w271376432'],
    bagIds: ['0228100000027167', '0228100000028120', '0228100000048803', '0228100000064178'],
    x: -543, z: 3314.3, height: 8.7, worldSpace: true, approach: { x: -563.3, z: 3336.1 } },
  { id: 'de-proosdij', name: 'Kinderboerderij De Proosdij', district: 'Veldhuizen', road: 'Floreslaan',
    osmId: 'w271549433', annexOsmIds: ['w271545798', 'w271548153', 'w271548956'],
    bagIds: ['0228100000049983', '0228100000052209', '0228100000048949', '0228100000034592'],
    x: -1350.7, z: 636.9, height: 9.23, worldSpace: true, approach: { x: -1321.9, z: 631.9 } },

  ...EDE_PUBLIC_LANDMARKS,
  ...EDE_SCHOOL_LANDMARKS,
  ...EDE_SPORT_LANDMARKS,

  ...Object.entries(OTHER_CHURCH_SHELLS).map(([id, churchSurvey]) => {
    const { name, osm, bag, center: [x, z], road, district, approach, height } = churchSurvey;
    return { id, name, osmId: osm, bagIds: [bag], x, z, road, district, approach, height, churchSurvey, worldSpace: true };
  }),
];

const sources = new Set(EDE_MODELED_LANDMARKS.flatMap(site => [site.osmId, ...(site.annexOsmIds ?? [])]));
const dome = EDE_MODELED_LANDMARKS[1];
const groteChimney = EDE_MODELED_LANDMARKS[2];
const circle = ({ x, z }, radius, sides = 16) => Array.from({ length: sides }, (_, i) => {
  const angle = i * 2 * Math.PI / sides;
  return { x: x + radius * Math.cos(angle), z: z + radius * Math.sin(angle) };
});

const footprintById = new Map();
for (const { id, ring } of EDE_DATA.buildings) {
  if (!sources.has(id) || !ring?.length) continue;
  const outer = [];
  for (let i = 0; i < ring.length; i += 2) outer.push({ x: ring[i], z: ring[i + 1] });
  footprintById.set(id, { outer, holes: [] });
}

export function modeledLandmarkFootprints(site) {
  if (site.churchSurvey) {
    const { ground, points } = site.churchSurvey;
    const [outer, ...holes] = ground.map(ring => ring.map(index => {
      const [x, , z] = points[index];
      return { x, z };
    }));
    return [{ outer, holes }];
  }
  const primary = footprintById.get(site.osmId) ?? { outer: circle(site, 4), holes: [] };
  return [primary, ...(site.annexOsmIds ?? []).map(id => footprintById.get(id)).filter(Boolean)];
}

function cutFor(vertices, margin) {
  const center = vertices.reduce((p, v) => ({ x: p.x + v.x / vertices.length, z: p.z + v.z / vertices.length }), { x: 0, z: 0 });
  const planes = vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    const nx = a.z - b.z, nz = b.x - a.x;
    const sign = nx * (center.x - a.x) + nz * (center.z - a.z) >= 0 ? 1 : -1;
    return [nx * sign, 0, nz * sign, (nx * a.x + nz * a.z) * sign - margin * Math.hypot(nx, nz)];
  });
  return {
    minX: Math.min(...vertices.map(p => p.x)) - margin, maxX: Math.max(...vertices.map(p => p.x)) + margin,
    minZ: Math.min(...vertices.map(p => p.z)) - margin, maxZ: Math.max(...vertices.map(p => p.z)) + margin,
    planes,
  };
}

// Replacements occupy isolated mapped buildings. Keep cuts bounded to each surveyed plan.
function convexHull(points) {
  const ordered = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const turn = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  function half(points) {
    const chain = [];
    for (const point of points) {
      while (chain.length >= 2 && turn(chain.at(-2), chain.at(-1), point) <= 0) chain.pop();
      chain.push(point);
    }
    return chain.slice(0, -1);
  }
  return [...half(ordered), ...half(ordered.reverse())];
}

const bagCuts = [
  cutFor(circle(dome, 11.45), 0.1),
  // The tall shaft also appears as a straight extrusion in the live 3DBAG tile.
  cutFor(circle(groteChimney, 5.5, 24), 0),
  ...EDE_MODELED_LANDMARKS.filter(site => site.bagCutMargin !== undefined).map(site => {
    const points = modeledLandmarkFootprints(site).flatMap(footprint => footprint.outer);
    return cutFor(convexHull(points), site.bagCutMargin);
  }),
];

// Match whole BAG features for attached and concave sites so the neighboring buildings survive.
const bagReplacements = EDE_MODELED_LANDMARKS.filter(site => site.bagIds?.length).map(site => {
  const points = modeledLandmarkFootprints(site).flatMap(footprint => footprint.outer);
  return { ids: site.bagIds, minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)) };
});

for (const site of EDE_FUEL_SITES) {
  for (const [part, id] of [[site, site.canopyBagId], [site.shop, site.shop?.bagId]]) {
    if (!id) continue;
    const radius = Math.hypot(part.width, part.length) / 2;
    const { x, z } = part;
    bagReplacements.push({ ids: [id], minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius });
  }
}

export function landmarkBagExclusions({ min, max }) {
  const ids = new Map();
  for (const replacement of bagReplacements) {
    if (min.x > replacement.maxX + 2 || max.x < replacement.minX - 2 ||
        min.z > replacement.maxZ + 2 || max.z < replacement.minZ - 2) continue;
    for (const id of replacement.ids) ids.set(id, true);
  }
  return ids;
}

export function landmarkBuildingCuts({ minX, maxX, minZ, maxZ }) {
  return bagCuts.filter(cut => minX <= cut.maxX && maxX >= cut.minX && minZ <= cut.maxZ && maxZ >= cut.minZ);
}
