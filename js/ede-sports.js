import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, Fn, fwidth, If, length, max, min, mix, mx_noise_float,
  positionWorld, smoothstep, uniform } from 'three/tsl';
import { transparentEffectMRT } from './tsl-materials.js';
import { applySnowMaterial, iceSnowRetention, rinkSnowCover, snowCover, surfaceSnowCoverage } from './ede-snow.js';
import { polygonContains } from './building-collision.js';
import { drapeEdeSurface, edePoints, edePolygonGeometry, edeSpatialGroups } from './ede-geometry.js';
import { fitSportField, clipSportLine } from './ede-sport-fit.js';
import { sportLayout } from './ede-sport-layouts.js';
import { terrainHeightAt } from './terrain.js';
import { fitPlayableSport } from './ede-sport-activity.js';

const SURFACE_Y = 0.052;
const PAINT_Y = 0.085;
const SKATING_OVAL_SURFACE = 0xb9ae77;
// The multipurpose court beside De Zanding's indoor pool is flooded during frost.
const DE_ZANDING_WINTER_RINK = 'w60580311';
const rinkIceCover = uniform(0);

export function setEdeSportsIceCover(cover) {
  rinkIceCover.value = cover;
}

const rinkFrost = mx_noise_float(positionWorld.xz.mul(0.29), 0.62, 0.40).clamp().toVar();
const rinkIce = smoothstep(-0.07, 0.07, rinkIceCover.sub(mix(0.08, 0.92, rinkFrost))).toVar();

function makeRinkMaterial() {
  const material = new THREE.MeshStandardNodeMaterial();
  const ground = attribute('color', 'vec3');
  const ice = ground.mul(mix(0.065, 0.12, rinkFrost));
  material.colorNode = mix(ground, ice, rinkIce);
  material.roughnessNode = mix(0.90, 0.08, rinkIce);
  material.iceCoverageNode = rinkIce;
  return applySnowMaterial(material, { shelter: true, cover: mix(snowCover, rinkSnowCover, rinkIce),
    retention: mix(1, iceSnowRetention(), rinkIce) });
}
const WHITE = 0xf3f1df;
const STEEL = 0x555e5b;
const NET = 0xa7aaa0;
const SURFACE = {
  grass: 0x4e713d, artificial_turf: 0x48784b, tartan: 0xa75f4a,
  clay: 0xb2684c, concrete: 0x82847c, asphalt: 0x777874, paved: 0x858780,
  acrylic: 0x4a7491, synthetic: 0x4a7491, hard: 0x777874, paving_stones: 0x858780,
  fine_gravel: 0xa89c7d, compacted: 0xa09a78, sand: 0xbea47a,
};
const DEFAULT_SURFACE = {
  basketball: 'concrete', tennis: 'clay', padel: 'acrylic', pickleball: 'acrylic', volleyball: 'sand',
  handball: 'asphalt', athletics: 'tartan', boules: 'compacted', equestrian: 'sand', skateboard: 'concrete',
};

export async function loadEdeSports() {
  const response = await fetch(new URL('../assets/ede-sports.json', import.meta.url));
  if (!response.ok) throw new Error(`Pitch asset HTTP ${response.status}`);
  const asset = await response.json();
  const validRing = ring => Array.isArray(ring) && ring.length >= 6 && ring.length % 2 === 0 && ring.every(Number.isFinite);
  if (asset.version !== 1 || !Array.isArray(asset.pitches) || !asset.pitches.every(pitch =>
    typeof pitch.id === 'string' && Array.isArray(pitch.sports) && pitch.sports.every(sport => typeof sport === 'string') &&
    validRing(pitch.ring) && (pitch.holes === undefined || Array.isArray(pitch.holes) && pitch.holes.every(validRing)))) {
    throw new Error('Invalid Ede sport pitches');
  }
  return asset;
}

function collect(batch, geometry, tint) {
  const color = new THREE.Color(tint);
  const position = geometry.getAttribute('position'), index = geometry.getIndex();
  const band = batch.band && geometry.getAttribute('sportPaintBand');
  for (let i = 0; i < (index?.count ?? position.count); i++) {
    const v = index ? index.getX(i) : i;
    batch.positions.push(position.getX(v), position.getY(v), position.getZ(v));
    batch.colors.push(color.r, color.g, color.b);
    if (band) batch.band.push(band.getX(v), band.getY(v), band.getZ(v));
  }
  geometry.dispose();
}

function addStrip({ positions, band }, [ax, az], [bx, bz], width, isRink) {
  const dx = bx - ax, dz = bz - az;
  const length = Math.hypot(dx, dz);
  if (length < 0.015) return;
  // Extend the triangles past the stripe so subpixel coverage can be rendered
  // even when the centre of every nearby pixel falls outside the white paint.
  const half = width / 2, support = half + 0.48;
  const nx = -dz / length * support, nz = dx / length * support;
  const a = [ax + nx, PAINT_Y, az + nz], b = [bx + nx, PAINT_Y, bz + nz];
  const c = [bx - nx, PAINT_Y, bz - nz], d = [ax - nx, PAINT_Y, az - nz];
  positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  const rink = Number(isRink);
  band.push(support, half, rink, support, half, rink, -support, half, rink,
    support, half, rink, -support, half, rink, -support, half, rink);
}

function makePaintMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({
    vertexColors: true, roughness: 0.85, transparent: true, depthWrite: false,
  });
  material.mrtNode = transparentEffectMRT;
  const band = attribute('sportPaintBand', 'vec3');
  const pixel = fwidth(band.x).max(0.0001);
  const low = max(band.y.negate(), band.x.sub(pixel.mul(0.5)));
  const high = min(band.y, band.x.add(pixel.mul(0.5)));
  const fade = smoothstep(290, 435, length(positionWorld.sub(cameraPosition))).oneMinus();
  const ice = Fn(() => {
    const cover = float(0).toVar();
    If(band.z.greaterThan(0.5).and(rinkIceCover.greaterThan(0)), () => cover.assign(rinkIce));
    return cover;
  })();
  material.opacityNode = high.sub(low).max(0).div(pixel).mul(fade)
    .mul(surfaceSnowCoverage({ shelter: true }).oneMinus()).mul(ice.oneMinus());
  return material;
}

function addEquipment(batch, equipment, at, contains, sport) {
  const { u, v, width, height, dir = 1 } = equipment;
  const half = width / 2;
  const anchor = (a, b, y = 0) => {
    const [x, z] = at(a, b);
    return new THREE.Vector3(x, terrainHeightAt(x, z) + SURFACE_Y + y, z);
  };
  const inField = (a, b) => contains(...at(a, b));
  const bar = (a, b, width, color) => addBar(batch, a, b, width, color);

  if (equipment.kind === 'goal') {
    if (!inField(u, v - half) || !inField(u, v + half)) return;
    const foot = [anchor(u, v - half), anchor(u, v + half)];
    const top = [anchor(u, v - half, height), anchor(u, v + half, height)];
    const diameter = width >= 6 ? 0.105 : 0.075;
    bar(top[0], top[1], diameter, WHITE);
    for (let i = 0; i < 2; i++) bar(foot[i], top[i], diameter, WHITE);
    let back = u - dir * Math.min(1.7, height * 0.68);
    if (!inField(back, v - half) || !inField(back, v + half)) back = (back + u) / 2;
    if (!inField(back, v - half) || !inField(back, v + half)) return;
    const rear = [anchor(back, v - half, 0.05), anchor(back, v + half, 0.05)];
    for (let i = 0; i < 2; i++) {
      bar(foot[i], rear[i], 0.055, WHITE);
      bar(top[i], rear[i], 0.035, NET);
    }
    bar(rear[0], rear[1], 0.05, WHITE);
    const count = Math.ceil(width / 0.55);
    for (let i = 1; i < count; i++) bar(top[0].clone().lerp(top[1], i / count),
      rear[0].clone().lerp(rear[1], i / count), 0.012, NET);
    for (const t of [0.25, 0.5, 0.75]) bar(rear[0].clone().lerp(top[0], t), rear[1].clone().lerp(top[1], t), 0.012, NET);
  } else if (equipment.kind === 'net') {
    if (!inField(u, v - half) || !inField(u, v + half)) return;
    const feet = [anchor(u, v - half, 0.08), anchor(u, v + half, 0.08)];
    const top = [anchor(u, v - half, height), anchor(u, v + half, height)];
    for (let i = 0; i < 2; i++) bar(feet[i], top[i], 0.085, STEEL);
    bar(top[0], top[1], 0.048, WHITE);
    const count = Math.ceil(width / 0.42);
    for (let i = 1; i < count; i++) bar(feet[0].clone().lerp(feet[1], i / count), top[0].clone().lerp(top[1], i / count), 0.011, STEEL);
    for (const t of [0.18, 0.42, 0.66, 0.9]) bar(feet[0].clone().lerp(top[0], t), feet[1].clone().lerp(top[1], t), 0.011, STEEL);
  } else if (equipment.kind === 'basket' || equipment.kind === 'korf') {
    if (!inField(u, v)) return;
    const korf = sport === 'korfball' || equipment.kind === 'korf';
    const pole = !korf && inField(u - dir * 0.9, v) ? u - dir * 0.9 : u;
    bar(anchor(pole, v), anchor(pole, v, height + 0.3), 0.12, STEEL);
    const rimU = korf ? u : u + dir * 0.28;
    if (!korf) {
      bar(anchor(pole, v, height + 0.28), anchor(u, v, height + 0.28), 0.1, STEEL);
      const centre = anchor(u, v, height + 0.36);
      const [ax, az] = at(u, v - half), [bx, bz] = at(u, v + half);
      const angle = Math.atan2(az - bz, bx - ax);
      collect(batch, new THREE.BoxGeometry(width, 0.96, 0.075).rotateY(angle).translate(centre.x, centre.y, centre.z), WHITE);
    }
    const rim = anchor(rimU, v, height);
    collect(batch, new THREE.TorusGeometry(korf ? 0.22 : 0.23, 0.027, 5, 20).rotateX(Math.PI / 2)
      .translate(rim.x, rim.y, rim.z), korf ? 0xecc335 : 0xd9552e);
    if (!korf) for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const x = Math.cos(angle) * 0.23, z = Math.sin(angle) * 0.23;
      bar(rim.clone().add(new THREE.Vector3(x, 0, z)), rim.clone().add(new THREE.Vector3(x * 0.65, -0.34, z * 0.65)), 0.012, NET);
    }
  } else if (equipment.kind === 'table') {
    const { length } = equipment;
    if (![-1, 1].every(side => inField(u + length / 2, v + side * half) &&
      inField(u - length / 2, v + side * half))) return;
    const centre = anchor(u, v, height);
    const [ax, az] = at(u, v), [bx, bz] = at(u + 1, v);
    const yaw = Math.atan2(az - bz, bx - ax);
    collect(batch, new THREE.BoxGeometry(length, 0.065, width).rotateY(yaw)
      .translate(centre.x, centre.y, centre.z), 0x467584);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const a = u + x * length * 0.35, b = v + z * width * 0.35;
      bar(anchor(a, b), anchor(a, b, height), 0.075, STEEL);
    }
    bar(anchor(u, v - half, height + 0.16), anchor(u, v + half, height + 0.16), 0.035, WHITE);
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function addBar(batch, a, b, width, color) {
  const axis = b.clone().sub(a), length = axis.length();
  if (length < 0.015) return;
  const rotation = new THREE.Quaternion().setFromUnitVectors(UP, axis.divideScalar(length));
  collect(batch, new THREE.BoxGeometry(width, length, width).applyQuaternion(rotation).translate(
    (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2
  ), color);
}

function addPadelFrame(batch, outer) {
  if (outer.length !== 4) return;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length];
    const base = new THREE.Vector3(a.x, terrainHeightAt(a.x, a.z) + SURFACE_Y, a.z);
    const top = base.clone().addScaledVector(UP, 3);
    addBar(batch, base, top, 0.07, STEEL);
    addBar(batch, top, new THREE.Vector3(b.x, terrainHeightAt(b.x, b.z) + SURFACE_Y + 3, b.z), 0.06, STEEL);
  }
}

function makeMesh(group, batch, material, name, close = false) {
  if (!batch.positions.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
  if (batch.band) geometry.setAttribute('sportPaintBand', new THREE.Float32BufferAttribute(batch.band, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  if (batch.band) mesh.renderOrder = -1;
  if (close) mesh.userData.cullDistance = 430;
  group.add(mesh);
  return geometry.attributes.position.count / 3;
}

export function buildEdeSports(scene, asset, { playableFields } = {}) {
  const group = new THREE.Group();
  group.name = 'Ede sports fields';
  const surface = applySnowMaterial(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.93 }),
    { shelter: true });
  const paint = makePaintMaterial();
  const rink = makeRinkMaterial();
  const stats = { pitches: 0, layouts: {}, surfaceOnly: 0, triangles: 0, meshes: 0 };
  const built = new Set(asset.source?.tesquaSupersedes ?? []);
  const fields = asset.pitches.map(record => ({
    record, polygon: { outer: edePoints(record.ring), holes: (record.holes ?? []).map(edePoints) },
    frame: fitSportField(record),
  }));
  const location = ({ frame, polygon: { outer } }) => frame ?? outer[0];
  for (const cell of edeSpatialGroups(fields, location)) {
    const ground = { positions: [], colors: [] };
    const skating = { positions: [], colors: [] };
    const props = { positions: [], colors: [] };
    const lines = new Map();
    const painted = { positions: [], colors: [], band: [] };
    for (const { record, polygon, frame } of cell) {
      const { outer, holes } = polygon;
      const sports = record.diamond?.rules ? [record.diamond.rules] : record.sports;
      const layout = frame && sportLayout(sports, frame.length, frame.width, {
        ...frame, athletics: record.athletics, lanes: record.lanes,
      });
      const sport = layout?.sport;
      const oval = record.sports.includes('ice_skating');
      const isRink = oval || record.id === DE_ZANDING_WINTER_RINK;
      if (frame && playableFields) {
        const playable = fitPlayableSport(record.id, frame, polygon, layout, isRink, SURFACE_Y);
        if (playable) playableFields.push(playable);
      }
      const tint = SURFACE[record.surface] ?? (oval ? SKATING_OVAL_SURFACE :
        SURFACE[DEFAULT_SURFACE[sport ?? record.sports[0]]] ?? SURFACE.grass);
      collect(isRink ? skating : ground, drapeEdeSurface(edePolygonGeometry(outer, holes, SURFACE_Y), true), tint);
      built.add(record.id);
      stats.pitches++;
      if (!layout || !(layout.lines.length || layout.fills?.length || layout.equipment?.length)) {
        stats.surfaceOnly++;
        continue;
      }
      stats.layouts[sport] = (stats.layouts[sport] ?? 0) + 1;
      const at = (u, v) => [frame.x + frame.ux * u + frame.vx * v, frame.z + frame.uz * u + frame.vz * v];
      const contains = (x, z) => polygonContains(polygon, x, z);
      for (const { points, width, color = WHITE } of layout.lines) {
        if (!lines.has(color)) lines.set(color, { positions: [], band: [] });
        for (let i = 1; i < points.length; i++) {
          for (const [a, b] of clipSportLine(at(...points[i - 1]), at(...points[i]), polygon)) {
            addStrip(lines.get(color), a, b, width, isRink);
          }
        }
      }
      for (const [index, fill] of (layout.fills ?? []).entries()) {
        const points = fill.points.map(p => at(...p));
        if (!points.every(p => contains(...p))) continue;
        collect(isRink ? skating : ground, drapeEdeSurface(edePolygonGeometry(points.map(([x, z]) => ({ x, z })),
          [], SURFACE_Y + 0.004 + index * 0.0012), true), fill.color);
      }
      for (const item of layout.equipment ?? []) addEquipment(props, item, at, contains, sport);
      if (sport === 'padel') addPadelFrame(props, outer);
    }
    for (const [color, { positions, band }] of lines) {
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('sportPaintBand', new THREE.Float32BufferAttribute(band, 3));
      collect(painted, drapeEdeSurface(geometry, true, undefined, false, 'sportPaintBand'), color);
    }
    stats.triangles += makeMesh(group, ground, surface, 'Pitch surfaces') ?? 0;
    stats.triangles += makeMesh(group, skating, rink, 'Seasonal skating surfaces') ?? 0;
    stats.triangles += makeMesh(group, painted, paint, 'Pitch markings', true) ?? 0;
    stats.triangles += makeMesh(group, props, surface, 'Pitch goals, nets and hoops', true) ?? 0;
  }
  stats.meshes = group.children.length;
  if (stats.meshes) {
    const firstByMaterial = new Map();
    for (const mesh of group.children) {
      const first = firstByMaterial.get(mesh.material);
      if (first) mesh.userData.sharesPipelineWith = first;
      else firstByMaterial.set(mesh.material, mesh);
    }
  }
  group.userData.stats = stats;
  scene.add(group);
  return built;
}
