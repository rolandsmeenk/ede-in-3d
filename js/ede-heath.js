import { DataTexture, LinearFilter, RedFormat } from 'three/webgpu';

const STEP = 8;

export function rasterizeHeath(parks, bounds, landCover) {
  // One empty texel around the world keeps linear sampling clear beyond the map.
  const [west, north, east, south] = bounds;
  const minX = west - STEP, minZ = north - STEP;
  const width = Math.ceil((east - west) / STEP) + 2;
  const height = Math.ceil((south - north) / STEP) + 2;
  const pixels = new Uint8Array(width * height);
  const column = x => Math.ceil((x - minX) / STEP - 0.5);
  const row = z => Math.ceil((z - minZ) / STEP - 0.5);
  for (const park of parks) {
    if (park.kind !== 'heath' || park.ring.length < 6) continue;
    const crossings = new Map();
    for (const ring of [park.ring, ...(park.holes || [])]) {
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1];
        if (az === bz) continue;
        const first = Math.max(1, row(Math.min(az, bz)));
        const last = Math.min(height - 1, row(Math.max(az, bz)));
        for (let y = first; y < last; y++) {
          const x = ax + (bx - ax) * (minZ + (y + 0.5) * STEP - az) / (bz - az);
          if (!crossings.has(y)) crossings.set(y, []);
          crossings.get(y).push(x);
        }
      }
    }
    for (const [y, xs] of crossings) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i += 2) {
        const left = Math.max(1, column(xs[i - 1])), right = Math.min(width - 1, column(xs[i]));
        if (left < right) pixels.fill(255, y * width + left, y * width + right);
      }
    }
  }
  if (landCover) {
    const { image } = landCover.texture;
    const stepX = landCover.sizeX / image.width, stepZ = landCover.sizeZ / image.height;
    const endX = Math.min(width - 1, column(landCover.minX + landCover.sizeX));
    const endZ = Math.min(height - 1, row(landCover.minZ + landCover.sizeZ));
    for (let z = Math.max(1, row(landCover.minZ)); z < endZ; z++) {
      const sourceRow = Math.floor((minZ + (z + 0.5) * STEP - landCover.minZ) / stepZ);
      for (let x = Math.max(1, column(landCover.minX)); x < endX; x++) {
        const sourceColumn = Math.floor((minX + (x + 0.5) * STEP - landCover.minX) / stepX);
        const kind = image.data[sourceRow * image.width + sourceColumn];
        if (kind === 2) pixels[z * width + x] = 255;
        else if (kind === 1 || kind === 4 || kind === 5) pixels[z * width + x] = 0;
      }
    }
  }
  return { pixels, width, height, minX, minZ, sizeX: width * STEP, sizeZ: height * STEP };
}

export function createEdeHeathCover(parks, bounds, landCover) {
  const { pixels, width, height, ...extent } = rasterizeHeath(parks, bounds, landCover);
  const texture = new DataTexture(pixels, width, height, RedFormat);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return { texture, ...extent };
}
