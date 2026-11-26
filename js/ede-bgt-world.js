import * as THREE from 'three/webgpu';
import { color, length, smoothstep, uniform, uv } from 'three/tsl';
import { transparentEffectMRT } from './tsl-materials.js';
import { addMemberStroke, createMemberStrokes, mastStrokeMesh, memberStrokeMaterial, memberStrokeMesh } from './ede-mast-strokes.js';
import { edeBounds, edePoints, edePolygonGeometry, EDE_RENDER_CELL } from './ede-geometry.js';
import { terrainHeightAt } from './terrain.js';
import { createWindmillRig } from './ede-windmill.js';
import { EDE_DATA } from './ede-geodata.js';
import { buildSmallBridge, matchSmallBridgeDecks } from './ede-bridge.js';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';

const PALETTE = {
  deck: 0x989797, abutment: 0x98938a, platform: 0xb3aea3, platformEdge: 0xe0ddd0,
  bridgeAsphalt: 0x5c5b56, bridgeWood: 0x8c6d4f, bridgeWoodJoint: 0x5c4939, bridgeMetal: 0x666e70,
  bridgeBrick: 0x8e6654, bridgePaving: 0xa9a298, bridgeRail: 0x929d9b, bridgeGravel: 0x8b8275, bridgeEarth: 0x8c765b,
  noiseWall: 0x69776b, civilWall: 0x9a9489, retainingWall: 0x817f78,
  tank: 0xb7b9b6, shed: 0x777f81, footing: 0x85847c, steel: 0x797f80, turbine: 0xe1e2de,
};

// The fitted Hall of Fame backing model includes these two retaining approaches.
const REPLACED_WALLS = new Set([
  'L0002.80e3a26ba49b4f55bcb97658316d4005', 'L0002.f11210899e044752ab4109bbccedc279',
]);
const AUTHORED_PLATFORMS = new Set([
  // Lunteren has surveyed platform slopes and ramp models.
  'L0004.0971bf0fc3ca4d938b074c2793e4456e', 'L0004.4403f8468bde4df2bd96574e02e347b8',
  // De Klomp has two authored slabs across these BGT sections.
  'L0004.259ce80caac146b58d788438f3c4820d', 'L0004.990e57a3116d460581441bb3543ba347',
  'L0004.ab7c81b3b4210f19e0530b29a8c02470', 'L0004.ef6e5e029d594e3cae6f8908baccb259',
]);
const MAANDERBROEK_HUB_HEIGHT = 99.5;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export async function loadEdeBgt() {
  const response = await fetch(new URL('../assets/ede-bgt.json', import.meta.url));
  if (!response.ok) throw new Error(`BGT structure request failed: ${response.status}`);
  const asset = await response.json();
  if (asset.version !== 1 || !Array.isArray(asset.structures)) throw new Error('Invalid Ede BGT structure asset');
  return asset;
}

function makeDeckProfile(feature, gradeSurfaceAt, offset = -0.14) {
  const [ax, az, bx, bz] = feature.axis;
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length, uz = (bz - az) / length;
  // The closest measured approach on each side supplies the default profile.
  const reach = Math.min(3, length / 3);
  const start = terrainHeightAt(ax - reach * ux, az - reach * uz) + 0.025;
  const end = terrainHeightAt(bx + reach * ux, bz + reach * uz) + 0.025;
  const axisSamples = kind => {
    const samples = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const height = gradeSurfaceAt(ax + (bx - ax) * t, az + (bz - az) * t, kind);
      if (Number.isFinite(height)) samples.push({ t, height: height + offset });
    }
    return samples;
  };
  const road = axisSamples('road-deck'), rail = axisSamples('rail-deck');
  const kind = road.length >= rail.length ? 'road-deck' : 'rail-deck';
  const measured = kind === 'road-deck' ? road : rail;
  // A rail-only deck can run across its tracks, so only two samples hit the rail profiles.
  // Its end probes can otherwise land in the cut below the deck.
  const hasRailDeck = !road.length && rail.length >= 2;
  const samples = measured.length >= 4 || hasRailDeck ? measured : [];
  return (x, z) => {
    const height = samples.length ? gradeSurfaceAt(x, z, kind) : undefined;
    if (Number.isFinite(height)) return height + offset;
    const t = clamp(((x - ax) * ux + (z - az) * uz) / length, 0, 1);
    if (!samples.length) return start + (end - start) * t;
    const right = samples.findIndex(sample => sample.t >= t);
    if (right === 0) return samples[0].height;
    if (right < 0) return samples[samples.length - 1].height;
    const a = samples[right - 1], b = samples[right];
    return a.height + (b.height - a.height) * (t - a.t) / (b.t - a.t);
  };
}

function splitRing(ring) {
  const points = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const parts = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
    for (let j = 0; j < parts; j++) {
      const t = j / parts;
      points.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return points;
}

async function loadBridgeMaterials() {
  const response = await fetch(new URL('../assets/ede-bridge-materials.json', import.meta.url));
  if (!response.ok) throw new Error(`IMWA bridge material request failed: ${response.status}`);
  const asset = await response.json();
  if (asset.version !== 1 || !asset.decks) throw new Error('Invalid IMWA bridge material asset');
  return asset.decks;
}

export async function buildEdeBgtWorld(scene, gradeSurfaceAt = () => undefined) {
  const [{ structures, counts, source }, bridgeMaterials] = await Promise.all([
    loadEdeBgt(),
    loadBridgeMaterials().catch(error => {
      console.warn('[bgt] using mapped path surfaces for bridge materials:', error);
      return {};
    }),
  ]);
  const group = new THREE.Group();
  group.name = 'Ede BGT structures';
  const colliders = [], platforms = [], weatherCovers = [], batches = new Map(), materials = new Map();
  const turbineUpdates = [], turbineBeacons = [];
  const bridgeStrokes = new Map();
  const mastDetails = [], mastCutoff = uniform(150), mastNight = uniform(0);
  const mastStrokes = { start: [], end: [], centre: [], bounds: new THREE.Box3() };
  const strokeEndpoint = new THREE.Vector3();
  const beaconMaterial = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
  });
  const radius = length(uv().sub(0.5)).mul(2);
  beaconMaterial.colorNode = color(0xff3425).mul(smoothstep(0, 0.48, radius).oneMinus().mul(4).add(1.4));
  beaconMaterial.opacityNode = smoothstep(0.14, 1, radius).oneMinus();
  beaconMaterial.mrtNode = transparentEffectMRT;
  const up = new THREE.Vector3(0, 1, 0);
  const smallBridges = matchSmallBridgeDecks(structures, EDE_DATA.roads, EDE_DATA.railways, bridgeMaterials);
  const bridgeFootprints = new Map();
  const deckProfiles = new Map(structures
    .filter(feature => feature.kind === 'deck' && feature.axis)
    .map(feature => {
      const bridge = smallBridges.get(feature);
      for (const id of bridge?.wayIds ?? []) {
        if (!bridgeFootprints.has(id)) bridgeFootprints.set(id, []);
        bridgeFootprints.get(id).push(bridge.contains);
      }
      const offset = bridge ? (bridge.exposedDecking ? 0.072 : 0.044) : undefined;
      return [feature.ids[0], makeDeckProfile(feature, gradeSurfaceAt, offset)];
    }));

  function materialFor(kind) {
    if (!materials.has(kind)) {
      const steel = ['steel', 'tank', 'bridgeRail', 'bridgeMetal'].includes(kind);
      materials.set(kind, new THREE.MeshStandardNodeMaterial({
        color: PALETTE[kind], roughness: steel ? 0.58 : 0.86, metalness: steel ? 0.26 : 0.03,
      }));
    }
    return materials.get(kind);
  }

  function append(kind, positions, x, z) {
    if (!positions.length) return;
    const key = `${kind}/${Math.floor(x / EDE_RENDER_CELL)}/${Math.floor(z / EDE_RENDER_CELL)}`;
    if (!batches.has(key)) batches.set(key, { kind, positions: [] });
    const output = batches.get(key).positions;
    for (const coordinate of positions) output.push(coordinate);
  }

  function collect(kind, geometry, x, z, target) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const coordinates = target ?? [];
    for (let i = 0; i < (index?.count ?? position.count); i++) {
      const j = index ? index.getX(i) : i;
      coordinates.push(position.getX(j), position.getY(j), position.getZ(j));
    }
    if (!target) append(kind, coordinates, x, z);
    geometry.dispose();
  }

  function addCollider(outer, holes, minY, maxY, kind, maxYAt, minYAt) {
    if (maxY > minY) colliders.push({ ...edeBounds(outer), minY, maxY, polygon: { outer, holes }, kind, maxYAt, minYAt });
  }

  function column(x, z, minY, maxY, radius) {
    const outer = Array.from({ length: 8 }, (_, i) => {
      const angle = -i * Math.PI / 4;
      return { x: x + radius * Math.cos(angle), z: z + radius * Math.sin(angle) };
    });
    addCollider(outer, [], minY, maxY, 'column');
  }

  function beam(kind, a, b, radius, topRadius = radius, target) {
    if (kind === 'bridgeRail' && radius <= 0.024) {
      const key = `${Math.floor((a[0] + b[0]) / (2 * EDE_RENDER_CELL))}/${Math.floor((a[2] + b[2]) / (2 * EDE_RENDER_CELL))}`;
      if (!bridgeStrokes.has(key)) bridgeStrokes.set(key, createMemberStrokes());
      addMemberStroke(bridgeStrokes.get(key), a, b, radius, PALETTE.bridgeRail);
      return;
    }
    const p = new THREE.Vector3(...a), q = new THREE.Vector3(...b);
    const direction = q.clone().sub(p), length = direction.length();
    if (length < 0.02) return;
    const midpoint = p.addScaledVector(direction, 0.5);
    const steel = kind === 'steel';
    const geometry = new THREE.CylinderGeometry(topRadius, radius, length, steel || kind === 'bridgeRail' ? 4 : 12, 1, steel);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
    geometry.translate(midpoint.x, midpoint.y, midpoint.z);
    collect(kind, geometry, midpoint.x, midpoint.z, target);
  }

  function slab(kind, rings, surface, base, { solid = true, underside = false, side = kind, undersideMaterial = kind, localHeight = false } = {}) {
    const [outer, ...holes] = rings;
    const edges = rings.map(splitRing);
    function cap(material, height, flipped) {
      const geometry = edePolygonGeometry(edges[0], edges.slice(1));
      if (flipped) {
        const index = geometry.getIndex();
        for (let i = 0; i < index.count; i += 3) {
          const j = index.getX(i);
          index.setX(i, index.getX(i + 2));
          index.setX(i + 2, j);
        }
      }
      const position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) position.setY(i, height(position.getX(i), position.getZ(i)));
      const { x, z } = outer[0];
      collect(material, geometry, x, z);
    }
    cap(kind, surface, false);
    if (underside) {
      cap(undersideMaterial, base, true);
      weatherCovers.push({ ...edeBounds(outer), outer, holes, height: base });
    }
    let minY = Infinity, maxY = -Infinity;
    for (const edge of edges) {
      for (let i = 0; i < edge.length; i++) {
        const a = edge[i], b = edge[(i + 1) % edge.length];
        const a0 = base(a.x, a.z), b0 = base(b.x, b.z);
        const a1 = surface(a.x, a.z), b1 = surface(b.x, b.z);
        const lowA = [a.x, a0, a.z], lowB = [b.x, b0, b.z];
        const highA = [a.x, a1, a.z], highB = [b.x, b1, b.z];
        append(side, [...lowA, ...lowB, ...highA, ...lowB, ...highB, ...highA], a.x, a.z);
        minY = Math.min(minY, a0);
        maxY = Math.max(maxY, a1);
      }
    }
    if (solid) addCollider(outer, holes, minY, maxY, kind,
      localHeight ? surface : undefined, localHeight ? base : undefined);
  }

  function tower(feature, rings) {
    const [x, z, long, short, angle] = feature.tower;
    const width = clamp(long, 3.5, 15), depth = clamp(short, 3.5, 12);
    const ground = terrainHeightAt(x, z);
    // BGT records foot locations. Steelwork dimensions are inferred from their span.
    const height = clamp(19 + width * 1.7, 25, 45);
    const centre = new THREE.Vector3(x, ground + height * 0.5, z);
    const positions = [];
    const lattice = (a, b, radius) => {
      beam('steel', a, b, radius, radius, positions);
      mastStrokes.start.push(...a, radius);
      mastStrokes.end.push(...b, radius);
      mastStrokes.centre.push(centre.x, centre.y, centre.z);
      mastStrokes.bounds.expandByPoint(strokeEndpoint.fromArray(a));
      mastStrokes.bounds.expandByPoint(strokeEndpoint.fromArray(b));
    };
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const point = (u, y, v) => [x + u * cs - v * sn, ground + y, z + u * sn + v * cs];
    let lower;
    for (const t of [0, 0.23, 0.46, 0.70, 0.85, 1]) {
      const taper = 1 - t * 0.82;
      const upper = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
        point(u * width * taper / 2, t * height, v * depth * taper / 2));
      if (!lower) {
        for (const p of upper) {
          p[1] = terrainHeightAt(p[0], p[2]);
          column(p[0], p[2], p[1] - 0.15, p[1] + 3, 0.28);
        }
      } else {
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          lattice(lower[i], upper[i], 0.16);
          lattice(upper[i], upper[j], 0.10);
          lattice(lower[i], upper[j], 0.08);
          lattice(lower[j], upper[i], 0.08);
        }
      }
      lower = upper;
    }
    for (const [level, factor] of [[0.72, 1.1], [0.87, 0.86], [0.97, 0.65]]) {
      const y = level * height, span = width * factor;
      lattice(point(-span, y, 0), point(span, y, 0), 0.14);
      for (const sign of [-1, 1]) {
        lattice(point(0, Math.min(y + 3, height), 0), point(sign * span, y, 0), 0.1);
        lattice(point(sign * span, y, 0), point(sign * span, y - 1.1, 0), 0.09);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materialFor('steel'));
    mesh.name = 'Ede electricity mast';
    mesh.castShadow = mesh.receiveShadow = true;
    if (mastDetails.length) mesh.userData.sharesPipelineWith = mastDetails[0].mesh;
    mastDetails.push({ mesh, centre });
    group.add(mesh);
    for (const footprint of rings) {
      slab('footing', footprint, (px, pz) => terrainHeightAt(px, pz) + 0.14,
        (px, pz) => terrainHeightAt(px, pz) - 0.18, { solid: false });
    }
  }

  function turbine(rings, x, z, hubHeight = MAANDERBROEK_HUB_HEIGHT) {
    const ground = terrainHeightAt(x, z);
    const scale = hubHeight / MAANDERBROEK_HUB_HEIGHT;
    const hubY = ground + hubHeight;
    slab('footing', rings, () => ground + 0.32, () => ground - 0.25);
    beam('turbine', [x, ground, z], [x, hubY, z], 2.35 * scale, 1.15 * scale);
    column(x, z, ground + 0.32, hubY, 2.35 * scale);

    const tower = new THREE.Group();
    tower.name = scale < 1 ? 'Small wind turbine' : 'A30 wind turbine';
    tower.position.set(x, ground, z);
    tower.scale.setScalar(scale);
    group.add(tower);
    const { cap, sails } = createWindmillRig(tower, MAANDERBROEK_HUB_HEIGHT, 3.55, 0, { turbine: true });
    cap.name = 'Wind turbine nacelle';
    sails.name = 'Wind turbine blades';
    turbineUpdates.push(cap.userData.updateWind);
    if (scale === 1) {
      const beacon = new THREE.Sprite(beaconMaterial);
      beacon.name = 'Turbine obstruction beacon';
      beacon.position.set(0, MAANDERBROEK_HUB_HEIGHT + 1.9, -2.95);
      beacon.scale.set(4.8, 4.8, 1);
      beacon.visible = false;
      cap.add(beacon);
      turbineBeacons.push(beacon);
    }
    const material = materialFor('turbine');
    const nacelle = new THREE.CylinderGeometry(1.42, 1.65, 6.6, 12)
      .rotateX(Math.PI / 2).translate(0, MAANDERBROEK_HUB_HEIGHT, 0);
    const spinner = new THREE.SphereGeometry(1.05, 10, 6).scale(1, 1, 1.25);
    const positions = [];
    for (let blade = 0; blade < 3; blade++) {
      const angle = (blade / 3 + 0.07) * Math.PI * 2;
      const sin = Math.sin(angle), cos = Math.cos(angle);
      const point = (along, across, depth) =>
        [sin * along + cos * across, cos * along - sin * across, depth];
      const sections = [[1, 1.7, 0.5], [8, 2, 0.65], [25, 1.2, 0.28], [50.5, 0.315, 0.04]];
      for (let i = 1; i < sections.length; i++) {
        const [a, aw, ad] = sections[i - 1], [b, bw, bd] = sections[i];
        for (const sign of [-1, 1]) {
          const p = point(a, -aw, 0), q = point(a, aw, 0);
          const r = point(b, -bw, 0), s = point(b, bw, 0);
          const ridgeA = point(a, 0, sign * ad), ridgeB = point(b, 0, sign * bd);
          const faces = [p, r, ridgeA, r, ridgeB, ridgeA, ridgeA, ridgeB, q, ridgeB, s, q];
          for (let j = 0; j < faces.length; j += 3) {
            positions.push(...faces[j], ...faces[j + (sign > 0 ? 2 : 1)], ...faces[j + (sign > 0 ? 1 : 2)]);
          }
        }
      }
    }
    const blades = new THREE.BufferGeometry();
    blades.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    blades.computeVertexNormals();
    for (const [geometry, parent] of [[nacelle, cap], [spinner, sails], [blades, sails]]) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }

  for (const feature of structures) {
    const { kind, layer, ids, polygons } = feature;
    if (ids.every(id => REPLACED_WALLS.has(id) || AUTHORED_PLATFORMS.has(id))) continue;
    const rings = polygons.map(polygon => polygon.map(edePoints));
    if (kind === 'pylon') {
      tower(feature, rings);
      continue;
    }
    for (const [outer, ...holes] of rings) {
      const { minX, maxX, minZ, maxZ } = edeBounds(outer);
      const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
      const ground = terrainHeightAt(x, z);
      const belowGround = (px, pz) => terrainHeightAt(px, pz) - 0.24;
      const form = [outer, ...holes];
      if (kind === 'deck') {
        const surface = deckProfiles.get(ids[0]) ?? ((px, pz) => terrainHeightAt(px, pz) + 0.025);
        const bridge = smallBridges.get(feature);
        if (bridge) {
          const { survey, material, structure } = bridge;
          const deckHeight = survey?.soffitNap && gradeSurfaceAt(...survey.position, 'road-deck');
          const observedDepth = Number.isFinite(deckHeight) ? deckHeight + SCENE_NAP_ORIGIN - survey.soffitNap : 0;
          const thickness = observedDepth >= 0.08 && observedDepth <= 0.8 ? observedDepth : undefined;
          buildSmallBridge({ rings: form, axis: feature.axis, surface, material, structure, thickness },
            { slab, beam, append, addCollider });
        } else {
          const thickness = Math.hypot(maxX - minX, maxZ - minZ) > 25 ? 0.8 : 0.36;
          slab(kind, form, surface, (px, pz) => surface(px, pz) - thickness, { solid: false, underside: true });
        }
      } else if (kind === 'platform') {
        const surface = (px, pz) => {
          const platform = gradeSurfaceAt(px, pz, layer > 0 ? 'raised-platform' : 'platform');
          if (Number.isFinite(platform)) return platform - 0.015;
          const deck = layer > 0 ? gradeSurfaceAt(px, pz, 'deck') : undefined;
          return Number.isFinite(deck) ? deck + 0.28 : terrainHeightAt(px, pz) + 0.78;
        };
        platforms.push({ id: ids[0], outer, holes, height: surface });
        if (layer > 0) {
          slab(kind, form, surface, (px, pz) => surface(px, pz) - 0.24,
            { side: 'platformEdge', underside: true, localHeight: true });
        } else {
          slab(kind, form, surface, belowGround, { solid: false, side: 'platformEdge' });
          const top = Math.min(...outer.map(p => surface(p.x, p.z))) - 0.08;
          if (top > ground + 0.1) addCollider(outer, holes, ground - 0.25, top, kind);
        }
      } else if (kind === 'abutment' || kind === 'pier' || kind === 'foundation') {
        const deck = deckProfiles.get(feature.deck);
        const surface = (px, pz) => {
          const fitted = gradeSurfaceAt(px, pz, 'deck');
          const y = kind === 'foundation' ? terrainHeightAt(px, pz) + 0.4
            : Math.max(terrainHeightAt(px, pz) + 0.3, deck ? deck(px, pz) - 0.5 : ground + 1.7);
          return Number.isFinite(fitted) ? Math.min(y, fitted - 0.3) : y;
        };
        slab('abutment', form, surface, belowGround, { localHeight: true });
      } else if (kind === 'noiseWall' || kind === 'retainingWall' || kind === 'civilWall') {
        const height = { noiseWall: 3, retainingWall: 1.45, civilWall: 1.3 }[kind];
        const wallBase = (px, pz) => {
          const adjusted = layer ? gradeSurfaceAt(px, pz, layer < 0 ? 'tunnel' : 'raised-wall') : undefined;
          return Number.isFinite(adjusted) ? adjusted : terrainHeightAt(px, pz);
        };
        if (layer < 0 && !Number.isFinite(gradeSurfaceAt(x, z, 'tunnel'))) continue;
        const top = (px, pz) => {
          const y = wallBase(px, pz) + height;
          const underDeck = layer <= 0 ? gradeSurfaceAt(px, pz, 'rail-under-road') : undefined;
          return Number.isFinite(underDeck) ? Math.min(y, underDeck) : y;
        };
        slab(kind, form, top, (px, pz) => Math.min(wallBase(px, pz) - 0.24, top(px, pz) - 0.2), { localHeight: true });
      } else if (kind === 'tank') {
        const size = Math.min(maxX - minX, maxZ - minZ);
        slab(kind, form, () => ground + clamp(size * 0.59, 3.4, 7.5), belowGround);
      } else if (kind === 'turbine') {
        turbine(form, x, z, feature.hubHeight);
      } else {
        const height = maxX - minX > 25 || maxZ - minZ > 25 ? 5.8 : 4.3;
        const open = kind === 'shed';
        slab('shed', form, () => ground + height, open ? () => ground + height - 0.28 : belowGround,
          { solid: !open, underside: open });
        if (open) {
          const posts = outer.filter((p, i) => {
            const a = outer[(i + outer.length - 1) % outer.length], b = outer[(i + 1) % outer.length];
            return Math.min(Math.hypot(p.x - a.x, p.z - a.z), Math.hypot(p.x - b.x, p.z - b.z)) > 1
              && Math.abs((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x)) > 3;
          });
          for (const p of posts.length >= 3 ? posts : outer.filter((_, i) => i % Math.ceil(outer.length / 4) === 0)) {
            const y = terrainHeightAt(p.x, p.z);
            beam('steel', [p.x, y, p.z], [p.x, ground + height, p.z], 0.16);
            column(p.x, p.z, y - 0.08, ground + height, 0.16);
          }
        }
      }
    }
  }

  const firstMeshes = new Map();
  for (const { kind, positions } of batches.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materialFor(kind));
    mesh.name = `Ede BGT ${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.shadowStandIn = true;
    if (firstMeshes.has(kind)) mesh.userData.sharesPipelineWith = firstMeshes.get(kind);
    else firstMeshes.set(kind, mesh);
    group.add(mesh);
  }
  if (bridgeStrokes.size) {
    const material = memberStrokeMaterial();
    let first;
    for (const strokes of bridgeStrokes.values()) {
      const mesh = memberStrokeMesh(strokes, material);
      mesh.name = 'Ede filtered bridge railings';
      if (first) mesh.userData.sharesPipelineWith = first;
      else first = mesh;
      group.add(mesh);
    }
  }
  if (mastDetails.length) {
    const filtered = mastStrokeMesh(mastStrokes, mastCutoff, mastNight);
    filtered.name = 'Ede filtered mast lattice';
    group.add(filtered);
  }
  group.userData = { counts, smallBridges: smallBridges.size, source: source.url, date: source.date };
  scene.add(group);
  return {
    group, colliders, counts, platforms, weatherCovers, deckProfiles, bridgeFootprints,
    updateMastLod(camera, pixelHeight) {
      // Switch when the 16 cm cross-braces project to about one pixel.
      const focal = camera.projectionMatrix.elements[5] * pixelHeight * 0.5;
      mastCutoff.value = clamp(0.16 * focal, 60, 350);
      const limit = mastCutoff.value ** 2;
      for (const { mesh, centre } of mastDetails) mesh.visible = camera.position.distanceToSquared(centre) < limit;
    },
    updateWind(dt, reading, seconds, nightFactor) {
      mastNight.value = nightFactor;
      for (const update of turbineUpdates) update(dt, reading);
      const flash = nightFactor > 0.2 && seconds % 1.6 < 0.42;
      for (const beacon of turbineBeacons) beacon.visible = flash;
    },
  };
}
