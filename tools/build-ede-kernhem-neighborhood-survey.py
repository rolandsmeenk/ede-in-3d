#!/usr/bin/env python3
"""Bake the Waterzoom and Parkweide landmark shells in the Ede scene frame."""

import argparse
import gzip
import json
from pathlib import Path
import runpy
from urllib.request import urlopen

from shapely import transform
from shapely.geometry import Polygon, box, shape
from shapely.geometry.polygon import orient

from ede_gis import Frame, SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_SURVEY = runpy.run_path(str(ROOT / 'tools/build-ede-public-survey.py'))
survey, pack = PUBLIC_SURVEY['survey'], PUBLIC_SURVEY['pack']
PARKWEIDE = (
    ('0228100000077120', 'w374720957'),
    ('0228100000077119', 'w374720967'),
)
WATERZOOM = ('0228100000088545', 'w1259164028')
SOURCES = {
    'water-bag.json': ('https://api.pdok.nl/kadaster/bag/ogc/v2/collections/'
                       'pand/items?bbox=5.6244,52.04922,5.6256,52.04985&limit=50&f=json'),
    'parkweide-shell.json': (f"{PUBLIC_SURVEY['API']}?bbox=172528,451369,172687,451466&limit=100"),
}


def waterzoom(source, frame):
    feature = next(f for f in source['features'] if f['properties']['identificatie'] == WATERZOOM[0])
    base_shape = transform(shape(feature['geometry']), frame.lon_lat_to_scene, interleaved=False).simplify(0.09)
    # The BAG outline captures the wall setbacks. The 2026 PDOK photo shows the L-shaped upper tier.
    # Use the long straight southern wall to align the step, then fit its two lengths to the aerial.
    origin = min(base_shape.exterior.coords, key=lambda p: p[0])
    east, south = 0.986, 0.1667

    def into_local(x, z):
        a, b = x - origin[0], z - origin[1]
        return a * east + b * south, b * east - a * south

    def into_scene(u, v):
        return origin[0] + (u * east - v * south), origin[1] + (u * south + v * east)

    low = transform(base_shape, into_local, interleaved=False)
    upper = low.intersection(box(-5, -19.0, 20.7, 6).union(box(-5, -11.25, 32, 6)))
    upper = transform(upper, into_scene, interleaved=False).intersection(base_shape).simplify(0.04)
    terrace = base_shape.difference(upper)
    points, faces = [], []

    def vertex(x, y, z):
        value = [round(x, 2), y, round(z, 2)]
        if value not in points:
            points.append(value)
        return points.index(value)

    # Streetside AHN supports the entrance threshold. Storey heights and absolute roof
    # levels are estimates from the scaled 2024 exterior elevations and 2025 exterior photo.
    ground, lower_roof, upper_roof = -12.25, -0.12, 2.72

    def exterior_walls(footprint, y0, y1):
        clockwise = orient(footprint, sign=-1)
        for ring in (clockwise.exterior, *clockwise.interiors):
            for (ax, az), (bx, bz) in zip(ring.coords, list(ring.coords)[1:]):
                if abs(bx - ax) + abs(bz - az) > 0.065:
                    faces.append([0, [vertex(ax, y0, az), vertex(bx, y0, bz),
                                      vertex(bx, y1, bz), vertex(ax, y1, az)]])

    def roof(polygons, y):
        for polygon in getattr(polygons, 'geoms', [polygons]):
            if polygon.area < 0.05:
                continue
            clockwise = orient(polygon, sign=-1)
            surfaces = []
            for ring in (clockwise.exterior, *clockwise.interiors):
                indices = [vertex(x, y, z) for x, z in list(ring.coords)[:-1]]
                clean = [index for i, index in enumerate(indices) if index != indices[i-1]]
                if len(clean) >= 3:
                    surfaces.append(clean)
            faces.append([1, *surfaces])

    exterior_walls(base_shape, ground, lower_roof)
    exterior_walls(upper, lower_roof, upper_roof)
    roof(terrace, lower_roof)
    roof(upper, upper_roof)
    assert abs(upper.area + terrace.area - base_shape.area) < 0.02
    return points, faces, [[[round(x, 2), round(z, 2)] for x, z in list(base_shape.exterior.coords)[:-1]]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-kernhem-neighborhood-survey.js')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    sources = {}
    for name, url in SOURCES.items():
        path = args.cache / name
        if args.fetch and not path.exists():
            with urlopen(url, timeout=45) as response:
                path.write_bytes(response.read())
        sources[name] = json.loads(path.read_text())

    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as file:
        scene = json.load(file)
    frame = Frame(scene['meta']['lonLatAffine'])
    ids = {osm_id for _, osm_id in [WATERZOOM, *PARKWEIDE]}
    osm = {item['id']: Polygon(list(zip(item['ring'][::2], item['ring'][1::2])))
           for item in scene['buildings'] if item['id'] in ids}

    parts = [
        ('waterzoom-kernhem', 'Waterzoom · Bemmelsewaard', 'Bemmelsewaard', [WATERZOOM],
         [waterzoom(sources['water-bag.json'], frame)], (-3201.2, -400.3), (-3196.5, -359.5), 5.6,
         0xa99a82, 0x51565b),
        ('winkelcentrum-parkweide', 'Winkelcentrum Parkweide', 'Parkweide', PARKWEIDE,
         [survey(sources['parkweide-shell.json'], bag, frame) for bag, _ in PARKWEIDE],
         (-1898.8, -529.8), (-1907.5, -548.0), 2.7, 0x7b4b3d, 0x535250),
    ]
    states, surveys = [], []
    for key, name, road, ids, buildings, center, approach, focus_height, wall_color, roof_color in parts:
        surveys.append(f'  {pack(key)}: [')
        heights = []
        for (bag, osm_id), (points, faces, outline) in zip(ids, buildings, strict=True):
            ground = min(p[1] for p in points)
            heights.append(max(p[1] for p in points) - ground)
            footprint = Polygon(outline[0], outline[1:])
            if not footprint.is_valid or footprint.intersection(osm[osm_id]).area / footprint.area < 0.99:
                raise ValueError(f'Mapped outline does not match {bag} and {osm_id}')
            surveys.extend((
                f'    {{ bagId: {pack(bag)}, ground: {ground}, wallColor: {wall_color:#08x}, roofColor: {roof_color:#08x},',
                '      outline: ' + pack(outline) + ',',
                '      points: [',
                *('        ' + ', '.join(map(pack, points[i:i+5])) + ',' for i in range(0, len(points), 5)),
                '      ],',
                '      faces: [',
                *('        ' + ', '.join(map(pack, faces[i:i+4])) + ',' for i in range(0, len(faces), 4)),
                '      ],',
                '    },',
            ))
        surveys.append('  ],')
        bag_ids, osm_ids = zip(*ids)
        states.extend((
            f'  {{ id: {pack(key)}, name: {pack(name)}, district: "Kernhem", road: {pack(road)},',
            f'    osmId: {pack(osm_ids[0])}, annexOsmIds: {pack(osm_ids[1:])}, bagIds: {pack(bag_ids)},',
            f'    x: {center[0]}, z: {center[1]}, height: {max(heights):.2f}, worldSpace: true,',
            f'    mapScenic: true, focusHeight: {focus_height}, approach: {{ x: {approach[0]}, z: {approach[1]} }} }},',
        ))
    args.output.write_text('\n'.join([
        '// Survey snapshots retrieved 2026-11-21.',
        '// Parkweide: © 3DBAG by tudelft3d and 3DGI, LoD 2.2 adapted under CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
        '// Waterzoom: PDOK BAG footprint and 2026 imagery, AHN approach and Woonstede exterior elevations.',
        f'// Ede scene metres, Y relative to {SCENE_NAP_ORIGIN} m NAP. Face codes are 0 for walls and 1 for roofs.',
        '', 'export const EDE_KERNHEM_NEIGHBORHOOD_LANDMARKS = [', *states, '];',
        '', 'export const KERNHEM_NEIGHBORHOOD_SURVEYS = {', *surveys, '};', '',
    ]), encoding='utf-8')


if __name__ == '__main__':
    main()
