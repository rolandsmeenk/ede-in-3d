// Gelderland Beheergebied 2027 with the existing BGT and OSM cover as local fallbacks.
export const EDE_NATURE_BOUNDS = [2600, -5600, 10968, 2000];

const habitats = [null, 'woodland', 'dry-heath', 'grassland', 'damp-heath', 'sand', 'water'];

export function decodeEdeNatureHabitats(buffer) {
  if (buffer.byteLength < 24) throw new Error('Invalid Ede nature habitat header');
  const header = new DataView(buffer);
  if (header.getUint32(0) !== 0x454e4831) throw new Error('Invalid Ede nature habitat version');
  const width = header.getUint32(4, true), height = header.getUint32(8, true);
  const minX = header.getFloat32(12, true), minZ = header.getFloat32(16, true);
  const step = header.getFloat32(20, true);
  if (!width || !height || ![minX, minZ, step].every(Number.isFinite) || step <= 0 ||
      buffer.byteLength !== 24 + width * height) throw new Error('Invalid Ede nature habitat extent');
  const cells = new Uint8Array(buffer, 24);
  return (x, z) => {
    const col = Math.floor((x - minX) / step), row = Math.floor((z - minZ) / step);
    return col >= 0 && col < width && row >= 0 && row < height ? habitats[cells[row * width + col]] ?? null : null;
  };
}

export async function loadEdeNatureHabitats() {
  const result = await fetch(new URL('../assets/ede-nature-habitats.bin.gz', import.meta.url));
  if (!result.ok) throw new Error(`Ede nature habitat request failed: ${result.status}`);
  const bytes = await result.arrayBuffer();
  const packed = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  const data = packed[0] === 31 && packed[1] === 139
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : bytes;
  return decodeEdeNatureHabitats(data);
}

function rasterValue(raster, x, z) {
  if (!raster) return 0;
  const { minX, minZ, sizeX, sizeZ, texture: { image } } = raster;
  const u = (x - minX) / sizeX, v = (z - minZ) / sizeZ;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  return image.data[Math.floor(v * image.height) * image.width + Math.floor(u * image.width)];
}

const edgeOffsets = [[-16, 0], [16, 0], [0, -16], [0, 16]];

export function createEdeHabitatSampler(mapped, landCover, heath, woodland) {
  const [west, north, east, south] = EDE_NATURE_BOUNDS;
  const coverAt = (x, z) => {
    const census = mapped?.(x, z);
    if (census) return census;
    const ground = rasterValue(landCover, x, z);
    if (ground === 3) return 'mown-grass';
    if (ground === 1 || woodland?.coverAt(x, z)) return 'woodland';
    if (ground === 2 || rasterValue(heath, x, z) > 127) return 'dry-heath';
    return null;
  };

  return (x, z) => {
    if (x < west || x >= east || z < north || z >= south) return null;
    const habitat = coverAt(x, z);
    if (habitat === 'woodland' && edgeOffsets.some(([dx, dz]) => coverAt(x + dx, z + dz) !== 'woodland')) {
      return 'woodland-edge';
    }
    return habitat;
  };
}
