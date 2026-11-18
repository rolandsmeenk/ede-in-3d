// EDL1 stores BGT pole positions in the Oude Kerk scene frame, in 20 cm steps.
export function decodeEdeLamps(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 8 || view.getUint32(0, true) !== 0x314c4445) {
    throw new Error('Invalid Ede lamp-post asset');
  }
  const count = view.getUint32(4, true);
  if (!count || view.byteLength !== 8 + count * 4) {
    throw new Error('Invalid Ede lamp-post asset length');
  }
  return Array.from({ length: count }, (_, i) => {
    const offset = 8 + i * 4;
    return { x: view.getInt16(offset, true) / 5, z: view.getInt16(offset + 2, true) / 5 };
  });
}

export async function loadEdeLamps() {
  const response = await fetch(new URL('../assets/ede-lamps.bin', import.meta.url));
  if (!response.ok) throw new Error(`Ede lamp-post data request failed: ${response.status}`);
  return decodeEdeLamps(await response.arrayBuffer());
}
