import * as THREE from 'three/webgpu';
import { mix, normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { pointInPoly } from './city-config.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { REMBRANDTLAAN_SURVEY } from './ede-rembrandtlaan-survey.js';

const fronts = [[0.83, 0.56], [0.83, 0.56], [0.83, 0.56], [0.56, -0.83], [0.56, -0.83], [-0.83, -0.56]];
const frame = 0xd7d9d5, blue = 0x355570;
const footprints = REMBRANDTLAAN_SURVEY.map(({ outline }) => outline.map(ring => ring.map(([x, z]) => ({ x, z }))));
let masonry;

function roofOverDoor(wall, left, right, height) {
  const [x, y, z] = wall.point((left + right) / 2, height, 0.31);
  const angle = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  wall.trim.solid(new THREE.BoxGeometry(right - left, 0.11, 0.68).rotateY(angle).translate(x, y, z), 0xbdc2bd);
  const ridge = wall.point(right - 0.42, height + 0.29, 0.04);
  const ridgeTip = wall.point(right - 0.42, height + 0.29, 0.60);
  const a = wall.point(right - 0.77, height + 0.05, 0.60), b = wall.point(right - 0.07, height + 0.05, 0.60);
  wall.trim.quad(a, ridgeTip, ridge, wall.point(right - 0.77, height + 0.05, 0.04), 0x776363);
  wall.trim.quad(ridgeTip, b, wall.point(right - 0.07, height + 0.05, 0.04), ridge, 0x776363);
  wall.trim.triangle(a, b, ridgeTip, 0xb3b5ad);
}

function decorate(wall) {
  const { buildingIndex, width, low, high, base, normal } = wall;
  if (low > base + 0.10 || width < 1.25 || high - base < 6) return;
  const [nx, nz] = fronts[Math.floor(buildingIndex / 3)];
  const front = normal.x * nx + normal.z * nz > 0.90;
  // The long transverse party walls only have openings on the two exposed block ends.
  const long = width > 7.5;
  if (long && !front && buildingIndex % 3 === 1) return;
  if (long && !front) {
    const [x, , z] = wall.point(width / 2, base, 0.20);
    const attached = footprints.some(([outer, ...holes], i) => i !== buildingIndex &&
      pointInPoly(outer, x, z) && !holes.some(hole => pointInPoly(hole, x, z)));
    if (attached) return;
  }
  const returnWall = !front && !long && Math.abs(normal.x * nx + normal.z * nz) < 0.2;
  if (returnWall && width < 1.95) {
    for (let floor = 0; floor < 4; floor++) {
      const y = base + 0.28 + floor * 2.65;
      if (surveyOpeningFits(wall, 0.11, 0.42, y, y + 1.96)) {
        surveyPanel(wall, 0.11, 0.42, y, y + 1.96, frame);
        surveyPanel(wall, 0.15, 0.38, y + 0.09, y + 0.63, blue, 0.044);
      }
    }
    return;
  }
  const portal = front && !long && width > 2.55 && high - base < 10.5;
  if (portal) {
    const u = width * 0.5, head = base + 2.24;
    surveyWindow(wall, u - 0.47, u + 0.47, base + 0.20, head, { frame: blue, rows: 2 });
    surveyPanel(wall, u - 0.42, u + 0.42, base + 0.24, base + 0.80, blue, 0.05);
    roofOverDoor(wall, 0.10, width - 0.10, head + 0.10);
  }
  for (let floor = portal ? 1 : 0; floor < 4; floor++) {
    const sill = base + 0.82 + floor * 2.70;
    const u = width * (long ? 0.34 : 0.50);
    const half = portal ? 0.30 : long ? 0.46 : Math.min(width * 0.32, 0.60);
    const head = sill + (portal ? 1.41 : 1.51);
    if (surveyWindow(wall, u - half, u + half, sill, head, { frame, columns: portal || long ? 1 : 2 })) {
      surveyPanel(wall, u - half - 0.03, u + half + 0.03, sill - 0.07, sill, frame, 0.07);
    }
  }
  if (portal) return 0xb39675;
}

export function buildRembrandtlaanLandmark(site) {
  return createSurveyLandmark(site, REMBRANDTLAAN_SURVEY, decorate, ({ group }) => {
    masonry ??= createFacadeSurfaceTexture().texture;
    const across = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
    const joints = texture(masonry, vec2(across.div(1.1), positionWorld.y.div(0.70))).r;
    const tone = mix(1, mix(0.86, 1.06, joints), normalWorld.y.abs().lessThan(0.14).toFloat());
    group.children[0].material.colorNode = vertexColor().mul(tone);
  });
}
