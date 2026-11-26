import * as THREE from 'three/webgpu';
import { attribute, color, mix, smoothstep } from 'three/tsl';
import { polygonContains } from './building-collision.js';
import { CivicBatch } from './ede-civic-landmarks.js';
import { EDE_FUEL_SITES } from './ede-fuel-sites.js';
import { BUNDLED_FUEL_BASELINE, estimateFuelPrice, watchFuelBaseline } from './ede-fuel-prices.js';
import { terrainHeightAt } from './terrain.js';
import { cityUniforms } from './tsl-materials.js';

// Approximate brand colours and readable wordmarks shared by all locations.
const LIVERIES = {
  shell: ['#ffd82f', '#d72423', '#3f2425'],
  tango: ['#f5f7fa', '#245498', '#b32333'],
  bp: ['#087c48', '#b8d232', '#ffffff'],
  tinq: ['#24458b', '#f4f7fa', '#ffffff'],
  ok: ['#f27723', '#15234f', '#151c33'],
  totalenergies: ['#f8f5f1', '#e32442', '#ad1d3a'],
  esso: ['#f8f6ef', '#174889', '#cc2637'],
  avia: ['#ce2536', '#faf6ed', '#fffefb'],
  texaco: ['#2a2d2e', '#c12028', '#ffffff'],
  greenpoint: ['#f3f3e7', '#77a83c', '#366423'],
  supertank: ['#19458a', '#fccd2a', '#ffffff'],
  sakko: ['#d02e33', '#f7eee7', '#ffffff'],
  express: ['#f4f3ef', '#f05b33', '#c92f2a'],
  tamoil: ['#164982', '#da302e', '#ffffff'],
  gulf: ['#f48335', '#203c67', '#192848'],
  argos: ['#086dac', '#b5cd31', '#ffffff'],
  q8: ['#174080', '#efb238', '#ffffff'],
  'firezone': ['#f18c2b', '#202221', '#191a19'],
  'vissers energy group': ['#286d42', '#fdd838', '#ffffff'],
  'flower power': ['#83286a', '#f68131', '#ffffff'],
};
const DEFAULT_LIVERY = ['#3f6069', '#f4d173', '#ffffff'];
const CONCRETE = '#a19f94', ROOF = '#5f6366', WALL = '#e3dfd5', DARK = '#282d31';
const GLASS = '#39535c', METAL = '#bfc3c2', LAMP = '#e9ede0', STEEL = '#5b6465';

function stationStyle(site) {
  const label = site.wordmark ?? site.brand ?? site.name ?? 'Tankstation';
  const [primary, accent, text] = site.palette ?? LIVERIES[site.brand?.toLowerCase()] ?? DEFAULT_LIVERY;
  return { label, primary, accent, text };
}

function signAtlas(styles) {
  if (typeof document === 'undefined' || !styles.length) return null;
  const cells = [...new Map(styles.map(style => [JSON.stringify(style), style])).entries()];
  const columns = 4, cellWidth = 256, cellHeight = 64;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellWidth;
  canvas.height = Math.ceil(cells.length / columns) * cellHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rects = new Map();
  for (const [i, [key, { label, primary, text }]] of cells.entries()) {
    const x = (i % columns) * cellWidth, y = Math.floor(i / columns) * cellHeight;
    ctx.fillStyle = primary;
    ctx.fillRect(x, y, cellWidth, cellHeight);
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText(label, x + cellWidth / 2, y + cellHeight / 2, cellWidth - 22);
    rects.set(key, [(x + 2) / canvas.width, (x + cellWidth - 2) / canvas.width,
      1 - (y + cellHeight - 2) / canvas.height, 1 - (y + 2) / canvas.height]);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75 });
  return { material, rects };
}

function signMesh(labels, atlas, style) {
  if (!atlas || !labels.length) return null;
  const position = [], uv = [];
  for (const sign of labels) {
    const [a, b, c, d] = sign.corners ?? sign;
    const [u, v, bottom, top] = atlas.rects.get(JSON.stringify(sign.style ?? style));
    position.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(u, bottom, v, bottom, v, top, u, bottom, v, top, u, top);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, atlas.material);
}

const FUEL_LABELS = { e10: 'E10', diesel: 'B7', lpg: 'LPG', cng: 'CNG' };
const FUEL_PRICE_FORMAT = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function priceAtlas(sites, live) {
  if (typeof document === 'undefined' || !sites.length) return null;
  const columns = 5, width = 200, height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = columns * width;
  canvas.height = Math.ceil(sites.length / columns) * height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const rects = new Map();

  function draw(baseline) {
    for (const [i, site] of sites.entries()) {
      const x = i % columns * width, y = Math.floor(i / columns) * height;
      const fuels = site.fuels ?? ['e10', 'diesel'];
      ctx.fillStyle = '#171c22';
      ctx.fillRect(x, y, width, height);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillStyle = '#e7e9eb';
      ctx.fillText(fuels.includes('cng') ? '€/kg' : '€/L', x + width / 2, y + 24);
      const rowHeight = 196 / fuels.length;
      for (const [j, fuel] of fuels.entries()) {
        const row = y + 46 + j * rowHeight;
        const price = estimateFuelPrice(baseline, site.priceProfile, fuel);
        ctx.fillStyle = '#34404a';
        ctx.fillRect(x + 10, row, width - 20, 2);
        ctx.textAlign = 'left';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillStyle = '#f3f2ee';
        ctx.fillText(FUEL_LABELS[fuel], x + 12, row + rowHeight / 2);
        ctx.textAlign = 'right';
        ctx.font = 'bold 46px monospace';
        ctx.fillStyle = '#ff7354';
        // Normalize the source's mill precision before rounding half cents for display.
        const display = price === null ? '—' : FUEL_PRICE_FORMAT.format(Math.round(price * 1000) / 1000);
        ctx.fillText(display, x + width - 12, row + rowHeight / 2);
      }
    }
    texture.needsUpdate = true;
  }

  for (const [i, { id }] of sites.entries()) {
    const x = i % columns * width, y = Math.floor(i / columns) * height;
    rects.set(JSON.stringify(id), [(x + 2) / canvas.width, (x + width - 2) / canvas.width,
      1 - (y + height - 2) / canvas.height, 1 - (y + 2) / canvas.height]);
  }
  draw(BUNDLED_FUEL_BASELINE);
  if (live) watchFuelBaseline(draw);
  return { material, rects };
}

function frame({ x, z, heading = 0 }) {
  const cs = Math.cos(heading), sn = Math.sin(heading);
  return {
    point(px, y, pz) { return [x + px * cs + pz * sn, y, z - px * sn + pz * cs]; },
    box(batch, px, bottom, pz, w, h, d, color) {
      batch.solid(new THREE.BoxGeometry(w, h, d).rotateY(heading)
        .translate(x + px * cs + pz * sn, bottom + h / 2, z - px * sn + pz * cs), color);
    },
    bottom(px, pz) {
      return terrainHeightAt(x + px * cs + pz * sn, z - px * sn + pz * cs);
    },
    collider(px, pz, w, d, minY, maxY, kind) {
      const cx = x + px * cs + pz * sn, cz = z - px * sn + pz * cs;
      const hx = w / 2, hz = d / 2;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
        minY, maxY, kind, obb: { cx, cz, hx, hz, cs, sn } };
    },
  };
}

function labelFaces(labels, point, w, d, bottom, height, x = 0, z = 0) {
  for (const side of [-1, 1]) {
    const left = x - side * w / 2, right = x + side * w / 2, face = z + side * (d / 2 + 0.012);
    labels.push([point(left, bottom, face), point(right, bottom, face),
      point(right, bottom + height, face), point(left, bottom + height, face)]);
  }
}

function shopExterior(site, style, shopStyle, shell, detail, illuminated, labels, colliders, lights) {
  const { width: w, length: d, height = 3.7 } = site;
  const { box, collider, bottom, point } = frame(site);
  const y = bottom(0, 0), front = d / 2;
  const skirt = Math.min(y, ...[-1, 1].flatMap(side =>
    [bottom(side * w / 2, -d / 2), bottom(side * w / 2, front)])) - 0.12;
  box(shell, 0, skirt, 0, w, y + height - skirt, d, WALL);
  box(shell, 0, y + height - 0.28, 0, w + 0.18, 0.31, d + 0.18, ROOF);
  box(shell, 0, y + height - 0.83, front, w, 0.47, 0.12, style.primary);
  box(shell, 0, y + height - 0.91, front, w, 0.08, 0.14, style.accent);
  const glassHeight = Math.min(2.38, height - 1.08);
  const count = Math.max(3, Math.round(w / 2.4));
  const span = (w - 0.6) / count;
  for (let i = 0; i < count; i++) {
    const px = (i - (count - 1) / 2) * span;
    const entrance = i === Math.floor(count / 2);
    const lo = y + (entrance ? 0.02 : 0.27);
    box(shell, px, lo, front + 0.024, span - 0.09, glassHeight, 0.059, DARK);
    const loGlass = lo + 0.06, face = front + 0.056;
    illuminated.quad(point(px - span / 2 + 0.10, loGlass, face), point(px + span / 2 - 0.10, loGlass, face),
      point(px + span / 2 - 0.10, loGlass + glassHeight - 0.12, face),
      point(px - span / 2 + 0.10, loGlass + glassHeight - 0.12, face), GLASS, 1);
    box(detail, px, loGlass, front + 0.052, 0.045, glassHeight - 0.12, 0.03, METAL);
    box(detail, px, lo + glassHeight * 0.79, front + 0.052, span - 0.15, 0.04, 0.034, METAL);
    if (entrance) box(detail, px + 0.15, lo + 0.92, front + 0.09, 0.21, 0.045, 0.067, METAL);
  }
  const signWidth = Math.min(w - 0.4, 2.7);
  labels.push({ style: shopStyle, corners: [point(-signWidth / 2, y + height - 0.8, front + 0.069),
    point(signWidth / 2, y + height - 0.8, front + 0.069),
    point(signWidth / 2, y + height - 0.39, front + 0.069),
    point(-signWidth / 2, y + height - 0.39, front + 0.069)] });
  const [x, ly, z] = point(0, y + height - 0.96, front + 0.22);
  const [tx, , tz] = point(0, y, front + 1.5);
  box(illuminated, 0, ly, front + 0.16, 0.86, 0.055, 0.18, LAMP);
  lights.push({ x, y: ly - 0.06, z, tx, tz, color: 0xffe0ae, dist: 8, intensity: 34 });
  colliders.push(collider(0, 0, w, d, skirt, y + height, 'fuel-shop'));
}

function drawStation(site, style, shopStyle, atlas, priceDisplay) {
  const structure = new CivicBatch(), detail = new CivicBatch(), illuminated = new CivicBatch();
  const { box, point, bottom, collider } = frame(site);
  const labels = [], priceFaces = [], colliders = [], weatherCovers = [], lights = [];
  const { width: w, length: d } = site;
  const alongX = site.pumpAxis ? site.pumpAxis === 'x' : w >= d;
  const main = alongX ? w : d, across = alongX ? d : w;
  const roof = site.canopy !== false;
  const bays = site.bays ?? Math.max(1, Math.min(6, Math.round(main / 6)));
  const rows = site.pumpRows ?? 1;
  const positions = site.pumps ?? Array.from({ length: bays * rows }, (_, i) => {
    const a = (i % bays - (bays - 1) / 2) * (main - 0.8) / bays;
    const b = (Math.floor(i / bays) - (rows - 1) / 2) * across / rows;
    return alongX ? [a, b] : [b, a];
  });
  const clear = site.clearance ?? 4.68;
  if (roof) {
    const ring = site.canopyRing ?? [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    const next = i => ring[(i + 1) % ring.length];
    const signedArea = ring.reduce((area, [x, z], i) => area + x * next(i)[1] - z * next(i)[0], 0);
    const perimeter = signedArea < 0 ? [...ring].reverse() : ring;
    const grade = Math.max(bottom(0, 0), ...[...positions, ...perimeter].map(([x, z]) => bottom(x, z)));
    const ceiling = grade + clear, roofTop = ceiling + 0.75;
    structure.polygon([perimeter.map(([x, z]) => point(x, ceiling, z))], WALL);
    structure.polygon([perimeter.map(([x, z]) => point(x, roofTop, z)).reverse()], ROOF);
    for (const [i, [ax, az]] of perimeter.entries()) {
      const [bx, bz] = perimeter[(i + 1) % perimeter.length];
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      if (length < 0.02) continue;
      for (const [lo, hi, color] of [
        [0, 0.1, WALL], [0.1, 0.21, style.accent], [0.21, 0.67, style.primary], [0.67, 0.75, ROOF],
      ]) {
        structure.quad(point(bx, ceiling + lo, bz), point(ax, ceiling + lo, az),
          point(ax, ceiling + hi, az), point(bx, ceiling + hi, bz), color);
      }
      if (length > 3) {
        const ux = dx / length, uz = dz / length, hw = Math.min((length - 0.35) / 2, 1.9);
        const cx = (ax + bx) / 2 + 0.014 * uz, cz = (az + bz) / 2 - 0.014 * ux;
        labels.push([point(cx + ux * hw, ceiling + 0.22, cz + uz * hw),
          point(cx - ux * hw, ceiling + 0.22, cz - uz * hw),
          point(cx - ux * hw, ceiling + 0.66, cz - uz * hw),
          point(cx + ux * hw, ceiling + 0.66, cz + uz * hw)]);
      }
    }
    const outer = perimeter.map(([x, z]) => {
      const [wx, , wz] = point(x, 0, z);
      return { x: wx, z: wz };
    });
    const bounds = {
      minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
      minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    };
    const polygon = { outer, holes: [] };
    colliders.push({ ...bounds, polygon, minY: ceiling, maxY: roofTop, kind: 'fuel-canopy' });
    weatherCovers.push({ ...bounds, ...polygon, height: () => ceiling });
    for (const [x, z] of positions) {
      const sx = x + (alongX ? -0.95 : 0), sz = z + (alongX ? 0 : -0.95);
      const base = bottom(sx, sz) - 0.16;
      box(structure, sx, base, sz, 0.35, ceiling - base, 0.35, METAL);
      box(detail, sx, base, sz, 0.43, 0.6, 0.43, STEEL);
      colliders.push(collider(sx, sz, 0.43, 0.43, base, ceiling, 'fuel-support'));
      for (const sign of [-1, 1]) {
        const offset = sign * Math.min(2, across / 4);
        const lx = x + (alongX ? 0 : offset), lz = z + (alongX ? offset : 0);
        const [wx, , wz] = point(lx, ceiling, lz);
        if (!polygonContains(polygon, wx, wz)) continue;
        box(illuminated, lx, ceiling - 0.055, lz, alongX ? 1.05 : 0.32, 0.055, alongX ? 0.32 : 1.05, LAMP);
        lights.push({ x: wx, y: ceiling - 0.13, z: wz, tx: wx, tz: wz, color: 0xfff4df, dist: 12, intensity: 62 });
      }
    }
  } else if (positions.length) {
    const [x, z] = positions[0];
    const lx = x - (alongX ? 0.93 : 0), lz = z - (alongX ? 0 : 0.93);
    const base = bottom(lx, lz);
    box(structure, lx, base, lz, 0.12, 3.02, 0.12, STEEL);
    box(illuminated, lx, base + 2.98, lz, 0.34, 0.07, 0.24, LAMP);
    const [wx, y, wz] = point(lx, base + 2.95, lz);
    const [tx, , tz] = point(x, base, z);
    lights.push({ x: wx, y, z: wz, tx, tz, color: 0xfff4df, dist: 9, intensity: 40 });
  }

  for (const [x, z] of positions) {
    const y = bottom(x, z);
    const wx = alongX ? 2.55 : 1.05, wz = alongX ? 1.05 : 2.55;
    box(structure, x, y - 0.15, z, wx, 0.26, wz, CONCRETE);
    box(structure, x, y + 0.11, z, alongX ? 0.68 : 0.56, 1.17, alongX ? 0.56 : 0.68, WALL);
    box(structure, x, y + 1.28, z, alongX ? 0.71 : 0.59, 0.27, alongX ? 0.59 : 0.71, style.primary);
    box(detail, x, y + 1.25, z, alongX ? 0.72 : 0.60, 0.055, alongX ? 0.60 : 0.72, style.accent);
    colliders.push(collider(x, z, 0.70, 0.70, y, y + 1.55, 'fuel-pump'));
    for (const side of [-1, 1]) {
      const nx = alongX ? 0 : side, nz = alongX ? side : 0;
      const offset = (front, across, y) => point(x + nx * front + nz * across, y, z + nz * front + nx * across);
      box(detail, x + nx * 0.35, y + 0.94, z + nz * 0.35,
        alongX ? 0.33 : 0.045, 0.25, alongX ? 0.045 : 0.33, DARK);
      box(detail, x + nx * 0.379, y + 1.04, z + nz * 0.379,
        alongX ? 0.18 : 0.019, 0.08, alongX ? 0.019 : 0.18, GLASS);
      const hose = new THREE.CatmullRomCurve3([
        offset(0.30, -0.21, y + 1.38), offset(0.42, -0.36, y + 0.87),
        offset(0.52, -0.29, y + 0.37), offset(0.50, 0.19, y + 0.59),
        offset(0.32, 0.23, y + 1.00),
      ].map(p => new THREE.Vector3(...p)));
      detail.solid(new THREE.TubeGeometry(hose, 8, 0.023, 4, false), DARK);
      const bx = x + (alongX ? side * 1.09 : 0), bz = z + (alongX ? 0 : side * 1.09);
      const by = bottom(bx, bz);
      if (!roof || side === 1) {
        box(detail, bx, by, bz, 0.11, 0.66, 0.11, style.accent);
        box(detail, bx, by + 0.46, bz, 0.12, 0.12, 0.12, DARK);
      }
    }
    if (!roof) labelFaces(labels, point, alongX ? 0.66 : 0.54, alongX ? 0.59 : 0.71, y + 1.34, 0.17, x, z);
  }

  if (site.shop) shopExterior(site.shop, style, shopStyle, structure, detail, illuminated, labels, colliders, lights);

  if (site.pylon) {
    const [x, z] = site.pylon;
    const pylon = frame({ x, z, heading: site.pylonHeading ?? site.heading });
    const y = pylon.bottom(0, 0);
    pylon.box(structure, 0, y - 0.12, 0, 0.75, 3.18, 0.36, STEEL);
    pylon.box(structure, 0, y + 3.02, 0, 1.53, 2.78, 0.29, DARK);
    pylon.box(structure, 0, y + 5.12, 0, 1.53, 0.68, 0.31, style.primary);
    pylon.box(structure, 0, y + 4.97, 0, 1.53, 0.15, 0.31, style.accent);
    labelFaces(labels, pylon.point, 1.48, 0.31, y + 5.19, 0.59);
    labelFaces(priceFaces, pylon.point, 1.44, 0.29, y + 3.12, 1.79);
    colliders.push(pylon.collider(0, 0, 0.75, 0.36, y - 0.12, y + 5.8, 'fuel-pylon'));
  }

  const group = new THREE.Group();
  group.name = site.name;
  group.userData.colliders = colliders;
  group.userData.forecourtLights = lights;
  group.userData.weatherCovers = weatherCovers;
  group.userData.fuelSite = { id: site.id, pumps: positions.length, canopy: roof };
  const mainMesh = structure.mesh();
  mainMesh.name = 'Station shells and pumps';
  group.add(mainMesh);
  if (illuminated.vertices.length) {
    const mesh = illuminated.mesh();
    const shopWindow = color(0xffd298).mul(0.68).mul(smoothstep(0, 0.06, cityUniforms.uWindowLights.z));
    mesh.material.emissiveNode = mix(color(0xfff4df).mul(2.1), shopWindow, attribute('civicGloss', 'float'))
      .mul(smoothstep(0.42, 1.1, cityUniforms.uInteriorGlow));
    mesh.name = 'Canopy lamps and lit shop windows';
    mesh.userData.snow = false;
    mesh.castShadow = false;
    group.add(mesh);
  }
  const labelMesh = signMesh(labels, atlas, style);
  if (labelMesh) {
    labelMesh.name = 'Station wordmarks';
    group.add(labelMesh);
  }
  const rates = signMesh(priceFaces, priceDisplay, site.id);
  if (rates) {
    rates.name = 'Estimated fuel prices';
    rates.userData.nearDetail = true;
    group.add(rates);
  }
  if (detail.vertices.length) {
    const mesh = detail.mesh();
    mesh.name = 'Pump hoses and fittings';
    mesh.userData.nearDetail = true;
    mesh.castShadow = false;
    group.add(mesh);
  }
  return group;
}

export function buildEdeFuelStations(sites = EDE_FUEL_SITES, { live = false } = {}) {
  const styles = sites.map(stationStyle);
  const shopStyles = sites.map((site, i) => site.shop?.wordmark
    ? { ...styles[i], label: site.shop.wordmark } : styles[i]);
  const atlas = signAtlas([...styles, ...shopStyles]);
  const rates = priceAtlas(sites.filter(site => site.pylon), live);
  return sites.map((site, i) => drawStation(site, styles[i], shopStyles[i], atlas, rates));
}
