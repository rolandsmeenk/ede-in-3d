#!/usr/bin/env python3
"""Bake Hoekelum and Gasfabriek geometry from archived 3DBAG CityJSON collections."""
import argparse
import gzip
import json
from pathlib import Path
from statistics import mean
import struct
from urllib.parse import urlencode
from urllib.request import urlopen

from ede_gis import Frame

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.3dbag.nl/collections/pand/items'
ESTATES = {
    'hoekelum': ((174790, 447440, 174930, 447566), (
        ('castle', '0228100000039432'), ('coach', '0228100000005600'),
    )),
    'gas': ((174051, 450143, 174111, 450279), (
        ('works', '0228100000073672'), ('purifier', '0228100000000200'), ('wkeeper', '0228100000057655'),
    )),
}


def load_collection(cache, name, bounds, fetch):
    path = cache / f'{name}-city.json'
    if not path.exists() and fetch:
        query = urlencode({'bbox': ','.join(map(str, bounds)), 'limit': 50})
        with urlopen(f'{API}?{query}', timeout=45) as response:
            path.write_bytes(response.read())
    source = json.loads(path.read_text())
    if not source['metadata']['metadata']['referenceSystem'].endswith('/7415'):
        raise ValueError(f'Unexpected CRS in {path}: expected RD New with NAP height')
    return source


def shell_faces(geometry):
    semantics = geometry['semantics']
    multi = geometry['type'] == 'MultiSolid'
    solids = geometry['boundaries'] if multi else [geometry['boundaries']]
    labels = semantics['values'] if multi else [semantics['values']]
    for solid, solid_labels in zip(solids, labels):
        for shell, shell_labels in zip(solid, solid_labels):
            for sid, rings in zip(shell_labels, shell):
                if sid is not None and rings and len(rings[0]) >= 3:
                    yield semantics['surfaces'][sid]['type'], rings


def bake(source, bag, frame, datum):
    transform = source['metadata']['transform']
    identifier = 'NL.IMBAG.Pand.' + bag
    feature = next(item for item in source['features'] if item['id'] == identifier)
    city = feature['CityObjects']
    building = city[identifier]
    scene = []
    for point in feature['vertices']:
        e, n, height = [v * s + t for v, s, t in zip(point, transform['scale'], transform['translate'])]
        x, z = frame.rd_to_scene(e, n)
        scene.append((round(x, 2), round(height - datum, 2), round(z, 2)))
    footprint = [[[scene[i][0], scene[i][2]] for i in ring]
                 for g in building['geometry'] if g['lod'] == '0'
                 for surface in g['boundaries'] for ring in surface]
    points, faces, ground, lookup = [], [], [], {}
    for component in [building, *(city[child] for child in building.get('children', []))]:
        for geom in component.get('geometry', []):
            if geom['lod'] != '2.2':
                continue
            for kind, rings in shell_faces(geom):
                if kind == 'GroundSurface':
                    ground.extend(scene[i][1] for i in rings[0])
                if kind not in ('WallSurface', 'RoofSurface'):
                    continue
                face = [int(kind == 'RoofSurface')]
                for ring in rings:
                    indices = []
                    for i in ring:
                        point = scene[i]
                        if point not in lookup:
                            lookup[point] = len(points)
                            points.append(point)
                        indices.append(lookup[point])
                    face.append(indices)
                faces.append(face)
    if not footprint or not faces or not ground:
        raise ValueError(f'Incomplete footprint, wall, roof or ground data for {bag}')
    return round(mean(ground), 2), footprint, points, faces


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Folder with the Hoekelum and Gasfabriek CityJSON responses')
    parser.add_argument('--fetch', action='store_true', help='Fetch any missing responses from 3DBAG')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-estate-survey.js')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as packed_map:
        frame = Frame(json.load(packed_map)['meta']['lonLatAffine'])
    datum = round(struct.unpack_from('<f', (ROOT / 'assets/ede-ahn.bin').read_bytes(), 24)[0], 2)
    lines = ['// Surveyed BAG/3DBAG LoD 2.2 in the Oude Kerk scene frame.',
             f'// RD New converted by tools/ede_gis.py; Y is NAP minus {datum:.2f} m.',
             'export const ESTATE_SURVEY = {']
    def compact(value):
        return json.dumps(value, separators=(',', ':'))
    for area, (bounds, buildings) in ESTATES.items():
        data = load_collection(args.cache, area, bounds, args.fetch)
        for name, bag in buildings:
            ground, footprint, points, faces = bake(data, bag, frame, datum)
            lines += [f"  {name}: {{ bag: '{bag}', ground: {ground},",
                      f'    footprint: {compact(footprint)},', '    points: [']
            lines += ['      ' + ', '.join(map(compact, points[i:i + 6])) + ',' for i in range(0, len(points), 6)]
            lines += ['    ],', '    faces: [', *[f'      {compact(face)},' for face in faces], '    ],', '  },']
    args.output.write_text('\n'.join([*lines, '};']) + '\n')


if __name__ == '__main__':
    main()
