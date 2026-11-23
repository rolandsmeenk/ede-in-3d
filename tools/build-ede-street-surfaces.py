#!/usr/bin/env python3
"""Rebuild Ede speed humps and pedestrian crossings from local NDW and OSM snapshots.

Requires Shapely 2.1+. The NDW inputs may be downloaded ZIPs or extracted GeoPackages.
Use the OSM road snapshot used by build-ede-geodata.mjs and the street-surfaces Overpass query.
"""

import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime
import json
import math
from pathlib import Path
import shutil
import sqlite3
import tempfile
from zipfile import ZipFile

from shapely import STRtree, from_wkb, make_valid
from shapely import transform
from shapely.geometry import LineString, Point, Polygon

from ede_gis import Frame, geopackage_crs, geopackage_wkb
from ede_map import load_playable_boundary, load_playable_scene, load_scene

PORTAL = 'https://verkeersveiligheid.ndw.nu'
FILES = PORTAL + '/cms/api/dataset-files/file/'
SOURCES = {
    'drempels': {'url': PORTAL + '/dataset/drempels', 'download': FILES + 'Drempels.zip?prefix=dataset', 'release': '2026-04-28'},
    'vop': {'url': PORTAL + '/dataset/voetgangersoversteekplaatsen', 'download': FILES + 'VOPs.zip?prefix=dataset', 'release': '2025'},
    'osm': {'url': 'https://www.openstreetmap.org/copyright', 'license': 'ODbL 1.0'},
}
BUMP_PROFILES = {
    'hump': ('hump', 3.5, 0.08), 'bump': ('hump', 1.2, 0.06),
    'table': ('table', 7, 0.08), 'cushion': ('cushion', 2.5, 0.07),
}
MOTOR = 7
ZEBRA_MARKINGS = {'zebra', 'zebra:double', 'zebra:paired', 'zebra:bicolour'}


def pair(point, marks=2):
    return [round(v, marks) for v in point]


def vector(a, b):
    length = math.dist(a, b)
    return ((b[0] - a[0]) / length, (b[1] - a[1]) / length) if length else (0, 0)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def advance(a, direction, length):
    return a[0] + direction[0] * length, a[1] + direction[1] * length


def normal(direction):
    return -direction[1], direction[0]


def ndw_polygon(blob, srs_id, project_rd):
    shape = from_wkb(bytes(geopackage_wkb(blob, srs_id)))
    parts = shape.geoms if shape.geom_type == 'MultiPolygon' else [shape]
    for p in parts:
        if p.geom_type != 'Polygon':
            raise ValueError(f'Expected an NDW footprint polygon, got {p.geom_type}')
        rings = [[project_rd(x, y) for x, y, *_ in r.coords] for r in (p.exterior, *p.interiors)]
        valid = make_valid(Polygon(rings[0], rings[1:]))
        for item in getattr(valid, 'geoms', [valid]):
            if item.geom_type == 'Polygon' and item.area >= 0.5:
                yield item


@contextmanager
def package(path, member):
    if not path.suffix.lower() == '.zip':
        yield path
        return
    with tempfile.TemporaryDirectory() as directory, ZipFile(path) as archive:
        names = [name for name in archive.namelist() if Path(name).name == member]
        if len(names) != 1:
            raise ValueError(f'Expected {member} in {path}')
        destination = Path(directory) / member
        with archive.open(names[0]) as source, destination.open('wb') as output:
            shutil.copyfileobj(source, output)
        yield destination


def source_rows(path, project_rd, bounds, bumps):
    if bumps:
        member, table, key = 'E046_Verkeersdrempels.gpkg', 'verkeersdrempels', 'DrempelID'
        columns = 'typering, bron, WVK_ID'
        predicate = "AND t.typering IN ('drempel', 'plateau')"
    else:
        member, table, key = 'E046_VOPs.gpkg', 'VOPs_met_eigenschappen', 'id'
        columns = 'VOP_ID, WVK_ID, rvvCode_wvk, DrempelID_WVK, DrempelID_any'
        predicate = ''
    with package(path, member) as file, sqlite3.connect(file.resolve().as_uri() + '?mode=ro', uri=True) as db:
        srs_id, crs = geopackage_crs(db, table)
        if crs.to_epsg() != 28992:
            raise ValueError(f'NDW {table} spatial index must be in RD New')
        # Window covers the Ede play area and a buffer in Rijksdriehoek metres.
        rows = db.execute(f'''
            SELECT t.{key}, t.geom, {columns} FROM {table} AS t
            JOIN rtree_{table}_geom AS r ON t.{key} = r.id
            WHERE r.maxx >= 168000 AND r.minx <= 178000 AND r.maxy >= 446000 AND r.miny <= 454000 {predicate}
            ORDER BY t.{key}
        ''')
        for key, blob, *values in rows:
            for index, polygon in enumerate(ndw_polygon(blob, srs_id, project_rd)):
                if bounds.covers(polygon.centroid):
                    yield str(key) if not index else f'{key}-{index}', polygon, values


def elements(path):
    response = json.loads(path.read_bytes())
    if response.get('remark') or not response.get('elements'):
        raise ValueError(f'Expected a complete OSM snapshot in {path}')
    return response


def road_direction(line, point, step=1.5):
    station = line.project(point)
    return vector(line.interpolate(station - min(step, station)).coords[0],
                  line.interpolate(station + step).coords[0])


def width_and_source(road, tags):
    explicit = tags.get('width', '').strip().removesuffix(' m').replace(',', '.')
    try:
        value = float(explicit)
        if 1 <= value <= 40:
            return value, 'osm-tag'
    except ValueError:
        pass
    if road.get('bgt', {}).get('width'):
        return road['bgt']['width'], 'bgt'
    return road['width'], 'model'


def cross_path(tags):
    return (tags.get('footway') == 'crossing' or tags.get('cycleway') == 'crossing'
            or tags.get('path') == 'crossing')


class Map:
    def __init__(self, scene, rows, geographic_to_grid, scene_to_grid, bounds):
        self.bounds = bounds
        project = geographic_to_grid
        self.nodes = {e['id']: e for e in rows.values() if e['type'] == 'node'}
        self.point = lambda e: Point(project(e['lon'], e['lat']))
        self.roads, self.lines = [], []
        self.roads_by_node, self.paths_by_node = defaultdict(list), defaultdict(list)
        self.paths, self.path_lines = [], []
        self.by_id = {}
        self.separate = []
        for road in scene['roads']:
            osm_id = road.get('osmId', road['id']).split('~', 1)[0]
            source = rows.get(('way', int(osm_id[1:])), {})
            ids = source.get('nodes', road.get('nodeIds', []))
            tags = source.get('tags', {})
            if tags.get('area') == 'yes':
                continue
            points = [project(p['lon'], p['lat']) for p in source.get('geometry', [])]
            if len(points) < 2 or not bounds.covers(LineString(points)):
                points = [scene_to_grid(x, z) for x, z in zip(road['pts'][::2], road['pts'][1::2])]
            line = LineString(points)
            if line.length < 0.1:
                continue
            if road['bridge'] or road['tunnel'] or road['layer']:
                self.separate.append(line)
            if any(mode & MOTOR for mode in road.get('modes', [])):
                width, width_source = width_and_source(road, tags)
                item = {**road, 'line': line, 'width': width, 'widthSource': width_source, 'tags': tags}
                self.roads.append(item)
                self.lines.append(line)
                self.by_id[road['id']] = item
                for node in ids:
                    self.roads_by_node[node].append(item)
            elif cross_path(tags):
                item = {**road, 'line': line, 'nodeIds': ids, 'tags': tags}
                self.paths.append(item)
                self.path_lines.append(line)
                for node in ids:
                    self.paths_by_node[node].append(item)
        self.road_tree = STRtree(self.lines)
        self.path_tree = STRtree(self.path_lines)
        self.grade_tree = STRtree(self.separate)

    def at_grade(self, point):
        return not len(self.grade_tree.query(point, predicate='dwithin', distance=4))

    def nearby_roads(self, geometry, distance):
        return [self.roads[i] for i in self.road_tree.query(geometry, predicate='dwithin', distance=distance)]

    def related_paths(self, point, road, direction, ends, ids):
        paths = {}
        for node in ids:
            for path in self.paths_by_node[node]:
                if same_level(path, road):
                    paths[path['id']] = path
        corridor = LineString(ends)
        for i in self.path_tree.query(corridor, predicate='dwithin', distance=1.05):
            path = self.paths[i]
            if not same_level(path, road) or path['line'].distance(point) > road['width'] / 2 + 1:
                continue
            cross_direction = road_direction(path['line'], point)
            if abs(dot(cross_direction, direction)) <= 0.62:
                paths[path['id']] = path
        return paths


def same_level(a, b):
    return all(a[key] == b[key] for key in ('layer', 'bridge', 'tunnel'))


def road_pose(road, point, direction, width, length, **values):
    return dict(x=point.x, z=point.y, tangent=direction, width=round(width, 2),
                length=round(length, 2), wayId=road['id'], layer=road['layer'], bridge=road['bridge'],
                tunnel=road['tunnel'], street=road['name'], **values)


def dimension(polygon, center, axis):
    offset = dot(center, axis)
    values = [dot(p, axis) - offset for p in polygon.exterior.coords[:-1]]
    return min(values), max(values)


def footprint(polygon):
    return list(polygon.exterior.coords[:-1])


def tied_ways(ranked, best):
    return sorted({road['id'] for _, road in ranked if same_level(road, best)})


def bump_road(map_, polygon, center):
    candidates = []
    for road in map_.nearby_roads(polygon, 0.65):
        if road['bridge'] or road['tunnel'] or road['layer']:
            continue
        line = road['line']
        cut = polygon.intersection(line).length
        if cut < 0.85 or line.distance(center) > max(2.4, road['width'] * 0.54):
            continue
        coverage = cut / max(1, math.sqrt(polygon.area))
        candidates.append((line.distance(center) - min(0.8, coverage * 0.35), road))
    candidates.sort(key=lambda item: (item[0], item[1]['id']))
    return candidates


def ndw_bumps(map_, rows, omitted):
    result, geometry = [], []
    for key, polygon, (kind, detectors, road_ids) in rows:
        center = polygon.centroid
        ranked = bump_road(map_, polygon, center)
        if not ranked or not map_.at_grade(center):
            omitted['drempels-road-or-grade'] += 1
            continue
        road = ranked[0][1]
        direction = road_direction(road['line'], center)
        across, along = dimension(polygon, center.coords[0], normal(direction)), dimension(polygon, center.coords[0], direction)
        width, length = across[1] - across[0], along[1] - along[0]
        if not 1.35 <= width <= 40 or not 0.9 <= length <= 46 or polygon.area / (width * length) < 0.27:
            omitted['drempels-dimensions'] += 1
            continue
        profile = 'table' if kind == 'plateau' else 'hump'
        result.append(road_pose(road, center, direction, width, length, id='ndw-drempel-' + key,
                                candidateWayIds=tied_ways(ranked, road), profile=profile,
                                height=BUMP_PROFILES[profile][2], heightEstimated=True,
                                estimated=len((detectors or '').split(',')) == 1,
                                widthSource='ndw-polygon', lengthSource='ndw-polygon', footprint=footprint(polygon),
                                sources=[{'source': 'drempels', 'id': key, 'detectors': detectors.split(',') if detectors else [],
                                          'nwbWayIds': road_ids.split(',') if road_ids else []}]))
        geometry.append(polygon)
    return result, geometry


def spanning_polygon_matches(tree, geometry, records, point, road, maximum):
    nearby = []
    for i in tree.query(point, predicate='dwithin', distance=maximum):
        record = records[i]
        if same_level(record, road) and road['id'] in record['candidateWayIds']:
            nearby.append((geometry[i].distance(point), geometry[i].centroid.distance(point), record['id'], record))
    return min(nearby, default=(None, None, None, None))[-1]


def osm_bumps(map_, rows, result, geometry, omitted):
    tree = STRtree(geometry)
    for e in rows.values():
        tags = e.get('tags', {})
        kind = tags.get('traffic_calming')
        if kind not in BUMP_PROFILES or e['type'] not in ('node', 'way'):
            continue
        way = map_.by_id.get(f"w{e['id']}") if e['type'] == 'way' else None
        if e['type'] == 'way' and not way:
            continue
        center = way['line'].interpolate(0.5, normalized=True) if way else map_.point(e)
        if not map_.bounds.covers(center):
            continue
        candidates = [way] if way else map_.roads_by_node.get(e['id'], [])
        if not candidates:
            omitted['osm-calming-road'] += 1
            continue
        candidates = sorted(candidates, key=lambda road: (road['line'].distance(center), -road['line'].length, road['id']))
        road = candidates[0]
        if any(not same_level(item, road) for item in candidates[1:]):
            omitted['osm-calming-grade'] += 1
            continue
        direction = road_direction(road['line'], center)
        if kind != 'table' and any(abs(dot(road_direction(item['line'], center), direction)) < 0.65 for item in candidates[1:]):
            omitted['osm-calming-junction'] += 1
            continue
        source = {'source': 'osm', 'id': f"{e['type'][0]}{e['id']}", 'tag': kind}
        profile, length, height = BUMP_PROFILES[kind]
        match = spanning_polygon_matches(tree, geometry, result, center, road, 1.25)
        if match:
            match['sources'].append(source)
            match['estimated'] = False
            match['profile'] = profile
            match['height'] = height
            continue
        measured_length = way and 0.9 <= way['line'].length <= 35
        result.append(road_pose(road, center, direction, road['width'], way['line'].length if measured_length else length,
                                id='osm-calming-' + source['id'], profile=profile, height=height, heightEstimated=True,
                                widthSource=road['widthSource'], lengthSource='osm-way' if measured_length else 'model',
                                candidateWayIds=sorted(item['id'] for item in candidates), estimated=True, sources=[source]))


def marking_tokens(value):
    return {token.strip() for token in (value or '').split(';') if token.strip()}


def apply_crossing_marking(crossing):
    """Resolve paint for one carriageway independently of its crossing control."""
    sources = crossing['sources']
    crossing.pop('markingEvidence', None)
    crossing.pop('markingReview', None)
    crossing.pop('markingColour', None)
    reviewed = next((s for s in sources if s['source'] == 'pdok'), None)
    if reviewed:
        marking = reviewed['markings']
        crossing.update(markings=marking, marked=bool(marking_tokens(marking) & ZEBRA_MARKINGS),
                        markingEvidence='pdok')
        if reviewed.get('markingColour'):
            crossing['markingColour'] = reviewed['markingColour']
        return

    vop = any(s['source'] == 'vop' for s in sources)
    osm = [s for s in sources if s['source'] == 'osm']
    reported = {s['markings'].strip() for s in osm if s.get('markings')}
    if any(s.get('crossing') == 'zebra' for s in osm):
        reported.add('zebra')
    if any(s.get('crossing') == 'unmarked' for s in osm):
        reported.add('no')
    zebra = [tokens for value in reported if (tokens := marking_tokens(value)) & ZEBRA_MARKINGS]
    other = sorted(value for value in reported - {'yes'} if not marking_tokens(value) & ZEBRA_MARKINGS)
    if (vop or zebra) and (other or any('no' in tokens for tokens in zebra)):
        crossing.update(markings=other[0] if len(other) == 1 else None, marked=False,
                        markingReview='conflicting-markings')
        return
    if vop or zebra:
        styles = set().union(*zebra)
        variants = sorted((styles & ZEBRA_MARKINGS) - {'zebra'})
        if len(variants) > 1:
            crossing.update(markings=None, marked=False, markingReview='conflicting-markings')
            return
        marking = ';'.join([variants[0] if variants else 'zebra', *sorted(styles - ZEBRA_MARKINGS - {'yes'})])
        crossing.update(markings=marking, marked=True, markingEvidence='vop' if vop else 'osm')
    else:
        crossing.update(markings=other[0] if len(other) == 1 else 'yes' if reported == {'yes'} else None, marked=False)
        if len(other) > 1:
            crossing['markingReview'] = 'conflicting-markings'
    colours = {s['markingColour'] for s in osm if s.get('markingColour')
               and marking_tokens(s.get('markings')) & marking_tokens(crossing['markings'])}
    if len(colours) == 1:
        crossing['markingColour'] = colours.pop()


def marking_reviews(crossings, reviews):
    by_id = {c['id']: c for c in crossings}
    for identity, review in reviews.items():
        required = ('markings', 'imagery', 'date', 'note')
        if (identity not in by_id or not isinstance(review, dict)
                or any(not isinstance(review.get(k), str) or not review[k].strip() for k in required)
                or not review['imagery'].startswith('https://')):
            raise ValueError(f'Invalid crossing marking review: {identity}')
        crossing = by_id[identity]
        source = {'source': 'pdok', 'id': identity, **{k: review[k] for k in required}}
        if 'markingColour' in review:
            if not isinstance(review['markingColour'], str) or not review['markingColour'].strip():
                raise ValueError(f'Invalid crossing marking colour: {identity}')
            source['markingColour'] = review['markingColour']
        crossing['sources'].append(source)
        apply_crossing_marking(crossing)


def band_axis(polygon, direction):
    ring = list(polygon.minimum_rotated_rectangle.exterior.coords)
    axes = [vector(a, b) for a, b in zip(ring, ring[1:3])]
    axis = max(axes, key=lambda candidate: abs(dot(candidate, normal(direction))))
    return axis if dot(axis, normal(direction)) >= 0 else (-axis[0], -axis[1])


def ndw_crossings(map_, rows, omitted):
    result = []
    for key, polygon, (identity, wvk, signs, linked, nearby) in rows:
        center = polygon.centroid
        candidates = []
        for road in map_.nearby_roads(polygon, 0.45):
            if road['bridge'] or road['tunnel'] or road['layer']:
                continue
            distance = road['line'].distance(center)
            if distance > min(3, road['width'] * 0.40):
                continue
            direction = road_direction(road['line'], center)
            axis = band_axis(polygon, direction)
            across, along = dimension(polygon, center.coords[0], axis), dimension(polygon, center.coords[0], normal(axis))
            width, length = across[1] - across[0], along[1] - along[0]
            if not 2.05 <= width <= 24 or not 1.25 <= length <= 8 or width < road['width'] * 0.48:
                continue
            if not polygon.buffer(0.45).intersects(road['line']):
                continue
            score = distance + abs(dot(direction, axis)) * 2.0
            candidates.append((score, road, direction, axis, across, width, length))
        candidates.sort(key=lambda record: (record[0], record[1]['id']))
        if not candidates or not map_.at_grade(center):
            omitted['vop-road-or-grade'] += 1
            continue
        score, road, direction, axis, across, width, length = candidates[0]
        plausible = [(score, road)]
        for other_score, other, other_direction, *_ in candidates[1:]:
            if other_score - score < 1.1 and abs(dot(direction, other_direction)) > 0.85:
                plausible.append((other_score, other))
        center_coords = center.coords[0]
        ends = [advance(center_coords, axis, length) for length in across]
        result.append(road_pose(road, center, (axis[1], -axis[0]), width, length, id='ndw-vop-' + key,
                                candidateWayIds=tied_ways(plausible, road), marked=True, markings='zebra',
                                markingEvidence='vop',
                                control='uncontrolled', ends=ends, osmNodeIds=[], pathWayIds=[], refuge=False,
                                widthSource='ndw-polygon', lengthSource='ndw-polygon', footprint=footprint(polygon),
                                sources=[{'source': 'vop', 'id': key, 'featureId': identity, 'nwbWayId': wvk,
                                          'signs': (signs or '').split(',') if signs else [],
                                          'drempelIds': sorted({r for r in (linked, nearby) if r})}],
                                estimated=False))
    return result


def osm_crossing_nodes(map_, omitted):
    for node_id, e in map_.nodes.items():
        tags = e.get('tags', {})
        signal = tags.get('crossing:signals') == 'yes' or tags.get('crossing') == 'traffic_signals'
        if tags.get('highway') != 'crossing' and not signal:
            continue
        point = map_.point(e)
        if not map_.bounds.covers(point):
            continue
        roads = map_.roads_by_node.get(node_id, [])
        paths = map_.paths_by_node.get(node_id, [])
        candidates = []
        for road in roads:
            direction = road_direction(road['line'], point)
            matching_paths = [path for path in paths if same_level(path, road)]
            angle = min((abs(dot(road_direction(p['line'], point), direction)) for p in matching_paths), default=0.5)
            candidates.append((angle, road['id'], road, direction))
        candidates.sort(key=lambda c: c[:2])
        if not candidates:
            omitted['osm-crossing-road'] += 1
            continue
        angle, _, road, direction = candidates[0]
        if any(second_angle - angle < 0.18 and
               (not same_level(other, road) or abs(dot(direction, other_direction)) < 0.74)
               for second_angle, _, other, other_direction in candidates[1:]):
            omitted['osm-crossing-junction-or-grade'] += 1
            continue
        axis = normal(direction)
        exact_paths = [p for p in paths if same_level(p, road) and abs(dot(road_direction(p['line'], point), direction)) <= 0.55]
        if exact_paths:
            axis = road_direction(max(exact_paths, key=lambda p: p['line'].length)['line'], point)
            if dot(axis, normal(direction)) < 0:
                axis = -axis[0], -axis[1]
        center, width = point.coords[0], road['width'] / abs(dot(axis, normal(direction)))
        ends = [advance(center, axis, side * width / 2) for side in (-1, 1)]
        related = map_.related_paths(point, road, direction, ends, [node_id])
        source = {'source': 'osm', 'id': f'n{node_id}', 'crossing': tags.get('crossing'),
                  'signals': tags.get('crossing:signals'), 'markings': tags.get('crossing:markings')}
        if tags.get('crossing:markings:colour'):
            source['markingColour'] = tags['crossing:markings:colour']
        crossing = road_pose(road, point, (axis[1], -axis[0]), width, 2.5,
                             id=f'osm-crossing-n{node_id}', candidateWayIds=sorted(c[1] for c in candidates if same_level(c[2], road)),
                             estimated=True, widthSource=road['widthSource'], lengthSource='model', ends=ends,
                             osmNodeIds=[node_id], pathWayIds=sorted(related),
                             refuge=tags.get('crossing:island') == 'yes' or tags.get('traffic_calming') == 'island',
                             sources=[source])
        apply_crossing_marking(crossing)
        crossing['control'] = 'signal' if signal else 'uncontrolled'
        if crossing['marked']:
            crossing['length'] = 3
        yield crossing


def merge_sources(map_, crossings, osm, reviews, *, published_scope=False):
    polygons = [Polygon(c['footprint']) for c in crossings]
    tree = STRtree(polygons)
    for c in osm:
        point = Point(c['x'], c['z'])
        ranked = []
        for i in tree.query(point, predicate='dwithin', distance=2.4):
            ndw = crossings[i]
            if same_level(ndw, c) and set(ndw['candidateWayIds']).intersection(c['candidateWayIds']):
                ranked.append((polygons[i].distance(point), polygons[i].centroid.distance(point), i))
        if ranked:
            ndw = crossings[min(ranked)[2]]
            ndw['sources'].extend(c['sources'])
            ndw['osmNodeIds'].extend(c['osmNodeIds'])
            ndw['pathWayIds'] = sorted(set(ndw['pathWayIds'] + c['pathWayIds']))
            ndw['refuge'] |= c['refuge']
            if c['control'] == 'signal':
                ndw['control'] = 'signal'
            apply_crossing_marking(ndw)
            continue
        if (c['marked'] or c['control'] == 'signal' or c['id'] in reviews
                or not published_scope and (c['markings'] is not None or c.get('markingReview'))):
            crossings.append(c)
    for c in crossings:
        road = map_.by_id[c['wayId']]
        paths = map_.related_paths(Point(c['x'], c['z']), road, c['tangent'], c['ends'], c['osmNodeIds'])
        c['pathWayIds'] = sorted(set(c['pathWayIds']).union(paths))


def link_bumps(crossings, bumps):
    shapes = [Polygon(b['footprint']) if 'footprint' in b else Point(b['x'], b['z']) for b in bumps]
    tree = STRtree(shapes)
    for c in crossings:
        point = Point(c['x'], c['z'])
        strip = LineString(c['ends'])
        linked_ids = {key for source in c['sources'] for key in source.get('drempelIds', [])}
        crossing_nodes = {s['id'] for s in c['sources'] if s['source'] == 'osm'}
        options = []
        for i in tree.query(point, predicate='dwithin', distance=2):
            b = bumps[i]
            offset = c['x'] - b['x'], c['z'] - b['z']
            if not same_level(c, b) or not set(c['candidateWayIds']).intersection(b['candidateWayIds']):
                continue
            if abs(dot(offset, b['tangent'])) > b['length'] / 2 + 0.35:
                continue
            if abs(dot(offset, normal(b['tangent']))) > b['width'] / 2 + 0.35:
                continue
            explicit = any(s['id'] in (linked_ids if s['source'] == 'drempels' else crossing_nodes) for s in b['sources'])
            if 'footprint' in b:
                if shapes[i].distance(point) > 0.6:
                    continue
                overlap = shapes[i].buffer(0.2).intersection(strip).length
                if overlap < strip.length * (0.42 if explicit else 0.56):
                    continue
            elif not explicit:
                continue
            options.append((not explicit, shapes[i].distance(point), math.hypot(*offset), b['id']))
        if options:
            c['bumpId'] = min(options)[-1]


def pack_crossings(map_, strips):
    points = [Point(c['x'], c['z']) for c in strips]
    lines = [LineString(c['ends']) for c in strips]
    tree, remaining = STRtree(points), set(range(len(strips)))
    for i, first in enumerate(strips):
        if i not in remaining:
            continue
        remaining.remove(i)
        group = [first]
        for j in sorted(tree.query(points[i], predicate='dwithin', distance=18)):
            if j not in remaining:
                continue
            second = strips[j]
            if not same_level(first, second) or first['control'] != second['control']:
                continue
            if first['control'] != 'signal' and first['marked'] != second['marked']:
                continue
            if abs(dot(first['tangent'], second['tangent'])) < 0.88:
                continue
            offset = (second['x'] - first['x'], second['z'] - first['z'])
            if abs(dot(offset, first['tangent'])) > max(1.3, min(first['length'], second['length']) * 0.5):
                continue
            duplicates = (set(first['candidateWayIds']).intersection(second['candidateWayIds'])
                          and points[i].distance(points[j]) < 2)
            shared_path = set(first['pathWayIds']).intersection(second['pathWayIds'])
            if not duplicates:
                road_a, road_b = (map_.by_id[c['wayId']] for c in (first, second))
                same_street = road_a['name'] and road_a['name'] == road_b['name']
                if road_a['id'] == road_b['id'] or not (shared_path or same_street and (first['refuge'] or second['refuge'])):
                    continue
                gap = lines[i].distance(lines[j])
                if not 0.5 <= gap <= 8:
                    continue
            remaining.remove(j)
            if duplicates:
                first['sources'].extend(second['sources'])
                first['osmNodeIds'] = sorted(set(first['osmNodeIds'] + second['osmNodeIds']))
                first['pathWayIds'] = sorted(set(first['pathWayIds'] + second['pathWayIds']))
                first['refuge'] |= second['refuge']
                apply_crossing_marking(first)
                continue
            group.append(second)
        axis = normal(first['tangent'])
        group.sort(key=lambda c: dot((c['x'], c['z']), axis))
        parts = [{k: c[k] for k in ('ends', 'wayId', 'layer', 'width', 'length', 'marked', 'markings', 'markingEvidence',
                                        'markingReview', 'markingColour', 'bumpId', 'footprint') if k in c}
                 for c in group]
        ends = sorted((p for c in group for p in c['ends']), key=lambda point: dot(point, axis))
        combined = {**first, 'ends': [ends[0], ends[-1]], 'width': round(math.dist(ends[0], ends[-1]), 2), 'segments': parts,
                    'candidateWayIds': sorted({w for c in group for w in c['candidateWayIds']}),
                    'pathWayIds': sorted({w for c in group for w in c['pathWayIds']}),
                    'osmNodeIds': sorted({n for c in group for n in c['osmNodeIds']}),
                    'sources': [s for c in group for s in c['sources']],
                    'estimated': any(c['estimated'] for c in group),
                    'refuge': len(group) > 1 or any(c['refuge'] for c in group)}
        if len(group) > 1:
            zebra_part = next((part for part in group if part['marked']), None)
            if zebra_part:
                combined.update(marked=True, markings=zebra_part['markings'], markingEvidence=zebra_part['markingEvidence'])
            inner_a = max(group[0]['ends'], key=lambda p: dot(p, axis))
            inner_b = min(group[1]['ends'], key=lambda p: dot(p, axis))
            combined['refugePoint'] = [(a + b) / 2 for a, b in zip(inner_a, inner_b)]
            combined['x'], combined['z'] = [(a + b) / 2 for a, b in zip(ends[0], ends[-1])]
        yield combined


def export_scene(feature, project):
    result = dict(feature)
    if 'x' in result:
        x, z = result['x'], result['z']
        dx, dz = result['tangent']
        origin = project(x, z)
        result['x'], result['z'] = pair(origin)
        result['tangent'] = pair(vector(origin, project(x + dx, z + dz)), 5)
    for field in ('ends', 'footprint'):
        if field in result:
            result[field] = [pair(project(*p)) for p in result[field]]
    if 'refugePoint' in result:
        result['refugePoint'] = pair(project(*result['refugePoint']))
    if 'segments' in result:
        result['segments'] = [export_scene(segment, project) for segment in result['segments']]
    return result


def build(args):
    scene = load_playable_scene() if args.municipality else load_scene()
    frame = Frame(scene['meta']['lonLatAffine'])
    origin_e, origin_n = frame.scene_to_rd(0, 0)

    # Measurements use RD New metres, with a translated south-positive axis so
    # the same road, carriageway and left/right conventions apply during matching.
    project_rd = lambda e, n: (e - origin_e, origin_n - n)
    project_geographic = lambda lon, lat: project_rd(*frame.to_rd(lon, lat, 'OGC:CRS84'))
    scene_to_grid = lambda x, z: project_rd(*frame.scene_to_rd(x, z))
    to_scene = lambda x, z: frame.rd_to_scene(x + origin_e, origin_n - z)
    x0, z0, x1, z1 = scene['meta']['bounds']
    if args.municipality:
        bounds = transform(load_playable_boundary(), scene_to_grid, interleaved=False)
    else:
        bounds = Polygon([scene_to_grid(x, z) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))])
    snapshot = elements(args.osm)
    supplement = elements(args.osm_features)
    rows = {(e['type'], e['id']): e for e in (*snapshot['elements'], *supplement['elements'])}
    map_ = Map(scene, rows, project_geographic, scene_to_grid, bounds)
    omitted = Counter()
    bumps, polygons = ndw_bumps(map_, source_rows(args.drempels, project_rd, map_.bounds, True), omitted)
    osm_bumps(map_, rows, bumps, polygons, omitted)
    crossings = ndw_crossings(map_, source_rows(args.vops, project_rd, map_.bounds, False), omitted)
    reviews = json.loads(args.marking_review.read_bytes()) if args.marking_review else {}
    if not isinstance(reviews, dict):
        raise ValueError('Expected marking reviews keyed by crossing ID')
    merge_sources(map_, crossings, osm_crossing_nodes(map_, omitted), reviews, published_scope=args.published_crossings)
    marking_reviews(crossings, reviews)
    link_bumps(crossings, bumps)
    crossings = list(pack_crossings(map_, crossings))
    if not bumps or not crossings or not any(c['control'] == 'signal' for c in crossings):
        raise ValueError('Missing one or more street feature classes in the Ede output')
    if len({f['id'] for f in bumps + crossings}) != len(bumps) + len(crossings):
        raise ValueError('Duplicate street feature IDs')
    for c in crossings:
        if c.get('bumpId') and not any(c['bumpId'] == b['id'] and same_level(c, b) for b in bumps):
            raise ValueError(f"Crossing {c['id']} links to a hump on another level")
    osm_timestamp = args.osm_date or supplement.get('osm3s', {}).get('timestamp_osm_base')
    return {'version': 1, 'sources': {**SOURCES, 'osm': {**SOURCES['osm'], 'timestamp': osm_timestamp}},
            'bounds': scene['meta']['bounds'], 'omitted': dict(sorted(omitted.items())),
            'bumps': [export_scene(b, to_scene) for b in sorted(bumps, key=lambda b: b['id'])],
            'crossings': [export_scene(c, to_scene) for c in sorted(crossings, key=lambda c: c['id'])]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('osm', type=Path)
    parser.add_argument('osm_features', type=Path)
    parser.add_argument('drempels', type=Path)
    parser.add_argument('vops', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--osm-date', type=lambda value: datetime.fromisoformat(value).isoformat().replace('+00:00', 'Z'),
                        help='Historical date explicitly requested in both Overpass queries')
    parser.add_argument('--municipality', action='store_true', help='Use the full playable Ede polygon')
    parser.add_argument('--published-crossings', action='store_true',
                        help='Limit OSM-only crossings to zebra, signal-controlled or individually reviewed markings')
    parser.add_argument('--marking-review', type=Path, help='PDOK imagery decisions keyed by crossing ID')
    args = parser.parse_args()
    result = build(args)
    args.output.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n')
    print(f"{len(result['bumps'])} humps and tables, {len(result['crossings'])} physical crossings")
    print(f"Source records without sufficient support: {result['omitted']}")


if __name__ == '__main__':
    main()
