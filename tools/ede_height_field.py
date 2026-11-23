"""Read quantized AHN fields on the common Oude Kerk scene grid."""

from array import array
import gzip
import json
from pathlib import Path
import struct
from sys import byteorder

AHN_HEADER = struct.Struct('<4sIIffff')
TERRAIN_DIRECTORY = Path(__file__).resolve().parents[1] / 'assets/ede-terrain-tiles'


def expansion_collision_path(directory=TERRAIN_DIRECTORY):
    manifest = directory / 'manifest.json'
    if manifest.exists():
        data = json.loads(manifest.read_text())
        if data.get('version') == 2 and data.get('collisionFile') == 'collision.bin.gz':
            return directory / 'collision.bin.gz'
    return directory / 'collision.bin'


def read_height_field(path):
    data = path.read_bytes()
    if path.suffix == '.gz':
        data = gzip.decompress(data)
    if len(data) < AHN_HEADER.size:
        raise ValueError(f'Invalid AHN header: {path}')
    magic, columns, rows, x, z, step, nap = AHN_HEADER.unpack_from(data)
    if (magic not in (b'AHN1', b'AHN2') or columns < 2 or rows < 2 or step <= 0
            or len(data) != AHN_HEADER.size + rows * columns * 2):
        raise ValueError(f'Invalid AHN grid: {path}')
    heights = array('h')
    heights.frombytes(memoryview(data)[AHN_HEADER.size:])
    if byteorder != 'little':
        heights.byteswap()
    if magic == b'AHN2':
        for row in range(0, len(heights), columns):
            height = heights[row]
            for sample in range(row + 1, row + columns):
                height = ((height + heights[sample] + 32768) & 65535) - 32768
                heights[sample] = height
    return columns, rows, x, z, step, nap, heights
