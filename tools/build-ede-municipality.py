#!/usr/bin/env python3
"""Map the full official GM0228 boundary while preserving the reviewed Ede core."""

import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path
import runpy
from urllib.request import urlopen

from shapely import Point, LineString, Polygon, box, make_valid, prepare, transform, union_all
from shapely.geometry import shape
from shapely.geometry.polygon import orient

from ede_gis import Frame
from ede_map import (COMPLETION_ASSET, GRAPHS, LAYERS, MUNICIPAL_ASSET, ROOT,
                     apply_complete_coverage, load_playable_scene, load_scene_metadata, municipal_base)


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


def clip_scene(scene, municipality, *, whole_buildings=False, travel=None):
    meta = scene['meta']
    prepare(municipality)
    layers, graphs, tagged_roads = {}, {}, {}
    travel = municipality if travel is None else travel
    for key in LAYERS:
        changes = []
        for index, row in enumerate(scene[key]):
            boundary = travel if key == 'roads' or (key == 'water' and row.get('fringe')) else municipality
            if key in ('trees', 'signals'):
                if not municipality.covers(Point(row['x'], row['z'])):
                    changes.append([index, []])
                continue
            if key in ('roads', 'railways'):
                vertices = pairs(row['pts'])
                geometry = LineString(vertices)
            else:
                geometry = Polygon(pairs(row['ring']), [pairs(hole) for hole in row.get('holes', [])])
            # The authoritative exterior BAG barn 0228100000068408 overlaps this OSM fallback.
            if key == 'buildings' and whole_buildings and row['id'] == 'w271597062':
                changes.append([index, []])
                continue
            if boundary.covers(geometry):
                continue
            if key == 'buildings' and whole_buildings:
                geometry = make_valid(geometry)
                if geometry.area <= 0 or geometry.intersection(municipality).area < geometry.area / 2:
                    changes.append([index, []])
                continue
            results = []
            if key in ('roads', 'railways'):
                runs = clipped_lines(geometry, boundary)
                for coords in runs:
                    clipped = {**row, 'pts': flat(coords)}
                    if key == 'railways':
                        clipped['municipalClip'] = True
                    results.append(clipped)
                if key == 'roads':
                    tagged_roads[index] = [LineString(coords) for coords in runs]
            else:
                for polygon in polygons(make_valid(geometry).intersection(boundary)):
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
            if travel.covers(path):
                if road in tagged_roads:
                    midpoint = path.interpolate(0.5, normalized=True)
                    part = min(range(len(tagged_roads[road])), key=lambda j: tagged_roads[road][j].distance(midpoint))
                    if part:
                        changes.append([i, [[a, b, name, width, lane, direction, inner, new_road_indices[road][part], *flags]]])
                used.update((a, b))
                continue
            results = []
            for coords in clipped_lines(path, travel):
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


def complete_graph(scene, source, key, road_indices, affected):
    original, updated = scene[key], source[key]
    nodes, names = original['nodes'].copy(), original['names'].copy()
    name_indices = {name: index for index, name in enumerate(names)}
    road_ids = [road['id'] for road in scene['roads']]
    source_roads = source['roads']
    updated_roads = {source_roads[link[7]]['id'] for link in updated['links']}
    existing_ways = {road['id']: set(road.get('nodeIds', ())) for road in scene['roads']}
    old_at, source_at, new_nodes = defaultdict(list), defaultdict(set), {}
    controls = original.get('controls', {}).copy()

    for link in original['links']:
        for index in link[:2]:
            location = tuple(nodes[index * 2:index * 2 + 2])
            old_at[location].append((index, road_ids[link[7]]))
    for link in updated['links']:
        road_id = source_roads[link[7]]['id']
        for index in link[:2]:
            source_at[index].add(road_id)

    claimed = {}
    def node(index):
        if index not in new_nodes:
            location = tuple(updated['nodes'][index * 2:index * 2 + 2])
            osm_id = updated['osmNodes'][index]
            old = next((i for i, road in old_at[location]
                        if road in source_at[index] and osm_id in existing_ways[road]
                        and (i not in claimed or claimed[i] == osm_id)), None)
            if old is None:
                old = len(nodes) // 2
                nodes.extend(location)
            claimed[old] = osm_id
            new_nodes[index] = old
        return new_nodes[index]

    links = [link for link in original['links']
             if road_ids[link[7]] not in affected or road_ids[link[7]] not in updated_roads]
    for link in updated['links']:
        road_id = source_roads[link[7]]['id']
        if road_id not in affected:
            continue
        a, b, name, *fields = link
        name = updated['names'][name]
        name_index = name_indices.setdefault(name, len(names))
        if name_index == len(names):
            names.append(name)
        links.append([node(a), node(b), name_index, *fields[:4], road_indices[road_id], *fields[5:]])
    for index, control in updated.get('controls', {}).items():
        if int(index) in new_nodes:
            controls[str(new_nodes[int(index)])] = control
    return {'nodes': nodes, 'links': links, 'names': names, **({'controls': controls} if key == 'activeGraph' else {})}


def build_completion(scene, source, coverage, municipality, travel):
    previous_bounds = box(*scene['meta']['bounds'])
    prepare(previous_bounds)
    layers = {key: {'replace': [], 'add': []} for key in LAYERS}
    new_nodes, affected = set(), set()
    road_indices = {road['id']: i for i, road in enumerate(scene['roads'])}
    old_water = union_all([make_valid(Polygon(pairs(row['ring']), [pairs(hole) for hole in row.get('holes', [])]))
                           for row in scene['water']])

    for key, changes in layers.items():
        previous = {row['id']: (i, row) for i, row in enumerate(scene[key]) if 'id' in row}
        previous_points = {(row['x'], row['z']) for row in scene[key] if 'x' in row}
        seen = set(previous)
        for row in source[key]:
            if key in ('trees', 'signals'):
                point = row['x'], row['z']
                if point not in previous_points and municipality.covers(Point(point)):
                    changes['add'].append(row)
                    previous_points.add(point)
                continue
            identity = row['id']
            earlier = previous.get(identity)
            if key in ('roads', 'railways'):
                line = LineString(pairs(row['pts']))
                boundary = travel if key == 'roads' else municipality
                if not boundary.intersects(line):
                    continue
                if earlier:
                    index, old = earlier
                    if row['pts'] == old['pts'] or previous_bounds.covers(line):
                        continue
                    if key == 'roads' and not set(row['nodeIds']).difference(old['nodeIds']):
                        continue
                    if key == 'railways' and not any(line.distance(Point(point)) < 1 for point in pairs(old['pts'])):
                        continue
                    properties = {'pts': row['pts']}
                    if key == 'roads':
                        properties['nodeIds'] = row['nodeIds']
                        new_nodes.update(row['nodeIds'])
                        affected.add(identity)
                    changes['replace'].append([index, {**old, **properties}])
                    continue
                if key == 'roads':
                    new_nodes.update(row['nodeIds'])
                    affected.add(identity)
                    road_indices[identity] = len(scene['roads']) + len(changes['add'])
            elif key == 'water':
                geometry = make_valid(Polygon(pairs(row['ring']), [pairs(hole) for hole in row.get('holes', [])]))
                if previous_bounds.covers(geometry):
                    continue
                for part, piece in enumerate(polygons(geometry.intersection(municipality).difference(old_water))):
                    if piece.area >= 10:
                        ring, *holes = outlines(orient(piece, 1))
                        changes['add'].append({**row, 'id': f'{identity}~{part + 1}', 'ring': ring, 'holes': holes})
                continue
            elif key in ('buildings', 'parks', 'squares'):
                if identity in seen:
                    continue
                footprint = make_valid(Polygon(pairs(row['ring']), [pairs(hole) for hole in row.get('holes', [])]))
                if not municipality.intersects(footprint):
                    continue
            changes['add'].append(row)
            seen.add(identity)

    affected.update(road['id'] for road in source['roads'] if road['id'] in road_indices
                    and new_nodes.intersection(road.get('nodeIds', ())))
    areas = list(scene['meta'].get('areas', ()))
    for area in source['meta'].get('areas', ()):
        point = Point(area['labelPoint'])
        if area.get('place') and municipality.covers(point) and not any(
                old['name'] == area['name'] and point.distance(Point(old['labelPoint'])) < 1000 for old in areas):
            areas.append(area)
    return {'version': 1, 'base': municipal_base(scene), 'layers': layers,
            'bounds': coverage['bounds'], 'geographicBounds': coverage['geographicBounds'], 'areas': areas,
            'travelBounds': [round(coordinate, 3) for coordinate in travel.bounds],
            'source': source['meta'].get('sourceDate'),
            'graphs': {key: complete_graph(scene, source, key, road_indices, affected) for key in GRAPHS}}


def fringe_water(source, affine, fringe):
    world_geometry = runpy.run_path(str(ROOT / 'tools/build-ede-bgt.py'))['world_geometry']
    document = json.loads(source.read_bytes())
    if document.get('type') != 'FeatureCollection':
        raise ValueError('Expected BGT waterdeel GeoJSON')
    latest = {}
    for feature in document['features']:
        properties = feature['properties']
        identity = properties['lokaal_id']
        if properties.get('status') != 'bestaand' or properties.get('relatieve_hoogteligging') or not feature.get('geometry'):
            continue
        old = latest.get(identity)
        if old is None or properties.get('tijdstip_registratie', '') > old['properties'].get('tijdstip_registratie', ''):
            latest[identity] = feature
    for identity, feature in sorted(latest.items()):
        geometry = world_geometry(feature, affine, fringe)
        for i, polygon in enumerate(polygons(geometry)):
            if polygon.area < 0.25:
                continue
            ring, *holes = outlines(orient(polygon, 1))
            yield {'id': f'bgt-fringe-water-{identity}-{i + 1}', 'ring': ring, 'holes': holes,
                   'name': '', 'kind': feature['properties'].get('type') or 'water', 'fringe': True}


def coverage_snapshot(rd, frame):
    def to_scene(geometry):
        return make_valid(transform(geometry, frame.rd_to_scene, interleaved=False))

    def rings(geometry):
        return [outlines(orient(polygon, 1)) for polygon in polygons(geometry)]

    municipality = to_scene(rd)
    west, south, east, north = transform(municipality, frame.scene_to_lon_lat, interleaved=False).bounds
    return {
        'version': 1, 'source': SOURCE,
        'playableBoundary': rings(municipality),
        'buildingBoundary': rings(to_scene(rd.buffer(500, quad_segs=24))),
        'terrainBoundary': rings(to_scene(rd.buffer(2000, quad_segs=24))),
        'bounds': [round(value, 3) for value in municipality.bounds],
        'geographicBounds': [south, west, north, east],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('boundary', type=Path, help='2026 Gemeente Ede GeoJSON snapshot in EPSG:28992')
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--scene', type=Path, help='Compiled full OSM scene from build-ede-geodata.mjs --complete')
    parser.add_argument('--fringe-water', type=Path, help='BGT waterdeel GeoJSON for the 500 m exterior collar')
    parser.add_argument('--coverage-output', type=Path, default=ROOT / 'assets/ede-coverage-v1.json')
    parser.add_argument('--coverage-only', action='store_true')
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
    rd = union_all(list(polygons(make_valid(rd))))
    affine = load_scene_metadata()['lonLatAffine']
    frame = Frame(affine)
    coverage = coverage_snapshot(rd, frame)
    if args.coverage_only:
        args.coverage_output.write_text(json.dumps(coverage, separators=(',', ':')) + '\n')
        print(f'GM0228 {rd.area / 1e6:.2f} km²; +500 m {rd.buffer(500).area / 1e6:.2f} km²; +2 km {rd.buffer(2000).area / 1e6:.2f} km²')
        return
    scene = load_playable_scene(municipal=False, complete=False)
    municipality = union_all(list(polygons(make_valid(transform(rd, frame.rd_to_scene, interleaved=False)))))
    if args.scene:
        source = json.loads(gzip.decompress(args.scene.read_bytes()))
        prepare(municipality)
        travel = make_valid(transform(rd.buffer(500, quad_segs=24), frame.rd_to_scene, interleaved=False))
        prepare(travel)
        completion = build_completion(scene, source, coverage, municipality, travel)
        if args.fringe_water:
            completion['layers']['water']['add'].extend(fringe_water(args.fringe_water, affine, travel.difference(municipality)))
        apply_complete_coverage(scene, completion)
        playable = municipality
    else:
        completion = None
        playable = municipality.intersection(box(*scene['meta']['bounds']))
        travel = playable
    patch = {'version': 1, 'source': SOURCE, 'base': municipal_base(scene),
             'boundary': coverage['playableBoundary'] if completion else [outlines(p) for p in polygons(playable)],
             **clip_scene(scene, playable, whole_buildings=completion is not None, travel=travel)}
    result = {**completion, 'municipality': patch} if completion else patch
    output = args.output or ROOT / (COMPLETION_ASSET if completion else MUNICIPAL_ASSET)
    output.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':')).encode(), mtime=0))
    print(f'{playable.area / 1e6:.2f} km², {output.stat().st_size:,} bytes')
    if completion:
        for key, layer in completion['layers'].items():
            print(f'{key}: {len(layer["add"]):,} added, {len(layer["replace"]):,} extended')
    for key, layer in {**patch['layers'], **patch['graphs']}.items():
        print(f'{key}: {sum(not rows for _, rows in layer["changes"]):,} removed, '
              f'{sum(bool(rows) for _, rows in layer["changes"]):,} clipped')


if __name__ == '__main__':
    main()
