// Shared parts for the fixtures traced in the two playground pilots. All coordinates are local metres.
const TIMBER = 0x826347;
const DARK_TIMBER = 0x493f35;
const STEEL = 0x899696;
const BLUE = 0x346983;
const RUBBER = 0x33383b;
const RAIL = 0x705234;

export function playgroundEquipment(feature, part, beam, body) {
  const { model, width: w, length: l, height: h, style } = feature;
  if (![w, l, h].every(v => Number.isFinite(v) && v > 0)) return false;
  const timber = style === 'dark' ? DARK_TIMBER : TIMBER;
  if (model === 'swing' || model === 'basketSwing') {
    const basket = model === 'basketSwing';
    const halfSpan = w / 2;
    const leg = basket ? 0.19 : 0.16;
    beam([-halfSpan - 0.13, h, 0], [halfSpan + 0.13, h, 0], leg, timber);
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        beam([side * halfSpan, h, 0], [side * (halfSpan + 0.17), -0.07, end * l / 2], leg, timber);
      }
    }
    const seatY = basket ? 0.66 : 0.59;
    const seats = basket || feature.seats === 1 ? [0] : [-w * 0.25, w * 0.25];
    for (const x of seats) {
      const seatWidth = basket ? Math.min(l * 0.52, 1.13) : 0.43;
      part(seatWidth, 0.08, basket ? seatWidth : 0.19, x, seatY, 0, RUBBER, basket ? 'pole' : 'box');
      for (const side of [-1, 1]) {
        const hanger = x + side * (basket ? 0.37 : 0.19);
        beam([hanger, h - 0.07, 0], [x + side * seatWidth * 0.41, seatY + 0.04, 0], 0.022, STEEL, true);
      }
    }
    return true;
  }
  if (model === 'slide') {
    const freestanding = style === 'freestanding';
    const platformZ = -l * 0.30;
    const level = freestanding ? h * 0.79 : h * (feature.roof ? 0.63 : 0.77);
    const deck = Math.min(w * 0.66, 1.32);
    const halfDeck = deck / 2;
    const chute = Math.min(w * 0.34, 0.76);
    const tail = l * 0.50;
    const join = platformZ + halfDeck;
    const breakPoint = tail - Math.min(0.52, l * 0.16);
    const plastic = style === 'blue' ? BLUE : STEEL;
    part(deck, 0.13, deck, 0, level - 0.06, platformZ, timber);
    for (const x of [-halfDeck, halfDeck]) {
      for (const z of [-halfDeck, halfDeck]) {
        const postHeight = freestanding ? level + 0.62 : feature.roof ? h - 0.22 : h;
        part(0.13, postHeight, 0.13, x, postHeight / 2, platformZ + z, timber);
        body(0.13, 0.13, postHeight, x, platformZ + z);
      }
      part(0.095, 0.10, deck, x, level + 0.55, platformZ, RAIL);
      beam([x * 0.75, 0.04, -l * 0.53], [x * 0.75, level + 0.20, platformZ - halfDeck], 0.06, timber, true);
    }
    for (let i = 1; i <= 5; i++) {
      part(deck * 0.73, 0.065, 0.17, 0, level * i / 6,
        -l * 0.53 + (platformZ - halfDeck + l * 0.53) * i / 6, timber, 'box', true);
    }
    if (feature.roof) {
      const roofY = h - 0.30;
      for (const side of [-1, 1]) {
        beam([0, h, platformZ], [side * (halfDeck + 0.12), roofY, platformZ], deck + 0.30,
          style === 'blue' ? BLUE : DARK_TIMBER, false, 'box', 0.095);
      }
    }
    beam([0, level, join], [0, 0.30, breakPoint], chute, plastic, false, 'box', 0.075);
    beam([0, 0.30, breakPoint], [0, 0.22, tail], chute, plastic, false, 'box', 0.075);
    for (const side of [-1, 1]) {
      const x = side * chute * 0.45;
      beam([x, level + 0.075, join], [x, 0.375, breakPoint], 0.055, plastic, true);
      beam([x, 0.375, breakPoint], [x, 0.295, tail], 0.055, plastic, true);
    }
    part(chute * 0.76, 0.29, 0.11, 0, 0.145, breakPoint, timber);
    return true;
  }
  if (model === 'climber') {
    const count = style === 'low' ? 3 : 5;
    const posts = [];
    const deck = Math.min(w * 0.65, 0.98);
    for (let i = 0; i < count; i++) {
      const z = l * (i / (count - 1) - 0.5);
      const x = (i % 2 ? -1 : 1) * w * 0.13;
      const y = h * (0.42 + (i % 3) * 0.25);
      for (const side of [-1, 1]) part(0.13, y, 0.13, x + side * deck * 0.35, y / 2, z, timber);
      part(deck, 0.11, deck, x, y, z, i === count - 1 ? BLUE : timber);
      if (posts.length) {
        const p = posts.at(-1);
        for (const side of [-1, 1]) {
          const offset = side * deck * 0.31;
          beam([p[0] + offset, p[1], p[2]], [x + offset, y, z], 0.075, timber, true);
        }
      }
      posts.push([x, y, z]);
    }
    return true;
  }
  return false;
}
