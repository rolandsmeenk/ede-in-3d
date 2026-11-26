// See docs/simulation.md for the fleet, mileage and regional traffic-count sources.
const lightWeights = [
  ['hatchback', 390], ['estate', 169], ['suv', 209], ['sedan', 48], ['minivan', 45],
  ['taxi', 4], ['compactVan', 93], ['van', 39], ['pickup', 3]
];

export function dutchVehicleKind(unit) {
  let ticket = unit * 1000;
  for (const [kind, weight] of lightWeights) {
    ticket -= weight;
    if (ticket < 0) return kind;
  }
  return 'pickup';
}

export const CARGO_CLEARANCE = {
  rigid: { length: 8.8, width: 2.52, height: 3.65, weight: 18, axleLoad: 11.5 },
  semi: { length: 16.5, width: 2.55, height: 4.0, weight: 40, axleLoad: 11.5 }
};

const throughRoad = /^(trunk|primary|secondary|tertiary)(?:_link)?$/;
const measuredRoad = /^N(?:224|304|781)$/;
const measuredRoadNames = new Set(['Apeldoornseweg', 'Dr. Willem Dreeslaan', 'Willem Dreeslaan', 'Verlengde Arnhemseweg']);

export function cargoRoadAllowed(edge, kind) {
  if (edge.underpass && edge.limits?.height == null) return false;
  if (edge.motorway || edge.motorwayLink) return true;
  return kind === 'rigid' && throughRoad.test(edge.roadKind);
}

export function cargoShare(edge, kind) {
  if (!cargoRoadAllowed(edge, kind)) return 0;
  if (edge.motorway || edge.motorwayLink) return kind === 'semi' ? 0.055 : 0.02;
  if (measuredRoad.test(edge.roadRef) || measuredRoadNames.has(edge.roadName)) return 0.09;
  return edge.roadKind?.startsWith('tertiary') ? 0.025 : 0.045;
}
