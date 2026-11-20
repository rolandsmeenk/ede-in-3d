"""Join the published ACV collection map to the Ede municipal WFS point groups."""

import argparse
from collections import Counter, defaultdict
from html import unescape
import json
from math import dist, isfinite
from pathlib import Path
import re

from ede_gis import Frame, source_crs
from ede_map import load_scene


STREAMS = {
    'GREY': 'residual', 'GREEN': 'organic', 'PAPER': 'paper', 'GLASS': 'glass',
    'TEXTILE': 'textile', 'DIAPERS': 'diapers', 'PACKAGES': 'pmd',
}
PROFILES = {
    'ondergronds': 'underground', 'semi-ondergronds': 'semi-underground', 'bovengronds': 'surface',
}
# The November 2026 photo shows both textile cabinets at the Bellestein car park.
BELLESTEIN = {
    'rd': (172675.463, 450488.894),
    'numbers': {'E17', 'E17-A'},
    'source': 'https://www.edestad.nl/lokaal/overig/1328565/fotoquiz-edestad-nl-hoe-goed-ken-jij-ede-310-',
    'published': '2026-11-18',
}
SCENE = load_scene()
FRAME = Frame(SCENE['meta']['lonLatAffine'])
BOUNDS = SCENE['meta']['bounds']


def in_scene(rd):
    x, z = FRAME.rd_to_scene(*rd)
    return BOUNDS[0] <= x <= BOUNDS[2] and BOUNDS[1] <= z <= BOUNDS[3]


def designation_profiles(html):
    # Only the residual-waste table gives each numbered container a physical profile.
    appendix = html.split('Bijlage 2. Inzamelvoorzieningen</h2>', 1)[1]
    table = re.search(r'<table\b[^>]*>(.*?)</table>', appendix, re.S).group(1)
    rows = defaultdict(list)
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table, re.S):
        cols = [' '.join(unescape(re.sub('<[^>]+>', '', cell)).split())
                for cell in re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S)]
        if len(cols) != 6 or cols[4].lower() not in PROFILES or not re.fullmatch(r'[A-Z]?[0-9]+[A-Z]?', cols[2]):
            continue
        tokens = re.findall(r'\d{1,2}[,.]\d{3,}', cols[3])
        if len(tokens) == 2:
            lat, lon = (float(token.replace(',', '.')) for token in tokens)
            rd = FRAME.to_rd(lon, lat, 'OGC:CRS84')
            if in_scene(rd):
                rows[cols[2]].append((rd, PROFILES[cols[4].lower()]))
    if not rows:
        raise ValueError('No numbered, typed profiles found in the Ede designation table')
    return rows


def read_wfs(path):
    data = json.loads(path.read_text())
    if source_crs(data).to_epsg() not in {28992, 4326}:
        raise ValueError('Unexpected ACV WFS coordinate reference system')
    groups = defaultdict(list)
    seen = set()
    for feature in data['features']:
        geometry = feature['geometry']
        rd = tuple(geometry['coordinates'])
        identifier = feature['id']
        if (geometry['type'] != 'Point' or len(rd) != 2
                or not (160000 < rd[0] < 205000 and 425000 < rd[1] < 470000)
                or identifier != f"mor_acv_containers.{feature['properties']['kvid']}"
                or identifier in seen):
            raise ValueError(f'Invalid municipal collection point {identifier}')
        seen.add(identifier)
        if in_scene(rd):
            groups[rd].append(identifier)
    return groups


def match(map_data, wfs_groups, physical):
    if map_data['status'] is not True or len(map_data['dataList']) != map_data['total']:
        raise ValueError('The public ACV map returned an incomplete snapshot')
    groups, accepted = defaultdict(list), defaultdict(list)
    for row in map_data['dataList']:
        if not row['IsActive'] or row['Private'] or row['type'] not in STREAMS:
            continue
        lat, lon = float(row['latitude']), float(row['longitude'])
        if not (isfinite(lat) and isfinite(lon) and 51 < lat < 53 and 4 < lon < 7):
            raise ValueError(f'Invalid ACV map point {row["ID"]}')
        rd = FRAME.to_rd(lon, lat, 'OGC:CRS84')
        if in_scene(rd):
            groups[rd].append(row)
    for rd, rows in groups.items():
        nearest = sorted((dist(rd, candidate), candidate) for candidate in wfs_groups if dist(rd, candidate) <= .6)
        if not nearest or nearest[0][0] > .15 or (len(nearest) > 1 and nearest[1][0] - nearest[0][0] < .25):
            continue
        offset, match_rd = nearest[0]
        bellestein = (dist(match_rd, BELLESTEIN['rd']) <= .15 and
                      {row['containerNumber'] for row in rows if row['type'] == 'TEXTILE'} == BELLESTEIN['numbers'])
        for row in rows:
            number = row['containerNumber']
            profiles = set(profile for reference, profile in physical.get(number, []) if dist(rd, reference) <= 2)
            if bellestein and row['type'] == 'TEXTILE':
                profiles.add('surface')
            accepted[match_rd].append((row['ID'], number, STREAMS[row['type']],
                                       next(iter(profiles)) if len(profiles) == 1 else None, offset))

    result = {}
    for rd, rows in accepted.items():
        # Coincident points identify a site. No ordering links individual MOR and ACV records.
        key = min(wfs_groups[rd], key=lambda ident: int(ident.split('.')[-1]))
        streams = sorted({row[2] for row in rows})
        profiles = {row[3] for row in rows if row[3] is not None}
        result[key] = {
            'rd': [round(value, 3) for value in rd],
            'streams': streams,
            **({'stream': streams[0]} if len(streams) == 1 else {}),
            **({'profile': next(iter(profiles))} if len(profiles) == 1 else {}),
            'evidence': {
                'distance': round(max(row[4] for row in rows), 3),
                'records': [list(row[:4]) for row in sorted(rows)],
                **({'photo': BELLESTEIN['source'], 'published': BELLESTEIN['published']}
                   if dist(rd, BELLESTEIN['rd']) <= .15 and BELLESTEIN['numbers'] <= {row[1] for row in rows}
                   else {}),
            },
        }
    return len(groups), sum(map(len, groups.values())), result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wfs', type=Path)
    parser.add_argument('acv_snapshot', type=Path)
    parser.add_argument('designation_html', type=Path)
    parser.add_argument('--output', type=Path, default=Path('tools/data/ede-mor-acv-profile.json'))
    args = parser.parse_args()

    wfs = read_wfs(args.wfs)
    physical = designation_profiles(args.designation_html.read_text())
    points, rows, records = match(json.loads(args.acv_snapshot.read_text()), wfs, physical)
    entries = ',\n'.join('  ' + json.dumps(key) + ': ' + json.dumps(value, separators=(',', ':'))
                         for key, value in sorted(records.items(), key=lambda item: int(item[0].split('.')[-1])))
    args.output.write_text('{\n' + entries + '\n}\n')
    print(f'{rows} ACV map records at {points} points in bounds. Matched {len(records)} municipal sites.')
    print(f"{sum(len(item['evidence']['records']) for item in records.values())} ACV records matched.")
    print('Profiles', dict(Counter(item.get('profile', 'unidentified') for item in records.values())))
    print('Streams', dict(Counter(stream for item in records.values() for stream in item['streams'])))


if __name__ == '__main__':
    main()
