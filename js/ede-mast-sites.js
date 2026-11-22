export const EDE_MAST_SITES = [
  { id: 'zendmast-stevinlaan', name: 'Zendmast Stevinlaan', district: 'Frankeneng', road: 'Statenpad',
    x: -2704.90, z: 2873.59, height: 35.5, radius: 0.54, focusHeight: 15,
    approach: { x: -2650.2, z: 2805.1 } },
  { id: 'zendmast-meulunterseweg', name: 'Zendmast Meulunterseweg', district: 'Lunteren', road: 'Meulunterseweg',
    x: -2870.49, z: -6528.20, height: 35.4, radius: 1.65, lattice: true, focusHeight: 17,
    approach: { x: -2896.5, z: -6449.7 }, north: true },
  { id: 'zendmast-roekel', name: 'Zendmast Roekel', district: 'Roekel', road: 'Vossenpad',
    x: 4060.33, z: -5016.47, height: 26.1, radius: 0.52, focusHeight: 15,
    approach: { x: 4084, z: -4973.6 }, north: true },
  { id: 'zendmast-otterlo', name: 'Zendmast Otterlo-Noord', district: 'Otterlo', road: 'Apeldoornseweg',
    x: 7320.19, z: -6781.00, height: 33, radius: 0.55, focusHeight: 16,
    approach: { x: 7279.3, z: -6761.9 }, north: true },
].map(site => ({ ...site, heading: 0, surveyFootprints: [], mapScenic: true, hideOnMap: true }));
