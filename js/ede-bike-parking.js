import * as THREE from 'three/webgpu';
import { localClock, weekday } from './ede-transit-time.js';
import { parkingAppearanceSeed } from './ede-parking-demand.js';

const CELL = 96, VIEW_RADIUS = 215, DRAW_CAPACITY = 256;
const STAND_DRAW_CAPACITY = DRAW_CAPACITY * 3;
const SECOND = 1000;
const profiles = {
  school:  [[0, .03], [7, .03], [8.6, .86], [14.6, .83], [17, .09], [20, .03]],
  station: [[0, .15], [5, .13], [7, .43], [9, .79], [15, .78], [18.5, .40], [22, .22]],
  shops:   [[0, .08], [7, .10], [10, .49], [14, .68], [18, .45], [21, .11]],
  sport:   [[0, .03], [8, .07], [13, .22], [17, .64], [21, .39], [23, .08]],
  public:  [[0, .18], [7, .22], [11, .41], [17, .46], [21, .30]]
};
const dwell = { school: [45, 360], station: [60, 480], shops: [14, 55], sport: [30, 105], public: [25, 125] };
const cellKey = (x, z) => Math.floor(x / CELL) + '/' + Math.floor(z / CELL);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const seeded = id => parkingAppearanceSeed(id) / 0x100000000;

export function bikeStyleFor(secondarySchool, draw = Math.random()) {
  if (draw < (secondarySchool ? .08 : .04)) return 'fatbike';
  if (draw < .30) return 'ebike';
  return draw < .83 ? 'omafiets' : 'transportfiets';
}

export function bikeParkingTime(now = Date.now()) {
  const { date, seconds } = localClock(now / SECOND);
  const day = weekday(date);
  return { hour: seconds / 3600, weekend: day === 0 || day === 6 };
}

export function bikeParkingOccupancy(kind, { hour, weekend }) {
  if (kind === 'school' && weekend) return .035;
  const points = profiles[kind] ?? profiles.public;
  let value = points[0][1];
  for (let i = 1; i <= points.length; i++) {
    const [to, end] = points[i] ?? [24, points[0][1]], [from, start] = points[i - 1];
    if (hour > to) continue;
    value = start + (end - start) * (hour - from) / (to - from);
    break;
  }
  if (weekend && kind === 'station') return value * .57;
  if (weekend && kind === 'sport' && hour >= 9 && hour < 17) return Math.max(.56, value);
  return value;
}

// Existing cycle approaches only. Transfers represent walking the last few metres with the bike.
function approaches(site, tracks, canWalk, ground) {
  const result = new Map(), candidates = [];
  if (site.kind === 'white-bike' || !['public', 'permissive', 'customers', 'school', 'students', 'unknown', undefined].includes(site.access)) return result;
  const { wayId, reach = 10, via, maxHeightDifference = .8 } = site.handoff ?? {};
  const layer = site.level ?? 0;
  const clear = (a, b) => canWalk(a.x, a.z, b.x, b.z, layer);
  const reaches = (from, slot) => via
    ? distance(from, via) + distance(via, slot) <= reach && clear(from, via) && clear(via, slot)
    : distance(from, slot) <= reach && clear(from, slot);
  for (const slot of site.slots) {
    const origin = via ?? slot;
    tracks(origin.x, origin.z, reach + 1, candidates);
    let best = null;
    for (const track of candidates) {
      if ((track.layer ?? 0) !== layer || track.crossing || track.noSpawn || track.structure || track.sharedRoad ||
          (wayId && track.wayId !== wayId) || track.len < 3 || !track.allowed?.some(Boolean)) continue;
      const margin = Math.min(2, track.len / 3);
      const at = Math.max(margin, Math.min(track.len - margin, (origin.x - track.ax) * track.ux + (origin.z - track.az) * track.uz));
      const x = track.ax + at * track.ux, z = track.az + at * track.uz, d = distance({ x, z }, origin);
      if (d >= (best?.distance ?? Infinity) || Math.abs(ground(track, x, z) - slot.y) > maxHeightDifference ||
          !reaches({ x, z }, slot)) continue;
      best = { track, at, x, z, distance: d };
    }
    if (!best) continue;
    const group = result.get(best.track);
    if (group) {
      if (reaches(group, slot)) group.slots.push(slot);
    }
    else result.set(best.track, { ...best, slots: [slot] });
  }
  return result;
}

export function createBikeParkingState(sites, tracks, canWalk, ground) {
  const cells = new Map(), areas = new Map();
  for (const site of sites) {
    const slots = site.slots.filter(slot => [slot.x, slot.y, slot.z, slot.yaw].every(Number.isFinite));
    if (!slots.length) continue;
    const x = site.x ?? slots.reduce((sum, slot) => sum + slot.x, 0) / slots.length;
    const z = site.z ?? slots.reduce((sum, slot) => sum + slot.z, 0) / slots.length;
    const area = { ...site, x, z, slots, anchors: approaches({ ...site, slots }, tracks, canWalk, ground) };
    area.spaces = new Map(slots.map(slot => [slot.id, {
      slot, seed: seeded(slot.id), style: site.kind === 'white-bike' ? 'white-bike' : bikeStyleFor(site.secondary, seeded(slot.id + '/style')),
      change: null,
    }]));
    areas.set(site.id, area);
    const key = cellKey(x, z);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(area);
  }
  const places = [...areas.values()].filter(area => area.anchors.size).map(area => ({
    id: 'bike-parking/' + area.id, kind: area.kind === 'sport' ? 'shops' : area.kind === 'public' ? 'parking' : area.kind,
    secondary: area.secondary, bikeParking: area.id,
    bikeAnchors: [...area.anchors.values()].map(({ track, at, x, z }) => ({ track, at, x, z })),
  }));
  const stats = { areas: areas.size, slots: [...areas.values()].reduce((sum, area) => sum + area.slots.length, 0),
    connected: places.length, arrived: 0, departed: 0, drawn: 0 };
  let nearby = [], time = bikeParkingTime(), nextRefresh = -Infinity, now = Date.now(), dirty = true;

  function around(x, z, radius) {
    const result = [];
    for (let a = Math.floor((x - radius) / CELL); a <= Math.floor((x + radius) / CELL); a++) {
      for (let b = Math.floor((z - radius) / CELL); b <= Math.floor((z + radius) / CELL); b++) {
        for (const area of cells.get(a + '/' + b) ?? []) {
          if (Math.hypot(area.x - x, area.z - z) <= radius) result.push(area);
        }
      }
    }
    return result;
  }
  function occupant(space, area) {
    if (space.change?.until > now) return space.change.style;
    return space.seed < area.occupancy ? space.style : null;
  }
  let lastParkActivity, lastParkReturns;
  function tick(x, z, clock, moved, epoch = Date.now(), parkActivity = 0, parkReturns = 0) {
    moved ||= parkActivity !== lastParkActivity || parkReturns !== lastParkReturns;
    lastParkActivity = parkActivity;
    lastParkReturns = parkReturns;
    if (clock < nextRefresh && !moved) return;
    nextRefresh = clock + 30;
    now = epoch;
    time = bikeParkingTime(now);
    nearby = around(x, z, VIEW_RADIUS + 26).sort((a, b) => distance(a, { x, z }) - distance(b, { x, z }));
    const exploring = parkActivity * (1 - .8 * parkReturns);
    for (const area of nearby) {
      area.occupancy = area.kind !== 'white-bike' ? bikeParkingOccupancy(area.kind, time)
        : area.entrance ? .96 - .52 * exploring : .62 + .30 * exploring;
    }
    dirty = true;
  }
  function park(goal, areaId, style, canTransfer) {
    const area = areas.get(areaId), anchor = area?.anchors.get(goal.track);
    if (!anchor || !nearby.includes(area)) return false;
    const slot = anchor.slots.find(slot => !occupant(area.spaces.get(slot.id), area) && canTransfer(slot));
    if (!slot) return false;
    const [min, max] = dwell[area.kind] ?? dwell.public;
    const ready = now + (min + (max - min) * seeded(slot.id + '/dwell')) * 60 * SECOND;
    area.spaces.get(slot.id).change = { style, ready, until: ready + 30 * 60 * SECOND };
    stats.arrived++;
    dirty = true;
    return true;
  }
  function depart(accept) {
    for (const area of nearby) {
      if (area.kind === 'school' && (time.weekend || time.hour < 14 || time.hour >= 18)) continue;
      for (const anchor of area.anchors.values()) {
        for (const slot of anchor.slots) {
          const space = area.spaces.get(slot.id), style = occupant(space, area);
          // Bikes parked by a simulated arrival finish their dwell before departure.
          if (!style || space.change?.ready > now || !accept(anchor, slot, style, area)) continue;
          space.change = { style: null, until: now + 25 * 60 * SECOND };
          stats.departed++;
          dirty = true;
          return true;
        }
      }
    }
    return false;
  }
  function secondaryNear(x, z) {
    if (time.weekend || time.hour < 7 || time.hour >= 17) return false;
    return around(x, z, 105).some(area => area.secondary);
  }
  function changed() {
    const needsUpdate = dirty;
    dirty = false;
    return needsUpdate;
  }
  return { places, areas, stats, tick, park, depart, secondaryNear, occupant, changed, nearby: () => nearby };
}

export function renderBikeParking(parent, state, bikeModels) {
  const group = new THREE.Group();
  group.name = 'Ede bicycle parking';
  parent.add(group);
  const instances = (geometry, material, capacity = DRAW_CAPACITY) => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.visible = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const models = new Map([...bikeModels].map(([id, base]) => {
    const mesh = instances(base.geometry, base.material);
    mesh.userData.sharesPipelineWith = base;
    return [id, mesh];
  }));
  const stand = instances(new THREE.BoxGeometry(.05, .045, 1.04),
    new THREE.MeshStandardNodeMaterial({ color: 0x666d6e, metalness: .26, roughness: .68 }), STAND_DRAW_CAPACITY);
  const meshes = [...models.values(), stand];
  const pose = new THREE.Object3D();
  const usedStands = new Set();
  return () => {
    if (!state.changed()) return;
    for (const mesh of meshes) mesh.count = 0;
    usedStands.clear();
    state.stats.drawn = 0;
    for (const area of state.nearby()) {
      for (const space of area.spaces.values()) {
        const { slot } = space;
        const rail = slot.stand;
        if (rail && stand.count < STAND_DRAW_CAPACITY && !usedStands.has(slot.rackId)) {
          usedStands.add(slot.rackId);
          pose.rotation.set(0, rail.yaw, 0);
          pose.position.set(rail.x, rail.y + .68, rail.z);
          pose.scale.set(1, 1, 1);
          pose.updateMatrix();
          stand.setMatrixAt(stand.count++, pose.matrix);
          for (const along of [-.5, .5]) {
            pose.position.set(rail.x + Math.sin(rail.yaw) * along, rail.y + .34, rail.z + Math.cos(rail.yaw) * along);
            pose.scale.set(1, 14.8, .047);
            pose.updateMatrix();
            stand.setMatrixAt(stand.count++, pose.matrix);
          }
        }
        const mesh = models.get(state.occupant(space, area));
        if (!mesh || state.stats.drawn >= DRAW_CAPACITY) continue;
        pose.position.set(slot.x, slot.y, slot.z);
        pose.rotation.set(0, slot.yaw, .06);
        pose.scale.set(1, 1, 1);
        pose.updateMatrix();
        mesh.setMatrixAt(mesh.count++, pose.matrix);
        state.stats.drawn++;
      }
    }
    for (const mesh of meshes) {
      mesh.visible = mesh.count > 0;
      if (mesh.visible) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  };
}
