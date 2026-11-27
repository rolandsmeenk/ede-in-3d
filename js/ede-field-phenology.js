const DAYS_PER_YEAR = 365;
const DAY_MS = 86400000;
const JANUARY = Date.UTC(2001, 0, 1);
const SOIL = 0x745a44;
const STUBBLE = 0xa48c59;
const SEEDLING = 0x607b3b;
const COVER = 0x667b49;
const RVO = 'https://www.rvo.nl/onderwerpen/gewascodelijst';
const MAIZE = 'https://www.wur.nl/nl/onderzoek/producten-diensten/handboek-snijmais';
const CEREALS = 'https://edepot.wur.nl/359592';
const ROOT_CROPS = 'https://edepot.wur.nl/637866';
const BEETS = 'https://www.irs.nl/volledige-teelthandleiding/';
const NATURE = 'https://edepot.wur.nl/658639';

function calendarDay(month, day) {
  return (Date.UTC(2001, month - 1, month === 2 ? Math.min(day, 28) : day) - JANUARY) / DAY_MS;
}

function dayOfScene(date) {
  if (typeof date !== 'string') return NaN;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? calendarDay(month, day) : NaN;
}

function key(date, stage, height, cover, color, bloom = 0) {
  const [month, day] = date.split('-').map(Number);
  return { day: calendarDay(month, day), stage, height, cover, color, bloom };
}

const bare = key('01-01', 'bare', 0, 0, SOIL);
const sow = date => key(date, 'sowing', 0, 0, SOIL);
const emerged = date => key(date, 'emergence', 0.08, 0.12, SEEDLING);
const stubble = date => key(date, 'stubble', 0.11, 0.17, STUBBLE);
const winter = date => key(date, 'winter-cover', 0.14, 0.52, COVER);

function profile(label, family, rowWidth, source, keys, bloomColor = null) {
  return { label, family, rowWidth, source, keys, bloomColor };
}

function beforeCut(cut, stage, height, cover, color) {
  return { day: cut.day - 1, stage, height, cover, color, bloom: 0 };
}

function maize(label, ripe, harvested, catchCrop) {
  const ripeColor = catchCrop ? 0x778049 : 0xa59a54;
  const cut = stubble(harvested);
  return profile(label, 'maize', 0.75, MAIZE, [
    catchCrop ? winter('01-01') : stubble('01-01'),
    catchCrop ? winter('03-10') : stubble('03-10'),
    key('04-10', 'bare', 0, 0, SOIL),
    sow('04-25'), emerged('05-12'),
    key('06-01', 'growth', 0.42, 0.27, 0x64813e),
    key('07-01', 'closed', 1.62, 0.83, 0x55743b),
    key('07-25', 'tassel', 2.35, 0.96, 0x4c6c33, 1),
    key('08-17', 'closed', 2.52, 0.97, 0x536f36, 0.34),
    key(ripe, 'ripening', 2.45, 0.90, ripeColor),
    beforeCut(cut, 'ripening', 2.37, 0.88, ripeColor),
    cut,
    ...(catchCrop ? [winter('11-04')] : []),
  ], 0xc7b87e);
}

function winterCereal(label, heading, ripe, harvested, planting, maxHeight, gold) {
  return profile(label, 'cereal', 0.23, CEREALS, [
    winter('01-01'), winter('03-03'),
    key('04-11', 'growth', 0.28, 0.72, 0x688340),
    key(heading, 'heading', maxHeight, 0.94, 0x798e4a),
    key(ripe, 'ripening', maxHeight, 0.94, gold),
    stubble(harvested), sow(planting),
    winter('11-15'),
  ]);
}

function springCereal(label, heading, ripe, harvested, maxHeight, gold) {
  return profile(label, 'cereal', 0.23, CEREALS, [
    bare, sow('03-05'), emerged('03-27'),
    key('05-05', 'growth', 0.37, 0.67, 0x6e8b48),
    key(heading, 'heading', maxHeight, 0.91, 0x818f4d),
    key(ripe, 'ripening', maxHeight, 0.93, gold),
    stubble(harvested),
    key('11-15', 'bare', 0, 0, SOIL),
  ]);
}

function annual(label, family, rowWidth, source, dates, height, leafColor, bloomColor = null) {
  const [planted, emerges, closes, ripens, harvested] = dates;
  return profile(label, family, rowWidth, source, [
    bare, sow(planted), emerged(emerges),
    key(closes, bloomColor ? 'flowering' : 'closed', height, 0.90, leafColor, bloomColor ? 1 : 0),
    key(ripens, 'ripening', height * 0.82, 0.65, 0x90834b),
    stubble(harvested),
  ], bloomColor);
}

function orchard(label, height, rowWidth, color, bloomColor = null) {
  return profile(label, 'woody', rowWidth, NATURE, [
    key('01-01', 'dormant', height * 0.88, 0.23, 0x776353),
    key('04-15', bloomColor ? 'flowering' : 'growth', height, 0.51, color, bloomColor ? 1 : 0),
    key('06-05', 'closed', height, 0.86, color),
    key('09-20', 'ripening', height, 0.81, 0x8b854d),
    key('11-21', 'dormant', height * 0.9, 0.27, 0x776353),
  ], bloomColor);
}

const grassCut = date => key(date, 'cut', 0.07, 0.85, 0x839456);
const grassGrowth = (date, height) => key(date, 'regrowth', height, 0.96, 0x687c43);

function mowing(date, height, stage = 'regrowth', color = 0x687c43) {
  const cut = grassCut(date);
  return [beforeCut(cut, stage, height, 0.94, color), cut];
}

export const FIELD_PROFILES = {
  silageMaize: maize('Silage maize', '09-13', '09-30', true),
  grainMaize: maize('Grain maize', '10-08', '10-24', false),
  cobMaize: maize('Corn-cob maize', '10-01', '10-16', false),
  winterWheat: winterCereal('Winter wheat', '06-02', '07-25', '08-06', '10-15', 0.88, 0xc1a365),
  winterBarley: winterCereal('Winter barley', '05-12', '06-29', '07-11', '09-25', 0.82, 0xbca45e),
  winterRye: winterCereal('Winter rye', '05-21', '07-21', '08-01', '10-11', 1.22, 0xbd9d5a),
  triticale: winterCereal('Triticale', '05-28', '07-23', '08-04', '10-08', 1.04, 0xb6a065),
  springWheat: springCereal('Spring wheat', '06-24', '08-08', '08-23', 0.80, 0xc2a264),
  springBarley: springCereal('Spring barley', '06-09', '07-18', '07-29', 0.72, 0xc6a566),
  oat: springCereal('Oats', '06-20', '08-01', '08-13', 0.96, 0xb5a36b),
  otherGrain: springCereal('Other grains', '06-24', '08-08', '08-23', 0.86, 0xbba366),
  spelt: springCereal('Spelt', '06-21', '08-04', '08-17', 1.12, 0xb79b60),
  sorghum: annual('Sorghum', 'tall', 0.5, RVO, ['05-15', '05-31', '08-10', '09-24', '10-12'], 1.8, 0x657842),
  elephantGrass: profile('Elephant grass', 'tall', 0.8, RVO, [
    key('01-01', 'dormant', 2.1, 0.65, 0xaa9565),
    stubble('03-20'), emerged('05-04'),
    key('08-15', 'closed', 2.7, 0.93, 0x5e7542),
    key('11-20', 'dormant', 2.6, 0.74, 0xad9b68),
  ]),
  hemp: annual('Fibre hemp', 'tall', 0.18, RVO, ['05-01', '05-16', '07-22', '09-06', '09-19'], 1.8, 0x577541),
  buckwheat: annual('Buckwheat', 'broadleaf', 0.25, 'https://edepot.wur.nl/504283', ['05-25', '06-08', '07-28', '09-07', '09-27'], 0.70, 0x638049, 0xe4dbd2),
  potato: annual('Potatoes', 'broadleaf', 0.75, ROOT_CROPS, ['04-17', '05-15', '07-02', '09-13', '09-29'], 0.56, 0x50734a, 0xdacbdd),
  seedPotato: annual('Seed potatoes', 'broadleaf', 0.75, ROOT_CROPS, ['04-09', '05-01', '06-25', '07-29', '08-25'], 0.54, 0x5c7d48, 0xe2dbda),
  starchPotato: annual('Starch potatoes', 'broadleaf', 0.75, ROOT_CROPS, ['04-17', '05-13', '07-12', '09-29', '10-23'], 0.62, 0x4d6d43, 0xe2dbda),
  pumpkin: annual('Pumpkin', 'broadleaf', 1.7, RVO, ['05-05', '05-29', '07-22', '09-15', '10-10'], 0.53, 0x577044, 0xdaae42),
  beet: annual('Beets', 'broadleaf', 0.50, BEETS, ['04-01', '04-24', '07-10', '10-03', '10-30'], 0.54, 0x5a793d),
  onion: annual('Onions', 'narrowleaf', 0.33, ROOT_CROPS, ['04-03', '04-29', '07-12', '08-26', '09-12'], 0.42, 0x65834f),
  asparagus: profile('Asparagus', 'narrowleaf', 1.7, RVO, [
    bare, sow('04-01'), key('06-24', 'emergence', 0.12, 0.12, SEEDLING),
    key('08-12', 'closed', 1.45, 0.72, 0x6c8447),
    key('10-20', 'ripening', 1.25, 0.61, 0xa29a5c),
    stubble('11-27'),
  ]),
  veg: annual('Mixed vegetable beds', 'broadleaf', 0.48, RVO, ['04-07', '05-01', '07-03', '09-14', '10-03'], 0.47, 0x648448),
  lupin: annual('Lupins', 'broadleaf', 0.29, RVO, ['04-05', '04-28', '06-25', '08-04', '09-03'], 0.85, 0x637a48, 0xac9dd4),
  fieldBean: annual('Field legumes', 'broadleaf', 0.35, RVO, ['03-19', '04-08', '06-10', '08-07', '08-24'], 0.87, 0x678044, 0xe1d8d4),
  climbingBean: annual('Climbing beans', 'broadleaf', 0.75, RVO, ['05-13', '05-29', '07-18', '09-04', '09-27'], 1.62, 0x567944, 0xe9dce5),
  grass: profile('Managed grassland', 'grass', 0, RVO, [
    key('01-01', 'dormant', 0.09, 0.90, COVER),
    key('03-18', 'growth', 0.15, 0.92, 0x70834a),
    ...mowing('05-10', 0.39), ...mowing('06-24', 0.31),
    ...mowing('08-05', 0.29), ...mowing('09-19', 0.28),
    key('11-08', 'winter-cover', 0.11, 0.92, COVER),
  ]),
  meadow: profile('Natural meadow', 'grass', 0, NATURE, [
    key('01-01', 'dormant', 0.16, 0.72, 0x888454),
    key('03-27', 'growth', 0.23, 0.84, 0x788350),
    grassGrowth('06-13', 0.58),
    key('08-20', 'ripening', 0.65, 0.92, 0x938957),
    ...mowing('09-04', 0.62, 'ripening', 0x938957),
    grassGrowth('10-10', 0.17),
  ]),
  fodderRye: winterCereal('Green fodder rye', '05-04', '05-20', '06-05', '09-26', 1.03, 0x81904f),
  oilseedRape: profile('Winter oilseed rape', 'broadleaf', 0.28, RVO, [
    winter('01-01'), key('04-28', 'flowering', 1.08, 0.93, 0x688043, 1),
    key('06-23', 'ripening', 1.19, 0.91, 0x919154), stubble('07-25'),
    sow('09-01'), winter('10-20'),
  ], 0xe9c53c),
  clover: profile('Clover and lucerne', 'broadleaf', 0.25, RVO, [
    winter('01-01'), key('06-05', 'flowering', 0.56, 0.89, 0x627d41, 1), grassCut('06-14'),
    key('08-05', 'flowering', 0.55, 0.88, 0x668041, 0.72), grassCut('08-22'),
    key('09-29', 'regrowth', 0.26, 0.82, 0x66824a),
  ], 0xb15d91),
  catch: profile('Catch crop', 'grass', 0, RVO, [
    winter('01-01'), winter('03-10'), sow('04-12'),
    key('08-24', 'bare', 0, 0, SOIL), sow('09-13'), emerged('09-29'), winter('11-07'),
  ]),
  fallow: profile('Green fallow', 'grass', 0, RVO, [
    key('01-01', 'dormant', 0.13, 0.43, 0x8b8054),
    grassGrowth('07-10', 0.43),
    key('10-13', 'ripening', 0.33, 0.66, 0x958656),
  ]),
  bare: profile('Bare or unplanted', 'soil', 0, RVO, [bare]),
  annual: annual('Other arable', 'broadleaf', 0.5, RVO, ['04-17', '05-08', '07-07', '09-14', '10-07'], 0.62, 0x657e45),
  conservation: profile('Agricultural nature mix', 'grass', 0, 'https://www.rvo.nl/gewascodes/1926', [
    key('01-01', 'dormant', 0.29, 0.68, 0x958659),
    key('04-20', 'growth', 0.29, 0.77, 0x75824c),
    key('07-06', 'closed', 0.78, 0.92, 0x788149),
    key('09-22', 'ripening', 0.66, 0.83, 0x958952),
    key('11-15', 'dormant', 0.52, 0.76, 0xa18f65),
  ]),
  nectar: annual('Nectar crop', 'flower', 0.33, RVO, ['04-18', '05-09', '07-23', '09-19', '10-20'], 0.72, 0x7c8749, 0xc2a6da),
  gladiolus: annual('Gladiolus bulbs', 'flower', 0.38, RVO, ['04-16', '05-07', '07-22', '09-10', '10-21'], 0.95, 0x63824b, 0xc18bad),
  lily: annual('Lily bulbs', 'flower', 0.38, RVO, ['04-10', '05-01', '07-11', '08-28', '10-14'], 0.92, 0x5d7647, 0xe2bbab),
  flowerField: annual('Commercial flowers', 'flower', 0.5, RVO, ['04-12', '05-04', '07-12', '09-11', '10-02'], 0.63, 0x648449, 0xd9a2bd),
  deciduousNursery: orchard('Deciduous nursery', 1.65, 1.4, 0x657846),
  ornamentalNursery: orchard('Ornamental nursery', 0.91, 1.2, 0x647b43, 0xd3aaa7),
  coniferNursery: profile('Conifer or Christmas tree nursery', 'woody', 1.6, RVO, [
    key('01-01', 'closed', 1.63, 0.72, 0x526342),
    key('06-03', 'growth', 1.72, 0.85, 0x627345),
    key('10-10', 'closed', 1.72, 0.78, 0x536943),
  ]),
  orchard: orchard('Fruit orchard', 2.9, 3.4, 0x647c49, 0xe8d6d8),
  cherry: orchard('Cherry orchard', 3.2, 4.0, 0x618047, 0xeae1d8),
  berries: orchard('Berry shrubs', 1.43, 2.2, 0x5c7547, 0xdfd7db),
  vines: orchard('Vineyard', 1.54, 2.3, 0x64834e),
  coppice: orchard('Willow coppice', 2.35, 1.4, 0x748d52),
  strawberry: annual('Tabletop strawberries', 'broadleaf', 1.4, RVO, ['04-10', '04-24', '06-05', '08-05', '10-05'], 0.92, 0x658044, 0xe8ded8),
  retain: profile('Existing landscape feature', 'retain', 0, RVO, [
    key('01-01', 'retain', 0, 0, SOIL),
  ]),
};

const codeGroups = {
  silageMaize: [259],
  grainMaize: [316],
  cobMaize: [1935],
  winterWheat: [233],
  winterBarley: [235],
  winterRye: [7130],
  triticale: [314],
  springWheat: [234],
  springBarley: [236],
  oat: [238],
  spelt: [382],
  otherGrain: [2652],
  sorghum: [3519],
  elephantGrass: [516],
  hemp: [944],
  buckwheat: [3510],
  potato: [2014],
  seedPotato: [2016],
  starchPotato: [2017],
  pumpkin: [2735],
  beet: [256, 257],
  onion: [6660, 6664],
  asparagus: [2710],
  veg: [2793],
  fieldBean: [244, 258, 311],
  lupin: [663],
  climbingBean: [2781],
  grass: [265, 266, 1921],
  fodderRye: [7129],
  oilseedRape: [1922],
  meadow: [331, 332],
  clover: [426, 665, 6758, 6762],
  catch: [6751, 6755, 7125, 7126],
  fallow: [6794],
  bare: [3801, 3802],
  annual: [1927],
  conservation: [1926],
  nectar: [657],
  flowerField: [174, 991],
  gladiolus: [998],
  lily: [1002],
  deciduousNursery: [1067, 1070, 1071, 1072, 1081, 1086, 1936, 1940],
  ornamentalNursery: [1069, 1075, 1080, 1083, 1089, 1094],
  coniferNursery: [796, 863, 1074, 1088],
  orchard: [1079],
  vines: [1099],
  berries: [1874],
  cherry: [2328],
  coppice: [795],
  strawberry: [2706],
  retain: [335, 338, 343, 2617, 2619, 2620, 2621, 2622, 2624, 2625, 2626, 2628, 2629, 2630, 2631,
    2634, 2639, 2642, 6800, 6801, 6807, 6809, 7135],
};

export const FIELD_CROP_CODES = Object.fromEntries(
  Object.entries(codeGroups).flatMap(([name, codes]) => codes.map(code => [code, name])),
);

function lerp(a, b, blend) {
  return a + (b - a) * blend;
}

function blendColor(a, b, blend) {
  const red = Math.round(lerp(a >> 16, b >> 16, blend));
  const green = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, blend));
  const blue = Math.round(lerp(a & 255, b & 255, blend));
  return (red << 16) | (green << 8) | blue;
}

export function fieldCropState(code, date, seed = 0) {
  const profile = FIELD_PROFILES[FIELD_CROP_CODES[code]];
  const sceneDay = dayOfScene(date);
  if (!profile || !Number.isFinite(sceneDay)) return null;
  const { label, family, rowWidth, keys, bloomColor } = profile;
  const offset = seed ? ((Math.imul(seed, 0x9e3779b1) >>> 0) % 15) - 7 : 0;
  const day = (sceneDay + offset + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const next = keys.findIndex(key => key.day > day);
  const left = keys[next < 0 ? keys.length - 1 : next - 1];
  const right = next < 0 ? keys[0] : keys[next];
  const span = next < 0 ? DAYS_PER_YEAR + right.day - left.day : right.day - left.day;
  const blend = (day - left.day) / span;
  return {
    label, family, rowWidth, bloomColor,
    stage: left.stage,
    height: lerp(left.height, right.height, blend),
    cover: lerp(left.cover, right.cover, blend),
    color: blendColor(left.color, right.color, blend),
    bloom: lerp(left.bloom, right.bloom, blend),
  };
}


// FLORON & NDFF (CC BY 4.0), sampled 27 November 2026.
// Flower dates are the five published diagram markers (10th, 20th, peak,
// 80th and 90th percentiles), in zero-based days from 1 January.
// Spelt and emmer use the common wheat markers as a close phenology proxy.
const FLOWERING_SOURCE = 'https://www.verspreidingsatlas.nl/projecten/floron/fenologie/';
const flowerSpecies = new Map([
  ['Agrostemma githago', 0xc65a9c, 0.76, 'poppy', [148, 155, 164, 191, 214]],
  ['Centaurea cyanus', 0x476dcc, 0.62, 'daisy', [141, 151, 163, 206, 239]],
  ['Consolida regalis', 0x6e5cb3, 0.52, 'spike', [160, 165, 172, 217, 237]],
  ['Glebionis segetum', 0xf3c53e, 0.54, 'daisy', [159, 170, 183, 252, 281]],
  ['Matricaria chamomilla', 0xf3ebd7, 0.45, 'daisy', [144, 154, 164, 228, 256]],
  ['Misopates orontium', 0xd984a7, 0.33, 'spike', [161, 169, 171, 265, 291]],
  ['Papaver dubium', 0xe77344, 0.55, 'poppy', [131, 139, 153, 183, 204]],
  ['Papaver rhoeas', 0xe34037, 0.62, 'poppy', [134, 144, 156, 199, 227]],
  ['Silene conica', 0xd9adbd, 0.31, 'poppy', [133, 135, 145, 165, 175]],
  ['Silene gallica', 0xe3ccce, 0.43, 'poppy', [140, 146, 153, 180, 209]],
  ['Silene noctiflora', 0xdfccd7, 0.47, 'poppy', [154, 161, 173, 208, 251]],
  ['Tripleurospermum maritimum', 0xf1ede0, 0.55, 'daisy', [119, 163, 196, 272, 312]],
  ['Achillea millefolium', 0xe7e4d9, 0.63, 'umbel', [160, 172, 180, 256, 299]],
  ['Barbarea vulgaris', 0xf1ca48, 0.61, 'spike', [110, 116, 126, 140, 148]],
  ['Centaurea jacea', 0xae518f, 0.72, 'daisy', [149, 161, 171, 231, 263]],
  ['Crepis capillaris', 0xecc943, 0.37, 'daisy', [157, 168, 173, 257, 293]],
  ['Daucus carota', 0xeadfce, 0.80, 'umbel', [176, 188, 207, 226, 253]],
  ['Echium vulgare', 0x6369b8, 0.73, 'spike', [152, 160, 169, 223, 254]],
  ['Erodium cicutarium', 0xcc7d9c, 0.27, 'poppy', [94, 107, 117, 224, 265]],
  ['Galium mollugo subsp. erectum', 0xe5e5d7, 0.61, 'umbel', [143, 151, 162, 221, 247]],
  ['Hieracium sectie Hieracioides', 0xebbe3e, 0.72, 'daisy', [188, 198, 209, 263, 283]],
  ['Hypericum perforatum', 0xeebb3e, 0.62, 'poppy', [163, 170, 177, 227, 244]],
  ['Hypochaeris radicata', 0xe9c947, 0.49, 'daisy', [139, 150, 160, 237, 269]],
  ['Jasione montana', 0x788dc8, 0.35, 'daisy', [164, 173, 183, 242, 268]],
  ['Leucanthemum vulgare', 0xf7f0e1, 0.71, 'daisy', [127, 136, 150, 175, 199]],
  ['Lotus corniculatus var. corniculatus', 0xe6b438, 0.37, 'umbel', [135, 145, 160, 218, 236]],
  ['Luzula campestris', 0x988365, 0.26, 'spike', [79, 86, 99, 119, 133]],
  ['Malva moschata', 0xe196b0, 0.68, 'poppy', [161, 163, 164, 234, 261]],
  ['Oenothera biennis', 0xf3d253, 0.97, 'poppy', [166, 174, 180, 248, 273]],
  ['Plantago lanceolata', 0xa59770, 0.47, 'spike', [117, 130, 144, 215, 240]],
  ['Prunella vulgaris', 0x8059a6, 0.29, 'spike', [170, 179, 192, 228, 256]],
  ['Ranunculus acris', 0xecc43d, 0.63, 'poppy', [106, 119, 133, 195, 244]],
  ['Rhinanthus minor', 0xecce4e, 0.43, 'spike', [134, 140, 151, 169, 181]],
  ['Scorzoneroides autumnalis', 0xecc03e, 0.46, 'daisy', [176, 195, 221, 263, 284]],
  ['Silene dioica', 0xd87fa5, 0.63, 'poppy', [102, 118, 135, 210, 260]],
  ['Tragopogon pratensis subsp. pratensis', 0xe9c141, 0.63, 'daisy', [131, 138, 151, 181, 212]],
  ['Trifolium arvense', 0xd8bbbc, 0.32, 'spike', [162, 170, 179, 219, 240]],
  ['Achillea ptarmica', 0xeae5db, 0.68, 'umbel', [183, 191, 198, 244, 260]],
  ['Angelica sylvestris', 0xe3ddcf, 1.19, 'umbel', [171, 190, 210, 233, 252]],
  ['Caltha palustris subsp. palustris', 0xf3c12e, 0.35, 'poppy', [84, 93, 106, 121, 131]],
  ['Cardamine pratensis', 0xe1c5e1, 0.38, 'umbel', [89, 94, 105, 125, 138]],
  ['Cirsium palustre', 0xb47bb0, 1.05, 'spike', [140, 148, 160, 196, 216]],
  ['Dactylorhiza praetermissa', 0xbd609e, 0.59, 'spike', [147, 152, 162, 172, 178]],
  ['Epipactis palustris', 0xe3d5d9, 0.58, 'spike', [168, 174, 184, 197, 204]],
  ['Eupatorium cannabinum', 0xca94ad, 1.20, 'umbel', [185, 194, 209, 244, 260]],
  ['Filipendula ulmaria', 0xefe0c6, 1.18, 'umbel', [172, 181, 196, 220, 240]],
  ['Hypericum maculatum subsp. obtusiusculum', 0xefc242, 0.61, 'poppy', [176, 186, 213, 233, 246]],
  ['Hypericum tetrapterum', 0xf1c649, 0.58, 'poppy', [184, 195, 214, 233, 244]],
  ['Iris pseudacorus', 0xe9c644, 1.00, 'poppy', [129, 135, 145, 158, 164]],
  ['Lotus pedunculatus', 0xe9c044, 0.59, 'umbel', [163, 171, 178, 226, 245]],
  ['Lycopus europaeus', 0xe1e2cb, 0.65, 'spike', [189, 199, 225, 244, 253]],
  ['Lysimachia vulgaris', 0xeac54b, 0.90, 'spike', [170, 177, 191, 216, 227]],
  ['Lythrum salicaria', 0xc95495, 1.04, 'spike', [171, 180, 194, 230, 243]],
  ['Mentha aquatica', 0xba9dbd, 0.51, 'spike', [199, 209, 222, 253, 262]],
  ['Pulicaria dysenterica', 0xe8bc42, 0.59, 'daisy', [191, 200, 218, 248, 259]],
  ['Rhinanthus angustifolius', 0xe9c640, 0.56, 'spike', [141, 151, 166, 185, 202]],
  ['Silene flos-cuculi', 0xeb9bc4, 0.55, 'poppy', [125, 132, 142, 164, 195]],
  ['Thalictrum flavum', 0xd8d49f, 1.03, 'umbel', [154, 160, 170, 186, 197]],
  ['Valeriana officinalis', 0xe4d5d9, 1.16, 'umbel', [146, 154, 165, 182, 192]],
  ['Triticum aestivum subsp. spelta', 0xb99b60, 0.97, 'spike', [139, 146, 164, 184, 194]],
  ['Triticum turgidum subsp. dicoccum', 0x867149, 1.01, 'spike', [139, 146, 164, 184, 194]],
  ['Fagopyrum esculentum', 0xeaddd9, 0.67, 'umbel', [167, 176, 202, 246, 263]],
  ['Helianthus annuus', 0xedb52d, 1.54, 'daisy', [196, 205, 232, 257, 269]],
].map(([name, color, height, shape, days]) => [name, { name, color, height, shape, days }]));

function flowerMix(label, source, evidence, species) {
  return { label, source, evidence, phenologySource: FLOWERING_SOURCE, species };
}

export const FIELD_FLOWER_MIXES = {
  'A6': flowerMix('A6 annual arable flowers',
    'https://www.cruydthoeck.nl/media/25/b9/de/1718605733/Productblad%20A6_WEB.pdf', 'reference', [
    'Agrostemma githago', 'Centaurea cyanus', 'Consolida regalis',
    'Glebionis segetum', 'Matricaria chamomilla', 'Misopates orontium',
    'Papaver dubium', 'Papaver rhoeas', 'Silene conica',
    'Silene gallica', 'Silene noctiflora', 'Tripleurospermum maritimum',
  ]),
  'ginkel-margin': flowerMix('Locally developed conservation margin mix (listed components)',
    'https://www.natuurinclusievelandbouwgelderland.nl/nieuws/duurzame-gronduitgifte-landbouwenclave-de-ginkel/', 'local-reference', [
    'Centaurea cyanus', 'Papaver rhoeas', 'Triticum aestivum subsp. spelta',
    'Triticum turgidum subsp. dicoccum',
  ]),
  'G1': flowerMix('G1 flowering grassland on light soil',
    'https://www.cruydthoeck.nl/media/71/ff/19/1718605733/Productblad%20G1_WEB.pdf', 'reference', [
    'Achillea millefolium', 'Barbarea vulgaris', 'Centaurea jacea',
    'Crepis capillaris', 'Daucus carota', 'Echium vulgare',
    'Erodium cicutarium', 'Galium mollugo subsp. erectum', 'Hieracium sectie Hieracioides',
    'Hypericum perforatum', 'Hypochaeris radicata', 'Jasione montana',
    'Leucanthemum vulgare', 'Lotus corniculatus var. corniculatus', 'Luzula campestris',
    'Malva moschata', 'Oenothera biennis', 'Plantago lanceolata',
    'Prunella vulgaris', 'Ranunculus acris', 'Rhinanthus minor',
    'Scorzoneroides autumnalis', 'Silene dioica', 'Tragopogon pratensis subsp. pratensis',
    'Trifolium arvense',
  ]),
  'G3': flowerMix('G3 flowering grassland on wet soil',
    'https://www.cruydthoeck.nl/media/fd/e5/ce/1718605733/Productblad%20G3_WEB.pdf', 'reference', [
    'Barbarea vulgaris', 'Luzula campestris', 'Plantago lanceolata',
    'Prunella vulgaris', 'Ranunculus acris', 'Rhinanthus minor',
    'Achillea ptarmica', 'Angelica sylvestris', 'Caltha palustris subsp. palustris',
    'Cardamine pratensis', 'Cirsium palustre', 'Dactylorhiza praetermissa',
    'Epipactis palustris', 'Eupatorium cannabinum', 'Filipendula ulmaria',
    'Hypericum maculatum subsp. obtusiusculum', 'Hypericum tetrapterum', 'Iris pseudacorus',
    'Lotus pedunculatus', 'Lycopus europaeus', 'Lysimachia vulgaris',
    'Lythrum salicaria', 'Mentha aquatica', 'Pulicaria dysenterica',
    'Rhinanthus angustifolius', 'Silene flos-cuculi', 'Thalictrum flavum',
    'Valeriana officinalis',
  ]),
  'ginkel-observed': flowerMix('De Ginkel photographed species',
    'https://www.natuurinclusievelandbouwgelderland.nl/nieuws/zomer-2024-wat-een-bio-diversiteit/', 'observed', [
    'Fagopyrum esculentum', 'Helianthus annuus',
  ]),
};

const structureKeys = {
  A6: [[0, 0.02], [104, 0.02], [156, 0.85], [198, 1], [275, 0.7], [304, 0.15], [364, 0.02]],
  G1: [[0, 0.14], [80, 0.14], [145, 0.85], [190, 1], [254, 0.9], [271, 0.21], [364, 0.14]],
  G3: [[0, 0.13], [68, 0.15], [114, 0.56], [177, 1], [254, 0.94], [275, 0.23], [364, 0.13]],
  'ginkel-margin': [[0, 0.53], [71, 0.43], [97, 0.11], [163, 0.84], [198, 1], [280, 0.81], [364, 0.53]],
  'ginkel-observed': [[0, 0.48], [72, 0.38], [115, 0.05], [177, 0.70], [231, 1], [280, 0.74], [364, 0.48]],
};

function sampleCurve(points, day) {
  const next = points.findIndex(([point]) => point > day);
  if (next < 0) return points.at(-1)[1];
  if (!next) return points[0][1];
  const [left, value] = points[next - 1];
  const [right, laterValue] = points[next];
  return lerp(value, laterValue, (day - left) / (right - left));
}

for (const species of flowerSpecies.values()) {
  const [early, rising, peak, falling, late] = species.days;
  const points = [
    [early - 12, 0], [early, 0.24], [rising, 0.52], [peak, 1],
    [falling, 0.43], [late, 0.18], [late + 14, 0],
  ];
  species.weeks = Array.from({ length: 54 }, (_, week) => sampleCurve(points, week * 7));
}

export function fieldFlowerState(mix, date) {
  const selected = FIELD_FLOWER_MIXES[mix];
  const day = dayOfScene(date);
  if (!Array.isArray(selected?.species) || !Number.isFinite(day)) return [];
  const structure = sampleCurve(structureKeys[mix], day);
  const week = Math.floor(day / 7);
  return selected.species.map(name => {
    const { color, height, shape, weeks } = flowerSpecies.get(name);
    return {
      name, color, height, shape, structure, cover: structure,
      bloom: lerp(weeks[week], weeks[week + 1], (day % 7) / 7),
    };
  });
}
