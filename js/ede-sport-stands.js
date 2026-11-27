import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup, polygonNormal, wallColliders } from './ede-civic-landmarks.js';
import { edeBounds } from './ede-geometry.js';
import { terrainHeightAt } from './terrain.js';

const CONCRETE = 0x95928a;
const BACK_WALL = 0x9f6c55;
const pointXZ = ([x, , z]) => ({ x, z });

export function standWeatherCover(corners) {
  const outer = corners.map(pointXZ);
  const [a, b, , d] = corners;
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const depth = dx * (d[2] - a[2]) - dz * (d[0] - a[0]);
  const rise = d[1] - a[1];
  return {
    ...edeBounds(outer), outer, holes: [],
    height: (x, z) => a[1] - 0.12 + rise * (dx * (z - a[2]) - dz * (x - a[0])) / depth,
  };
}

function facingUp(batch, corners, color) {
  batch.polygon([polygonNormal(corners).y > 0 ? corners : [...corners].reverse()], color);
}

export function createSportStand(_footprints, site) {
  const { front: [a, b], depth, floor, frontRoof, rearRoof, rows, frame, roof, seats, booth, bays, annex } = site.stand;
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / width, uz = (b[1] - a[1]) / width;
  const base = terrainHeightAt(site.x, site.z);
  const point = (u, h, d) => [a[0] + ux * u - uz * d, base + h, a[1] + uz * u + ux * d];
  const rotation = Math.atan2(-uz, ux);
  const shell = new CivicBatch(), chairs = new CivicBatch();
  const colliders = [], platforms = [];

  function box(batch, u, h, d, span, height, thickness, color) {
    batch.solid(new THREE.BoxGeometry(span, height, thickness).rotateY(rotation).translate(...point(u, h, d)), color);
  }

  const roofCorners = [point(0, frontRoof, 0), point(width, frontRoof, 0),
    point(width, rearRoof, depth), point(0, rearRoof, depth)];
  facingUp(shell, roofCorners, roof);
  const underside = roofCorners.map(([x, y, z]) => [x, y - 0.12, z]);
  shell.polygon([polygonNormal(underside).y < 0 ? underside : underside.reverse()], frame);
  box(shell, width / 2, frontRoof - 0.14, 0.03, width, 0.28, 0.12, frame);

  const addDeck = (id, start, end, near, far, height, color = CONCRETE) => {
    box(shell, (start + end) / 2, (height - 0.28) / 2, (near + far) / 2,
      end - start, height + 0.28, far - near, color);
    const outer = [point(start, height, near), point(end, height, near),
      point(end, height, far), point(start, height, far)].map(pointXZ);
    platforms.push({ id: `${site.id}-${id}`, outer, holes: [], height: () => base + height });
  };

  for (let i = 0; i <= bays; i++) {
    const u = 0.12 + (width - 0.24) * i / bays;
    box(shell, u, (frontRoof - 0.12) / 2, 0.16, 0.12, frontRoof - 0.12, 0.12, frame);
  }

  box(shell, width / 2, rearRoof / 2, depth - 0.09, width, rearRoof, 0.18, BACK_WALL);
  if (booth === 'end') {
    const span = width / bays;
    const low = floor + (rows.length - 1) * 0.27;
    for (let i = 0; i < bays; i++) {
      box(shell, span * (i + 0.5), (rearRoof + low) / 2, depth - 0.21, span - 0.035,
        rearRoof - low, 0.075, seats[i % seats.length]);
    }
  }
  colliders.push(...wallColliders(pointXZ(point(0, 0, depth - 0.09)), pointXZ(point(width, 0, depth - 0.09)),
    base - 0.2, base + rearRoof, 0.18));
  const span = width - 2.6;
  addDeck('front-aisle', 0.10, width - 0.10, 0.12, 0.80, floor, BACK_WALL);
  box(shell, width / 2, floor + 0.49, 0.15, span, 0.055, 0.065, frame);
  for (let i = 0; i <= bays; i++) {
    box(shell, 1.3 + span * i / bays, floor + 0.24, 0.15, 0.055, 0.50, 0.055, frame);
  }
  colliders.push(...wallColliders(pointXZ(point(1.3, 0, 0.15)), pointXZ(point(width - 1.3, 0, 0.15)),
    base - 0.1, base + floor + 0.5, 0.11));
  const steps = Math.ceil(floor / 0.19);
  for (let i = 0; i < steps; i++) {
    const offset = (steps - i) * 0.30;
    const height = floor * (i + 1) / steps;
    addDeck(`north-stair-${i}`, 0.10 - offset, 0.40 - offset, 0.12, 1.10, height);
    addDeck(`south-stair-${i}`, width - 0.40 + offset, width - 0.10 + offset, 0.12, 1.10, height);
  }

  const tread = (depth - 1.04) / rows.length;
  const aisle = booth === 'center' ? 2.1 : 0.92;
  const block = (width - aisle) / 2;
  let seatCount = 0;
  for (const [row, sections] of rows.entries()) {
    const d = 0.80 + row * tread;
    const h = floor + row * 0.27;
    addDeck(`row-${row + 1}`, 0.10, width - 0.10, d, d + tread, h);

    for (const [section, count] of sections.entries()) {
      const endMargin = section === 0 && booth === 'end' && row >= rows.length - 2 ? 2.2 : 0.90;
      const spacing = Math.min(0.56, (block - endMargin) / count);
      const start = section === 0 ? block - count * spacing : block + aisle;
      seatCount += count;
      for (let i = 0; i < count; i++) {
        const center = start + spacing * (i + 0.5);
        const color = seats[(row + section + i) % seats.length];
        const seatWidth = Math.min(0.42, spacing - 0.045);
        const seatDepth = d + tread * 0.69;
        box(chairs, center, h + 0.37, seatDepth - 0.09, seatWidth, 0.07, 0.33, color);
        box(chairs, center, h + 0.48, seatDepth + 0.065, seatWidth, 0.28, 0.07, color);
        box(chairs, center, h + 0.18, seatDepth, 0.075, 0.35, 0.075, frame);
      }
    }
  }

  if (booth === 'center') {
    const u = width / 2, d = depth - 0.46;
    box(shell, u, 2.2, d, 1.85, 3.5, 0.70, frame);
    box(shell, u, 3.19, d - 0.36, 1.65, 0.88, 0.02, 0x526468);
    box(shell, u, 2.08, d - 0.36, 0.66, 1.18, 0.02, seats[0]);
  } else {
    const u = 1.13, d = depth - 0.70;
    box(shell, u, 3.1, d, 1.86, 2.28, 1.18, seats[0]);
    box(shell, u, 3.60, d - 0.60, 1.68, 0.87, 0.02, 0x56676b);
    box(shell, u, 2.49, d - 0.60, 1.68, 0.80, 0.02, seats[1]);
  }

  if (annex) {
    const outer = annex.outline.map(([x, z]) => ({ x, z }));
    const y = base + annex.height;
    facingUp(shell, annex.outline.map(([x, z]) => [x, y, z]), roof);
    for (const [i, { x, z }] of outer.entries()) {
      const b = outer[(i + 1) % outer.length];
      const corners = [[x, base - 0.28, z], [b.x, base - 0.28, b.z], [b.x, y, b.z], [x, y, z]];
      shell.quad(...corners, BACK_WALL);
      shell.quad(...[...corners].reverse(), BACK_WALL);
    }
    colliders.push({ ...edeBounds(outer), minY: base - 0.28, maxY: y, polygon: { outer, holes: [] } });
  }

  const model = makeGroup(site.name, shell, colliders);
  const detail = chairs.mesh();
  detail.name = 'Grandstand seats';
  detail.userData.nearDetail = true;
  detail.castShadow = false;
  model.add(detail);
  model.userData.platforms = platforms;
  model.userData.weatherCovers = [standWeatherCover(roofCorners)];
  model.userData.seatCount = seatCount;
  return model;
}
