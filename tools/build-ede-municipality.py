#!/usr/bin/env python3
"""Clip the existing expanded scene to the official GM0228 boundary without rebaking the Ede core."""

import argparse
import gzip
import json
from pathlib import Path
from urllib.request import urlopen

from shapely import Point, LineString, Polygon, box, make_valid, prepare, transform, union_all
from shapely.geometry import shape
from shapely.geometry.polygon import orient

from ede_gis import Frame
from ede_map import GRAPHS, LAYERS, MUNICIPAL_ASSET, ROOT, load_playable_scene, municipal_base


URL = ('https://api.pdok.nl/kadaster/brk-bestuurlijke-gebieden/ogc/v1/collections/'
       'gemeentegebied/items/a5a11eb2-8a84-5824-8a84-038aaf21e511?f=json'
       '&crs=http%3A%2F%2Fwww.opengis.net%2Fdef%2Fcrs%2FEPSG%2F0%2F28992')
SOURCE = {'id': 'GM0228', 'name': 'Gemeente Ede', 'edition': '2026', 'licence': 'CC0-1.0', 'url': URL}


def polygons(geometry):
    if not geometry.is_empty:
        if geometry.geom_type == 'Polygon':
            yield geometry
        elif hasattr(geometry, 'geoms'):
            for item in geometry.geoms:
                yield from polygons(item)


def pieces(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == 'LineString':
        yield list(geometry.coords)
    elif hasattr(geometry, 'geoms'):
        for item in geometry.geoms:
            yield from pieces(item)


def flat(pairs):
    return [round(v, 3) for point in pairs for v in point]


def pairs(vertices):
    return list(zip(vertices[::2], vertices[1::2]))


def outlines(polygon):
    return [flat(list(ring.coords)[:-1]) for ring in (polygon.exterior, *polygon.interiors)]


def clipped_lines(line, boundary):
    result = []
    for coords in pieces(line.intersection(boundary)):
        start, end = (line.project(Point(p)) for p in (coords[0], coords[-1]))
        if start > end:
            start, end = end, start
            coords.reverse()
        if start == end:
            continue
        result.append((start, coords))
    return [coords for _, coords in sorted(result)]


def clip_scene(scene, municipality):
    meta = scene['meta']
    prepare(municipality)
    layers, graphs, tagged_roads = {}, {}, {}
    for key in LAYERS:
        changes = []
        for index, row in enumerate(scene[key]):
            if key in ('trees', 'signals'):
                if not municipality.covers(Point(row['x'], row['z'])):
                    changes.append([index, []])
                continue
            if key in ('roads', 'railways'):
                vertices = pairs(row['pts'])
                geometry = LineString(vertices)
            else:
                geometry = Polygon(pairs(row['ring']), [pairs(hole) for hole in row.get('holes', [])])
            if municipality.covers(geometry):
                continue
            results = []
            if key in ('roads', 'railways'):
                runs = clipped_lines(geometry, municipality)
                for coords in runs:
                    clipped = {**row, 'pts': flat(coords)}
                    if key == 'railways':
                        clipped['municipalClip'] = True
                    results.append(clipped)
                if key == 'roads':
                    tagged_roads[index] = [LineString(coords) for coords in runs]
            else:
                for polygon in polygons(make_valid(geometry).intersection(municipality)):
                    if polygon.area < 0.01:
                        continue
                    outer, *holes = outlines(orient(polygon, 1 if geometry.exterior.is_ccw else -1))
                    results.append({**row, 'ring': outer, 'holes': holes})
            for part, result in enumerate(results[1:], 2):
                result.update(id=f'{row["id"]}~{part}', osmId=row['id'])
            changes.append([row['id'] if key == 'water' else index, results])
        layers[key] = {'changes': changes}

    changes = dict(layers['roads']['changes'])
    new_road_indices = {}
    road_count = 0
    for i, _ in enumerate(scene['roads']):
        count = len(changes[i]) if i in changes else 1
        if i in changes and count:
            new_road_indices[i] = list(range(road_count, road_count + count))
        elif count:
            new_road_indices[i] = [road_count]
        road_count += count

    def clip_graph(key):
        graph = scene[key]
        nodes = pairs(graph['nodes'])
        used, seams, changes = set(), {}, []
        for i, (a, b, name, width, lane, direction, inner, road, *flags) in enumerate(graph['links']):
            if road not in new_road_indices:
                changes.append([i, []])
                continue
            path = LineString([nodes[a], *pairs(inner), nodes[b]])
            if municipality.covers(path):
                if road in tagged_roads:
                    midpoint = path.interpolate(0.5, normalized=True)
                    part = min(range(len(tagged_roads[road])), key=lambda j: tagged_roads[road][j].distance(midpoint))
                    if part:
                        changes.append([i, [[a, b, name, width, lane, direction, inner, new_road_indices[road][part], *flags]]])
                used.update((a, b))
                continue
            results = []
            for coords in clipped_lines(path, municipality):
                def node(point, old):
                    if point == nodes[old]:
                        return old
                    edge_point = tuple(flat([point]))
                    return seams.setdefault((road, edge_point), len(nodes) + len(seams))

                start, finish = node(coords[0], a), node(coords[-1], b)
                if start == finish:
                    continue
                used.update((start, finish))
                road_part = 0
                if len(new_road_indices[road]) > 1:
                    midpoint = LineString(coords).interpolate(0.5, normalized=True)
                    road_part = min(range(len(tagged_roads[road])), key=lambda j: tagged_roads[road][j].distance(midpoint))
                results.append([start, finish, name, width, lane, direction, flat(coords[1:-1]),
                                new_road_indices[road][road_part], *flags])
            changes.append([i, results])
        return {'changes': changes, 'addNodes': [v for _, pt in seams for v in pt],
                'dropNodes': [i for i in range(len(nodes) + len(seams)) if i not in used]}

    graphs.update((key, clip_graph(key)) for key in GRAPHS)
    prefix = {}
    for key, field in [('roads', 'baseRoadCount'), ('buildings', 'baseBuildingCount'), ('parks', 'baseParkCount')]:
        prefix[field] = meta[field] + sum(len(rows) - 1 for i, rows in layers[key]['changes'] if i < meta[field])
    prefix['baseRoadNodeCount'] = meta['baseRoadNodeCount'] - sum(
        i < meta['baseRoadNodeCount'] for i in graphs['roadGraph']['dropNodes'])
    return {'layers': layers, 'graphs': graphs, 'prefix': prefix}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('boundary', type=Path, help='2026 Gemeente Ede GeoJSON snapshot in EPSG:28992')
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / MUNICIPAL_ASSET)
    args = parser.parse_args()
    if args.fetch:
        with urlopen(URL, timeout=60) as response:
            if not response.headers.get('Content-Crs', '').endswith('/28992>'):
                raise ValueError('Expected GeoJSON declared in EPSG:28992')
            args.boundary.write_bytes(response.read())
    snapshot = json.loads(args.boundary.read_bytes())
    feature = snapshot['features'][0] if snapshot['type'] == 'FeatureCollection' else snapshot
    if feature['properties']['identificatie'] != 'GM0228':
        raise ValueError('Expected the official Gemeente Ede boundary')
    rd = shape(feature['geometry'])
    if not (165000 < rd.bounds[0] < rd.bounds[2] < 200000 and 440000 < rd.bounds[1] < rd.bounds[3] < 475000):
        raise ValueError('Expected Gemeente Ede in EPSG:28992')
    scene = load_playable_scene(municipal=False)
    frame = Frame(scene['meta']['lonLatAffine'])
    municipality = union_all(list(polygons(make_valid(transform(rd, frame.rd_to_scene, interleaved=False)))))
    playable = municipality.intersection(box(*scene['meta']['bounds']))
    patch = {'version': 1, 'source': SOURCE, 'base': municipal_base(scene),
             'boundary': [outlines(p) for p in polygons(playable)], **clip_scene(scene, playable)}
    args.output.write_bytes(gzip.compress(json.dumps(patch, separators=(',', ':')).encode(), mtime=0))
    print(f'{playable.area / 1e6:.2f} km², {args.output.stat().st_size:,} bytes')
    for key, layer in {**patch['layers'], **patch['graphs']}.items():
        print(f'{key}: {sum(not rows for _, rows in layer["changes"]):,} removed, '
              f'{sum(bool(rows) for _, rows in layer["changes"]):,} clipped')


if __name__ == '__main__':
    main()
