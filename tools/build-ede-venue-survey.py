#!/usr/bin/env python3
"""Bake the three photo-fitted venue shells into the Oude Kerk scene frame."""

import argparse
import gzip
from hashlib import sha256
import json
from pathlib import Path
import struct
from urllib.parse import urlencode
from urllib.request import urlopen

from ede_gis import Frame

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.3dbag.nl/collections/pand/items'
SITES = (
    ('ree', 'REEHORST', '0228100000004736', 'w271472015', (174415, 448413, 174589, 448559)),
    ('buiten', 'BUITENZORG', '0228100000042682', 'w271549976', (174170, 451165, 174232, 451230)),
    ('johannus', 'JOHANNUS', '0228100000034171', 'w271177823', (171393, 448741, 171539, 448863)),
)
TYPES = {'WallSurface': 0, 'RoofSurface': 1}

def packed(value):
    return json.dumps(value, separators=(',', ':'))


def get_survey(cache, key, bag_id, bounds, frame, datum, fetch):
    path = cache / f'{key}-bag.json'
    if not path.exists() and fetch:
        query = urlencode({'bbox': ','.join(map(str, bounds)), 'limit': 50})
        with urlopen(f'{API}?{query}', timeout=45) as response:
            path.write_bytes(response.read())
    data = json.loads(path.read_text())
    metadata = data['metadata']
    if not metadata['metadata']['referenceSystem'].endswith('/7415'):
        raise ValueError(f'Unexpected 3DBAG CRS for {bag_id}')
    scale, offset = (metadata['transform'][field] for field in ('scale', 'translate'))
    identifier = f'NL.IMBAG.Pand.{bag_id}'
    feature = next(feature for feature in data['features'] if identifier in feature['CityObjects'])
    city = feature['CityObjects']
    building = city[identifier]
    points, faces = [], []
    for vertex in feature['vertices']:
        e, n, elevation = [p * s + t for p, s, t in zip(vertex, scale, offset)]
        x, z = frame.rd_to_scene(e, n)
        points.append([round(x, 2), round(elevation - datum, 2), round(z, 2)])
    geometry = next(surface for surface in building['geometry'] if surface['lod'] == '0')
    outlines = [[[points[i][0], points[i][2]] for i in surface[0]]
                for surface in geometry['boundaries']]
    for part in [building, *(city[part] for part in building.get('children', []))]:
        for geom in part['geometry']:
            if geom['lod'] != '2.2':
                continue
            semantics = geom['semantics']
            multisolids = geom['type'] == 'MultiSolid'
            solids = geom['boundaries'] if multisolids else [geom['boundaries']]
            surfaces = semantics['values'] if multisolids else [semantics['values']]
            for solid, shell_classes in zip(solids, surfaces):
                for shell, classes in zip(solid, shell_classes):
                    for rings, idx in zip(shell, classes):
                        kind = TYPES.get(semantics['surfaces'][idx]['type']) if idx is not None else None
                        if kind is not None and rings:
                            faces.append([kind, *rings])
    referenced = sorted({i for _, *rings in faces for ring in rings for i in ring})
    lookup = {old: new for new, old in enumerate(referenced)}
    return ([points[i] for i in referenced],
            [[kind, *[[lookup[i] for i in ring] for ring in rings]] for kind, *rings in faces], outlines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Cache containing the three CityJSON feature collections')
    parser.add_argument('--fetch', action='store_true', help='Fetch missing collections')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as scene:
        frame = Frame(json.load(scene)['meta']['lonLatAffine'])
    datum = round(struct.unpack_from('<f', (ROOT / 'assets/ede-ahn.bin').read_bytes(), 24)[0], 2)
    lines = ['// Local 3DBAG LoD 2.2 surveys, retrieved 2026-11-20.',
             f'// Vertices use the shared Oude Kerk frame and heights relative to {datum:.2f} m NAP.',
             '// Faces retain all classified wall/roof rings. Codes are 0 (wall) and 1 (roof).', '']
    for key, name, bag_id, osm_id, bounds in SITES:
        points, faces, outline = get_survey(args.cache, key, bag_id, bounds, frame, datum, args.fetch)
        lines += [f'// BAG {bag_id} · OSM {osm_id}', f'export const {name} = {{', '  vertices: [']
        lines += ['    ' + ', '.join(map(packed, points[i:i+5])) + ',' for i in range(0, len(points), 5)]
        lines += ['  ],', '  faces: [']
        lines += ['    ' + ', '.join(map(packed, faces[i:i+4])) + ',' for i in range(0, len(faces), 4)]
        lines += ['  ],', '  outline: ' + packed(outline) + ',', '};', '']
    target = ROOT / 'js/ede-venue-survey.js'
    output = '\n'.join(lines).encode()
    # The exterior masks use surveyed face indices. A new upstream shell needs
    # a re-fit before the bake can replace these geometry records.
    expected = '733fadb1c6896d85e05082146249bc72efd50dd8202752cf0a6502dd08e19d52'
    if sha256(output).hexdigest() != expected:
        raise ValueError('Survey differs from the reference bake. Recheck facade anchors before refreshing.')
    target.write_bytes(output)


if __name__ == '__main__':
    main()
