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
};

export function fitsRoad(vehicle, limits, mode) {
  if (!limits) return true;
  return ['height', 'width', 'weight', 'length', 'axleLoad'].every((key) => {
    const limit = mode === BUS && limits.bus?.[key] !== undefined ? limits.bus[key] : limits[key];
    return limit == null || (vehicle[key] ?? 0) <= limit;
  });
}
