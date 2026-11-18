import * as THREE from 'three/webgpu';
import { facadePoint } from './ede-facades.js';

const CELL = 96;
const NEAR = 112;
const FAR = 144;

export function buildFacadePhotos(parent, panels) {
  const cells = new Map(), atlases = new Map();
  for (const { frame, offset, photo } of panels) {
    const { file, range, rect } = photo;
    if (typeof file !== 'string' || !/^ede-facade-[a-z0-9-]+\.webp$/.test(file)
      || !Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)
      || !Array.isArray(range) || range.length !== 4 || !range.every(v => v >= 0 && v <= 1)) continue;
    const [x, y, width, height] = rect;
    const [u0, v0, u1, v1] = range;
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > frame.width + 0.03
      || y + height > frame.wall.height + 0.03 || u0 >= u1 || v0 >= v1) continue;
    const [cx, , cz] = facadePoint(frame, x + width / 2, y + height / 2);
    const key = `${Math.floor(cx / CELL)}/${Math.floor(cz / CELL)}/${file}`;
    if (!cells.has(key)) cells.set(key, { cx, cz, positions: [], uvs: [], file });
    const { positions, uvs } = cells.get(key);
    const corners = [[x,y,u0,v0], [x+width,y,u1,v0], [x+width,y+height,u1,v1], [x,y+height,u0,v1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [u, v, s, t] = corners[i];
      positions.push(...facadePoint(frame, u, v, offset + 0.018));
      uvs.push(s, t);
    }
  }
  if (!cells.size) return null;
  const loader = new THREE.TextureLoader();
  const stats = { tiles: cells.size, loaded: 0, visible: 0, textureBytes: 0, lastLoadMs: null };
  for (const cell of cells.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(cell.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(cell.uvs, 2));
    geometry.computeVertexNormals();
    const first = !atlases.has(cell.file);
    if (first) {
      // Compile once behind the loading screen using the same material and a transparent placeholder.
      const pixel = document.createElement('canvas');
      pixel.width = pixel.height = 1;
      const texture = new THREE.CanvasTexture(pixel);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.83, alphaTest: 0.8 });
      atlases.set(cell.file, { texture, material, started: false, ready: false });
    }
    const mesh = new THREE.Mesh(geometry, atlases.get(cell.file).material);
    mesh.name = 'EdeFacadePhotoTile';
    mesh.visible = first;
    mesh.castShadow = false; // The BAG walls and the recessed door already cast shadows.
    mesh.receiveShadow = true;
    parent.add(mesh);
    cell.mesh = mesh;
  }
  let lastX = Infinity, lastZ = Infinity;
  const update = ({ x, z }) => {
    if (Math.hypot(x - lastX, z - lastZ) < 4) return;
    lastX = x; lastZ = z;
    stats.visible = 0;
    for (const { cx, cz, mesh, file } of cells.values()) {
      const d = Math.hypot(cx - x, cz - z);
      const inRange = d <= (mesh.visible ? FAR : NEAR);
      const atlas = atlases.get(file);
      if (inRange && !atlas.started) {
        const started = performance.now();
        atlas.started = true;
        loader.loadAsync(new URL(`../assets/${file}`, import.meta.url).href).then(texture => {
          texture.colorSpace = THREE.SRGBColorSpace;
          atlas.material.map = texture;
          atlas.material.needsUpdate = true;
          atlas.texture.dispose();
          atlas.texture = texture;
          atlas.ready = true;
          stats.loaded++;
          stats.textureBytes += Math.ceil(texture.image.width * texture.image.height * 4 * 4 / 3);
          stats.lastLoadMs = performance.now() - started;
          lastX = lastZ = Infinity;
        }).catch(error => console.warn('[facades] photo atlas unavailable:', error));
      }
      mesh.visible = inRange && atlas.ready;
      if (mesh.visible) stats.visible++;
    }
  };
  return { update, stats };
}
