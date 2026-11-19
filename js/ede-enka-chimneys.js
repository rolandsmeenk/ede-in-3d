import * as THREE from 'three/webgpu';
import { texture, uv, vertexColor, mix, step } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';

const profiles = {
  grote: {
    name: 'ENKA Grote Schoorsteen',
    color: 0xa66b56,
    bands: 30,
    bandStart: 19,
    lip: 84.82,
    // Brick corbels are separate from the round foot and the toothed crown.
    rows: [[5, 0], [5, 0.65], [4.94, 0.81], [4.88, 2.7], [4.96, 2.77], [4.96, 2.99],
      [4.78, 3.08], [4.65, 11.8], [4.56, 16.9], [4.43, 20.5], [3.09, 79.9],
      [3.09, 81.4], [3.19, 82.35], [3.32, 83.35], [3.34, 84.82]],
    lining: 2.93
  },
  kleine: {
    name: 'ENKA Kleine Schoorsteen',
    color: 0xb85f47,
    bands: 48,
    bandStart: 11,
    lip: 52.8,
    // The former boiler-house mantle surrounds the smaller original plinth.
    rows: [[4.05, 0], [4.05, 0.35], [3.96, 0.48], [3.9, 2.65], [4.01, 2.73], [4, 2.87],
      [3.89, 2.96], [3.79, 9.72], [3.87, 9.8], [3.84, 10.05], [3.68, 10.26],
      [3.51, 10.44], [3.125, 10.65], [3.04, 11.2], [2.13, 52.55], [2.13, 52.8]],
    mantleTop: 10.65,
    lining: 1.88
  }
};

export const ENKA_CHIMNEY_DIMENSIONS = {
  grote: { height: 85, baseRadius: 5 },
  kleine: { height: 53, baseRadius: 4.05 }
};

const sides = 40;
let material;
function masonry() {
  if (material) return material;
  const bricks = createFacadeSurfaceTexture().texture;
  const local = uv();
  const courses = texture(bricks, local).r.mul(0.55).add(0.51);
  material = new THREE.MeshStandardNodeMaterial({ roughness: 0.91 });
  material.colorNode = vertexColor().mul(mix(1, courses, step(0, local.y)));
  return material;
}

function radiusAt(rows, y) {
  const i = rows.findIndex(([, height]) => height >= y);
  if (i < 1) return rows[i === 0 ? 0 : rows.length - 1][0];
  const [r0, y0] = rows[i - 1];
  const [r1, y1] = rows[i];
  return THREE.MathUtils.lerp(r0, r1, (y - y0) / (y1 - y0));
}

export function createEnkaChimney(kind) {
  if (!Object.hasOwn(profiles, kind)) throw new RangeError(`Unknown ENKA chimney: ${kind}`);
  const { height } = ENKA_CHIMNEY_DIMENSIONS[kind];
  const { name, color, bands, bandStart, lip, rows, mantleTop, lining } = profiles[kind];
  const parts = [];

  function add(geometry, shade, hasBrick = false, repeat) {
    const { position, uv: coords } = geometry.attributes;
    const tint = new THREE.Color(shade);
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      tint.toArray(colors, i * 3);
      coords.setXY(i, hasBrick ? coords.getX(i) * repeat : 0,
        // A negative texture coordinate keeps iron and lining on the same material without mortar.
        hasBrick ? (position.getY(i) + 0.01) / 0.72 : -1);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  }

  function lathe(points, shade, repeats) {
    const geometry = new THREE.LatheGeometry(points.map(([radius, y]) => new THREE.Vector2(radius, y)), sides);
    add(geometry, shade, repeats !== undefined, repeats);
  }

  function block(width, tall, depth, radius, y, angle, shade, brick = false) {
    const geometry = new THREE.BoxGeometry(width, tall, depth)
      .translate(0, y, radius).rotateY(angle);
    add(geometry, shade, brick, width / 0.68);
  }

  function door(width, tall, y, angle, arch, frame, face = radiusAt(rows, y + tall * 0.3) + 0.055) {
    const outline = new THREE.Shape();
    outline.moveTo(-width / 2, 0);
    outline.lineTo(width / 2, 0);
    outline.lineTo(width / 2, tall - arch);
    if (arch) outline.quadraticCurveTo(width / 2, tall, 0, tall)
      .quadraticCurveTo(-width / 2, tall, -width / 2, tall - arch);
    else outline.lineTo(-width / 2, tall);
    outline.closePath();
    const geometry = new THREE.ShapeGeometry(outline, 8);
    if (frame) {
      add(geometry.clone().scale(1.18, 1.05, 1).translate(0, y, face - 0.007).rotateY(angle),
        0x71493b, true, width / 0.68);
    }
    add(geometry.translate(0, y, face).rotateY(angle), 0x241e1b);
    for (const x of [-0.34, -0.17, 0, 0.17, 0.34]) {
      const barHeight = tall - Math.abs(x) * arch * 1.08 - 0.06;
      add(new THREE.BoxGeometry(0.036, barHeight, 0.037)
        .translate(x * width, y + barHeight / 2, face + 0.021).rotateY(angle), 0x5e5850);
    }
  }

  const wrap = kind === 'grote' ? 39 : 23;
  const rimRadius = rows.at(-1)[0];
  if (mantleTop) {
    const split = rows.findIndex(([, y]) => y === mantleTop);
    lathe(rows.slice(0, split + 1), 0x96513e, wrap);
    lathe(rows.slice(split), color, wrap);
  } else {
    lathe(rows, color, wrap);
  }
  lathe([[rimRadius, lip], [rimRadius - 0.025, height], [lining, height], [lining, height - 0.85]],
    kind === 'grote' ? 0x99948a : 0x554e48);
  // The lower liner closes the modeled interior below the mouth, out of sight from ground level.
  lathe([[lining, height - 0.85], [lining, height - 6], [0, height - 6]], 0x2e2927);
  for (let i = 0; i < bands; i++) {
    const y = THREE.MathUtils.lerp(bandStart, lip - 0.38, i / (bands - 1));
    const radius = radiusAt(rows, y) + 0.027;
    lathe([[radius, y - 0.028], [radius, y + 0.028]],
      kind === 'grote' ? 0x61564e : (i % 2 ? 0x76564a : 0x5a4139));
  }

  if (kind === 'grote') {
    // The five former duct mouths project from the lower stack above the tapered foot.
    for (let i = 0; i < 5; i++) {
      const angle = Math.PI / 2 + i * Math.PI * 2 / 5;
      block(1.84, 9.4, 0.67, 4.925, 8.4, angle, 0x976653, true);
      block(1.58, 0.65, 0.48, 4.98, 3.38, angle, 0x946350, true);
      block(1.32, 0.52, 0.28, 4.96, 2.99, angle, 0x886050, true);
      block(1.46, 0.19, 0.19, 5.21, 13.19, angle, 0x816052, true);
      door(0.94, 3.15, 5.14, angle, 0, false, 5.266);
    }
    for (let i = 0; i < 40; i++) {
      block(0.34, 0.41, 0.18, 3.15, 81.67, i * Math.PI * 2 / 40, 0x966653, true);
    }
    door(0.92, 1.95, 0.12, -Math.PI / 2, 0, true);
  } else {
    for (let i = 0; i < 36; i++) {
      block(0.21, 0.33, 0.16, 3.79, 9.67, i * Math.PI * 2 / 36, 0xa15442, true);
    }
    door(1.26, 2.65, 0.12, Math.PI / 2, 0.51, true);
  }

  const model = new THREE.Group();
  model.name = name;
  const mesh = new THREE.Mesh(mergeGeometries(parts), masonry());
  for (const part of parts) part.dispose();
  mesh.castShadow = mesh.receiveShadow = true;
  model.add(mesh);
  return model;
}
