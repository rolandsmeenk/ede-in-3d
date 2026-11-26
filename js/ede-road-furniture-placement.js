const CELL = 48;
const EDGE_REACH = 28;
const POST_REACH = 1.5;
const RAIL_REACH = 6;
const BERM_OFFSET = 1;
const CARRIAGEWAY = /^(rijbaan |ov-baan$|verbindingsweg$|verkeersdrempel$|woonerf$)/;

export const isA12Hectometer = feature =>
  feature.type === 'hecto' && feature.wegnummer === 'A12' && !feature.hecto_lttr && !feature.weglet;

function addToCells(cells, layer, west, north, east, south, value) {
  for (let x = Math.floor(west / CELL); x <= Math.floor(east / CELL); x++) {
    for (let z = Math.floor(north / CELL); z <= Math.floor(south / CELL); z++) {
      const key = `${layer}/${x}/${z}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(value);
    }
  }
}

function* nearby(cells, layer, x, z, reach) {
  for (let i = Math.floor((x - reach) / CELL); i <= Math.floor((x + reach) / CELL); i++) {
    for (let j = Math.floor((z - reach) / CELL); j <= Math.floor((z + reach) / CELL); j++) {
      yield* cells.get(`${layer}/${i}/${j}`) ?? [];
    }
  }
}

function pavementIntervals(polygon, x, z, dx, dz) {
  const cuts = [];
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const ax = ring[j] - x, az = ring[j + 1] - z;
      const bx = ring[i] - x, bz = ring[i + 1] - z;
      const a = ax * dx + az * dz, b = bx * dx + bz * dz;
      if ((a > 0) === (b > 0)) continue;
      const t = a / (a - b);
      cuts.push((-ax - t * (bx - ax)) * dz + (az + t * (bz - az)) * dx);
    }
  }
  cuts.sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < cuts.length; i += 2) intervals.push([cuts[i - 1], cuts[i]]);
  return intervals;
}

function mergePavement(intervals) {
  const merged = [];
  for (const [low, high] of intervals.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && low <= last[1] + 0.05) last[1] = Math.max(last[1], high);
    else merged.push([low, high]);
  }
  return merged;
}

export function createRoadFurniturePlacement(roadSurfaces = [], barrierEvidence = []) {
  const surfaces = new Map(), posts = new Map(), rails = new Map();
  for (const surface of roadSurfaces) {
    if (!(CARRIAGEWAY.test(surface.function) || surface.function === 'berm')) continue;
    for (const polygon of surface.polygons ?? []) {
      const outer = polygon[0];
      if (!outer || outer.length < 6) continue;
      let west = Infinity, north = Infinity, east = -Infinity, south = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        const x = outer[i], z = outer[i + 1];
        west = Math.min(west, x);
        north = Math.min(north, z);
        east = Math.max(east, x);
        south = Math.max(south, z);
      }
      addToCells(surfaces, surface.layer ?? 0, west, north, east, south, { polygon, kind: surface.function, general: surface.resolution === 'bgt-general' });
    }
  }
  for (const guardrail of barrierEvidence) {
    const { points } = guardrail;
    if (guardrail.type !== 'guardrail' || guardrail.solid || !points) continue;
    const bgt = guardrail.source === 'bgt';
    if (!bgt && !(guardrail.source === '1gis' && guardrail.route === 'A12' &&
          guardrail.side === 'right' && guardrail.matchConfidence === 'matched')) continue;
    const level = guardrail.level ?? 0;
    // The imported guardrail mesh starts at the first vertex and spaces the posts by four metres.
    const spacing = Number.isFinite(guardrail.spacing) && guardrail.spacing > 0 ? guardrail.spacing : 4;
    let next = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.03) continue;
      addToCells(rails, level, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz),
        { ax, az, bx, bz, length, guardrail });
      if (!bgt) continue;
      for (; next < length; next += spacing) {
        const x = ax + (bx - ax) * next / length;
        const z = az + (bz - az) * next / length;
        addToCells(posts, level, x, z, x, z, { x, z, guardrail });
      }
      next -= length;
    }
  }

  return (feature, x, z, road) => {
    if ((feature.type !== 'hecto' && feature.type !== 'rvv') || feature.placement === 'ABOVE') return { x, z };
    const [ux, uz] = feature.roadTangent ?? [road?.ux, road?.uz];
    const magnitude = Math.hypot(ux, uz);
    if (!(magnitude > 0)) return { x, z };
    const dx = ux / magnitude, dz = uz / magnitude;
    const a12Post = isA12Hectometer(feature);
    const rx = road?.x ?? x, rz = road?.z ?? z;
    const roadLayer = road?.layer ?? road?.road?.layer;
    const layer = (a12Post ? roadLayer : undefined) ?? feature.layer ?? feature.level ?? roadLayer ?? 0;
    const lateral = (z - rz) * dx - (x - rx) * dz;
    const cx = x + lateral * dz, cz = z - lateral * dx;
    const travel = Number.isFinite(feature.yaw) ? -Math.sin(feature.yaw) * dx - Math.cos(feature.yaw) * dz : 1;
    const side = a12Post && Number.isFinite(feature.yaw) ? (travel < 0 ? -1 : 1)
      : feature.pos_tv_wol === 'Li' ? -1 : feature.pos_tv_wol === 'Re' ? 1
      : Math.abs(lateral) > 0.25 ? Math.sign(lateral)
        : travel < 0 ? -1 : 1;

    const kind = road?.road?.kind;
    const motorway = kind === 'motorway' || kind === 'motorway_link' || /^A\d/.test(feature.wegnummer ?? feature.roadRef ?? '');
    const candidates = [...new Set(nearby(surfaces, layer, cx, cz, EDGE_REACH))];
    const pavement = ({ kind }) => kind !== 'berm' && (!motorway || kind === 'rijbaan autosnelweg' || kind === 'verbindingsweg');
    const intervals = mergePavement(candidates.filter(candidate => !candidate.general && pavement(candidate))
      .flatMap(({ polygon }) => pavementIntervals(polygon, cx, cz, dx, dz)));
    const section = intervals.find(([low, high]) => low <= 0 && high >= 0)
      ?? intervals.find(([low, high]) => low <= 1 && high >= -1);
    const edge = section?.[side > 0 ? 1 : 0];
    if (edge === undefined || Math.abs(edge) > EDGE_REACH) {
      if (feature.type !== 'hecto' || !Number.isFinite(road?.width)) return { x, z };
    }
    const boundary = edge !== undefined && Math.abs(edge) <= EDGE_REACH ? edge : side * road.width / 2;
    const verges = candidates.filter(candidate => !candidate.general && candidate.kind === 'berm')
      .flatMap(({ polygon }) => pavementIntervals(polygon, cx, cz, dx, dz));
    const vergeOffset = [BERM_OFFSET, 0.8, 1.2].find(distance => verges.some(([low, high]) => {
      const offset = boundary + side * distance;
      return low <= offset && offset <= high;
    }));
    const offset = boundary + side * (vergeOffset ?? BERM_OFFSET);
    const anchor = { x: cx - dz * offset, z: cz + dx * offset };
    if (a12Post) {
      let mount, reach = RAIL_REACH;
      for (const { ax, az, bx, bz, length, guardrail } of new Set(nearby(rails, layer, anchor.x, anchor.z, RAIL_REACH))) {
        const along = (bx - ax) * dx + (bz - az) * dz;
        if (Math.abs(along) < length * 0.8) continue;
        const t = ((cx - ax) * dx + (cz - az) * dz) / along;
        if (t < 0 || t > 1) continue;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        const across = ((pz - cz) * dx - (px - cx) * dz) * side;
        const gap = across - boundary * side;
        if (gap < -0.65 || gap >= reach) continue;
        mount = { x: px, z: pz, guardrail };
        reach = gap;
      }
      if (mount) return mount;

      // A widening shoulder or adjacent exit lane can cover the nominal verge.
      const pavementRight = mergePavement(candidates.filter(({ kind }) => kind !== 'berm').flatMap(({ polygon }) =>
        pavementIntervals(polygon, cx, cz, dx, dz)).map(([low, high]) => side > 0 ? [low, high] : [-high, -low]));
      let right = offset * side;
      for (const [low, high] of pavementRight) {
        if (right >= low - 0.15 && right <= high + 0.15) right = high + BERM_OFFSET;
      }
      return { x: cx - dz * right * side, z: cz + dx * right * side };
    }
    let mounted, nearest = POST_REACH ** 2;
    for (const post of nearby(posts, layer, anchor.x, anchor.z, POST_REACH)) {
      const distance = (post.x - anchor.x) ** 2 + (post.z - anchor.z) ** 2;
      if (distance > nearest) continue;
      const postOffset = (post.z - cz) * dx - (post.x - cx) * dz;
      if ((postOffset - boundary) * side < -0.02) continue;
      mounted = post;
      nearest = distance;
    }
    return mounted ?? anchor;
  };
}
