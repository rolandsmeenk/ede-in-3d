// Arrivals use route positions verified in tools/data/ede-crossing-audit.md.
// Each row is [route label, player mode, local x, local z, local altitude, heading].
export const crossingTeleports = [
  ['Oosttunnel', [
    ['Upper · Platform walk', 'person', 179.51, 2092, -0.64, 1.297],
    ['Upper · Hartogspad', 'cyclist', 180.73, 2098.51, -2.18, -1.864],
    ['Lower · Passenger tunnel', 'person', 177.92, 2083.46, -7.02, -2.956],
  ]],
  ['Somatunnel', [
    ['Upper · Verlengde Blokkenweg', 'car', -1015.7, 1747.66, -6.12, 1.279],
    ['Upper · Cycle path', 'cyclist', -997.95, 1687.31, -4.96, 1.249],
    ['Lower · Cycle tunnel', 'cyclist', -1001.68, 1712.48, -9.14, 2.847],
    ['Lower · Footpath', 'person', -1005.06, 1711.46, -8.58, -0.284],
  ]],
  ['A30 railway viaduct', [
    ['Upper · A30 northbound', 'car', -3718.35, 905.22, -3.94, 2.902],
    ['Upper · A30 southbound', 'car', -3730.43, 901.6, -3.90, -0.235],
    ['Upper · East ramp', 'car', -3710.19, 907.65, -4.07, 2.923],
    ['Upper · West ramp', 'car', -3738.7, 899.13, -4.12, -0.302],
    ['Lower · Langekamppad', 'cyclist', -3705.19, 885.05, -13.96, -1.869],
  ]],
  ['Polar Bearsplein', [
    ['Upper · Forecourt approach', 'person', 129.18, 2204.63, -4.16, 1.251],
    ['Lower · Garage entrance', 'car', 137.39, 2210.62, -7, -0.331],
    ['Lower · Garage exit', 'car', 140.22, 2211.56, -7, 2.842],
  ]],
  ['Bospoorttunnel', [
    ['Upper · N224 westbound', 'car', 121.94, -631.08, 0.77, -1.736],
    ['Upper · N224 eastbound', 'car', 106.28, -614.85, 0.68, 1.322],
    ['Upper · Cycle path', 'cyclist', 97.63, -605.88, 0.32, 1.326],
    ['Lower · Cycle tunnel', 'cyclist', 106.28, -614.85, -2.50, -0.767],
  ]],
  ['Parkweidepad Zuid', [
    ['Upper · N224 eastbound', 'car', -1871.53, -454.59, -7.53, 1.968],
    ['Upper · N224 westbound', 'car', -1878.2, -470.47, -7.53, -1.180],
    ['Upper · North cycle path', 'cyclist', -1882.39, -477.29, -7.77, 1.957],
    ['Upper · South cycle path', 'cyclist', -1867.48, -444.95, -7.38, 1.975],
    ['Lower · Cycle tunnel', 'cyclist', -1871.55, -454.58, -10.73, 0.401],
    ['Lower · Footpath', 'person', -1868.79, -455.74, -10.73, 0.398],
  ]],
  ['Stadspoort', [
    ['Upper · Shopping-centre walkway', 'person', -1457.72, 3132.81, -6.63, 1.420],
    ['Lower · Dreeslaan northbound', 'car', -1457.72, 3132.81, -12.39, -3.006],
    ['Lower · Dreeslaan southbound', 'car', -1467.49, 3131.35, -12.38, 0.161],
    ['Lower · West cycle path', 'cyclist', -1475.79, 3130.11, -10.67, 0.055],
    ['Lower · East cycle path', 'cyclist', -1449.75, 3133.61, -10.70, 0.060],
  ]],
  ['Parklaan under A12', [
    ['Upper · A12 eastbound', 'car', -292.08, 3662.01, -2.51, 1.420],
    ['Upper · A12 westbound', 'car', -263.15, 3650.33, -2.23, -1.721],
    ['Lower · Road underpass', 'car', -263.15, 3650.34, -7.42, -1.192],
  ]],
  ['Baron van Wassenaertunnel', [
    ['Upper · A12 westbound', 'car', 1073.88, 3707.65, 6.31, -1.509],
    ['Upper · A12 eastbound', 'car', 1074.82, 3722.98, 6.30, 1.630],
    ['Lower · Road underpass', 'car', 1074.82, 3722.98, 0.66, -3.082],
  ]],
  ['Cycleway bridge · OSM 544853927', [
    ['Bridge deck', 'cyclist', -2283.75, 2974.65, -12.21, -1.983],
  ]],
  ['Cycleway bridge · OSM 225819919', [
    ['Bridge deck', 'cyclist', -2242.95, -260.25, -9.28, -2.749],
  ]],
  ['Footbridge · OSM 1249928597', [
    ['Bridge deck', 'person', -2232.35, 2681.95, -11.64, -1.471],
  ]],
  ['Cycleway bridge · OSM 24860907', [
    ['Bridge deck', 'cyclist', -1993.75, 3088.2, -11.16, 1.183],
  ]],
  ['Cycleway bridge · OSM 421611755', [
    ['Bridge deck', 'cyclist', -1931.5, -234.75, -8.67, -1.206],
  ]],
  ['Cycleway bridge · OSM 373643286', [
    ['Bridge deck', 'cyclist', -1817.1, 47, -8.35, 1.961],
  ]],
  ['Service passage · OSM 956231562 / 956231563', [
    ['West aisle', 'car', -1658.17, 2677.5, -10.90, 2.750],
    ['East aisle', 'car', -1643.65, 2681.75, -10.68, -2.926],
  ]],
  ['Covered path · OSM 1361789451', [
    ['Covered path', 'person', -852.8, 1869.4, -5.09, -1.406],
  ]],
  ['Luttikenerf covered passage', [
    ['Service lane', 'car', -487.5, 793.65, -1.96, 0.452],
  ]],
  ['Service passage · OSM 562784755', [
    ['Parking aisle', 'car', -334.25, -0.75, -2.72, -1.444],
  ]],
];

export function mountCrossingTeleports(menu, onTeleport) {
  const modeLabels = { car: 'Drive', cyclist: 'Cycle', person: 'Walk' };
  for (const [name, routes] of crossingTeleports) {
    const title = document.createElement('h3');
    title.className = 'pop-title';
    title.textContent = name;
    menu.append(title);
    for (const [label, mode, x, z, altitude, heading] of routes) {
      const button = document.createElement('button');
      button.className = 'pop-item';
      button.type = 'button';
      button.textContent = `${label} `;
      const modeLabel = document.createElement('span');
      modeLabel.className = 'pop-sub';
      modeLabel.textContent = modeLabels[mode];
      button.append(modeLabel);
      button.addEventListener('click', () => onTeleport(mode, x, z, heading, altitude));
      menu.append(button);
    }
  }
}
