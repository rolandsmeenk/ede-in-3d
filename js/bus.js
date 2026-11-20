import * as THREE from 'three/webgpu';
import { cityUniforms } from './tsl-materials.js';
import {
  float,
  vec2,
  vec3,
  color,
  attribute,
  varying,
  vertexStage,
  atan,
  abs,
  fract,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  fwidth
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';
import { part, mirrorSection, roundedBox } from './vehicles.js';
import { CAR_PARTS, buildBodyLoft, carBodyHalfWidthAt } from './cars.js';

// A shared RRReis bus based on the MAN Lion's City 12 E LE. Body, trim and equipment
// share a mesh. Doors and lamps are shaded on the body, and destinations use a separate atlas.
const BUS_PARTS = {
  BODY: 0,
  TRIM: 1,
  POD: 2,
  FAIRING: 3
};

const BUS_SPEC = {
  name: 'bus',
  headlight: [0.91, 0.66],
  zFront: 5.9,
  zRear: -6.22,
  wheelRadius: 0.5,
  wheelZ: 3.0,
  wheelX: 1.12,
  archGap: 0.085,
  archFlare: 0.012,
  tuck: 0.035,
  stationStep: 0.92,
  lowerRound: 3.4,
  upperRound: 7.5,
  upperSamples: [0.35, 0.66, 0.89, 1],
  halfWidth: [[5.9, 1.275], [-6.22, 1.275]],
  sill: [[5.9, 0.35], [-6.22, 0.36]],
  shoulder: [[5.9, 0.98], [-6.22, 0.98]],
  edge: [[5.9, 2.94], [-6.22, 2.94]],
  crown: [[5.9, 0.04], [-6.22, 0.04]],
  tumble: [[5.9, 0.055], [-6.22, 0.055]],
  nose: { halfWidth: [0.28, 1.06, 2.2], edge: [0.23, 2.79, 2], crown: [0.26, 0.006, 2], sill: [0.08, 0.42, 2], shoulder: [0.2, 0.92, 2] },
  tail: { halfWidth: [0.22, 1.12, 2.2], edge: [0.2, 2.78, 2], crown: [0.2, 0.006, 2], sill: [0.1, 0.46, 2], shoulder: [0.18, 0.94, 2] },
  rake: 0.145,
  window: [1.04, 2.61],
  frontDoor: [4.13, 5.52],
  rearDoor: [-0.75, 0.62]
};

// Windshield & header rake at the nose (plus slight plan-view bow and upper-rear cap taper)
function busRake(y, z, x = 0) {
  const s = BUS_SPEC;
  const alongF = Math.min(1, Math.max(0, (z - (s.zFront - 1.15)) / 1.15));
  const upF = Math.min(1, Math.max(0, (y - 1.1) / 1.72));
  const noseBow = alongF * alongF * (0.028 * x * x + Math.max(0, 1.12 - y) * 0.035);
  const alongR = Math.min(1, Math.max(0, (s.zRear + 0.75 - z) / 0.75));
  const upR = Math.min(1, Math.max(0, (y - 1.38) / 1.5));
  const tailTaper = -0.055 * alongR * alongR * Math.pow(upR, 1.25);
  return s.rake * alongF * alongF * Math.pow(upF, 1.22) + noseBow + tailTaper;
}

function buildLoftedBusBodyGeometry() {
  const s = BUS_SPEC;
  const body = buildBodyLoft(s, 1);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setZ(i, z - busRake(y, z, x));
  }
  body.computeVertexNormals();
  const parts = [part(body, BUS_PARTS.BODY)];

  // The roof fairing covers the battery packs and climate equipment.
  const roofY = s.edge[0][1] + s.crown[0][1] - 0.03;
  const fairingStations = [
    [5.10, 0.89, 0.01, 0.005],
    [4.57, 1.09, 0.20, 0.03],
    [3.68, 1.13, 0.29, 0.045],
    [-0.30, 1.13, 0.29, 0.045],
    [-0.90, 1.12, 0.22, 0.04],
    [-5.38, 1.10, 0.22, 0.04],
    [-5.88, 0.94, 0.02, 0.008]
  ];
  const fairingSections = fairingStations.map(([z, hw, h, cr]) =>
    mirrorSection(
      [
        [hw, roofY],
        [hw - 0.035, roofY + h * 0.68],
        [hw - 0.12, roofY + h],
        [hw * 0.45, roofY + h + cr * 0.8]
      ],
      [0, roofY + h + cr],
      z
    )
  );
  parts.push(part(new LoftGeometry(fairingSections, { closed: false }), BUS_PARTS.FAIRING));

  // Recessed roof HVAC & battery cooling modules nested inside the roof shroud
  parts.push(part(roundedBox(0.88, 0.065, 2.5, 0.08, 0.025).translate(0, roofY + 0.22, -3.35), BUS_PARTS.POD));
  parts.push(part(roundedBox(0.84, 0.06, 2.7, 0.08, 0.025).translate(0, roofY + 0.27, 1.45), BUS_PARTS.POD));

  const zNose = s.zFront - busRake(0.40, s.zFront);
  parts.push(part(roundedBox(1.10, 0.067, 0.13, 0.048, 0.018).translate(0, 0.39, zNose - 0.075), BUS_PARTS.TRIM));
  parts.push(part(roundedBox(1.11, 0.071, 0.12, 0.05, 0.018).translate(0, 0.42, s.zRear + 0.045), BUS_PARTS.TRIM));

  // Tall boarding-side mirror and lower driver-side mirror.
  for (const side of [-1, 1]) {
    const mountY = side < 0 ? 2.48 : 2.16;
    const headY = side < 0 ? 2.28 : 1.98;
    const stalk = new THREE.BoxGeometry(0.036, 0.036, 0.44)
      .rotateX(0.32)
      .rotateY(side * 0.42)
      .translate(side * 1.27, mountY - 0.06, s.zFront - 0.06);
    const head = roundedBox(0.072, 0.19, 0.055, 0.026, 0.01).translate(side * 1.37, headY, s.zFront + 0.08);
    parts.push(part(stalk, BUS_PARTS.TRIM), part(head, BUS_PARTS.TRIM));
  }

  // Enclosed 3D wheel-well housings (inward-facing arch ceiling + double-sided back liner) so no gap shows around the wheels
  const wellR = s.wheelRadius + s.archGap + 0.008;
  const wellDepth = 0.36;
  for (const side of [-1, 1]) {
    for (const z of [-s.wheelZ, s.wheelZ]) {
      const cyl = new THREE.CylinderGeometry(wellR, wellR, wellDepth, 10, 1, true, -0.28, Math.PI + 0.56)
        .scale(-1, 1, 1)
        .rotateZ(-Math.PI * 0.5)
        .translate(side * (s.wheelX - 0.02), s.wheelRadius, z);
      const backOut = new THREE.CircleGeometry(wellR, 10, -0.28, Math.PI + 0.56)
        .rotateY(side * Math.PI * 0.5)
        .translate(side * (s.wheelX - 0.19), s.wheelRadius, z);
      const backIn = new THREE.CircleGeometry(wellR, 10, -0.28, Math.PI + 0.56)
        .rotateY(-side * Math.PI * 0.5)
        .translate(side * (s.wheelX - 0.19), s.wheelRadius, z);
      parts.push(part(cyl, BUS_PARTS.TRIM), part(backOut, BUS_PARTS.TRIM), part(backIn, BUS_PARTS.TRIM));
    }
  }
  return mergeGeometries(parts);
}

/**
 * Destination sign panels for the bus's sign texture (route badge + destination): above the windshield, on the curb
 * side behind the front door, and the route number box on the upper-right rear cap. Same object space as the bus body.
 */
function buildBusSignGeometry() {
  const s = BUS_SPEC;
  const panels = [];
  const yF = 2.56;
  const front = new THREE.PlaneGeometry(1.90, 0.28, 8);
  const face = front.getAttribute('position');
  for (let i = 0; i < face.count; i++) {
    const y = face.getY(i) + yF;
    face.setY(i, y);
    face.setZ(i, s.zFront - busRake(y, s.zFront, face.getX(i)) + 0.011);
  }
  front.computeVertexNormals();
  panels.push(front);
  const sideZ = 3.55;
  const sideY = 2.37;
  const side = new THREE.PlaneGeometry(1.08, 0.19).rotateY(-Math.PI / 2);
  side.translate(-(carBodyHalfWidthAt(s, sideZ, sideY) + 0.007), sideY, sideZ);
  panels.push(side);
  const yR = 2.51;
  const zR0 = s.zRear - busRake(yR - 0.1, s.zRear);
  const zR1 = s.zRear - busRake(yR + 0.1, s.zRear);
  const rear = new THREE.PlaneGeometry(0.52, 0.21);
  const uv = rear.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.245);
  rear.rotateY(Math.PI);
  rear.rotateX(Math.atan2(zR1 - zR0, 0.2));
  rear.translate(0, yR, (zR0 + zR1) * 0.5 - 0.012);
  panels.push(rear);
  return mergeGeometries(panels);
}

// Heavy-duty 22.5" transit bus wheel: tall 305/70R22.5 tyre sidewall with deep-dish white/silver steel wheel,
// 10 lug nuts, 5 hand-hole cutouts, and a protruding cast-iron axle hub (spins about x, centred on the origin)
function buildBusWheelGeo(side) {
  const r = BUS_SPEC.wheelRadius;
  const w = 0.3;
  const rimR = r * 0.59;
  const tyre = new THREE.LatheGeometry(
    [
      new THREE.Vector2(rimR, -w * 0.48),
      new THREE.Vector2(r * 0.95, -w * 0.44),
      new THREE.Vector2(r, -w * 0.28),
      new THREE.Vector2(r, w * 0.28),
      new THREE.Vector2(r * 0.95, w * 0.44),
      new THREE.Vector2(rimR, w * 0.48)
    ],
    22
  );
  const disc = new THREE.LatheGeometry(
    [
      new THREE.Vector2(rimR, w * 0.48),
      new THREE.Vector2(rimR * 0.92, w * 0.42),
      new THREE.Vector2(rimR * 0.72, w * 0.18),
      new THREE.Vector2(0.115, w * 0.22)
    ],
    22
  );
  const backDisc = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, -w * 0.18),
      new THREE.Vector2(rimR * 0.75, -w * 0.18),
      new THREE.Vector2(rimR, -w * 0.48)
    ],
    14
  );
  const cap = new THREE.CylinderGeometry(0.095, 0.118, 0.13, 14).translate(0, w * 0.26, 0);
  const parts = [
    part(tyre, CAR_PARTS.TYRE),
    part(disc, CAR_PARTS.ALLOY),
    part(backDisc, CAR_PARTS.ALLOY),
    part(cap, CAR_PARTS.ALLOY)
  ];
  for (const g of parts) g.rotateZ(-side * Math.PI * 0.5);
  return mergeGeometries(parts);
}

let _busWheelMat = null;

function createBusWheelMaterial() {
  if (_busWheelMat) return _busWheelMat;
  const p = attribute('position', 'vec3');
  const partId = attribute('partId', 'float');
  const isTyre = step(abs(partId.sub(CAR_PARTS.TYRE)), 0.25);
  const radial = length(vec2(p.z, p.y));
  const theta = atan(p.y, p.z);
  // Footprints across the wheel's rings (radial) and around it (tangential), from the per-axis footprint in the (z, y)
  // wheel plane, so the disc stays sharp when it is seen at a grazing angle
  const fwZY = max(vec2(fwidth(p.z), fwidth(p.y)), vec2(0.0015)).toVar();
  const radDir = vec2(p.z, p.y).div(max(radial, 0.0001));
  const fwRing = abs(radDir.x).mul(fwZY.x).add(abs(radDir.y).mul(fwZY.y));
  const fwTan = abs(radDir.y).mul(fwZY.x).add(abs(radDir.x).mul(fwZY.y));
  const fwRound = max(fwRing, fwTan);
  const covAt = (r, d, w) => clamp(float(0.5).sub(d.sub(r).div(w)), 0.0, 1.0);
  // Exact box filter of a band |d| < h, so the thin rings narrow and lighten smoothly instead of fading out
  const band = (d, h, w) => clamp(min(d.add(h), w.mul(0.5)).sub(max(d.sub(h), w.mul(-0.5))).div(w), 0.0, 1.0);
  const detailFade = (w) => smoothstep(0.036, 0.008, w);

  // Fold 10 lug nuts & orange safety indicators into a single angular sector, anti-aliased and faded
  const a10 = fract(theta.mul(1.5915494).add(0.5)).sub(0.5).mul(0.6283185);
  const lugArc = radial.mul(a10);
  const dLug = length(vec2(radial.sub(0.175), lugArc));
  const lugs = covAt(0.015, dLug, fwRound).mul(detailFade(fwRound));
  const dTag = length(vec2(radial.sub(0.192), lugArc));
  const indicators = covAt(0.011, dTag, fwRound)
    .mul(float(1.0).sub(covAt(0.009, dLug, fwRound)))
    .mul(detailFade(fwRound));

  // Fold 5 hand-hole cutouts into a single angular sector, anti-aliased
  const a5 = fract(theta.sub(0.31).mul(0.7957747).add(0.5)).sub(0.5).mul(1.256637);
  const dVent = length(vec2(radial.sub(0.238), radial.mul(a5).mul(0.85)));
  const vents = covAt(0.03, dVent, fwRound).mul(smoothstep(0.06, 0.015, fwRound));

  const rimLip = band(radial.sub(0.282), 0.008, fwRing);
  const dishShade = smoothstep(0.16, 0.27, radial).mul(0.22).add(0.78);
  const steelBase = color(0xdce2e8).mul(dishShade).mul(float(1.0).sub(rimLip.mul(0.35)));
  const withVents = mix(steelBase, color(0x101317), vents.mul(0.92));
  const withHub = mix(withVents, color(0x22262b), covAt(0.115, radial, fwRing));
  const hubCapCenter = mix(withHub, color(0x3a4048), covAt(0.068, radial, fwRing));
  const withIndicators = mix(hubCapCenter, color(0xe84818), indicators.mul(0.85));
  const disc = mix(withIndicators, color(0x1e2228), lugs.mul(0.88));

  const scuffRib = band(radial.sub(0.41), 0.008, fwRing).mul(0.06);
  const sidewall = smoothstep(0.295, 0.36, radial).mul(float(1.0).sub(smoothstep(0.44, 0.495, radial).mul(0.22))).mul(0.28).add(0.72).add(scuffRib);
  const tread = smoothstep(0.38, 0.52, fract(theta.mul(7.64))).mul(smoothstep(0.45, 0.48, radial)).mul(detailFade(fwTan)).mul(0.07);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = mix(disc, color(0x16181b).mul(sidewall.add(tread)), isTyre);
  mat.roughnessNode = mix(mix(float(0.32), float(0.78), max(vents, smoothstep(0.12, 0.1, radial))), float(0.86), isTyre);
  mat.metalnessNode = mix(mix(float(0.55), float(0.15), vents), float(0.02), isTyre);
  _busWheelMat = mat;
  return mat;
}

let _busLoftedMat = null;

// Shared bus material. The fourth instance channel selects regular or comfortRRReis paint.
function createLoftedBusMaterial() {
  if (_busLoftedMat) return _busLoftedMat;
  const s = BUS_SPEC;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const state = attribute('busState', 'vec4');
  const isBody = step(abs(partId.sub(BUS_PARTS.BODY)), 0.25);
  const isTrim = step(abs(partId.sub(BUS_PARTS.TRIM)), 0.25);
  const isPod = step(abs(partId.sub(BUS_PARTS.POD)), 0.25);
  const isFairing = step(abs(partId.sub(BUS_PARTS.FAIRING)), 0.25);
  const isSkin = max(isBody, isFairing);
  const ax = abs(p.x);
  const az = abs(p.z);
  const one = float(1.0);

  // Per-axis screen footprint of the object-space position and its reciprocals (division-free analytic box-filter AA).
  // Each edge uses the footprint across itself and ramps over one footprint, so the long horizontal livery lines and
  // window edges stay sharp when the side is seen at a grazing angle (anisotropic filtering).
  const fwp = max(fwidth(p), vec3(0.0015)).toVar();
  const fwX = fwp.x;
  const fwY = fwp.y;
  const fwZ = fwp.z;
  const invX = float(1.0).div(fwX).toVar();
  const invY = float(1.0).div(fwY).toVar();
  const invZ = float(1.0).div(fwZ).toVar();
  const invXY = float(1.0).div(max(fwX, fwY)).toVar(); // small round features on the front & rear faces
  const invZY = float(1.0).div(max(fwZ, fwY)).toVar(); // ... and on the sides
  const cov = (d, inv) => clamp(float(0.5).sub(d.mul(inv)), 0.0, 1.0);
  const covAt = (r, d, inv) => clamp(float(0.5).sub(d.sub(r).mul(inv)), 0.0, 1.0);
  const covUp = (r, d, inv) => clamp(float(0.5).add(d.sub(r).mul(inv)), 0.0, 1.0);
  // Exact box filter of a band |d| < h: thin lines narrow and lighten smoothly below a pixel instead of fading out
  const band = (d, h, inv) => {
    const half = float(0.5).div(inv);
    return clamp(min(d.add(h), half).sub(max(d.sub(h), half.negate())).mul(inv), 0.0, 1.0);
  };
  const detailFade = (w) => smoothstep(0.055, 0.014, w);
  const fineFade = (w) => smoothstep(0.028, 0.007, w);

  // Box / rounded-box distances with the reciprocal footprint across their nearest edge (the dominant axis), given
  // the reciprocal footprints (ix, iy) of the two coordinates
  const boxEdge = (dx, dy, hx, hy, ix, iy) => {
    const ex = abs(dx).sub(hx);
    const ey = abs(dy).sub(hy);
    return { d: max(ex, ey), inv: mix(iy, ix, step(ey, ex)) };
  };
  const boxMask = (dx, dy, hx, hy, ix, iy) => {
    const e = boxEdge(dx, dy, hx, hy, ix, iy);
    return cov(e.d, e.inv);
  };
  const rBoxEdge = (dx, dy, hx, hy, r, ix, iy) => {
    const ex = abs(dx).sub(hx - r);
    const ey = abs(dy).sub(hy - r);
    return {
      d: length(vec2(max(ex, 0.0), max(ey, 0.0))).add(min(max(ex, ey), 0.0)).sub(r),
      inv: mix(iy, ix, step(ey, ex))
    };
  };

  const isComfort = varying(vertexStage(state.w));

  const front = smoothstep(0.15, 0.42, n.z).mul(smoothstep(s.zFront - 0.98, s.zFront - 0.9, p.z)).mul(isBody);
  const rear = smoothstep(0.15, 0.42, n.z.negate()).mul(smoothstep(s.zRear + 0.98, s.zRear + 0.9, p.z)).mul(isBody);
  const side = smoothstep(0.45, 0.72, abs(n.x)).mul(isSkin);
  const curb = step(p.x, 0.0);

  // A continuous windshield sits between the destination display and the black nose panel.
  const frontMaskEdge = rBoxEdge(p.x, p.y.sub(1.94), 1.20, 0.8, 0.13, invX, invY);
  const frontMask = cov(frontMaskEdge.d, frontMaskEdge.inv).mul(front);
  const frontGlassOuter = rBoxEdge(p.x, p.y.sub(1.77), 1.11, 0.59, 0.11, invX, invY);
  const wiperY = p.y.sub(1.29).sub(ax.mul(0.09));
  const wipers = band(wiperY, 0.012, invY).mul(boxMask(ax.sub(0.52), p.y.sub(1.34), 0.41, 0.14, invX, invY));
  const frontGlass = cov(frontGlassOuter.d, frontGlassOuter.inv).mul(front).mul(one.sub(wipers.mul(0.93)));
  const signBand = boxMask(p.x, p.y.sub(2.56), 1.00, 0.165, invX, invY).mul(front);

  const rearSignBox = boxMask(p.x, p.y.sub(2.51), 0.30, 0.14, invX, invY).mul(rear);
  const backWindow = rBoxEdge(p.x, p.y.sub(2.23), 1.04, 0.41, 0.11, invX, invY);
  const rearGlass = cov(backWindow.d, backWindow.inv).mul(rear).mul(one.sub(rearSignBox));
  const rearSeam = max(
    band(p.y.sub(1.42), 0.008, invY).mul(smoothstep(0.95, 0.93, ax)),
    band(ax.sub(0.92), 0.008, invX).mul(smoothstep(0.58, 0.62, p.y)).mul(smoothstep(2.77, 2.73, p.y))
  ).mul(rear);
  const highBrake = boxMask(p.x, p.y.sub(1.48), 0.2, 0.018, invX, invY).mul(rear);

  // Side rear-corner radiator & exhaust louvers
  const sideRearGrille = max(
    boxMask(p.z.sub(s.zRear + 0.52), p.y.sub(0.88), 0.38, 0.3, invZ, invY),
    boxMask(p.z.sub(s.zRear + 0.48), p.y.sub(2.62), 0.26, 0.13, invZ, invY)
  ).mul(side);
  const slats = mix(
    float(0.56),
    smoothstep(0.38, 0.52, fract(p.y.mul(18.0))).mul(0.5).add(0.3),
    fineFade(fwY)
  );

  // The passenger window band and twin low-entry doors have separate black frames.
  const [wy0, wy1] = s.window;
  const winMid = (wy0 + wy1) / 2;
  const winHalf = (wy1 - wy0) / 2;
  const sideWin = rBoxEdge(p.z.add(0.78), p.y.sub(winMid), 4.92, winHalf, 0.065, invZ, invY);
  const sideBand = cov(sideWin.d, sideWin.inv).mul(side);
  const sideSeal = covAt(0.044, sideWin.d, sideWin.inv).mul(side);
  // Mullions and stanchions repeat every 1 / 0.76 m along z: filter in that repeat's units
  const invZRepeat = invZ.div(0.76);
  const mullion = one.sub(band(fract(p.z.mul(0.76).add(0.18)).sub(0.5), 0.038, invZRepeat));
  const sideSignCutout = one.sub(boxMask(p.z.sub(3.55), p.y.sub(2.37), 0.56, 0.11, invZ, invY).mul(curb));
  const drvWin = boxEdge(p.z.sub(4.92), p.y.sub(winMid + 0.02), 0.52, winHalf, invZ, invY);
  const driverSeal = covAt(0.044, drvWin.d, drvWin.inv).mul(side).mul(one.sub(curb));
  const driverWin = cov(drvWin.d, drvWin.inv)
    .mul(covUp(0.02, abs(p.z.sub(4.92)), invZ))
    .mul(side)
    .mul(one.sub(curb));

  const doorSide = side.mul(curb);
  let doorFrame = float(0), doorGlass = float(0);
  for (const [rearEdge, frontEdge] of [s.frontDoor, s.rearDoor]) {
    const half = (frontEdge - rearEdge) / 2;
    const dzDoor = abs(p.z.sub((rearEdge + frontEdge) / 2));
    doorFrame = max(doorFrame, boxMask(dzDoor, p.y.sub(1.47), half, 1.06, invZ, invY));
    const pane = boxMask(abs(dzDoor.sub(half / 2)), p.y.sub(1.51), half / 2 - 0.049, 0.91, invZ, invY)
      .mul(one.sub(band(p.y.sub(1.05), 0.019, invY)));
    doorGlass = max(doorGlass, pane);
  }
  doorFrame = doorFrame.mul(doorSide);
  doorGlass = doorGlass.mul(doorSide);
  const sideGlassPanes = sideBand.mul(mullion).mul(sideSignCutout).mul(one.sub(doorFrame));
  const glass = max(max(frontGlass, rearGlass), max(max(sideGlassPanes, driverWin), doorGlass));
  const seal = max(max(frontMask, rearSignBox), max(max(sideSeal, driverSeal), max(signBand, doorFrame)));

  // Black rubber wheel-arch fender flares (folded front/rear via az = abs(p.z) into 1 length() call, extending straight down to the 0.35 sill)
  const archR = s.wheelRadius + s.archGap;
  const archVec = vec2(az.sub(s.wheelZ), max(float(0.0), p.y.sub(s.wheelRadius)));
  const dArch = length(archVec);
  const archDir = archVec.div(max(dArch, 0.0001));
  const invArch = float(1.0).div(max(abs(archDir.x).mul(fwZ).add(abs(archDir.y).mul(fwY)), 0.0005));
  const archFlareMask = band(dArch.sub(archR + 0.0225), 0.0325, invArch)
    .mul(covUp(0.35, p.y, invY))
    .mul(side);

  // 4. RRReis white fleet paint and the larger comfortRRReis gradient panels.
  const white = color(0xf5f5f4);
  const violet = color(0x4f287b);
  const blue = color(0x0086d6);
  const green = color(0x00965e);

  const dot = (z, y, radius) => covAt(radius, length(vec2(p.z.sub(z), p.y.sub(y))), invZY);
  const stripeY = p.y.sub(p.z.add(5.05).mul(0.11).add(0.83));
  const stripeInv = float(1.0).div(fwY.add(fwZ.mul(0.11)));
  const link = band(stripeY, 0.045, stripeInv)
    .mul(covUp(-5.05, p.z, invZ)).mul(covAt(-2.64, p.z, invZ));
  const rearDots = mix(violet, blue, smoothstep(-4.8, -4.25, p.z));
  const accent = mix(rearDots, green, smoothstep(-3.6, -2.95, p.z));
  const rearMarks = max(link, max(dot(-5.05, 0.83, 0.28),
    max(dot(-4.04, 0.96, 0.22), dot(-2.64, 1.095, 0.27))));
  const regular = mix(mix(white, accent, rearMarks.mul(side)), blue, dot(2.35, 0.96, 0.13).mul(side));

  const comfortProgress = float(2.0).sub(p.z).add(float(1.55).sub(p.y).mul(0.7)).div(8.3);
  const comfortColor = mix(mix(violet, blue, smoothstep(0.18, 0.58, comfortProgress)),
    green, smoothstep(0.58, 0.88, comfortProgress));
  const sidePanel = rBoxEdge(p.z.add(2.15), p.y.sub(1.57), 3.92, 1.02, 0.46, invZ, invY);
  const rearPanel = rBoxEdge(p.x, p.y.sub(1.42), 1.27, 0.93, 0.23, invX, invY);
  const panels = max(cov(sidePanel.d, sidePanel.inv).mul(side), cov(rearPanel.d, rearPanel.inv).mul(rear));
  const comfort = mix(white, comfortColor, panels);

  const skirt = covAt(0.415, p.y, invY);
  const shadeY = smoothstep(0.34, 1.25, p.y).mul(0.16).add(0.84);
  const livery = mix(mix(regular, comfort, isComfort), color(0x181c22), skirt).mul(shadeY);

  const wheelchairBadge = boxMask(p.z.sub(5.60), p.y.sub(0.93), 0.065, 0.075, invZ, invY).mul(doorSide);
  const frontPlate = boxMask(p.x, p.y.sub(0.52), 0.26, 0.055, invX, invY).mul(front);
  const rearPlateEdge = boxEdge(p.x, p.y.sub(0.66), 0.26, 0.055, invX, invY);
  const rearPlate = cov(rearPlateEdge.d, rearPlateEdge.inv).mul(rear);
  const rearPlateRecess = covAt(0.036, rearPlateEdge.d, rearPlateEdge.inv).mul(rear);
  const plate = max(frontPlate, rearPlate);
  const plateText = mix(float(0.55), smoothstep(0.35, 0.55, fract(p.x.mul(27.0))), fineFade(fwX))
    .mul(max(band(p.y.sub(0.66), 0.034, invY), band(p.y.sub(0.52), 0.034, invY)));
  const plateBand = boxMask(p.x.add(0.225), p.y.sub(0.52), 0.027, 0.052, invX, invY).mul(front)
    .add(boxMask(p.x.sub(0.225), p.y.sub(0.66), 0.027, 0.052, invX, invY).mul(rear));

  const nose = rBoxEdge(p.x, p.y.sub(0.76), 1.16, 0.15, 0.12, invX, invY);
  const nosePanel = cov(nose.d, nose.inv).mul(front);
  const [lampX, lampY] = s.headlight;
  const lampTiltY = p.y.sub(float(lampY).add(ax.sub(lampX).mul(0.23)));
  const lampHousing = rBoxEdge(ax.sub(lampX), lampTiltY, 0.225, 0.057, 0.025, invX, invY);
  const pod = cov(lampHousing.d, lampHousing.inv).mul(front);
  const headLamp = covAt(0.030, length(vec2(min(abs(ax.sub(0.88)), abs(ax.sub(0.97))), lampTiltY)), invXY).mul(pod);
  const drlStrip = band(lampTiltY.add(0.031), 0.009, invY).mul(pod);
  const turnFront = boxMask(ax.sub(1.042), lampTiltY.sub(0.01), 0.04, 0.014, invX, invY).mul(pod);

  // Slim vertical lamps follow the outer corners of the rear fascia.
  const rearBezel = boxMask(ax.sub(1.10), p.y.sub(1.03), 0.044, 0.31, invX, invY).mul(rear);
  const tailLamp = boxMask(ax.sub(1.10), p.y.sub(1.10), 0.025, 0.21, invX, invY).mul(rearBezel);
  const turnRear = boxMask(ax.sub(1.10), p.y.sub(0.84), 0.026, 0.034, invX, invY).mul(rearBezel);
  const reverse = boxMask(ax.sub(1.10), p.y.sub(0.77), 0.026, 0.027, invX, invY).mul(rearBezel);
  const rearLens = max(tailLamp, max(turnRear, reverse));
  const sideMarkers = covAt(0.025, length(vec2(az.sub(s.wheelZ + 0.68), p.y.sub(1.02))), invZY).mul(side);

  // 6. Tinted window glass with interior passenger seats, yellow vertical grab stanchions & ceiling light strip
  const skyGrad = clamp(p.y.sub(1.22).mul(0.85), 0.0, 1.0);
  const seatBack = smoothstep(1.64, 1.54, p.y)
    .mul(smoothstep(0.1, 0.2, abs(fract(p.z.mul(1.15)).sub(0.5))))
    .mul(smoothstep(3.85, 3.75, p.z));
  const grabRail = band(fract(p.z.mul(0.76).add(0.5)).sub(0.5), 0.026, invZRepeat).mul(smoothstep(2.3, 2.26, p.y));
  const frontInterior = smoothstep(1.62, 1.3, p.y).mul(smoothstep(0.15, 0.35, ax)).mul(front);
  const ceilingStrip = smoothstep(2.12, 2.32, p.y).mul(smoothstep(4.45, 4.35, p.z));
  const baseGlass = mix(color(0x0f1c2b), color(0x1f3852), skyGrad);
  const withSeats = mix(baseGlass, color(0x0a1524), max(seatBack.mul(0.68), frontInterior.mul(0.45)));
  const withRails = mix(withSeats, color(0xb8921c), grabRail.mul(side).mul(0.5));
  const glassTint = mix(withRails, color(0x324d66), ceilingStrip.mul(0.28));

  // Composite body surface
  let body = mix(livery, color(0x12161b), max(seal, max(archFlareMask, max(rearSeam, rearPlateRecess))));
  body = mix(body, color(0x181c22).mul(slats), sideRearGrille);
  body = mix(body, color(0x171b20), nosePanel);
  body = mix(body, color(0x1258b8), wheelchairBadge);
  body = mix(body, color(0x12151a), max(pod, rearBezel));
  body = mix(body, color(0xf2f8ff), max(headLamp, drlStrip));
  body = mix(body, color(0xff9d14), max(turnFront, sideMarkers));
  body = mix(body, color(0x9e0e16), max(tailLamp, highBrake));
  body = mix(body, color(0xd86e18), turnRear);
  body = mix(body, color(0xe8eef4), reverse);
  body = mix(body, mix(color(0xf2b518), color(0x182648), plateText.mul(0.65)), plate);
  body = mix(body, color(0x154795), plateBand);
  body = mix(body, glassTint, glass);

  const col = mix(mix(body, color(0x191d22), isTrim), color(0xd0d5dc), isPod);

  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = col;
  mat.roughnessNode = mix(
    mix(
      mix(float(0.16), float(0.06), max(glass, max(headLamp, rearLens))),
      float(0.68),
      max(isTrim, max(archFlareMask, seal.mul(one.sub(glass))))
    ),
    float(0.36),
    isPod
  );
  mat.metalnessNode = mix(mix(float(0.24), float(0.82), glass), float(0.06), max(isTrim, isPod));

  const brake = state.x;
  const blink = max(state.y.mul(step(0.0, p.x)), state.z.mul(step(p.x, 0.0)));
  const night = smoothstep(0.55, 1.15, cityUniforms.uInteriorGlow);
  const cabinGlow = glass
    .mul(side)
    .mul(ceilingStrip.mul(0.55).add(float(0.18)).sub(seatBack.mul(0.12)).add(grabRail.mul(0.15)))
    .mul(night);
  // Headlamps & DRL blades are visibly lit at all times of day (crossing bloom slightly in daylight, full beam at night)
  const headEmit = pod
    .mul(mix(float(0.25), float(0.42), night))
    .add(drlStrip.mul(mix(float(1.75), float(2.3), night)))
    .add(headLamp.mul(mix(float(2.45), float(3.2), night)));
  mat.emissiveNode = color(0xe8f4ff)
    .mul(headEmit)
    .add(color(0xfff0d4).mul(cabinGlow))
    .add(color(0xff9210).mul(sideMarkers.mul(mix(float(0.65), float(1.15), night))))
    .add(color(0xff9a14).mul(max(turnFront, turnRear).mul(blink).mul(2.2)))
    .add(color(0xff0c14).mul(tailLamp.mul(brake.mul(1.6).add(0.75)).add(highBrake.mul(brake.mul(1.8)))));

  _busLoftedMat = mat;
  return mat;
}

export {
  BUS_SPEC,
  buildLoftedBusBodyGeometry,
  buildBusSignGeometry,
  buildBusWheelGeo,
  createBusWheelMaterial,
  createLoftedBusMaterial
};
