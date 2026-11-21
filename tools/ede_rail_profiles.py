#!/usr/bin/env python3
"""Fit connected rail elevations from native AHN observations and measured controls."""

from bisect import bisect_left, bisect_right
from collections import defaultdict
import math
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
SURVEY = ROOT / 'tools/data/ede-rail-survey.json'
EAST_BERTHS = {
    'w227837719': ('w431638734', 249),
    'w431657554': ('w431657554', 345),
    'w1052080205': ('w1052080205', 345),
    'w1052080207': ('w1052080207', 345),
}


def point_on_line(points, stations, at):
    i = min(len(points) - 2, max(0, bisect_right(stations, at) - 1))
    a, b = points[i:i + 2]
    fraction = (at - stations[i]) / (stations[i + 1] - stations[i])
    return tuple(x + (y - x) * fraction for x, y in zip(a, b))


def station_at(points, stations, point):
    best = (math.inf, 0)
    for a, b, distance, end in zip(points, points[1:], stations, stations[1:]):
        length = end - distance
        dx, dz = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        x, z = point[0] - a[0], point[1] - a[1]
        along = max(0, min(length, x * dx + z * dz))
        best = min(best, (math.hypot(x - along * dx, z - along * dz), distance + along))
    return best[1]


def stations_of(points):
    stations = [0.]
    for a, b in zip(points, points[1:]):
        stations.append(stations[-1] + math.dist(a[:2], b[:2]))
    return stations


def fit(scene, grade, survey):
    import numpy as np
    from scipy.sparse import coo_matrix, diags
    from scipy.sparse.linalg import spsolve

    if survey.get('version') != 1:
        raise ValueError('Unsupported rail survey snapshot')

    # Give the most reliable controls exact heights. Exposed profile tails and
    # the raster are observations, so grid noise and patch boundaries can smooth out.
    sites = {site['id']: site for site in grade['sites']}
    structures = {
        'a30-rail-bridge': 125, 'keesomtunnel': 85, 'koepeltunnel': 55,
        'somatunnel': 55, 'sysseltsepad-bridge': 13,
    }
    controls = defaultdict(list)
    for site in sites.values():
        for crossing in site.get('crossings', []):
            controls[crossing['railWayId']].append(
                (crossing['x'], crossing['z'], crossing['y'] - 0.075, 3))
    hard_areas = [(sample['sample'][:2], radius) for site, radius in structures.items()
                  for sample in sites.get(site, {}).get('qa', [])]
    railways = {way['id']: way for way in scene['railways']}
    for profile in grade['railHeights']:
        station = profile.get('source', '').startswith('ProRail')
        for x, z, y in profile['points']:
            hard = station or any(math.dist((x, z), point) <= radius for point, radius in hard_areas)
            controls[profile['wayId']].append((x, z, y, 2 if hard else 1))
        if station and profile['wayId'] in EAST_BERTHS:
            # The raster sees parts of the platform and canopy beyond the last survey point.
            # Carry the measured berth grade through the platform before following open terrain.
            way_id, edge = EAST_BERTHS[profile['wayId']]
            x0, _, y0 = max(profile['points'], key=lambda point: point[0])
            x1, _, y1 = max((p for p in profile['points'] if p[0] < x0 - 20), key=lambda p: p[0])
            slope = (y0 - y1) / (x0 - x1)
            flat = railways[way_id]['pts']
            points = list(zip(flat[::2], flat[1::2]))
            for (ax, az), (bx, bz) in zip(points, points[1:]):
                start, end = max(min(ax, bx), x0), min(max(ax, bx), edge)
                if start >= end:
                    continue
                for x in [start, *range(math.ceil(start / 15) * 15, math.ceil(end), 15), end]:
                    if x > x0:
                        z = az + (bz - az) * (x - ax) / (bx - ax)
                        controls[way_id].append((x, z, y0 + slope * (x - x0), 2))

    graph = defaultdict(dict)
    vertices, xy, fixed, observed = {}, [], {}, []
    tracks = {}
    for way in scene['railways']:
        if way.get('tunnel'):
            continue
        way_id = way['id']
        points = list(zip(way['pts'][::2], way['pts'][1::2]))
        stations = stations_of(points)
        survey_rows = survey['ways'][way_id]
        if not survey_rows:
            raise ValueError(f'No usable AHN samples for {way_id}')
        distances = [s for s, _ in survey_rows]
        controls_at = defaultdict(list)
        for x, z, y, weight in controls[way_id]:
            s = station_at(points, stations, (x, z))
            nearest = min(stations, key=lambda d: abs(d - s))
            if abs(nearest - s) < 0.08:
                s = nearest
            controls_at[round(s, 5)].append((y, weight))

        # Retain every OSM vertex, including interior turnout junctions. Only
        # unrelated nearby tracks may carry different heights at the same station.
        axes = {round(s, 5): p for s, p in zip(stations, points)}
        for s in sorted(controls_at):
            if s not in axes:
                axes[s] = point_on_line(points, stations, s)
        anchors = sorted(axes)
        for i, left in enumerate(anchors[:-1]):
            right = anchors[i + 1]
            spacing = 5 if right > distances[0] and left < distances[-1] else 35
            count = math.ceil((right - left) / spacing)
            for j in range(1, count):
                s = left + (right - left) * j / count
                axes[s] = point_on_line(points, stations, s)

        indices = []
        for s, point in sorted(axes.items()):
            key = tuple(round(x, 4) for x in point)
            i = vertices.setdefault(key, len(xy))
            if i == len(xy):
                xy.append(key)
            if indices and i == indices[-1]:
                continue
            indices.append(i)
            k = bisect_left(distances, s)
            nearby = [nap for d, nap in survey_rows[max(0, k - 4):k + 4] if abs(s - d) <= 12]
            if nearby:
                observed.append((i, median(nearby) - grade['datumNAP'], 0.6 if way.get('bridge') else 1))
            elif s < distances[0] or s > distances[-1]:
                nap = survey_rows[0 if s < distances[0] else -1][1]
                observed.append((i, nap - grade['datumNAP'], 0.025))
            for y, priority in controls_at.get(s, []):
                if priority == 1:
                    observed.append((i, y, 2))
                elif i not in fixed or fixed[i][1] < priority:
                    fixed[i] = (y, priority)
        tracks[way_id] = (indices, bool(way.get('bridge')))
        for a, b in zip(indices, indices[1:]):
            distance = math.dist(xy[a], xy[b])
            graph[a][b] = graph[b][a] = distance

    bend_rows, bend_cols, bend_values = [], [], []
    for i, edges in graph.items():
        for a, left in edges.items():
            for b, right in edges.items():
                if a >= b:
                    continue
                x, z = xy[i]
                ux, uz = xy[a][0] - x, xy[a][1] - z
                vx, vz = xy[b][0] - x, xy[b][1] - z
                if (ux * vx + uz * vz) / (left * right) > -0.25:
                    continue
                # Penalize changes in grade along each through connection.
                scale = 400 / math.sqrt((left + right) * 2.5)
                row = len(bend_rows) // 3
                bend_rows.extend((row, row, row))
                bend_cols.extend((a, i, b))
                bend_values.extend((scale / left, -scale / left - scale / right, scale / right))

    size = len(xy)
    bends = coo_matrix((bend_values, (bend_rows, bend_cols)), shape=(len(bend_rows) // 3, size)).tocsr()
    roughness = bends.T @ bends
    constrained = np.array(sorted(fixed))
    fixed_y = np.array([fixed[i][0] for i in constrained])
    free = np.setdiff1d(np.arange(size), constrained)
    target_indices, target_y, weights = (np.array(column) for column in zip(*observed))
    target_indices = target_indices.astype(int)
    heights = np.zeros(size)
    heights[constrained] = fixed_y
    offset = roughness[free][:, constrained] @ fixed_y
    effective_weights = weights
    for _ in range(4):
        diagonal = np.bincount(target_indices, effective_weights, minlength=size)
        rhs = np.bincount(target_indices, effective_weights * target_y, minlength=size)
        smooth = roughness[free][:, free] + diags(diagonal[free])
        heights[free] = spsolve(smooth.tocsc(), rhs[free] - offset)
        residuals = np.abs(heights[target_indices] - target_y)
        effective_weights = weights * np.minimum(1, 0.30 / np.maximum(residuals, 0.30))

    result = []
    for way_id, (indices, bridge) in tracks.items():
        points = [[*xy[i], round(float(heights[i]), 4)] for i in indices]
        if not all(math.isfinite(p[2]) for p in points):
            raise ValueError(f'Unconstrained rail profile for {way_id}')
        if any(abs(a[2] - b[2]) > 0.03 * math.dist(a[:2], b[:2]) for a, b in zip(points, points[1:])):
            raise ValueError(f'Fitted rail grade exceeds 3% on {way_id}')
        result.append(dict(wayId=way_id, bridge=bridge, points=points))
    return result


def extend_corridor_profiles(result, affine):
    """Fit ProRail grades at the OSM axis and tie into the existing fitted endpoints."""
    import gzip
    import json

    from ede_scene import SceneAffine

    overlay = ROOT / 'assets/ede-corridors-v1.json.gz'
    if not overlay.exists():
        return
    with gzip.open(overlay, 'rt') as source:
        rails = json.load(source)['railways']
    evidence = json.loads((ROOT / 'tools/data/ede-corridor-prorail-z.json').read_text())
    result['sources']['proRailCorridorElevations'] = evidence['source']
    frame = SceneAffine(affine)
    survey_lines = [
        [(frame.lon_lat_to_scene(lon, lat), z - result['datumNAP']) for lon, lat, z in points]
        for _, points in evidence['features']
    ]
    legacy = {tuple(point[:2]): point[2] for profile in result['railCorridors']
              for point in (profile['points'][0], profile['points'][-1])}

    def sample(line, point):
        best = (math.inf, 0.0)
        for (a, ya), (b, yb) in zip(line, line[1:]):
            dx, dz = b[0] - a[0], b[1] - a[1]
            t = min(1, max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)))
            distance = math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz)
            best = min(best, (distance, ya + t * (yb - ya)))
        return best

    ways = {rail['id']: list(zip(rail['pts'][::2], rail['pts'][1::2])) for rail in rails}
    pending = set(ways)
    while pending:
        component = [min(pending)]
        pending.remove(component[0])
        for key in component:
            reachable = sorted(next_key for next_key in pending
                               if set((ways[next_key][0], ways[next_key][-1])) & set((ways[key][0], ways[key][-1])))
            pending.difference_update(reachable)
            component.extend(reachable)
        points = [point for key in component for point in ways[key]]
        line = min(survey_lines, key=lambda candidate: median(sample(candidate, point)[0] for point in points))
        anchors = set(points).intersection(legacy)
        corrections = {point: legacy[point] - sample(line, point)[1] for point in anchors}

        for key in component:
            geometry = ways[key]
            stations = stations_of(geometry)
            positions = sorted(set(stations).union(range(0, math.ceil(stations[-1]), 8)))
            fitted = []
            for station in positions:
                point = geometry[stations.index(station)] if station in stations else point_on_line(geometry, stations, station)
                elevation = sample(line, point)[1]
                if corrections:
                    anchor = min(corrections, key=lambda candidate: math.dist(point, candidate))
                    t = max(0, 1 - math.dist(point, anchor) / 350)
                    elevation += corrections[anchor] * t * t * (3 - 2 * t)
                fitted.append([*point, round(legacy.get(point, elevation), 3)])
            rail = next(row for row in rails if row['id'] == key)
            result['railCorridors'].append(dict(wayId=key, bridge=rail['bridge'], points=fitted))
