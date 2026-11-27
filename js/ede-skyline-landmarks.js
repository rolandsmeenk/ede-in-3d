import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup } from './ede-civic-landmarks.js';
import { EDE_SKYLINE_LANDMARKS, SKYLINE_SHELLS } from './ede-skyline-survey.js';
import { createSurveyLandmark, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { surveyedWindowBatch, surveyPanelTexture, texturedSurveyPanel } from './ede-survey-panel-texture.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const concrete = 0xbcb6a9;
const glazing = [0x405258, 0x4c5f62, 0x52636a, 0x627172];
const galleryColors = {
  'valkestein-west': [0xc8beb0, 0xa6a7a2, 0x716961],
  'valkestein-midden': [0xc8bca8, 0x9fa5a3, 0x735f51],
  'valkestein-oost': [0xcdc1ad, 0xaab0ae, 0x755f52],
  'weerdestein-flat': [0xc2bdb0, 0xa7a6a2, 0x846e5c],
  'groot-derxsgoed': [0xb8b0a4, 0xa89584, 0x8a6256],
  'de-brugge-flat': [0xc4b7a7, 0xa5a19a, 0xa46b5d],
  'groot-haversteeg': [0xbcbaa9, 0xaca89f, 0x9e7668],
  'de-elskamp': [0xc3b5a6, 0xb6aca1, 0xa77360],
  'willem-marisflat': [0xc8c0af, 0xa9aaa0, 0x7c8a83],
  stroombergflat: [0xbbb4a2, 0xa6a196, 0x8f6859],
  merlijnflat: [0xbab3a6, 0xa8a097, 0xa07562],
};
function surveyedBox(batch, wall, u, y, offset, width, height, depth, color) {
  const [x, , z] = wall.point(u, y, offset);
  const heading = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(heading).translate(x, y, z), color);
}

const groenendaalFacade = { floors: 9, base: 3.0, brick: 0x63504b, slab: 0xb77e75, rail: 0x72939a };
const photographedFlats = {
  mariendaal: { floors: 14, base: 3.3, roof: 34.65, brick: 0x684f49, slab: 0xb98a83, rail: 0xbfc9cc },
  'groenendaal-noord': { ...groenendaalFacade, roof: 19.98 },
  'groenendaal-zuid': { ...groenendaalFacade, roof: 20.25 },
  langenhorst: { floors: 13, base: 2.9, roof: 30.74, brick: 0x615753, slab: 0xa6aaa7, rail: 0x819496 },
};

function groenendaalStairCladding(wall) {
  const { shell, width, base, high, normal, point } = wall;
  const colors = [0xa3b7bc, 0x7f9c9a, 0x9c665f, 0xa9775b, 0xb78d76, 0x988a83, 0xb5abab];
  const step = 1.46, slope = 0.72;
  const bottom = base + 0.12, top = high - 0.13;
  for (let row = -4; bottom + row * step < top; row++) {
    let from = 0.03;
    for (let tile = 0; from < width - 0.03; tile++) {
      const hash = Math.abs(row * 71 + tile * 29 + 11) % 37;
      const to = Math.min(width - 0.03, from + 1.2 + (hash % 6) * 0.43);
      const lo = bottom + row * step;
      let polygon = [[from, lo + from * slope], [to, lo + to * slope],
        [to, lo + to * slope + step], [from, lo + from * slope + step]];
      for (const [edge, sign] of [[bottom, 1], [top, -1]]) {
        polygon = polygon.flatMap((p, i, ring) => {
          const q = ring[(i + 1) % ring.length];
          const inside = (p[1] - edge) * sign >= 0, nextInside = (q[1] - edge) * sign >= 0;
          const crossing = inside === nextInside ? [] : [[p[0] + (q[0] - p[0]) * (edge - p[1]) / (q[1] - p[1]), edge]];
          return inside ? [p, ...crossing] : crossing;
        });
      }
      if (polygon.length > 2) shell.polygon([polygon.map(([u, y]) => point(u, y, 0.028))], colors[hash % colors.length]);
      from = to;
    }
  }
  if (normal.x < 0.7) {
    const u = width * (normal.z > 0 ? 0.24 : 0.63);
    for (let y = base + 2.25; y + 1 < high - 0.5; y += 2.80) {
      surveyWindow(wall, u, u + 1.05, y, y + 0.77, { frame: 0xb9babb, color: 0x40535a, columns: 2 });
    }
  }
  return colors[0];
}

function langenhorstEnd(wall, surfaces) {
  const { shell, width, base, high } = wall;
  const colors = ['#9baebf', '#798995', '#475561', '#3c4b57', '#8da0ad', '#699554'];
  const bottom = base + 2.9, top = high - 0.19, inset = 0.12;
  const span = width - 2 * inset;
  const rows = 71, textureWidth = 512, textureHeight = 1024;
  const map = surveyPanelTexture(textureWidth, textureHeight, ctx => {
    const pxPerMetre = textureWidth / span, rowPixels = textureHeight / rows;
    const seamPixels = 0.014 * textureHeight / (top - bottom);
    ctx.fillStyle = '#374650';
    ctx.fillRect(0, 0, textureWidth, textureHeight);
    for (let row = 0; row < rows; row++) {
      let from = 0;
      for (let tile = 0; from < span; tile++) {
        const hash = (row * 31 + tile * 43 + row * tile * 17) % 67;
        const to = Math.min(span, from + 0.68 + (hash % 6) * 0.39);
        ctx.fillStyle = colors[hash < 4 ? 5 : hash % 5];
        ctx.fillRect(from * pxPerMetre, textureHeight - (row + 1) * rowPixels + seamPixels,
          Math.max(0, to - from - 0.018) * pxPerMetre, rowPixels - seamPixels);
        from = to;
      }
    }
  });
  const material = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.86 });
  const cladding = texturedSurveyPanel(wall, inset, width - inset, bottom, top, material);
  cladding.name = 'Langenhorst panel cladding';
  surfaces.push(cladding);
  surveyedBox(shell, wall, width / 2, high - 0.14, 0.18, width + 0.10, 0.23, 0.42, 0x3b4448);
  for (const fraction of [0.31, 0.67]) {
    const door = width * fraction;
    surveyPanel(wall, door, door + 0.98, base + 0.08, base + 2.14, 0x365858);
    surveyPanel(wall, door, door + 0.98, base + 2.14, base + 2.39, 0xa3a9a3);
    surveyWindow(wall, door + 0.14, door + 0.84, base + 0.98, base + 1.93,
      { frame: 0xa3a9a3, color: 0x364748 });
  }
  return 0x374650;
}

function photographedFacade(wall, site, photo, surfaces, windows) {
  const { shell, trim, width, base, low, high, normal } = wall;
  const groenendaal = site.id.startsWith('groenendaal-');
  const langenhorst = site.id === 'langenhorst';
  const plinth = base + photo.base;
  const { roof } = photo;
  const pitch = (roof - plinth - 0.35) / photo.floors;
  const mainWall = high >= roof - 0.2;
  const longFace = langenhorst ? Math.abs(normal.z) > 0.7 : Math.abs(normal.x) > 0.7;
  const onShell = { ...wall, trim: shell };
  const panel = (from, to, lo, hi, color) => surveyPanel(onShell, from, to, lo, hi, color);
  if (groenendaal && high > roof + 2 && low <= base + 0.1 && width > 3) {
    return groenendaalStairCladding(wall);
  }
  if (langenhorst && !longFace && width > 14 && mainWall) return langenhorstEnd(wall, surfaces);
  if (!mainWall || width < 8 || high > roof + 2) return photo.brick;

  panel(0.04, width - 0.04, high - 0.26, high - 0.035, photo.slab);
  if (low <= base + 0.1) panel(0.05, width - 0.05, base + 0.04, plinth, photo.brick);
  if (!longFace) {
    for (let course = 0; course < photo.floors; course++) {
      const floor = plinth + course * pitch;
      panel(0.03, width - 0.03, floor - 0.13, floor + 0.02, 0xc2c3be);
    }
    surveyedBox(trim, wall, width * (normal.z > 0 ? 0.13 : 0.85), (plinth + high - 0.48) / 2, 0.065,
      0.10, high - 0.48 - plinth, 0.09, 0x845759);
    return photo.brick;
  }

  const recessed = langenhorst && normal.z < 0;
  const depth = recessed ? 0.72 : 1.20;
  const bays = Math.max(1, Math.round(width / (groenendaal ? 4.9 : 4.25)));
  const bay = width / bays;
  const rail = groenendaal && normal.x < 0 ? 0x98a5a0 : photo.rail;
  const slabThickness = 0.24;
  for (let course = 0; course < photo.floors; course++) {
    const floor = plinth + course * pitch;
    if (!surveyOpeningFits(wall, 0.12, width - 0.12, floor + 0.05, floor + 1.03)) continue;
    const fascia = groenendaal && normal.x > 0 && course >= 4 ? 0xafbcb9 : photo.slab;
    surveyedBox(shell, wall, width / 2, floor, depth / 2, width - 0.10, slabThickness, depth, photo.slab);
    surveyPanel(onShell, 0.05, width - 0.05, floor + slabThickness / 2, floor + 0.39, fascia, depth);
    surveyPanel(onShell, 0.05, width - 0.05, floor + 0.39, floor + 0.93, rail, depth, 0.48);
    surveyPanel(onShell, 0.05, width - 0.05, floor + 0.92, floor + 0.97, 0x4e5c58, depth + 0.022);
    for (let i = 0; i < bays; i++) {
      const u = bay * i;
      const from = u + bay * 0.07, to = u + bay * 0.81, lo = floor + 0.22, hi = floor + pitch - 0.28;
      if (surveyOpeningFits(wall, from, to, lo, hi)) windows.add(wall, from, to, lo, hi, (i + course * 3) % glazing.length);
      if (groenendaal) {
        surveyPanel(wall, u + bay * 0.81, u + bay * 0.96, floor + 0.13, floor + pitch - 0.28,
          normal.x > 0 ? 0xa5766d : 0xc6b7a4);
      }
      surveyPanel(wall, u + bay * 0.98, u + bay * 0.98 + 0.03, floor + 0.39, floor + 0.92, 0xa3adab, depth + 0.014);
    }
  }
  if (groenendaal && low <= base + 0.1) {
    for (let u = 0.6; u + 2 < width; u += 8.4) {
      surveyWindow(wall, u + 1.0, Math.min(u + 6.0, width - 0.15), plinth - 0.69, plinth - 0.25,
        { color: 0x404948, frame: 0x7b7f77, columns: 3 });
      surveyPanel(wall, u, u + 0.89, base + 0.10, base + 2.25, normal.x > 0 ? 0x9b5962 : 0x79746a, 0.041);
    }
  }
  return groenendaal ? 0x9e8a78 : photo.brick;
}

function housingFacade(wall, site) {
  const [body, deck, accent] = galleryColors[site.id] ?? [0xc4bcaa, 0xb1a99c, 0x928578];
  const { width, base, high, low, normal, a, b, shell, trim } = wall;
  const pointBlock = site.style === 'point';
  const longFace = width > (pointBlock ? 7.3 : 13.2);
  const plinth = base + 2.45;
  const pitch = 2.78;
  const tint = high < plinth + 0.08 ? accent : body;
  if (!longFace && !pointBlock) return tint;
  if (low > base + 7 || high < plinth + 2.2) return tint;

  const balconySide = pointBlock || (Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? normal.z > 0 : normal.x > 0);
  const bayCount = Math.max(1, Math.round(width / (pointBlock ? 3.7 : 4.35)));
  const bay = width / bayCount;
  if (bay < 1.2) return tint;
  for (let course = 0; plinth + course * pitch + 2.22 < high; course++) {
    const floor = plinth + course * pitch;
    const start = 0.17, end = width - 0.17;
    if (!surveyOpeningFits(wall, start, end, floor + 0.06, floor + 0.72)) continue;
    surveyPanel({ ...wall, trim: shell }, start, end, floor + 0.07, floor + 0.42, deck, 0.027);
    if (balconySide) {
      const depth = pointBlock ? 0.78 : 0.63;
      surveyedBox(trim, wall, width / 2, floor - 0.02, depth / 2, width - 0.28, 0.18, depth, deck);
      surveyPanel(wall, start, end, floor + 0.09, floor + 0.93, accent, depth, 0.19);
      surveyPanel(wall, start, end, floor + 0.89, floor + 0.96, deck, depth + 0.012);
    }
    for (let i = 0; i < bayCount; i++) {
      const u = bay * i;
      surveyWindow(wall, u + bay * 0.12, u + bay * (balconySide ? 0.83 : 0.70), floor + (balconySide ? 0.53 : 0.80),
        floor + 2.20, { color: glazing[(i + course * 3) % glazing.length], frame: 0xd3cec0, columns: 2 });
      if (balconySide) {
        surveyPanel(wall, u + bay * 0.89, u + bay * 0.96, floor + 0.97, floor + 2.20, accent, 0.041);
        surveyPanel(wall, u + bay * 0.95, u + bay * 0.97, floor + 0.11, floor + 0.92, deck, (pointBlock ? 0.78 : 0.63) + 0.024);
      } else {
        surveyPanel(wall, u + bay * 0.74, u + bay * 0.93, floor + 0.62, floor + 2.28, accent, 0.038);
      }
    }
  }
  if (width > 12 && high > plinth + 5) {
    const mid = width / 2;
    surveyWindow(wall, mid - 1.65, mid + 1.65, base + 0.24, base + 2.23,
      { color: 0x394d53, frame: 0x888b83, columns: 3, rows: 2 });
  }
  return tint;
}

function housing(site) {
  const shells = SKYLINE_SHELLS[site.id].map(part => ({ ...part, wallColor: concrete, roofColor: 0x5c5d5c }));
  const photo = photographedFlats[site.id];
  const surfaces = [];
  const windows = photo && surveyedWindowBatch({ columns: 3, frame: '#c1bdb0',
    glazing: glazing.map(color => `#${color.toString(16).padStart(6, '0')}`) });
  const model = createSurveyLandmark(site, shells, photo
    ? wall => photographedFacade(wall, site, photo, surfaces, windows)
    : wall => housingFacade(wall, site));
  for (const surface of surfaces) model.add(surface);
  if (windows) model.add(windows.mesh());
  for (const mesh of model.children) {
    if (mesh.userData.nearDetail) mesh.userData.nearDetail = 240;
  }
  return model;
}

const leeuwenhorstBrick = 0xb08356;
const leeuwenhorstStoreys = 7, leeuwenhorstPitch = 2.94;
const leeuwenhorstBalcony = { from: 0.57, to: 4.40, depth: 1.62 };

function leeuwenhorst(site) {
  const [original] = SKYLINE_SHELLS[site.id];
  const { ground: base } = original;
  const points = [...original.points], faces = [...original.faces];
  const balconyFace = 44;
  const [ax, , az] = points[faces[balconyFace][1][0]];
  const [bx, , bz] = points[faces[balconyFace][1][2]];
  const width = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / width, dz = (bz - az) / width;
  const { from, to, depth } = leeuwenhorstBalcony;
  const balconyOpening = (floor) => {
    const lo = base + 0.98 + floor * leeuwenhorstPitch;
    return [lo, lo + 2.45];
  };
  const holes = [];
  for (let floor = 0; floor < leeuwenhorstStoreys; floor++) {
    const [lo, hi] = balconyOpening(floor);
    const start = points.length;
    for (const [u, y] of [[from, lo], [from, hi], [to, hi], [to, lo]]) {
      points.push([ax + u * dx, y, az + u * dz]);
    }
    holes.push([start, start + 1, start + 2, start + 3]);
  }
  faces[balconyFace] = [...faces[balconyFace], ...holes];
  const shells = [{ ...original, points, faces, wallColor: leeuwenhorstBrick, roofColor: 0x5d5d54 }];
  return createSurveyLandmark(site, shells, wall => {
    const { faceIndex, point, shell, width, high, normal } = wall;
    const onShell = { ...wall, trim: shell };
    if (faceIndex === balconyFace) {
      for (let floor = 0; floor < leeuwenhorstStoreys; floor++) {
        const [lo, hi] = balconyOpening(floor);
        const cabin = [
          [from, lo], [to, lo], [to, hi], [from, hi],
        ];
        for (let side = 0; side < cabin.length; side++) {
          const p = cabin[side], q = cabin[(side + 1) % cabin.length];
          shell.polygon([[point(...p), point(...q), point(...q, -depth), point(...p, -depth)]], side % 2 ? 0x97867a : 0x706c67);
        }
        surveyPanel(onShell, from, to, lo, hi, 0x655e57, -depth);
        surveyPanel(wall, from + 0.16, to - 0.12, lo + 0.10, hi - 0.30, glazing[floor % glazing.length], -depth + 0.03, 0.7);
        if (floor > 0) {
          surveyPanel(onShell, from, to, lo, lo + 0.24, 0xb4aaa0, 0.035);
          surveyPanel(onShell, from + 0.055, to - 0.055, lo + 0.25, lo + 0.95, 0x839190, 0.032, 0.55);
          surveyPanel(wall, from, to, lo + 0.93, lo + 0.98, 0x68726d, 0.047);
          for (let u = from + 0.08; u < to; u += 0.98) {
            surveyPanel(wall, u, u + 0.035, lo + 0.28, lo + 0.93, 0x7e8885, 0.047);
          }
        }
      }
    }
    if (faceIndex === 45 || faceIndex === 51) {
      const windowCenters = [
        [6.33, 8.10, 10.58, 14.08, 17.10], [6.62, 9.17, 11.26, 12.97, 16.25],
        [6.34, 9.13, 10.62, 14.22, 16.37], [6.65, 7.86, 10.76, 12.90, 17.15],
        [6.34, 9.15, 11.46, 14.24, 17.03], [6.77, 9.16, 10.90, 13.27, 16.34],
        [6.36, 8.52, 10.92, 14.48, 17.15],
      ];
      const origin = (wall.a.x - ax) * dx + (wall.a.z - az) * dz;
      for (const [floor, centers] of windowCenters.entries()) {
        for (const [i, center] of centers.entries()) {
          const half = i % 2 ? 0.46 : 0.29;
          const u = center - origin, lo = base + 0.37 + floor * leeuwenhorstPitch;
          surveyWindow(wall, u - half, u + half, lo, lo + 2.30,
            { frame: 0x494746, color: glazing[(floor + i * 3) % glazing.length], rows: 2 });
        }
      }
    } else if (faceIndex !== balconyFace && width > 4.6 && high > base + 20 && normal.z < 0.9) {
      const bays = Math.round(width / 3.4);
      for (let floor = 0; floor < leeuwenhorstStoreys; floor++) {
        const lo = base + 0.37 + floor * leeuwenhorstPitch;
        for (let bay = 0; bay < bays; bay++) {
          const u = (bay + 0.5) * width / bays;
          surveyWindow(wall, u - 0.46, u + 0.46, lo, lo + 2.14,
            { frame: 0x494746, color: glazing[(floor + bay) % glazing.length], rows: 2 });
        }
      }
    }
    return high < base + 4 ? 0x675b4e : leeuwenhorstBrick;
  });
}

const timber = 0x966e4f, limestone = 0xa79c89, mullion = 0x5d584c;

function terraceFrame(part) {
  const ring = part.outline[0];
  const edges = ring.map(([x, z], i) => [ring[(i + 1) % ring.length][0] - x, ring[(i + 1) % ring.length][1] - z]);
  const [dx, dz] = edges.reduce((a, b) => Math.hypot(...a) > Math.hypot(...b) ? a : b);
  const heading = -Math.atan2(dz, dx), cos = Math.cos(heading), sin = Math.sin(heading);
  const us = ring.map(([x, z]) => cos * x - sin * z), vs = ring.map(([x, z]) => sin * x + cos * z);
  const centerU = (Math.min(...us) + Math.max(...us)) / 2, centerV = (Math.min(...vs) + Math.max(...vs)) / 2;
  const width = Math.max(...us) - Math.min(...us), depth = Math.max(...vs) - Math.min(...vs);
  const at = (u, v) => [cos * (centerU + u) + sin * (centerV + v), -sin * (centerU + u) + cos * (centerV + v)];
  function box(batch, w, h, d, u, y, v, color) {
    const [x, z] = at(u, v);
    batch.solid(new THREE.BoxGeometry(w, h, d).rotateY(heading).translate(x, y, z), color);
  }
  return { width, depth, at, box };
}

function proeftuin(site) {
  const common = new CivicBatch(), close = new CivicBatch(), colliders = [];
  for (const [partIndex, part] of SKYLINE_SHELLS[site.id].entries()) {
    const { width, depth, at, box } = terraceFrame(part);
    const base = part.ground, top = base + part.height, tall = partIndex === 0;
    const support = getTerrain() ? Math.min(base, ...part.outline[0].map(([x, z]) => terrainHeightAt(x, z) - 0.18)) : base;
    const plinth = Math.min(top - 4, base + (tall ? 2.2 : 1.05));
    const floorHeight = (top - plinth - 0.42) / part.stories;
    box(common, width - 0.6, plinth - support, depth - 0.30, 0, (support + plinth) / 2, 0, limestone);
    for (let floor = 0; floor < part.stories; floor++) {
      const y = plinth + floor * floorHeight;
      const inset = tall && floor >= part.stories - 2 ? 0.79 : 0;
      const w = width - 2 * inset, d = depth - 0.92 * inset;
      const coreW = w - (tall ? 2.9 : 1.8), coreD = d - (tall ? 3.25 : 2.2);
      box(common, coreW, floorHeight - 0.14, coreD, 0, y + floorHeight / 2, 0, limestone);
      box(common, w - 0.05, 0.25, d - 0.08, 0, y + 0.09, 0, timber);
      for (const side of [-1, 1]) {
        const v = side * coreD / 2, length = Math.round(coreW / 3.65);
        const span = coreW / length;
        for (let i = 0; i < length; i++) {
          const u = -coreW / 2 + (i + 0.5) * span;
          box(close, span * 0.80, floorHeight * 0.74, 0.085, u, y + floorHeight * 0.49, v, glazing[(i + floor) % glazing.length]);
          box(close, 0.09, floorHeight * 0.74, 0.11, u, y + floorHeight * 0.49, v + side * 0.025, mullion);
        }
        for (const u of [-1, 1]) {
          const end = u * (w / 2 - 0.30), edge = side * (d / 2 - 0.23);
          const terrace = tall ? 5.2 + (floor % 3) * 0.6 : 4.4;
          box(close, terrace, 0.72, 0.06, end - u * terrace / 2, y + 0.60, edge, 0x778b84);
          box(close, terrace, 0.06, 0.10, end - u * terrace / 2, y + 0.98, edge, 0xbfb9a6);
          box(close, 0.08, 0.73, d * 0.27, end, y + 0.61, edge - side * d * 0.135, 0x73847d);
          box(close, 0.13, floorHeight - 0.18, 0.13, end, y + floorHeight * 0.5, edge, timber);
          box(close, 2.15, 0.54, 0.47, end - u * 1.63, y + 0.37, edge - side * 0.41, 0x6a6553);
          for (let plant = 0; plant < 3; plant++) {
            const [x, z] = at(end - u * (0.94 + plant * 0.64), edge - side * 0.43);
            const radius = 0.34 + ((plant + floor) % 3) * 0.10;
            close.solid(new THREE.IcosahedronGeometry(radius, 0).scale(1.22, 0.8, 0.78)
              .translate(x, y + 0.69 + radius * 0.36, z), [0x5d7540, 0x62763f, 0x395439][plant]);
          }
          for (let i = 1; i < 4; i++) {
            box(close, 0.075, floorHeight * 0.80, 0.10, end - u * (2.8 + i * 0.32), y + floorHeight * 0.51, v, timber);
          }
          box(close, 0.07, floorHeight * 0.74, coreD * 0.34, u * coreW / 2, y + floorHeight * 0.50,
            side * coreD * 0.22, glazing[(floor + partIndex) % glazing.length]);
        }
      }
    }
    box(common, width - (tall ? 1.58 : 0.06), 0.42, depth - (tall ? 0.73 : 0.09), 0, top - 0.21, 0, timber);
    box(common, width - 2.1, 0.10, depth - 1.2, 0, top - 0.05, 0, 0x5b5e52);
    const polygon = site.surveyFootprints[partIndex];
    const { outer } = polygon;
    colliders.push({ minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
      minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)), minY: support, maxY: top, polygon });
  }
  const model = makeGroup(site.name, common, colliders);
  const detail = close.mesh();
  detail.userData.nearDetail = 220;
  detail.castShadow = false;
  model.add(detail);
  return model;
}

// Public BGT tank centers and radii, with AHN top elevations in scene metres.
const millTanks = [
  [-6353.37, -2183.57, 1.40, -9.34], [-6353.25, -2180.32, 1.40, -4.86], [-6352.94, -2176.87, 1.40, -4.74],
];

function mill(site) {
  const shells = SKYLINE_SHELLS[site.id].map(part => ({ ...part, wallColor: 0xb9b9b1, roofColor: 0x585c59,
    roofColors: part.faces.map(([roof, indices]) => roof && indices.length > 5 && indices.every(i => part.points[i][1] > 15)
      ? 0x985f58 : 0x565a57) }));
  const model = createSurveyLandmark(site, shells, wall => {
    const { width, high, low, base } = wall;
    if (width > 3.2 && low < base + 0.1 && high > base + 4.25) {
      surveyWindow(wall, width * 0.25, width * 0.75, base + 0.27, base + 4.05, { color: 0x5d625f, frame: 0xa8aaa2, rows: 4 });
    }
    if (width > 1.5 && high > base + 6) {
      for (let u = 0.18; u < width - 0.10; u += 0.51) {
        if (surveyOpeningFits(wall, u, u + 0.17, Math.max(low, base + 4.4) + 0.1, high - 0.15)) {
          surveyPanel(wall, u, u + 0.039, Math.max(low, base + 4.4) + 0.1, high - 0.15, 0xa2a49c, 0.019);
        }
      }
    }
    return high < base + 4 ? 0x8a8980 : 0xd1d1c8;
  }, ({ group, colliders }) => {
    const equipment = new CivicBatch();
    for (const [x, z, radius, top] of millTanks) {
      const y = getTerrain() ? Math.min(-14.17, terrainHeightAt(x, z) - 0.12) : -14.17;
      const rim = top - 0.3;
      equipment.solid(new THREE.CylinderGeometry(radius, radius, rim - y, 14).translate(x, (rim + y) / 2, z), 0x9ba29f);
      equipment.solid(new THREE.CylinderGeometry(radius * 0.61, radius, top - rim, 14).translate(x, (top + rim) / 2, z), 0xaab2ae);
      const outer = Array.from({ length: 14 }, (_, i) => {
        const angle = 2 * Math.PI * i / 14;
        return { x: x + radius * Math.cos(angle), z: z + radius * Math.sin(angle) };
      });
      colliders.push({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius,
        minY: y, maxY: top, polygon: { outer, holes: [] } });
    }
    for (const [x, z, bottom, top] of [[-6378.84, -2179.52, 12.1, 20.72], [-6377.75, -2179.11, 12.1, 20.42]]) {
      equipment.solid(new THREE.CylinderGeometry(0.33, 0.35, top - bottom, 12).translate(x, (bottom + top) / 2, z), 0xbfc5c1);
      equipment.solid(new THREE.CylinderGeometry(0.49, 0.44, 0.19, 12).translate(x, top - 0.09, z), 0x858d8b);
    }
    group.add(equipment.mesh());
  });
  return model;
}

const byStyle = { terraces: proeftuin, leeuwenhorst, mill };
export const EDE_SKYLINE_LANDMARK_FACTORIES = Object.fromEntries(EDE_SKYLINE_LANDMARKS.map(site => {
  const build = byStyle[site.style] ?? housing;
  return [site.id, (_footprints, site) => build(site)];
}));
