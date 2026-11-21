// Exterior observations are documented in tools/data/ede-other-churches.md.
// Roofs, the hall volumes and tower placements come from the separate BAG survey.
export const CHURCH_STYLES = {
  bethelkerk: {
    wall: 0x74604e, roof: 0x565752, front: 'stained', side: 'clerestory', portal: 'glass',
    doorWidth: 3.2, trim: 0x727d84, eave: 0x285a84, belfry: 17, clock: true,
    facing: [-1, 0], entryPoint: [-447, 2335], finial: 1.42, finialAnchor: [-442.62, 41.57, 2338.98], hallClerestory: true,
  },
  'lutherse-kerk': {
    wall: 0x6e5043, roof: 0x514f4b, front: 'lancet', side: 'lancet', sideBays: 3,
    portal: 'arch', door: 0x9d5c28, doorWidth: 1.65, rose: true,
    spire: [-340.80, 33.63, 718.10, 1.18, 37.93, 0x527d6d],
  },
  'hersteld-apostolische-kerk': {
    wall: 0xc4bda7, roof: 0x474d55, front: 'slit', side: 'slit', door: 0x704338,
    doorWidth: 2.45, trim: 0x777f85, eave: 0x65717c, finial: 1.7,
  },
  emmaus: {
    wall: 0xd0cabc, roof: 0x617d86, roofTints: { 56: 0x727b7a, 58: 0xa7aaa2 },
  },
  proosdijkerk: {
    wall: 0x855444, roof: 0xa2694c, front: 'glass', side: 'window', portal: 'glass',
    doorWidth: 3.2, glassHeight: 4.35, trim: 0xb3a58c,
  },
  'apostolisch-genootschap': {
    wall: 0xa39071, roof: 0x4d5b5b, front: 'glass', door: 0x654639, side: 'clerestory',
    doorWidth: 2.5, canopy: true, eave: 0x435b5a, trim: 0xc0b5a1,
  },
  taborkerk: {
    wall: 0xaa9371, roof: 0xa75f4b, front: 'window', side: 'glass', sideBays: 5,
    door: 0x654539, trim: 0xc6c0a0, belfry: 9, finial: 0.33, finialAnchor: [-420.25, 34.10, 922.77],
  },
  tabernakel: {
    wall: 0xa49b87, roof: 0x44484c, front: 'glass', side: 'slit', portal: 'glass',
    doorWidth: 3.1, glassHeight: 4.5, trim: 0xb2a796, gableGlass: true, bellHood: [-1017.84, 1432.80, 28.38, 30.60, 0.24],
  },
  adventkerk: {
    wall: 0x816758, roof: 0x594d45, front: 'window', side: 'window', door: 0x585452,
    doorWidth: 1.55, trim: 0xa79987,
  },
  'oud-gereformeerde-zuid': {
    wall: 0xb9ac97, roof: 0x565452, front: 'window', side: 'window', upper: 0x4e5254,
    door: 0x634337, trim: 0xa19a87,
  },
  'de-wissel': {
    wall: 0xa59883, roof: 0x5d5e53, front: 'window', side: 'window', portal: 'glass',
    doorWidth: 2.95, canopy: true, trim: 0x8f826d,
  },
  ontmoetingskerk: {
    wall: 0xaa805f, roof: 0x564d43, front: 'glass', side: 'clerestory', portal: 'glass',
    doorWidth: 3.3, canopy: true, trim: 0xcac1aa, eave: 0xcac1aa, belfry: 7.5,
  },
  'oud-gereformeerde-noord': {
    wall: 0x7e5646, roof: 0x8f5740, front: 'arch', side: 'arch', sideBays: 4,
    door: 0x70462a, portal: 'arch', trim: 0xaf977c,
  },
  sionkerk: {
    wall: 0x89674f, roof: 0x4f5458, front: 'window', side: 'window', canopy: true,
    doorWidth: 2.9, door: 0x3c3d39, trim: 0xc9c2ae, upper: 0xc6bdab, steps: 3,
  },
  elim: {
    wall: 0xc7c0af, roof: 0x8d543e, front: 'window', portal: 'glass', doorWidth: 2.1,
    canopy: true, trim: 0xddd5b7,
  },
  petrakerk: {
    wall: 0x845344, roof: 0x3f4447, front: 'slit', side: 'lancet', sideBays: 6,
    doorWidth: 3.1, door: 0x494746, trim: 0xc2a590, belfry: 19, steps: 3, raisedEntry: true, upperWindows: true,
    spire: [-2007.62, 43.18, -1321.94, 1.0, 45.54, 0x838b8a],
  },
  rehoboth: {
    wall: 0xa38d76, roof: 0x52565a, front: 'window', side: 'window',
    portal: 'glass', doorWidth: 2.1, trim: 0x656b65,
  },
  'open-hof': {
    wall: 0x948875, roof: 0x424c53, front: 'glass', portal: 'glass',
    doorWidth: 3.6, canopy: true, trim: 0x9b433f, upper: 0x455761, side: 'clerestory',
  },
  'de-ark': {
    wall: 0x94694e, roof: 0x605b50, front: 'glass', side: 'slit', portal: 'glass',
    doorWidth: 3.0, canopy: true, glassHeight: 2.85, trim: 0xc0b5a2, gableGlass: true,
  },
  'goede-herderkerk': {
    wall: 0xa08a68, roof: 0x5a5c5a, front: 'stained', portal: 'glass',
    doorWidth: 3.15, curtain: true, entryPoint: [-899.3, 620], canopy: true, side: 'clerestory',
    trim: 0xc5c0aa, belfry: 17, finial: 1.73, finialAnchor: [-903.51, 39.03, 605.26], finialTint: 0x514d43,
  },
  zuiderkerk: {
    wall: 0xc0b7ab, roof: 0x555552, front: 'glass', side: 'window', portal: 'glass',
    doorWidth: 3.5, canopy: true, trim: 0xb4ad99,
  },
  'de-schuilplaats': {
    wall: 0x9d866d, roof: 0x626461, front: 'glass', side: 'clerestory', portal: 'glass',
    doorWidth: 3.6, canopy: true, trim: 0x686665,
  },
  ericakerk: {
    wall: 0xd2c8b4, roof: 0x52514f, front: 'arch', side: 'lancet', sideBays: 3,
    portal: 'arch', door: 0x68473c, doorWidth: 1.85, trim: 0x83584b, piers: true,
  },
  'de-akker': {
    wall: 0x9c7460, roof: 0x58534d, front: 'window', side: 'window',
    portal: 'glass', doorWidth: 2.7, canopy: true, trim: 0x834544,
  },
  'de-deur': {
    wall: 0xa79e8b, roof: 0x626363, front: 'window', portal: 'glass',
    doorWidth: 2.45, trim: 0x585956,
  },
  mollenkerkje: {
    wall: 0xc8bdab, roof: 0x625c56, front: 'arch', side: 'arch', sideBays: 3,
    portal: 'arch', door: 0x635443, trim: 0x783d36, doorWidth: 1.65,
  },
  koninkrijkszaal: {
    wall: 0xa4937a, roof: 0x5f5c59, front: 'window', portal: 'glass',
    doorWidth: 2.1, canopy: true, trim: 0x9b9a90,
  },
};
