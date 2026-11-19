// EDL2 adds level, fixture flags, yaw and centimetre heights to the 20 cm positions.
export function decodeEdeLamps(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 8) throw new Error('Invalid Ede lamp-post asset');
  const magic = view.getUint32(0, true);
  const packed = magic === 0x324c4445;
  if (!packed && magic !== 0x314c4445) throw new Error('Invalid Ede lamp-post asset');
  const stride = packed ? 14 : 4;
  const count = view.getUint32(4, true);
  if (!count || view.byteLength !== 8 + count * stride) {
    throw new Error('Invalid Ede lamp-post asset length');
  }
  return Array.from({ length: count }, (_, i) => {
    const offset = 8 + i * stride;
    const x = view.getInt16(offset, true) / 5, z = view.getInt16(offset + 2, true) / 5;
    if (!packed) return { x, z };
    const angle = view.getUint16(offset + 6, true) * (2 * Math.PI / 65536);
    const flags = view.getUint8(offset + 12);
    return { x, z, baseY: view.getInt16(offset + 4, true) / 100, nx: Math.cos(angle), nz: Math.sin(angle),
      targetY: view.getInt16(offset + 8, true) / 100, height: view.getUint16(offset + 10, true) / 100,
      led: Boolean(flags & 1), surveyed: Boolean(flags & 2), fitted: Boolean(flags & 4),
      layer: view.getInt8(offset + 13) };
  });
}

export async function loadEdeLamps() {
  const response = await fetch(new URL('../assets/ede-lamps.bin.gz', import.meta.url));
  if (!response.ok) throw new Error(`Ede lamp-post data request failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 31 || bytes[1] !== 139) return decodeEdeLamps(bytes.buffer);
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  return decodeEdeLamps(await new Response(stream).arrayBuffer());
}
