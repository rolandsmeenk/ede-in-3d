#!/usr/bin/env python3
"""Bake the current Marnix College main building at Prins Bernhardlaan 30."""

import argparse
import json
from pathlib import Path
from runpy import run_path

from ede_gis import Frame
from ede_map import load_scene_metadata

ROOT = Path(__file__).resolve().parents[1]
SCHOOL_BAKE = run_path(str(ROOT / 'tools/build-ede-school-survey.py'))
BAG = '0228100000004719'


def render(cache, fetch):
    identifier = 'NL.IMBAG.Pand.' + BAG
    url = f'{SCHOOL_BAKE["THREE_DBAG"]}/{identifier}'
    data = json.loads(SCHOOL_BAKE['cached_file'](cache, f'{BAG}.json', url, fetch).read_bytes())
    record = SCHOOL_BAKE['extract'](
        data['feature'], identifier, data['metadata'], Frame(load_scene_metadata()['lonLatAffine']),
        0x9e7d6b, 0x88857c,
    )
    height = round(max(y for _, y, _ in record['points']) - record['ground'], 2)
    packed = SCHOOL_BAKE['packed']
    lines = [
        '// 3DBAG LoD 2.2 geometry by tudelft3d and 3DGI, adapted under CC BY 4.0.',
        '// Survey references and refresh are documented in tools/data/ede-marnix-landmark.md.',
        'export const MARNIX_COLLEGE_SURVEY = {',
    ]
    for field in ('ground', 'wallColor', 'roofColor', 'outline'):
        lines.append(f'  {field}: {packed(record[field])},')
    for field in ('points', 'faces'):
        rows = record[field]
        lines.append(f'  {field}: [')
        lines.extend('    ' + ', '.join(map(packed, rows[i:i + 5])) + ',' for i in range(0, len(rows), 5))
        lines.append('  ],')
    lines += [
        '};',
        '',
        'const [outer, ...holes] = MARNIX_COLLEGE_SURVEY.outline.map(ring => ring.map(([x, z]) => ({ x, z })));',
        'export const MARNIX_COLLEGE_SITE = {',
        "  id: 'marnix-college', name: 'Marnix College', district: 'Beatrixpark', road: 'Prins Bernhardlaan',",
        f"  osmId: 'w271510315', bagIds: ['{BAG}'], surveyFootprints: [{{ outer, holes }}],",
        f'  x: -429.7, z: 1658.4, height: {height}, focusHeight: 3.6, worldSpace: true, mapScenic: true,',
        '  approach: { x: -438, z: 1687 },',
        '};',
        '',
    ]
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true', help='Download the missing survey into the local cache')
    parser.add_argument('--check', action='store_true', help='Verify the bundled survey')
    args = parser.parse_args()
    if args.fetch:
        args.cache.mkdir(parents=True, exist_ok=True)
    target = ROOT / 'js/ede-marnix-survey.js'
    output = render(args.cache, args.fetch)
    if args.check:
        if target.read_text() != output:
            raise SystemExit(f'{target.name} differs from the 3DBAG survey bake')
    else:
        target.write_text(output)


if __name__ == '__main__':
    main()
