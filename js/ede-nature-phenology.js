// FLORON & NDFF phenology diagrams (CC BY 4.0), 2026-11-27 export.
// Flowering indices sampled every seven days from day 4, rounded to hundredths.
const weeklyBloom = {
  calluna: [
    1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 1, 3, 3, 5, 7, 8, 12, 23, 49,
    40, 63, 59, 70, 92, 82, 65, 54, 37, 22, 13, 10, 10, 5, 4, 5, 4, 1, 1, 1, 0, 1
  ],
  erica: [
    1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 3, 7, 19, 42, 77, 97, 99, 92, 81, 86,
    82, 60, 54, 44, 44, 42, 38, 35, 35, 31, 21, 18, 17, 13, 10, 8, 8, 4, 1, 1, 0, 0, 0
  ],
  tormentil: [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 9, 24, 41, 70, 82, 96, 97, 83, 72, 56, 51, 45,
    46, 49, 39, 39, 41, 40, 41, 37, 36, 35, 31, 20, 16, 12, 8, 3, 2, 2, 1, 1, 0, 0, 0, 0
  ],
  daisy: [
    25, 26, 22, 19, 18, 19, 23, 31, 37, 42, 49, 60, 72, 91, 100, 90, 75, 65, 59, 56, 54, 48, 40,
    33, 28, 24, 20, 19, 18, 17, 17, 16, 16, 17, 17, 18, 17, 15, 14, 13, 13, 13, 13, 14, 14, 13,
    12, 11, 11, 14, 21
  ],
};
const visibleSeason = { calluna: [7, 10], erica: [6, 10], tormentil: [5, 9], daisy: [4, 9] };

export function edeFlowerBloom(date) {
  const month = Number(date.slice(5, 7)), dayOfMonth = Number(date.slice(8, 10));
  const day = (Date.UTC(2001, month - 1, month === 2 ? Math.min(28, dayOfMonth) : dayOfMonth) -
    Date.UTC(2001, 0, 1)) / 86400000 + 1;
  const week = (day - 4) / 7;
  return Object.fromEntries(Object.entries(weeklyBloom).map(([species, samples]) => {
    const [start, end] = visibleSeason[species];
    if (month < start || month > end) return [species, 0];
    const index = Math.max(0, Math.min(samples.length - 2, Math.floor(week)));
    const blend = Math.max(0, Math.min(1, week - index));
    const indexValue = (samples[index] + (samples[index + 1] - samples[index]) * blend) / 100;
    return [species, indexValue];
  }));
}
