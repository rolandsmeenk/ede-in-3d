// Reviewed Ede fuel stations in the Oude Kerk scene frame, in metres. Canopy rings are station-local.
// Geometry: OpenStreetMap contributors (ODbL), 2026-11-20 official map snapshot,
// and 2025/2026 PDOK aerial imagery for visible forecourts. Operator listings confirm brands and types.
// Pump counts and clearances are estimates unless separately noted.
// Bonnetstraat has two separate canopy wings. Radonstraat CNG uses an OSM point at a service depot.
// Double-sided price pylons generally stand at the frontage, clear of the driving and walking surfaces.
// Use footings visible in the PDOK orthophoto where identifiable and fitted verge placements elsewhere.
const PYLONS = {
  'texaco-neonstraat-4a': [-3857.5, 459.9, 2.10],
  'argos-marconistraat-11': [-2595.8, 1756.1, -0.38],
  n9922728331: [-4091.3, 1417.4, 0.65],
  n9922657147: [-4110.68, 1373.49, 2.66],
  n11658184817: [-3959.1, 671.3, -1.06],
  n12626162176: [-3431.2, 2216, 3.10],
  n274870239: [-3338.12, 1555.66, 0.55],
  n274869580: [-3184.82, 1302.15, 1.10],
  n2761384978: [-1839.9, 1889, 1.20],
  n269785004: [-1581.58, 2788.99, 0.70],
  n247847442: [-1276.2, 1176.8, -3.10],
  n10060498714: [-1192.22, 1312.99, -3.11],
  n2764896830: [-1148.8, 548.8, -2.51],
  n821116450: [-583.7, 0.2, -2.02],
  n2283543469: [-251.4, -654.4, -0.94],
  n2560675248: [-79.6, 2024.3, -1.04],
  n11658200102: [90.88, 1715.79, -0.77],
  n3124882893: [-4902.0, -4592.1, 0.08],
  n1001128866: [-2787.3, -3082.05, 0.40],
  n10819518524: [-4780.8, -6889.6, 0.60],
};

export const EDE_FUEL_SITES = [
  // Texaco BSP Neonstraat
  // https://texaco.nl/locatie/bsp-ede-neonstraat/
  {"id": "texaco-neonstraat-4a", "name": "Texaco BSP Neonstraat", "brand": "Texaco", "x": -3864.08, "z": 455.97, "heading": -0.51228, "width": 10.27, "length": 15.59, "bays": 2, "clearance": 5.05, "truck": true, "selfService": true, "palette": ["#fbfaf5", "#d92738", "#d92738"], "canopyRing": [[-5.05, -7.6], [5.13, -7.79], [5.13, 7.57], [-5.14, 7.8]]},
  // Argos Marconistraat
  // https://www.argos.nl/tankstation/argos-tankstation-ede/
  {"id": "argos-marconistraat-11", "name": "Argos Marconistraat", "brand": "Argos", "x": -2589.81, "z": 1755.43, "heading": 0.10069, "width": 7.6, "length": 10.56, "bays": 2, "clearance": 4.2, "truck": true, "selfService": true, "palette": ["#134893", "#becf39", "#f6f7eb"], "canopyRing": [[-3.8, -5.28], [3.8, -5.09], [3.72, 5.26], [-3.8, 5.28]]},
  // Greenpoint Bonnetstraat
  // https://www.greenpointfuels.nl/tankstations/greenpoint-ede/
  {"id": "n9922728331", "name": "Greenpoint Bonnetstraat", "brand": "Greenpoint", "x": -4111.9, "z": 1410.31, "heading": -1.44809, "width": 10.17, "length": 40.93, "bays": 4, "clearance": 5.1, "truck": true, "pumps": [[0, 1.5], [0, 6.5], [0, 11.5], [0, 16.5]], "palette": ["#f5f4e4", "#d3df4b", "#285642"], "canopyRing": [[-5.08, 20.45], [5.09, 20.46], [5.09, -20.47], [-5.08, -20.47]], "canopyOsmId": "w1240611369"},
  // Shell Bonnetstraat
  // https://find.shell.com/nl/fuel/13260893-shell-station-ede/nl_NL
  {"id": "n9922657147", "name": "Shell Bonnetstraat", "brand": "Shell", "x": -4094.44, "z": 1392.55, "heading": -1.43128, "width": 9.24, "length": 34.02, "bays": 3, "pumps": [[0, -13.5], [0, -8.5], [0, -3.5]], "canopyRing": [[-4.62, 17.01], [4.62, 17.01], [4.62, -17.01], [-4.62, -17.01]], "canopyOsmId": "w1240611368", "shop": {"x": -4101.36, "z": 1399.0, "heading": 1.70445, "width": 22.21, "length": 14.93, "height": 4.1, "osmId": "w1082707132", "bagId": "0228100000084165", "wordmark": "Kwajongens"}},
  // TotalEnergies CNG Express Radonstraat
  // https://www.openstreetmap.org/node/11658184817
  {"id": "n11658184817", "name": "TotalEnergies CNG Express Radonstraat", "brand": "TotalEnergies", "x": -3964.38, "z": 677.95, "heading": 0, "width": 4, "length": 7, "canopy": false, "bays": 1, "wordmark": "TotalEnergies CNG", "selfService": true},
  // Shell TruckDiesel Ede
  // https://find.shell.com/nl/fuel/10054032-std-ede/en_US
  {"id": "n12626162176", "name": "Shell TruckDiesel Ede", "brand": "Shell", "x": -3424.54, "z": 2220.01, "heading": -0.52239, "width": 8.26, "length": 19.12, "bays": 2, "wordmark": "Shell TruckDiesel", "clearance": 5.05, "truck": true, "selfService": true, "canopyRing": [[-3.81, -9.17], [4.13, -9.56], [4.13, 9.34], [-4.13, 9.56]]},
  // TinQ Galvanistraat
  // https://www.tinq.nl/tankstations/ede-galvanistraat
  {"id": "n274870239", "name": "TinQ Galvanistraat", "brand": "TinQ", "x": -3349.68, "z": 1530.27, "heading": 1.0399, "width": 12.52, "length": 37.73, "bays": 3, "selfService": true, "canopyRing": [[-6.25, -12.97], [-6.25, 18.87], [6.27, 12.79], [6.05, -18.86]], "canopyOsmId": "w1451454384"},
  // Tango Frankeneng
  // https://www.tango.nl/stations/tango-ede-frankeneng
  {"id": "n274869580", "name": "Tango Frankeneng", "brand": "Tango", "x": -3180.13, "z": 1290.83, "heading": -0.00217, "width": 10.11, "length": 15.96, "bays": 3, "selfService": true, "canopyRing": [[-5.05, -7.78], [-5.05, 7.97], [5.06, 7.98], [5.06, -7.78], [-1.9, -7.98]], "canopyOsmId": "w993038694"},
  // TinQ Lorentzstraat
  // https://www.tinq.nl/tankstations/ede-lorentzstraat
  {"id": "n2761384978", "name": "TinQ Lorentzstraat", "brand": "TinQ", "x": -1843.16, "z": 1879.88, "heading": -1.43558, "width": 9.72, "length": 18.66, "bays": 2, "selfService": true, "canopyRing": [[4.86, 9.33], [4.86, -9.26], [-4.86, -9.33], [-4.86, 9.33]], "canopyOsmId": "w1245474550"},
  // BP De Rietkampen
  // https://ok.nl/tankstations/bp-de-rietkampen/
  {"id": "n269785004", "name": "BP De Rietkampen", "brand": "BP", "x": -1564.68, "z": 2803.73, "heading": -1.25048, "width": 7.92, "length": 29.0, "bays": 4, "canopyRing": [[3.96, -14.49], [-3.95, -14.5], [-3.95, 14.49], [3.96, 14.5]], "canopyOsmId": "w271463277", "shop": {"x": -1555.26, "z": 2827.53, "heading": -2.82214, "width": 18.69, "length": 12.6, "height": 3.8, "osmId": "w271376741", "bagId": "0228100000016038", "wordmark": "OK"}},
  // SuperTank Klaphekweg
  // https://www.supertank.nl/tankstations/ede/
  {"id": "n247847442", "name": "SuperTank Klaphekweg", "brand": "SuperTank", "x": -1287.19, "z": 1183.48, "heading": -1.01186, "width": 17.02, "length": 18.93, "bays": 2, "selfService": true, "palette": ["#192127", "#ea9b28", "#f5f4f1"], "canopyRing": [[8.51, 9.47], [8.51, -9.46], [-8.51, -9.46], [-8.51, 9.47]], "canopyOsmId": "w1006239560"},
  // Esso Express Klaphekweg
  // https://www.esso.nl/nl-nl/find-station/100366818
  {"id": "n10060498714", "name": "Esso Express Klaphekweg", "brand": "Esso", "x": -1193.77, "z": 1326.33, "heading": 0.55335, "width": 5.86, "length": 11.93, "bays": 1, "wordmark": "Esso Express", "selfService": true, "canopyRing": [[2.93, 5.97], [2.93, -5.97], [-2.93, -5.96], [-2.92, 5.96]], "canopyOsmId": "w1098771684"},
  // Texaco Soembaplein
  // https://texaco.nl/locatie/texaco-ede-soembaplein/
  {"id": "n2764896830", "name": "Texaco Soembaplein", "brand": "Texaco", "x": -1147.11, "z": 560.62, "heading": -1.40496, "width": 12.12, "length": 13.33, "bays": 2, "palette": ["#fbfaf5", "#d92738", "#d92738"], "canopyRing": [[-6.05, 6.67], [6.05, 6.66], [6.05, -6.66], [-6.06, -6.66]], "canopyOsmId": "w773014424"},
  // Tango Molenstraat
  // https://www.tango.nl/stations/tango-ede-molenstraat
  {"id": "n821116450", "name": "Tango Molenstraat", "brand": "Tango", "x": -575.34, "z": 6.86, "heading": 0.11983, "width": 10.41, "length": 14.15, "bays": 2, "selfService": true, "canopyRing": [[-5.21, -7.08], [-5.21, 6.73], [5.2, 7.07], [5.1, -6.65]], "canopyOsmId": "w783908113"},
  // Shell Rijksweg
  // https://find.shell.com/nl/fuel/12690833-shell-station-ede/nl_NL
  {"id": "n2283543469", "name": "Shell Rijksweg", "brand": "Shell", "x": -260.89, "z": -666.1, "heading": -0.14379, "width": 15.72, "length": 21.21, "bays": 3, "pumpAxis": "x", "pumps": [[-1.7, 2.88], [1.35, 2.88], [4.6, 2.88]], "canopyRing": [[-7.86, -7.51], [-7.68, 5.28], [-7.78, 5.62], [7.86, 10.6], [7.86, -10.61]], "canopyOsmId": "w1152016953"},
  // TotalEnergies Express Parkweg
  // https://www.circlek.nl/station/express-parkweg
  {"id": "n2560675248", "name": "TotalEnergies Express Parkweg", "brand": "TotalEnergies", "x": -62.4, "z": 2022.9, "heading": 1.48431, "width": 7.27, "length": 8.49, "bays": 1, "wordmark": "TotalEnergies Express", "selfService": true, "pumps": [[2.2, 0]], "canopyRing": [[3.54, -4.16], [-3.64, -4.25], [-3.64, 4.13], [3.63, 4.24]], "canopyOsmId": "w1051918508"},
  // Sakko Klinkenbergerweg
  // https://www.sakkocommercial.nl/station/ede/
  {"id": "n11658200102", "name": "Sakko Klinkenbergerweg", "brand": "Sakko", "x": 70.52, "z": 1734.05, "heading": -1.39227, "width": 9.27, "length": 11.17, "bays": 2, "selfService": true, "palette": ["#f4f2e8", "#b12730", "#8c1e20"], "canopyRing": [[-4.63, -5.59], [-4.48, -0.7], [-4.63, 5.59], [4.62, 5.58], [4.62, -5.59]], "canopyOsmId": "w658520912"},
  // https://havebrandstoffen.nl/tanken-sparen/onze-tankstations/esso-de-stroet/
  { id: 'n3124882893', name: 'Esso De Stroet', brand: 'Esso', x: -4880.77, z: -4580.65, heading: 0.0936,
    width: 22.69, length: 14.77, bays: 3, pumps: [[-7, -2], [-0.1, -2], [6.8, -2]], clearance: 4.6,
    canopyOsmId: 'w1425827536', canopyRing: [[-11.32, 7.37], [-11.34, -7.39], [11.34, -7.39], [11.29, 0.54], [1.48, 0.49], [1.46, 7.39]],
    truck: true, north: true,
    shop: { x: -4888.06, z: -4566.72, heading: Math.PI + 0.0936, width: 20.02, length: 11.65, height: 3.9,
      osmId: 'w271719637', bagId: '0228100000044408', wordmark: 'CAFE HAVÉ' } },
  // https://havebrandstoffen.nl/tanken-sparen/onze-tankstations/esso-de-tol/
  { id: 'n1001128866', name: 'Esso De Tol', brand: 'Esso', x: -2799.56, z: -3113.94, heading: 0.399,
    width: 11.04, length: 23.26, bays: 4, pumps: [[0, -7.5], [0, -2.5], [0, 2.5], [0, 7.5]], clearance: 4.3,
    canopyRing: [[-5.49, -11.63], [5.43, -11.48], [5.52, 11.5], [-5.52, 11.63]], north: true,
    shop: { x: -2813.29, z: -3108.68, heading: 0.438 + Math.PI / 2, width: 8.21, length: 8.39, height: 3.6,
      osmId: 'w271717866', bagId: '0228100000048196', wordmark: 'HAVÉ' } },
  // https://havebrandstoffen.nl/tanken-sparen/onze-tankstations/esso-spelt/
  { id: 'n10819518524', name: 'Esso Spelt', brand: 'Esso', x: -4792.78, z: -6900.69, heading: 2.113,
    width: 10.06, length: 13.39, bays: 3, pumpAxis: 'x', pumps: [[-3, 0], [0, 0], [3, 0]], clearance: 4.3,
    canopyOsmId: 'w126810513', canopyRing: [[5.03, -6.69], [-4.98, -6.51], [-5.03, 6.69], [5.01, 6.63]],
    selfService: true, north: true },
].map(site => {
  const [x, z, pylonHeading] = PYLONS[site.id];
  const priceProfile = site.north ? 'lunteren'
    : ['TinQ', 'Tango', 'SuperTank'].includes(site.brand) || site.id === 'n10060498714' ? 'discount' : 'local';
  const fuels = site.id === 'n11658184817' ? ['cng']
    : site.truck && site.id !== 'argos-marconistraat-11' && !site.north ? ['diesel']
    : site.north || ['n2761384978', 'n269785004'].includes(site.id) ? ['e10', 'diesel', 'lpg'] : ['e10', 'diesel'];
  return { ...site, pylon: [x, z], pylonHeading, priceProfile, fuels };
});

// This OSM warehouse outline includes the adjoining open canopy. Retain the warehouse body.
export const EDE_FUEL_FALLBACK_FOOTPRINTS = [
  {"id": "w271178741", "ring": [-3433.2, 2226.8, -3426.3, 2231.0, -3426.3, 2231.4, -3453.8, 2276.0, -3455.8, 2274.7, -3460.3, 2282.1, -3458.3, 2283.3, -3477.1, 2313.9, -3477.2, 2314.0, -3479.2, 2312.8, -3484.1, 2320.7, -3482.1, 2322.0, -3482.1, 2322.1, -3478.2, 2324.7, -3478.1, 2324.6, -3456.2, 2338.2, -3451.2, 2330.1, -3453.3, 2328.9, -3403.3, 2247.6, -3398.0, 2250.9, -3387.2, 2233.4, -3413.8, 2216.9, -3413.8, 2216.8, -3416.6, 2215.1, -3425.51, 2230.57, -3433.02, 2226.5], "holes": []},
];
