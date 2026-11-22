// VGGM's 2021 annual report identifies Breelaan and Argonstraat as the Ede bases.
// https://cms.vggm.nl/sites/default/files/2022-11/jaarverslag%202021%20vastgesteld%20AB%202022-04-06.pdf
// Pickups are fictional staging stops on modeled residential streets.
export const AMBULANCE_STOPS = [
  { id: 'breelaan', kind: 'base', x: -50.31, z: 529.92, wayIds: ['w6953097'], dwell: 30 },
  { id: 'ede-west', kind: 'base', x: -4096.26, z: 351.18, wayIds: ['w6959998'], dwell: 30 },
  { id: 'veldhuizen', kind: 'pickup', x: -1813.48, z: -317.21, wayIds: ['w144883236'], dwell: 18 },
  { id: 'ede-oost', kind: 'pickup', x: 306.84, z: 384.08, wayIds: ['w6953193'], dwell: 18 },
  { id: 'maandereng', kind: 'pickup', x: -1932.08, z: 2611.90, wayIds: ['w25121173'], dwell: 18 },
  {
    id: 'gelderse-vallei', kind: 'hospital', x: -1890.29, z: 2508.76, wayIds: ['w45020193'], dwell: 24,
    // Rear emergency access from Willy Brandtlaan follows OSM way 612631111 up to the ambulance entrance.
    // https://www.geldersevallei.nl/contact/locatie/ede
    path: [
      [-1890.3, 2508.6], [-1882.7, 2614.5], [-1880.2, 2620.6], [-1876, 2622.1],
      [-1865, 2621.7], [-1860.8, 2619.6], [-1858.5, 2616.2], [-1857.4, 2611.7], [-1857.6, 2608.2],
    ],
  },
];
