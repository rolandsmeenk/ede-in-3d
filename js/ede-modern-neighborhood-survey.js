// Stepped terrace outlines fitted to the OSM footprints and PDOK orthophoto.
// OSM © OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright
// 3DBAG LoD 2.2 roof heights and club footprint © tudelft3d and 3DGI under CC BY 4.0.
// https://docs.3dbag.nl/en/copyright/
// Coordinates in Oude Kerk scene metres, Y relative to 22.54 m NAP.

const south = [
  [1554.5,1041.2], [1532.1,1044.4], [1531.4,1044.4], [1531,1044.4], [1530,1044.3],
  [1529,1043.9], [1528,1043.3], [1527.3,1042.7], [1526.8,1042.1], [1526.4,1041.3],
  [1526,1040.5], [1525.9,1039.7], [1522.6,1016.2], [1522.2,1013.7], [1522.2,1013.3],
  [1522.3,1012.9], [1522.5,1012.3], [1522.8,1012], [1523,1011.8], [1523.3,1011.6],
  [1523.7,1011.5], [1524.2,1011.4], [1524.6,1011.4], [1525,1011.5], [1525.4,1011.7],
  [1525.8,1012], [1537.9,1018.2], [1539.4,1019.3], [1540.5,1020.6], [1541.2,1022.3],
  [1541.4,1023.8], [1542.3,1030.8], [1542.6,1031.2], [1554.9,1037.4], [1555.4,1037.8],
  [1556,1038.5], [1556.1,1039.2], [1556.1,1040], [1555.7,1040.7], [1555.2,1041.1],
];
const north = [
  [1575,1029.1], [1574.5,1030.2], [1573.7,1030.8], [1572.4,1031.1], [1571.1,1030.9],
  [1559.5,1019.9], [1558.8,1018.7], [1558.3,1017.4], [1558.2,1015.9], [1559.9,1005.2],
  [1550.7,996.9], [1550.4,996.6], [1550.3,996.4], [1550.1,996.1], [1550.1,995.8],
  [1550,995.4], [1550,995], [1550.1,994.7], [1550.3,994.4], [1550.5,994],
  [1550.8,993.7], [1551.2,993.5], [1551.5,993.4], [1551.9,993.3], [1552.3,993.3],
  [1574.5,996.9], [1575.4,997.1], [1576.3,997.4], [1577,997.9], [1577.1,997.9],
  [1577.7,998.5], [1578.2,999.1], [1578.7,999.8], [1579,1000.6], [1579.2,1001.4],
  [1579.3,1002.3], [1579.2,1003.2],
];
const upperSouth = [
  ...south.slice(12, 32),
  [1542.13,1032.27], [1542.10,1033.17], [1541.58,1033.94], [1540.64,1034.27],
  [1527.18,1036.17], [1526.29,1036.14], [1525.64,1035.72], [1525.28,1035.09], [1524.94,1033.90],
];
const upperNorth = [
  ...north.slice(0, 10),
  [1561.25,1004.97], [1561.6,1004.41], [1562.25,1004.17], [1563.08,1004.2],
  [1577.36,1006.48], [1578.04,1006.77], [1578.41,1007.18],
];
const clubhouse = [
  [539.05,-597.69], [573.59,-585.25], [569.32,-573.24], [534.71,-585.69],
];

export const PARK_VILLAS = [
  { footprint: south, upper: upperSouth, center: [1534.8, 1026.7], base: 22.48, roof: 40.50,
    setback: [1539.71, 1043.34, 1542.85, 1034.03], terraceCorners: [[1524.3, 1013.5], [1552.3, 1038.7]] },
  { footprint: north, upper: upperNorth, center: [1570.2, 1013.4], base: 22.48, roof: 40.53,
    setback: [1567.64, 995.83, 1562.35, 1003.16], terraceCorners: [[1552.1, 995.5], [1572.6, 1029.5]] },
];

export const MHC_FOOTPRINT = clubhouse;

const footprint = points => ({ outer: points.map(([x, z]) => ({ x, z })), holes: [] });

export const EDE_MODERN_NEIGHBORHOOD_LANDMARKS = [
  { id: 'de-verbinding', name: 'De Verbinding', district: 'Simon Stevin', road: 'Elbert Veenendaalhof',
    osmId: 'w1178511841', annexOsmIds: ['w1178511842', 'w1490918512'], bagIds: ['0228100000081907'],
    x: 1551, z: 1018.3, height: 18.05, worldSpace: true,
    approach: { x: 1521.8, z: 989.2 }, surveyFootprints: [footprint(south), footprint(north)] },
  { id: 'mhc-ede', name: 'MHC Ede · Clubhuis', district: 'Bosrand', road: 'Bosrand',
    osmId: 'w271602337', bagIds: ['0228100000079507'], x: 554.15, z: -585.47,
    height: 7.97, worldSpace: true, approach: { x: 576.5, z: -572.9 },
    surveyFootprints: [footprint(clubhouse)] },
];
