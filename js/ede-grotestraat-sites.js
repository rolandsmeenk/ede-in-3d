// Street-facing BAG wall segments for Grotestraat 27–57. The endpoints are in scene metres.
// The street photos guide finishes and shop divisions. Display props and hidden depths are representative.
export const GROTESTRAAT_SHOPS = [
  { name: 'Snoopies', a: [-99.55, 156.33], b: [-97.93, 150.09], fascia: '#dedbd2', text: '#a66bc2', display: 'toys' },
  { name: 'Odido', a: [-97.93, 150.09], b: [-96.34, 143.76], fascia: '#302527', text: '#ffd9b6', display: 'tech' },
  { name: 'H&M', a: [-96.15, 140.77], b: [-95.04, 137.05], fascia: '#e0dfdc', text: '#b8212c', door: 0.5 },
  { name: 'Intertoys', a: [-94.07, 133.82], b: [-91.6, 125.33], fascia: '#353233', text: '#fbd542', display: 'toys' },
  { name: 'Soxx skinwear', a: [-91.60, 125.33], b: [-90.56, 121.56], fascia: '#252728', text: '#eeeeec', door: 0.54 },
  { name: 'Pearle', a: [-90.56, 121.56], b: [-89.38, 117.3], fascia: '#e1e0dc', frame: '#26423e', text: '#265951', display: 'optics' },
  { name: 'OPEN32', a: [-88.66, 113.37], b: [-86.81, 106.90], fascia: '#28282a', text: '#f1eee9', door: 0.62 },
  { name: 'Vodafone', a: [-86.81, 106.9], b: [-85.25, 101.44], fascia: '#dbdbd7', frame: '#d0d1ce', text: '#ce3730', display: 'tech' },
  { name: 'Ziengs', a: [-85.25, 101.44], b: [-83.47, 94.71], fascia: '#523b34', text: '#ffecbb', display: 'shelves' },
  { name: 'Zuivelhoeve', a: [-81.27, 86.46], b: [-80.35, 83.14], fascia: '#3f342a', text: '#f9eadd', display: 'food', awning: 0.86 },
  { name: 'Cecil Street One', a: [-87.19, 145.03], b: [-89.35, 153.57], fascia: '#414448', text: '#f0efed', door: 0.58 },
  { name: 'ONLY', a: [-83.89, 131.69], b: [-85.86, 139.79], fascia: '#272a31', text: '#f0efea', door: 0.47 },
  { name: 'Douglas', a: [-82.66, 126.64], b: [-83.89, 131.69], fascia: '#8ac7b6', text: '#283733', display: 'optics' },
  { name: 'Rituals', a: [-81.28, 120.96], b: [-82.66, 126.64], fascia: '#332d29', text: '#ddd0b6', display: 'shelves' },
  { name: 'Shoeby', a: [-78.20, 109.59], b: [-80.55, 118.09], fascia: '#c9c4b9', text: '#322e28', awning: 0.51 },
  { name: 'HEMA', a: [-60.44, 69.46], b: [-67.10, 85.36], fascia: '#e9e7df', text: '#d13435', display: 'shelves', awning: 0.59 },
];

export function isGrotestraatPilotShop(name, x, z) {
  return x >= -105 && x <= -53 && z >= 72 && z <= 157 && GROTESTRAAT_SHOPS.some(shop => shop.name === name);
}
