import { pointInPoly, toPts } from './city-config.js';
import { nearestEdeRoad } from './ede-geometry.js';

// CBS Wijken en buurten 2025 via PDOK, simplified to 3 m in the Ede scene frame.
// https://api.pdok.nl/cbs/wijken-en-buurten-2025/ogc/v1/collections/buurten
const regions = [
  ['kernhem', 0, [-2171.4, -934.3, -1482.2, -400.4], [-1490.1, -513.2, -1633.2, -516.5, -1786.8, -492.8, -1860.6, -456.7, -1986.6, -404.5, -1996.5, -400.4, -2087.2, -618.3, -2133.5, -737.9, -2171.4, -843.2, -1589.9, -917.3, -1527.6, -934.3, -1520.8, -891.5, -1512.4, -833.3, -1506.4, -783.7, -1498.7, -711.4, -1492.8, -672.1, -1487.9, -651.3, -1483.3, -636.5, -1482.2, -610.7]], // BU02280401 De Bergen
  ['kernhem', 1, [-2704.0, -843.2, -1996.5, -135.9], [-1996.5, -400.4, -2395.4, -235.1, -2456.7, -209.7, -2565.6, -167.7, -2704.0, -135.9, -2609.2, -745.3, -2436.7, -786.8, -2318.0, -824.5, -2171.4, -843.2, -2133.5, -737.9, -2087.2, -618.3]], // BU02280402 De Bossen
  ['kernhem', 2, [-3669.7, -830.7, -2609.2, 78.9], [-2609.2, -745.3, -2704.0, -135.9, -2832.8, -106.4, -2846.0, -103.4, -3476.6, 45.9, -3614.0, 78.9, -3598.3, -58.5, -3596.3, -183.4, -3594.5, -271.7, -3606.4, -370.8, -3618.1, -488.1, -3650.9, -707.5, -3668.7, -827.9, -3669.7, -830.7, -3016.1, -743.8, -2975.6, -748.3, -2973.7, -774.5, -2765.4, -775.2, -2771.4, -744.7]], // BU02280403 De Venen en Zanden
  ['enka', 0, [23.5, 2039.8, 1726.1, 2974.0], [772.4, 2233.6, 1726.1, 2525.5, 1684.3, 2620.2, 1553.7, 2908.1, 1551.0, 2913.5, 997.2, 2934.4, 697.8, 2944.3, 392.5, 2957.7, 243.3, 2964.1, 149.3, 2973.3, 113.4, 2974.0, 50.2, 2970.7, 23.5, 2506.9, 127.3, 2039.8]], // BU02281004 Enka
  ['veldhuizen', 0, [-2395.4, -404.5, -1752.1, 352.7], [-1752.1, 191.3, -2013.4, 296.4, -2153.0, 352.7, -2395.4, -235.1, -1996.5, -400.4, -1986.6, -404.5]], // BU02280301 De Horsten
  ['veldhuizen', 1, [-1986.6, -516.5, -1356.5, 191.3], [-1490.1, -513.2, -1439.4, -200.1, -1356.5, 12.7, -1752.1, 191.3, -1986.6, -404.5, -1860.6, -456.7, -1786.8, -492.8, -1633.2, -516.5]], // BU02280302 De Burgen
  ['veldhuizen', 2, [-2013.4, 12.7, -1151.7, 881.5], [-1833.4, 881.5, -1868.6, 663.1, -2012.8, 298.2, -2013.4, 296.4, -1752.1, 191.3, -1356.5, 12.7, -1227.7, 273.2, -1197.0, 431.5, -1151.7, 615.6, -1488.5, 798.9]], // BU02280303 De Steinen
  ['veldhuizen', 3, [-2701.0, 296.4, -1748.7, 1479.8], [-1833.4, 881.5, -1748.7, 1479.8, -2676.7, 1197.6, -2701.0, 983.0, -2585.9, 670.2, -2487.7, 699.7, -2414.1, 663.2, -2367.2, 500.7, -2387.6, 444.1, -2346.9, 435.0, -2300.5, 415.7, -2153.0, 352.7, -2013.4, 296.4, -2012.8, 298.2, -1868.6, 663.1]], // BU02280305 De Dalen
  ['veldhuizen', 4, [-3679.9, -106.4, -2585.9, 1197.6], [-2585.9, 670.2, -2701.0, 983.0, -2676.7, 1197.6, -3017.2, 1094.1, -3679.9, 892.8, -3587.6, 493.4, -3606.6, 290.1, -3614.0, 78.9, -3476.6, 45.9, -2846.0, -103.4, -2832.8, -106.4, -2729.9, 143.5, -2685.8, 279.5, -2810.1, 326.9, -2896.0, 402.3, -2817.1, 596.5]], // BU02280306 De Velden en Beken
  ['veldhuizen', 5, [-2896.0, -235.1, -2153.0, 699.7], [-2153.0, 352.7, -2300.5, 415.7, -2346.9, 435.0, -2387.6, 444.1, -2367.2, 500.7, -2414.1, 663.2, -2487.7, 699.7, -2585.9, 670.2, -2817.1, 596.5, -2896.0, 402.3, -2810.1, 326.9, -2685.8, 279.5, -2729.9, 143.5, -2832.8, -106.4, -2704.0, -135.9, -2565.6, -167.7, -2456.7, -209.7, -2395.4, -235.1]], // BU02280307 De Hoven
  ['rietkampen', 0, [-2766.4, 2016.4, -1625.8, 2531.6], [-1627.7, 2445.3, -2469.2, 2531.6, -2498.6, 2491.1, -2709.1, 2514.0, -2711.4, 2302.9, -2727.3, 2301.7, -2766.4, 2016.4, -2678.7, 2025.4, -2636.4, 2037.3, -2596.5, 2059.4, -2389.9, 2138.8, -2260.1, 2235.9, -2092.8, 2345.8, -1969.2, 2404.4, -1820.4, 2417.5, -1632.6, 2390.8, -1625.8, 2445.1]], // BU02281201 De Parken
  ['rietkampen', 1, [-2545.5, 2445.3, -1573.3, 3028.1], [-1573.3, 2652.8, -1705.2, 3028.1, -1745.2, 3014.7, -2221.5, 2837.4, -2545.5, 2691.2, -2469.2, 2531.6, -1627.7, 2445.3, -1612.7, 2550.4]], // BU02281202 De Dreven
  ['rietkampen', 2, [-2401.7, 2652.8, -1404.4, 3486.5], [-2401.7, 3225.6, -2221.5, 2837.4, -1745.2, 3014.7, -1705.2, 3028.1, -1573.3, 2652.8, -1539.6, 2740.4, -1485.6, 2972.0, -1453.1, 3150.4, -1404.4, 3486.5, -1443.0, 3480.6, -1624.0, 3449.3, -1791.4, 3414.9, -2015.5, 3355.0, -2206.9, 3294.0]], // BU02281203 De Singels
  ['rietkampen', 3, [-2987.3, 2301.7, -2221.5, 3225.6], [-2469.2, 2531.6, -2545.5, 2691.2, -2221.5, 2837.4, -2401.7, 3225.6, -2542.2, 3175.4, -2746.5, 3067.3, -2702.4, 2987.9, -2685.5, 2938.6, -2683.3, 2888.4, -2674.3, 2842.5, -2642.5, 2806.7, -2862.8, 2682.9, -2949.5, 2630.4, -2982.0, 2588.2, -2987.3, 2325.3, -2877.8, 2313.0, -2784.1, 2307.7, -2727.3, 2301.7, -2711.4, 2302.9, -2709.1, 2514.0, -2498.6, 2491.1]], // BU02281204 De States
].map(([district, alternate, bounds, ring]) => ({ district, alternate, bounds, polygon: toPts(ring) }));

export const EDE_SHED_HEIGHT = 2.65;

export function isEdeShed(building, area) {
  if (!building || building.part || area < 3) return false;
  if (['shed', 'garage', 'garages', 'barn'].includes(building.kind)) return area <= 60;
  return building.kind === 'yes' && !building.name && building.heightSource === 'default'
    && area >= 5 && area <= 24;
}

// Bay spacing (m), storey height (m), window width and height as fractions of a bay.
export const EDE_FACADE_STYLES = {
  kernhem: { palette: [0x995a45, 0x9e5f49, 0x955541], layout: [2.9, 2.85, 0.60, 0.56] },
  enka: { palette: [0x8b503d, 0x87503f], layout: [2.65, 3.05, 0.46, 0.72] },
  veldhuizen: { palette: [0xad8668, 0xa17f64, 0xa98569], layout: [3.15, 2.8, 0.67, 0.51] },
  veldhuizenFlats: { palette: [0xa79e8d, 0xafa594], layout: [3.4, 2.8, 0.82, 0.50] },
  rietkampen: { palette: [0xb18b67, 0xbb956f, 0xb08a6f, 0xba9578], layout: [3.25, 2.75, 0.64, 0.50] },
  prewar: { palette: [0x8c503d, 0x9b5844, 0x975b44], layout: [2.65, 3.05, 0.50, 0.67] },
  postwar: { palette: [0xa26248, 0xad7655, 0xb38b68], layout: [2.95, 2.8, 0.64, 0.54] },
  latePostwar: { palette: [0xa68b73, 0x9d7360, 0xb09877], layout: [3.25, 2.85, 0.72, 0.49] },
  woonerf: { palette: [0x9c654e, 0xb78e65, 0xa97e61], layout: [3.2, 2.75, 0.62, 0.50] },
  contemporary: { palette: [0xa26851, 0xbb926e, 0x886151], layout: [3.05, 2.9, 0.63, 0.61] },
  defaultBrick: { palette: [0x9e6952, 0xae805f, 0xa5745b], layout: [3.05, 2.85, 0.60, 0.55] },
  outbuilding: { layout: [3, 2.8, 0, 0] },
  shed: { layout: [3, EDE_SHED_HEIGHT, 0, 0] }
};

const KERNHEM_TERRACOTTA = [0xb85b36, 0xbd623c, 0xb65b3a];

const PLAIN_WALL_KINDS = new Set([
  'barn', 'cathedral', 'chapel', 'church', 'farm_auxiliary', 'garage', 'garages', 'greenhouse', 'industrial',
  'mosque', 'parking', 'roof', 'service', 'shed', 'storage_tank', 'warehouse'
]);

function buildingPeriod(year, height) {
  if (!year) return 'defaultBrick';
  if (year < 1945) return 'prewar';
  if (year < 1965) return 'postwar';
  if (year < 1975) return height >= 14 ? 'veldhuizenFlats' : 'latePostwar';
  if (year < 1990) return 'woonerf';
  return 'contemporary';
}

function streetPaletteIndex(x, z) {
  const street = nearestEdeRoad(x, z, 45)?.road.name;
  if (!street) return Math.abs(Math.floor(x / 180) + Math.floor(z / 180) * 31);
  let hash = 0;
  for (let i = 0; i < street.length; i++) hash = Math.imul(hash, 31) + street.charCodeAt(i) | 0;
  return hash >>> 0;
}

export function edeFacadeAt(x, z, height, year, kind) {
  const region = regions.find(({ bounds: [minX, minZ, maxX, maxZ], polygon }) =>
    x >= minX && z >= minZ && x <= maxX && z <= maxZ && pointInPoly(polygon, x, z));
  const district = region?.district;
  const alternate = region?.alternate ?? streetPaletteIndex(x, z);
  const family = district === 'veldhuizen' && height >= 14 ? 'veldhuizenFlats' : district || buildingPeriod(year, height);
  const { palette } = EDE_FACADE_STYLES[family];
  const plain = PLAIN_WALL_KINDS.has(kind) || height < 4 && (!kind || kind === 'yes');
  const style = plain ? 'outbuilding' : family;
  // The roof samples put the shift to dark tiles near x = -3100 in Kernhem B-West.
  const roofColor = district === 'kernhem' && height >= 4
    ? (x < -3100 ? 0x4a4849 : KERNHEM_TERRACOTTA[alternate]) : null;
  return { district, style, color: palette[alternate % palette.length], layout: EDE_FACADE_STYLES[style].layout, roofColor };
}
