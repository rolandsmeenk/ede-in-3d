#!/usr/bin/env python3
"""Bake the Stationsweg landmark shells from cached 3DBAG CityJSON items."""

import argparse
import gzip
import json
from pathlib import Path
import runpy
from urllib.request import urlopen

from ede_gis import Frame, SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
SURVEY = runpy.run_path(str(ROOT / 'tools/build-ede-public-survey.py'))['survey']
API = 'https://api.3dbag.nl/collections/pand/items'

# (BAG ID, OSM footprint, facade colour, roof colour)
BUILDINGS = {
    'by-honck': ('0228100000075195', 'w271573806', 0x92563b, 0x874d42),
    'regina': ('0228100000047496', 'w271573791', 0x925440, 0x874d42),
    'sonnevanck': ('0228100000059489', 'w271573321', 0x90513b, 0x874d42),
    'zuiderhoek': ('0228100000060688', 'w271573721', 0x965541, 0x874d42),
    'moeke': ('0228100000051877', 'w271574301', 0x884c39, 0x544942),
    'berg-en-dal': ('0228100000018265', 'w271510296', 0xc6bba8, 0x504745),
    'berg-oord': ('0228100000046222', 'w271510233', 0x8b5747, 0x4b4845),
    'molenaarswoning': ('0228100000010632', 'w271515051', 0x8d5341, 0x535254),
    'ca-ira': ('0228100000057108', 'w271510196', 0xe5dfd3, 0x4c4c4c),
    'richmond': ('0228100000036785', 'w271510245', 0xdcd4c4, 0x784d43),
    'moni-alendo': ('0228100000048033', 'w271573327', 0x8e503b, 0x5a5850),
    'courant': ('0228100000002293', 'w271510336', 0x8e7667, 0x4e4b48),
    'mulo': ('0228100000043543', 'w271510327', 0x886752, 0x605951),
}

# Scene approach points sit on the mapped street, facing the principal elevations.
SITES = (
    ('stationsweg-villas', 'By Honck · Regina · Sonnevanck · Zuiderhoek', 'Stationsweg',
     ('by-honck', 'regina', 'sonnevanck', 'zuiderhoek'), (-221.5, 735.5), (-220.8, 743.8)),
    ('moeke-ede', 'Moeke · Oud Politiebureau', 'Stationsweg', ('moeke',), (-156.5, 510.6), (-182.3, 489.1)),
    ('berg-en-dal', 'Villa Berg en Dal · Berg-Oord', 'Stationsweg', ('berg-en-dal', 'berg-oord'),
     (-169.4, 1145.0), (-146.0, 1144.7)),
    ('molenaarswoning-keetmolen', 'Molenaarswoning De Keetmolen', 'Stationsweg', ('molenaarswoning',),
     (-64.1, 1806.3), (-23.8, 1801.6)),
    ('villa-ca-ira', 'Villa Ça Ira', 'Stationsweg', ('ca-ira',), (-151.8, 989.9), (-173.9, 994.1)),
    ('villa-richmond', 'Villa Richmond', 'Stationsweg', ('richmond',), (-99.7, 1584.4), (-64.6, 1581.3)),
    ('villa-moni-alendo', 'Villa Moni Alendo', 'Stationsweg', ('moni-alendo',), (-202.9, 652.4), (-228.4, 647.3)),
    ('oude-edese-courant', 'Oude Edesche Courant · MULO', 'Stationsweg', ('courant', 'mulo'),
     (-249.6, 710.9), (-227.7, 706.8)),
)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-stationsweg-survey.js')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)

    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as packed:
        scene = json.load(packed)
    frame = Frame(scene['meta']['lonLatAffine'])
    mapped = {building['id'] for building in scene['buildings']}
    surveys = {}
    for key, (bag, osm, _, _) in BUILDINGS.items():
        if osm not in mapped:
            raise ValueError(f'Missing sourced OSM footprint {osm} for {bag}')
        path = args.cache / f'{bag}.json'
        if args.fetch and not path.is_file():
            with urlopen(f'{API}/NL.IMBAG.Pand.{bag}', timeout=30) as response:
                path.write_bytes(response.read())
        raw = json.loads(path.read_text())
        points, faces, outline = SURVEY({**raw, 'features': [raw['feature']]}, bag, frame)
        surveys[key] = (min(point[1] for point in points), points, faces, outline)

    lines = ['// 3DBAG LoD 2.2, © tudelft3d and 3DGI, CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
             f'// Ede scene metres, Y relative to {SCENE_NAP_ORIGIN} m NAP. Faces are 0 walls and 1 roofs.',
             'export const EDE_STATIONSWEG_LANDMARKS = [']
    for site, name, road, keys, (x, z), (ax, az) in SITES:
        primary, *annexes = [BUILDINGS[key][1] for key in keys]
        bags = [BUILDINGS[key][0] for key in keys]
        height = max(max(p[1] for p in points) - ground
                     for ground, points, _, _ in (surveys[key] for key in keys))
        lines += [
            f'  {{ id: {compact(site)}, name: {compact(name)}, district: "Stationsbuurt", road: {compact(road)},',
            f'    osmId: {compact(primary)}, annexOsmIds: {compact(annexes)}, bagIds: {compact(bags)},',
            f'    x: {x}, z: {z}, height: {height:.2f}, worldSpace: true, approach: {{ x: {ax}, z: {az} }} }},',
        ]
    lines += ['];', '', 'export const STATIONSWEG_SURVEYS = {']
    for key, (bag, _, wall, roof) in BUILDINGS.items():
        ground, points, faces, outline = surveys[key]
        lines += [f'  "{bag}": {{ bagId: "{bag}", ground: {ground}, wallColor: {wall:#08x}, roofColor: {roof:#08x},',
                  f'    outline: {compact(outline)},']
        if key == 'richmond':
            # The 2021 extension has charcoal roofing behind the red tile villa.
            dark_roofs = {}
            for i, (kind, outer, *_) in enumerate(faces):
                if kind == 1:
                    east = sum(points[j][0] - 0.17 * (points[j][2] - 1589) for j in outer) / len(outer)
                    if east < -106.4:
                        dark_roofs[i] = 0x454d51
            lines.append(f'    roofColors: {compact(dark_roofs)},')
        lines.append('    points: [')
        lines += ['      ' + ', '.join(map(compact, points[i:i + 5])) + ',' for i in range(0, len(points), 5)]
        lines += ['    ],', '    faces: [']
        lines += ['      ' + ', '.join(map(compact, faces[i:i + 4])) + ',' for i in range(0, len(faces), 4)]
        lines += ['    ],', '  },']
    args.output.write_text('\n'.join([*lines, '};', '']), encoding='utf-8')


if __name__ == '__main__':
    main()
