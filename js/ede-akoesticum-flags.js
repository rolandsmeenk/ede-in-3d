import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';
import { trackWind } from './ede-wind-props.js';

// Six masts on the garden side of the paved forecourt, fitted to PDOK 2026 RGB.
const bases = [[203.0, 1932.0], [202.3, 1934.7], [201.6, 1937.4],
  [200.9, 1940.1], [200.2, 1942.8], [199.5, 1945.5]];
const poleHeight = 6.5;
const flagWidth = 1.18, flagHeight = 3.06;

export function createAkoesticumFlags() {
  const fixed = new CivicBatch();
  const cloth = [0x8d76ad, 0xaacaaf].map(color =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.92, side: THREE.DoubleSide }));
  const boomGeometry = new THREE.CylinderGeometry(0.019, 0.019, flagWidth + 0.11, 5)
    .rotateZ(-Math.PI / 2).translate((flagWidth + 0.11) / 2, 0, 0);
  const boomMaterial = new THREE.MeshStandardMaterial({ color: 0xcdd0cc, roughness: 0.68 });

  const banners = bases.map(([x, z], index) => {
    const ground = terrainHeightAt(x, z);
    fixed.solid(new THREE.CylinderGeometry(0.042, 0.067, poleHeight, 7)
      .translate(x, ground + poleHeight / 2 - 0.05, z), 0xdedfd9);
    fixed.solid(new THREE.CylinderGeometry(0.088, 0.083, 0.044, 9)
      .translate(x, ground + poleHeight - 0.03, z), 0xe58c48);

    const holder = new THREE.Group();
    holder.position.set(x, ground + poleHeight - 0.15, z);
    holder.rotation.y = 1.35;
    holder.name = 'Akoesticum vertical banner';
    holder.userData.nearDetail = true;
    holder.add(new THREE.Mesh(boomGeometry, boomMaterial));
    const geometry = new THREE.PlaneGeometry(flagWidth, flagHeight, 6, 10);
    const vertices = geometry.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
    const uv = geometry.getAttribute('uv');
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.65, -1.53, 0), 1.8);
    holder.add(new THREE.Mesh(geometry, cloth[index % 2]));
    let phase = index * 1.31, previousSway;
    function deform(dt, speed) {
      const sway = Math.min(speed, 9) / 9;
      if (sway === 0 && previousSway === 0) return;
      previousSway = sway;
      phase = (phase + dt * (2 + sway * 5)) % (Math.PI * 2);
      for (let i = 0; i < vertices.count; i++) {
        const u = uv.getX(i), down = 1 - uv.getY(i);
        const x = 0.072 + u * flagWidth * (1 - down * (0.28 - 0.18 * sway));
        const z = u * down * (0.07 * Math.sin(8 * u - 3 * down)
          + sway * 0.22 * Math.sin(phase - 5 * down - 3 * u));
        vertices.setXYZ(i, x, -down * flagHeight, z);
      }
      vertices.needsUpdate = true;
      geometry.computeVertexNormals();
    }
    deform(0, 0);
    return trackWind(holder, { downwind: true, deform });
  });
  const group = makeGroup('Akoesticum flagpoles', fixed, []);
  group.children[0].castShadow = false;
  group.add(...banners);
  return group;
}
