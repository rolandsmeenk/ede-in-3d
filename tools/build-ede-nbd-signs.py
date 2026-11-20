#!/usr/bin/env python3
"""Bake reviewed NBd directional panels against the 1GIS survey and Ede road graph."""

import argparse
from collections import Counter, deque
import csv
import gzip
from io import BytesIO
import json
import math
from pathlib import Path
import runpy
from urllib.request import urlopen

from PIL import Image, ImageOps

from ede_map import load_scene
from ede_traffic_geometry import RoadGraph, Segment

ROOT = Path(__file__).resolve().parent.parent
SOURCE = 'https://downloads.rijkswaterstaatdata.nl/bewegwijzering/'
LICENSE = 'Public domain, Nationale Bewegwijzeringsdienst (Rijkswaterstaat)'
REVIEW = ROOT / 'tools/data/ede-nbd-signs.review.json'
RD_TO_LON_LAT = runpy.run_path(str(ROOT / 'tools/build-ede-posted-speeds.py'))['rd_to_lon_lat']
TERRAIN = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))['Terrain']


def drawing_url(sign_id, name):
    return f'{SOURCE}{sign_id[:2]}000/{sign_id[:5]}/{name}'


def fetch(directory, review):
    directory.mkdir(parents=True, exist_ok=True)
    for name in ('wwxy.csv', 'doelen_nbd.csv', 'WW.TXT'):
        with urlopen(SOURCE + name, timeout=50) as response:
            (directory / name).write_bytes(response.read())
    for sign_id, entry in review.items():
        with urlopen(drawing_url(sign_id, entry['drawing']), timeout=30) as response:
            (directory / entry['drawing']).write_bytes(response.read())


def joined_signs(directory, frame):
    signs = {}
    xmin, zmin, xmax, zmax = frame.bounds
    with (directory / 'wwxy.csv').open(encoding='utf-8-sig', newline='') as source:
        for row in csv.DictReader(source):
            if row['klasse'].strip() != 'WEGWIJZER':
                continue
            rd = float(row['x']), float(row['y'])
            x, z = frame.project(*RD_TO_LON_LAT(*rd))
            if xmin <= x <= xmax and zmin <= z <= zmax:
                sign_id = row['kpnr'] + row['wwnr']
                signs[sign_id] = {'rd': rd, 'destinations': [], 'position': (x, z)}
    with (directory / 'doelen_nbd.csv').open(encoding='utf-8-sig', newline='') as source:
        for row in csv.DictReader(source):
            sign = signs.get(row['nummer'])
            text = row['doel'].strip()
            if sign is not None and text and text not in sign['destinations']:
                sign['destinations'].append(text)
    with (directory / 'WW.TXT').open(encoding='latin-1', newline='') as source:
        for row in csv.reader(source):
            if len(row) > 4 and (sign := signs.get(row[0] + row[1])) is not None:
                sign['sourceForm'] = row[4]
    return signs


def load_gis(directory, frame):
    result = {}
    for layer, source_type, field in ((13, 'Wegwijzer', 'objectid'), (31, 'Verkeersportaal', 'gisobjid')):
        document = json.loads((directory / f'{layer}.json').read_bytes())
        if document.get('spatialReference', {}).get('wkid') != 28992:
            raise ValueError(f'1GIS layer {layer} must contain RD New geometry')
        for row in document['features']:
            properties, geometry = row['attributes'], row['geometry']
            if properties['type'] != source_type:
                continue
            if layer == 13:
                shape = (*frame.project(*RD_TO_LON_LAT(geometry['x'], geometry['y'])), geometry.get('z'))
            else:
                shape = [Segment((*frame.project(*RD_TO_LON_LAT(*p[:2])), p[2]),
                                 (*frame.project(*RD_TO_LON_LAT(*q[:2])), q[2]), properties)
                         for path in geometry['paths'] for p, q in zip(path, path[1:]) if p[:2] != q[:2]]
            result[layer, str(properties[field])] = (shape, properties)
    return result


def path_segments(flat, properties):
    points = list(zip(flat[::2], flat[1::2]))
    if properties['reverse']:
        points.reverse()
    return [Segment(a, b, properties) for a, b in zip(points, points[1:]) if a != b]


def nearest(segments, position):
    def distance_to(segment):
        along, across = segment.project(*position)
        return math.hypot(across, max(-along, along - segment.length, 0))
    return min(segments, key=distance_to, default=None)


def crop_board(path):
    """Crop the largest contiguous blue face in the reviewed official drawing."""
    with Image.open(path) as original:
        rgb = original.convert('RGB')
    thumb = ImageOps.contain(rgb, (384, 512), Image.Resampling.BOX)
    w, h = thumb.size
    blue = {(i % w, i // w) for i, (r, g, b) in enumerate(thumb.get_flattened_data())
            if b >= 82 and b > r * 1.28 and b - r > 45 and b - g > 24}
    largest = []
    while blue:
        todo = deque((blue.pop(),))
        component = []
        while todo:
            x, y = todo.popleft()
            component.append((x, y))
            for neighbour in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbour in blue:
                    blue.remove(neighbour)
                    todo.append(neighbour)
        if len(component) > len(largest):
            largest = component
    if len(largest) < 180:
        raise ValueError(f'Cannot locate directional face in {path.name}')
    xs, ys = zip(*largest)
    left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
    pad = max(1, round(min(right - left, bottom - top) * .012))
    return rgb.crop((round(max(0, left - pad) * rgb.width / w), round(max(0, top - pad) * rgb.height / h),
                     round(min(w, right + pad + 1) * rgb.width / w), round(min(h, bottom + pad + 1) * rgb.height / h)))


def use_traffic_blue(sheet):
    # Match pure-blue drawing exports to the blue used on the Maanderbroek faces.
    palette = sheet.getpalette()
    for i in range(0, len(palette), 3):
        red, green, blue = palette[i:i + 3]
        excess = blue - max(red, green)
        if excess > 0 and abs(red - green) <= excess * 0.35:
            weight = excess / 255
            palette[i:i + 3] = (red + round(14 * weight), green + round(81 * weight), blue - round(113 * weight))
    sheet.putpalette(palette)
    return sheet


def project_height(segment, position):
    along, _ = segment.project(*position)
    t = min(1, max(0, along / segment.length))
    return segment.a[2] + t * (segment.b[2] - segment.a[2])


def placement(sign_id, sign, chosen, gis, roads, terrain, profiles):
    surveyed, attributes = gis[13, str(chosen['point'])]
    x, z, nap = surveyed
    if not isinstance(nap, (int, float)) or math.dist(sign['position'], (x, z)) > chosen.get('pointReach', 2.5):
        raise ValueError('1GIS point is too far from NBd location or lacks height')
    position = x, z
    edge = nearest(roads[chosen['way']], position)
    along, lateral = edge.project(*position)
    if abs(lateral) > 22 or max(-along, along - edge.length) > 13:
        raise ValueError('reviewed approach is too far from the mount')
    angle = math.atan2(-edge.ux, -edge.uz)
    along = min(edge.length, max(0, along))
    road_point = edge.a[0] + edge.ux * along, edge.a[1] + edge.uz * along
    ground = terrain.at(position)
    deck, profile = terrain.at(road_point), None
    for candidate in profiles.get(edge.data['id'], []):
        along, lateral = candidate.project(*road_point)
        if 0 <= along <= candidate.length and lateral <= candidate.data['width'] / 2 + 2:
            deck, profile = project_height(candidate, road_point) + terrain.nap, candidate.data['id']
            break
    level = edge.data['layer']
    mount = chosen.get('portal')
    if mount:
        lines, portal_attributes = gis[31, mount]
        axis = nearest(lines, position)
        along, across = axis.project(*position)
        if across > 2.25 or not -1 <= along <= axis.length + 1 or abs(axis.ux * edge.ux + axis.uz * edge.uz) > .55:
            raise ValueError('reviewed portal disagrees with the point or carriageway axis')
        # Use the portal normal, oriented toward the incoming directed carriageway.
        nx, nz = axis.uz, -axis.ux
        if nx * edge.ux + nz * edge.uz > 0:
            nx, nz = -nx, -nz
        angle = math.atan2(nx, nz)
        if not 4.2 <= nap - deck <= 13:
            raise ValueError('surveyed sign height conflicts with the selected portal deck')
    else:
        portal_attributes = None
        if nap < ground - 1.75 or nap > deck + 11:
            raise ValueError('surveyed roadside sign conflicts with the selected deck')
    result = {'id': f'nbd:{sign_id}', 'type': 'directionalSign', 'nbdId': sign_id,
              'position': [round(x, 2), round(z, 2)], 'observedNap': round(nap, 2),
              'angle': round(angle, 5), 'level': level, 'wayId': chosen['way'],
              'sourceRd': sign['rd'], 'sourceForm': sign.get('sourceForm'),
              'destinations': sign['destinations'], 'displayText': chosen['wording'],
              'drawing': drawing_url(sign_id, chosen['drawing']),
              'surveyId': attributes['globalid'], 'surveyObjectId': attributes['objectid'],
              'sourceLevel': attributes.get('niveau'), 'surfaceNap': round(deck, 2), 'profileId': profile}
    if mount:
        result['mountId'] = f'1gis:31:{mount}'
        result['mountGlobalId'] = portal_attributes['globalid']
        if across > 0.2:
            reach = min(axis.length, max(0, along))
            result['bracket'] = [round(axis.a[0] + axis.ux * reach, 2), round(axis.a[1] + axis.uz * reach, 2)]
    else:
        result['support'] = True
        if abs(nap - ground) <= 0.8:
            result['surveyY'] = round(nap, 2)
    return result


def bake(directory, survey, mounts, review, date, atlas, output):
    scene = load_scene()
    frame = RoadGraph({**scene['meta'], 'edges': []})
    signs = joined_signs(directory, frame)
    gis = load_gis(survey, frame)
    with gzip.open(mounts, 'rt') as source:
        beam_heights = {row['id']: row['beamY'] for row in json.load(source)['features'] if row['type'] == 'gantry'}
    terrain = TERRAIN()
    approaches = {entry['way'] for entry in review.values()}
    roads = {road['id']: path_segments(road['pts'], road) for road in scene['roads'] if road['id'] in approaches}
    profiles = {}
    for site in json.loads((ROOT / 'assets/ede-grade.json').read_bytes())['sites']:
        for profile in site['profiles']:
            for way in profile.get('wayIds', []):
                profiles.setdefault(way, []).extend(Segment(a, b, profile) for a, b in zip(profile['points'], profile['points'][1:]) if a[:2] != b[:2])
    panels, unresolved = [], []
    for sign_id, chosen in sorted(review.items()):
        try:
            if reason := chosen.get('withheld'):
                raise ValueError(reason)
            sign = signs[sign_id]
            if not sign['destinations']:
                raise ValueError('NBd destination entry missing')
            row = placement(sign_id, sign, chosen, gis, roads, terrain, profiles)
            graphic = crop_board(directory / chosen['drawing'])
            width, height = chosen['size']
            if not height:
                height = width * graphic.height / graphic.width
            elif abs((width / height) / (graphic.width / graphic.height) - 1) > .16:
                raise ValueError('cropped drawing and panel dimensions disagree')
            row['width'] = width
            row['height'] = round(height, 2)
            deck, nap = row['surfaceNap'], row['observedNap']
            if mount := row.get('mountId'):
                if mount not in beam_heights:
                    raise ValueError('surveyed portal is absent from the motorway asset')
                beam = beam_heights[mount]
                if 'bracket' in row:
                    row['bracketY'] = beam
                if abs(nap - beam) > 1.4:
                    row['heightReview'] = 'panel Z and fitted portal beam differ'
                    nap = beam
            clearance = chosen.get('clearance', 4.65 if row.get('mountId') else 1.85)
            row['centerY'] = round(max(deck + height / 2 + clearance, nap), 2)
            panels.append((row, graphic))
        except (KeyError, ValueError, FileNotFoundError) as error:
            unresolved.append({'nbdId': sign_id, 'reason': str(error)})
    if not panels:
        raise ValueError('No verified directional panels could be baked')
    cell_width, cell_height, columns = 336, 224, 5
    sheet = Image.new('RGB', (cell_width * columns, cell_height * math.ceil(len(panels) / columns)), '#12273d')
    features = []
    for i, (row, graphic) in enumerate(panels):
        graphic = ImageOps.contain(graphic, (cell_width - 8, cell_height - 8), Image.Resampling.LANCZOS)
        x = i % columns * cell_width + (cell_width - graphic.width) // 2
        y = i // columns * cell_height + (cell_height - graphic.height) // 2
        sheet.paste(graphic, (x, y))
        row['uv'] = [round(v, 7) for v in ((x + .5) / sheet.width, 1 - (y + graphic.height - .5) / sheet.height,
                                           (x + graphic.width - .5) / sheet.width, 1 - (y + .5) / sheet.height)]
        features.append(row)
    encoded = BytesIO()
    use_traffic_blue(sheet.quantize(colors=192)).save(encoded, format='PNG', optimize=True)
    atlas.write_bytes(encoded.getvalue())
    summary = {'locations': len(signs), 'withDestinations': sum(bool(row['destinations']) for row in signs.values()),
               'reviewed': len(review), 'rendered': len(features), 'mounts': dict(Counter('standalone' if r.get('support') else 'portal' for r in features)),
               'heightReviews': [r['nbdId'] for r in features if r.get('heightReview')],
               'destinationEntriesOutsidePilot': sum(bool(row['destinations']) for key, row in signs.items() if key not in review),
               'unresolved': unresolved}
    asset = {'version': 1, 'source': SOURCE, 'license': LICENSE, 'date': date,
             'coordinateReference': {'source': 'EPSG:28992', 'vertical': 'NAP'}, 'stats': summary, 'features': features}
    output.write_bytes(gzip.compress((json.dumps(asset, separators=(',', ':'), ensure_ascii=False) + '\n').encode(), mtime=0))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, help='Saved NBd CSVs and official drawings')
    parser.add_argument('survey', type=Path, help='1GIS ArcGIS JSON cache from build-ede-1gis.py')
    parser.add_argument('--date', required=True, help='Publication date of the NBd export used')
    parser.add_argument('--fetch', action='store_true', help='Download NBd CSVs and reviewed drawings first')
    parser.add_argument('--mounts', type=Path, default=ROOT / 'assets/ede-1gis-detail.json.gz', help='Fitted 1GIS gantries')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-nbd-signs.json.gz')
    parser.add_argument('--atlas', type=Path, default=ROOT / 'assets/ede-nbd-signs.png')
    args = parser.parse_args()
    review = json.loads(REVIEW.read_bytes())
    if args.fetch:
        fetch(args.directory, review)
    print(json.dumps(bake(args.directory, args.survey, args.mounts, review, args.date, args.atlas, args.output), indent=2))


if __name__ == '__main__':
    main()
