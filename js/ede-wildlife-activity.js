// Habitat checks use in-scene land cover and broad scenic districts, with no occurrence coordinates.
const GINKEL = [4120, 1100, 1550];
const PLANKEN_WAMBUIS = [[4540, -2750, 720], [7519, 122, 950], [7856, 1704, 720]];
const TAU = 2 * Math.PI;

export function wildlifeHash(seed) {
  const value = Math.sin(seed * 47.17 + 13.53) * 43758.5453;
  return value - Math.floor(value);
}

function within(x, z, [cx, cz, radius]) {
  return (x - cx) ** 2 + (z - cz) ** 2 <= radius ** 2;
}

export function wildlifeActivity({ date, calendar, season, minute, sunElevation, weather, windSpeed, temperature } = {}) {
  const monthDay = calendar === false && season === 'summer' ? 712 : Number(date?.slice(5).replace('-', ''));
  const seed = Number(date?.replaceAll('-', ''));
  const afternoon = minute >= 12 * 60;
  const dusk = afternoon && sunElevation >= -11 && sunElevation <= 4;
  const dry = weather === 'dry';
  const chance = wildlifeHash(seed);
  return {
    skylark: monthDay >= 301 && monthDay <= 715 && sunElevation > 5
      && minute < 16 * 60 && (dry || weather === 'frost') && !(windSpeed > 37),
    nightjar: monthDay >= 501 && monthDay <= 815 && afternoon && sunElevation <= -1.5
      && sunElevation >= -12 && dry && !(windSpeed > 25),
    butterfly: monthDay >= 624 && monthDay <= 910 && dry && sunElevation >= 15
      && temperature >= 17 && windSpeed >= 0 && windSpeed <= 25,
    mammal: dusk && weather !== 'snow' && chance > 0.27
      ? (chance < 0.64 ? 'red-deer' : 'wild-boar') : null,
    antlers: monthDay >= 701 || monthDay <= 306,
    grazingDay: monthDay >= 301 && monthDay <= 1130 && weather !== 'snow',
    seed,
  };
}

const speciesHabitat = {
  skylark: (x, z, habitatAt) => {
    if (!within(x, z, GINKEL)) return false;
    const site = habitatAt(x, z);
    return site.heath && !site.woodland && !site.edge;
  },
  nightjar: (x, z, habitatAt) => {
    return (within(x, z, GINKEL) || PLANKEN_WAMBUIS.some(area => within(x, z, area))) && habitatAt(x, z).edge;
  },
  butterfly: (x, z, habitatAt) => {
    if (!within(x, z, GINKEL)) return false;
    const site = habitatAt(x, z);
    if (site.woodland || site.pavement || !(site.heath || site.sand)) return false;
    return [0, 1, 2, 3].some(i => {
      const nearby = habitatAt(x + 17 * Math.cos(i * TAU / 4), z + 17 * Math.sin(i * TAU / 4));
      return site.heath && (nearby.sand || nearby.grass || nearby.edge) || site.sand && nearby.heath;
    });
  },
  mammal: (x, z, habitatAt) => {
    if (!PLANKEN_WAMBUIS.some(area => within(x, z, area))) return false;
    const site = habitatAt(x, z);
    return site.edge && !site.pavement;
  },
};

const distances = {
  skylark: [26, 58, 100],
  nightjar: [38, 75, 130],
  butterfly: [3.3, 6.5, 12],
  mammal: [22, 44, 75],
};

// Anchor an encounter in terrain. A fixed world-cell angle orders the habitat samples on each visit.
export function findWildlifeSite(kind, camera, habitatAt, seed) {
  const [near, mid, far] = distances[kind];
  const start = wildlifeHash(seed + Math.floor(camera.x / near) * 41 + Math.floor(camera.z / near) * 97) * TAU;
  for (const distance of [near, mid, far]) for (let i = 0; i < 9; i++) {
    const angle = start + i * TAU / 9;
    const x = camera.x + Math.cos(angle) * distance;
    const z = camera.z + Math.sin(angle) * distance;
    if (!speciesHabitat[kind](x, z, habitatAt)) continue;
    if (kind === 'mammal') {
      // Follow a short stretch of the edge so the crossing stays clear of dense forest.
      for (let j = 0; j < 8; j++) {
        const heading = j * TAU / 8;
        const dx = Math.sin(heading) * 20, dz = Math.cos(heading) * 20;
        if (Math.abs(dx * Math.sin(angle) - dz * Math.cos(angle)) < 10) continue;
        if (speciesHabitat.mammal(x + dx / 2, z + dz / 2, habitatAt)
            && speciesHabitat.mammal(x + dx, z + dz, habitatAt)) {
          return { x, z, heading, dx, dz };
        }
      }
      continue;
    }
    return { x, z };
  }
  return null;
}
