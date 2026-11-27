const sites = [
  {
    id: 'blauw-geel-grandstand', name: 'Blauw Geel ’55 grandstand', road: 'Peppelensteeg', district: 'Veldhuizen',
    approach: { x: -2013.5, z: 1211.1 },
    stand: {
      front: [[-2012.75, 1213.65], [-2010.15, 1233.85]], depth: 4.6, floor: 0.86,
      frontRoof: 5.21, rearRoof: 4.68, rows: [[16, 16], [16, 16], [16, 16], [14, 17], [14, 17]],
      roof: 0xb6b9b5, frame: 0x697575, seats: [0x195197, 0xe9c725], booth: 'end', bays: 5,
    },
  },
  {
    id: 'lunteren-grandstand', name: 'VV Lunteren grandstand', road: 'Wormshoefweg', district: 'Lunteren',
    osmId: 'w271849505', bagIds: ['0228100000016704'], approach: { x: -3894.4, z: -5320.4 },
    stand: {
      front: [[-3893.494, -5317.866], [-3886.088, -5285.513]], depth: 4.14, floor: 1.02,
      frontRoof: 4.84, rearRoof: 4.10, rows: Array.from({ length: 5 }, () => [30, 30]),
      roof: 0x939893, frame: 0x282d2d, seats: [0xe9bd21, 0x272b2b], booth: 'center', bays: 6,
      annex: {
        height: 3.32,
        outline: [[-3902.38,-5307.64],[-3898.57,-5291],[-3895.59,-5291.66],[-3895.49,-5291.24],
          [-3891.98,-5292.02],[-3890.28,-5284.59],[-3890.01,-5284.64],[-3897.41,-5316.97],
          [-3897.68,-5316.91],[-3897.31,-5315.29],[-3900.81,-5314.48],[-3899.40,-5308.30]],
      },
    },
  },
];

export const EDE_SPORT_STAND_SITES = sites.map(site => {
  const [a, b] = site.stand.front;
  return {
    ...site, worldSpace: true, height: site.stand.frontRoof,
    x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2,
  };
});
