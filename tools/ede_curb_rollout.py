"""Find and fit same-level BGT curb candidates. All new rises are estimates."""

from collections import Counter, defaultdict
from itertools import chain
import json
from math import hypot

from shapely import STRtree, constrained_delaunay_triangles, make_valid, union_all
from shapely.geometry import LineString, Point, Polygon

ROAD = {'rijbaan lokale weg', 'rijbaan regionale weg'}
RESERVED = {'woonerf', 'ov-baan', 'overweg', 'verkeersdrempel'}
JOIN = {'voetpad', 'voetgangersgebied', 'fietspad', 'inrit', 'parkeervlak', 'verkeerseiland'}
MATERIAL = {'tegels', 'gebakken klinkers', 'betonstraatstenen'}


def area(rings):
    outer, *holes = [list(zip(ring[::2], ring[1::2])) for ring in rings]
    return make_valid(Polygon(outer, holes))


def polygon_parts(shape):
    if shape.geom_type == 'Polygon':
        if shape.area > 1e-8:
            yield shape
    elif hasattr(shape, 'geoms'):
        for part in shape.geoms:
            yield from polygon_parts(part)


def hits(index, shape):
    return index.query(shape, predicate='intersects')


def grade_and_platform_reserves(assets, street):
    for name in ('ede-grade.json', 'ede-motorway-grades.json'):
        for site in json.loads((assets / name).read_text())['sites']:
            for profile in chain(site.get('profiles', ()), [site.get('excavation') or {}]):
                points = [point[:2] for point in profile.get('points', ())]
                if len(points) > 1:
                    yield LineString(points).buffer(profile.get('width', 5) / 2 + 1.5, quad_segs=2)
    variant_data = json.loads((assets / 'ede-bus-routes.json').read_text())['variants']
    stops = {(round(s['x'], 1), round(s['z'], 1)) for route in variant_data for s in route['stops']
             if 'x' in s and 'z' in s}
    for stop in sorted(stops):
        yield Point(stop).buffer(25, quad_segs=3)
    for bump in street['bumps']:
        if not bump.get('layer') and bump['profile'] == 'table' and len(bump.get('footprint', ())) >= 3:
            yield make_valid(Polygon(bump['footprint'])).buffer(1, quad_segs=2)


def crossing_zones(crossings):
    ramps, islands, uncertain = [], [], []
    for row in crossings:
        if row.get('layer') or row.get('bridge') or row.get('tunnel') or len(row.get('ends', ())) != 2:
            continue
        a, b = row['ends']
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = hypot(dx, dz)
        if not 1 <= length <= 45:
            continue
        if row['match'] != 'matched' or row.get('bumpId'):
            uncertain.append(LineString([a, b]).buffer(3, quad_segs=2))
            continue
        dx, dz = dx / length, dz / length
        axis = LineString([(a[0] - dx * 2, a[1] - dz * 2), (b[0] + dx * 2, b[1] + dz * 2)])
        width = max(1.1, min(2, row['length'] / 2))
        ramps.append((axis.buffer(width, cap_style='flat'), (*axis.centroid.coords[0], length / 2 + 6)))
        if row.get('refuge'):
            islands.append(LineString([a, b]).buffer(width + 2.5, quad_segs=2))
    return ramps, islands, uncertain


def split_top(shape, low, limit, rise, road_lift):
    outer = low.buffer(limit, quad_segs=2)
    full = shape.difference(outer)
    if full.area < min(0.75, shape.area * 0.12):
        return None
    top = []
    for region, height in ((shape.intersection(low), 0), (shape.intersection(outer).difference(low), None), (full, rise)):
        for piece in polygon_parts(region):
            for triangle in constrained_delaunay_triangles(piece).geoms:
                for x, z in list(triangle.exterior.coords)[:3]:
                    y = height
                    if y is None:
                        point = Point(x, z)
                        y = rise if outer.boundary.distance(point) < 1e-7 else min(1, low.distance(point) / limit) * rise
                    top.extend((round(x, 4), round(road_lift + y, 5), round(z, 4)))
    return top


def municipal_profiles(assets, packs, street, pilot, defaults, include_locations=False):
    lift = defaults['roadLift']
    run = defaults['municipalRampRun']
    duplicates = Counter(row['id'] for pack in packs for row in pack['surfaces'])
    rows = [(pack_index, row, part, area(rings))
            for pack_index, pack in enumerate(packs) for row in pack['surfaces'] if row['layer'] == 0
            for part, rings in enumerate(row['polygons'])]
    paving = STRtree([r[-1] for r in rows])
    crossing, island_areas, uncertain = crossing_zones(street['crossings'])
    crossing_index = STRtree([item[0] for item in crossing])
    islands = STRtree(island_areas)
    pilot_zones = (Point(x, z).buffer(radius, quad_segs=3) for x, z, radius in pilot['sites'])
    footprint_reserves = STRtree(list(chain(grade_and_platform_reserves(assets, street), uncertain, pilot_zones)))
    counts = Counter()
    unresolved = []

    def review(reason, row):
        counts[reason] += 1
        if include_locations:
            _, surface, part, shape = row
            point = shape.representative_point()
            unresolved.append([surface['id'], part, round(point.x, 2), round(point.y, 2), reason])

    eligible = {}
    for i, (_, row, _, shape) in enumerate(rows):
        function = row['function']
        if function not in {'voetpad', 'verkeerseiland'} or row.get('plus_fysiek_voorkomen') not in MATERIAL:
            continue
        if duplicates[row['id']] != 1:
            review('multiple source shapes', rows[i])
            continue
        if function == 'verkeerseiland' and not len(hits(islands, shape)):
            counts['island without a matched refuge'] += 1
            continue
        if row['id'] in pilot['profiles'] or len(hits(footprint_reserves, shape)):
            if row['id'] not in pilot['profiles']:
                review('structure, platform, nearby pilot or uncertain crossing', rows[i])
            else:
                counts['reviewed pilot'] += 1
            continue
        adjacent = list(hits(paving, shape))
        fronts = []
        for j in adjacent:
            _, near, _, other = rows[j]
            use = near['function']
            if use in RESERVED or use in ROAD and shape.intersection(other).area > 0.03:
                break
            if use in ROAD and near['resolution'] == 'bgt-detail':
                edge = shape.boundary.intersection(other.boundary)
                if edge.length >= 0.05:
                    fronts.append(edge)
        else:
            if union_all(fronts).length >= 3:
                eligible[i] = adjacent
                continue
        counts['no separate three-metre carriageway frontage'] += 1

    # Cache exact joins so lowering a shared end works even if the other sidewalk is later rejected.
    links = {}
    for i, adjacent in eligible.items():
        shape = rows[i][-1]
        joins = {}
        for j in adjacent:
            if j == i or rows[j][1]['function'] not in JOIN:
                continue
            other = rows[j][-1]
            seam = shape.boundary.intersection(other.boundary)
            if seam.length >= 0.4 or shape.intersection(other).area > 0.05:
                joins[j] = seam
        links[i] = joins, list(hits(crossing_index, shape))

    sealed = defaultdict(dict)

    def guards(i, active):
        joins, crossed = links[i]
        low_joins = [j for j in joins if j not in active or rows[j][1]['function'] != rows[i][1]['function']]
        return union_all([rows[j][-1] for j in low_joins] + [crossing[j][0] for j in crossed] + list(sealed[i].values())), low_joins, crossed

    active = set(eligible)
    while True:
        removed = set()
        for i in sorted(active):
            shape = rows[i][-1]
            low, _, _ = guards(i, active)
            if not low.is_empty and shape.difference(low.buffer(run, quad_segs=2)).area < min(0.75, shape.area * 0.12):
                removed.add(i)
        if removed:
            for i in sorted(removed):
                review('insufficient space for a taper', rows[i])
            active.difference_update(removed)
            continue

        mismatched = []
        low_by_part = {i: guards(i, active)[0] for i in active}
        for i in sorted(active):
            for j, seam in links[i][0].items():
                if j <= i or j not in active or j in sealed[i] or seam.length < 0.4:
                    continue
                a, b = low_by_part[i], low_by_part[j]
                for part in getattr(seam, 'geoms', (seam,)):
                    if part.geom_type != 'LineString':
                        continue
                    steps = max(1, int(part.length / 0.35))
                    for k in range(steps + 1):
                        at = part.interpolate(k / steps, normalized=True)
                        da = run if a.is_empty else min(run, a.distance(at))
                        db = run if b.is_empty else min(run, b.distance(at))
                        if abs(da - db) > 0.08:
                            mismatched.append((i, j, seam.buffer(0.01, quad_segs=2)))
                            break
                    else:
                        continue
                    break
        if not mismatched:
            break
        for i, j, seam in mismatched:
            sealed[i][j] = sealed[j][i] = seam
        counts['shared boundaries tapered on both sides'] += len(mismatched)

    flat, tops, support, driveway_ids, crossing_ids = {}, {}, set(), set(), set()
    by_pack = defaultdict(Counter)
    for i in sorted(active):
        source, row, part, shape = rows[i]
        use = row['function']
        rise = defaults['island' if use == 'verkeerseiland' else 'sidewalk']
        low, low_joins, crossed = guards(i, active)
        if low.is_empty:
            flat.setdefault(row['id'], {})[part] = round(lift + rise, 5)
        else:
            top = split_top(shape, low, run, rise, lift)
            if top is None:
                raise ValueError(f'Missing taper after validation for {row["id"]}')
            tops.setdefault(row['id'], {})[part] = top
            for j in crossed:
                crossing_ids.add(j)
                support.add(tuple(round(v, 2) for v in crossing[j][1]))
            for seam in sealed[i].values():
                location = seam.centroid
                support.add((round(location.x, 2), round(location.y, 2), 6))
            for j in low_joins:
                seam = links[i][0][j]
                if seam.length >= 0.4:
                    location = seam.centroid
                    support.add((round(location.x, 2), round(location.y, 2), 6))
                    if rows[j][1]['function'] == 'inrit':
                        driveway_ids.add(rows[j][1]['id'])
        by_pack[str(source)][use] += 1

    return {'flat': flat, 'tops': tops, 'transitionSites': sorted(support)}, {
        'partsByPack': dict(by_pack),
        'fittedParts': len(active),
        'constantProfiles': sum(map(len, flat.values())), 'variableProfiles': sum(map(len, tops.values())),
        'crossingTapers': len(crossing_ids), 'drivewayConnections': len(driveway_ids),
        'reviewReasons': dict(sorted(counts.items())),
        **({'reviewLocations': unresolved} if include_locations else {}),
    }
