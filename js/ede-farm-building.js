// Reusable Hallehuis farm building factory.
// Applied to every building marked kind:"farm" in EDE_DATA that is not already modelled
// (Boerderij Hoekelum at w271473151 is handled by ede-restaurant-estate-survey.js).
//
// Architectural references:
//   • Pothoven / De Brand (RM 14460) – T-plan brick hallehuis, hip-thatched roof, green shutters
//   • Concordia Hallehuis (RM 527721) – arched deeldeuren, korfboog, gietijzeren stalramen, hooiluik
//   • De Driehoek (RM 14451) – elongated hallehuis, pannen dak, cream sash windows + shutters
//
// Building/barn geometry is generated procedurally from the OSM ring footprints stored in the
// survey module.  Each farm site has two entries: 'farmhouse' (voorhuis + deel) and 'barn' (schuur).
// The factory uses the kinderboerderij CivicBatch pattern and can texture-shade the brick shell
// with the shared createFacadeSurfaceTexture noise.

import { Float32BufferAttribute } from 'three/webgpu';
import { attribute, mix, texture, uv, vertexColor } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import {
  CivicBatch, along, facePanel, makeGroup, offsetEdge, polygonNormal, wallExtent,
} from './ede-civic-landmarks.js';
import { getTerrain, terrainHeightAt } from './terrain.js';
import { FARM_SURVEYS, EDE_FARM_LANDMARKS } from './ede-farm-building-survey.js';

// ─── Shared colours ──────────────────────────────────────────────────────────
const BRICK    = 0x7a5542;  // Veluwse baksteen
const TIMBER   = 0x373633;  // dark timber cladding
const GREEN    = 0x233b30;  // dark green paint (deuren, kozijnen)
const CREAM    = 0xd0c3a4;  // cream / wit geschilderd houtwerk
const GLASS    = 0x384449;  // window glass tint
const THATCH   = 0x80705b;  // rietdek
const TILE     = 0x4e4b49;  // dakpan antraciet

let brickTexture;

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Compute the signed area of a 2D ring [[x,z], …] in the XZ plane. */
function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

/** Compute the centroid [cx, cz] of a 2D ring. */
function ringCentroid(ring) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  return [cx / ring.length, cz / ring.length];
}

/** Make the ring wind counter-clockwise (positive area) in X/Z. */
function ensureCCW(ring) {
  return ringArea(ring) < 0 ? [...ring].reverse() : ring;
}

/**
 * Build a 3D shell for a single polygon building from its 2D outline ring.
 * Walls are vertical quads from `ground` to `ground + wallTop`.
 * Roof is a flat quad cap (the ridge peak is added later as a simple tent).
 * Returns { wallFaces, roofFace } – arrays of [x,y,z] triplets.
 */
function outlineToShell(outline, ground, wallTop) {
  const ring2d = ensureCCW(outline.map(([x, z]) => [x, z]));
  const low = ground, high = ground + wallTop;
  const wallFaces = [];
  for (let i = 0; i < ring2d.length; i++) {
    const [ax, az] = ring2d[i];
    const [bx, bz] = ring2d[(i + 1) % ring2d.length];
    // Outward-facing quad (normal points away from interior)
    wallFaces.push([
      [ax, low, az],
      [bx, low, bz],
      [bx, high, bz],
      [ax, high, az],
    ]);
  }
  // Flat roof cap (wound as a CCW polygon viewed from above)
  const roofFace = ring2d.map(([x, z]) => [x, high, z]);
  return { wallFaces, roofFace };
}

/**
 * Build a simple tent/gable ridge over the flat roof cap.
 * `ridgeHeight` is the peak above `ground`.  We compute the polygon centroid
 * as the ridge mid-point and connect each roof edge to it.
 */
function tentRoof(ring2d, ground, ridgeHeight) {
  const high = ground + (ridgeHeight * 0.75);  // eave height
  const peak = ground + ridgeHeight;
  const [cx, cz] = ringCentroid(ring2d);
  const tris = [];
  for (let i = 0; i < ring2d.length; i++) {
    const [ax, az] = ring2d[i];
    const [bx, bz] = ring2d[(i + 1) % ring2d.length];
    tris.push([[ax, high, az], [bx, high, bz], [cx, peak, cz]]);
  }
  return tris;
}

// ─── Wall detail helpers ─────────────────────────────────────────────────────

/** Add a surveyed window (sash + shutters) on a wall face given the wall's a/b endpoints. */
function farmWindow(batch, a, b, normal, ground, eave, centerU, width) {
  const bottom = ground + 0.60, top = bottom + 1.10;
  if (eave - bottom < 0.6 || eave < top) return;
  // frame + glazing
  facePanel(batch, a, b, normal, (centerU - width / 2 - 0.07) / wallWidth(a, b), (centerU + width / 2 + 0.07) / wallWidth(a, b), bottom - 0.05, top + 0.06, CREAM, 0.040);
  facePanel(batch, a, b, normal, (centerU - width / 2) / wallWidth(a, b), (centerU + width / 2) / wallWidth(a, b), bottom, top, GLASS, 0.055, 0.78);
  // central muntin
  facePanel(batch, a, b, normal, (centerU - 0.025) / wallWidth(a, b), (centerU + 0.025) / wallWidth(a, b), bottom, top, CREAM, 0.063);
  // sill
  facePanel(batch, a, b, normal, (centerU - width / 2 - 0.08) / wallWidth(a, b), (centerU + width / 2 + 0.08) / wallWidth(a, b), bottom - 0.08, bottom, 0x908070, 0.075);
  // shutters (green)
  for (const side of [-1, 1]) {
    const su = centerU + side * (width * 0.75 + 0.08);
    facePanel(batch, a, b, normal, (su - width * 0.22) / wallWidth(a, b), (su + width * 0.22) / wallWidth(a, b), bottom, top, GREEN, 0.072);
  }
}

function wallWidth(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Add a segmented-arch hallehuis cart entrance (deeldeuren) on the main barn face. */
function farmArchedDoor(batch, a, b, normal, ground, eave, centerU, doorWidth, doorHeight) {
  if (eave < ground + doorHeight + 0.4) return;
  const halfW = doorWidth / 2;
  const archSpring = ground + doorHeight - 0.32;
  const archRadius = halfW;
  // door surround (cream/stone)
  facePanel(batch, a, b, normal, (centerU - halfW - 0.14) / wallWidth(a, b), (centerU + halfW + 0.14) / wallWidth(a, b),
    ground, ground + doorHeight + 0.18, CREAM, 0.035);
  // door leaves (green panels)
  facePanel(batch, a, b, normal, (centerU - halfW) / wallWidth(a, b), (centerU) / wallWidth(a, b),
    ground, ground + doorHeight - 0.32, GREEN, 0.052);
  facePanel(batch, a, b, normal, (centerU) / wallWidth(a, b), (centerU + halfW) / wallWidth(a, b),
    ground, ground + doorHeight - 0.32, GREEN, 0.052);
  // arch glass (hayloft hatch / hooiluik) in the tympanum
  facePanel(batch, a, b, normal, (centerU - halfW * 0.6) / wallWidth(a, b), (centerU + halfW * 0.6) / wallWidth(a, b),
    archSpring, archSpring + archRadius * 0.9, GLASS, 0.058, 0.68);
  // door split (vertical muntin)
  facePanel(batch, a, b, normal, (centerU - 0.03) / wallWidth(a, b), (centerU + 0.03) / wallWidth(a, b),
    ground, ground + doorHeight - 0.32, 0x172923, 0.063);
}

/** Add a stable window row (gietijzeren stalramen) along a long barn wall. */
function farmStableWindows(batch, a, b, normal, ground, eave, wallW) {
  if (wallW < 3.5) return;
  const count = Math.max(1, Math.round(wallW / 3.4));
  const winW = Math.min(1.1, wallW * 0.26);
  const bottom = ground + 0.55, top = bottom + 0.72;
  if (eave < top + 0.2) return;
  for (let i = 0; i < count; i++) {
    const cu = wallW * (i + 0.5) / count;
    // Cast-iron arched window: dark frame + small glass
    facePanel(batch, a, b, normal, (cu - winW / 2) / wallW, (cu + winW / 2) / wallW, bottom, top, 0x2d2d2b, 0.040);
    facePanel(batch, a, b, normal, (cu - winW / 2 + 0.07) / wallW, (cu + winW / 2 - 0.07) / wallW,
      bottom + 0.05, top - 0.05, GLASS, 0.052, 0.55);
  }
}

// ─── Main farm building factory ──────────────────────────────────────────────

function buildFarm(name, buildings) {
  const shell = new CivicBatch();
  const details = new CivicBatch();
  const colliders = [];
  const masonry = [];

  for (const { kind, outline, ground, wallColor, roofColor, wallTop, ridgeHeight } of buildings) {
    const ring2d = ensureCCW(outline[0]);
    const foundation = (x, z) => getTerrain()
      ? Math.min(ground, terrainHeightAt(x, z) - 0.16)
      : ground;
    const eave = ground + wallTop;

    // ── Walls ──
    const { wallFaces, roofFace } = outlineToShell(outline[0], ground, wallTop);
    for (const face of wallFaces) {
      // Adjust bottom vertices to terrain
      const adjusted = face.map(([x, y, z]) => [x, y <= ground + 0.01 ? foundation(x, z) : y, z]);
      const first = shell.vertices.length / 3;
      shell.polygon([adjusted], wallColor);
      if (wallColor !== TIMBER) {
        for (let i = first; i < shell.vertices.length / 3; i++) masonry[i] = 1;
      }

      // ── Wall details ──
      const pts3d = adjusted;
      // Build a-b vectors for facePanel
      const ax = pts3d[0][0], az = pts3d[0][2];
      const bx = pts3d[1][0], bz = pts3d[1][2];
      const a = { x: ax, z: az }, b = { x: bx, z: bz };
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      const normal = { x: -dz / len, y: 0, z: dx / len };
      const wallW = len;

      if (wallW < 1.0 || Math.abs(normal.y) > 0.1) continue;

      if (kind === 'farmhouse') {
        // Windows on faces wider than 3 m
        if (wallW >= 3.5) {
          const wCount = Math.max(1, Math.round((wallW - 1.6) / 2.1));
          for (let wi = 0; wi < wCount; wi++) {
            const cu = wallW * (wi + 0.5) / wCount;
            farmWindow(details, a, b, normal, ground, eave, cu, 0.72);
          }
        }
        // Entrance door on a prominent face
        if (wallW >= 2.8 && wallW <= 7) {
          farmArchedDoor(details, a, b, normal, ground, eave, wallW / 2, Math.min(wallW * 0.42, 1.52), 2.68);
        }
      } else {
        // barn: stable windows + arched cart door
        farmStableWindows(details, a, b, normal, ground, eave, wallW);
        if (wallW >= 2.8 && wallW <= 10) {
          farmArchedDoor(details, a, b, normal, ground, eave, wallW / 2, Math.min(wallW * 0.55, 2.3), 2.98);
        }
      }
    }

    // ── Roof cap ──
    const isFarmhouse = kind === 'farmhouse';
    const capColor = isFarmhouse ? (roofColor ?? THATCH) : (roofColor ?? TILE);
    shell.polygon([roofFace.map(([x, y, z]) => [x, y, z])], capColor);

    // ── Tent roof triangles ──
    for (const tri of tentRoof(ring2d, ground, ridgeHeight)) {
      const first = shell.vertices.length / 3;
      shell.polygon([tri], capColor);
    }

    // ── Collider ──
    const outer = ring2d.map(([x, z]) => ({ x, z }));
    colliders.push({
      minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
      minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
      minY: Math.min(...outer.map(({ x, z }) => foundation(x, z))),
      maxY: ground + ridgeHeight,
      polygon: { outer, holes: [] },
    });
  }

  // ── Assemble group ──
  const group = makeGroup(name, shell, colliders);
  const mesh = group.children[0];
  const { position, normal } = mesh.geometry.attributes;

  // UV for brick noise texture
  const coordinates = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    coordinates[i * 2]     = (position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 0.99;
    coordinates[i * 2 + 1] = position.getY(i) / 0.64;
  }
  mesh.geometry.setAttribute('uv', new Float32BufferAttribute(coordinates, 2));
  mesh.geometry.setAttribute('farmMasonry', new Float32BufferAttribute(
    Float32Array.from({ length: position.count }, (_, i) => masonry[i] ?? 0), 1));

  brickTexture ??= createFacadeSurfaceTexture().texture;
  mesh.material.colorNode = vertexColor().mul(mix(1,
    texture(brickTexture, uv()).r.mul(0.86).add(0.29),
    attribute('farmMasonry', 'float')));

  if (details.vertices.length) {
    const detail = details.mesh();
    detail.userData.nearDetail = true;
    group.add(detail);
  }

  return group;
}

// ─── Exported factories ───────────────────────────────────────────────────────

function farmFactory(siteId) {
  return (_, site) => buildFarm(site.name, FARM_SURVEYS[siteId]);
}

export const EDE_FARM_LANDMARK_FACTORIES = Object.fromEntries(
  EDE_FARM_LANDMARKS.map(site => [site.id, farmFactory(site.id)]),
);
