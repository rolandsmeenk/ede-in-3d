#!/usr/bin/env python3
"""Bake five public school exterior surveys into the Oude Kerk scene frame."""

import argparse
import gzip
import json
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

from ede_gis import Frame
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
THREE_DBAG = 'https://api.3dbag.nl/collections/pand/items'
PDOK = ('https://download.pdok.nl/kadaster/basisvoorziening-3d/v1_0/2025/gebouwen/'
        'buildings_2025_172000_448000.zip')
SURVEYS = {
    'dulon-college': (('0228100000043976', 'pdok', 0x837362, 0x747575),),
    'de-ontdekking': (('0228100000062511', '3dbag', 0xa17b63, 0x5b5650),),
    'het-streek-lyceum': (('0228100000086951', 'pdok', 0x947456, 0x6e6d66),),
    'het-streek-college': (
        ('0228100000073498', '3dbag', 0x504843, 0x555951),
        ('0228100000073499', '3dbag', 0x504843, 0x777a73),
    ),
    'aeres-al-amana': (('0228100000000828', '3dbag', 0x9c6155, 0x6d6a63),),
}


def cached_file(cache, name, url, fetch):
    path = cache / name
    if fetch and not path.exists():
        with urlopen(url, timeout=45) as response:
            contents = response.read()
        path.write_bytes(contents)
    return path


def extract(source, identifier, transform, frame, wall_color, roof_color):
    metadata = transform['metadata']
    if not metadata['referenceSystem'].endswith('/7415'):
        raise ValueError(f'Unexpected survey CRS for {identifier}')
    scale = transform['transform']['scale']
    offset = transform['transform']['translate']
    city = source['CityObjects']
    building = city[identifier]

    def point(index):
        easting, northing, height = [value * s + t for value, s, t in
                                    zip(source['vertices'][index], scale, offset)]
        x, z = frame.rd_to_scene(easting, northing)
        return [round(x, 2), round(height - SCENE_NAP_ORIGIN, 2), round(z, 2)]

    faces, ground_faces = [], []
    for part in [building, *(city[child] for child in building.get('children', []))]:
        for geometry in part['geometry']:
            if geometry['lod'] != '2.2':
                continue
            semantics = geometry['semantics']
            solids, surfaces = geometry['boundaries'], semantics['values']
            if geometry['type'] == 'Solid':
                solids, surfaces = [solids], [surfaces]
            elif geometry['type'] != 'MultiSolid':
                raise ValueError(f'Unexpected LoD 2.2 geometry for {identifier}')
            for solid, shell_classes in zip(solids, surfaces, strict=True):
                for shell, classes in zip(solid, shell_classes, strict=True):
                    for rings, surface in zip(shell, classes, strict=True):
                        kind = semantics['surfaces'][surface]['type'] if surface is not None else None
                        if kind == 'GroundSurface':
                            ground_faces.append(rings)
                        elif kind in ('WallSurface', 'RoofSurface'):
                            faces.append([int(kind == 'RoofSurface'), *rings])

    if not faces or len(ground_faces) != 1 or {face[0] for face in faces} != {0, 1}:
        raise ValueError(f'Expected one footprint with a LoD 2.2 wall and roof survey for {identifier}')
    ground_rings = ground_faces[0]
    used = sorted({index for _, *rings in faces for ring in rings for index in ring})
    lookup = {old: new for new, old in enumerate(used)}
    return {
        'ground': min(point(index)[1] for ring in ground_rings for index in ring),
        'wallColor': wall_color, 'roofColor': roof_color,
        'outline': [[(vertex[0], vertex[2]) for vertex in map(point, ring)] for ring in ground_rings],
        'points': [point(index) for index in used],
        'faces': [[kind, *[[lookup[index] for index in ring] for ring in rings]] for kind, *rings in faces],
    }


def packed(value):
    return json.dumps(value, separators=(',', ':'))


def baked(cache, fetch, frame):
    archive_path = cached_file(cache, PDOK.rsplit('/', 1)[1], PDOK, fetch)
    with ZipFile(archive_path) as archive:
        with archive.open(archive.namelist()[0]) as city_json:
            pdok = json.load(city_json)
    lines = [
        '// Surveyed school shells in the Oude Kerk frame, relative to 22.54 m NAP.',
        '// Sources and reproducible bake are documented in tools/data/ede-school-landmarks.md.',
        '// Faces retain all classified wall/roof rings. Codes are 0 (wall) and 1 (roof).',
        '',
        'export const SCHOOL_SURVEYS = {',
    ]
    for key, records in SURVEYS.items():
        lines.append(f"  '{key}': [")
        for bag, provider, wall_color, roof_color in records:
            identifier = f'NL.IMBAG.Pand.{bag}'
            if provider == 'pdok':
                source = transform = pdok
            else:
                path = cached_file(cache, f'{bag}.json', f'{THREE_DBAG}/{identifier}', fetch)
                survey = json.loads(path.read_text())
                source, transform = survey['feature'], survey['metadata']
            record = extract(source, identifier, transform, frame, wall_color, roof_color)
            lines.append('    {')
            for field in ('ground', 'wallColor', 'roofColor', 'outline'):
                lines.append(f'      {field}: {packed(record[field])},')
            for field, per_line in (('points', 5), ('faces', 4)):
                values = record[field]
                lines.append(f'      {field}: [')
                lines.extend('        ' + ', '.join(map(packed, values[i:i + per_line])) + ','
                             for i in range(0, len(values), per_line))
                lines.append('      ],')
            lines.append('    },')
        lines.append('  ],')
    lines += ['};', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true', help='Fetch missing CityJSON sources')
    parser.add_argument('--check', action='store_true', help='Verify the committed shell bake')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as scene:
        frame = Frame(json.load(scene)['meta']['lonLatAffine'])
    target = ROOT / 'js/ede-school-survey.js'
    output = baked(args.cache, args.fetch, frame)
    existing = target.read_text() if target.exists() else ''
    # Preserve the curated site locations and road approaches following the generated shell data.
    _, marker, metadata = existing.partition('export const EDE_SCHOOL_LANDMARKS')
    if marker:
        output += '\n' + marker + metadata
    if args.check:
        if output != existing:
            raise SystemExit('The school survey differs from the committed bake.')
    else:
        target.write_text(output)


if __name__ == '__main__':
    main()
