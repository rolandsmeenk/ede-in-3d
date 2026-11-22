import { Color, Vector4 } from 'three/webgpu';
import { floor, uniform, uniformArray } from 'three/tsl';

export const TREE_SEASONS = Object.freeze({
  today: { label: 'Today', day: null },
  spring: { label: 'Spring', day: 117 },
  summer: { label: 'Summer', day: 239 },
  autumn: { label: 'Autumn', day: 298 },
  winter: { label: 'Winter', day: 14 }
});

// Order matches the optional group byte in EDT3. Days are Ede estimates guided by De Natuurkalender.
// Leaf-out, autumn colour, and leaf fall each use their own transition.
const phenology = [
  { emerge: [98, 126], turn: [273, 299], fall: [291, 331], autumn: 0xb98b36 },
  null, // evergreen
  { emerge: [86, 113], turn: [255, 286], fall: [276, 317], autumn: 0xd8af34 },
  { emerge: [94, 118], turn: [268, 295], fall: [289, 325], autumn: 0xcf702a },
  { emerge: [108, 137], turn: [285, 312], fall: [307, 344], autumn: 0xb48b4b },
  { emerge: [91, 115], turn: [239, 282], fall: [275, 310], autumn: 0xa77536 },
  { emerge: [105, 133], turn: [286, 313], fall: [309, 351], autumn: 0xb17d40 },
  { emerge: [92, 122], turn: [273, 299], fall: [289, 328], autumn: 0xb95334 }
];

const civilDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: 'numeric', day: 'numeric'
});

function amsterdamCalendarDay(date) {
  const parts = civilDate.formatToParts(date);
  const day = Number(parts.find(p => p.type === 'day').value);
  const month = Number(parts.find(p => p.type === 'month').value);
  const year = Number(parts.find(p => p.type === 'year').value);
  // Midnight in the two UTC dates only measures calendar-day distance, including DST and leap days.
  return { year, month, dayOfYear: (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000 };
}

export function amsterdamDayOfYear(date) {
  return amsterdamCalendarDay(date).dayOfYear;
}

export function seasonPresetFor(date) {
  const { month } = amsterdamCalendarDay(date);
  return ['winter', 'spring', 'summer', 'autumn'][Math.floor(month / 3) % 4];
}

const smoothStep = (a, b, day) => {
  const t = Math.min(1, Math.max(0, (day - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The sheepfold mesh shares this single fleece morph weight with the season clock.
export const sheepFleeceInfluences = [0];

function sheepFleeceAt(day, year) {
  // Edese Schaapskudden shears on the second Saturday of June.
  const june8 = new Date(Date.UTC(year, 5, 8));
  const shearingDay = (june8.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 6 - june8.getUTCDay();
  // Keep the shorn silhouette for six weeks, then grow a full coat by late November.
  return day < shearingDay ? 1 : smoothStep(shearingDay + 42, shearingDay + 168, day);
}

// Typical local Calluna season. The shoulders fade in and out around mid-August to mid-September.
export const heatherBloom = uniform(0);
export const heatherBloomAt = day => smoothStep(223, 237, day) * (1 - smoothStep(245, 259, day));

export function treePhenology(group, day) {
  const profile = phenology[group];
  if (profile === null) return { leaves: 1, spring: 0, turned: 0 };
  const { emerge, turn, fall } = profile ?? phenology[0];
  const opened = smoothStep(...emerge, day);
  return {
    leaves: opened * (1 - smoothStep(...fall, day)),
    spring: opened * (1 - smoothStep(emerge[0], emerge[1] + 11, day)),
    turned: smoothStep(...turn, day)
  };
}

const summerTint = new Color(0x536c2c);
const autumnTints = phenology.map(p => p && new Color(p.autumn));
const palette = phenology.map(() => new Vector4(1, 1, 1, 1));
const paletteUniform = uniformArray(palette, 'vec4');
let mode = 'today';
let selectedDay = -1;

export function getTreeSeason() {
  return mode;
}

export function setTreeSeason(id, now = new Date()) {
  if (Object.hasOwn(TREE_SEASONS, id)) mode = id;
  const { year, dayOfYear } = amsterdamCalendarDay(now);
  const day = TREE_SEASONS[mode].day ?? dayOfYear;
  sheepFleeceInfluences[0] = sheepFleeceAt(day, year);
  if (day === selectedDay) return day;
  selectedDay = day;
  heatherBloom.value = heatherBloomAt(day);
  for (let i = 0; i < palette.length; i++) {
    const { leaves, spring, turned } = treePhenology(i, day);
    const autumn = autumnTints[i];
    if (!autumn) continue;
    palette[i].set(
      1 + 0.55 * spring + (autumn.r / summerTint.r - 1) * turned,
      1 + 0.27 * spring + (autumn.g / summerTint.g - 1) * turned,
      1 - 0.29 * spring + (autumn.b / summerTint.b - 1) * turned,
      leaves
    );
  }
  return day;
}

export function refreshTreeSeason(now) {
  return mode === 'today' ? setTreeSeason(mode, now) : selectedDay;
}

// Four low integer values encode the existing geometry and bark choice, the fraction keeps the existing seed.
export function packTreeStyle(species, random, group) {
  const profile = Number.isInteger(group) && group >= 0 && group < phenology.length
    ? group : species === 3 ? 1 : 0;
  return species + 4 * profile + Math.min(0.999, Math.max(0, random));
}

export function treeSeasonNodes(style) {
  return paletteUniform.element(floor(style.div(4)));
}

refreshTreeSeason();
