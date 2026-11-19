import { getTerrain, terrainHeightAt } from '../js/terrain.js';
import { gradeCuts, gradeDeckAt, gradeProfileAt, gradeWayAt, railHeightAt } from '../js/ede-grade.js';
import { BUS, VAN, fitsRoad, VEHICLE_CLEARANCE } from '../js/road-access.js';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const heading = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
const position = (entity) => [entity.position.x, entity.position.z, entity.position.y];
const round = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
const roundPoint = (point) => point.map(round);
const cameraClearance = 0.22;

function pointsOnRoute(points, spacing) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const count = Math.ceil(distance(a, b) / spacing);
    for (let j = 1; j <= count; j++) out.push(a.map((v, k) => v + (b[k] - v) * j / count));
  }
  return out;
}

function contact(manager, route, point, mode, axis) {
  const [x, z, y] = point;
  const ground = terrainHeightAt(x, z);
  if (mode === 'train') {
    const rail = railHeightAt(route.way, x, z);
    const deck = route.level === 'lower' ? gradeDeckAt(x, z) : undefined;
    return { y: (rail ?? ground) + 0.13, terrain: ground, roof: deck === undefined ? undefined : deck - 0.62,
      source: rail === undefined ? 'railhead from AHN grid' : 'rail profile at railhead' };
  }
  const fitted = gradeProfileAt(x, z, mode, axis, y, route.profile)
    ?? gradeWayAt(route.way, x, z);
  return { y: fitted?.y ?? manager.getGroundHeight(x, z, mode, ground),
    terrain: ground, roof: fitted?.roof, id: fitted?.id ?? fitted?.span?.profile?.id,
    source: fitted ? 'fitted grade' : 'AHN grid' };
}

function testMovement(app, route, path, mode) {
  const manager = app.controllerManager;
  const active = manager.entities[mode];
  const issues = new Set();
  const firstHeading = heading(path[0], path[1]);
  const at = (point, axis) => contact(manager, route, point, mode, axis);
  const middle = route.middle;
  const mid = at(middle, route.heading);
  manager.setMode(mode);
  for (const entity of Object.values(manager.entities)) {
    if (entity !== active) entity.position.set(30, 5, -22);
  }
  const middleHeading = route.heading + (path === route.points ? 0 : Math.PI);
  manager.teleportActiveTo(middle[0], middle[1], middleHeading, mid.y);
  const direct = position(active);
  if (distance(middle, direct) > 1.2 || Math.abs(direct[2] - mid.y) > 0.55) issues.add('midpoint spawn displaced');
  const start = at(path[0], firstHeading);
  manager.teleportActiveTo(path[0][0], path[0][1], firstHeading, start.y);
  const entry = position(active);
  if (distance(entry, path[0]) > 1.2 || Math.abs(entry[2] - start.y) > 0.55) issues.add('approach spawn displaced');
  manager.setTouchInput('forward', mode === 'person' ? 0.48 : 0.55);
  const points = pointsOnRoute(path, 2.4);
  let target = 1, ticks = 0, peakError = 0, heightStep = 0;
  let largestStep, roofConflict;
  const camera = app.cameraSystem;
  camera.resetForTeleport();
  camera.setCameraPreset('chase', true);
  const simulatedSeconds = 1 / 25;
  while (target < points.length && ticks < Math.max(160, points.length * 40)) {
    const previous = position(active);
    if (distance(previous, points[target]) < 0.85) {
      target++;
      continue;
    }
    active.heading = heading(previous, points[target]);
    active.speed = Math.min(active.speed, mode === 'person' ? 3.8 : 4.6);
    const expected = at(points[target], active.heading);
    if (mode === 'person') manager.updatePerson(simulatedSeconds);
    else if (mode === 'car') manager.updateCar(simulatedSeconds, ticks * simulatedSeconds);
    else manager.updateCyclist(simulatedSeconds, active, mode);
    if (!Number.isFinite(active.position.y)) {
      issues.add('invalid ground height');
      break;
    }
    ticks++;
    const step = Math.abs(active.position.y - previous[2]);
    if (step > heightStep) {
      heightStep = step;
      largestStep = [previous, position(active)].map(roundPoint);
    }
    const atPlayer = contact(manager, route, position(active), mode, active.heading);
    if (distance(position(active), points[target]) < 2.7 && Number.isFinite(expected.y)) {
      peakError = Math.max(peakError, Math.abs(active.position.y - atPlayer.y));
    }
    if (ticks % 8 === 0) {
      camera.update(simulatedSeconds * 8, ticks * simulatedSeconds);
      const x = camera.currentPos.x, z = camera.currentPos.z;
      const view = gradeProfileAt(x, z, mode, active.heading, undefined, route.profile);
      if (view && view.id === atPlayer.id && Number.isFinite(view.roof) && camera.currentPos.y > view.roof - cameraClearance) {
        issues.add('follow camera crosses the soffit');
        roofConflict ??= { player: roundPoint(position(active)), camera: roundPoint([x, z, camera.currentPos.y]),
          soffit: round(view.roof) };
      }
    }
  }
  manager.resetInput();
  const exit = position(active);
  if (target < points.length && distance(exit, points.at(-1)) > 1.25) issues.add('controller could not reach exit');
  if (heightStep > 0.8) issues.add('height jumps during traversal');
  if (peakError > 0.9) issues.add('controller separates from route surface');
  return { status: issues.size ? 'fail' : 'pass', issues: [...issues], direct: roundPoint(direct),
    entry: roundPoint(entry), exit: roundPoint(exit), maxHeightStep: round(heightStep), maxSurfaceError: round(peakError),
    ...(heightStep > 0.8 && { largestStep }), ...(roofConflict && { roofConflict }) };
}

function testTrain(app, route, points) {
  const approach = points[0], exit = points.at(-1);
  const paths = app.trainSystem?.tracks?.paths ?? [];
  const match = paths.map(path => {
    const start = path.project(...approach), end = path.project(...exit), middle = path.project(...route.middle);
    return { path, start, end, error: Math.max(start.error, end.error, middle.error) };
  }).filter(row => row.start.distance + 1 < row.end.distance && row.error <= 1.45)
    .sort((a, b) => a.error - b.error)[0];
  if (!match) return { status: 'unverified', issues: ['No train service path matched this track and direction'] };
  const { path, start, end, error } = match;
  let maxStep = 0, maxRailError = 0;
  let previous;
  const pointsTested = Math.ceil(end.distance - start.distance);
  let measured = false;
  for (let i = 0; i <= pointsTested; i++) {
    const pose = path.sample(start.distance + i * (end.distance - start.distance) / pointsTested);
    const rail = railHeightAt(route.way, pose.x, pose.z);
    if (previous) maxStep = Math.max(maxStep, Math.abs(pose.y - previous.y));
    if (Number.isFinite(rail)) {
      measured = true;
      maxRailError = Math.max(maxRailError, Math.abs(pose.y - rail - 0.13));
    }
    previous = pose;
  }
  const issues = [];
  if (maxStep > 0.5 || measured && maxRailError > 0.3) issues.push('Train diverges from continuous track height');
  return { status: issues.length ? 'fail' : 'pass', issues, modeledTrainPath: path.id,
    railSamples: pointsTested + 1, maxHeightStep: round(maxStep), alignmentError: round(error) };
}

function testRoute(app, route) {
  const manager = app.controllerManager;
  const checks = {};
  for (const [direction, modes] of Object.entries(route.directions)) {
    const path = direction === 'forward' ? route.points : [...route.points].reverse();
    for (const mode of modes) {
      const key = `${direction}/${mode}`;
      if (mode === 'train') {
        checks[key] = testTrain(app, route, path);
      } else if (mode === 'bus' || mode === 'van') {
        const bit = mode === 'bus' ? BUS : VAN;
        const directed = Number((direction === 'reverse') !== route.reversed);
        const near = app.trafficSystem.network.edges.filter(edge => edge.wayId === route.way
          && edge.direction === directed && (edge.modes & bit)
          && fitsRoad(VEHICLE_CLEARANCE[mode], edge.limits, bit));
        checks[key] = { status: 'unverified', ...(near.length === 0 && { issues: ['No matching ambient traffic route'] }), directionalEdges: near.length,
          onward: near.some(e => (mode === 'van' ? e.vanMoves : e.moves).length) };
      } else {
        checks[key] = testMovement(app, route, path, mode);
      }
    }
  }
  const mode = Object.values(route.directions).flat().find(m => m !== 'bus' && m !== 'van') ?? 'car';
  const measure = point => {
    const [x, z] = point;
    const hit = contact(manager, route, point, mode, route.heading);
    const origin = getTerrain()?.napOrigin ?? 0;
    const cut = gradeCuts({ minX: x - 0.03, minZ: z - 0.03, maxX: x + 0.03, maxZ: z + 0.03 })
      .some(area => area.planes.every(([nx, nz, c]) => nx * x + nz * z >= c));
    return { x: round(x), z: round(z), surfaceNAP: round(hit.y + origin), terrainNAP: round(hit.terrain + origin),
      roofNAP: round(hit.roof + origin), clearance: round(hit.roof - hit.y), cut, source: hit.source };
  };
  const heights = [route.points[0], route.middle, route.points.at(-1)].map(measure);
  return { ...route, points: undefined, portals: route.portals.map(measure), middle: roundPoint(route.middle), heights, checks };
}

export async function auditSite(app, site) {
  const routes = [];
  for (const route of site.routes) {
    routes.push(testRoute(app, route));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const [x, z] = site.center;
  const height = terrainHeightAt(x, z);
  app.setCamera(x + 28, height + 26, z + 32, x, height, z);
  await new Promise(resolve => setTimeout(resolve, 285));
  const traffic = app.trafficSystem;
  const actors = [...traffic.cars, ...traffic.buses, ...traffic.bikes]
    .filter(actor => actor.edge && distance([x, z], [actor.x, actor.z]) < 90);
  const movingTrains = app.trainSystem?.active ?? [];
  const trafficByLevel = {};
  for (const side of new Set(routes.map(route => route.level))) {
    const wayIds = new Set(routes.filter(route => route.level === side).map(route => route.way));
    const railRoutes = routes.filter(route => route.level === side && route.directions.forward.includes('train'));
    const trains = movingTrains.filter(actor => actor.root.children.some(cart => cart.visible &&
      railRoutes.some(route => distance(route.middle, [cart.position.x, cart.position.z]) < 55 &&
        Math.abs(cart.position.y - (railHeightAt(route.way, cart.position.x, cart.position.z)
          ?? terrainHeightAt(cart.position.x, cart.position.z)) - 0.13) < 0.5)));
    trafficByLevel[side] = actors.filter(actor => wayIds.has(actor.edge?.wayId ?? actor.edge?.track?.wayId)).length + trains.length;
  }
  const wrongLevelMoves = [];
  for (const junction of site.crossings ?? []) {
    const { upperWayId, lowerWayId, center } = junction;
    for (const edge of traffic.network.edges) {
      if (edge.wayId !== upperWayId && edge.wayId !== lowerWayId) continue;
      if (distance(center, [edge.to.x, edge.to.z]) > 3) continue;
      if (edge.moves.some(move => move.to.wayId === (edge.wayId === upperWayId ? lowerWayId : upperWayId))) {
        wrongLevelMoves.push(junction);
        break;
      }
    }
  }
  return { ...site, routes, trafficByLevel, wrongLevelMoves };
}
