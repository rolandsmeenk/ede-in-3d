import { EDE_DATA } from './ede-geodata.js';
import { projectLonLatInto } from './ede-scene-coordinates.js';

const project = ([lon, lat]) => projectLonLatInto(EDE_DATA.meta.lonLatAffine, lon, lat, {});

// Parkweg marker from OpenStreetMap n4803540259 (© OpenStreetMap contributors, ODbL).
// https://www.4en5mei.nl/oorlogsmonumenten/zoeken/3416/ede-monument-voor-bombardementsslachtoffers
// Amazones plinths and approaches fitted to the PDOK aerial photograph.
// https://www.oudede.nl/de-amazones-van-ede/
// The monument register's Maple Leafs address is correct. Its coordinates point outside Ede.
// https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1302/ede-maple-leafs-polar-bearsmonument
// The Molenstraat stone is in the pavement in front of the former ING at number 140.
// https://www.atlasvanede.nl/mooi-ede/cultuur/monumenten-1/struikelsteen
export const EDE_TOWN_MEMORIALS = [
  ['monument-bombardementsslachtoffers', 'Monument voor Bombardementsslachtoffers', 'Ede-Zuid', 'Parkweg',
    [5.6621374, 52.0269055], [5.6621467, 52.0269604], 4.55, 1.95, 3.03],
  ['de-amazones-van-ede', 'De Amazones van Ede', 'Enka', 'Janny Laupmanlaan',
    [5.6920596, 52.0391433], [5.6920012, 52.0391613], 2.15, 1.34, -1.1],
  ['maple-leafs-polar-bears', 'Maple Leafs-Polar Bearsmonument', 'Centrum', 'Bevrijdingsplein',
    [5.67002, 52.043739], [5.6699828, 52.0437589], 0.12, 0.08, 2.85],
  ['leijdesdorff-hoek-gedenksteen', 'Gedenksteen Leijdesdorff-Hoek', 'Centrum', 'Molenstraat',
    [5.6691282, 52.047018], [5.669142, 52.047], 1.58, 0.29, -0.22],
].map(([id, name, district, road, position, arrival, height, focusHeight, heading]) => {
  const { x, z } = project(position);
  const approach = project(arrival);
  const dx = x - approach.x, dz = z - approach.z;
  const scale = 1.8 / Math.hypot(dx, dz);
  return {
    id, name, district, road, x, z, approach, height, focusHeight, heading,
    focusOffset: [dz * scale, -dx * scale],
    mapScenic: true, worldSpace: true, surveyFootprints: [],
  };
});
