import * as THREE from 'three/webgpu';
import { edeBounds, edePoints, edePolygonGeometry, EDE_RENDER_CELL } from './ede-geometry.js';
import { terrainHeightAt } from './terrain.js';

const PALETTE = {
  deck: 0x989797, abutment: 0x98938a, platform: 0xb3aea3, platformEdge: 0xe0ddd0,
  noiseWall: 0x69776b, civilWall: 0x9a9489, retainingWall: 0x817f78,
  tank: 0xb7b9b6, shed: 0x777f81, footing: 0x85847c, steel: 0x797f80, turbine: 0xe1e2de,
};

// The fitted Hall of Fame backing model includes these two retaining approaches.
const REPLACED_WALLS = new Set([
  'L0002.80e3a26ba49b4f55bcb97658316d4005', 'L0002.f11210899e044752ab4109bbccedc279',
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export async function loadEdeBgt() {
  const response = await fetch(new URL('../assets/ede-bgt.json', import.meta.url));
  if (!response.ok) throw new Error(`BGT structure request failed: ${response.status}`);
  const asset = await response.json();
  if (asset.version !== 1 || !Array.isArray(asset.structures)) throw new Error('Invalid Ede BGT structure asset');
  return asset;
}

function makeDeckProfile(feature, gradeSurfaceAt) {
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
      if (Number.isFinite(height)) samples.push({ t, height: height - 0.14 });
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
    if (Number.isFinite(height)) return height - 0.14;
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

export async function buildEdeBgtWorld(scene, gradeSurfaceAt = () => undefined) {
  const { structures, counts, source } = await loadEdeBgt();
  const group = new THREE.Group();
  group.name = 'Ede BGT structures';
  const colliders = [], platforms = [], weatherCovers = [], batches = new Map(), materials = new Map();
  const up = new THREE.Vector3(0, 1, 0);
  const deckProfiles = new Map(structures
    .filter(feature => feature.kind === 'deck' && feature.axis)
    .map(feature => [feature.ids[0], makeDeckProfile(feature, gradeSurfaceAt)]));

  function append(kind, positions, x, z) {
    if (!positions.length) return;
    const key = `${kind}/${Math.floor(x / EDE_RENDER_CELL)}/${Math.floor(z / EDE_RENDER_CELL)}`;
    if (!batches.has(key)) batches.set(key, { kind, positions: [] });
    const output = batches.get(key).positions;
    for (const coordinate of positions) output.push(coordinate);
  }

  function collect(kind, geometry, x, z) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const coordinates = [];
    for (let i = 0; i < (index?.count ?? position.count); i++) {
      const j = index ? index.getX(i) : i;
      coordinates.push(position.getX(j), position.getY(j), position.getZ(j));
    }
    append(kind, coordinates, x, z);
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

  function beam(kind, a, b, radius, topRadius = radius) {
    const p = new THREE.Vector3(...a), q = new THREE.Vector3(...b);
    const direction = q.clone().sub(p), length = direction.length();
    if (length < 0.02) return;
    const midpoint = p.addScaledVector(direction, 0.5);
    const steel = kind === 'steel';
    const geometry = new THREE.CylinderGeometry(topRadius, radius, length, steel ? 4 : 12, 1, steel);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
    geometry.translate(midpoint.x, midpoint.y, midpoint.z);
    collect(kind, geometry, midpoint.x, midpoint.z);
  }

  function slab(kind, rings, surface, base, { solid = true, underside = false, side = kind, localHeight = false } = {}) {
    const [outer, ...holes] = rings;
    const edges = rings.map(splitRing);
    function cap(height, flipped) {
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
      collect(kind, geometry, x, z);
    }
    cap(surface, false);
    if (underside) {
      cap(base, true);
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
          beam('steel', lower[i], upper[i], 0.16);
          beam('steel', upper[i], upper[j], 0.10);
          beam('steel', lower[i], upper[j], 0.08);
          beam('steel', lower[j], upper[i], 0.08);
        }
      }
      lower = upper;
    }
    for (const [level, factor] of [[0.72, 1.1], [0.87, 0.86], [0.97, 0.65]]) {
      const y = level * height, span = width * factor;
      beam('steel', point(-span, y, 0), point(span, y, 0), 0.14);
      for (const sign of [-1, 1]) {
        beam('steel', point(0, Math.min(y + 3, height), 0), point(sign * span, y, 0), 0.1);
        beam('steel', point(sign * span, y, 0), point(sign * span, y - 1.1, 0), 0.09);
      }
    }
    for (const footprint of rings) {
      slab('footing', footprint, (px, pz) => terrainHeightAt(px, pz) + 0.14,
        (px, pz) => terrainHeightAt(px, pz) - 0.18, { solid: false });
    }
  }

  function turbine(rings, x, z) {
    const ground = terrainHeightAt(x, z);
    const hubY = ground + 99.5;
    slab('footing', rings, () => ground + 0.32, () => ground - 0.25);
    beam('turbine', [x, ground, z], [x, hubY, z], 2.35, 1.15);
    beam('turbine', [x, hubY, z - 3.3], [x, hubY, z + 3.3], 1.65, 1.42);
    column(x, z, ground + 0.32, hubY, 2.35);
    const rotorZ = z + 3.1;
    for (let blade = 0; blade < 3; blade++) {
      const angle = (blade / 3 + 0.07) * Math.PI * 2;
      const sin = Math.sin(angle), cos = Math.cos(angle);
      const point = (along, across, depth) =>
        [x + sin * along + cos * across, hubY + cos * along - sin * across, rotorZ + depth];
      const sections = [[1, 0.65, 0.4], [8, 2, 0.65], [25, 1.2, 0.28], [50.5, 0.04, 0.04]];
      const positions = [];
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
      append('turbine', positions, x, z);
    }
  }

  for (const feature of structures) {
    const { kind, layer, ids, polygons } = feature;
    if (ids.every(id => REPLACED_WALLS.has(id))) continue;
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
        const thickness = Math.hypot(maxX - minX, maxZ - minZ) > 25 ? 0.8 : 0.36;
        slab(kind, form, surface, (px, pz) => surface(px, pz) - thickness, { solid: false, underside: true });
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
        turbine(form, x, z);
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
    if (!materials.has(kind)) {
      const steel = kind === 'steel' || kind === 'tank';
      materials.set(kind, new THREE.MeshStandardNodeMaterial({
        color: PALETTE[kind], roughness: steel ? 0.58 : 0.86, metalness: steel ? 0.26 : 0.03,
      }));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials.get(kind));
    mesh.name = `Ede BGT ${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.shadowStandIn = true;
    if (firstMeshes.has(kind)) mesh.userData.sharesPipelineWith = firstMeshes.get(kind);
    else firstMeshes.set(kind, mesh);
    group.add(mesh);
  }
  group.userData = { counts, source: source.url, date: source.date };
  scene.add(group);
  return { group, colliders, counts, platforms, weatherCovers, deckProfiles };
}
