// Layouts use metres in a field-local frame. Positive u follows the long axis, v crosses it.
const TAU = Math.PI * 2;
const SECONDARY_PAINT = 0xefc35b;
const SOIL = 0x946344;
const PLATE = 0xf5f3e9;
const INFIELD_GRASS = 0x658b53;

function arc(u, v, radius, start = 0, end = TAU, segments = 24) {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = start + (end - start) * i / segments;
    return [u + radius * Math.cos(a), v + radius * Math.sin(a)];
  });
}

function rectangle(u0, v0, u1, v1) {
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]];
}

function layout(sport, nominalLength, nominalWidth, length, width, lineWidth, stretch = false) {
  const sx = Math.min(1, (length - 0.6) / nominalLength);
  const sy = Math.min(1, (width - 0.4) / nominalWidth);
  const scale = Math.min(sx, sy);
  const x = stretch ? sx : scale, y = stretch ? sy : scale;
  const field = { sport, lines: [], fills: [], equipment: [] };
  const point = ([u, v]) => [u * x, v * y];
  const line = points => field.lines.push({ points: points.map(point), width: Math.max(0.027, lineWidth * scale) });
  const fill = (points, color) => field.fills.push({ points: points.map(point), color });
  const equipment = (kind, u, v, dir, span, height) => {
    field.equipment.push({ kind, u: u * x, v: v * y, dir, width: span * y, height });
  };
  const end = nominalLength / 2, side = nominalWidth / 2;
  line(rectangle(-end, -side, end, side));
  return { field, line, fill, equipment, end, side, scale };
}

function soccer(length, width) {
  // IFAB Law 1. Use a common 105 x 68 m starting field and fit youth/playground outlines proportionally.
  const { field, line, fill, equipment, end, side, scale } = layout('soccer', 105, 68, length - 1.6, width, 0.11, true);
  line([[0, -side], [0, side]]);
  line(arc(0, 0, 9.15));
  fill(arc(0, 0, 0.15, 0, TAU, 8), PLATE);
  for (const sign of [-1, 1]) {
    const mirror = points => points.map(([u, v]) => [sign * u, v]);
    for (const depth of [5.5, 16.5]) {
      const half = 3.66 + depth, u = end - depth;
      line(mirror([[end, -half], [u, -half], [u, half], [end, half]]));
    }
    const penalty = end - 11;
    const a = Math.acos(5.5 / 9.15);
    line(mirror(arc(penalty, 0, 9.15, Math.PI - a, Math.PI + a, 12)));
    fill(mirror(arc(penalty, 0, 0.15, 0, TAU, 8)), PLATE);
    line(mirror(arc(end, -side, 1, Math.PI / 2, Math.PI, 5)));
    line(mirror(arc(end, side, 1, Math.PI, Math.PI * 1.5, 5)));
    equipment('goal', sign * end, 0, -sign, 7.32, Math.max(1, 2.44 * Math.sqrt(scale)));
  }
  return field;
}

function basketball(length, width) {
  // FIBA court dimensions. Small, square public courts generally have one hoop.
  const half = length < 21;
  const { field, line, equipment, end, side, scale } = layout('basketball', half ? 14 : 28, 15, length, width, 0.055);
  if (!half) {
    line([[0, -side], [0, side]]);
    line(arc(0, 0, 1.80));
  }
  for (const sign of half ? [1] : [-1, 1]) {
    const mirror = points => points.map(([u, v]) => [sign * u, v]);
    const key = end - 5.8, hoop = end - 1.575;
    line(mirror([[end, -2.45], [key, -2.45], [key, 2.45], [end, 2.45]]));
    line(mirror(arc(key, 0, 1.8, Math.PI / 2, Math.PI * 1.5, 16)));
    const corner = side - 0.9;
    const a = Math.asin(corner / 6.75);
    line(mirror([[end, -corner], ...arc(hoop, 0, 6.75, Math.PI + a, Math.PI - a), [end, corner]]));
    equipment('basket', sign * (hoop + 0.28 / scale), 0, -sign, 1.8, scale < 0.60 ? 2.60 : 3.05);
  }
  return field;
}

function tennis(length, width, sport) {
  const padel = sport === 'padel';
  const pickleball = sport === 'pickleball';
  const { field, line, equipment, end, side } = layout(sport, padel ? 20 : pickleball ? 13.41 : 23.77,
    padel ? 10 : pickleball ? 6.10 : 10.97, length, width, 0.055);
  const singles = padel || pickleball ? side : 8.23 / 2;
  const service = padel ? 6.95 : pickleball ? 2.13 : 6.40;
  for (const sign of [-1, 1]) {
    if (!padel && !pickleball) {
      line([[-end, sign * singles], [end, sign * singles]]);
      line([[sign * end, 0], [sign * (end - 0.10), 0]]);
    }
    line([[sign * service, -singles], [sign * service, singles]]);
  }
  if (pickleball) {
    for (const sign of [-1, 1]) line([[sign * service, 0], [sign * end, 0]]);
  } else {
    const centreServiceEnd = service + (padel ? 0.20 : 0);
    line([[-centreServiceEnd, 0], [centreServiceEnd, 0]]);
  }
  equipment('net', 0, 0, 1, side * 2, padel ? 0.92 : pickleball ? 0.91 : 1.07);
  return field;
}

function diamond(length, width, sport, { homeFrom = 1, homeU }) {
  const softball = sport === 'softball', beeball = sport === 'beeball';
  const training = beeball || sport === 'baseball' && length < 55;
  const sign = homeFrom < 0 ? -1 : 1;
  const setback = Math.min(3, length * 0.06);
  const home = Number.isFinite(homeU)
    ? Math.min(length / 2 - 1, Math.max(-length / 2 + 0.3, sign * homeU))
    : -length / 2 + setback;
  const remaining = length / 2 - home - 0.15;
  const outfield = Math.max(0.4, Math.min(remaining, width / 2 - 0.12));
  const nominalDiagonal = (training ? 16.5 : softball ? 18.288 : 27.432) / Math.SQRT2;
  const diagonal = Math.min(nominalDiagonal, outfield * 0.76, remaining * 0.45);
  const mound = (training ? 10.5 : softball ? 13.11 : 18.44) * diagonal / nominalDiagonal;
  const project = points => points.map(([u, v]) => [sign * (u + home), v]);
  const lines = [], fills = [];
  const line = points => lines.push({ points: project(points), width: 0.085 });
  const fill = (points, color) => fills.push({ points: project(points), color });

  const homePlate = [0, 0], first = [diagonal, diagonal], second = [diagonal * 2, 0], third = [diagonal, -diagonal];
  const radius = Math.min(diagonal * (training ? 2.05 : 2.25), length * 0.78);
  fill([homePlate, ...arc(0, 0, radius, -Math.PI / 4, Math.PI / 4, 14)], SOIL);
  if (sport === 'baseball' && !training) {
    const inset = Math.min(2.2, diagonal * 0.16);
    fill([[inset, 0], [diagonal, diagonal - inset], [2 * diagonal - inset, 0], [diagonal, inset - diagonal]], INFIELD_GRASS);
  }
  if (!beeball) fill(arc(mound, 0, Math.max(0.4, Math.min(2.74, diagonal * 0.14)), 0, TAU, 14), 0xa87450);
  line([homePlate, [outfield, -outfield]]);
  line([homePlate, [outfield, outfield]]);
  for (const [u, v] of [first, second, third]) {
    const edge = Math.min(0.323, diagonal / 10);
    fill([[u + edge, v], [u, v + edge], [u - edge, v], [u, v - edge]], PLATE);
  }
  const plate = Math.min(0.43, diagonal / 5);
  fill([[0, 0], [plate / 2, -plate / 2], [plate, -plate / 2], [plate, plate / 2], [plate / 2, plate / 2]], PLATE);
  if (!beeball) fill(rectangle(mound - 0.075, -0.305, mound + 0.075, 0.305).slice(0, -1), PLATE);
  for (const side of [-1, 1]) {
    const a = side * plate * 1.35, b = side * plate * 4.15;
    line(rectangle(-plate * 1.25, a, plate * 2.35, b));
  }
  return { sport, lines, fills, equipment: [] };
}

function goalArc(end, halfGoal, radius) {
  return [
    ...arc(end, -halfGoal, radius, -Math.PI / 2, -Math.PI, 10),
    ...arc(end, halfGoal, radius, Math.PI, Math.PI / 2, 10),
  ];
}

function hockeyOrHandball(length, width, sport) {
  const hockey = sport === 'field_hockey', futsal = sport === 'futsal', korfball = sport === 'korfball';
  const { field, line, fill, equipment, end, side, scale } = layout(sport, hockey ? 91.4 : 40,
    hockey ? 55 : 20, length - 1.6, width, hockey ? 0.075 : 0.06, true);
  line([[0, -side], [0, side]]);
  if (futsal) line(arc(0, 0, 3, 0, TAU, 20));
  for (const sign of [-1, 1]) {
    const mirror = points => points.map(([u, v]) => [u * sign, v]);
    if (korfball) {
      const u = end * (2 / 3);
      const penalty = sign * (u - 2.5);
      line(arc(penalty, 0, 2.5, 0, TAU, 16));
      line([[penalty, -0.075], [penalty, 0.075]]);
      equipment('korf', u * sign, 0, -sign, 0.4, 3.50);
      continue;
    }
    const halfGoal = hockey ? 1.83 : 1.5;
    line(mirror(goalArc(end, halfGoal, hockey ? 14.63 : 6)));
    if (hockey) {
      line(mirror([[end - 22.9, -side], [end - 22.9, side]]));
      fill(mirror(arc(end - 6.475, 0, 0.12, 0, TAU, 8)), PLATE);
    } else if (futsal) {
      for (const distance of [6, 10]) fill(mirror(arc(end - distance, 0, 0.12, 0, TAU, 8)), PLATE);
    } else {
      const broken = goalArc(end, halfGoal, 9).map(([u, v]) => [u, Math.max(-side, Math.min(side, v))]);
      for (let i = 0; i + 1 < broken.length; i++) {
        const [u, v] = broken[i], [x, y] = broken[i + 1];
        line(mirror([[u, v], [(u + x) / 2, (v + y) / 2]]));
      }
      line(mirror([[end - 7, -0.5], [end - 7, 0.5]]));
    }
    equipment('goal', sign * end, 0, -sign, halfGoal * 2, (hockey ? 2.14 : 2) * Math.sqrt(scale));
  }
  return field;
}

function volleyball(length, width, sport) {
  const beach = sport === 'beachvolleyball';
  const { field, line, equipment, side } = layout(sport, beach ? 16 : 18, beach ? 8 : 9, length, width, 0.055);
  if (!beach) for (const u of [-3, 0, 3]) line([[u, -side], [u, side]]);
  equipment('net', 0, 0, 1, side * 2, 2.43);
  return field;
}

function athletics(length, width, sport, { athletics: event, lanes }) {
  const field = { sport, lines: [], fills: [], equipment: [] };
  if (event && event !== 'running' && event !== 'sprint') return field;
  const line = points => field.lines.push({ points, width: 0.06 });
  const radius = (width - 0.6) / 2;
  const mappedLanes = Number.isInteger(Number(lanes)) && Number(lanes) >= 1 ? Number(lanes) : undefined;
  if (event !== 'sprint' && length >= 48 && width >= 22 && length / width <= 3.3) {
    const straight = Math.max(2, (length - width) / 2);
    const count = Math.min(Math.floor((radius - 1) / 1.22), mappedLanes ?? (width >= 75 ? 6 : 4));
    for (let i = 0; i <= count; i++) {
      const r = radius - i * 1.22;
      const a = arc(straight, 0, r, -Math.PI / 2, Math.PI / 2, 16);
      const b = arc(-straight, 0, r, Math.PI / 2, Math.PI * 1.5, 16);
      line([...a, ...b, a[0]]);
    }
    line([[0, -radius], [0, -radius + count * 1.22]]);
  } else if (length >= 20 && (event === 'sprint' || width < 9)) {
    const count = Math.min(12, mappedLanes ?? Math.max(1, Math.floor((width - 0.4) / 1.22)));
    const laneWidth = Math.min(1.22, (width - 0.4) / count);
    const end = length / 2 - 0.4;
    const side = count * laneWidth / 2;
    for (let i = 0; i <= count; i++) {
      const v = side - i * laneWidth;
      line([[-end, v], [end, v]]);
    }
    for (const u of [-end + 0.5, end - 0.5]) line([[u, -side], [u, side]]);
  }
  return field;
}

function tableTennis() {
  return { sport: 'table_tennis', lines: [], fills: [],
    equipment: [{ kind: 'table', u: 0, v: 0, width: 1.525, length: 2.74, height: 0.76, dir: 1 }] };
}

function boules(length, width) {
  const end = Math.min(15, length - 0.5) / 2, side = (width - 0.4) / 2;
  const strips = Math.max(1, Math.min(4, Math.floor(width / 4)));
  const lines = [{ points: rectangle(-end, -side, end, side), width: 0.045, color: 0x665746 }];
  for (let p = 1; p < strips; p++) {
    const v = (2 * p / strips - 1) * side;
    lines.push({ points: [[-end, v], [end, v]], width: 0.045, color: 0x665746 });
  }
  return { sport: 'boules', lines, fills: [], equipment: [] };
}

const LAYOUTS = {
  soccer,
  basketball,
  baseball: diamond, softball: diamond, beeball: diamond,
  tennis, padel: tennis, pickleball: tennis,
  field_hockey: hockeyOrHandball, handball: hockeyOrHandball, futsal: hockeyOrHandball, korfball: hockeyOrHandball,
  volleyball, beachvolleyball: volleyball,
  athletics, table_tennis: tableTennis, boules,
};

const OVERLAY_SPORTS = new Set(['soccer', 'basketball', 'handball', 'futsal']);

// Mark only supported sports. Shared hard courts can have a second paint colour, with equipment for the primary layout.
export function sportLayout(sports, length, width, options = {}) {
  if (!(Number.isFinite(length) && Number.isFinite(width))) return null;
  const [sport, second] = [...new Set(sports)].filter(sport => Object.hasOwn(LAYOUTS, sport));
  if (!sport) return null;
  if (sport === 'table_tennis') {
    return length >= 2.74 && width >= 1.525 ? tableTennis() : null;
  }
  if (length < 4 || width < (sport === 'athletics' || sport === 'boules' ? 1.5 : 3)) return null;
  const primary = LAYOUTS[sport](length, width, sport, options);
  if (OVERLAY_SPORTS.has(sport) && OVERLAY_SPORTS.has(second) && length <= 52) {
    const secondary = LAYOUTS[second](length * 0.88, width * 0.84, second, options);
    primary.lines.push(...secondary.lines.map(line => ({ ...line, color: SECONDARY_PAINT })));
  }
  return primary;
}
