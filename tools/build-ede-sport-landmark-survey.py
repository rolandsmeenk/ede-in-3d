#!/usr/bin/env python3
"""Bake the sports landmark shells from 3DBAG LoD 2.2."""

import argparse
import gzip
from importlib import import_module
import json
from pathlib import Path

from ede_gis import Frame, SCENE_NAP_ORIGIN


ROOT = Path(__file__).resolve().parents[1]

# IDs follow the BAG address lookup and the footprint matches in the map snapshot.
SITES = (
    ('moorfielders', 'BSV Moorfielders · Hustle In', 'Kanonnenpad', 'Hoekelumse Eng',
     (-380, 3559), (-397, 3545), (173971, 447282, 174169, 447524), (
        ('0228100000070688', 'w271379915', 0x666458, 0x666c70),
        ('0228100000035738', 'w271469248', 0x655d4d, 0x535951),
     )),
    ('climax-atletiek', 'Atletiekvereniging Climax', 'Sportparkweg', 'Hoekelumse Eng',
     (-184, 3561), (-167, 3544), (174299, 447300, 174373, 447374), (
        ('0228100000006300', 'w271376069', 0x8e715b, 0x505450),
        ('0228100000016676', 'w271467391', 0x746c59, 0x585954),
     )),
    ('ede-victoria', 'VV Ede/Victoria', 'Sportparkweg', 'Hoekelumse Eng',
     (-169, 3436), (-179, 3418), (174294, 447425, 174375, 447502), (
        ('0228100000068751', 'w271469980', 0x8b695a, 0x515255),
     )),
    ('fc-jeugd', 'FC Jeugd ’90', 'Sportparkweg', 'Hoekelumse Eng',
     (-259, 3448), (-249, 3434), (174218, 447416, 174294, 447485), (
        ('0228100000076218', 'w271377604', 0x7f6654, 0x464a4c),
        ('0228100000019313', 'w271378354', 0x8c7765, 0x686d6b),
     )),
    ('wvede', 'Wielervereniging Ede', 'Horsterweg', 'Veldhuizen',
     (-2050, 1343), (-2052, 1334), (172149, 449305, 172487, 449579), (
        ('0228100000018975', 'w272135413', 0x474943, 0x545654),
     )),
    ('dts-ede', 'DTS ’35 Ede · Sportpark Inschoten', 'Inschoterweg', 'Veldhuizen',
     (-2594, 1071), (-2591, 1047), (171817, 449747, 171997, 449969), (
        ('0228100000017004', 'w272141241', 0xa48669, 0x4b4e52),
        ('0228100000050604', 'w272141561', 0xa58567, 0x4a4c51),
     )),
    ('sporthal-t-riet', 'Sporthal ’t Riet · Dick’s Inn', 'Laan der Verenigde Naties', 'Rietkampen',
     (-2315, 2853), (-2325, 2875), (172134, 447976, 172245, 448097), (
        ('0228100000035438', 'w271178820', 0x9f8069, 0x555855),
     )),
)


def packed(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true', help='Fetch missing source collections')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    venue_bake = import_module('build-ede-venue-survey')
    frame = Frame(json.loads(gzip.decompress((ROOT / 'assets/ede-map-v1.json.gz').read_bytes()))['meta']['lonLatAffine'])
    lines = ['// 3DBAG LoD 2.2, retrieved 2026-11-20. Coordinates use the Oude Kerk scene frame.',
             '// A face starts with 0 (wall) or 1 (roof), followed by its surface rings.',
             'export const SPORT_LANDMARK_SURVEYS = {']
    records = []
    for key, name, road, district, center, approach, bounds, parts in SITES:
        lines.append(f'  {packed(key)}: [')
        heights = []
        for bag_id, osm_id, wall, roof in parts:
            points, faces, outline = venue_bake.get_survey(args.cache, key, bag_id, bounds, frame, SCENE_NAP_ORIGIN, args.fetch)
            ground = min(p[1] for p in points)
            height = max(p[1] for p in points) - ground
            if not faces or not any(r[0] == 1 for r in faces) or height <= 1:
                raise ValueError(f'Missing LoD 2.2 data for {bag_id}')
            heights.append(height)
            lines += [f'    {{ // BAG {bag_id} · OSM {osm_id}',
                      f'      ground: {ground}, wallColor: 0x{wall:06x}, roofColor: 0x{roof:06x},',
                      f'      outline: {packed(outline)},', '      points: [']
            lines.extend('        ' + ', '.join(map(packed, points[i:i+4])) + ',' for i in range(0, len(points), 4))
            lines += ['      ],', '      faces: [']
            lines.extend('        ' + ', '.join(map(packed, faces[i:i+4])) + ',' for i in range(0, len(faces), 4))
            lines += ['      ],', '    },']
        lines += ['  ],']
        x, z = center
        ax, az = approach
        records.extend([f'  {{ id: {packed(key)}, name: {packed(name)}, road: {packed(road)}, district: {packed(district)},',
                        f'    osmId: {packed(parts[0][1])}, annexOsmIds: {packed([part[1] for part in parts[1:]])},',
                        f'    bagIds: {packed([part[0] for part in parts])}, x: {x}, z: {z}, height: {max(heights):.2f},',
                        f'    worldSpace: true, approach: {{ x: {ax}, z: {az} }} }},'])
    output = '\n'.join([*lines, '};', '', 'export const EDE_SPORT_LANDMARKS = [', *records, '];', ''])
    (ROOT / 'js/ede-sport-landmark-survey.js').write_text(output)


if __name__ == '__main__':
    main()
