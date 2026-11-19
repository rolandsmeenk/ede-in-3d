import * as THREE from 'three/webgpu';
import { attribute, mix, step, texture, uv, vertexColor } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { nearbyRailHeightAt } from './ede-grade.js';
import { terrainHeightAt } from './terrain.js';

// 3DBAG v2025.09.03 LoD 2.2, projected into the Oude Kerk scene.
// Tuples are local x, metres above the surveyed NAP base, and local z.
// Faces give the surface kind (0 wall, 1 roof) followed by the outline and any holes.
const SURVEY = {
  station: {
    origin: [-239.34,323.9,1.025], baseY: -1.1055,
    footprint: [[-251.5,336.1],[-243,322],[-243.8,321.5],[-235.4,307.5],[-227.3,312.4],[-230,317],[-229.5,317.4],[-232.4,322.1],[-233,321.8],[-235.8,326.4],[-236.6,325.9],[-245.1,340]],
    vertices: [
      [10.64,8.5,5.06], [10.64,0.0,5.06], [10.69,0.0,4.41], [10.69,8.45,4.41],
      [10.75,0.0,4.41], [10.75,8.39,4.41], [5.11,8.41,4.38], [5.11,0.0,4.38],
      [5.12,0.0,4.5], [5.12,8.33,4.5], [5.15,8.36,5.04], [5.15,0.0,5.04],
      [7.97,0.0,5.05], [7.97,10.98,5.05], [16.06,0.0,4.33], [16.06,8.44,4.33],
      [0.07,8.7,4.34], [0.07,8.44,4.34], [1.07,9.54,2.78], [16.04,8.3,-5.14],
      [16.04,0.0,-5.14], [-0.26,0.0,-5.07], [-0.26,8.29,-5.07], [-0.5,8.21,-4.08],
      [-0.5,5.06,-4.08], [-0.5,6.8,-0.27], [-0.5,8.21,-0.27], [-0.26,8.41,-4.08],
      [-0.26,0.0,-4.08], [-0.5,0.0,-4.08], [-16.75,6.79,-0.19], [-16.75,0.0,-0.19],
      [-16.77,0.0,3.48], [-16.77,5.13,3.48], [-16.72,5.04,-4.05], [-16.72,0.0,-4.05],
      [-0.51,0.0,3.38], [-0.51,5.14,3.38], [-0.51,8.21,3.38], [-0.3,0.0,3.38],
      [-0.3,8.39,3.38], [8.1,10.83,1.95], [8.1,11.04,1.95], [7.98,10.94,2.02],
      [8.1,10.12,1.95], [9.77,9.29,3.13], [-0.26,0.0,-4.9], [-0.26,8.41,-4.9],
      [16.06,8.46,4.33], [12.47,11.72,-0.32], [-0.28,0.0,4.34], [-0.28,8.41,4.34],
      [0.07,0.0,4.34], [16.04,0.0,-4.89], [16.04,8.47,-4.89], [7.46,10.44,1.5],
      [3.66,11.7,-0.3],
    ],
    faces: [
      [0,[0,1,2,3]], [0,[3,2,4,5]], [0,[6,7,8,9]], [0,[10,11,12,13]],
      [0,[9,8,11,10]], [0,[13,12,1,0]], [0,[5,4,14,15]], [0,[16,17,18]],
      [0,[19,20,21,22]], [0,[23,24,25,26]], [0,[27,28,29,24,23]], [0,[30,31,32,33]],
      [0,[34,35,31,30]], [0,[24,29,35,34]], [0,[33,32,36,37]], [0,[38,37,36,39,40]],
      [0,[26,25,37,38]], [0,[41,42,43]], [0,[44,41,45]], [0,[22,21,46,47]],
      [0,[47,46,28,27]], [0,[15,48,49]], [0,[40,39,50,51]], [0,[51,50,52,17,16]],
      [0,[48,15,14,53,54]], [0,[17,52,7,6]], [0,[42,41,44,55]], [0,[54,53,20,19]],
      [1,[30,25,24,34]], [1,[37,25,30,33]], [1,[56,47,27,23,26,38,40,51,16,18]], [1,[54,49,48]],
      [1,[43,13,0,3,5,45,41]], [1,[55,44,45,5,15,49,56,18,17,6,9]], [1,[13,43,42,55,9,10]], [1,[54,19,22,47,56,49]],
    ],
  },
  stationShed: {
    origin: [-254.13,342.5,1.025], baseY: -1.0495,
    footprint: [[-251.4,340.7],[-251.7,340.6],[-254.4,338.9],[-257.6,344.1],[-257.6,344.2],[-254.8,345.9],[-254.6,346],[-254,345]],
    vertices: [
      [2.92,3.14,1.43], [2.92,0.0,1.43], [2.92,0.0,-0.25], [2.92,4.84,-0.25],
      [-3.3,3.0,-2.11], [-3.3,0.0,-2.11], [-3.29,0.0,-0.26], [-3.29,4.86,-0.26],
      [-3.05,0.0,-0.26], [-3.05,4.86,-0.26], [-3.07,0.0,1.45], [-3.07,3.11,1.45],
      [2.91,2.94,-2.14], [2.91,0.0,-2.14],
    ],
    faces: [
      [0,[0,1,2,3]], [0,[4,5,6,7]], [0,[7,6,8,9]], [0,[9,8,10,11]],
      [0,[11,10,1,0]], [0,[12,13,5,4]], [0,[3,2,13,12]], [1,[11,0,3,9]],
      [1,[3,12,4,7,9]],
    ],
  },
  house: {
    origin: [-973.625,-759.575,-1.317], baseY: -4.86,
    footprint: [[-984.1,-767.5],[-968.3,-771.5],[-963.1,-751.7],[-979,-747.6]],
    vertices: [
      [-10.09,8.35,-8.2], [-10.09,8.21,-8.2], [-10.09,0.0,-8.2], [-10.19,0.0,-8.2],
      [-10.19,8.23,-8.2], [0.13,10.72,8.17], [0.13,0.0,8.17], [4.39,0.0,8.17],
      [4.39,8.67,8.17], [4.39,8.67,8.17], [1.9,9.86,7.21], [0.04,10.34,6.81],
      [0.04,10.75,6.81], [-1.85,9.82,8.17], [-1.85,8.52,8.17], [-1.85,0.0,8.17],
      [-9.31,8.34,8.16], [-9.31,0.0,8.16], [10.31,8.52,-7.67], [10.31,0.0,-7.67],
      [10.31,0.0,-8.13], [10.31,7.93,-8.13], [10.31,8.3,8.17], [10.31,0.0,8.17],
      [8.71,8.78,8.17], [8.71,10.31,8.17], [8.32,10.81,6.6], [8.71,0.0,8.17],
      [1.12,8.05,-8.16], [1.12,10.61,-8.16], [0.51,10.54,-6.25], [1.12,0.0,-8.16],
      [0.04,0.0,-8.17], [0.04,8.07,-8.17], [0.04,10.64,-8.17], [-10.09,8.35,-8.09],
      [-9.13,8.77,7.84], [-9.13,0.0,7.84], [-9.13,9.65,7.84], [-8.42,10.53,6.5],
      [-0.81,10.62,-7.47], [-0.81,8.98,-7.47], [0.1,10.55,-6.24], [-10.26,0.0,7.93],
      [-10.26,8.24,7.93], [-1.35,10.11,6.96], [-0.53,10.49,6.68], [-7.33,11.89,5.48],
      [7.48,11.89,5.76], [7.63,11.85,-5.12], [-7.3,11.86,-5.33],
    ],
    faces: [
      [0,[0,1,2,3,4]], [0,[5,6,7,8,9]], [0,[9,8,10]], [0,[11,12,10]],
      [0,[13,14,15,6,5]], [0,[16,17,15,14]], [0,[18,19,20,21]], [0,[22,23,19,18]],
      [0,[24,25,26]], [0,[8,7,27,24]], [0,[25,24,27,23,22]], [0,[28,29,30]],
      [0,[29,28,31,32,33,34]], [0,[1,0,35]], [0,[36,37,17,16]], [0,[38,36,39]],
      [0,[40,41,42]], [0,[34,33,41,40]], [0,[33,32,2,1]], [0,[4,3,43,44]],
      [0,[44,43,37,36,38]], [0,[21,20,31,28]], [0,[14,13,45]], [0,[12,11,46]],
      [1,[10,12,5,9]], [1,[47,48,49,50]], [1,[44,38,39,47,50,35,0,4]], [1,[12,46,45,13,5]],
      [1,[18,49,48,26,25,22]], [1,[42,30,29,34,40]], [1,[21,28,30,42,41,33,1,35,50,49,18]], [1,[46,11,10,8,24,26,48,47,39,36,16,14,45]],
    ],
  },
  coach: {
    origin: [-1023.75,-725.2,1.998], baseY: -5.15,
    footprint: [[-1037.6,-726.6],[-1026.1,-731.8],[-1023.3,-733.1],[-1020.4,-734.4],[-1019.2,-734.9],[-1015.6,-736.6],[-1012.1,-728.7],[-1010.9,-726.2],[-1011.8,-725.8],[-1010,-721.7],[-1020.2,-717.1],[-1022,-721.1],[-1028.5,-718.1],[-1026.7,-714.2],[-1031.1,-712.3],[-1033,-716.6],[-1033.5,-717.7]],
    vertices: [
      [-4.72,2.98,-12.03], [-4.72,0.09,-12.03], [-6.27,0.09,-12.03], [-6.27,3.57,-12.03],
      [-4.49,3.31,-7.25], [-4.49,0.09,-7.25], [-4.46,0.09,-0.1], [-4.46,3.45,-0.1],
      [-4.77,3.0,-7.26], [-4.77,0.09,-7.26], [-4.78,0.09,-0.1], [-4.78,3.1,-0.1],
      [-6.79,5.28,11.07], [-6.79,0.09,11.07], [-4.87,0.09,11.07], [-4.87,3.16,11.07],
      [-4.45,0.09,11.07], [-4.45,3.62,11.07], [-6.75,5.27,-0.11], [-6.75,0.09,-0.11],
      [-6.75,0.09,-0.05], [-6.75,5.27,-0.05], [-6.75,5.27,-0.05], [-8.7,3.31,11.06],
      [-8.7,0.09,11.06], [-8.7,3.31,10.83], [-8.7,0.09,10.83], [1.27,9.63,-12.05],
      [1.27,0.09,-12.05], [-4.46,3.63,12.05], [-4.46,0.09,12.05], [1.05,0.09,12.06],
      [1.05,9.74,12.06], [-8.79,0.81,-7.29], [-8.79,0.09,-7.29], [-6.32,0.09,-7.27],
      [-6.32,0.22,-7.27], [-6.32,3.58,-7.27], [-8.74,0.09,-12.03], [-8.74,0.59,-12.03],
      [-6.65,0.09,-12.03], [-6.27,0.0,-12.03], [-8.91,3.09,10.83], [-8.91,0.09,10.83],
      [-8.9,3.05,-0.06], [-8.9,0.09,-0.06], [-3.73,4.35,6.29], [-3.73,5.95,6.29],
      [-0.93,7.46,6.0], [-3.76,4.37,9.84], [-3.76,5.97,9.84], [-0.97,7.46,10.22],
      [6.98,3.47,12.08], [6.98,0.09,12.08], [6.96,0.09,-12.06], [6.96,3.61,-12.06],
    ],
    faces: [
      [0,[0,1,2,3]], [0,[4,5,6,7]], [0,[8,9,5,4]], [0,[7,6,10,11]],
      [0,[12,13,14,15]], [0,[15,14,16,17]], [0,[18,19,20,21,22]], [0,[11,10,19,18]],
      [0,[23,24,13,12]], [0,[25,26,24,23]], [0,[27,28,1,0]], [0,[29,30,31,32]],
      [0,[33,34,35,36]], [0,[37,36,35,9,8]], [0,[38,39,40]], [0,[41,2,40]],
      [0,[3,2,41,36,37]], [0,[42,43,26,25]], [0,[39,38,34,33]], [0,[44,45,43,42]],
      [0,[46,47,48]], [0,[47,46,49,50]], [0,[17,16,30,29]], [0,[50,49,51]],
      [0,[52,53,54,55]], [0,[55,54,28,27]], [0,[32,31,53,52]], [0,[22,21,12]],
      [0,[21,20,45,44]], [1,[3,37,8,0]], [1,[39,33,36,41,40]], [1,[51,48,47,50]],
      [1,[27,32,52,55]], [1,[15,11,18,22,12]], [1,[21,44,42,25,23,12]], [1,[11,15,17,29,32,27,0,8,4,7],[46,48,51,49]],
    ],
  },
};

const BRICK = 0x82624f;
const HOUSE_BRICK = 0x815958;
const COACH_BRICK = 0x96715b;
const RED_TILE = 0x795447;
const DARK_TILE = 0x635951;
const CREAM = 0xd6c1a1;
const BUFF = 0xb49a6f;
const STONE = 0x756d64;
const GREEN = 0x243d34;
const SHUTTER = 0x982e25;
const GLASS = 0x3e4c53;
const DOOR = 0x29352f;

let surfaceMaterial;
function historicMaterial() {
  if (!surfaceMaterial) {
    surfaceMaterial = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    const finish = attribute('historicFinish', 'vec2');
    const grain = texture(createFacadeSurfaceTexture().texture, uv());
    const unit = mix(grain.r, grain.b, step(1.5, finish.x));
    surfaceMaterial.colorNode = vertexColor().mul(mix(1, unit.mul(0.43).add(0.61), step(0.5, finish.x)));
    surfaceMaterial.roughnessNode = finish.y;
  }
  return surfaceMaterial;
}

function buildBatch(name) {
  const positions = [], normalValues = [], colorValues = [], coords = [], finishes = [];
  const up = new THREE.Vector3(0, 1, 0);

  function append(p, normal, tint, uvX, uvY, material, roughness) {
    positions.push(p.x, p.y, p.z);
    normalValues.push(normal.x, normal.y, normal.z);
    colorValues.push(tint.r, tint.g, tint.b);
    coords.push(uvX, uvY);
    finishes.push(material, roughness);
  }

  function polygon(rings, tint, material = 0, roughness = 0.9) {
    const a = rings[0][0], normal = new THREE.Vector3();
    for (let i = 1; i < rings[0].length - 1; i++) {
      normal.add(rings[0][i].clone().sub(a).cross(rings[0][i + 1].clone().sub(a)));
    }
    if (normal.lengthSq() < 1e-10) return;
    normal.normalize();
    const direction = Math.abs(normal.y) < 0.98 ? up : new THREE.Vector3(0, 0, 1);
    const u = direction.clone().cross(normal).normalize(), v = normal.clone().cross(u);
    const [contour, ...holes] = rings.map(ring => ring.map(p => new THREE.Vector2(p.dot(u), p.dot(v))));
    const points = rings.flat();
    const color = new THREE.Color(tint);
    for (const triangle of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const [p, q, r] = triangle.map(i => points[i]);
      const side = q.clone().sub(p).cross(r.clone().sub(p));
      if (side.lengthSq() < 1e-10) continue;
      for (const vertex of side.dot(normal) > 0 ? [p, q, r] : [p, r, q]) {
        append(vertex, normal, color, vertex.dot(u) / (material === 2 ? 1.75 : 1.04),
          vertex.dot(v) / (material === 2 ? 1.35 : 0.56), material, roughness);
      }
    }
  }

  function panel(outline, tint, material = 0, roughness = 0.9) {
    polygon([outline.map(p => new THREE.Vector3(...p))], tint, material, roughness);
  }

  function add(geometry, tint, material = 0, roughness = 0.9) {
    const { index, attributes: { position, normal, uv } } = geometry;
    const p = new THREE.Vector3(), n = new THREE.Vector3(), color = new THREE.Color(tint);
    for (let i = 0, count = index?.count ?? position.count; i < count; i++) {
      const j = index ? index.getX(i) : i;
      p.fromBufferAttribute(position, j);
      n.fromBufferAttribute(normal, j);
      append(p, n, color, uv.getX(j), uv.getY(j), material, roughness);
    }
    geometry.dispose();
  }

  function box(x, y, z, w, h, d, tint, rotate = 0) {
    add(new THREE.BoxGeometry(w, h, d).rotateY(rotate).translate(x, y, z), tint);
  }

  function beam(start, end, width, depth, tint) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const length = direction.length();
    if (length < 0.001) return;
    const orientation = new THREE.Quaternion().setFromUnitVectors(up, direction.divideScalar(length));
    add(new THREE.BoxGeometry(width, length, depth).applyQuaternion(orientation)
      .translate(...a.lerp(b, 0.5).toArray()), tint);
  }

  function face(yaw, offset) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (x, y, z = 0) => [x * c + (offset + z) * s, y, -x * s + (offset + z) * c];
    return {
      box(x, y, z, w, h, d, tint) {
        box(...at(x, y, z), w, h, d, tint, yaw);
      },
      panel(outline, tint, material = 0, roughness = 0.9) {
        panel(outline.map(([x, y, z]) => at(x, y, z)), tint, material, roughness);
      }
    };
  }

  function survey(model, brick, tile, flat) {
    const points = model.vertices.map(p => new THREE.Vector3(...p));
    for (const [kind, ...rings] of model.faces) {
      const surface = rings.map(ring => ring.map(i => points[i]));
      const [a, b, c] = surface[0];
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const flatRoof = kind === 1 && normal.y > 0.965;
      polygon(surface, kind === 0 ? brick : flatRoof ? flat : tile, kind === 0 ? 1 : flatRoof ? 0 : 2);
    }
  }

  function mesh() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalValues, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorValues, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
    geometry.setAttribute('historicFinish', new THREE.Float32BufferAttribute(finishes, 2));
    const result = new THREE.Mesh(geometry, historicMaterial());
    result.name = name;
    result.castShadow = result.receiveShadow = true;
    return result;
  }

  return { box, beam, panel, face, survey, mesh };
}

function opening(face, x, bottom, w, h, { rise = 0, frame = CREAM, fill = GLASS, columns = 2, rows = 3, shutters = false } = {}) {
  function shape(width, height, arch, z) {
    const left = x - width / 2, right = x + width / 2;
    const outline = [[left, bottom, z], [right, bottom, z]];
    if (arch === 0) return outline.concat([[right, bottom + height, z], [left, bottom + height, z]]);
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * i / 8;
      outline.push([x + Math.cos(a) * width / 2, bottom + height - arch + Math.sin(a) * arch, z]);
    }
    return outline;
  }
  face.panel(shape(w + 0.15, h + 0.08, rise, 0.07), frame);
  face.panel(shape(w, h, rise, 0.088), fill, 0, 0.39);
  face.box(x, bottom - 0.035, 0.115, w + 0.21, 0.09, 0.225, STONE);
  for (let i = 1; i < columns; i++) {
    const a = -w / 2 + w * i / columns;
    const high = h - rise + Math.sqrt(1 - (a / (w / 2)) ** 2) * rise;
    face.box(x + a, bottom + high / 2, 0.102, 0.045, high, 0.025, frame);
  }
  for (let i = 1; i < rows; i++) face.box(x, bottom + (h - rise) * i / rows, 0.102, w, 0.045, 0.025, frame);
  if (shutters) {
    for (const direction of [-1, 1]) {
      const a = x + direction * (w * 0.72 + 0.09);
      face.box(a, bottom + h / 2, 0.108, w * 0.34, h + 0.07, 0.085, GREEN);
      face.box(a, bottom + h / 2, 0.155, w * 0.22, h - 0.17, 0.023, CREAM);
      face.box(a, bottom + h / 2, 0.171, w * 0.17, h - 0.25, 0.017, SHUTTER);
    }
  }
}

function foundation(batch, ring, lower, upper, color) {
  for (let i = 0; i < ring.length; i++) {
    const [x, z] = ring[i], [u, v] = ring[(i + 1) % ring.length];
    batch.panel([[u, lower, v], [x, lower, z], [x, upper, z], [u, upper, v]], color);
  }
}

function place(target, model, mesh) {
  const [x, z, heading] = model.origin;
  mesh.position.set(x, model.baseY, z);
  mesh.rotation.y = heading;
  target.add(mesh);
}

function worldPoint(model, x, z) {
  const [ox, oz, h] = model.origin, c = Math.cos(h), s = Math.sin(h);
  return { x: ox + x * c + z * s, z: oz - x * s + z * c };
}

function solidCollider(model, points = model.footprint) {
  const outer = points.map(([x, z]) => ({ x, z }));
  return {
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: model.baseY - 0.45, maxY: model.baseY + Math.max(...model.vertices.map(p => p[1])),
    polygon: { outer, holes: [] },
  };
}

function stationSign(target, model, text, x, y, z, yaw, width, height, background, ink) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.width = 448; canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = ink;
  context.font = 'bold 49px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 224, 49);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({
    map, roughness: 0.83, side: THREE.FrontSide,
  }));
  const origin = worldPoint(model, x, z);
  sign.position.set(origin.x, y + model.baseY, origin.z);
  sign.rotation.y = model.origin[2] + yaw;
  target.add(sign);
}

export function createEdeCentrumStation() {
  const target = new THREE.Group();
  target.name = 'Station Ede Centrum';
  const model = SURVEY.station;
  const station = buildBatch('Museumplein station and wooden platform canopy');
  station.survey(model, BRICK, RED_TILE, DARK_TILE);
  foundation(station, [[-16.77, 3.48], [-16.72, -4.05], [-0.26, -5.07], [16.04, -5.14],
    [16.06, 4.33], [10.75, 4.41], [10.64, 5.06], [5.15, 5.04], [5.11, 4.38], [-0.51, 3.38]], -0.52, 0.19, STONE);

  const centre = station.face(0, 5.055);
  const wings = station.face(0, 4.425);
  const goods = station.face(0, 3.50);
  const platform = station.face(Math.PI, 5.16);
  const goodsBack = station.face(Math.PI, 4.11);
  const north = station.face(Math.PI / 2, 16.09);
  const south = station.face(-Math.PI / 2, 16.78);

  opening(centre, 7.94, 5.2, 2.02, 2.16, { rise: 0.34, frame: GREEN, rows: 3, columns: 3 });
  opening(centre, 7.94, 0.09, 1.65, 2.91, { rise: 0.32, frame: GREEN, fill: DOOR, rows: 2 });
  for (const x of [5.92, 9.97]) opening(centre, x, 0.85, 0.71, 1.68, { rise: 0.22, frame: GREEN, columns: 1, rows: 2 });
  for (const x of [7.24, 7.94, 8.64]) opening(centre, x, 8.72, 0.39, 0.63, { frame: STONE, columns: 1, rows: 1 });
  centre.box(7.94, 7.67, 0.035, 2.05, 0.115, 0.12, BUFF);
  centre.box(7.94, 4.8, 0.045, 5.5, 0.07, 0.09, BUFF);
  for (const x of [1.35, 3.38, 12.09, 14.52]) opening(wings, x, 0.7, 1.10, 2.35, { rise: 0.32, frame: GREEN });
  for (const [x, w] of [[1.45, 0.60], [3.67, 0.64], [13.33, 1.46]]) {
    opening(wings, x, 5.35, w, 2.05, { rise: 0.24, frame: GREEN });
  }
  function band(face, left, right, height, interruptions = []) {
    for (const [x, width] of interruptions) {
      const end = x - width / 2 - 0.1;
      if (end > left) face.box((left + end) / 2, height, 0.025, end - left, 0.075, 0.09, BUFF);
      left = x + width / 2 + 0.1;
    }
    if (right > left) face.box((left + right) / 2, height, 0.025, right - left, 0.075, 0.09, BUFF);
  }
  for (const [l, r, gaps] of [[0.07, 5.11, [[1.35, 1.10], [3.38, 1.10]]],
    [10.75, 16.06, [[12.09, 1.10], [14.52, 1.10]]]]) {
    for (const y of [0.43, 5.1, 7.59]) band(wings, l, r, y);
    band(wings, l, r, 2.2, gaps);
    wings.box((l + r) / 2, 8.28, 0.06, r - l, 0.12, 0.22, CREAM);
  }
  const goodsBays = [[-14.7, 1.64], [-10.85, 2.14], [-6.30, 1.87], [-2.55, 1.16]];
  for (const [x, w] of goodsBays) opening(goods, x, 0.82, w, 2.45, { rise: 0.36, frame: GREEN });
  for (const y of [0.42, 4.56]) band(goods, -16.71, -0.55, y);
  band(goods, -16.71, -0.55, 2.34, goodsBays);
  south.box(0.22, 0.49, 0.025, 7.38, 0.095, 0.1, BUFF);
  opening(south, 0.27, 0.81, 2.56, 2.88, { rise: 0.43, frame: GREEN, rows: 2 });
  for (const y of [0.42, 2.2, 5.19, 7.59]) north.box(0.41, y, 0.025, 9.16, 0.075, 0.1, BUFF);
  for (const z of [-1.8, 1.62]) opening(north, z, 5.27, 1.09, 2.05, { rise: 0.29, frame: GREEN });
  for (const x of [-13.5, -10, -6.6, -3.25]) {
    opening(platform, x, 5.1, 1.33, 2.18, { rise: 0.30, frame: CREAM });
    opening(platform, x, 0.51, 1.22, 2.25, { rise: 0.29, frame: GREEN, rows: 2 });
  }
  opening(platform, -6.39, 0.12, 1.67, 2.66, { rise: 0.23, frame: GREEN, fill: DOOR, rows: 2 });
  for (const x of [4.0, 9.7, 14.03]) opening(goodsBack, x, 0.68, x === 14.03 ? 2.1 : 1.45, 2.59,
    { rise: 0.36, frame: GREEN, rows: 2, fill: x === 14.03 ? DOOR : GLASS });

  for (const [a, b] of [
    [[5.15, 8.39, 5.13], [7.97, 10.99, 5.13]], [[7.97, 10.99, 5.13], [10.64, 8.5, 5.13]],
    [[16.08, 8.45, 4.39], [16.08, 8.33, -5.17]], [[16.08, 8.33, -5.17], [-0.25, 8.32, -5.10]],
    [[-16.78, 5.16, 3.53], [-0.53, 5.16, 3.44]], [[-16.75, 5.08, -4.10], [-0.52, 5.10, -4.12]],
  ]) station.beam(a, b, 0.13, 0.19, CREAM);
  for (const [x, z, base] of [[3.39, -1.34, 10.77], [12.3, 0.02, 11.45], [-15.08, -0.12, 6.41]]) {
    station.box(x, base + 0.74, z, 0.76, 1.62, 0.72, BRICK);
    station.box(x, base + 1.58, z, 0.91, 0.12, 0.87, STONE);
  }

  // The protected canopy runs along the narrow platform, parallel to the Valleilijn.
  station.panel([[-16.78, 3.95, -4.08], [16.01, 3.95, -4.08], [16.01, 3.33, -8.55], [-16.78, 3.33, -8.55]], DARK_TILE, 2);
  station.panel([[-16.78, 3.21, -8.55], [16.01, 3.21, -8.55], [16.01, 3.83, -4.08], [-16.78, 3.83, -4.08]], 0x6d644d);
  station.box(-0.38, 3.23, -8.58, 32.91, 0.20, 0.16, CREAM);
  station.box(-0.38, 3.08, -8.24, 32.82, 0.17, 0.16, GREEN);
  const colliders = [solidCollider(model), solidCollider(SURVEY.stationShed)];
  for (const x of [-15.8, -11.3, -6.8, -2.3, 2.2, 6.7, 11.2, 15.2]) {
    const z = -7.69;
    const p = worldPoint(model, x, z);
    const rail = nearbyRailHeightAt(p.x, p.z, 7);
    const base = (rail === undefined ? terrainHeightAt(p.x, p.z) : rail + 0.89) - model.baseY - 0.055;
    station.box(x, (base + 3.1) / 2, z, 0.16, 3.1 - base, 0.16, GREEN);
    station.box(x, base + 0.11, z, 0.23, 0.23, 0.23, STONE);
    station.beam([x, 2.51, z], [x, 3.08, -8.25], 0.105, 0.125, GREEN);
    station.beam([x, 2.51, z], [x, 3.48, -6.46], 0.105, 0.125, GREEN);
    station.beam([x, 3.12, -8.42], [x, 3.78, -4.1], 0.085, 0.12, GREEN);
    colliders.push({ minX: p.x - 0.12, minZ: p.z - 0.12, maxX: p.x + 0.12, maxZ: p.z + 0.12,
      minY: model.baseY + base, maxY: model.baseY + 3.12 });
  }

  // Smaller entrance canopy facing Museumplein, with an open approach below.
  station.panel([[4.55, 3.32, 6.85], [11.19, 3.32, 6.85], [11.19, 3.62, 5.04], [4.55, 3.62, 5.04]], DARK_TILE, 2);
  station.panel([[4.55, 3.55, 5.04], [11.19, 3.55, 5.04], [11.19, 3.24, 6.85], [4.55, 3.24, 6.85]], BUFF);
  station.box(7.87, 3.29, 6.85, 6.79, 0.14, 0.12, GREEN);
  for (const x of [5.02, 10.7]) {
    station.beam([x, 2.71, 5.1], [x, 3.23, 6.73], 0.12, 0.12, GREEN);
  }
  place(target, model, station.mesh());

  const shed = buildBatch('Station service shed');
  shed.survey(SURVEY.stationShed, BRICK, DARK_TILE, DARK_TILE);
  foundation(shed, [[-3.05, 1.45], [-3.30, -2.11], [2.91, -2.14], [2.92, 1.43]], -0.38, 0.24, STONE);
  opening(shed.face(0, 1.45), -0.72, 0.37, 1.01, 1.96, { rise: 0.12, frame: GREEN, fill: DOOR, rows: 1 });
  place(target, SURVEY.stationShed, shed.mesh());
  stationSign(target, model, 'Station Ede Centrum', 7.94, 4.07, 5.139, 0, 2.37, 0.39, '#ddd4ba', '#3c423f');
  stationSign(target, model, 'Ede Centrum', -7.1, 2.86, -8.64, Math.PI, 2.38, 0.36, '#155383', '#f8f8f1');
  target.userData.colliders = colliders;
  return target;
}

export function createHuisKernhem() {
  const target = new THREE.Group();
  target.name = 'Huis Kernhem';
  const house = buildBatch('Kernhem house');
  house.survey(SURVEY.house, HOUSE_BRICK, 0x64524b, 0x5b5c57);
  foundation(house, [[-10.17, 8.14], [-10.09, -8.19], [10.31, -8.15], [10.31, 8.16]], -0.43, 0.35, STONE);
  const front = house.face(0, 8.194);
  const back = house.face(Math.PI, 8.21);
  for (const facade of [front, back]) {
    for (const x of [-8.03, -4.04, 0.04, 4.07, 8.06]) {
      opening(facade, x, 5.37, 1.44, 1.78, { frame: CREAM, rows: 2 });
      if (Math.abs(x) > 1) opening(facade, x, 1.04, 1.43, 3.1, { frame: CREAM, rows: 4 });
    }
    facade.box(0.04, 8.12, 0.12, 20.62, 0.32, 0.36, CREAM);
    facade.box(0.04, 8.31, 0.20, 20.7, 0.115, 0.45, CREAM);
  }
  for (const [side, plane] of [[1, 10.33], [-1, 10.25]]) {
    const wall = house.face(side * Math.PI / 2, plane);
    for (const x of [-5.48, 0.12, 5.49]) {
      opening(wall, x, 1.15, 1.45, 2.97, { frame: CREAM, rows: 4 });
      opening(wall, x, 5.37, 1.40, 1.82, { frame: CREAM, rows: 2 });
    }
    wall.box(0, 8.13, 0.08, 16.53, 0.28, 0.36, CREAM);
  }
  opening(back, 0.04, 0.44, 1.62, 3.26, { frame: CREAM, fill: DOOR, rows: 2 });
  opening(front, 0.04, 0.42, 1.91, 3.69, { frame: CREAM, fill: DOOR, rows: 2 });
  for (const x of [-1.28, 1.36]) {
    front.box(x, 2.28, 0.16, 0.37, 3.77, 0.35, CREAM);
    front.box(x, 0.55, 0.18, 0.48, 0.19, 0.39, BUFF);
    front.box(x, 4.18, 0.18, 0.51, 0.19, 0.45, CREAM);
  }
  front.box(0.04, 4.44, 0.33, 3.50, 0.28, 0.7, CREAM);
  front.box(0.04, 4.25, 0.26, 3.21, 0.14, 0.45, BUFF);
  for (let i = -4; i <= 4; i++) front.box(0.04 + i * 0.34, 4.41, 0.72, 0.105, 0.16, 0.045, 0xaa906f);
  front.box(0.04, 0.17, 0.48, 3.73, 0.22, 0.99, 0x77736d);
  front.box(0.04, 0.29, 0.25, 3.49, 0.19, 0.58, 0x908675);

  // Fronton and its small raised stone shield. The tall door surround follows the historic photograph.
  front.panel([[-4.05, 8.39, 0.085], [4.15, 8.39, 0.085], [0.04, 10.45, 0.085]], HOUSE_BRICK, 1);
  house.beam([-4.15, 8.41, 8.35], [0.04, 10.57, 8.35], 0.17, 0.20, CREAM);
  house.beam([0.04, 10.57, 8.35], [4.24, 8.41, 8.35], 0.17, 0.20, CREAM);
  front.box(0.04, 9.39, 0.16, 1.14, 0.61, 0.09, 0x9e8971);
  front.panel([[-0.19, 9.55, 0.233], [-0.19, 9.31, 0.233], [0.04, 9.18, 0.233],
    [0.24, 9.31, 0.233], [0.24, 9.55, 0.233]], CREAM);
  for (const x of [-0.35, 0.43]) front.box(x, 9.42, 0.222, 0.18, 0.35, 0.045, BUFF);
  for (const [x, z] of [[-7.12, 5.3], [7.12, 5.3], [-7.12, -4.95], [7.12, -4.95]]) {
    house.box(x, 11.81, z, 0.9, 1.58, 0.78, HOUSE_BRICK);
    house.box(x, 12.64, z, 1.03, 0.14, 0.93, CREAM);
  }
  place(target, SURVEY.house, house.mesh());

  const coach = buildBatch('Kernhem coach house');
  coach.survey(SURVEY.coach, COACH_BRICK, 0x92654e, DARK_TILE);
  const gable = coach.face(0, 12.09);
  const rear = coach.face(Math.PI, 12.075);
  for (const [wall, centre] of [[gable, 1.05], [rear, -1.27]]) {
    for (const [x, w] of [[-3.73, 1.2], [0, 1.98], [3.66, 1.16]]) {
      opening(wall, centre + x, 0.57, w, 2.28, { frame: GREEN, shutters: true, rows: 3 });
    }
    for (const x of [-2.8, 0, 2.72]) opening(wall, centre + x, x === 0 ? 4.93 : 4.63, 0.94, x === 0 ? 1.39 : 1.16, {
      frame: GREEN, shutters: x === 0, columns: 1, rows: 2,
    });
    wall.box(centre + 0.1, 0.14, 0.035, 11.43, 0.37, 0.17, 0x4c4c45);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
      const x = centre + (i - (3 - row) / 2) * 0.55;
      wall.box(x, 7.14 + row * 0.42, 0.058, 0.16, 0.20, 0.055, 0x433d32);
    }
  }
  const north = coach.face(Math.PI / 2, 6.999);
  for (const x of [-8.87, -5.5, -2.21, 2.39, 5.64, 9.02]) {
    opening(north, x, 0.63, 1.23, 2.28, { frame: GREEN, shutters: true, rows: 3 });
  }
  opening(north, 0.14, 0.19, 1.54, 2.72, { frame: GREEN, fill: DOOR, rows: 2 });
  north.box(0, 0.19, 0.030, 24.02, 0.34, 0.12, 0x4c4c45);
  const terrace = coach.face(-Math.PI / 2, 8.96);
  for (const x of [1.25, 3.8, 6.35, 8.9]) opening(terrace, x, 0.59, 1.58, 2.10, { frame: GREEN, rows: 2 });
  terrace.box(5.54, 0.19, 0.02, 10.9, 0.34, 0.16, 0x4c4c45);
  coach.box(1.37, 9.71, -3.25, 0.52, 0.70, 0.51, BRICK);
  coach.box(1.37, 10.11, -3.25, 0.68, 0.11, 0.67, DARK_TILE);
  place(target, SURVEY.coach, coach.mesh());
  target.userData.colliders = [solidCollider(SURVEY.house), solidCollider(SURVEY.coach)];
  return target;
}
