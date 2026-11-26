#!/usr/bin/env python3
"""Bake 3DBAG LoD 2.2 shells for outer cultural, village and barracks landmarks in the Oude Kerk frame."""

import argparse
import json
from pathlib import Path
from runpy import run_path

from pyproj import Transformer
from shapely.geometry import Polygon

from ede_gis import Frame, SCENE_NAP_ORIGIN
from ede_map import ROOT, load_scene_metadata


ESTATES = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))
TO_RD = Transformer.from_crs('EPSG:4326', 'EPSG:28992', always_xy=True)

# (site_id, name, district, road, [(bag_id_or_None, osm_id, wall_hex, roof_hex)], lon, lat, radius_m, approach_offset)
SITES = (
    ('kroller-muller-museum', 'Kröller-Müller Museum', 'Otterlo', 'Houtkampweg',
     [('0228100000019793', 'r3629288', 0xc9c4b4, 0x6f746a)], 5.8175593, 52.0959092, 130, (-72, 14)),
    ('alexanderkerk-bennekom', 'Oude of Sint-Alexanderkerk', 'Bennekom', 'Dorpsstraat',
     [('0228100000033177', 'w271158461', 0xa68d74, 0x4c4a46)], 5.6762979, 51.9980409, 45, (-28, 16)),
    ('kijk-luistermuseum', 'Kijk & Luistermuseum', 'Bennekom', 'Kerkstraat',
     [(None, 'w271157043', 0xa4745c, 0x54453d)], 5.6751135, 51.997555, 30, (-14, -18)),
    ('hervormde-kerk-harskamp', 'Hervormde Kerk Harskamp', 'Harskamp', 'Dorpsstraat',
     [('0228100000051235', 'w271889558', 0x9c654d, 0x4d4642)], 5.7502136, 52.1317536, 50, (-28, 12)),
    ('park-paviljoen', 'Park Paviljoen', 'Hoge Veluwe', 'Houtkampweg',
     [('0228100000080979', 'w602700773', 0x9b7958, 0x5d5a53)], 5.8275032, 52.0984997, 80, (-42, 26)),
    ('arthur-koolkazerne', 'Arthur Koolkazerne', 'Veluwse Poort', 'Koollaan',
     [('0228100000020785', 'w271575797', 0x896455, 0x5c4743)], 5.6752097, 52.0344116, 60, (0, 32)),
    ('elias-beeckmankazerne', 'Elias Beeckmankazerne', 'Veluwse Poort', 'Elias Beeckmanlaan',
     [('0228100000045405', 'w271573636', 0x8a6556, 0x5d4843),
      ('0228100000046394', 'w271573672', 0x8a6556, 0x5d4843)], 5.683766, 52.037705, 90, (0, 38)),
)


def closest_bag_id(snapshot, target_x, target_z, frame):
    best_id, best_dist = None, float('inf')
    for feat in snapshot.get('features', []):
        pid = feat.get('id', '').replace('NL.IMBAG.Pand.', '')
        if not pid:
            continue
        try:
            _, outline, _, _ = ESTATES['bake'](snapshot, pid, frame, SCENE_NAP_ORIGIN)
        except Exception:
            continue
        poly = Polygon(outline[0], outline[1:])
        c = poly.centroid
        d = ((c.x - target_x) ** 2 + (c.y - target_z) ** 2) ** 0.5
        if d < best_dist:
            best_dist, best_id = d, pid
    if not best_id:
        raise ValueError('No 3DBAG building found near target')
    return best_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-outer-cultural-survey.js')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    frame = Frame(load_scene_metadata()['lonLatAffine'])

    def compact(value):
        return json.dumps(value, separators=(',', ':'))

    lines = [
        '// Public 3DBAG LoD 2.2, baked with tools/build-ede-outer-cultural-survey.py.',
        '// Coordinates are in the Oude Kerk frame, with Y relative to 22.54 m NAP.',
        'export const OUTER_CULTURAL_SURVEYS = {',
    ]
    meta_rows = []
    for site_id, name, district, road, buildings, lon, lat, radius, (adx, adz) in SITES:
        rx, ry = TO_RD.transform(lon, lat)
        bbox = (rx - radius, ry - radius, rx + radius, ry + radius)
        snapshot = ESTATES['load_collection'](args.cache, site_id, bbox, args.fetch)
        tx, tz = frame.lon_lat_to_scene(lon, lat)
        lines.append(f"  '{site_id}': [")
        all_pts, bag_ids, osm_ids = [], [], []
        min_ground, max_y = float('inf'), float('-inf')
        for bag, osm, wall, roof in buildings:
            pid = bag or closest_bag_id(snapshot, tx, tz, frame)
            ground, outline, points, faces = ESTATES['bake'](snapshot, pid, frame, SCENE_NAP_ORIGIN)
            poly = Polygon(outline[0], outline[1:])
            if not poly.is_valid:
                raise ValueError(f'Invalid footprint for {site_id} ({pid})')
            bag_ids.append(pid)
            osm_ids.append(osm)
            all_pts.extend(outline[0])
            min_ground = min(min_ground, ground)
            for p in points:
                max_y = max(max_y, p[1])
            lines += [
                f"    {{ bagId: '{pid}', osmId: '{osm}', ground: {ground}, wallColor: 0x{wall:06x}, roofColor: 0x{roof:06x},",
                f'      outline: {compact(outline)},',
            ]
            for key, values in [('points', points), ('faces', faces)]:
                lines.append(f'      {key}: [')
                lines.extend('        ' + ', '.join(map(compact, values[i:i + 5])) + ',' for i in range(0, len(values), 5))
                lines.append('      ],')
            lines.append('    },')
        lines.append('  ],')
        cx = round(sum(p[0] for p in all_pts) / len(all_pts), 2)
        cz = round(sum(p[1] for p in all_pts) / len(all_pts), 2)
        height = round(max(4.0, max_y - min_ground), 2)
        meta_rows.append({
            'id': site_id, 'name': name, 'district': district, 'road': road,
            'x': cx, 'z': cz, 'height': height, 'focusHeight': round(min(12.0, height * 0.45), 2),
            'approach': {'x': round(cx + adx, 1), 'z': round(cz + adz, 1)},
            'osmId': osm_ids[0], 'annexOsmIds': osm_ids[1:], 'bagIds': bag_ids,
        })
        print(f'{site_id}: bags={bag_ids} center=({cx},{cz}) h={height}m')

    lines += ['};', '', 'export const OUTER_CULTURAL_META = [']
    for row in meta_rows:
        lines.append('  ' + compact(row) + ',')
    lines += ['];', '']
    args.output.write_text('\n'.join(lines))
    print(f'Wrote {args.output} ({len(lines)} lines)')


if __name__ == '__main__':
    main()
