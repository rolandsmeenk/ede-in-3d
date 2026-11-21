import { mix, normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { CivicBatch, along, civicSigns, facePanel, makeGroup, offsetEdge } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';
import { terrainHeightAt } from './terrain.js';

// BAG LoD 0 outlines transformed through the pinned Ede RD converter. Heights
// are metres NAP. AHN 0.5 m DTM samples on a 1 m exterior buffer set the plinths.
// Asakkerweg roof uses 3DBAG due to trees over the AHN DSM; Oranjelaan uses AHN.
// https://docs.3dbag.nl/en/copyright/ · https://www.ahn.nl/dataroom
export const EDE_HISTORIC_UTILITIES = [
  {
    id: 'transformatorhuisje-asakkerweg', name: 'Transformatorhuisje Asakkerweg',
    bagId: '0228100000071608', osmId: 'w271587306', street: 'Asakkerweg 4A',
    ring: [[133.885, -778.577], [136.961, -777.872], [138.225, -783.532], [135.111, -784.226]],
    x: 136.045, z: -781.052, groundNap: 23.225, roofNap: 27.535,
    longWall: 1, shortWall: 0, tilePanel: true, approach: { x: 145.6, z: -781.5 },
  },
  {
    id: 'transformatorhuisje-oranjelaan', name: 'Transformatorhuisje Oranjelaan',
    bagId: '0228100000071156', osmId: 'w271379615', street: 'Oranjelaan 2',
    ring: [[-58.627, 2063.182], [-56.074, 2068.552], [-53.328, 2067.213], [-55.842, 2061.844]],
    x: -55.968, z: 2065.198, groundNap: 20.47, roofNap: 24.781,
    longWall: 2, shortWall: 1, tilePanel: false, approach: { x: -57.0, z: 2077.0 },
  },
];

const redBrick = 0x875e51, tarBrick = 0x303438, yellowBrick = 0xba964c;
const doorGreen = 0x394c36, grate = 0x323932, glass = 0x686b57;
let masonryTexture;

function outlineWalls(outer) {
  return outer.map((a, i) => {
    const b = outer[(i + 1) % outer.length];
    const width = Math.hypot(b.x - a.x, b.z - a.z);
    return { a, b, width, normal: { x: (a.z - b.z) / width, z: (b.x - a.x) / width } };
  });
}

function roofOutline(outer, walls, reach) {
  return outer.map((p, i) => {
    const prev = walls[(i + walls.length - 1) % walls.length].normal;
    const next = walls[i].normal;
    const scale = reach / (1 + prev.x * next.x + prev.z * next.z);
    return { x: p.x + (prev.x + next.x) * scale, z: p.z + (prev.z + next.z) * scale };
  });
}

function addHippedRoof(batch, outer, walls, shortWall, eave, ridge) {
  const overhang = roofOutline(outer, walls, 0.57);
  const [a, b, c, d] = [...overhang.slice(shortWall), ...overhang.slice(0, shortWall)];
  const endA = along(a, b, 0.5), endB = along(c, d, 0.5);
  const peakA = along(endA, endB, 0.27), peakB = along(endA, endB, 0.73);
  const at = (p, y) => [p.x, y, p.z];
  batch.triangle(at(a, eave), at(b, eave), at(peakA, ridge), 0x575a50);
  batch.quad(at(b, eave), at(c, eave), at(peakB, ridge), at(peakA, ridge), 0x575a50);
  batch.triangle(at(c, eave), at(d, eave), at(peakB, ridge), 0x575a50);
  batch.quad(at(d, eave), at(a, eave), at(peakA, ridge), at(peakB, ridge), 0x575a50);
  batch.polygon([[d, c, b, a].map(p => at(p, eave - 0.14))], 0x303a31);
  for (let i = 0; i < overhang.length; i++) {
    const p = overhang[i], q = overhang[(i + 1) % overhang.length];
    batch.quad(at(p, eave - 0.14), at(q, eave - 0.14), at(q, eave - 0.03), at(p, eave - 0.03), 0x455347);
    batch.quad(at(p, eave - 0.03), at(q, eave - 0.03), at(q, eave), at(p, eave), 0x747970);
  }
}

function addPlaque(fit, shell, details, panelY, size) {
  const [start, end] = [0.10, 0.29];
  const panelH = size * 0.049;
  const panelW = end - start;
  fit(shell, start - 0.007, end + 0.007, panelY - 0.007, panelY + panelH + 0.007, 0x797358, 0.040);
  // Three ceramic tiles in the architrave, with original lettering recreated as text.
  fit(details, start, end, panelY, panelY + panelH, 0x473128, 0.049, 0.14);
  for (const part of [0.333, 0.667]) {
    const u = start + panelW * part;
    fit(details, u - 0.0004, u + 0.0004, panelY, panelY + panelH, 0x827057, 0.055);
  }
  return { start, end, panelH };
}

export function createHistoricUtility(site) {
  const { longWall, shortWall } = site;
  const outer = site.ring.map(([x, z]) => ({ x, z }));
  const walls = outlineWalls(outer);
  const masonry = new CivicBatch(), details = new CivicBatch(), roof = new CivicBatch();
  const base = site.groundNap - SCENE_NAP_ORIGIN, peak = site.roofNap - SCENE_NAP_ORIGIN;
  const eave = peak - 0.30, soffit = eave - 0.14, size = soffit - base;
  const foot = p => Math.min(base - 0.035, terrainHeightAt(p.x, p.z) - 0.035);
  const labels = [];

  for (const [i, { a, b, width, normal }] of walls.entries()) {
    const at = (p, y) => [p.x, y, p.z];
    masonry.quad(at(a, foot(a)), at(b, foot(b)), at(b, soffit), at(a, soffit), redBrick);
    const fit = (batch, u, v, lo, hi, color, offset = 0.015, sheen = 0) =>
      facePanel(batch, a, b, normal, u, v, lo, hi, color, offset, sheen);
    const tallFace = i === longWall, shortFace = i === shortWall;
    const band = base + size * 0.66, wainscot = base + 0.27;
    const cornerLeft = tallFace ? 0.33 : 0.13, cornerRight = tallFace ? 0.93 : 0.87;

    fit(masonry, 0, 1, Math.min(foot(a), foot(b)) - 0.005, wainscot, tarBrick, 0.012);
    fit(masonry, 0, cornerLeft, wainscot, band, tarBrick);
    fit(masonry, cornerRight, 1, wainscot, band, tarBrick);
    fit(masonry, 0, 1, band, band + 0.21, tarBrick, 0.018);
    fit(masonry, 0, 1, wainscot, wainscot + 0.047, yellowBrick, 0.028);
    for (const y of [band - 0.04, band + 0.205]) fit(masonry, 0, 1, y, y + 0.067, yellowBrick, 0.034);
    for (const u of [cornerLeft, cornerRight]) {
      fit(masonry, u - 0.027 / width, u + 0.027 / width, wainscot, band, yellowBrick, 0.030);
    }
    for (let y = wainscot + 0.31; y < band - 0.07; y += 0.30) {
      fit(masonry, 0, cornerLeft - 0.014, y, y + 0.041, yellowBrick, 0.030);
      fit(masonry, cornerRight + 0.014, 1, y, y + 0.041, yellowBrick, 0.030);
    }
    fit(masonry, 0, 1, soffit - 0.14, soffit, tarBrick, 0.032);
    for (let y = band + 0.39; y < soffit - 0.22; y += 0.14) {
      fit(masonry, 0, cornerLeft, y, y + 0.061, tarBrick, 0.025);
      fit(masonry, cornerRight, 1, y, y + 0.061, tarBrick, 0.025);
    }
    for (const u of [0.15, 0.40, 0.54, 0.68, 0.82]) {
      if (tallFace || shortFace) fit(details, u - 0.018, u + 0.018, soffit - 0.40, soffit - 0.34, grate, 0.039);
    }

    if (tallFace || shortFace) {
      const centre = tallFace ? 0.615 : 0.51;
      const half = (tallFace ? 0.55 : 0.46) / width;
      const bottom = base + 0.035, top = band - 0.043;
      fit(roof, centre - half - 0.018, centre + half + 0.018, bottom, top, 0x333d2d, 0.044);
      fit(roof, centre - half, centre + half, bottom + 0.019, top - 0.025, doorGreen, 0.054);
      fit(details, centre + half * 0.72, centre + half * 0.92, base + size * 0.29, base + size * 0.305, 0x838875, 0.068);
      fit(details, centre - half * 0.55, centre + half * 0.55, top - 0.53, top - 0.34, 0x6e7563, 0.062);
      const ventY = band + 0.019;
      fit(roof, centre - half * 1.03, centre + half * 1.03, ventY, band + 0.199, site.tilePanel && tallFace ? grate : glass, 0.035);
      for (let j = 1; j < 5; j++) {
        const u = centre + (j * 0.4 - 1) * half;
        fit(details, u - 0.007, u + 0.007, ventY, band + 0.199, 0x827e64, 0.045);
      }
    }
    if (tallFace && site.tilePanel) {
      const panelY = band + 0.005;
      const { start, end, panelH } = addPlaque(fit, masonry, details, panelY, size);
      const [left, right] = offsetEdge(along(a, b, start), along(a, b, end), normal, 0.056);
      for (const [word, lo, hi] of [
        ['PROVINCIALE', 0.54, 0.96], ['ELECTRICITEITSWERKEN', 0.07, 0.49],
      ]) {
        labels.push({ a: right, b: left, lo: panelY + panelH * lo, hi: panelY + panelH * hi,
          text: word, color: '#473128', textColor: '#dfa86a' });
      }
    }
  }

  addHippedRoof(roof, outer, walls, shortWall, eave, peak);
  const colliders = [{
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: Math.min(...outer.map(foot)), maxY: peak, polygon: { outer, holes: [] },
  }];
  const group = makeGroup(site.name, masonry, colliders);
  masonryTexture ??= createFacadeSurfaceTexture().texture;
  const tangent = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
  const brick = texture(masonryTexture, vec2(tangent.div(0.88), positionWorld.y.div(0.64))).r;
  group.children[0].material.colorNode = vertexColor().mul(mix(1, brick.mul(0.68).add(0.44), normalWorld.y.abs().oneMinus()));
  group.add(roof.mesh());
  const near = details.mesh();
  near.castShadow = false;
  near.userData.nearDetail = 75;
  group.add(near);
  const plaque = civicSigns(labels, { wide: true });
  if (plaque) {
    plaque.userData.nearDetail = 30;
    group.add(plaque);
  }
  return group;
}
