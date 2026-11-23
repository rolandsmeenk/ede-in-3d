// EDT1 through EDT4 store tree records in the existing Oude Kerk scene frame.
// Records hold x/z in 20 cm steps, height in decimetres and trunk diameter in centimetres.
export function decodeEdeTrees(buffer) {
  const view = new DataView(buffer);
  const invalid = () => new Error('Invalid Ede tree asset');
  if (view.byteLength < 8) throw invalid();
  const magic = view.getUint32(0, true);
  const wide = magic === 0x34544445;
  const expanded = wide || magic === 0x33544445;
  const hasCrowns = expanded || magic === 0x32544445;
  if (!hasCrowns && magic !== 0x31544445) throw invalid();
  const count = view.getUint32(4, true);
  const coordinates = wide ? 8 : 4;
  const recordSize = coordinates + 5;
  const maxRecordSize = recordSize + (expanded ? 2 : Number(hasCrowns));
  if (!count || view.byteLength < 8 + count * recordSize || view.byteLength > 8 + count * maxRecordSize) throw invalid();

  const trees = new Array(count);
  let offset = 8;
  for (let i = 0; i < count; i++) {
    if (offset + recordSize > view.byteLength) throw invalid();
    const fields = offset + coordinates;
    const species = view.getUint8(fields + 3), sources = view.getUint8(fields + 4);
    if ((species > 3 && species !== 255) || sources < 1 || sources > (expanded ? 255 : hasCrowns ? 15 : 7)) throw invalid();
    const crown = Boolean(sources & (expanded ? 72 : 8));
    const group = Boolean(sources & 128);
    const next = offset + recordSize + Number(crown) + Number(group);
    if (next > view.byteLength) throw invalid();
    const seasonGroup = group ? view.getUint8(next - 1) : undefined;
    if (seasonGroup > 7) throw invalid();
    trees[i] = {
      x: (wide ? view.getInt32(offset, true) : view.getInt16(offset, true)) / 5,
      z: (wide ? view.getInt32(offset + 4, true) : view.getInt16(offset + 2, true)) / 5,
      height: view.getUint16(fields, true) / 10,
      trunkDiameter: view.getUint8(fields + 2) / 100,
      species,
      sources,
      ...(crown ? { crownWidth: view.getUint8(offset + recordSize) / 10 } : {}),
      ...(group ? { seasonGroup } : {})
    };
    offset = next;
  }
  if (offset !== view.byteLength) throw invalid();
  return trees;
}

export async function loadEdeTrees(inventory = 'expanded') {
  async function read(asset) {
    const response = await fetch(new URL(asset, import.meta.url));
    if (!response.ok) throw new Error(`Ede tree data request failed: ${response.status}`);
    return decodeEdeTrees(await response.arrayBuffer());
  }
  if (inventory === 'expanded') {
    try {
      const [records, canopyDensity] = await Promise.all([
        read('../assets/ede-trees-expanded.bin?v=20261123-municipality'), loadWoodlandCanopyDensity(),
      ]);
      return { inventory: 'expanded', records, canopyDensity };
    } catch (error) {
      console.warn('[trees] using baseline inventory:', error);
    }
  }
  return { inventory: 'baseline', records: await read('../assets/ede-trees.bin') };
}

async function loadWoodlandCanopyDensity() {
  try {
    const response = await fetch(new URL('../assets/ede-tree-canopy-v1.json', import.meta.url));
    if (!response.ok) return undefined;
    const data = await response.json();
    if (data.version !== 1 || data.tileMeters !== 200 || !Array.isArray(data.cells)) return undefined;
    const density = new Map();
    for (const [x, z, fraction] of data.cells) {
      if (Number.isInteger(x) && Number.isInteger(z) && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
        density.set(`${x}/${z}`, Math.max(0.28, Math.min(1, fraction / 0.9)));
      }
    }
    return density;
  } catch (error) {
    console.warn('[trees] using procedural woodland density:', error);
    return undefined;
  }
}

function randomAt(x, z, salt) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + salt) * 43758.5453;
  return value - Math.floor(value);
}

export function edeTreeSite(tree, groundY) {
  const { x, z, trunkDiameter, crownWidth } = tree;
  const type = randomAt(x, z, 19);
  const species = tree.species !== 255 ? tree.species
    : type < 0.56 ? 0 : type < 0.74 ? 1 : type < 0.98 ? 2 : 3;
  // Unknown sizes get repeatable variation from young trees to mature crowns.
  const height = tree.height || 3.5 + 19 * randomAt(x, z, 47) ** 1.65;
  return {
    x, y: groundY + 0.09, z, height, trunkDiameter, crownWidth, species,
    priority: Boolean(tree.sources & 8),
    // Unknown inventory trees keep generic phenology, independent of their procedural shape.
    seasonGroup: tree.seasonGroup ?? [4, 2, 6, 1][tree.species] ?? 0,
    yaw: randomAt(x, z, 83) * Math.PI * 2,
    tier: tree.height >= 17 ? 0 : height >= 11 ? 1 : 2
  };
}
