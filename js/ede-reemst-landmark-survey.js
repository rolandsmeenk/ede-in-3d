// BAG and bbox 3DBAG LoD 2.2, retrieved 2026-11-21. Surveyed NAP heights use the Oude Kerk datum.
// Dark barn and thatched house identified in the georeferenced Wikimedia photograph and current booking photos.
export const REEMST_BUILDINGS = [
  { bagId: '0228100000003294', osmId: 'w271860809', ground: 13.04, wallColor: 0x74503e, roofColor: 0x5f574c,
    outline: [[[7025.19,71.87],[7027.31,84.01],[7036.84,82.2],[7034.95,70.2]]],
    points: [
      [7034.95,13.04,70.2], [7036.84,13.04,82.2], [7027.31,13.04,84.01], [7025.19,13.04,71.87], [7033.89,13.04,82.76],
      [7030.64,13.04,83.38], [7029.59,13.04,71.12], [7031.89,20.51,82.0], [7033.02,19.55,82.43], [7033.89,18.81,82.76],
      [7025.19,16.27,71.87], [7027.31,15.82,84.01], [7030.64,19.06,83.38], [7034.95,15.4,70.2], [7029.59,20.53,71.12],
      [7036.84,15.98,82.2],
    ],
    faces: [
      [0,[10,3,2,11]], [0,[11,2,5,12]], [0,[13,0,6,14]], [0,[14,6,3,10]],
      [0,[12,5,4,9]], [0,[9,4,1,15]], [0,[15,1,0,13]], [1,[7,14,10,11,12]],
      [1,[12,9,8,7]], [1,[15,13,14,7,8,9]],
    ],
  },
  { bagId: '0228100000011145', osmId: 'w271860835', ground: 13.01, wallColor: 0x403329, roofColor: 0x454441,
    outline: [[[7042.53,61.72],[7047.25,72.36],[7056.16,68.41],[7051.46,57.65]]],
    points: [
      [7051.46,13.01,57.65], [7056.16,13.01,68.41], [7047.25,13.01,72.36], [7042.53,13.01,61.72], [7045.68,13.01,60.29],
      [7049.47,13.01,58.56], [7052.98,13.01,69.82], [7050.03,13.01,71.13], [7052.98,18.8,69.82], [7056.16,15.17,68.41],
      [7050.03,18.64,71.13], [7047.25,15.46,72.36], [7051.09,20.41,69.25], [7050.42,19.3,70.43], [7048.01,20.44,61.53],
      [7047.9,20.35,61.49], [7042.53,15.05,61.72], [7051.46,15.62,57.65], [7049.47,17.89,58.56], [7045.68,18.67,60.29],
      [7045.68,18.12,60.29], [7047.9,20.35,61.49],
    ],
    faces: [
      [0,[8,6,1,9]], [0,[10,7,6,8]], [0,[11,2,7,10]], [0,[16,3,2,11]],
      [0,[9,1,0,17]], [0,[17,0,5,18]], [0,[19,20,4,3,16]], [0,[20,19,21]],
      [0,[18,5,4,20]], [1,[8,12,13,10]], [1,[15,21,19,16,11,10,13,12,14]], [1,[14,18,20,21,15]],
      [1,[18,14,12,8,9,17]],
    ],
  },
];

// Wildkijkscherm alignments from OSM (ODbL). The north and east sides face the clearing.
export const REEMST_SCREEN = { fence: [[7524.16,127.27],[7524.35,123.81],[7514.84,121.52],[7513.29,125.29]],
  stairs: [[7514.78,126.38],[7515.74,123.22]], benches: [[7520.7,125.86],[7518.13,125.15]],
};

export const EDE_REEMST_LANDMARKS = [
  { id: 'nieuw-reemst', name: 'Boerderij Nieuw Reemst', road: 'Planken Wambuisweg', district: 'Planken Wambuis',
    x: 7031.12, z: 77.68, height: 7.49, focusHeight: 3.25, worldSpace: true, mapScenic: true,
    approach: { x: 7074.7, z: 76.6 },
    osmId: REEMST_BUILDINGS[0].osmId, annexOsmIds: [REEMST_BUILDINGS[1].osmId],
    bagIds: REEMST_BUILDINGS.map(building => building.bagId),
    surveyFootprints: REEMST_BUILDINGS.map(({ outline: [outer, ...holes] }) => ({
      outer: outer.map(([x, z]) => ({ x, z })), holes: holes.map(ring => ring.map(([x, z]) => ({ x, z }))),
    })),
  },
  { id: 'wildkijkscherm-nieuw-reemst', name: 'Wildkijkscherm Nieuw Reemst', road: 'Planken Wambuisweg',
    district: 'Planken Wambuis', osmId: 'n8069014299', x: 7519.52, z: 122.95, height: 1.8,
    approach: { x: 7514.5, z: 130.3 }, focusHeight: 1.23, worldSpace: true, mapScenic: true,
    replaceParcelSources: ['OSM:w1146967317'],
  },
];

// PDOK 2026 imagery and native AHN canopy heights. Trunks and crown widths are photo estimates.
export const REEMST_TREES = [
  { x: 7010.70, z: 67.20, height: 10.1, crownWidth: 9.5, trunkDiameter: 0.52, species: 0, sources: 8, seasonGroup: 4 },
  { x: 7014.35, z: 83.48, height: 15.0, crownWidth: 14.5, trunkDiameter: 0.78, species: 0, sources: 8, seasonGroup: 4 },
  { x: 7018.50, z: 101.14, height: 11.7, crownWidth: 11.7, trunkDiameter: 0.57, species: 0, sources: 8, seasonGroup: 4 },
];
