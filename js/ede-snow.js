import * as THREE from 'three/webgpu';
import { color, diffuseColor, float, Fn, If, ivec2, materialMetalness, materialRoughness, mix,
  mx_noise_float, normalWorldGeometry, positionWorld, smoothstep, step, textureLoad, textureSize, uniform,
  vec2 } from 'three/tsl';
import { polygonContains } from './building-collision.js';

export const snowCover = uniform(0);
export const snowBuildup = (retention = 1) => smoothstep(0.02, 0.80, snowCover.mul(retention));

const SAMPLES_PER_METRE = 2;
const TILE_SIZE = 32;
const ATLAS_COLUMNS = 32;
const OPEN_SKY = -10000;
const tileOrigin = uniform(new THREE.Vector2());

function heightTexture(initial) {
  return new THREE.DataTexture(new Float32Array([initial]), 1, 1, THREE.RedFormat, THREE.FloatType);
}

const directory = heightTexture(0);
const heights = heightTexture(OPEN_SKY);

export function setSnowShelters(covers) {
  const tiles = new Map();
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  // Only bake occupied 16 m tiles, at half-metre spacing, so small isolated roofs stay cheap.
  for (const cover of covers) {
    const xEnd = Math.ceil(cover.maxX * SAMPLES_PER_METRE);
    const zEnd = Math.ceil(cover.maxZ * SAMPLES_PER_METRE);
    for (let iz = Math.floor(cover.minZ * SAMPLES_PER_METRE); iz < zEnd; iz++) {
      const z = (iz + 0.5) / SAMPLES_PER_METRE;
      const tileZ = Math.floor(iz / TILE_SIZE);
      for (let ix = Math.floor(cover.minX * SAMPLES_PER_METRE); ix < xEnd; ix++) {
        const x = (ix + 0.5) / SAMPLES_PER_METRE;
        if (!polygonContains(cover, x, z)) continue;
        const y = cover.height(x, z);
        if (!Number.isFinite(y)) continue;
        const tileX = Math.floor(ix / TILE_SIZE);
        const key = tileX + '/' + tileZ;
        let tile = tiles.get(key);
        if (!tile) {
          tile = { x: tileX, z: tileZ, data: new Float32Array(TILE_SIZE * TILE_SIZE).fill(OPEN_SKY) };
          tiles.set(key, tile);
          minX = Math.min(minX, tileX);
          minZ = Math.min(minZ, tileZ);
          maxX = Math.max(maxX, tileX);
          maxZ = Math.max(maxZ, tileZ);
        }
        const cell = (iz - tileZ * TILE_SIZE) * TILE_SIZE + ix - tileX * TILE_SIZE;
        tile.data[cell] = Math.max(tile.data[cell], y);
      }
    }
  }

  const width = tiles.size ? maxX - minX + 1 : 1;
  const height = tiles.size ? maxZ - minZ + 1 : 1;
  const columns = Math.min(ATLAS_COLUMNS, Math.max(1, tiles.size));
  const atlasWidth = columns * TILE_SIZE;
  const atlasHeight = Math.max(1, Math.ceil(tiles.size / columns)) * TILE_SIZE;
  const tileIndices = new Float32Array(width * height);
  const samples = new Float32Array(atlasWidth * atlasHeight);
  let index = 0;
  for (const tile of tiles.values()) {
    tileIndices[(tile.z - minZ) * width + tile.x - minX] = index + 1;
    const x = (index % columns) * TILE_SIZE;
    const z = Math.floor(index / columns) * TILE_SIZE;
    for (let row = 0; row < TILE_SIZE; row++) {
      samples.set(tile.data.subarray(row * TILE_SIZE, (row + 1) * TILE_SIZE), (z + row) * atlasWidth + x);
    }
    index++;
  }
  tileOrigin.value.set(tiles.size ? minX : 0, tiles.size ? minZ : 0);
  directory.image = { data: tileIndices, width, height };
  directory.needsUpdate = true;
  heights.image = { data: samples, width: atlasWidth, height: atlasHeight };
  heights.needsUpdate = true;
}

const skyExposure = Fn(() => {
  const sample = positionWorld.xz.mul(SAMPLES_PER_METRE).floor().toVar();
  const tile = sample.div(TILE_SIZE).floor().toVar();
  const lookup = ivec2(tile.sub(tileOrigin)).toVar();
  const size = ivec2(textureSize(textureLoad(directory))).toVar();
  const exposure = float(1).toVar();
  If(lookup.x.greaterThanEqual(0).and(lookup.y.greaterThanEqual(0))
    .and(lookup.x.lessThan(size.x)).and(lookup.y.lessThan(size.y)), () => {
    const page = textureLoad(directory, lookup).r.sub(1).toVar();
    If(page.greaterThanEqual(0), () => {
      const columns = float(textureSize(textureLoad(heights)).x).div(TILE_SIZE);
      const atlasTile = vec2(page.mod(columns), page.div(columns).floor());
      const cell = ivec2(atlasTile.sub(tile).mul(TILE_SIZE).add(sample));
      // Use the soffit, so the deck can collect snow while the ground below stays clear.
      exposure.assign(step(textureLoad(heights, cell).r.sub(0.02), positionWorld.y));
    });
  });
  return exposure;
})();

export function surfaceSnowCoverage({ shelter = false, exposure = 1, retention = 1, up = normalWorldGeometry.y } = {}) {
  return Fn(() => {
    const snow = float(0).toVar();
    If(snowCover.greaterThan(0), () => {
      const slope = smoothstep(0.18, 0.90, up).toVar();
      If(slope.greaterThan(0).and(float(exposure).greaterThan(0)), () => {
        snow.assign(snowBuildup(retention).mul(slope).mul(exposure).mul(shelter ? skyExposure : 1));
      });
    });
    return snow;
  })().toVar();
}

function snowNodes(options) {
  const amount = surfaceSnowCoverage(options);
  return {
    amount, roughness: mix(materialRoughness, 0.95, amount), metalness: mix(materialMetalness, 0, amount),
  };
}

const openSnow = snowNodes();
const shelteredSnow = snowNodes({ shelter: true });

export function applySnowMaterial(material, { shelter = false, exposure = 1, retention = 1, up } = {}) {
  if (material.snowCoverageNode) return material;
  const { amount, roughness, metalness } = exposure === 1 && retention === 1 && up === undefined
    ? (shelter ? shelteredSnow : openSnow)
    : snowNodes({ shelter, exposure, retention, up });
  // Blend after Three.js has applied vertex and instance colors.
  material.snowCoverageNode = amount;
  const setupDiffuseColor = material.setupDiffuseColor;
  material.setupDiffuseColor = function (builder) {
    setupDiffuseColor.call(this, builder);
    If(amount.greaterThan(0), () => {
      // Shade small changes in thickness without opening gaps in the snow.
      const thicknessShade = mx_noise_float(positionWorld.xz.mul(0.24), 0.045, 1);
      diffuseColor.rgb.assign(mix(diffuseColor.rgb, color(0xe6edf2).mul(thicknessShade), amount));
    });
  };
  if (material.isMeshStandardNodeMaterial) {
    material.roughnessNode = material.roughnessNode ? mix(material.roughnessNode, 0.95, amount) : roughness;
    material.metalnessNode = material.metalnessNode ? mix(material.metalnessNode, 0, amount) : metalness;
  }
  if (material.emissiveNode) material.emissiveNode = material.emissiveNode.mul(amount.oneMinus());
  return material;
}

export function applySnowToModel(model) {
  const materials = new WeakMap();
  let library;
  function snowMaterial(material) {
    if (materials.has(material)) return materials.get(material);
    let result = material;
    if (!material.transparent && material.colorWrite && material.depthWrite && !material.transmission &&
        !material.transmissionNode && !material.fragmentNode && !material.outputNode &&
        (material.isMeshStandardMaterial || material.isMeshStandardNodeMaterial ||
          material.isMeshLambertMaterial || material.isMeshLambertNodeMaterial ||
          material.isMeshPhongMaterial || material.isMeshPhongNodeMaterial)) {
      if (!material.isNodeMaterial) {
        library ??= new THREE.StandardNodeLibrary();
        result = library.fromMaterial(material);
      }
      applySnowMaterial(result, { shelter: true });
    }
    materials.set(material, result);
    return result;
  }
  model.traverse(mesh => {
    if (mesh.isMesh && mesh.userData.snow !== false) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(snowMaterial) : snowMaterial(mesh.material);
    }
  });
}
