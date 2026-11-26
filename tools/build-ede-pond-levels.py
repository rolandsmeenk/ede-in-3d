"""Bake water-board targets and AHN shoreline estimates for mapped standing water."""

import argparse
from datetime import date
import json
import math
from pathlib import Path
import runpy
from urllib.parse import urlencode
from urllib.request import urlopen

from shapely import STRtree, make_valid, transform
from shapely.geometry import Polygon, shape

from ede_height_field import expansion_collision_path
from ede_map import ROOT, load_playable_scene
from ede_scene import SceneAffine

SERVICE = 'https://services1.arcgis.com/ug8NBKcLHVNmdmdt/ArcGIS/rest/services/Peilvakken/FeatureServer/0'
STANDING_TYPES = {'pond', 'watervlakte', 'basin', 'reservoir'}
# The shoreline audit identifies this water polygon as the main Veldhuizerbos pond.
REVIEWED_PONDS = {'water65'}
Terrain = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))['Terrain']


def download(bounds):
    params = {
        'geometry': ','.join(map(str, bounds)), 'geometryType': 'esriGeometryEnvelope',
        'inSR': 4326, 'outSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'where': '1=1',
        'returnGeometry': 'true', 'returnZ': 'false', 'outFields': 'CODE,WS_MAX_PEIL,WS_MIN_PEIL', 'f': 'geojson',
    }
    with urlopen(f'{SERVICE}/query?{urlencode(params)}', timeout=35) as response:
        return read_snapshot(json.load(response))


def read_snapshot(data):
    if data.get('type') != 'FeatureCollection' or data.get('exceededTransferLimit'):
        raise ValueError('Incomplete water-board target snapshot')
    return data['features']


def pairs(ring):
    return list(zip(ring[::2], ring[1::2]))


def shoreline_heights(shore, terrains):
    count = max(12, min(300, math.ceil(shore.length / 4)))
    heights = []
    for k in range(count):
        point = shore.interpolate(k / count, normalized=True)
        for field in terrains:
            if not (field.x <= point.x < field.x + (field.columns - 1) * field.step
                    and field.z <= point.y < field.z + (field.rows - 1) * field.step):
                continue
            heights.append(field.at((point.x, point.y)))
            break
    return sorted(heights) if len(heights) == count else []


def build(scene, features, terrains):
    frame = SceneAffine(scene['meta']['lonLatAffine'])
    def to_scene(lons, lats):
        return tuple(zip(*(frame.lon_lat_to_scene(lon, lat) for lon, lat in zip(lons, lats))))

    zones, metadata = [], []
    for feature in features:
        p = feature['properties']
        low, high = p['WS_MIN_PEIL'], p['WS_MAX_PEIL']
        if not feature['geometry'] or not p['CODE']:
            continue
        zones.append(make_valid(transform(shape(feature['geometry']), to_scene, interleaved=False)))
        nap = round(low, 2) if low == high and isinstance(low, (int, float)) and -5 <= low <= 60 else None
        metadata.append((p['CODE'], nap))
    index = STRtree(zones)
    levels = {}
    for water in scene['water']:
        identity, kind = water['id'], water['kind']
        if identity in {'water91', 'water171', 'frankeneng-water-downstream'} or (kind not in STANDING_TYPES and kind != 'water'):
            continue
        outline = Polygon(pairs(water['ring']), [pairs(hole) for hole in water.get('holes', [])])
        if not outline.is_valid or outline.area < 10:
            continue
        known_pond = kind in STANDING_TYPES or identity in REVIEWED_PONDS or bool(water['name'])
        wide = outline.area >= 100 and 2 * outline.area / outline.exterior.length >= 5
        if not (known_pond or wide):
            continue
        heights = shoreline_heights(outline.exterior, terrains)
        if not heights:
            continue
        low_bank = heights[int((len(heights) - 1) * .10)]
        high_bank = heights[int((len(heights) - 1) * .90)]
        if high_bank - low_bank > 1.8:
            continue
        matches = [(zones[i].intersection(outline).area / outline.area, *metadata[i])
                   for i in index.query(outline, predicate='intersects')]
        matches = [match for match in matches if match[0] > .02]
        if len(matches) == 1:
            overlap, code, nap = matches[0]
            if overlap >= .98 and nap is not None and -.15 <= low_bank - nap <= 1.65:
                levels[identity] = [nap, code]
                continue
        compact = outline.area / outline.exterior.length ** 2 >= .022
        if known_pond or (compact and high_bank - low_bank <= 1.25):
            levels[identity] = [round(low_bank - .12, 2)]
    return dict(sorted(levels.items()))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, help='Use a local Peilvakken GeoJSON query result')
    parser.add_argument('--date', default=str(date.today()))
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-pond-levels.json')
    args = parser.parse_args()
    scene = load_playable_scene()
    south, west, north, east = scene['meta']['geographicBounds']
    features = read_snapshot(json.loads(args.snapshot.read_text())) if args.snapshot else download((west, south, east, north))
    levels = build(scene, features, [Terrain(), Terrain(expansion_collision_path())])
    result = {'version': 1, 'source': SERVICE, 'date': args.date, 'levels': levels}
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'{sum(len(level) == 2 for level in levels.values())} water-board targets, '
          f'{sum(len(level) == 1 for level in levels.values())} AHN shoreline estimates')
