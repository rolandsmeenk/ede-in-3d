#!/usr/bin/env python3
"""Extract directed posted speeds from the official WKD Snelheden.gpkg."""

import argparse
import json
import math
import sqlite3
from collections import Counter
from datetime import date
from pathlib import Path

from ede_gis import Frame, geopackage_crs, geopackage_linestring, to_rd
from ede_traffic_geometry import RoadGraph, Segment, SegmentIndex, load_graph, normalize_name

ALLOWED_SPEEDS = {5, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 130}


def read_segments(path, as_of, bounds):
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as connection:
        srs_id, crs = geopackage_crs(connection, 'Snelheden')
        if crs.to_epsg() != 28992:
            raise ValueError('WKD Snelheden spatial index must be in RD New')
        # The Ede map plus buffer in metres RD New. Geometry is already clipped to VAN/NAAR.
        xmin, ymin, xmax, ymax = bounds
        rows = connection.execute('''
            SELECT geom, stt_naam, wegnummer, maxshd, begintijd, eindtijd, maxshd_alt, kenm_richt, dat_maxshd
            FROM rtree_Snelheden_geom AS r JOIN Snelheden AS s ON s.id = r.id
            WHERE r.maxx >= ? AND r.minx <= ? AND r.maxy >= ? AND r.miny <= ?
                AND betrwbheid = '100%' AND maxshd NOT IN ('NVT', 'NOA')
        ''', (xmin - 50, xmax + 50, ymin - 50, ymax + 50))
        for blob, name, number, speed, start, end, alternate, direction, valid_from in rows:
            if valid_from and valid_from[:10] > as_of:
                continue
            if not speed.isdigit() or int(speed) not in ALLOWED_SPEEDS or direction not in ('H', 'T', 'B'):
                continue
            profile = (int(speed),)
            if any(value is not None for value in (start, end, alternate)):
                if (start is None or end is None or not 0 <= start <= 23 or not 0 <= end <= 24
                        or start == end or alternate not in ALLOWED_SPEEDS):
                    continue
                if alternate != int(speed):
                    profile += (alternate, start * 60, end * 60)
            coords = geopackage_linestring(blob, srs_id)
            points = [to_rd(x, y, crs, axis_order='xy') for x, y in zip(coords[::2], coords[1::2])]
            data = normalize_name(name), number, direction, profile
            for a, b in zip(points, points[1:]):
                yield Segment(a, b, data)


def rd_graph(graph):
    # Keep graph identities and direction rules while comparing measured distances in RD.
    project = Frame(graph.affine).scene_to_rd
    xmin, zmin, xmax, zmax = graph.bounds
    xs, ys = zip(*(project(x, z) for x in (xmin, xmax) for z in (zmin, zmax)))
    return RoadGraph({
        'bounds': (min(xs), min(ys), max(xs), max(ys)), 'geographicBounds': graph.geographic_bounds,
        'lonLatAffine': graph.affine,
        'edges': [{**edge.data, 'a': project(*edge.a), 'b': project(*edge.b)} for edge in graph.edges],
    })


def posted_speeds(graph, sources):
    result = {}
    for edge in graph.edges:
        name = normalize_name(edge.data.get('name'))
        highway = (edge.data.get('kind') or '').startswith('motorway')
        votes = Counter()
        count = 0
        for x, z in edge.samples():
            count += 1
            near = []
            for source in sources.near(x, z):
                source_name, number, direction, profile = source.data
                same_name = bool(name and name == source_name)
                if name and source_name and not same_name and not highway:
                    continue
                if highway and (not number or number.startswith('N')):
                    continue
                dot = edge.ux * source.ux + edge.uz * source.uz
                if abs(dot) < 0.86 or (direction == 'H' and dot < 0) or (direction == 'T' and dot > 0):
                    continue
                along, distance = source.project(x, z)
                tolerance = 3.5 if same_name or highway else 2.5
                if not 0 <= along <= source.length or distance > tolerance:
                    continue
                if graph.level_conflict(edge, x, z, distance, 8, source):
                    continue
                near.append((distance + (1 - abs(dot)) * 4, profile))
            if near:
                best = min(distance for distance, _ in near)
                profiles = {profile for distance, profile in near if distance < best + 1.25}
                if len(profiles) == 1:
                    votes[profiles.pop()] += 1
        if len(votes) == 1:
            profile, hits = votes.most_common(1)[0]
            if hits >= math.ceil(count * 0.8):
                result[edge.data['key']] = profile
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('geopackage', type=Path)
    parser.add_argument('release', type=date.fromisoformat)
    parser.add_argument('output', type=Path)
    parser.add_argument('--previous', type=Path, help='Preserve verified same-release profiles on unchanged directed edges')
    args = parser.parse_args()
    graph = rd_graph(load_graph())
    release = args.release.isoformat()
    edges = posted_speeds(graph, SegmentIndex(read_segments(args.geopackage, release, graph.bounds)))
    if not edges:
        raise ValueError('No posted speeds matched the Ede road network')
    if args.previous:
        previous = json.loads(args.previous.read_bytes())
        if previous['release'] != release:
            parser.error('--previous needs a posted-speed asset from the same source release')
        for edge in graph.edges:
            key = edge.data['key']
            if key in previous['edges']:
                edges.setdefault(key, previous['edges'][key])
    payload = {'version': 1, 'release': release, 'edges': edges}
    args.output.write_text(json.dumps(payload, separators=(',', ':'), sort_keys=True) + '\n')
    print(f'WKD matched {len(edges)} directed edges, including {sum(len(p) > 1 for p in edges.values())} scheduled limits')


if __name__ == '__main__':
    main()
