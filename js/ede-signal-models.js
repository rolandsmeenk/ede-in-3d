import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LENS_RADIUS = 0.10;
const LENS_HEIGHTS = [0.25, 0, -0.25];
const HEAD_FACE = 0.11;
const VISOR_REAR = HEAD_FACE - 0.008;
const VISOR_RADIUS = 0.122;
const SHIELD_OPENING_RADIUS = 0.127;

// TNO R11704 figure 1 gives the outline and stripes. The Oss model inventory gives overall sizes.
export const EDE_SIGNAL_BACKPLATES = {
  200: { width: 0.60, height: 1.19, stripe: 0.030 },
  300: { width: 0.90, height: 1.60, stripe: 0.050 },
};

function capsule(shape, width, height) {
  const radius = width / 2, cap = (height - width) / 2;
  shape.moveTo(radius, cap);
  shape.absarc(0, cap, radius, 0, Math.PI, false);
  shape.lineTo(-radius, -cap);
  shape.absarc(0, -cap, radius, Math.PI, 2 * Math.PI, false);
  shape.closePath();
  return shape;
}

function makeVisor(y) {
  const positions = [], indices = [];
  const sections = Array.from({ length: 13 }, (_, i) => {
    const angle = Math.PI * (-0.16 + 1.32 * i / 12);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const lip = HEAD_FACE + 0.045 + 0.13 * Math.max(0, uy);
    const at = (radius, z) => [ux * radius, y + uy * radius, z];
    return {
      rearOutside: at(VISOR_RADIUS, VISOR_REAR),
      frontOutside: at(VISOR_RADIUS, lip),
      rearInside: at(0.117, VISOR_REAR),
      frontInside: at(0.117, lip),
    };
  });

  function addStrip(pairs) {
    const offset = positions.length / 3;
    for (const [a, b] of pairs) positions.push(...a, ...b);
    for (let i = 1; i < pairs.length; i++) {
      const a = offset + (i - 1) * 2;
      indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  }

  addStrip(sections.map(s => [s.rearOutside, s.frontOutside]));
  addStrip(sections.map(s => [s.frontInside, s.rearInside]));
  addStrip(sections.map(s => [s.frontOutside, s.frontInside]));
  addStrip(sections.map(s => [s.rearInside, s.rearOutside]));
  const first = sections[0], last = sections.at(-1);
  addStrip([[first.rearInside, first.frontInside], [first.rearOutside, first.frontOutside]]);
  addStrip([[last.rearOutside, last.frontOutside], [last.rearInside, last.frontInside]]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function tint(geometry, hex) {
  const mesh = geometry.index ? geometry.toNonIndexed() : geometry;
  mesh.deleteAttribute('uv');
  const { r, g, b } = new THREE.Color(hex);
  const colours = new Float32Array(mesh.getAttribute('position').count * 3);
  for (let i = 0; i < colours.length; i += 3) colours.set([r, g, b], i);
  mesh.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return mesh;
}

function backplateParts({ width, height, stripe }, scale) {
  // Keep both housings in 200 mm lens coordinates for the shared lens instances.
  const w = width / scale, h = height / scale, edge = stripe / scale;
  const thickness = 0.004 / scale, curveSegments = 10;
  const rim = capsule(new THREE.Shape(), w, h);
  const face = capsule(new THREE.Shape(), w - 2 * edge, h - 2 * edge);
  // The shield mounts against the lens cover. The visors project through its apertures.
  const openings = LENS_HEIGHTS.map(y => new THREE.Path().absarc(0, y, SHIELD_OPENING_RADIUS, 0, Math.PI * 2, true));
  rim.holes.push(...openings);
  face.holes.push(...openings);
  const plate = new THREE.ExtrudeGeometry(rim, { depth: thickness, bevelEnabled: false, curveSegments })
    .translate(0, 0, HEAD_FACE - thickness);
  // The black face and white stripe supply the front cap.
  const normals = plate.getAttribute('normal');
  plate.setIndex(Array.from({ length: normals.count }, (_, i) => i).filter(i => normals.getZ(i) < 0.5));
  rim.holes = [capsule(new THREE.Path(), w - 2 * edge, h - 2 * edge)];
  return [
    tint(plate, 0xb5b0a1),
    tint(new THREE.ShapeGeometry(face, curveSegments).translate(0, 0, HEAD_FACE), 0x141517),
    tint(new THREE.ShapeGeometry(rim, curveSegments).translate(0, 0, HEAD_FACE), 0xf4f3ee),
  ];
}

const ARROW_ANGLES = {
  left: Math.PI / 2, 'ahead-left': Math.PI / 4, straight: 0,
  'ahead-right': -Math.PI / 4, right: -Math.PI / 2,
};

export function createEdeArrowLenses(direction, auxiliary = false) {
  const angle = ARROW_ANGLES[direction];
  const c = Math.cos(angle), s = Math.sin(angle);
  const points = [[0, 0.088], [-0.059, 0.025], [-0.022, 0.025], [-0.022, -0.072],
    [0.022, -0.072], [0.022, 0.025], [0.059, 0.025]].map(([x, y]) =>
    new THREE.Vector2(c * x - s * y, s * x + c * y));
  const outline = new THREE.Shape().absarc(0, 0, LENS_RADIUS, 0, 2 * Math.PI, false);
  outline.holes.push(new THREE.Path(points));
  const arrow = new THREE.Shape(points);
  const parts = [
    new THREE.ShapeGeometry(outline, 9),
    new THREE.ShapeGeometry(arrow, 1),
  ];
  for (const [i, geometry] of parts.entries()) {
    const values = new Float32Array(geometry.getAttribute('position').count).fill(i);
    geometry.setAttribute('signalMask', new THREE.BufferAttribute(values, 1));
  }
  const lens = mergeGeometries(parts).translate(0, 0, HEAD_FACE + 0.004);
  return auxiliary ? lens : mergeGeometries(LENS_HEIGHTS.map(y => lens.clone().translate(0, y, 0)));
}

export function createEdeAuxiliarySignalHousing() {
  return mergeGeometries([
    tint(new THREE.BoxGeometry(0.29, 0.245, 0.16).translate(0, 0, 0.03), 0x26292b),
    tint(makeVisor(0), 0x171a1b),
  ]);
}

/** Dutch motor heads facing local +Z. The 300 mm housing and its lenses use instance scale 1.5. */
export function createEdeSignalHeadGeometries() {
  const casing = front => tint(new THREE.BoxGeometry(0.29, 0.83, front + 0.05)
    .translate(0, 0, (front - 0.05) / 2), 0x26292b);
  const visors = LENS_HEIGHTS.map(y => tint(makeVisor(y), 0x171a1b));
  const backed = [casing(VISOR_REAR), ...visors];
  return {
    housing: mergeGeometries([casing(HEAD_FACE), ...visors]),
    backplate: mergeGeometries([...backed, ...backplateParts(EDE_SIGNAL_BACKPLATES[200], 1)]),
    largeBackplate: mergeGeometries([...backed, ...backplateParts(EDE_SIGNAL_BACKPLATES[300], 1.5)]),
    lenses: mergeGeometries(LENS_HEIGHTS.map(y =>
      new THREE.CircleGeometry(LENS_RADIUS, 18).translate(0, y, HEAD_FACE + 0.004))),
  };
}
