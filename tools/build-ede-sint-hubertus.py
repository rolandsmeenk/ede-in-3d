#!/usr/bin/env python3
"""Bake the four fitted Jachthuis Sint Hubertus shells in the Oude Kerk frame."""

import argparse
import json
from pathlib import Path
from runpy import run_path

from shapely.geometry import Point, Polygon

from ede_gis import Frame, SCENE_NAP_ORIGIN
from ede_map import ROOT, load_scene_metadata


ESTATES = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))
# Lodge, courtyard outbuilding, northwestern pavilion, southeastern pavilion.
BUILDINGS = (
    ('0228100000055990', 'w271885663', 0xa6765c, 0x536172),
    ('0228100000024704', 'w271885669', 0xa6765c, 0x536172),
    ('0228100000025262', 'w271885676', 0xa17055, 0x566474),
    ('0228100000048330', 'w271885675', 0xa17055, 0x566474),
)
APPROACH = (11053.3, -8430.3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-sint-hubertus-survey.js')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    snapshot = ESTATES['load_collection'](args.cache, 'sint-hubertus', (185442, 459272, 185593, 459423), args.fetch)
    frame = Frame(load_scene_metadata()['lonLatAffine'])

    def compact(value):
        return json.dumps(value, separators=(',', ':'))

    lines = [
        '// Public 3DBAG LoD 2.2, baked with tools/build-ede-sint-hubertus.py.',
        '// Coordinates are in the Oude Kerk frame, with Y relative to 22.54 m NAP.',
        'export const HUBERTUS_SHELLS = [',
    ]
    for bag, osm, wall, roof in BUILDINGS:
        ground, outline, points, faces = ESTATES['bake'](snapshot, bag, frame, SCENE_NAP_ORIGIN)
        polygon = Polygon(outline[0], outline[1:])
        if not polygon.is_valid or polygon.distance(Point(APPROACH)) < 1.0:
            raise ValueError(f'Invalid footprint or blocked courtyard approach for {bag}')
        lines += [f"  {{ bagId: '{bag}', osmId: '{osm}', ground: {ground}, wallColor: 0x{wall:06x}, roofColor: 0x{roof:06x},",
                  f'    outline: {compact(outline)},']
        for key, values in [('points', points), ('faces', faces)]:
            lines.append(f'    {key}: [')
            lines.extend('      ' + ', '.join(map(compact, values[i:i + 5])) + ',' for i in range(0, len(values), 5))
            lines.append('    ],')
        lines.append('  },')
    lines += ['];', '']
    args.output.write_text('\n'.join(lines))


if __name__ == '__main__':
    main()
