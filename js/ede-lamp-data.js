// EDL3 widens the 20 cm scene coordinates to cover the expanded municipality.
export function decodeEdeLamps(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 8) throw new Error('Invalid Ede lamp-post asset');
  const magic = view.getUint32(0, true);
  const expanded = magic === 0x334c4445;
  const packed = expanded || magic === 0x324c4445;
  if (!packed && magic !== 0x314c4445) throw new Error('Invalid Ede lamp-post asset');
  const stride = expanded ? 18 : packed ? 14 : 4;
  const count = view.getUint32(4, true);
  if (!count || view.byteLength !== 8 + count * stride) {
    throw new Error('Invalid Ede lamp-post asset length');
  }
  return Array.from({ length: count }, (_, i) => {
    const offset = 8 + i * stride;
    const x = (expanded ? view.getInt32(offset, true) : view.getInt16(offset, true)) / 5;
    const z = (expanded ? view.getInt32(offset + 4, true) : view.getInt16(offset + 2, true)) / 5;
    if (!packed) return { x, z };
    const attributes = offset + (expanded ? 8 : 4);
    const angle = view.getUint16(attributes + 2, true) * (2 * Math.PI / 65536);
    const flags = view.getUint8(attributes + 8);
    return { x, z, baseY: view.getInt16(attributes, true) / 100, nx: Math.cos(angle), nz: Math.sin(angle),
      targetY: view.getInt16(attributes + 4, true) / 100, height: view.getUint16(attributes + 6, true) / 100,
      led: Boolean(flags & 1), surveyed: Boolean(flags & 2), fitted: Boolean(flags & 4), doubleArm: Boolean(flags & 8),
      layer: view.getInt8(attributes + 9) };
  });
}

export async function loadEdeLamps() {
  const response = await fetch(new URL('../assets/ede-lamps.bin.gz?v=20261122-safari-cache', import.meta.url));
  if (!response.ok) throw new Error(`Ede lamp-post data request failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 31 || bytes[1] !== 139) return decodeEdeLamps(bytes.buffer);
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  return decodeEdeLamps(await new Response(stream).arrayBuffer());
}
