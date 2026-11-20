#!/usr/bin/env python3
"""Bake the four public exterior surveys from cached 3DBAG CityJSON."""

import argparse
import gzip
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from ede_gis import Frame, SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.3dbag.nl/collections/pand/items'
SITES = (
    ('doelen', 'stadskantoor-de-doelen', 'Stadskantoor De Doelen', 'Centrum', 'Raadhuisplein',
     '0228100000002872', 'w271606066', (), (174604, 450804), (94.0, 65.0), 0x9a654c, 0x4b4e4d),
    ('politie', 'politiebureau-ede', 'Politiebureau Ede', 'Centrum', 'Breelaan',
     '0228100000047804', 'w271573810', (), (174379, 450375), (-119.0, 510.0), 0x9d604e, 0x555555),
    ('brandweer', 'brandweerkazerne-ede', 'Brandweerkazerne Ede-Centrum', 'Centrum', 'Breelaan',
     '0228100000057063', 'w271573850', (), (174470, 450328), (-51.0, 548.0), 0x9d8571, 0x545653),
    ('kernhuis', 'het-kernhuis', 'Het Kernhuis', 'Veldhuizen', 'Parkrand',
     '0228100000077293', 'w374720963', ('w990432479', 'w990432480'), (172662.837, 451314.626),
     (-1836.0, -413.0), 0x87483e, 0x55545a),
)
ROOF_WALL = {'RoofSurface': 1, 'WallSurface': 0}


def pack(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def survey(source, bag_id, frame):
    metadata = source['metadata']
    if not metadata['metadata']['referenceSystem'].endswith('/7415'):
        raise ValueError(f'Unexpected 3DBAG CRS for {bag_id}')
    scale, offset = (metadata['transform'][kind] for kind in ('scale', 'translate'))
    identifier = f'NL.IMBAG.Pand.{bag_id}'
    feature = next(feature for feature in source['features'] if identifier in feature['CityObjects'])
    city = feature['CityObjects']
    building = city[identifier]
    points, faces = [], []
    for vertex in feature['vertices']:
        easting, northing, elevation = (n * s + t for n, s, t in zip(vertex, scale, offset, strict=True))
        x, z = frame.rd_to_scene(easting, northing)
        points.append([round(x, 2), round(elevation - SCENE_NAP_ORIGIN, 2), round(z, 2)])
    geometry = next(item for item in building['geometry'] if item['lod'] == '0')
    if len(geometry['boundaries']) != 1:
        raise ValueError(f'Expected one LoD 0 outline for {bag_id}')
    outline = [[points[i][::2] for i in ring] for ring in geometry['boundaries'][0]]
    for part in [building, *(city[part] for part in building.get('children', []))]:
        for geom in part['geometry']:
            if geom['lod'] != '2.2':
                continue
            classes = geom['semantics']
            boundaries, values = geom['boundaries'], classes['values']
            if geom['type'] == 'Solid':
                boundaries, values = [boundaries], [values]
            elif geom['type'] != 'MultiSolid':
                raise ValueError(f'Unexpected LoD 2.2 geometry type for {bag_id}')
            for solid, shell_values in zip(boundaries, values, strict=True):
                for shell, surface_values in zip(solid, shell_values, strict=True):
                    for rings, value in zip(shell, surface_values, strict=True):
                        if value is None:
                            continue
                        kind = ROOF_WALL.get(classes['surfaces'][value]['type'])
                        if kind is not None and rings:
                            faces.append([kind, *rings])
    if {face[0] for face in faces} != {0, 1}:
        raise ValueError(f'Missing LoD 2.2 walls or roofs for {bag_id}')
    used = sorted({index for _, *rings in faces for ring in rings for index in ring})
    indices = {old: new for new, old in enumerate(used)}
    return ([points[i] for i in used],
            [[kind, *[[indices[i] for i in ring] for ring in rings]] for kind, *rings in faces],
            outline)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as source:
        frame = Frame(json.load(source)['meta']['lonLatAffine'])
    sites, surveys = [], []
    for key, site_id, name, district, road, bag_id, osm_id, annex, address, approach, wall, roof in SITES:
        path = args.cache / f'{key}-bag.json'
        if args.fetch and not path.exists():
            e, n = address
            query = urlencode({'bbox': f'{e-60},{n-60},{e+60},{n+60}', 'limit': 100})
            with urlopen(f'{API}?{query}', timeout=45) as response:
                path.write_bytes(response.read())
        points, faces, outline = survey(json.loads(path.read_text()), bag_id, frame)
        ground = min(p[1] for p in points)
        height = round(max(p[1] for p in points) - ground, 2)
        x, z = (round(value, 2) for value in frame.rd_to_scene(*address))
        sites += [
            f'  {{ id: {pack(site_id)}, name: {pack(name)}, district: {pack(district)}, road: {pack(road)},',
            f'    osmId: {pack(osm_id)}, annexOsmIds: {pack(annex)}, bagIds: {pack([bag_id])},',
            f'    x: {x}, z: {z}, height: {height}, worldSpace: true, approach: {{ x: {approach[0]}, z: {approach[1]} }} }},',
        ]
        surveys += [f'  {pack(site_id)}: [{{', f'    ground: {ground}, wallColor: {wall:#08x}, roofColor: {roof:#08x},',
                    '    outline: ' + pack(outline) + ',', '    points: [']
        surveys += ['      ' + ', '.join(map(pack, points[i:i+5])) + ',' for i in range(0, len(points), 5)]
        surveys += ['    ],', '    faces: [']
        surveys += ['      ' + ', '.join(map(pack, faces[i:i+4])) + ',' for i in range(0, len(faces), 4)]
        surveys += ['    ],', '  }],']
    output = ['// Public 3DBAG LoD 2.2 surveys retrieved 2026-11-20.',
              '// © 3DBAG by tudelft3d and 3DGI, adapted under CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
              f'// Oude Kerk scene coordinates, Y relative to {SCENE_NAP_ORIGIN} m NAP.',
              '// Face codes are 0 (wall) and 1 (roof), followed by the outer ring and any holes.',
              '', 'export const EDE_PUBLIC_LANDMARKS = [', *sites, '];', '',
              'export const PUBLIC_LANDMARK_SURVEYS = {', *surveys, '};', '']
    (ROOT / 'js/ede-public-survey.js').write_text('\n'.join(output), encoding='utf-8')


if __name__ == '__main__':
    main()
