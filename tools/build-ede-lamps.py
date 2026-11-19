#!/usr/bin/env python3
"""Refresh the checked-in Ede lamp-post coordinates from PDOK BGT."""

import json
from pathlib import Path
import struct
import subprocess
from urllib.parse import urlencode

from ede_map import load_scene

ROOT = Path(__file__).resolve().parents[1]
PDOK = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/paal/items'


def main():
    meta = load_scene()['meta']
    south, west, north, east = meta['geographicBounds']
    affine = meta['lonLatAffine']
    url = PDOK + '?' + urlencode({'bbox': f'{west},{south},{east},{north}', 'limit': 1000, 'f': 'json'})

    poles = {}
    pages = set()
    while url:
        if url in pages:
            raise ValueError('PDOK returned a repeated page')
        pages.add(url)
        page = json.loads(subprocess.check_output(['curl', '-fsSL', '--max-time', '20', '--retry', '2', url]))
        for feature in page['features']:
            props = feature['properties']
            if (props['plus_type'] != 'lichtmast' or props['status'] != 'bestaand'
                    or props['termination_date'] or props['eind_registratie']):
                continue
            geometry = feature['geometry']
            if geometry['type'] != 'Point':
                raise ValueError('Expected lamp-post Point geometry from PDOK')
            lon, lat = geometry['coordinates']
            if not (west <= lon <= east and south <= lat <= north):
                raise ValueError(f'Lamp post outside the requested Ede bounds: {lon}, {lat}')
            dx, dy = lon - affine['lon0'], lat - affine['lat0']
            point = tuple(round(5 * (offset + a * dx + b * dy)) for offset, a, b in (affine['x'], affine['z']))
            key = props['lokaal_id'], props['version']
            poles[key] = point
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)

    if not poles:
        raise ValueError('PDOK returned no active lamp posts in Ede')
    data = b'EDL1' + struct.pack('<I', len(poles))
    data += b''.join(struct.pack('<hh', *point) for point in sorted(poles.values()))
    target = ROOT / 'assets' / 'ede-lamps.bin'
    temp = target.with_suffix('.tmp')
    temp.write_bytes(data)
    temp.replace(target)
    print(f'{len(poles):,} BGT lamp posts in {target.relative_to(ROOT)} ({len(data):,} bytes)')


if __name__ == '__main__':
    main()
