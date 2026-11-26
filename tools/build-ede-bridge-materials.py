"""Match public IMWA bridge material records to surveyed BGT deck footprints."""

import argparse
from collections import defaultdict
from datetime import date
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from shapely import STRtree, union_all
from shapely.geometry import Point, Polygon

from ede_map import ROOT, load_scene_metadata
from ede_scene import SceneAffine

API = 'https://api.pdok.nl/hwh/waterschappen-kunstwerken-imwa/ogc/v2/collections/brug/items'
MATERIALS = {
    'hout': 'wood', 'beton': 'concrete', 'gewapend beton': 'concrete', 'steen': 'masonry',
    'metselwerk': 'masonry', 'staal': 'metal', 'ijzer': 'metal', 'aluminium': 'metal',
    'roestvrij staal': 'metal', 'gegolfd plaatstaal': 'metal',
}


def download(bounds):
    url = f'{API}?{urlencode(dict(bbox=",".join(map(str, bounds)), limit=1000, f="json"))}'
    while url:
        with urlopen(url, timeout=35) as response:
            page = json.load(response)
        yield from page['features']
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)


def coordinates(ring):
    return list(zip(ring[::2], ring[1::2]))


def build(structures, features, frame):
    decks = [feature for feature in structures if feature['kind'] == 'deck']
    shapes = STRtree([union_all([Polygon(coordinates(outer), [coordinates(h) for h in holes])
                                for outer, *holes in feature['polygons']]) for feature in decks])
    matched = defaultdict(dict)
    for feature in features:
        properties, geometry = feature['properties'], feature.get('geometry') or {}
        material = MATERIALS.get(properties.get('typemateriaal'))
        if not material or properties.get('statusobject') != 'gerealiseerd' or geometry.get('type') != 'Point':
            continue
        point = Point(frame.lon_lat_to_scene(*geometry['coordinates'][:2]))
        hits = shapes.query(point, predicate='intersects')
        if len(hits) != 1:
            continue
        identity = decks[hits[0]]['ids'][0]
        code = properties['code']
        record = {'code': code, 'material': material, 'position': [round(p, 2) for p in (point.x, point.y)]}
        soffit = properties.get('hoogteonderzijde')
        if isinstance(soffit, (int, float)) and 0 < soffit < 100:
            record['soffitNap'] = soffit
        matched[identity][code] = record
    return {identity: next(iter(records.values())) for identity, records in sorted(matched.items()) if len(records) == 1}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, help='Local IMWA bridge GeoJSON for an offline rebuild')
    parser.add_argument('--date', default=str(date.today()))
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-bridge-materials.json')
    args = parser.parse_args()
    frame = SceneAffine(load_scene_metadata()['lonLatAffine'])
    structures = json.loads((ROOT / 'assets/ede-bgt.json').read_text())['structures']
    coords = [p for row in structures if row['kind'] == 'deck' for polygon in row['polygons']
              for p in coordinates(polygon[0])]
    xs, zs = zip(*coords)
    bounds = frame.geographic_bounds((min(xs) - 1, min(zs) - 1, max(xs) + 1, max(zs) + 1))
    features = json.loads(args.snapshot.read_text())['features'] if args.snapshot else download(bounds)
    result = {'version': 1, 'source': API, 'date': args.date, 'decks': build(structures, features, frame)}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
