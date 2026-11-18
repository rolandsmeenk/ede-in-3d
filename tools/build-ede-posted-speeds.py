#!/usr/bin/env python3
"""Extract directed posted speeds from the official WKD Snelheden.gpkg."""

import argparse
import json
import math
import sqlite3
import struct
from collections import Counter
from datetime import date
from pathlib import Path

from ede_traffic_geometry import Segment, SegmentIndex, load_graph, normalize_name

ALLOWED_SPEEDS = {5, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 130}


def rd_to_lon_lat(x, y):
    # Kadaster/PCTrans approximation of RD New to WGS84 over the Netherlands.
    x, y = (x - 155000) * 1e-5, (y - 463000) * 1e-5
    north = (3235.65389 * y - 32.58297 * x**2 - 0.24750 * y**2 - 0.84978 * x**2 * y
             - 0.06550 * y**3 - 0.01709 * x**2 * y**2 - 0.00738 * x + 0.00530 * x**4
             - 0.00039 * x**2 * y**3 + 0.00033 * x**4 * y - 0.00012 * x * y)
    east = (5260.52916 * x + 105.94684 * x * y + 2.45656 * x * y**2 - 0.81885 * x**3
            + 0.05594 * x * y**3 - 0.05607 * x**3 * y + 0.01199 * y - 0.00256 * x**3 * y**2
            + 0.00128 * x * y**4 + 0.00022 * y**2 - 0.00022 * x**2 + 0.00026 * x**5)
    return 5.38720621 + east / 3600, 52.15517440 + north / 3600


def read_linestring(blob):
    # GeoPackage header, optional envelope, then binary OGC LineString.
    if blob[:2] != b'GP':
        raise ValueError('Expected a GeoPackage geometry')
    envelope_code = blob[3] >> 1 & 7
    offset = 8 + (0, 32, 48, 48, 64)[envelope_code]
    endian = '<' if blob[offset] == 1 else '>'
    geometry_type, count = struct.unpack_from(endian + 'II', blob, offset + 1)
    if geometry_type != 2:
        raise ValueError('Expected a 2D LineString')
    return struct.unpack_from(endian + 'dd' * count, blob, offset + 9)


def read_segments(path, graph, as_of):
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as connection:
        # The Ede map plus buffer in metres RD New. Geometry is already clipped to VAN/NAAR.
        rows = connection.execute('''
            SELECT geom, stt_naam, wegnummer, maxshd, begintijd, eindtijd, maxshd_alt, kenm_richt, dat_maxshd
            FROM rtree_Snelheden_geom AS r JOIN Snelheden AS s ON s.id = r.id
            WHERE r.maxx >= 168000 AND r.minx <= 178000 AND r.maxy >= 446000 AND r.miny <= 454000
                AND betrwbheid = '100%' AND maxshd NOT IN ('NVT', 'NOA')
        ''')
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
            coords = read_linestring(blob)
            points = [graph.project(*rd_to_lon_lat(x, y)) for x, y in zip(coords[::2], coords[1::2])]
            data = normalize_name(name), number, direction, profile
            for a, b in zip(points, points[1:]):
                yield Segment(a, b, data)


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
    args = parser.parse_args()
    graph = load_graph()
    edges = posted_speeds(graph, SegmentIndex(read_segments(args.geopackage, graph, args.release.isoformat())))
    if not edges:
        raise ValueError('No posted speeds matched the Ede road network')
    payload = {'version': 1, 'release': args.release.isoformat(), 'edges': edges}
    args.output.write_text(json.dumps(payload, separators=(',', ':'), sort_keys=True) + '\n')
    print(f'WKD matched {len(edges)} directed edges, including {sum(len(p) > 1 for p in edges.values())} scheduled limits')


if __name__ == '__main__':
    main()
