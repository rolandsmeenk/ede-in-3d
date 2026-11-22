export const CAR = 1;
export const VAN = 2;
export const BUS = 4;
export const BICYCLE = 8;
export const FOOT = 16;
export const MOTOR = CAR | VAN | BUS;

export const VEHICLE_CLEARANCE = {
  car: { height: 1.92, width: 2.05, weight: 2.6, length: 5.8, axleLoad: 1.5 },
  van: { height: 2.55, width: 2.05, weight: 3.5, length: 6, axleLoad: 2 },
  bus: { height: 3.25, width: 2.6, weight: 18, length: 12.2, axleLoad: 11.5 },
  tractor: { height: 3.22, width: 2.56, weight: 6.8, length: 4.8, axleLoad: 4.5 },
  ambulance: { height: 2.85, width: 2.32, weight: 3.3, length: 6.08, axleLoad: 2.1 },
};

export function fitsRoad(vehicle, limits, mode) {
  if (!limits) return true;
  return ['height', 'width', 'weight', 'length', 'axleLoad'].every((key) => {
    const limit = mode === BUS && limits.bus?.[key] !== undefined ? limits.bus[key] : limits[key];
    return limit == null || (vehicle[key] ?? 0) <= limit;
  });
}


const tractorKinds = new Set(['unclassified', 'tertiary', 'tertiary_link', 'residential']);
const tractorCenters = [
  [0, 135, 640],             // Ede Centrum
  [-3483, -4265, 420],        // Lunteren, Dorpsstraat
  [253, 5329, 420],           // Bennekom
  [-6317, -1974, 280],        // Ederveen
  [2649, -7429, 215],         // Wekerom
  [7117, -6122, 280],         // Otterlo
  [5576, -9618, 275],         // Harskamp
  [-6570, 182, 210],          // De Klomp
];

// Provincial C9 closure on the main N304 between km 0.456 and 6.229.
// https://geoportaal.gelderland.nl/gisserver/rest/services/Infra/Infra/MapServer/28
const provincialTractorClosures = [
  118547825, 160287247, 436054130, 1285013614, 6952591, 6952595, 6952730, 118547826,
  436054128, 436054129, 915899513, 915899514, 1017866786, 1136796943, 1285013613,
  6952731, 132763045, 132763050, 132856393, 132856400, 132856408, 199862033,
  885982393, 1017866787, 1017866788, 1017866789,
];

export function tractorClosedWays(signs = []) {
  const closed = new Set(provincialTractorClosures.map(id => 'w' + id));
  for (const sign of signs) {
    if (!/^C0?[89]$/.test(sign.rvvCode)) continue;
    const agriculture = /agricultural|landbouw/i;
    const exempt = sign.conditions?.exemptions?.some(rule => agriculture.test(JSON.stringify(rule))) ||
      sign.supplementarySigns?.some(panel => {
        const text = JSON.stringify(panel);
        return agriculture.test(text) && /uitgezonderd|toegestaan|m\.u\.v\./i.test(text);
      });
    if (exempt) continue;
    for (const edge of sign.edges ?? []) if (edge.way) closed.add(edge.way);
  }
  return closed;
}

export function tractorRoadAllowed(edge, closed = new Set()) {
  if (edge.underpass || edge.motorway || edge.motorwayLink || edge.motorroad ||
      edge.agricultural === 'no' || closed.has(edge.wayId) ||
      !(tractorKinds.has(edge.roadKind) || edge.roadKind === 'secondary' && edge.limits?.speed <= 60)) return false;
  const { from, to } = edge;
  const dx = to.x - from.x, dz = to.z - from.z;
  return !tractorCenters.some(([x, z, radius]) => {
    const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (z - from.z) * dz) / (dx * dx + dz * dz)));
    return (x - from.x - t * dx) ** 2 + (z - from.z - t * dz) ** 2 < (radius + 18) ** 2;
  });
}
