import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAIN_CONSISTS } from './ede-train-traffic.js';

const NS_BLUE = 0x003082;
const NS_YELLOW = 0xffc917;
const UNDERFRAME = 0x383d43;
const RUBBER = 0x242b30;
const GLASS = 0x223847;
const GLASS_REFLECTION = 0x5b8195;
const STEEL = 0x737d85;
const WHEEL_RADIUS = 0.445;
const HALF_GAUGE = 1.435 / 2;

// Side outline from the underfloor skirt, over the window band, to the roof.
const SECTION = [[0, .74], [.08, .87], [.18, .97], [.35, 1], [.65, 1],
  [.78, .98], [.86, .94], [.93, .85], [.98, .64], [1, .40]];

const profiles = {
  intercity: {
    width: 1.49, floor: .76, roof: 4.61, body: NS_YELLOW, roofColor: 0x686c6d, door: NS_BLUE,
    bands: [[.165, .81, NS_BLUE]], windows: [[.236, .388], [.625, .774]],
    doorWidth: 1.36, doorTop: .65, doorInset: 1.78, cabDoorInset: 3.78,
    nose: { length: 3.35, taper: .22, drop: .18, rake: 1.02, wrap: .51, glass: [.52, .83] }
  },
  sprinter: {
    width: 1.44, floor: .65, roof: 4.03, body: 0xf1f4f5, roofColor: 0x435364, door: NS_BLUE,
    bands: [[.405, .785, NS_BLUE]], windows: [[.48, .722]],
    doorWidth: 1.65, doorTop: .72, doorInset: 2.10, cabDoorInset: 3.32, cabPaint: NS_YELLOW,
    nose: { length: 2.80, taper: .26, drop: .19, rake: 1.12, wrap: .50, glass: [.49, .865] }
  },
  rs34: {
    width: 1.43, floor: .62, roof: 4.04, body: 0xf1f4f3, roofColor: 0x414b55, door: 0x1274ad,
    bands: [[.12, .35, 0x166eaa], [.43, .78, 0x243a4c]], windows: [[.49, .735]],
    doorWidth: 1.45, doorTop: .73, doorInset: 1.90, cabDoorInset: 3.46, cabPaint: 0x0874bb,
    nose: { length: 3.20, taper: .29, drop: .18, rake: 1.25, wrap: .59, glass: [.44, .87] }
  },
  international: {
    width: 1.47, floor: .64, roof: 3.88, body: 0xeef1f1, roofColor: 0xa6adb1, door: 0xe0e6e8,
    bands: [[.334, .414, 0xd22032]], windows: [[.51, .717]],
    doorWidth: .92, doorTop: .735, doorInset: 1.57, cabDoorInset: 5.36,
    nose: { length: 5.60, taper: .53, drop: .36, rake: 2.16, wrap: .90, glass: [.54, .93] }
  },
  nightjet: {
    width: 1.45, floor: .79, roof: 4.16, body: 0x233b63, roofColor: 0x313e50, door: 0x395377,
    bands: [[.05, .165, 0x981d37]], windows: [[.497, .716]],
    doorWidth: .85, doorTop: .76, doorInset: 1.58, cabDoorInset: 3.62,
    nose: { length: 1.88, taper: .13, drop: .09, rake: .63, wrap: .37, glass: [.55, .825] },
    controlNose: { length: 2.75, taper: .28, drop: .19, rake: 1.04, wrap: .49, glass: [.52, .86] }
  }
};

function sectionWidth(height) {
  for (let i = 1; i < SECTION.length; i++) {
    const [hi, right] = SECTION[i];
    if (height > hi) continue;
    const [lo, left] = SECTION[i - 1];
    return THREE.MathUtils.lerp(left, right, (height - lo) / (hi - lo));
  }
  return SECTION.at(-1)[1];
}

function carriageGeometry(type, length, profile, cab) {
  const { width, floor, roof, bands, windows, body, roofColor, door, doorWidth, doorTop, doorInset, cabDoorInset } = profile;
  const nose = cab === 'rear' ? profile.controlNose ?? profile.nose : profile.nose;
  const locomotive = type === 'nightjet' && cab === 'front';
  const end = length / 2;
  const start = -end + .10, finish = end - .16;
  const parts = [];

  function paint(geometry, tint, lit = false) {
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const glow = new Float32Array(colors.length);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      color.set(typeof tint === 'function' ? tint(position.getY(i)) : tint).toArray(colors, i * 3);
      if (lit) color.toArray(glow, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('trainGlow', new THREE.BufferAttribute(glow, 3));
    if (!geometry.attributes.uv) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(position.count * 2), 2));
    }
    parts.push(geometry);
  }

  function grid(rows, columns, point, tint, flip = false, lit = false) {
    const positions = [], indices = [];
    for (let v = 0; v <= rows; v++) {
      for (let u = 0; u <= columns; u++) {
        positions.push(...point(u / columns, v / rows));
        if (!u || !v) continue;
        const d = v * (columns + 1) + u, c = d - 1, b = d - columns - 1, a = b - 1;
        if (flip) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
    const mesh = new THREE.BufferGeometry();
    mesh.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mesh.setIndex(indices);
    mesh.computeVertexNormals();
    paint(mesh, tint, lit);
  }

  const noseAmount = z => cab ? THREE.MathUtils.clamp(1 - (z - start) / nose.length, 0, 1) : 0;
  function shell(x, h, z, offset = 0) {
    const n = noseAmount(z);
    const narrow = 1 - nose.taper * n ** 1.35;
    return [
      x * (width * sectionWidth(h) * narrow + offset),
      floor + (roof - floor) * (h - nose.drop * n * h ** 2),
      z + n * (nose.rake * h ** 1.6 + nose.wrap * x * x)
    ];
  }

  const noseStations = cab ? [start, start + nose.length * .19, start + nose.length * .45,
    start + nose.length * .72, start + nose.length] : [start];
  const stations = [...noseStations, finish];
  const heights = [...new Set([...SECTION.map(([h]) => h), .86, ...bands.flatMap(([lo, hi]) => [lo, hi])])]
    .sort((a, b) => a - b);
  for (let i = 1; i < heights.length; i++) {
    const lo = heights[i - 1], hi = heights[i], middle = (lo + hi) / 2;
    const shade = middle > .86 ? roofColor : bands.find(([min, max]) => min <= middle && middle <= max)?.[2] ?? body;
    for (let j = 1; j < stations.length; j++) {
      const z0 = stations[j - 1], z1 = stations[j];
      const color = profile.cabPaint && cab && z1 <= start + nose.length && middle <= .86 ? profile.cabPaint : shade;
      for (const side of [-1, 1]) {
        grid(1, 1, (u, v) => shell(side, THREE.MathUtils.lerp(lo, hi, v), THREE.MathUtils.lerp(z0, z1, u)),
          color, side === 1);
      }
    }
  }
  for (let i = 1; i < stations.length; i++) {
    const z0 = stations[i - 1], z1 = stations[i];
    grid(1, 4, (u, v) => shell(u * 2 - 1, 1, THREE.MathUtils.lerp(z0, z1, v)), roofColor, true);
    grid(1, 1, (u, v) => shell(u * 2 - 1, 0, THREE.MathUtils.lerp(z0, z1, v)), UNDERFRAME);
  }
  for (const z of [start, finish]) {
    for (let i = 1; i < heights.length; i++) {
      const lo = heights[i - 1], hi = heights[i];
      const face = lo >= .86 ? roofColor : z === start && cab ? profile.cabPaint ?? body : body;
      grid(1, 8, (u, v) => shell(u * 2 - 1, THREE.MathUtils.lerp(lo, hi, v), z), face, z === start);
    }
  }

  function box(w, h, d, x, y, z, tint) {
    paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), tint);
  }
  function rod(from, to, radius, tint) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const axis = b.clone().sub(a);
    paint(new THREE.CylinderGeometry(radius, radius, axis.length(), 6)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()))
      .translate(...a.add(b).multiplyScalar(.5).toArray()), tint);
  }
  // Side glazing hugs the modeled shell. The chamfered corners also keep door and window frames separate.
  function panel(side, z, depth, low, high, tint, offset = .009, corner = .07) {
    const half = depth / 2;
    const r = Math.min(corner, half - .001);
    const dy = Math.min(.032, (high - low) * .22);
    const chamfer = h => r * Math.max(0, 1 - Math.min(h - low, high - h) / dy);
    const edgeHeights = [...new Set([low, low + dy, high - dy, high,
      ...SECTION.map(([h]) => h).filter(h => low < h && h < high)])].sort((a, b) => a - b);
    for (let i = 1; i < edgeHeights.length; i++) {
      const bottom = edgeHeights[i - 1], top = edgeHeights[i];
      grid(1, 1, (u, v) => {
        const h = THREE.MathUtils.lerp(bottom, top, v);
        return shell(side, h, z + (u * 2 - 1) * (half - chamfer(h)), offset);
      }, tint, side === 1);
    }
  }
  const glassShade = y => y > floor + (roof - floor) * .675 ? GLASS_REFLECTION : GLASS;
  const windowsOnSide = locomotive ? [] : windows;
  const doorsAt = locomotive ? [] : [-end + (cab ? cabDoorInset : doorInset), end - doorInset];
  for (const side of [-1, 1]) {
    const firstWindow = start + (cab ? nose.length + .44 : .87);
    for (let z = firstWindow; z < end - .7; z += type === 'nightjet' ? 2.02 : 1.96) {
      const pane = type === 'nightjet' && side === -1 ? .94 : 1.52;
      if (z - pane / 2 < firstWindow - .46 || z + pane / 2 > finish - .32 ||
          doorsAt.some(at => Math.abs(at - z) < (pane + doorWidth) / 2 + .17)) continue;
      for (const [low, high] of windowsOnSide) {
        const upper = type === 'nightjet' && side === -1 ? high - .046 : high;
        panel(side, z, pane + .065, low - .009, upper + .009, RUBBER);
        panel(side, z, pane - .035, low, upper, glassShade, .015);
      }
    }

    for (const z of doorsAt) {
      const low = type === 'intercity' || type === 'nightjet' ? .12 : .038;
      panel(side, z, doorWidth + .065, low - .007, doorTop + .012, RUBBER, .015);
      panel(side, z, doorWidth, low, doorTop, door, .021);
      panel(side, z, .018, low, doorTop, RUBBER, .025, .004);
      for (const leaf of [-1, 1]) {
        panel(side, z + leaf * doorWidth * .22, doorWidth * .29,
          doorTop - .275, doorTop - .05, GLASS, .027);
      }
      panel(side, z, doorWidth + .04, low - .008, low + .014, STEEL, .028);
    }
    if (cab) {
      const windowZ = start + nose.length * (type === 'international' ? .73 : .82);
      panel(side, windowZ, type === 'nightjet' ? .79 : .95, .58, .78, RUBBER, .012);
      panel(side, windowZ + .03, type === 'nightjet' ? .67 : .81, .60, .757, GLASS, .020);
    }
    if (locomotive) {
      for (const z of [-length * .24, .0, length * .24]) {
        panel(side, z, 2.25, .615, .738, 0x303b4c, .012);
        for (let line = 0; line < 7; line++) {
          const y = .621 + line * .015;
          panel(side, z, 2.16, y, y + .006, 0x77869a, .018, .060);
        }
      }
    }
  }

  for (const z of cab ? [finish] : [start, finish]) {
    const dir = z < 0 ? -1 : 1;
    box(1.41, 2.38, .15, 0, 2.04, dir * (end - .23), UNDERFRAME);
    box(1.05, 1.98, .103, 0, 2.09, dir * (end - .075), RUBBER);
    for (const side of [-1, 1]) box(.095, 2.08, .022, side * .55, 2.08, dir * (end - .02), STEEL);
    box(.53, .18, .28, 0, .64, dir * (end - .147), STEEL);
  }

  if (cab) {
    const [low, high] = nose.glass;
    const glassPoint = (u, v, inset) => {
      const edge = (1 - Math.abs(2 * v - 1) ** 4 * .10) * (.93 - v * .105);
      return shell((u * 2 - 1) * (edge - inset), THREE.MathUtils.lerp(low+inset, high-inset, v), start)
        .map((coordinate, index) => index === 2 ? coordinate - .027 - inset : coordinate);
    };
    grid(7, 12, (u, v) => glassPoint(u, v, 0), RUBBER, true);
    grid(7, 12, (u, v) => glassPoint(u, v, .022), glassShade, true);
    for (const lean of [-1, 1]) {
      const a = glassPoint(.5 + lean * .11, .24, .032);
      const b = glassPoint(.5 + lean * .28, .63, .032);
      a[2] -= .018;
      b[2] -= .018;
      rod(a, b, .013, RUBBER);
    }
    const rear = cab === 'rear';
    const lamp = (x, y, rx, ry, color) => {
      const point = (u, v, offset) => {
        const turn = u * Math.PI * 2, r = .0001 + v * .9999;
        const p = shell(x + Math.cos(turn) * rx * r, y + Math.sin(turn) * ry * r, start);
        p[2] += offset;
        return p;
      };
      grid(1, 12, (u, v) => point(u,v,-.045), UNDERFRAME, false);
      grid(1, 12, (u, v) => point(u,v*.68,-.057), color, false, true);
    };
    for (const side of [-1, 1]) lamp(side * .67, .285, .13, .032, rear ? 0xfb2832 : 0xfff4dc);
    if (!rear) lamp(0, .846, .10, .022, 0xfff4dc);
    const coupler = shell(0, .105, start);
    box(.49, .19, .26, 0, coupler[1], Math.max(-end + .13, coupler[2] - .04), UNDERFRAME);
  }

  box(2.10, .29, length - 1.4, 0, .625, 0, UNDERFRAME);
  for (const z of [-length * .18, .12, length * .19]) {
    box(1.92, .41, 1.51, 0, .635, z, UNDERFRAME);
    box(.055, .22, 1.19, .99, .623, z, STEEL);
    box(.055, .22, 1.19, -.99, .623, z, STEEL);
  }
  for (const bogie of [-length * .34, length * .34]) {
    box(2.20, .35, 2.83, 0, .49, bogie, UNDERFRAME);
    for (const axle of [bogie - .99, bogie + .99]) {
      paint(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 1.48, 12)
        .rotateZ(Math.PI / 2).scale(1,.16,.16).translate(0, WHEEL_RADIUS, axle), STEEL);
      for (const side of [-1, 1]) {
        const x = side * HALF_GAUGE;
        paint(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, .135, 20)
          .rotateZ(Math.PI / 2).translate(x, WHEEL_RADIUS, axle), STEEL);
        paint(new THREE.CylinderGeometry(.25, .25, .038, 12)
          .rotateZ(Math.PI / 2).translate(x + side * .078, WHEEL_RADIUS, axle), UNDERFRAME);
        box(.20, .18, .34, side * .99, .60, axle, STEEL);
      }
    }
  }
  for (const z of [-length * .20, length * .22]) {
    box(1.32, .13, 2.18, 0, roof + .061, z, roofColor);
    for (const gap of [-.55, -.30, -.05, .2, .45]) box(1.08, .022, .065, 0, roof + .138, z + gap, UNDERFRAME);
  }
  if (!cab || locomotive) {
    const z = length * .24, y = roof + .025;
    const raised = Math.min(roof + .52, 4.72);
    const elbow = THREE.MathUtils.lerp(y, raised, .46);
    box(1.16, .08, 1.18, 0, y, z, UNDERFRAME);
    for (const side of [-1, 1]) {
      rod([side * .22, y + .043, z - .40], [side * .20, elbow, z + .26], .025, STEEL);
      rod([side * .20, elbow, z + .26], [side * .16, raised, z - .11], .021, STEEL);
    }
    box(1.18, .034, .12, 0, raised, z - .11, UNDERFRAME);
  }

  const combined = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  combined.computeBoundingBox();
  combined.computeBoundingSphere();
  return combined;
}

export function makeTrainModels() {
  return Object.fromEntries(Object.entries(profiles).map(([type, profile]) => {
    const consist = TRAIN_CONSISTS[type];
    const make = cab => carriageGeometry(type, consist.length, profile, cab);
    return [type, { ...consist, coach: make(null), cab: make('front'), rearCab: make('rear') }];
  }));
}
