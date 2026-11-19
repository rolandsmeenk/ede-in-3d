"""Fit the surveyed crossings in RD New; export profiles in the Oude Kerk frame."""

import argparse
from collections import defaultdict
from contextlib import ExitStack
import json
import math
from pathlib import Path
import runpy
from statistics import median

from pyproj import Transformer
import rasterio
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
GRADE = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))
WORLD = runpy.run_path(str(ROOT / 'tools/build-ede-bgt.py'))
SURVEYS = {
    'koepeltunnel', 'somatunnel', 'bospoorttunnel', 'frans-halslaan', 'parkweidepad-zuid',
    'maanderbroek-a30-a12', 'maanderbroek-link', 'frankeneng-west-passage', 'galvanistraat-a30',
    'n224-a30', 'maanderbuurtweg-a12', 'statenpad-a12', 'maanderdijk-passage', 'de-poortwachter',
    'bovenbuurtweg-a12', 'edeseweg-a12', 'baron-van-wassenaertunnel',
}
SLAB = 0.62  # Rendered deck thickness. There are no measured soffits in the source.
WOODLAND_DECKS = {'w959787174', 'w925880061', 'w6954256'}


def coordinates(way):
    return list(zip(way['pts'][::2], way['pts'][1::2]))


def extension(way, endpoints):
    points = coordinates(way)
    used = {way['id']}
    parts = [(way['id'], 0., LineString(points).length)]
    for reverse in [False, True]:
        if reverse:
            length = LineString(points).length
            points.reverse()
            parts = [(key, length - b, length - a) for key, a, b in reversed(parts)]
        length = LineString(points).length
        added = 0.
        while added < 95:
            p, q = points[-2:]
            axis = LineString([p, q]).length
            choices = []
            for candidate, sign in endpoints[q]:
                if candidate['id'] in used or candidate.get('kind') != way.get('kind'):
                    continue
                branch = coordinates(candidate)[::sign]
                r = branch[1]
                span = LineString([q, r]).length
                if not axis or not span:
                    continue
                alignment = ((q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1])) / (axis * span)
                if alignment > 0.6:
                    choices.append((alignment + .3 * bool(way.get('name') and candidate.get('name') == way['name']),
                                    candidate['id'], branch))
            if not choices:
                break
            _, key, branch = max(choices)
            used.add(key)
            span = LineString(branch).length
            parts.append((key, length, length + span))
            points.extend(branch[1:])
            length += span
            added += span
    length = LineString(points).length
    parts = [(key, length - b, length - a) for key, a, b in reversed(parts)]
    return LineString(points[::-1]), parts


def pieces(geometry, kind):
    if geometry.is_empty:
        return
    if geometry.geom_type == kind:
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from pieces(part, kind)


def mode_names(way):
    mask = way['modes'][0] | way['modes'][1]
    return [name for bits, name in [(7, 'motor'), (8, 'bike'), (16, 'foot')] if mask & bits]


def modeled_width(way, widths):
    return widths.get(way['id'], {}).get('width', way.get('bgt', {}).get('width', way['width']))


def interval(line, stations, outlines, padding):
    candidates = []
    for part in pieces(line.intersection(outlines), 'LineString'):
        start, end = sorted(line.project(Point(p)) for p in [part.coords[0], part.coords[-1]])
        if any(start - 2 <= s <= end + 2 for s in stations):
            candidates.append((start, end))
    if candidates:
        # A grouped BGT deck can continue over a second, separate crossing.
        return max(min(a for a, _ in candidates), min(stations) - 20), min(max(b for _, b in candidates), max(stations) + 20)
    return max(0, min(stations) - padding), min(line.length, max(stations) + padding)


def build(survey_directory):
    scene = GRADE['load_scene']()
    grid = GRADE['Terrain']()
    frame = scene['meta']['lonLatAffine']
    rd = Transformer.from_crs(4326, 28992, always_xy=True)
    catalog = json.loads((ROOT / 'tools/data/ede-crossing-sites.json').read_text())
    widths = json.loads((ROOT / 'tools/data/ede-bgt-road-evidence.json').read_text())['ways']
    asset = json.loads((ROOT / 'assets/ede-bgt.json').read_text())
    area = Polygon.from_bounds(*scene['meta']['bounds'])
    tunnels = json.loads((ROOT / 'tools/data/ede-crossing-tunnels.geojson').read_text())['features']
    footprints = {f['properties']['lokaal_id']: WORLD['world_geometry'](f, frame, area) for f in tunnels}
    for group in asset['structures']:
        if group['kind'] != 'deck':
            continue
        polygons = [Polygon(list(zip(rings[0][::2], rings[0][1::2]))) for rings in group['polygons']]
        for identity in group['ids']:
            footprints[identity] = unary_union(polygons)
    ways = {w['id']: w for w in scene['roads'] + scene['railways'] if len(w['pts']) >= 4}
    endpoints = defaultdict(list)
    for way in ways.values():
        points = coordinates(way)
        endpoints[points[0]].append((way, 1))
        endpoints[points[-1]].append((way, -1))

    def elevation(raster, point):
        e, n = rd.transform(frame['lon0'] + point.x / frame['x'][1], frame['lat0'] + point.y / frame['z'][2])
        v = float(next(raster.sample([(e, n)]))[0])
        return v if -2 < v < 95 else None

    def med(raster, line, s):
        samples = [elevation(raster, line.interpolate(min(line.length, max(0., s + d)))) for d in (-1.5, 0, 1.5)]
        finite = [v for v in samples if v is not None]
        return median(finite) if finite else None

    def ballast_height(raster, line, s):
        point = line.interpolate(s)
        a, b = line.interpolate(max(0, s - 1)), line.interpolate(min(line.length, s + 1))
        dx, dz = b.x - a.x, b.y - a.y
        length = math.hypot(dx, dz)
        samples = [elevation(raster, Point(point.x - across * dz / length, point.y + across * dx / length))
                   for across in (-0.55, 0, 0.55)]
        values = [height for height in samples if height is not None]
        return median(values) if values else None

    fits, issues = [], []
    for site in catalog['sites']:
        if site['id'] not in SURVEYS:
            continue
        upper = {key: extension(ways[key], endpoints) for key in site['upperWayIds']}
        lower = {key: extension(ways[key], endpoints) for key in site['lowerWayIds']}
        outlines = unary_union([footprints[id] for id in site['bgtIds'] if id in footprints])
        cross = defaultdict(list)
        pairings = []
        for u, (up, _) in upper.items():
            for l, (low, _) in lower.items():
                for p in pieces(up.intersection(low), 'Point'):
                    if p.distance(Point(site['center'])) > 75:
                        continue
                    cross[u].append(up.project(p))
                    cross[l].append(low.project(p))
                    pairings.append((u, l, p))
        built = {'upper': {}, 'lower': {}}
        with ExitStack() as stack:
            dtm, dsm = [stack.enter_context(rasterio.open(survey_directory / f"{site['id']}-{r}.tif")) for r in ('dtm', 'dsm')]
            for role, lines in [('upper', upper), ('lower', lower)]:
                for way_id, (line, parts) in lines.items():
                    if not cross[way_id]:
                        issues.append([site['id'], way_id, 'No level-separated intersection'])
                        continue
                    rail = 'modes' not in ways[way_id]
                    a, b = interval(line, cross[way_id], outlines, 8 if role == 'upper' else 12)
                    if site['id'] == 'bospoorttunnel' and role == 'lower':
                        # AHN resolves the ramp floor immediately outside the roof, including
                        # the covered ten metres north of the OSM tunnel-tag transition.
                        _, core_start, core_end = next(part for part in parts if part[0] == way_id)
                        a, b = max(0, core_start - 10), core_end
                    if rail and ways[way_id].get('bridge'):
                        a, b = next((lo, hi) for key, lo, hi in parts if key == way_id)
                    if b - a < 2 or b - a > 130:
                        issues.append([site['id'], way_id, 'Roof or deck extent is ambiguous'])
                        continue
                    approach = 96 if rail else 42
                    start, end = max(0, a - approach), min(line.length, b + approach)
                    controls = [(start, grid.at(line.interpolate(start).coords[0])),
                                (end, grid.at(line.interpolate(end).coords[0]))]
                    if rail:
                        # Keep lidar returns from roofs, wires, and tunnel floors out of the rail profile.
                        exposed = []
                        for edge, sign in [(a, -1), (b, 1)]:
                            samples = [(at, ballast_height(dtm, line, at)) for d in range(6, 91, 4)
                                       if start + 1 < (at := edge + sign * d) < end - 1]
                            exposed.append([(at, y) for at, y in samples if y is not None])
                        if any(len(samples) < 2 for samples in exposed):
                            issues.append([site['id'], way_id, 'Both exposed track approaches are required'])
                            continue
                        slope = median((right_y - left_y) / (right_s - left_s)
                                       for left_s, left_y in exposed[0] for right_s, right_y in exposed[1])
                        if abs(slope) > 0.025:
                            issues.append([site['id'], way_id, 'Exposed track grades are inconsistent'])
                            continue
                        middle = (a + b) / 2
                        height = median(y - slope * (at - middle) for side in exposed for at, y in side)
                        controls += [(at, height + slope * (at - middle))
                                     for at in (max(start + 0.5, a - 45), a, b, min(end - 0.5, b + 45))]
                    elif role == 'upper':
                        observations = []
                        for at in sorted({(a + b) / 2, a, b, *cross[way_id], a - 10, b + 10}):
                            if not start + 1 < at < end - 1:
                                continue
                            dem, surface = med(dtm, line, at), med(dsm, line, at)
                            if dem is None and surface is None:
                                continue
                            deck = ways[way_id].get('bridge')
                            height = dem if dem is not None and (surface is None or not deck and abs(surface - dem) > 1.8) else surface
                            observations.append((at, height))
                        heights = [y for at, y in observations if a - 1 <= at <= b + 1]
                        if way_id in WOODLAND_DECKS and heights:
                            # Returns from trees alongside these decks are above the pavement and cannot
                            # connect smoothly to the exposed road or path at the structural opening.
                            center = (a + b) / 2
                            elevation_center = median(heights)
                            exposed = [*controls, (center, elevation_center)]
                            exposed.sort()
                            observations = [(at, y) for at, y in observations
                                            if abs(y - GRADE['fitting_curve'](exposed, at)) < 0.65]
                            heights = [y for at, y in observations if a - 1 <= at <= b + 1]
                        if len(heights) < 2 or max(heights) - min(heights) > max(2.4, (b - a) * .1):
                            issues.append([site['id'], way_id, 'Exposed deck median is inconsistent'])
                            continue
                        controls.extend(observations)
                    else:
                        portals = []
                        for edge, sign in [(a, -1), (b, 1)]:
                            samples = [(edge + sign * d, med(dtm, line, edge + sign * d))
                                       for d in (3, 6, 9, 13, 18, 26, 33) if start + 1 < edge + sign * d < end - 1]
                            samples = [(at, y) for at, y in samples if y is not None]
                            if len(samples) < 2:
                                break
                            # The road observations should continue from the portal toward the open approach.
                            portals.append((edge, median([y for _, y in samples[:3]])))
                            controls += samples[::2]
                        if len(portals) < 2 or abs(portals[0][1] - portals[1][1]) > max(2.4, (b - a) * .11):
                            issues.append([site['id'], way_id, 'Both exposed floor approaches are required'])
                            continue
                        controls += portals
                    knots = sorted(dict(controls).items())
                    stations = GRADE['stations_of'](list(line.coords))
                    marks = {a, b, *range(int(start) + 1, int(end), 3),
                             *stations, *[s for s, _ in knots]}

                    def sample_profile(lo, hi):
                        points = []
                        for at in [lo, *sorted(s for s in marks if lo < s < hi), hi]:
                            p = line.interpolate(at)
                            if points and Point(points[-1][:2]).distance(p) < .04:
                                continue
                            y = GRADE['fitting_curve'](knots, at)
                            points.append([round(p.x, 2), round(p.y, 2), round(y - grid.nap, 3)])
                        return points

                    profile_id = f"{site['id']}-{role}-{way_id}"
                    span = [round(a - start, 2), round(b - start, 2)]
                    if rail:
                        item = {'railProfiles': [
                            dict(wayId=key, points=sample_profile(max(start, lo), min(end, hi)),
                                 source='PDOK AHN 0.5 m exposed ballast and interpolated deck',
                                 **({'fittedBallast': True} if not ways[key].get('bridge') else {}))
                            for key, lo, hi in parts if min(end, hi) - max(start, lo) > 0.15
                        ]}
                    else:
                        used = [key for key, lo, hi in parts if lo < end and start < hi]
                        item = dict(id=profile_id, points=sample_profile(start, end), wayIds=used, modes=mode_names(ways[way_id]),
                                    width=modeled_width(ways[way_id], widths),
                                    **({'span': span} if role == 'upper' else {'covered': span}))
                    built[role][way_id] = item, knots
        accepted = {'upper': set(), 'lower': set()}
        for u, l, p in pairings:
            if u not in built['upper'] or l not in built['lower']:
                continue
            upper_y = GRADE['fitting_curve'](built['upper'][u][1], upper[u][0].project(p))
            lower_y = GRADE['fitting_curve'](built['lower'][l][1], lower[l][0].project(p))
            gap = upper_y - lower_y - SLAB
            if gap < (3.6 if 'motor' in built['lower'][l][0]['modes'] else 1.95) or gap > 11:
                issues.append([site['id'], u + '/' + l, f'Unconfirmed available clearance {gap:.2f} m'])
                continue
            lower_item = built['lower'][l][0]
            lower_item['clearance'] = round(min(lower_item.get('clearance', gap), gap), 2)
            accepted['upper'].add(u)
            accepted['lower'].add(l)
        roads, tracks = {'upper': [], 'lower': []}, []
        for role in accepted:
            for key in sorted(accepted[role]):
                item = built[role][key][0]
                if 'railProfiles' in item:
                    tracks.extend(item['railProfiles'])
                else:
                    roads[role].append(item)
        if roads['lower'] and all(key in accepted['upper'] for key in upper if cross[key]) \
                and all(key in accepted['lower'] for key in lower if cross[key]):
            evidence = dict(bgt=site['bgtIds'], heights='PDOK AHN DTM and DSM 0.5 m exposed observations; hidden floors, deck slab and soffit fitted')
            if tracks:
                evidence['railHeights'] = 'Exposed DTM ballast ties on both sides of the deck, with terrain transitions on the adjacent OSM rail ways'
            if roads['upper']:
                fits.append(dict(id=site['id'] + '-upper', name=site['name'] + ' upper routes', kind='bridge',
                                 profiles=roads['upper'], evidence=evidence))
            if site['id'] != 'parkweidepad-zuid':  # The existing lower profile includes four separate surveyed roof intervals.
                fits.append(dict(id=site['id'] + '-lower', name=site['name'] + ' lower routes', kind='underpass',
                                 profiles=roads['lower'], cutCoveredTerrain=True, surfacesOnly=len(roads['lower']) > 1,
                                 evidence=evidence, auditRailHeights=tracks))
    # The exposed bicycle deck across the south approach of the station tunnel
    # is absent from the older Westtunnel profiles.
    way_id = 'w1385637309'
    line, parts = extension(ways[way_id], endpoints)
    _, west_a, west_b = next(part for part in parts if part[0] == way_id)
    start, end = max(0, west_a - 14), min(line.length, west_b + 14)
    with rasterio.open(survey_directory / 'westtunnel-dsm.tif') as surface:
        stations = [west_a, (west_a + west_b) / 2, west_b]
        measured = [elevation(surface, line.interpolate(s)) for s in stations]
    if all(y is not None and 19 < y < 22 for y in measured):
        knots = [(start, grid.at(line.interpolate(start).coords[0])),
                 *zip(stations, measured), (end, grid.at(line.interpolate(end).coords[0]))]
        knots = sorted(dict(knots).items())
        points = [[round(p.x, 2), round(p.y, 2), round(GRADE['fitting_curve'](knots, s) - grid.nap, 3)]
                  for s in sorted({start, end, *stations, *range(int(start) + 1, int(end), 2)})
                  for p in [line.interpolate(s)]]
        fits.append(dict(id='westtunnel-south-deck', name='Westtunnel southern walking and cycle deck',
                         kind='bridge', evidence={'heights': 'PDOK AHN 0.5 m exposed slab and approach ties'},
                         profiles=[dict(id='westtunnel-south-deck-path', points=points,
                                        wayIds=[key for key, lo, hi in parts if lo < end and start < hi],
                                        modes=mode_names(ways[way_id]), width=modeled_width(ways[way_id], widths),
                                        span=[round(west_a - start, 2), round(west_b - start, 2)])]))
    else:
        issues.append(['westtunnel', way_id, 'Deck observations outside station envelope'])
    return {'version': 1, 'sites': fits, 'issues': issues}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('survey', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'tools/data/ede-crossing-fits.json')
    args = parser.parse_args()
    args.output.write_text(json.dumps(build(args.survey), separators=(',', ':')) + '\n')
