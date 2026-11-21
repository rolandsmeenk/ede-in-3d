// BAG 0228100000088255, surveyed against PDOK 2026 orthophotography and MIX plans.
const x0 = 229.33, z0 = 2226.02;
const dx = 93.17, dz = 31.23;
const extent = Math.hypot(dx, dz);
export const HARTOGSHOF_COS = dx / extent;
export const HARTOGSHOF_SIN = dz / extent;

export function hartogshofPoint(u, v) {
  return { x: x0 + u * HARTOGSHOF_COS - v * HARTOGSHOF_SIN, z: z0 + u * HARTOGSHOF_SIN + v * HARTOGSHOF_COS };
}

const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

// Clockwise outlines in metres. The two breaks in the north and east wings lead into the court.
export const HARTOGSHOF_WINGS = [
  { style: 'station', levels: 6, wall: 0xa59172,
    outline: [[0, 0], [28.15, 0], [28.15, 15.7], [15.05, 15.7], [15.05, 17.4], [0.06, 17.4]] },
  { style: 'park', levels: 5, wall: 0x86735d,
    outline: [[32.75, 0], [43.4, 0], [43.4, -2.65], [55.13, -2.65], [55.13, 0], [64.5, 0], [64.5, 13.6], [32.75, 13.6]],
    setback: rect(34.0, 1.6, 64.0, 12.3) },
  { style: 'park', levels: 5, wall: 0xa18b69,
    outline: [[64.5, 0], [75.75, 0], [75.75, -2.65], [87.45, -2.65], [87.45, 0], [98.25, 0], [98.25, 13.6], [64.5, 13.6]],
    setback: rect(65.0, 1.6, 97.1, 12.3) },
  { style: 'gallery', levels: 5, wall: 0xa29072,
    outline: [[0.06, 17.4], [15.05, 17.4], [15.05, 58.2], [0.20, 58.2]] },
  { style: 'corner', levels: 5, wall: 0x796954, green: true,
    outline: [[0.20, 58.2], [16.0, 58.2], [16.0, 76.78], [0.24, 76.78]] },
  { style: 'gallery', levels: 4, wall: 0xab9474, outline: rect(16.0, 61.25, 38.0, 75.35) },
  { style: 'villas', levels: 3, wall: 0x9d896b, outline: rect(38.0, 61.25, 76.0, 73.88), solar: true },
  { style: 'corner', levels: 4, wall: 0x9c8668, green: true,
    outline: [[76.0, 59.45], [98.32, 59.45], [98.4, 76.9], [79.35, 76.9], [79.35, 74.2], [76.0, 74.2]] },
  { style: 'villas', levels: 3, wall: 0x9f896e,
    outline: [[86.5, 19.2], [98.28, 19.2], [98.32, 59.45], [86.5, 59.45]], solar: true },
];

// The courtyard is outside the footprint even though it is within the single cadastral parcel.
export const HARTOGSHOF_FOOTPRINTS = HARTOGSHOF_WINGS.map(({ outline }) => ({
  outer: outline.map(([u, v]) => hartogshofPoint(u, v)), holes: [],
}));
