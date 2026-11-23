// Reusable Hallehuis farm building – survey data for each OSM building marked kind:"farm".
// Inspiration: Boerderij Pothoven (De Brand, Rijksmonument 14460, Lunterseweg 40),
//              Boerderij Hoekelum (Rijksmonument 514052, Edeseweg 122),
//              Concordia-hallehuis (Rijksmonumenten 527721/527722, Accesweg),
//              Boerderij De Driehoek (Rijksmonument 14451, Centrum Ede).
// Footprint ring coordinates are in the Oude Kerk scene frame (22.54 m NAP origin, EPSG:7415 projected).
// Heights are in scene-space metres above 22.54 m NAP (ground = NAP_elevation − 22.54).
// Building w271473151 (Hoekelum) is already modelled in ede-restaurant-estate-survey.js and is excluded here.

// ─── Helper: build a simple extruded box face list from a planar ring + heights ──────────────────
// Each survey entry has the same structure as WEST_EXPANSION_SURVEYS entries that use `outline`:
//   kind, bagId, osmId, ground (scene Y of grade), wallColor, roofColor, outline (footprint polygon)
//   plus a compact `points` array and `faces` array in 3DBAG LoD 2.2 style.
// For procedurally-generated geometry we store the building ring directly and derive wall faces in
// createFarmBuilding().  The barn companion footprint (w1328215895 adjacent to De Brand, etc.) is
// handled as a second survey entry.

// ─── De Brand · Pothoven (Lunterseweg 40, Bennekom) ──────────────────────────────────────────────
// OSM: w271586553  BAG: 0228100000037083  Rijksmonument 14460  Wikidata: Q17366502
// Brick T-plan hallehuis with hip-thatched roof; adjacent brick schuur with wolfdak.
// Companion outbuilding w1328215895 (BAG 0228100000037057) is the schuur footprint.
export const FARM_SURVEYS = {
  'de-brand': [
    {
      kind: 'farmhouse',
      bagId: '0228100000037083',
      osmId: 'w271586553',
      // Ground ~ 20 m NAP at Bennekom → scene_y = 20 − 22.54 = −2.54; use −3.1 (surveyed from AHN3)
      ground: -3.1,
      wallColor: 0x7a5542,  // warm red-brown Veluwse baksteen
      roofColor: 0x7d6e55,  // rietdek / thatch
      // 10-vertex OSM ring in scene frame
      outline: [[
        [-1617.9, -1159.5], [-1609.3, -1170.9], [-1609.9, -1171.3],
        [-1605.5, -1176.9], [-1590.2, -1165.2], [-1592.5, -1162.4],
        [-1596.6, -1165.4], [-1598.5, -1162.8], [-1599.3, -1163.4],
        [-1608.1, -1152.2],
      ]],
      // Extruded 3D shell: walls + simple hip-roof crown, all in scene coords.
      // Wall top at ground + 4.8 m (eave height). Ridge at ground + 7.2 m.
      // These are pre-computed from the outline ring (see build-ede-farm-survey.py).
      wallTop: 4.8,
      ridgeHeight: 7.2,
    },
    {
      kind: 'barn',
      bagId: '0228100000037057',   // adjacent schuur (w1328215895)
      osmId: 'w1328215895',
      ground: -3.1,
      wallColor: 0x6b4e3d,
      roofColor: 0x726352,         // rietdek wolfdak
      outline: [[
        [-1601.5, -1162.0], [-1596.0, -1168.5], [-1593.0, -1166.0],
        [-1598.6, -1159.5],
      ]],
      wallTop: 3.6,
      ridgeHeight: 5.4,
    },
  ],

  // ─── Heuvelseweg farm (Doesburger Eng) ─────────────────────────────────────────────────────────
  // OSM: w271719274  BAG: 0228100000051628  built ~1975, half-hipped roof, 1 level
  // Brick long-house with half-hipped pan-tile roof; adjacent farm_auxiliary outbuildings.
  'heuvelseweg-boerderij': [
    {
      kind: 'farmhouse',
      bagId: '0228100000051628',
      osmId: 'w271719274',
      // Doesburger Eng is at ~24 m NAP → scene_y = 24 − 22.54 = +1.46; use +1.1 (AHN3)
      ground: 1.1,
      wallColor: 0x7a6050,
      roofColor: 0x4f4a47,         // antraciet dakpan half-hipped
      outline: [[
        [-4023.2, -3420.8], [-3988.0, -3426.0], [-3987.6, -3426.1],
        [-3981.6, -3427.0], [-3962.7, -3429.8], [-3958.8, -3403.2],
        [-4019.3, -3394.2],
      ]],
      wallTop: 3.6,
      ridgeHeight: 5.4,
    },
    {
      kind: 'barn',
      bagId: '0228100000016620',   // w271719200 farm_auxiliary
      osmId: 'w271719200',
      ground: 1.1,
      wallColor: 0x5a5048,
      roofColor: 0x4a4845,
      outline: [[
        [-4048.4, -3415.6], [-4030.3, -3418.1], [-4030.1, -3414.5],
        [-4048.2, -3412.0],
      ]],
      wallTop: 3.2,
      ridgeHeight: 4.8,
    },
  ],

  // ─── Oud Willigerweg farm (Lunteren) ───────────────────────────────────────────────────────────
  // OSM: w271892146  BAG: 0228100000024693  built ~1930
  // Brick hallehuis-type, pannen dak.  Adjacent: w271891537 (secondary outbuilding).
  'oud-willigerweg-boerderij': [
    {
      kind: 'farmhouse',
      bagId: '0228100000024693',
      osmId: 'w271892146',
      // Lunteren is at ~12 m NAP → scene_y = 12 − 22.54 = −10.54; use −10.3 (AHN3 smoothed)
      ground: -10.3,
      wallColor: 0x7a5a48,
      roofColor: 0x52403a,         // donkere pannen
      outline: [[
        [3837.7, -10445.0], [3838.8, -10440.4], [3842.8, -10441.3],
        [3843.5, -10438.2], [3851.9, -10440.1], [3850.5, -10446.3],
        [3849.5, -10450.9], [3841.1, -10448.9], [3841.8, -10445.9],
      ]],
      wallTop: 4.5,
      ridgeHeight: 7.0,
    },
    {
      kind: 'barn',
      bagId: null,
      osmId: 'w271891537',
      ground: -10.3,
      wallColor: 0x635245,
      roofColor: 0x504540,
      outline: [[
        [3836.2, -10443.8], [3837.6, -10437.0], [3835.0, -10436.4],
        [3833.6, -10443.2],
      ]],
      wallTop: 3.4,
      ridgeHeight: 5.0,
    },
  ],

  // ─── Boerderij Engelenhove (Kernhemseweg 6, Kernhem) ───────────────────────────────────────────
  // Rijksmonument (RM) from 1756; historic middenlangsdeeltype hallehuisboerderij.
  // OSM: w1463709461 (house) + w1463709690 (schuur).
  'boerderij-engelenhove': [
    {
      kind: 'farmhouse',
      bagId: null,
      osmId: 'w1463709461',
      ground: -5.5,
      wallColor: 0x825a46,
      roofColor: 0x7a6c55,         // rietdek
      outline: [[
        [-1019.2, -924.2], [-1028.9, -915.5], [-1042.6, -931.0], [-1032.9, -939.7],
      ]],
      wallTop: 4.5,
      ridgeHeight: 7.2,
    },
    {
      kind: 'barn',
      bagId: null,
      osmId: 'w1463709690',
      ground: -5.5,
      wallColor: 0x635043,
      roofColor: 0x4a4744,         // pannen
      outline: [[
        [-1027.7, -936.7], [-1015.0, -947.4], [-1005.3, -936.0],
        [-1016.2, -926.5], [-1020.8, -931.9], [-1023.9, -935.5], [-1025.4, -934.2],
      ]],
      wallTop: 3.5,
      ridgeHeight: 5.4,
    },
  ],

  // ─── Boerderij De Slijpkruik (Slijpkruikweg 54, Kernhem) ────────────────────────────────────────
  // Rijksmonument with medieval origins (1359); authentic hallehuis farmhouse + barn.
  // OSM: w271548742 (farmhouse) + w271547213 (schuur).
  'boerderij-slijpkruik': [
    {
      kind: 'farmhouse',
      bagId: null,
      osmId: 'w271548742',
      ground: -4.5,
      wallColor: 0x7e5743,
      roofColor: 0x766852,         // rieten wolfdak
      outline: [[
        [-1132.7, -438.9], [-1107.7, -441.5], [-1106.5, -428.9], [-1130.5, -426.6],
      ]],
      wallTop: 4.6,
      ridgeHeight: 7.4,
    },
    {
      kind: 'barn',
      bagId: null,
      osmId: 'w271547213',
      ground: -4.5,
      wallColor: 0x5e4f44,
      roofColor: 0x4d4946,
      outline: [[
        [-1144.6, -439.6], [-1139.0, -440.4], [-1138.2, -435.5], [-1143.9, -435.0],
      ]],
      wallTop: 3.2,
      ridgeHeight: 4.8,
    },
  ],

  // ─── Boerderij Bouwhuis (Lunterseweg 24) ───────────────────────────────────────────────────────
  // Historic Veluwse hallehuis on Lunterseweg.
  // OSM: w271587954 (farmhouse) + w271587071 (schuur).
  'boerderij-bouwhuis': [
    {
      kind: 'farmhouse',
      bagId: null,
      osmId: 'w271587954',
      ground: -5.5,
      wallColor: 0x7d5644,
      roofColor: 0x786a54,
      outline: [[
        [-1167.6, -910.0], [-1155.6, -913.8], [-1156.0, -914.7],
        [-1149.3, -916.9], [-1145.1, -903.4], [-1163.7, -897.3],
      ]],
      wallTop: 4.4,
      ridgeHeight: 7.0,
    },
    {
      kind: 'barn',
      bagId: null,
      osmId: 'w271587071',
      ground: -5.5,
      wallColor: 0x5c4d43,
      roofColor: 0x484643,
      outline: [[
        [-1202.3, -912.2], [-1197.3, -913.9], [-1195.9, -909.3], [-1200.8, -907.7],
      ]],
      wallTop: 3.2,
      ridgeHeight: 4.8,
    },
  ],

  // ─── Boerderij Kalverkamp (Lunterseweg) ────────────────────────────────────────────────────────
  // Historic farmhouse complex on Lunterseweg.
  // OSM: w271587817 (farmhouse) + w271586880 (schuur).
  'boerderij-kalverkamp': [
    {
      kind: 'farmhouse',
      bagId: null,
      osmId: 'w271587817',
      ground: -4.5,
      wallColor: 0x795543,
      roofColor: 0x726450,
      outline: [[
        [-1440.8, -750.5], [-1426.5, -753.9], [-1421.5, -735.3],
        [-1434.0, -732.3], [-1436.9, -744.4], [-1439.2, -743.8],
      ]],
      wallTop: 4.4,
      ridgeHeight: 6.8,
    },
    {
      kind: 'barn',
      bagId: null,
      osmId: 'w271586880',
      ground: -4.5,
      wallColor: 0x5b4c42,
      roofColor: 0x494644,
      outline: [[
        [-1395.7, -760.7], [-1391.4, -761.6], [-1389.7, -754.2], [-1394.0, -753.3],
      ]],
      wallTop: 3.2,
      ridgeHeight: 4.8,
    },
  ],

  // ─── Memelinkhoeve (Meulunteren / Lunteren-Noord) ──────────────────────────────────────────────
  // Northern rural farmhouse complex in Meulunteren landscape.
  // OSM: w271890326 (farmhouse) + w271890674 (schuur).
  'memelinkhoeve': [
    {
      kind: 'farmhouse',
      bagId: null,
      osmId: 'w271890326',
      ground: -8.5,
      wallColor: 0x7a5845,
      roofColor: 0x524640,         // pannen
      outline: [[
        [4775.1, -9562.3], [4789.5, -9569.9], [4804.8, -9540.7], [4790.4, -9533.1],
      ]],
      wallTop: 4.6,
      ridgeHeight: 7.2,
    },
    {
      kind: 'barn',
      bagId: null,
      osmId: 'w271890674',
      ground: -8.5,
      wallColor: 0x5e4f43,
      roofColor: 0x484442,
      outline: [[
        [4756.5, -9530.1], [4761.0, -9532.4], [4765.1, -9524.5], [4760.6, -9522.1],
      ]],
      wallTop: 3.4,
      ridgeHeight: 5.0,
    },
  ],

  // ─── Roodselaar's Hoeve (Walderveen / Ederveen-Noord) ──────────────────────────────────────────
  // Traditional hallehuis in the northwest agricultural zone.
  // OSM: w271591138 (farmhouse) + w271591466 (schuur).
  'roodselaar-hoeve': [
    {
      kind: 'farmhouse',
      bagId: null,
      osmId: 'w271591138',
      ground: -15.5,
      wallColor: 0x7d5a47,
      roofColor: 0x756752,         // rietdek
      outline: [[
        [-7285.2, -3057.1], [-7280.7, -3063.8], [-7280.0, -3063.3],
        [-7273.5, -3072.9], [-7274.2, -3073.4], [-7269.7, -3080.0],
        [-7260.2, -3073.5], [-7264.6, -3066.9], [-7265.3, -3067.4],
        [-7271.8, -3057.8], [-7271.1, -3057.3], [-7275.6, -3050.7],
      ]],
      wallTop: 4.6,
      ridgeHeight: 7.2,
    },
    {
      kind: 'barn',
      bagId: null,
      osmId: 'w271591466',
      ground: -15.5,
      wallColor: 0x5a4d43,
      roofColor: 0x4a4744,
      outline: [[
        [-7271.2, -3096.4], [-7259.7, -3113.4], [-7249.7, -3106.6], [-7261.2, -3089.6],
      ]],
      wallTop: 3.4,
      ridgeHeight: 5.0,
    },
  ],
};

// Site descriptors — these are the EDE_MODELED_LANDMARKS entries.
// w271473151 (Hoekelum) is excluded; it is already modelled in ede-restaurant-estate-survey.js.
export const EDE_FARM_LANDMARKS = [
  {
    id: 'de-brand',
    name: 'Boerderij Pothoven · De Brand',
    district: 'Bennekom',
    road: 'Lunterseweg',
    osmId: 'w271586553',
    annexOsmIds: ['w1328215895'],
    bagIds: ['0228100000037083', '0228100000037057'],
    x: -1604.1, z: -1164.6,
    height: 7.2,
    worldSpace: true,
    approach: { x: -1620, z: -1148 },
  },
  {
    id: 'heuvelseweg-boerderij',
    name: 'Boerderij Heuvelseweg',
    district: 'Doesburger Eng',
    road: 'Heuvelseweg',
    osmId: 'w271719274',
    annexOsmIds: ['w271719200'],
    bagIds: ['0228100000051628', '0228100000016620'],
    x: -3991.0, z: -3412.0,
    height: 5.4,
    worldSpace: true,
    approach: { x: -3970, z: -3395 },
  },
  {
    id: 'oud-willigerweg-boerderij',
    name: 'Boerderij Oud Willigerweg',
    district: 'Lunteren',
    road: 'Oud Willigerweg',
    osmId: 'w271892146',
    annexOsmIds: ['w271891537'],
    bagIds: ['0228100000024693'],
    x: 3844.8, z: -10444.5,
    height: 7.0,
    worldSpace: true,
    approach: { x: 3860, z: -10430 },
  },
  {
    id: 'boerderij-engelenhove',
    name: 'Boerderij Engelenhove',
    district: 'Kernhem',
    road: 'Kernhemseweg',
    osmId: 'w1463709461',
    annexOsmIds: ['w1463709690'],
    x: -1030.9, z: -927.6,
    height: 7.2,
    worldSpace: true,
    approach: { x: -1015, z: -910 },
  },
  {
    id: 'boerderij-slijpkruik',
    name: 'Boerderij De Slijpkruik',
    district: 'Kernhem',
    road: 'Slijpkruikweg',
    osmId: 'w271548742',
    annexOsmIds: ['w271547213'],
    x: -1119.3, z: -434.0,
    height: 7.4,
    worldSpace: true,
    approach: { x: -1100, z: -420 },
  },
  {
    id: 'boerderij-bouwhuis',
    name: 'Boerderij Bouwhuis',
    district: 'Lunterseweg',
    road: 'Lunterseweg',
    osmId: 'w271587954',
    annexOsmIds: ['w271587071'],
    x: -1156.2, z: -909.4,
    height: 7.0,
    worldSpace: true,
    approach: { x: -1140, z: -895 },
  },
  {
    id: 'boerderij-kalverkamp',
    name: 'Boerderij Kalverkamp',
    district: 'Lunterseweg',
    road: 'Lunterseweg',
    osmId: 'w271587817',
    annexOsmIds: ['w271586880'],
    x: -1433.2, z: -743.4,
    height: 6.8,
    worldSpace: true,
    approach: { x: -1415, z: -730 },
  },
  {
    id: 'memelinkhoeve',
    name: 'Memelinkhoeve',
    district: 'Meulunteren',
    road: 'Meulunterseweg',
    osmId: 'w271890326',
    annexOsmIds: ['w271890674'],
    x: 4790.0, z: -9551.5,
    height: 7.2,
    worldSpace: true,
    approach: { x: 4805, z: -9535 },
  },
  {
    id: 'roodselaar-hoeve',
    name: "Roodselaar's Hoeve",
    district: 'Walderveen',
    road: 'Renswoudsestraatweg',
    osmId: 'w271591138',
    annexOsmIds: ['w271591466'],
    x: -7272.7, z: -3065.3,
    height: 7.2,
    worldSpace: true,
    approach: { x: -7255, z: -3050 },
  },
];
