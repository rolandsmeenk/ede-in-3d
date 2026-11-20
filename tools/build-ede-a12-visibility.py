#!/usr/bin/env python3
"""Inventory building walls visible from a playable motorway and its links."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date
import json
import math
import multiprocessing
import os
from pathlib import Path
import runpy
import subprocess
from urllib.parse import urlparse

import numpy as np
from flatgeobuf import Reader
from shapely import STRtree, get_coordinates, get_parts, intersection, intersects_xy, linestrings
from shapely import points as shapely_points, transform, union_all
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.geometry.polygon import orient

from ede_gis import Frame
from ede_map import load_scene
from ede_motorway_infrastructure import line_parts, points, project, read_json, segments, write_json

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = runpy.run_path(str(ROOT / 'tools/catalogue-ede-facade-walls.py'))
Terrain = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))['Terrain']

EYE_HEIGHT = 1.2
ROAD_STEP = 12
NEAR_DISTANCE = 500
FAR_CELL = 42
MAX_DISTANCE = 1500
MIN_WIDTH_ANGLE = math.tan(math.radians(0.15))
MIN_HEIGHT_ANGLE = math.tan(math.radians(0.12))
FORWARD_COSINE = math.cos(math.radians(82))
OUTWARD_COSINE = math.cos(math.radians(80))
EXTRA_LINKS = {
    'A12': {'w6960060', 'w367690522', 'w6921151'},
    # Maanderbroek connections to A12 and untagged Ede-Noord ramp links.
    'A30': {'w6960084', 'w636835435', 'w6960110', 'w663875342', 'w6960093',
            'w44431811', 'w682710045', 'w843579812'},
}
DIRECTIONS = {'A12': ('eastbound', 'westbound'), 'A30': ('northbound', 'southbound')}


def motorway_roads(scene, motorway):
    tags = read_json(ROOT / 'tools/data/ede-motorway-lanes.snapshot.json')['osmTags']
    roads = {r['id']: r for r in scene['roads']
             if r['kind'] in ('motorway', 'motorway_link')
             and (tags.get(r['id'][1:], {}).get('ref') == motorway or r['id'] in EXTRA_LINKS[motorway])}
    directions = {}
    if motorway == 'A30':
        by_carriageway = dict(zip(('Re', 'Li'), DIRECTIONS[motorway]))
        directions = {way: by_carriageway[tags[way[1:]]['carriageway_ref']]
                      for way, road in roads.items() if road['kind'] == 'motorway'}
    return roads, directions


def road_corridor(roads, area, max_distance):
    road_paths = [LineString(points(road['pts'])) for road in roads.values()]
    return area.intersection(union_all(road_paths).intersection(area).buffer(max_distance + 10))


def archives(cache, frame, corridor, fetch, motorway):
    index = cache / 'tile_index.fgb'
    CATALOGUE['cached'](index, CATALOGUE['BAG_INDEX'], fetch)
    rd = transform(corridor, frame.scene_to_rd, interleaved=False)
    with index.open('rb') as source:
        found = [dict(feature.properties) for feature in Reader(source, bbox=rd.bounds)
                 if rd.intersects(shape(dict(feature.geometry)))]
    if not found:
        raise ValueError(f'3DBAG releases no tiles in the {motorway} corridor')
    for row in sorted(found, key=lambda f: f['cj_download']):
        url = urlparse(row['cj_download'])
        if (url.scheme != 'https' or url.hostname != CATALOGUE['BAG_HOST']
                or not url.path.startswith('/v20250903/tiles/')):
            raise ValueError('Unexpected archived 3DBAG tile URL')
        path = cache / Path(url.path).name
        CATALOGUE['cached'](path, url.geturl(), fetch, row['cj_sha256'])
        document = read_json(path)
        metadata = document['metadata']
        if metadata['version'] != CATALOGUE['BAG_RELEASE'] or not metadata['referenceSystem'].endswith('/7415'):
            raise ValueError(f'Unexpected 3DBAG release or CRS: {path}')
        yield path.name, document


def grade_spans(grade, roads):
    by_way = defaultdict(list)
    for site in grade['sites']:
        for profile in site['profiles']:
            own = roads.keys() & set(profile.get('wayIds', ()))
            if not own or 'motor' not in profile['modes']:
                continue
            covered = profile.get('covered', [])
            if covered and isinstance(covered[0], (int, float)):
                covered = [covered]
            along = 0
            for span in segments(profile['points'], None):
                span.data = (along, covered, profile, site['kind'])
                along += span.length
                for way in own:
                    by_way[way].append(span)
    return by_way


def fitted_height(spans, ground, x, z):
    best = None
    for span in spans:
        position, distance, across = project(span, x, z)
        along, covered, profile, kind = span.data
        if distance > profile['width'] / 2 + 0.3 or (best and distance >= best[0]):
            continue
        y = span.a[2] + (span.b[2] - span.a[2]) * position / span.length
        if kind == 'surface':
            y = ground + y * min(1, max(0, (profile['width'] / 2 - abs(across)) / profile['shoulder']))
        roof = any(first <= along + position <= last for first, last in covered)
        best = distance, y, roof, profile['id'], kind
    return best


def boundary_edges(roads, graph):
    represented = {edge['way'] for edge in graph if edge['modes'] & 1}
    for way in sorted(roads.keys() - represented):
        road = roads[way]
        coordinates = points(road['pts'])
        if road['reverse']:
            coordinates.reverse()
        modes = road.get('laneModes', [None])[0] or [road['modes'][0]] * (road['lanes'] or 1)
        center = (len(modes) - 1) / 2
        offsets = [(i - center) * 3.5 for i in range(len(modes))]
        for part in segments(coordinates, None):
            yield dict(key=way, way=way, kind=road['kind'], modes=road['modes'][0],
                       inset=[*part.a, part.length], axis=[part.ux, part.uz], span=part.length,
                       a=part.a, lanes=offsets, laneModes=modes)


def road_samples(roads, area, terrain, grade, directions):
    command = ['node', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
               str(ROOT / 'tools/export-ede-traffic-graph.mjs'), '--lane-fitting']
    graph = json.loads(subprocess.check_output(command, cwd=ROOT))
    fits = read_json(ROOT / 'assets/ede-fitted-lanes.json.gz')['edges']
    profiles = grade_spans(grade, roads)
    samples, seen, skipped = [], set(), Counter()
    xmin, zmin, xmax, zmax = area.bounds
    for edge in [*graph['edges'], *boundary_edges(roads, graph['edges'])]:
        way = edge['way']
        if way not in roads or not edge['modes'] & 1:
            continue
        sx, sz, length = edge['inset']
        ux, uz = edge['axis']
        span = edge['span']
        start = (edge['a'][0] - sx) * ux + (edge['a'][1] - sz) * uz
        direction = 'ramp'
        if edge['kind'] == 'motorway':
            direction = directions.get(way) or ('eastbound' if ux > 0 else 'westbound')
        lanes = fits.get(edge['key'], {}).get('lanes') or [None] * len(edge['lanes'])
        for i, (offset, lane) in enumerate(zip(edge['lanes'], lanes)):
            if not edge['laneModes'][i] & 1:
                continue
            steps = max(1, math.ceil(span / ROAD_STEP))
            stations = np.linspace(start, start + span, steps + 1)
            if lane:
                distances, xs, zs, _, _ = np.asarray(lane).reshape(-1, 5).T
                # Fill the short junction-inset gaps with the lane heading at each endpoint.
                xs = np.interp(stations, distances, xs) + ux * (stations - np.clip(stations, 0, length))
                zs = np.interp(stations, distances, zs) + uz * (stations - np.clip(stations, 0, length))
            else:
                xs, zs = sx + ux * stations - uz * offset, sz + uz * stations + ux * offset
            for x, z in zip(xs, zs):
                if not (xmin <= x <= xmax and zmin <= z <= zmax):
                    continue
                identity = (way, i, round(x, 1), round(z, 1))
                if identity in seen:
                    continue
                seen.add(identity)
                ground = terrain.at((x, z)) - terrain.nap
                fit = fitted_height(profiles[way], ground, x, z)
                if fit and fit[2]:
                    skipped[direction] += 1
                    continue
                y = fit[1] if fit else ground
                row = dict(id=len(samples), wayId=way, direction=direction, lane=i,
                           x=round(x, 2), y=round(y + EYE_HEIGHT, 3), z=round(z, 2),
                           heading=[round(ux, 6), round(uz, 6)], fittedLane=bool(lane))
                if fit:
                    row.update(profile=fit[3], gradeKind=fit[4])
                samples.append(row)
    return samples, skipped, profiles


def osm_buildings(scene, corridor):
    records = []
    for row in scene['buildings']:
        polygon = Polygon(points(row['ring']), [points(hole) for hole in row.get('holes', ())]).buffer(0)
        if not polygon.is_empty and corridor.intersects(polygon):
            records.append((polygon, row))
    return records


def part_geometry(vertices, a, b, nap_base, seat):
    dx, dz = np.subtract(b, a) / math.dist(a, b)
    return Polygon([((x - a[0]) * dx + (z - a[1]) * dz, y - nap_base + seat)
                    for x, y, z in vertices]).buffer(0)


def feature_walls(bag, osm, terrain):
    osm_index = STRtree([p for p, _ in osm])
    bag_index = STRtree([record[0] for record in bag.values()])
    blockers, walls = [], []
    for bag_id, (footprint, faces, nap_base, seat, attrs) in bag.items():
        match = max(((footprint.intersection(osm[i][0]).area / max(footprint.area, osm[i][0].area), i)
                     for i in osm_index.query(footprint)), default=(0, -1))
        ref = osm[match[1]][1] if match[0] >= 0.42 else {}
        roof = max(y for _, vertices in faces for _, y, _ in vertices)
        top = max(nap_base, min(roof, attrs.get('b3_h_dak_min') or roof))
        blockers.append((footprint, seat, seat + top - nap_base, None))
        wall_rows = {}
        for semantics, vertices in faces:
            if semantics['type'] != 'WallSurface' or len(vertices) < 3:
                continue
            segment = CATALOGUE['wall_segment'](vertices, footprint, nap_base, seat)
            if not segment:
                continue
            a, b, low, height = segment
            base = low - seat
            wall_id = ','.join(f'{v:.2f}' for v in (*a, *b, base))
            plane = part_geometry(vertices, a, b, nap_base, seat)
            if plane.is_empty:
                continue
            row = dict(bagId=bag_id, osmId=ref.get('id'), wallId=wall_id,
                       a=a, b=b, minY=low, baseOffset=base, height=height, width=math.dist(a, b),
                       buildingType=ref.get('kind', 'other'), wallType='side',
                       storeys=ref.get('levels') or attrs.get('b3_bouwlagen'), name=ref.get('name', ''),
                       source='3DBAG LoD 2.2', year=attrs.get('oorspronkelijkbouwjaar'),
                       footprintArea=round(footprint.area, 1), roofType=attrs.get('b3_dak_type'),
                       greenhouse=bool(attrs.get('b3_kas_warenhuis')), status=attrs.get('status'))
            if wall_id not in wall_rows or height > wall_rows[wall_id][0]['height']:
                wall_rows[wall_id] = row, plane
        walls.extend(wall_rows.values())

    for polygon, row in osm:
        overlaps = [polygon.intersection(bag_index.geometries[i])
                    for i in bag_index.query(polygon, predicate='intersects')]
        if overlaps and union_all(overlaps).area >= polygon.area * 0.65:
            continue
        # Fallback walls sit on the same coarse centroid datum as ordinary OSM buildings.
        xmin, zmin, xmax, zmax = polygon.bounds
        seat = terrain.at(((xmin + xmax) / 2, (zmin + zmax) / 2)) - terrain.nap
        base = row.get('minHeight', 0)
        height = row.get('h', 9)
        kind = row['kind']
        shed = not row.get('part') and (
            kind in ('shed', 'garage', 'garages', 'barn') and 3 <= polygon.area <= 60
            or kind == 'yes' and not row['name'] and row['heightSource'] == 'default' and 5 <= polygon.area <= 24)
        if shed and (row['heightSource'] == 'default' or
                     row['heightSource'] == 'building:levels' and row['levels'] == 1):
            height = 2.65
        if height <= base:
            continue
        blockers.append((polygon, seat + base, seat + height, None))
        outer = points(row['ring'])
        edge_indices = {frozenset((a, b)): i for i, (a, b) in enumerate(zip(outer, outer[1:] + outer[:1]))}
        for part in (polygon.geoms if polygon.geom_type == 'MultiPolygon' else (polygon,)):
            shape_ = orient(part, sign=-1)
            for ring in (shape_.exterior, *shape_.interiors):
                for a, b in zip(ring.coords, list(ring.coords)[1:]):
                    width = math.dist(a, b)
                    if width < 1.1:
                        continue
                    wall_id = ','.join(f'{v:.2f}' for v in (*a, *b, base))
                    edge_index = edge_indices.get(frozenset((a, b)))
                    walls.append((dict(bagId=None, osmId=row['id'], osmEdge=edge_index, wallId=wall_id,
                                       a=a, b=b, minY=seat + base, baseOffset=base,
                                       height=height - base, width=width, buildingType=row['kind'],
                                       wallType='side', storeys=row['levels'], name=row['name'],
                                       source='OpenStreetMap fallback', footprintArea=round(polygon.area, 1),
                                       roofType=row.get('roofShape')),
                                  box(0, seat + base, width, seat + height)))
    return walls, blockers


def barriers(corridor, motorway):
    heights = {'noiseWall': 3, 'retainingWall': 1.45, 'civilWall': 1.3}
    for row in read_json(ROOT / 'assets/ede-bgt.json')['structures']:
        if row['kind'] not in heights or row['layer'] < 0:
            continue
        for outer, *holes in row['polygons']:
            footprint = Polygon(points(outer), [points(hole) for hole in holes]).buffer(0)
            if corridor.intersects(footprint):
                yield footprint, None, heights[row['kind']], None
    for row in read_json(ROOT / 'assets/ede-1gis-detail.json.gz')['features']:
        if row['type'] != 'noiseBarrier':
            continue
        footprint = LineString(row['points']).buffer(max(0.08, row.get('width', 0) / 2))
        if row.get('route') == motorway or (motorway == 'A30' and corridor.intersects(footprint)):
            yield footprint, None, 2.8, row['wayId']


class Visibility:
    def __init__(self, samples, blockers, terrain, profiles, max_distance):
        self.samples = samples
        self.max_distance = max_distance
        self.sample_positions = np.array([(s['x'], s['z']) for s in samples])
        self.headings = np.array([s['heading'] for s in samples])
        self.eye = np.asarray([s['y'] for s in samples])
        self.underpass = np.asarray([s.get('gradeKind') == 'underpass' for s in samples])
        self.approaches = {}
        for way in {s['wayId'] for s in samples if s.get('gradeKind') == 'underpass'}:
            self.approaches[way] = union_all([LineString((span.a[:2], span.b[:2])).buffer(
                span.data[2]['width'] / 2 + 0.32) for span in profiles[way]])
        self.far = np.zeros(len(samples), dtype=bool)
        cells = {}
        for i, sample in enumerate(samples):
            x, z = self.sample_positions[i] / FAR_CELL
            col, row = math.floor(x), math.floor(z)
            key = sample['direction'], sample['lane'], sample.get('gradeKind'), col, row
            distance = (x - col - 0.5)**2 + (z - row - 0.5)**2
            if key not in cells or distance < cells[key][0]:
                cells[key] = distance, i
        self.far[[index for _, index in cells.values()]] = True
        self.roads = STRtree(shapely_points(self.sample_positions))
        self.blockers = blockers
        self.obstacles = STRtree([r[0] for r in blockers])
        self.low = np.asarray([np.nan if row[1] is None else row[1] for row in blockers])
        self.high = np.asarray([row[2] for row in blockers])
        self.terrain = terrain
        self.profiles = profiles
        self.heights = np.asarray(terrain.heights).reshape(terrain.rows, terrain.columns) / 100 - terrain.nap

    def ground(self, x, z):
        t = self.terrain
        cx, cz = (x - t.x) / t.step, (z - t.z) / t.step
        left, top = np.floor(cx).astype(int), np.floor(cz).astype(int)
        u, v = cx - left, cz - top
        a, b = self.heights[top, left], self.heights[top, left + 1]
        c, d = self.heights[top + 1, left], self.heights[top + 1, left + 1]
        return np.where(u + v <= 1, a + (b - a) * u + (c - a) * v,
                        d + (c - d) * (1 - u) + (b - d) * (1 - v))

    def ray(self, sample, x, z, heights, max_range):
        origin = np.array([sample['x'], sample['z']])
        end = np.array([x, z])
        delta = end - origin
        length = math.hypot(*delta)
        if length > max_range or length < 1:
            return None
        oy = sample['y']
        dy = np.asarray(heights) - oy
        steps = max(2, math.ceil(length / (self.terrain.step / 2)))
        times = np.arange(1, steps) / steps
        stations = origin + delta * times[:, None]
        ground = self.ground(*stations.T)
        sight = oy + dy[:, None] * times
        if sample.get('gradeKind') == 'underpass':
            # Coarse AHN retains the upper grade where the game cuts tunnel approaches.
            way = sample['wayId']
            blocked = np.flatnonzero(ground > sight.min(axis=0) + 0.10)
            cut = intersects_xy(self.approaches[way], *stations[blocked].T)
            if np.any(ground[blocked[~cut]] > sight.max(axis=0)[blocked[~cut]] + 0.10):
                return None
            for i in blocked[cut]:
                local = fitted_height(self.profiles[way], ground[i], *stations[i])
                if local and not local[2]:
                    ground[i] = min(ground[i], local[1])
        clear = np.all(sight >= ground - 0.10, axis=1)
        if not clear.any():
            return None
        ray = LineString((origin + delta * (0.10 / length), end - delta * (0.16 / length)))
        for i in self.obstacles.query(ray, predicate='intersects'):
            polygon, low, high, way = self.blockers[i]
            for interval in line_parts(ray.intersection(polygon)):
                cross = get_coordinates(interval)
                tt = (cross - origin) @ delta / length**2
                ray_y = oy + dy[:, None] * tt
                if low is None:
                    wall_base = self.ground(*cross.T)
                    if way:
                        for j, (px, pz) in enumerate(cross):
                            fit = fitted_height(self.profiles[way], wall_base[j], px, pz)
                            if fit:
                                wall_base[j] = fit[1]
                    clear &= ~np.any((ray_y >= wall_base - 0.24) & (ray_y < wall_base + high - 0.05), axis=1)
                else:
                    clear &= (ray_y.min(axis=1) >= high - 0.06) | (ray_y.max(axis=1) <= low - 0.08)
                if not clear.any():
                    return None
        return heights[np.argmax(clear)]

    def batch_rays(self, indices, x, z, heights, radius):
        origins = self.sample_positions[indices]
        delta = np.array([x, z]) - origins
        distance = np.linalg.norm(delta, axis=1)
        fits = ((distance >= 1) & (distance <= radius)
                & (np.einsum('ij,ij->i', delta, self.headings[indices]) > distance * FORWARD_COSINE))
        result = np.full(len(indices), np.nan)
        for i in np.flatnonzero(fits & self.underpass[indices]):
            y = self.ray(self.samples[indices[i]], x, z, heights, radius)
            if y is not None:
                result[i] = y
        active = np.flatnonzero(fits & ~self.underpass[indices])
        if not len(active):
            return result
        origin, dxz, distance = origins[active], delta[active], distance[active]
        eye = self.eye[indices[active]]
        dy = np.asarray(heights)[None, :] - eye[:, None]
        steps = np.maximum(2, np.ceil(distance / (self.terrain.step / 2)).astype(int))
        times = np.minimum(1, np.arange(1, steps.max()) / steps[:, None])
        stations = origin[:, None, :] + dxz[:, None, :] * times[..., None]
        ground = self.ground(stations[..., 0], stations[..., 1])
        y = eye[:, None, None] + dy[:, :, None] * times[:, None, :]
        clear = np.all((y >= ground[:, None, :] - 0.10) | (times[:, None, :] == 1), axis=2)
        remaining = np.flatnonzero(clear.any(axis=1))
        if not len(remaining):
            return result
        origin, dxz, distance, eye, dy, clear = (a[remaining] for a in (origin, dxz, distance, eye, dy, clear))
        active = active[remaining]
        headings = dxz / distance[:, None]
        starts, ends = origin + 0.10 * headings, np.array([x, z]) - 0.16 * headings
        rays = linestrings(np.stack((starts, ends), axis=1))
        ray_idx, blocker_idx = self.obstacles.query(rays, predicate='intersects')
        barriers = np.isnan(self.low[blocker_idx])
        special = np.unique(ray_idx[barriers])
        for i in special:
            y = self.ray(self.samples[indices[active[i]]], x, z, heights, radius)
            if y is not None:
                result[active[i]] = y
            clear[i] = False
        ordinary = ~barriers & clear.any(axis=1)[ray_idx]
        ray_idx, blocker_idx = ray_idx[ordinary], blocker_idx[ordinary]
        parts, parent = get_parts(intersection(rays[ray_idx], self.obstacles.geometries[blocker_idx]),
                                  return_index=True)
        coords, part_index = get_coordinates(parts, return_index=True)
        if len(part_index):
            part_ray = ray_idx[parent]
            index = part_ray[part_index]
            t = np.einsum('ij,ij->i', coords - origin[index], dxz[index]) / distance[index]**2
            min_t = np.full(len(parts), np.inf)
            max_t = np.full(len(parts), -np.inf)
            np.minimum.at(min_t, part_index, t)
            np.maximum.at(max_t, part_index, t)
            proper = max_t > min_t
            part_ray = part_ray[proper]
            first = eye[part_ray, None] + dy[part_ray] * min_t[proper, None]
            last = eye[part_ray, None] + dy[part_ray] * max_t[proper, None]
            obstacle = blocker_idx[parent[proper]]
            above = np.minimum(first, last) >= self.high[obstacle, None] - 0.06
            below = np.maximum(first, last) <= self.low[obstacle, None] - 0.08
            np.logical_and.at(clear, part_ray, above | below)
        found = np.flatnonzero(clear.any(axis=1))
        result[active[found]] = np.asarray(heights)[np.argmax(clear[found], axis=1)]
        return result

    def wall(self, row, plane):
        a, b = np.array(row['a']), np.array(row['b'])
        width, height = row['width'], row['height']
        axis = (b - a) / width
        normal = np.array([-axis[1], axis[0]])
        radius = min(self.max_distance, width / MIN_WIDTH_ANGLE, height / MIN_HEIGHT_ANGLE)
        center = (a + b) / 2
        what = self.roads.query(Point(center), predicate='dwithin', distance=radius + width / 2)
        if not len(what):
            return {}
        offsets = self.sample_positions[what] - center
        distance = np.linalg.norm(offsets, axis=1)
        frontage = offsets @ normal
        forward = -np.einsum('ij,ij->i', offsets, self.headings[what])
        visible = ((distance <= radius + width / 2) & (frontage > distance * OUTWARD_COSINE)
                   & (forward + width / 2 > distance * FORWARD_COSINE)
                   & (width * frontage > distance**2 * MIN_WIDTH_ANGLE)
                   & ((distance <= NEAR_DISTANCE + width / 2) | self.far[what]))
        what = what[visible][np.lexsort((what[visible], distance[visible]))]
        if not len(what):
            return {}
        # Test the actual wall section heights, including gables and tapering outlines.
        columns = np.linspace(0.12, 0.88, min(11, max(3, math.ceil(width / 15)))) * width
        targets = []
        for s in sorted(columns, key=lambda s: abs(s - width / 2)):
            vertical = LineString(((s, row['minY'] - 1), (s, row['minY'] + height + 1)))
            for line in line_parts(plane.intersection(vertical)):
                bottom, top = line.bounds[1::2]
                x, z = a + axis * s
                heights = [bottom + (top - bottom) * portion for portion in (0.40, 0.80, 0.19)]
                targets.append((x, z, heights))
        seen = {}
        direction = np.asarray([self.samples[i]['direction'] for i in what])
        view_types = set(direction)
        for start in (0, *range(4, len(what), 32)):
            stop = start + (4 if start == 0 else 32)
            group = what[start:stop]
            views = direction[start:stop]
            pending = np.flatnonzero(np.isin(views, list(view_types - seen.keys())))
            chosen = {}
            for x, z, heights in targets:
                if not len(pending):
                    break
                if len(pending) <= 4:
                    result = []
                    for j in group[pending]:
                        dx, dz = x - self.samples[j]['x'], z - self.samples[j]['z']
                        ux, uz = self.headings[j]
                        y = (self.ray(self.samples[j], x, z, heights, radius) if
                             dx * ux + dz * uz > math.hypot(dx, dz) * FORWARD_COSINE else None)
                        result.append(np.nan if y is None else y)
                    result = np.asarray(result)
                else:
                    result = self.batch_rays(group[pending], x, z, heights, radius)
                found = np.isfinite(result)
                for j, y in zip(pending[found], result[found]):
                    chosen[j] = x, y, z
                pending = pending[~found]
            for j, (x, y, z) in sorted(chosen.items()):
                view = views[j]
                i = group[j]
                sample = self.samples[i]
                if view not in seen:
                    seen[view] = dict(sample=int(i),
                                      distance=round(math.hypot(x - sample['x'], z - sample['z']), 1),
                                      target=[round(float(t), 2) for t in (x, y, z)])
            if view_types <= seen.keys():
                break
        return seen

    def check_batch(self, batch):
        visible = []
        for row, plane in batch:
            views = self.wall(row, plane)
            if views:
                visible.append(round_wall(dict(row, views=views,
                                               closest=min(view['distance'] for view in views.values()))))
        return visible


def round_wall(row):
    for key in ('a', 'b'):
        row[key] = [round(float(value), 2) for value in row[key]]
    for key in ('minY', 'baseOffset', 'height', 'width'):
        row[key] = round(float(row[key]), 2)
    return row


def check_walls(solver, walls, workers):
    def collect(batches):
        visible = []
        for i, batch in enumerate(batches, start=1):
            visible.extend(batch)
            if i % 25 == 0:
                print('Wall checks', min(len(walls), i * 400), 'visible', len(visible), flush=True)
        return visible

    batches = [walls[i:i + 400] for i in range(0, len(walls), 400)]
    if workers == 1:
        return collect(map(solver.check_batch, batches))
    # Fork the read-only obstacle and road indexes once, then distribute short wall batches.
    with ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context('fork'),
                             initializer=init_worker, initargs=(solver,)) as pool:
        pending = [pool.submit(check_batch, batch) for batch in batches]
        return collect(future.result() for future in as_completed(pending))


def init_worker(solver):
    global worker_solver
    worker_solver = solver


def check_batch(batch):
    return worker_solver.check_batch(batch)


def build(cache, date_stamp, fetch, workers, max_distance=MAX_DISTANCE, motorway='A12'):
    scene = load_scene(include_shorelines=False)
    bounds = scene['meta']['bounds']
    area = box(*bounds)
    frame = Frame(scene['meta']['lonLatAffine'])
    terrain = Terrain()
    grade = read_json(ROOT / 'assets/ede-grade.json')
    assert terrain.nap == grade['datumNAP']
    roads, directions = motorway_roads(scene, motorway)
    corridor = road_corridor(roads, area, max_distance)
    sample_rows, skipped, profiles = road_samples(roads, area, terrain, grade, directions)
    counts = Counter(sample['direction'] for sample in sample_rows)
    assert all(counts[key] for key in (*DIRECTIONS[motorway], 'ramp')), counts
    missing = roads.keys() - {s['wayId'] for s in sample_rows}
    assert all(LineString(points(roads[way]['pts'])).intersection(area).length < ROAD_STEP
               for way in missing), missing
    print('Road viewpoints', counts, 'covered stations skipped', skipped, flush=True)
    documents = archives(cache, frame, corridor, fetch, motorway)
    bag = CATALOGUE['build_buildings'](documents, frame, terrain, corridor)
    osm = osm_buildings(scene, corridor)
    walls, blockers = feature_walls(bag, osm, terrain)
    screen = list(barriers(corridor, motorway))
    print('Candidate walls', len(walls), 'building occluders', len(blockers), 'barrier occluders', len(screen),
          flush=True)
    solver = Visibility(sample_rows, blockers + screen, terrain, profiles, max_distance)
    visible = check_walls(solver, walls, workers)
    visible.sort(key=lambda w: (w['closest'], w['bagId'] or w['osmId'], w['wallId']))
    stats = {
        'roadWays': len({s['wayId'] for s in sample_rows}),
        'samples': counts, 'coveredStationsSkipped': skipped, 'candidateWalls': len(walls),
        'buildingOccluders': len(blockers), 'barrierOccluders': len(screen),
        'visibleWalls': len(visible),
        'visibleBuildings': len({w['bagId'] or w['osmId'] for w in visible}),
        'visibleBAGWalls': sum(bool(w['bagId']) for w in visible),
        'visibleByRoute': {key: sum(key in w['views'] for w in visible) for key in counts},
    }
    print('Visibility results', stats, flush=True)
    assert len({(w['bagId'] or w['osmId'], w['wallId']) for w in visible}) == len(visible)
    source = dict(map='OpenStreetMap contributors', walls=CATALOGUE['BAG_RELEASE'],
                  grades='assets/ede-grade.json', terrain='assets/ede-ahn.bin',
                  laneFits='assets/ede-fitted-lanes.json.gz',
                  barriers=['assets/ede-bgt.json', 'assets/ede-1gis-detail.json.gz'])
    # shortcut: Seasonal foliage and temporary obstructions need dated roadside evidence.
    method = dict(eyeHeight=EYE_HEIGHT, sampleStep=ROAD_STEP, maximumDistance=max_distance, denseViewDistance=NEAR_DISTANCE,
                  distantSampleCell=FAR_CELL,
                  forwardHalfAngleDeg=82, minimumFacadeIncidenceDeg=10,
                  minApparentWidthDeg=0.15, minApparentHeightDeg=0.12,
                  occlusion='AHN ground, building footprints to low roof, and mapped solid barriers',
                  exclusions='Seasonal vegetation, traffic, and temporary obstructions')
    return dict(version=1, date=date_stamp, bounds=bounds, source=source, method=method, stats=stats,
                roadSamples=sample_rows, walls=visible)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Pinned 3DBAG CityJSON cache')
    parser.add_argument('output', type=Path, help='JSON or compressed JSON inventory')
    parser.add_argument('--date', type=date.fromisoformat, default=date.today())
    parser.add_argument('--fetch', action='store_true', help='Download absent pinned 3DBAG archive files')
    parser.add_argument('--workers', type=int, default=min(8, os.cpu_count() or 1))
    parser.add_argument('--motorway', choices=DIRECTIONS, default='A12')
    parser.add_argument('--max-distance', type=int, default=MAX_DISTANCE,
                        help='Maximum distance in metres from a motorway eye position')
    args = parser.parse_args()
    if args.max_distance < 1:
        parser.error('--max-distance must be positive')
    if args.workers < 1:
        parser.error('--workers must be positive')
    if args.fetch:
        args.cache.mkdir(parents=True, exist_ok=True)
    write_json(args.output, build(args.cache, args.date.isoformat(), args.fetch, args.workers,
                                  args.max_distance, args.motorway))


if __name__ == '__main__':
    main()
