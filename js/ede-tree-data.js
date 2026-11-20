// EDT1 and EDT2 store compact tree records in the existing Oude Kerk scene frame.
// Records hold x/z in 20 cm steps, height in decimetres and trunk diameter in centimetres.
export function decodeEdeTrees(buffer) {
  const view = new DataView(buffer);
  const invalid = () => new Error('Invalid Ede tree asset');
  if (view.byteLength < 8) throw invalid();
  const magic = view.getUint32(0, true);
  const hasCrowns = magic === 0x32544445;
  if (!hasCrowns && magic !== 0x31544445) throw invalid();
  const count = view.getUint32(4, true);
  if (!count || view.byteLength < 8 + count * 9 || view.byteLength > 8 + count * (hasCrowns ? 10 : 9)) throw invalid();

  const trees = new Array(count);
  let offset = 8;
  for (let i = 0; i < count; i++) {
    if (offset + 9 > view.byteLength) throw invalid();
    const species = view.getUint8(offset + 7), sources = view.getUint8(offset + 8);
    if ((species > 3 && species !== 255) || sources < 1 || sources > (hasCrowns ? 15 : 7)) throw invalid();
    const surveyed = Boolean(sources & 8);
    if (surveyed && offset + 10 > view.byteLength) throw invalid();
    trees[i] = {
      x: view.getInt16(offset, true) / 5,
      z: view.getInt16(offset + 2, true) / 5,
      height: view.getUint16(offset + 4, true) / 10,
      trunkDiameter: view.getUint8(offset + 6) / 100,
      species,
      sources,
      ...(surveyed ? { crownWidth: view.getUint8(offset + 9) / 10 } : {})
    };
    offset += surveyed ? 10 : 9;
  }
  if (offset !== view.byteLength) throw invalid();
  return trees;
}

export async function loadEdeTrees() {
  const response = await fetch(new URL('../assets/ede-trees.bin', import.meta.url));
  if (!response.ok) throw new Error(`Ede tree data request failed: ${response.status}`);
  return decodeEdeTrees(await response.arrayBuffer());
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
    yaw: randomAt(x, z, 83) * Math.PI * 2,
    tier: tree.height >= 17 ? 0 : height >= 11 ? 1 : 2
  };
}
