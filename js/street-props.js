import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function colored(geometry, hex) {
  const color = new THREE.Color(hex);
  const values = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < values.length; i += 3) color.toArray(values, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return geometry;
}

function box(width, height, depth, x, y, z, color) {
  return colored(new THREE.BoxGeometry(width, height, depth).translate(x, y, z), color);
}

function merged(geometries) {
  const result = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  return result;
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function atlasPlane(width, height, rect, x, y, z, rotationX = 0, rotationY = 0) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const uv = geometry.attributes.uv;
  const [left, top, w, h] = rect;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, left + uv.getX(i) * w, 1 - top - h + uv.getY(i) * h);
  }
  return geometry.rotateX(rotationX).rotateY(rotationY).translate(x, y, z);
}

export function createSubwayEntranceParts() {
  const green = 0x254938;
  const structure = [box(2.1, 1.22, 6.2, 0, -0.39, 0, 0x777c78)];
  for (const x of [-0.98, 0.98]) {
    structure.push(box(0.14, 0.13, 6.2, x, 0.285, 0, 0x777c78));
    for (const z of [-2.98, 0, 2.98]) {
      structure.push(box(0.09, z === 2.98 ? 2.07 : 1.12, 0.09, x, z === 2.98 ? 1.32 : 0.84, z, green));
    }
    for (const y of [0.46, 1.37]) structure.push(box(0.07, 0.065, 6.02, x, y, 0, green));
  }
  structure.push(box(1.96, 0.13, 0.14, 0, 0.285, -3.03, 0x777c78));
  for (const y of [0.46, 1.37]) structure.push(box(2.02, 0.065, 0.07, 0, y, -2.98, green));
  structure.push(box(1.78, 0.08, 0.24, 0, 0.26, 2.98, 0xa5aaa5));
  structure.push(box(1.9, 0.42, 0.09, 0, 1.66, -2.98, 0x151a18));

  const atlas = canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = '#254938';
    for (let x = 12; x < 1024; x += 32) ctx.fillRect(x, 0, 5, 256);
    ctx.fillRect(0, 57, 1024, 5);
    ctx.fillRect(0, 211, 1024, 5);

    // The sidewalk remains intact: painted tread shading suggests the stairwell below it.
    const shade = ctx.createLinearGradient(0, 272, 0, 752);
    shade.addColorStop(0, '#090d0c');
    shade.addColorStop(0.45, '#252b2a');
    shade.addColorStop(1, '#6b706c');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 264, 504, 496);
    for (let i = 0; i < 15; i++) {
      const y = 290 + Math.pow(i / 14, 1.4) * 449;
      const inset = 96 - i / 14 * 82;
      ctx.fillStyle = `rgba(8, 13, 11, ${0.8 - i * 0.025})`;
      ctx.fillRect(inset, y, 504 - inset * 2, 5);
      ctx.fillStyle = `rgba(210, 215, 205, ${0.015 + i * 0.012})`;
      ctx.fillRect(inset, y + 5, 504 - inset * 2, 2);
    }
    ctx.fillStyle = '#18201c';
    for (const side of [0, 1]) {
      const outer = side * 504;
      const direction = side ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(outer, 264);
      ctx.lineTo(outer + direction * 105, 264);
      ctx.lineTo(outer + direction * 14, 760);
      ctx.lineTo(outer, 760);
      ctx.fill();
    }

    ctx.fillStyle = '#111615';
    ctx.fillRect(520, 264, 504, 108);
    ctx.fillStyle = '#f2f1e8';
    ctx.fillRect(534, 274, 476, 3);
    ctx.font = 'bold 70px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Subway', 772, 349);
  });
  const details = [];
  for (const x of [-0.98, 0.98]) {
    details.push(atlasPlane(5.94, 0.88, [0, 0.008, 1, 0.234], x, 0.915, 0, 0, Math.PI / 2));
  }
  details.push(atlasPlane(1.88, 0.88, [0, 0.008, 0.316, 0.234], 0, 0.915, -2.98));
  details.push(atlasPlane(1.81, 5.92, [0.008, 0.266, 0.477, 0.469], 0, 0.235, 0, -Math.PI / 2));
  details.push(atlasPlane(1.86, 0.4, [520 / 1024, 264 / 1024, 504 / 1024, 108 / 1024], 0, 1.66, -2.926));
  details.push(atlasPlane(1.86, 0.4, [520 / 1024, 264 / 1024, 504 / 1024, 108 / 1024], 0, 1.66, -3.034, 0, Math.PI));

  const globes = [];
  for (const x of [-0.98, 0.98]) {
    globes.push(colored(new THREE.SphereGeometry(0.23, 8, 2, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, 2.57, 2.98), 0x3b9761));
    globes.push(colored(new THREE.SphereGeometry(0.23, 8, 2, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(x, 2.57, 2.98), 0xe2e6ce));
  }
  return [
    { name: 'subway-frame', geometry: merged(structure), material: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.64, metalness: 0.35 }) },
    { name: 'subway-details', geometry: merged(details), material: new THREE.MeshStandardNodeMaterial({ map: atlas, roughness: 0.8, alphaTest: 0.1, alphaToCoverage: true, side: THREE.DoubleSide }) },
    { name: 'subway-globes', geometry: merged(globes), material: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4, emissive: 0xb7d9ba, emissiveIntensity: 0.18 }), castShadow: false }
  ];
}

export function createShermanMonument() {
  const olive = 0x4e5843;
  const darkOlive = 0x343e2d;
  const track = 0x313831;
  const steel = 0x596252;
  const parts = [];

  // Side outlines use +Z as the nose. A small bevel catches light on the cast edges.
  function profile(points, width, x, shade, bevel) {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: width, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1
    }).rotateY(-Math.PI / 2).translate(x + width / 2, 0, 0);
    geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
    parts.push(colored(geometry, shade));
  }

  parts.push(box(3.5, 0.38, 6.6, 0, -0.08, 0, 0x85847c));
  parts.push(box(3.6, 0.07, 6.7, 0, 0.145, 0, 0xa2a298));
  for (const x of [-1.08, 1.08]) {
    parts.push(box(0.55, 0.016, 0.27, x, 0.187, 3.04, 0x826644));
    for (let i = 0; i < 3; i++) {
      parts.push(box(0.4, 0.006, 0.014, x, 0.198, 2.98 + i * 0.045, 0xbda37a));
    }
  }

  profile([[-2.88, 0.86], [2.39, 0.86], [2.87, 1.08], [2.83, 1.33], [1.92, 1.82],
    [-2.68, 1.82], [-2.89, 1.46]], 2.46, 0, olive, 0.06);

  const wheel = (radius, width, x, y, z, shade) => parts.push(colored(
    new THREE.CylinderGeometry(radius, radius, width, 14).rotateZ(Math.PI / 2).translate(x, y, z), shade
  ));
  for (const side of [-1, 1]) {
    const x = side * 1.13;
    profile([[-2.54, 0.22], [2.45, 0.22], [2.71, 0.44], [2.75, 0.83], [2.48, 1.06],
      [-2.50, 1.06], [-2.76, 0.86], [-2.78, 0.46]], 0.43, x, track, 0.035);
    for (const z of [-2.43, 2.43]) {
      wheel(0.37, 0.16, side * 1.33, 0.64, z, steel);
      wheel(0.15, 0.19, side * 1.37, 0.64, z, darkOlive);
    }
    for (const z of [-1.58, 0, 1.58]) {
      parts.push(box(0.16, 0.27, 0.65, side * 1.39, 0.78, z, darkOlive));
      for (const offset of [-0.34, 0.34]) {
        wheel(0.28, 0.12, side * 1.35, 0.54, z + offset, darkOlive);
        wheel(0.18, 0.14, side * 1.39, 0.54, z + offset, steel);
        wheel(0.075, 0.17, side * 1.42, 0.54, z + offset, olive);
      }
    }
    for (let i = 0; i <= 30; i++) {
      const z = -2.43 + i * 0.162;
      for (const y of [0.215, 1.078]) {
        parts.push(box(0.47, 0.033, 0.086, x, y, z, i % 3 === 0 ? steel : track));
      }
    }
    parts.push(box(0.28, 0.11, 0.65, side * 1.21, 1.37, 2.42, darkOlive));
    parts.push(box(0.21, 0.12, 0.44, side * 0.93, 1.82, 1.63, steel));
    parts.push(box(0.073, 0.09, 0.035, side * 1.02, 1.83, 1.87, 0xc4bfa3));
  }

  // Rounded Sherman turret, short barrel and stowed track links.
  parts.push(colored(new THREE.CylinderGeometry(0.87, 0.87, 0.13, 24).translate(0, 1.85, 0.11), darkOlive));
  parts.push(colored(new THREE.SphereGeometry(1, 28, 16).scale(0.98, 0.52, 1.25).translate(0, 2.11, 0.08), olive));
  parts.push(colored(new THREE.SphereGeometry(1, 18, 10).scale(0.55, 0.35, 0.33).translate(0, 2.13, 1.20), darkOlive));
  parts.push(colored(new THREE.CylinderGeometry(0.10, 0.14, 1.38, 16).rotateX(Math.PI / 2).translate(0, 2.16, 2.08), olive));
  parts.push(colored(new THREE.CircleGeometry(0.091, 16).translate(0, 2.16, 2.772), 0x282d28));
  parts.push(colored(new THREE.CylinderGeometry(0.31, 0.34, 0.13, 18).translate(-0.31, 2.64, 0.17), olive));
  parts.push(box(0.44, 0.065, 0.46, 0.37, 2.54, -0.22, darkOlive));
  for (let i = -6; i <= 6; i++) {
    parts.push(colored(new THREE.BoxGeometry(0.14, 0.055, 0.36).rotateX(0.48).translate(i * 0.155, 1.61, 2.37), track));
  }

  const stencil = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = '#273b50';
    ctx.fillRect(384, 0, 128, 128);
    ctx.fillStyle = '#e4e3cc';
    ctx.font = 'bold 53px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COUGAR', 192, 39);
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.fillText('T212125', 192, 92);
    ctx.font = 'bold 87px Arial, sans-serif';
    ctx.fillText('31', 448, 69);
  });
  const markings = [-1, 1].flatMap(side => [
    atlasPlane(1.14, 0.38, [0, 0, 0.75, 1], side * 1.294, 1.55, 1.02, 0, side * Math.PI / 2),
    atlasPlane(0.28, 0.28, [0.75, 0, 0.25, 1], side * 0.986, 2.12, 0.08, 0, side * Math.PI / 2)
  ]);

  const monument = new THREE.Group();
  monument.name = 'Sherman Tank';
  const body = new THREE.Mesh(merged(parts), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82 }));
  body.castShadow = body.receiveShadow = true;
  const decals = new THREE.Mesh(merged(markings), new THREE.MeshStandardNodeMaterial({ map: stencil, alphaTest: 0.5, roughness: 0.85 }));
  decals.receiveShadow = true;
  monument.add(body, decals);
  return monument;
}


// Painted bronze studies after Juan Ripollés's Raadhuisplein sculptures.
const sculpturePaint = {
  green: 0x8abc2a, emerald: 0x008050, blue: 0x167db5, lilac: 0x97afde,
  purple: 0x752177, orange: 0xf67f20, yellow: 0xffbd26, red: 0xd93430,
  white: 0xf3f0dd, charcoal: 0x252126, stone: 0x8c8980
};

function sculptureParts() {
  const geometries = [];
  function add(geometry, paint) {
    if (typeof paint === 'number') {
      geometries.push(colored(geometry, paint));
      return;
    }
    const position = geometry.getAttribute('position');
    const rgb = new Float32Array(position.count * 3);
    const shade = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      shade.setHex(paint(position.getX(i), position.getY(i), position.getZ(i))).toArray(rgb, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    geometries.push(geometry);
  }
  const oval = (at, size, paint, angle = 0) => {
    const large = Math.max(...size) > 0.35;
    add(new THREE.SphereGeometry(1, large ? 26 : 14, large ? 18 : 10)
      .scale(...size).rotateZ(angle).translate(...at), paint);
  };
  function stroke(points, fromRadius, toRadius, paint) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const steps = points.length > 2 ? (points.length - 1) * 7 : 2, sides = 12;
    const geometry = new THREE.TubeGeometry(curve, steps, 1, sides);
    const position = geometry.getAttribute('position');
    for (let i = 0; i <= steps; i++) {
      const fraction = i / steps;
      const center = curve.getPointAt(fraction);
      const radius = THREE.MathUtils.lerp(fromRadius, toRadius, fraction);
      for (let j = 0; j <= sides; j++) {
        const v = i * (sides + 1) + j;
        position.setXYZ(v, center.x + (position.getX(v) - center.x) * radius,
          center.y + (position.getY(v) - center.y) * radius, center.z + (position.getZ(v) - center.z) * radius);
      }
    }
    geometry.computeVertexNormals();
    add(geometry, paint);
  }
  function figure(name) {
    const mesh = new THREE.Mesh(merged(geometries),
      new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.18 }));
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
  return { geometries, add, oval, stroke, figure };
}

export function createChicoSculpture() {
  const { green, emerald, blue, purple, orange, yellow, red, white, charcoal, stone } = sculpturePaint;
  const { geometries, add, oval, stroke, figure } = sculptureParts();
  geometries.push(box(2.6, 0.17, 1.25, -0.27, 0.015, 0, stone));
  const jumpsuit = (x, y, z) => z < -0.02 + 0.08 * Math.sin(y * 7) ? red
    : x < -0.16 + 0.12 * Math.sin(y * 8) ? blue : x > 0.13 ? purple : orange;
  const greenLeg = (x, y, z) => z < -0.06 ? orange : x < 0.65 + Math.sin(y * 5) * 0.12 ? blue : emerald;
  stroke([[0.04, 1.42, 0], [0.54, 1.27, -0.03], [0.85, 0.95, -0.04], [0.96, 0.28, 0]], 0.32, 0.26, greenLeg);
  oval([0.96, 0.23, 0.02], [0.31, 0.14, 0.33], emerald);
  stroke([[0.0, 1.45, 0], [-0.21, 0.90, 0.02], [-0.79, 0.51, 0.07], [-1.31, 0.71, 0.08]],
    0.30, 0.29, (x, y, z) => x > -0.54 && z < 0.06 ? purple : yellow);
  oval([-1.38, 0.76, 0.08], [0.30, 0.22, 0.33], yellow, 0.55);
  oval([-0.10, 1.82, 0], [0.40, 0.69, 0.34], jumpsuit, -0.20);
  stroke([[-0.12, 2.24, 0], [-0.64, 2.33, 0], [-1.07, 2.57, 0.02], [-1.49, 3.09, 0.04]],
    0.24, 0.10, (x, y, z) => z > -0.10 ? blue : y > 2.76 ? red : orange);
  oval([-1.49, 3.08, 0.04], [0.13, 0.19, 0.085], blue, 0.56);
  for (let i = 0; i < 3; i++) {
    const x = -1.56 + 0.072 * i, y = 3.2 + 0.035 * i;
    stroke([[x, y, 0.045], [x - 0.06, y + 0.15, 0.048]], 0.042, 0.019, i === 0 ? red : blue);
  }
  stroke([[0.17, 2.24, 0], [0.67, 2.18, 0.03], [1.22, 2.26, 0.07], [1.69, 2.42, 0.12]],
    0.23, 0.105, (x, y, z) => x > 1.35 ? orange : z > -0.13 ? purple : red);
  oval([1.75, 2.45, 0.12], [0.26, 0.075, 0.15], yellow, 0.13);
  oval([-0.15, 2.53, 0], [0.20, 0.36, 0.21], green);
  oval([-0.19, 3.06, 0], [0.59, 0.70, 0.48],
    (x, y, z) => x < -0.44 + 0.085 * Math.sin(y * 10) || (z < 0 && x > -0.18) ? white : green, 0.12);
  oval([0.01, 3.33, 0.428], [0.196, 0.127, 0.068], white, -0.22);
  oval([0.045, 3.33, 0.488], [0.076, 0.087, 0.03], charcoal);
  oval([-0.23, 3.08, 0.47], [0.12, 0.11, 0.105], green);
  oval([-0.20, 2.91, 0.438], [0.19, 0.078, 0.048], red, 0.34);
  oval([0.04, 3.31, -0.428], [0.105, 0.096, 0.05], charcoal);
  stroke([[-0.29, 2.91, -0.44], [-0.12, 2.86, -0.46], [0.07, 2.94, -0.40]], 0.033, 0.025, white);
  for (let i = 0; i < 5; i++) {
    const x = -0.63 + 0.19 * i;
    stroke([[x, 3.58, 0.12], [x + 0.07, 3.77, 0.07], [x - 0.19, 3.75 + 0.045 * (i % 2), 0.13]],
      0.080, 0.024, i % 2 ? yellow : orange);
  }

  const heart = new THREE.Shape().moveTo(0, -0.21);
  heart.bezierCurveTo(-0.12, -0.09, -0.25, 0.01, -0.21, 0.15)
    .bezierCurveTo(-0.18, 0.27, -0.05, 0.27, 0, 0.15)
    .bezierCurveTo(0.05, 0.27, 0.18, 0.27, 0.21, 0.15)
    .bezierCurveTo(0.25, 0.01, 0.12, -0.09, 0, -0.21);
  const heartMesh = new THREE.ExtrudeGeometry(heart, { depth: 0.10, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 3 })
    .rotateZ(-0.10).translate(1.76, 2.73, 0.07);
  heartMesh.setIndex(Array.from({ length: heartMesh.attributes.position.count }, (_, i) => i));
  add(heartMesh, red);
  return figure('Chico Sol');
}

export function createChicaSculpture() {
  const { green, emerald, blue, lilac, purple, orange, yellow, red, white, charcoal, stone } = sculpturePaint;
  const { geometries, add, oval, stroke, figure } = sculptureParts();
  geometries.push(box(1.6, 0.16, 1.15, 0, 0.015, 0, stone));
  for (const x of [-0.28, 0.28]) {
    stroke([[x, 0.17, 0], [x * 0.82, 0.64, -0.04]], 0.20, 0.15, orange);
    oval([x, 0.19, 0.08], [0.21, 0.10, 0.24], orange);
  }

  const skirt = new THREE.SplineCurve([
    [0.03, 0.46], [0.67, 0.47], [0.74, 0.52], [0.66, 0.87], [0.39, 1.44],
    [0.35, 1.75], [0.45, 1.99], [0.35, 2.18], [0.16, 2.36], [0.02, 2.38]
  ].map(p => new THREE.Vector2(...p)));
  add(new THREE.LatheGeometry(skirt.getPoints(48), 48).scale(1, 1, 0.74), (x, y, z) => {
    if (y < 0.55 + 0.024 * Math.sin(x * 14)) return white;
    if (x < -0.15 + Math.sin(y * 9 + z * 4) * 0.15) return y > 1.85 ? lilac : purple;
    if (x > 0.23 + Math.sin(y * 11) * 0.11 && y > 1.12) return red;
    if (x > 0.19 + Math.sin(y * 12 + z * 6) * 0.15 || y > 1.7 + Math.cos(x * 13) * 0.15) return z < 0 ? lilac : blue;
    return orange;
  });
  stroke([[-0.30, 2.04, 0], [-0.76, 2.12, 0.03], [-1.24, 2.25, 0.12], [-1.65, 2.37, 0.15]],
    0.21, 0.102, (x, y, z) => z > 0.015 ? purple : lilac);
  oval([-1.70, 2.39, 0.15], [0.23, 0.08, 0.14], yellow, 0.18);
  stroke([[0.31, 1.95, 0.04], [0.65, 2.13, 0.08], [0.93, 2.41, 0.10], [1.11, 2.79, 0.14]],
    0.22, 0.105, (x, y, z) => z > 0.04 ? red : blue);
  oval([1.17, 2.84, 0.14], [0.145, 0.13, 0.073], white, -0.53);
  for (let i = 0; i < 5; i++) {
    const x = 1.05 + i * 0.059;
    stroke([[x, 2.87, 0.14], [x + (i - 1.6) * 0.055, 3.01 + (2 - Math.abs(i - 2)) * 0.053, 0.15]],
      0.044, 0.024, white);
  }
  oval([0.02, 2.45, 0], [0.19, 0.32, 0.20], green);
  oval([-0.03, 3.03, 0], [0.58, 0.63, 0.49],
    (x, y, z) => z < 0.10 * Math.cos(y * 8) ? orange : x < -0.37 + 0.09 * Math.sin(y * 11) ? yellow : green, 0.14);
  oval([-0.15, 3.28, 0.438], [0.175, 0.118, 0.06], white, 0.12);
  oval([-0.17, 3.28, 0.493], [0.075, 0.08, 0.026], charcoal);
  oval([-0.37, 2.99, 0.357], [0.16, 0.12, 0.14], green, 0.34);
  stroke([[-0.35, 2.89, 0.39], [-0.29, 2.81, 0.425], [-0.15, 2.83, 0.438]], 0.044, 0.03, white);
  oval([-0.17, 3.29, -0.433], [0.18, 0.11, 0.06], white, -0.18);
  oval([-0.15, 3.30, -0.486], [0.073, 0.077, 0.026], charcoal);
  stroke([[-0.33, 2.87, -0.39], [-0.26, 2.82, -0.44], [-0.12, 2.91, -0.46]], 0.043, 0.03, white);
  oval([0.03, 3.68, 0], [0.16, 0.30, 0.105], emerald, 0.30);
  oval([0.28, 3.62, -0.04], [0.22, 0.13, 0.10], emerald, 0.64);

  oval([-1.76, 2.62, 0.15], [0.28, 0.135, 0.147], white, -0.08);
  oval([-1.94, 2.78, 0.15], [0.10, 0.16, 0.083], white, 0.3);
  oval([-2.00, 2.88, 0.15], [0.081, 0.072, 0.070], white);
  oval([-2.08, 2.88, 0.15], [0.06, 0.022, 0.024], yellow);
  for (const side of [-1, 1]) {
    oval([-1.68, 2.66, 0.15 + side * 0.106], [0.25, 0.046, 0.095], white, -0.29);
    oval([-2.02, 2.893, 0.15 + side * 0.061], [0.012, 0.012, 0.010], charcoal);
  }
  oval([-1.44, 2.63, 0.15], [0.17, 0.050, 0.12], white, 0.16);
  return figure('Chica Salundandu');
}
