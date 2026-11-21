import * as THREE from 'three/webgpu';
import { color, mix, texture, uv } from 'three/tsl';
import { edeSpatialGroups } from './ede-geometry.js';

const CELL_WIDTH = 128;
const CELL_HEIGHT = 32;
const COLUMNS = 16;

// Preserve the existing sampled boards and cover streets the sample missed.
export function selectStreetNameSigns(candidates) {
  const sampled = [], names = new Set(), closest = new Map();
  for (const sign of candidates) {
    if (sign.sampled) {
      sampled.push(sign);
      names.add(sign.name);
    } else if (!closest.has(sign.name) || sign.distance < closest.get(sign.name).distance) {
      closest.set(sign.name, sign);
    }
  }
  return sampled.concat([...closest.values()].filter(sign => !names.has(sign.name)));
}

export function selectStreetNamePoles(segments, mounted, canPlace) {
  const covered = new Set(mounted.map(sign => sign.name));
  const poles = [];
  const candidates = segments.filter(({ road, len }) => len >= 2 && road.name && !covered.has(road.name)
    && !road.bridge && !road.tunnel && !road.layer && !/^(motorway|trunk|busway|steps)|_link$/.test(road.kind));
  // Try the longer runs first, with room to step away from junctions and driveways.
  for (const { a, len, road, ux, uz, width } of candidates.sort((a, b) => b.len - a.len)) {
    const name = road.name;
    if (covered.has(name)) continue;
    const site = roadsidePoleSite(a, len, ux, uz, width / 2, canPlace);
    if (!site) continue;
    covered.add(name);
    poles.push({ name, ...site, ux, uz });
  }
  return poles;
}

function roadsidePoleSite(a, len, ux, uz, halfWidth, canPlace) {
  for (const f of [0.5, 0.25, 0.75]) {
    const cx = a.x + ux * len * f, cz = a.z + uz * len * f;
    for (const margin of [0.65, 1.4, 2.5, 3.5]) {
      for (const side of [1, -1]) {
        const offset = side * (halfWidth + margin);
        const x = cx - uz * offset, z = cz + ux * offset;
        if (canPlace(x, z)) return { x, z };
      }
    }
  }
}

function paintAtlas(names) {
  const canvas = document.createElement('canvas');
  canvas.width = COLUMNS * CELL_WIDTH;
  canvas.height = Math.ceil(names.length / COLUMNS) * CELL_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.font = '600 17px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const bounds = new Map();
  names.forEach((name, i) => {
    const left = i % COLUMNS * CELL_WIDTH, top = Math.floor(i / COLUMNS) * CELL_HEIGHT;
    ctx.beginPath();
    ctx.roundRect(left + 3, top + 3, CELL_WIDTH - 6, CELL_HEIGHT - 6, 4);
    ctx.stroke();
    ctx.fillText(name, left + CELL_WIDTH / 2, top + CELL_HEIGHT / 2 + 1, CELL_WIDTH - 14);
    // A DataTexture treats the top row of the canvas as v = 0.
    bounds.set(name, [(left + 0.5) / canvas.width, (left + CELL_WIDTH - 0.5) / canvas.width,
      (top + 0.5) / canvas.height, (top + CELL_HEIGHT - 0.5) / canvas.height]);
  });
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[4 * i + 3];
  const atlas = new THREE.DataTexture(mask, canvas.width, canvas.height, THREE.RedFormat);
  atlas.magFilter = THREE.LinearFilter;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.generateMipmaps = true;
  atlas.needsUpdate = true;
  return { atlas, bounds };
}

export function addStreetNameSignBoards(group, signs) {
  if (!signs.length) return;
  const names = [...new Set(signs.map(sign => sign.name))];
  const { atlas, bounds } = paintAtlas(names);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  material.colorNode = mix(color(0x164780), color(0xffffff), texture(atlas, uv()).r);

  let first;
  for (const cell of edeSpatialGroups(signs)) {
    const positions = [], uvs = [], indices = [];
    for (const { name, x, y, z, ux, uz, width } of cell) {
      const [u0, u1, vTop, vBottom] = bounds.get(name);
      // Two readable faces, with their text upright when approached from either side.
      for (const side of [1, -1]) {
        const dx = ux * width / 2 * side, dz = uz * width / 2 * side;
        const px = x - uz * 0.014 * side, pz = z + ux * 0.014 * side;
        const start = positions.length / 3;
        positions.push(px - dx, y - 0.115, pz - dz, px + dx, y - 0.115, pz + dz,
          px + dx, y + 0.115, pz + dz, px - dx, y + 0.115, pz - dz);
        uvs.push(u0, vBottom, u1, vBottom, u1, vTop, u0, vTop);
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'EdeStreetNameBoards';
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = 180;
    if (first) mesh.userData.sharesPipelineWith = first;
    else first = mesh;
    group.add(mesh);
  }
}
