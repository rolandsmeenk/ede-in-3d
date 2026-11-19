#!/usr/bin/env python3
"""Fit Ede grade crossings to OSM and the scene's AHN datum."""

import argparse
import bisect
import json
import math
from pathlib import Path
import struct

from ede_map import load_scene

ROOT = Path(__file__).resolve().parents[1]
PRO_RAIL = 'https://maps.prorail.nl/arcgis/rest/services/ProRail_basiskaart/FeatureServer'
BGT = 'https://api.pdok.nl/lv/bgt/ogc/v1/collections'
AHN = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
WEST_PROJECT = 'https://www.spoorzone-ede.nl/nieuws/opening-westtunnel-en-fietsenstalling-station-ede-wageningen'
STATION_PLAN = 'https://www.prorail.nl/siteassets/homepage/projecten/ede-spoorzone/2.1.-spoorzone-ede-2022-p2-1.pdf'


class Terrain:
    def __init__(self):
        data = (ROOT / 'assets/ede-ahn.bin').read_bytes()
        magic, self.columns, self.rows, self.x, self.z, self.step, self.nap = struct.unpack_from('<4sIIffff', data)
        if magic != b'AHN1':
            raise ValueError('Unrecognized terrain datum')
        self.nap = round(self.nap, 2)
        self.heights = struct.unpack_from(f'<{self.columns * self.rows}h', data, 28)

    def at(self, point):
        x, z = point
        cx, cz = (x - self.x) / self.step, (z - self.z) / self.step
        j, i = math.floor(cx), math.floor(cz)
        assert 0 <= j < self.columns - 1 and 0 <= i < self.rows - 1, point
        u, v = cx - j, cz - i
        k = i * self.columns + j
        a, b = self.heights[k:k + 2]
        c, d = self.heights[k + self.columns:k + self.columns + 2]
        # Match js/terrain.js's rendered mesh diagonal.
        if u + v <= 1:
            return (a + (b - a) * u + (c - a) * v) / 100
        return (d + (c - d) * (1 - u) + (b - d) * (1 - v)) / 100


def project(frame, lon, lat):
    return (lon - frame['lon0']) * frame['x'][1], (lat - frame['lat0']) * frame['z'][2]


def point_on_line(points, stations, at):
    i = min(len(points) - 2, max(0, bisect.bisect_right(stations, at) - 1))
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


def fitting_curve(knots, distance):
    i = min(len(knots) - 2, max(0, bisect.bisect_right(knots, (distance, math.inf)) - 1))
    a, b = knots[i:i + 2]
    q = (distance - a[0]) / (b[0] - a[0])
    s = (b[1] - a[1]) / (b[0] - a[0])

    def slope(left, right):
        return 2 * left * right / (left + right) if left * right > 0 else 0

    previous = knots[i - 1] if i else None
    following = knots[i + 2] if i + 2 < len(knots) else None
    m0 = slope((a[1] - previous[1]) / (a[0] - previous[0]), s) if previous else s
    m1 = slope(s, (following[1] - b[1]) / (following[0] - b[0])) if following else s
    return a[1] + (3 * q * q - 2 * q ** 3) * (b[1] - a[1]) + (
        q * (1 - q) * ((1 - q) * m0 - q * m1) * (b[0] - a[0])
    )


def build(osm, output, survey_dir):
    terrain = Terrain()
    level_survey = json.loads((ROOT / 'tools/data/ede-level-crossing-elevations.json').read_text())
    scene = load_scene()
    frame = scene['meta']['lonLatAffine']
    scene_ways = {item['id']: item for item in scene['roads'] + scene['railways']}
    raw = {element['id']: element for element in json.loads(osm.read_text())['elements']
           if element['type'] == 'way' and 'geometry' in element}

    def xy(location):
        return project(frame, *location)

    def path(ids):
        points = []
        spans = {}
        for way_id in ids:
            way = raw[abs(way_id)]
            coords = [xy((q['lon'], q['lat'])) for q in way['geometry']]
            if way_id < 0:
                coords.reverse()
            if points and points[-1] != coords[0]:
                raise ValueError(f'Disconnected approach at OSM way {way_id}')
            spans[abs(way_id)] = max(0, len(points) - 1), len(points) + len(coords) - 1 - bool(points)
            points.extend(coords[bool(points):])
        stations = stations_of(points)
        return points, stations, {key: (stations[a], stations[b]) for key, (a, b) in spans.items()}

    def survey(layer):
        if not survey_dir:
            return []
        return json.loads((survey_dir / f'slop-ede-grade-pr-{layer}.json').read_text())['features']

    def profile(name, ids, width, modes, window, controls, covers=(), offset=0, endpoint_heights=None, **fields):
        points, stations, spans = path(ids)
        start, end = window
        start, end = max(0, start), min(stations[-1], end)
        if not start < end:
            raise ValueError(f'Invalid profile bounds for {name}')
        cuts = {start, end, *[s for s in stations if start < s < end]}
        start_nap, end_nap = endpoint_heights or (
            terrain.at(point_on_line(points, stations, start)), terrain.at(point_on_line(points, stations, end))
        )
        knots = [(start, start_nap)]
        knots += [(s, nap) for s, nap in controls if start + 0.1 < s < end - 0.1]
        knots += [(end, end_nap)]
        assert all(a[0] < b[0] for a, b in zip(knots, knots[1:])), (name, knots)
        cuts.update(s for s, _ in knots)
        cuts.update(s for limits in covers for s in limits if start < s < end)
        cuts.update(start + d for d in range(3, math.ceil(end - start), 3) if start + d < end)
        cuts = [start, *sorted(p for p in cuts if start + 0.05 < p < end - 0.05), end]
        cuts = [p for i, p in enumerate(cuts) if not i or p - cuts[i - 1] >= 0.05]

        def point_at(s):
            x, z = point_on_line(points, stations, s)
            if offset:
                a = point_on_line(points, stations, max(0, s - 0.8))
                b = point_on_line(points, stations, min(stations[-1], s + 0.8))
                length = math.dist(a, b)
                x += offset * (a[1] - b[1]) / length
                z += offset * (b[0] - a[0]) / length
            return [round(x, 2), round(z, 2), round(fitting_curve(knots, s) - terrain.nap, 3)]

        shaped = [point_at(s) for s in cuts]
        owned = [f'w{key}' for key, (a, b) in spans.items() if a < end and start < b]
        assert all(way_id in scene_ways for way_id in owned), (name, owned)
        item = dict(id=name, points=shaped, width=width, modes=modes, wayIds=owned, **fields)
        if covers:
            fitted_stations = stations_of(shaped)
            ranges = [[round(station_at(shaped, fitted_stations, point_at(s)[:2]), 2) for s in limits] for limits in covers]
            assert all(0 <= a < b <= fitted_stations[-1] + 0.011 for a, b in ranges), (name, ranges)
            item['covered'] = ranges[0] if len(ranges) == 1 else ranges
        return item

    def tunnel(name, ids, core, width, modes, approach, fit, clearance=None, **fields):
        _, _, spans = path(ids)
        a, b = spans[core[0]][0], spans[core[-1]][1]
        before, after = approach
        near_a, portal_a, middle, portal_b, near_b = fit
        return profile(name, ids, width, modes, (a - before, b + after),
                       [(a - before / 2, near_a), (a, portal_a), ((a + b) / 2, middle),
                        (b, portal_b), (b + after / 2, near_b)], [(a, b)],
                       **({'clearance': clearance} if clearance is not None else {}), **fields)

    def envelope(primary, name, width, shift=0):
        points = []
        for i, (x, z, y) in enumerate(primary['points']):
            a = primary['points'][max(0, i - 1)]
            b = primary['points'][min(len(primary['points']) - 1, i + 1)]
            length = math.dist(a[:2], b[:2])
            points.append([round(x + shift * (a[1] - b[1]) / length, 2),
                           round(z + shift * (b[0] - a[0]) / length, 2), y])
        result = dict(id=name, points=points, width=width)
        if 'covered' in primary:
            # The interval boundaries have already been sampled on the primary axis.
            primary_s, axis_s = stations_of(primary['points']), stations_of(points)
            source = primary['covered']
            limits = source if isinstance(source[0], list) else [source]
            ranges = [[round(point_on_line(list(zip(axis_s, axis_s)), primary_s, s)[0], 2)
                       for s in pair] for pair in limits]
            result['covered'] = ranges if isinstance(source[0], list) else ranges[0]
        return result

    motor = ['motor']
    active = ['bike', 'foot']
    road_modes = ['motor', *active]
    alberts_profiles = [
        tunnel('alberts-southbound', [846200818, 6952984, 6952980, 1136549918], [6952984],
               8, motor, (82, 76), (16.58, 16.02, 15.85, 15.96, 16.48)),
        tunnel('alberts-northbound', [1136549919, 1063323754, 6952971, 846327504], [1063323754],
               8, motor, (82, 80), (16.44, 15.96, 15.85, 16.0, 16.61)),
        tunnel('alberts-west-path', [25098903, 25098905, 25098904], [25098905],
               scene_ways['w25098905']['width'], active, (54, 58), (17.02, 16.96, 16.94, 16.96, 17.0), 3.05),
        tunnel('alberts-east-path', [25031947, 1063323753, 846200814], [1063323753],
               scene_ways['w1063323753']['width'], active, (70, 74), (17.72, 17.70, 17.69, 17.72, 17.74), 2.35),
    ]
    alberts = dict(id='albertstunnel', name='Albertstunnel (Klinkenbergerweg)', kind='underpass',
                  clearance=4.1, clearanceStatus='Mapped signed vehicle limit in OSM',
                  profiles=alberts_profiles, excavation=envelope(alberts_profiles[0], 'alberts-cut', 27.6, -4.6),
                  evidence=dict(bgt=['L0004.a868e3a0aea840a98f3d77833a6f3ac5',
                                     'G0228.fe246f55fae8d6d6e0400a0a35020533',
                                     'G0228.fe246f55fae9d6d6e0400a0a35020533'],
                                plan=STATION_PLAN, heights='AHN 0.5 m approach tie points, floor inferred between portals'))

    west_ids = [1287248250, 1454233554, 1549283975, 1287248249, 1287248248]
    ln, ss, _ = path(west_ids)
    west_cover = [station_at(ln, ss, xy(q)) for q in [(5.67145449, 52.02767164), (5.67141772, 52.02808658)]]
    west_a, west_b = west_cover
    west_knots = [(41, 19.8), (68, 18.24), (west_a, 17.30), (west_a + 9, 17.04),
                  (west_b - 6, 17.03), (west_b, 17.17), (149, 18.16), (178, 19.88)]
    west_profiles = [
        profile('westtunnel-cycleway', west_ids, 4.7, ['bike'], (24, 201), west_knots, [west_cover]),
        profile('westtunnel-footway', west_ids, 2.55, ['foot'], (24, 201), west_knots, [west_cover], offset=3.48),
    ]
    west = dict(id='westtunnel', name='Westtunnel (Ede-Wageningen)', kind='underpass',
                clearance=3.0, clearanceStatus='Estimated clear height',
                profiles=west_profiles, excavation=envelope(west_profiles[0], 'westtunnel-cut', 7.8, 1.55),
                evidence=dict(bgt=['L0004.20c74afecca8440c909b29a46147fb5e',
                                   'G0228.415cae8b01fb4636bdb799d6703b1130',
                                   'G0228.4f67503be13a4467aa0bc8a87e981d90'],
                              plan=WEST_PROJECT, heights='AHN terrain ties, fitted floor below ProRail track datum'))

    park_ids = [363124900, 363124901, 363124902]
    ln, ss, _ = path(park_ids)
    # Intersections of the OSM centreline with the four BGT tunnel polygons.
    park_roofs = [
        [(5.64403766, 52.05030360), (5.64407893, 52.05028154)],
        [(5.64409593, 52.05026334), (5.64414563, 52.05019083)],
        [(5.64419132, 52.05012404), (5.64424349, 52.05004763)],
        [(5.64426643, 52.05001404), (5.64429526, 52.04997182)],
    ]
    park_covers = [[station_at(ln, ss, xy(q)) for q in pair] for pair in park_roofs]
    park_knots = [(36, 13.04), (60, 12.10), (76, 11.77), (93, 11.78),
                  (111, 11.83), (126, 12.34), (155, 13.36), (188, 14.53)]
    park_profiles = [
        profile('parkweidepad-cycleway', park_ids, 4, ['bike'], (20, 211), park_knots, park_covers),
        profile('parkweidepad-footway', park_ids, 2.6, ['foot'], (20, 211), park_knots, park_covers, offset=-3.0),
    ]
    park = dict(id='parkweidepad-zuid', name='Parkweidepad Zuid (N224)', kind='underpass',
                clearance=2.6, clearanceStatus='Estimated clear height from AHN DTM/DSM roof difference',
                profiles=park_profiles, excavation=envelope(park_profiles[0], 'parkweidepad-cut', 7.3, -0.8),
                evidence=dict(bgt=['G0228.3d071a1a2b49496a984d07cdb2781a2c',
                                   'G0228.61256b5855d745a5a5d9af85f0ccc8af',
                                   'G0228.6279222b16f249ca80f57e8d026c1aa7',
                                   'G0228.661a58e3431b44d99efbee3c89087fbc'],
                              heights='AHN measured in clear intervals and across upper road'))

    # Stations follow the raw OSM centre lines. Covered intervals come from the
    # intersections with the Noorder Parallelweg, railway and Frankeneng decks.
    keesom_profiles = [
        profile('keesom-southbound', [421594657, 25710948, 430622525, 25710947], 7.2, motor,
                (357, 572), [(387, 12.15), (427, 10.71), (452, 9.97), (468, 9.80),
                             (477, 9.83), (492, 10.07), (507, 10.49), (547, 12.04)],
                [(432.23, 445.18), (461.77, 474.34), (492.56, 506.54)]),
        profile('keesom-northbound', [6954997, 25710950, 430622524, 421594658], 7.2, motor,
                (298, 508), [(324, 11.91), (354, 10.75), (374, 10.07), (387, 9.86),
                             (396, 9.80), (409, 9.88), (419, 10.02), (439, 10.69), (484, 12.28)],
                [(357.06, 370.99), (389.17, 401.71), (418.27, 431.15)]),
        profile('keesom-west-path', [163607273], 4.6, active, (374, 523),
                [(400, 12.19), (425, 11.73), (441, 11.47), (453, 11.38),
                 (460, 11.40), (470, 11.53), (490, 11.98), (510, 12.49)],
                [(411.09, 424.11), (440.74, 453.36), (471.64, 485.65)], clearance=2.6),
        profile('keesom-east-path', [421594656], 4.6, active, (23, 171),
                [(48, 12.57), (63, 12.22), (83, 11.74), (98, 11.51),
                 (110, 11.43), (123, 11.51), (143, 11.86), (163, 12.19)],
                [(65.58, 79.54), (97.75, 110.31), (126.90, 139.77)], clearance=2.6),
    ]
    keesom = dict(id='keesomtunnel', name='Keesomtunnel (Kastelenlaan / Keesomstraat)', kind='underpass',
                  clearance=4.2, clearanceStatus='OSM signed vehicle limit; estimated path clearance of 2.6 m',
                  profiles=keesom_profiles, excavation=envelope(keesom_profiles[0], 'keesom-cut', 33, -4.7),
                  cutCoveredTerrain=True,
                  evidence=dict(bgt=['G0228.fe246f5687f8d6d6e0400a0a35020533',
                                     'L0004.1ba1a93d4c164a0b85ba15d59881870b',
                                     'G0228.fe246f55fa55d6d6e0400a0a35020533'],
                                heights='AHN 0.5 m approach ties; covered floors inferred between deck edges'))

    def bridge_profile(name, ids, span, width, values):
        _, _, ranges = path(ids)
        a, b = ranges[span]
        return profile(name, ids, width, motor, (a - 34, b + 33),
                       [(a - 12, values[0]), (a, values[1]), ((a + b) / 2, values[2]),
                        (b, values[3]), (b + 12, values[4])],
                       span=[round(a - max(0, a - 34), 2), round(b - max(0, a - 34), 2)])

    def keesom_deck(name, ids, deck_ids, width, modes, nap):
        _, _, spans = path(ids)
        a, b = spans[deck_ids[0]][0], spans[deck_ids[-1]][1]
        start = max(0, a - 24)
        return profile(name, ids, width, modes, (start, b + 24), [(a, nap), (b, nap)],
                       span=[round(a - start, 2), round(b - start, 2)])

    keesom_decks = dict(id='keesom-road-decks', name='Noorder Parallelweg and Frankeneng viaducts',
                        kind='bridge', profiles=[
                            keesom_deck('noorder-parallelweg-deck', [6955250, 6955251, 6955267, 30745251],
                                        [6955251, 6955267], 7, road_modes, 15.31),
                            keesom_deck('frankeneng-road-deck', [352492922, 23568241, 23568240],
                                        [23568241], 7, motor, 15.45),
                            keesom_deck('frankeneng-cycle-deck', [24802272, 24802275, 222533006],
                                        [24802275], 4, active, 15.51),
                        ], evidence=dict(bgt=[keesom['evidence']['bgt'][0], keesom['evidence']['bgt'][2]],
                                         heights='AHN 0.5 m surface samples on both road decks'))

    sysselt_ids = [1115504035, 1115504037, 1544899841, 1193235810]
    _, _, sysselt_spans = path(sysselt_ids)
    sysselt_start, sysselt_end = sysselt_spans[1115504037]
    sysselt_from = 62
    sysselt = dict(id='sysseltsepad-bridge', name='Sysseltsepad cycle and footbridge', kind='bridge',
                   clearance=7.4, clearanceStatus='Estimated from AHN elevations and modeled slab thickness',
                   profiles=[profile('sysseltsepad-bridge-path', sysselt_ids, 4.6, active,
                                     (sysselt_from, 474), [(80, 30.09), (120, 30.11), (144, 30.58),
                                         (sysselt_start, 31.10), (176, 32.11), (192, 32.16),
                                         (sysselt_end, 32.13), (232, 31.37), (272, 29.97),
                                         (296, 29.12), (320, 28.99), (372, 27.27), (420, 25.52),
                                         (452, 24.28), (464, 23.84)],
                                     span=[round(sysselt_start - sysselt_from, 2),
                                           round(sysselt_end - sysselt_from, 2)],
                                     fillApproaches=True)],
                   evidence=dict(plan='https://www.gelderland.nl/themas/bereikbaar/ov/stations',
                                 heights='AHN6 0.5 m DSM for the completed 2023 deck and ramps and AHN DTM for the tracks'))

    a30_profiles = [
        bridge_profile('a30-northbound', [373094906, 6960078, 70490977], 6960078, 11,
                       (18.53, 18.57, 18.60, 18.56, 18.55)),
        bridge_profile('a30-southbound', [70490981, 6960132, 6960075], 6960132, 11,
                       (18.50, 18.61, 18.66, 18.55, 18.53)),
        bridge_profile('a30-east-ramp', [45036431, 70490957, 70490955], 70490957, 5.4,
                       (18.27, 18.38, 18.48, 18.44, 18.40)),
        bridge_profile('a30-west-ramp', [6960123, 70490959, 6960125], 70490959, 5.4,
                       (18.34, 18.36, 18.44, 18.33, 18.29)),
    ]
    a30 = dict(id='a30-rail-bridge', name='A30 railway viaduct', kind='bridge',
               profiles=a30_profiles, clearance=7.4, clearanceStatus='Estimated from AHN separation and deck thickness',
               evidence=dict(bgt=['L0002.73bbac3ff8164220957d09d21d823920',
                                  'L0004.1c481e61d284455d88ac29601d54f5c3',
                                  'L0004.e2da4da92f3b4e8ebbf1c3a4e5a86171'],
                             heights='AHN 0.5 m DSM deck 18.3–18.7 m NAP and DTM ballast 9.8–10.1 m NAP',
                             railReference='ProRail layer 9 objects 9351 and 5472 align in plan. Their 14.7–15.3 m Z disagrees with exposed ballast and deck clearance.'))

    langekamp, langekamp_stations, _ = path([189224783])

    def path_station(easting):
        a, b = langekamp[:2]
        fraction = (easting - a[0]) / (b[0] - a[0])
        return fraction * langekamp_stations[1]

    langekamp_cover = [path_station(-3697), path_station(-3743)]
    langekamp_path = profile('a30-langekamppad', [189224783], 3.6, active,
                            (path_station(-3635), path_station(-3769)),
                            [(path_station(x), y) for x, y in (
                                (-3650, 8.82), (-3670, 8.75), (-3690, 8.65), (-3697, 8.59),
                                (-3720, 8.57), (-3743, 8.57), (-3750, 8.62), (-3760, 8.71))],
                            [langekamp_cover], clearance=9.1)
    langekamp_site = dict(id='a30-rail-bridge-lower', name='Langekamppad beneath the A30 railway viaduct',
                          kind='underpass', profiles=[langekamp_path], surfacesOnly=True, cutCoveredTerrain=True,
                          evidence=dict(bgt=a30['evidence']['bgt'][:1],
                                        heights='AHN 0.5 m DTM 8.60 and 8.58 m NAP on exposed east and west approaches; '
                                                'the floor between them and the soffit are estimated.'))

    # These public AHOB crossings share OSM nodes with the track and sit on BGT
    # overweg polygons at relative level zero. Each group covers one roadway.
    public_crossings = [
        ('telefoonweg', 'Telefoonweg', '1058febe-631b-4d94-b470-8115b64a54e4',
         ['L0004.e3161f37a99649789c8824e422269bc4', 'L0004.30bece1bd4134cf1928e6ab8f623ea90'],
         [[(6953582, 431865751, 828435934)]]),
        ('asakkerweg', 'Asakkerweg (Kernhemseweg)', '6af0b230-22d1-4206-bfe1-70cd683e73eb',
         ['L0004.91a246b38cc74a1a82a5fbb89e06084c'], [[(145299446, 431865751, 540386091)]]),
        ('prins-bernhardlaan', 'Prins Bernhardlaan', '987ed6cd-2391-424b-8571-70ae21a8ac5e',
         ['L0004.90f837970ace448b9fde289879bd6fa8'], [[(6953598, 431865751, 44933293)]]),
        ('schabernauseweg', 'Schabernauseweg', '2e410d70-47c7-41cc-9f6f-da3827c35272',
         ['L0004.ab7c81b3b3a90f19e0530b29a8c02470'], [[(210852751, 431666248, 1477750972),
                                                       (210852751, 431666247, 1477750974)]]),
        ('molenstraat', 'Molenstraat', 'a4f38759-5458-4cdf-bd28-524d3dbe89c7',
         ['L0004.f7b68805cacd4a938d1b818a1eb2916d'], [[(698120592, 431865751, 828435927),
                                                       (6954224, 431865751, 828435936)]]),
        ('dwarsweg', 'Dwarsweg', '43cbdce3-5c65-4680-b20c-1a1ee193d960',
         ['L0004.ab7c81b3b3e90f19e0530b29a8c02470', 'L0004.ab7c81b3b3d30f19e0530b29a8c02470'],
         [[(6959849, 431666248, 1037383559), (6959849, 431666247, 44965915)]]),
        ('brouwerstraat', 'Brouwerstraat', 'ccbc633b-36ba-4826-8b03-e5f2b071dd0d',
         ['L0004.264646d3d14f41e99a66465ea0f6d8cc'], [[(6954116, 431865751, 1037928868)]]),
        ('nieuwe-stationsstraat', 'Nieuwe Stationsstraat', '134216a5-1735-4c11-889b-824b77a11534',
         ['L0004.cf812921ef8b426eabc0717844c98c6d'], [[(1056718033, 431865751, 44997616),
                                                       (6953326, 431865751, 44997616)]]),
        ('larixlaan', 'Larixlaan', 'cc3b0ddb-eeee-46a5-a383-936f3b58ffae',
         ['L0004.4488f5044ef641dc864a89db029a1e02'], [[(1534570943, 431865751, 13983099917),
                                                       (1534570939, 431865751, 44963518)]]),
        ('rijksweg-n224', 'Rijksweg (N224)', '62bbff90-e4a0-4d30-b22c-f88109208dae',
         ['L0004.df51e359a2104cb685d750a03d900111'], [[(6954242, 431865751, 540386088)],
                                                       [(169157162, 431865751, 275742566)],
                                                       [(302727682, 431865751, 45032408)]]),
        ('doolhoflaan', 'Doolhoflaan', 'a7af756c-407e-4bd3-93f2-6c233630845d',
         ['L0004.da0e093bc27248e5afb28c51fd5ea47b'], [[(184503786, 431762038, 45039492)]]),
        ('kade', 'Kade (De Klomp)', '90c967b4-1ed7-4688-97cb-7ee42e87dfa7',
         ['L0004.ab7c81b3b38b0f19e0530b29a8c02470', 'L0004.ab7c81b3b3f80f19e0530b29a8c02470'],
         [[(6959927, 431666248, 44983253), (6959927, 431666247, 996937042)]]),
        ('schaapsweg', 'Schaapsweg', 'f098cb7f-b0f9-43e1-b673-5dde9673f745',
         ['L0004.35aac5760f914dae9de200f47d05951b'], [[(6953288, 431865751, 44974395),
                                                       (405101604, 431865751, 4073226653)],
                                                       [(6953291, 431865751, 44973748)]]),
        ('amsterdamseweg', 'Amsterdamseweg', '30be996d-111d-4198-920e-d5c64dbe0c0f',
         ['L0004.cd813a17c85d4712b2b88e85b07eecd8'], [[(6954010, 431865751, 540386086),
                                                       (517669752, 431865751, 4307415111),
                                                       (517669719, 431865751, 5051288683)]]),
    ]

    def crossing_control(group):
        rows = []
        for road_id, rail_id, node_id in group:
            road = raw[road_id]
            i = road['nodes'].index(node_id)
            assert node_id in raw[rail_id]['nodes'], (road_id, rail_id, node_id)
            assert road.get('tags', {}).get('layer', '0') == '0', road_id
            assert raw[rail_id].get('tags', {}).get('layer', '0') == '0', rail_id
            geometry = road['geometry']
            p, a, b = (xy((q['lon'], q['lat'])) for q in
                       (geometry[i], geometry[max(0, i - 1)], geometry[min(i + 1, len(geometry) - 1)]))
            length = math.dist(a, b)
            rows.append((p, ((b[0] - a[0]) / length, (b[1] - a[1]) / length),
                         scene_ways[f'w{road_id}']['width']))
        base, axis, _ = rows[0]
        normal = -axis[1], axis[0]
        along = [(p[0] - base[0]) * axis[0] + (p[1] - base[1]) * axis[1] for p, _, _ in rows]
        lateral = [(p[0] - base[0]) * normal[0] + (p[1] - base[1]) * normal[1] for p, _, _ in rows]
        across_lo = min(v - entry[2] / 2 for v, entry in zip(lateral, rows))
        across_hi = max(v + entry[2] / 2 for v, entry in zip(lateral, rows))
        middle = (min(along) + max(along)) / 2
        side = (across_lo + across_hi) / 2
        x, z = (a + u * middle + v * side for a, u, v in zip(base, axis, normal))
        rails = list(dict.fromkeys(f'w{r}' for _, r, _ in group))
        assert max(math.dist((x, z), row[0]) for row in rows) < 9, group
        return dict(x=round(x, 2), z=round(z, 2), heading=round(math.atan2(*axis), 5),
                    width=round(across_hi - across_lo, 2), type='AHOB',
                    trackSpan=round(max(along) - min(along), 2) if len(rails) > 1 else 0,
                    roadWayIds=list(dict.fromkeys(f'w{r}' for r, _, _ in group)), railWayIds=rails,
                    nodeIds=list(dict.fromkeys(str(n) for _, _, n in group)))

    def fitted_crossing_road(slug, road_id, nodes):
        points, stations, _ = path([road_id])
        road = raw[road_id]
        scene_road = scene_ways[f'w{road_id}']
        shared = sorted((stations[road['nodes'].index(node)], level_survey['crossingSurfacesNAP'][str(node)])
                        for node in nodes)
        near, far = shared[0][0], shared[-1][0]
        start, end = max(0, near - 36), min(stations[-1], far + 36)
        endpoints = tuple(next((nap for s, nap in shared if abs(at - s) < 1e-6),
                               terrain.at(point_on_line(points, stations, at))) for at in (start, end))
        samples = [(near + d, nap) for d, nap in level_survey['roadApproachNAP'][str(road_id)]]
        samples = sorted([*samples, *shared])
        kind = scene_road['kind']
        modes = {'cycleway': active, 'footway': ['foot'], 'pedestrian': ['foot']}.get(kind, road_modes)
        surface = road.get('tags', {}).get('surface')
        return profile(f'{slug}-road-{road_id}', [road_id], scene_road['width'], modes, (start, end), samples,
                       endpoint_heights=endpoints, **({'surface': surface} if surface else {}))

    level_sites = []
    rail_crossings = {}
    for slug, name, puic, bgt, groups in public_crossings:
        controls = [crossing_control(group) for group in groups]
        roads, crossings = {}, {}
        for group in groups:
            for road_id, rail_id, node in group:
                roads.setdefault(road_id, set()).add(node)
                road = raw[road_id]
                q = road['geometry'][road['nodes'].index(node)]
                x, z = xy((q['lon'], q['lat']))
                nap = level_survey['crossingSurfacesNAP'][str(node)]
                crossing = crossings.setdefault(node, dict(nodeId=str(node), x=round(x, 2), z=round(z, 2),
                    y=round(nap - terrain.nap, 3), railWayId=f'w{rail_id}', roadWayIds=[]))
                crossing['roadWayIds'].append(f'w{road_id}')
                # Fitted paving sits 0.055 m above its profile and the railhead 0.13 m above ballast.
                rail_crossings.setdefault(rail_id, {})[node] = (x, z, nap + 0.055 - 0.13)
        level_sites.append(dict(id=f'{slug}-level-crossing', name=f'{name} railway crossing', kind='level',
                                profiles=[fitted_crossing_road(slug, road_id, nodes) for road_id, nodes in roads.items()],
                                controls=controls[0] if len(controls) == 1 else controls,
                                crossings=list(crossings.values()),
                                evidence=dict(bgt=bgt, proRailId=puic, public=True,
                                              heights='AHN 0.5 m overweg surfaces and measured approaches')))

    # ProRail positions are used to sample NAP, retaining the game's OSM axes.
    official = []
    for layer in [7, 9]:
        for feature in survey(layer):
            for coordinates in feature['geometry']['paths']:
                for a, b in zip(coordinates, coordinates[1:]):
                    if len(a) >= 3 and len(b) >= 3 and min(a[2], b[2]) > 5:
                        official.append((xy(a[:2]), xy(b[:2]), a[2], b[2]))

    def station_height(point):
        distance, nap = math.inf, 0
        for a, b, ya, yb in official:
            span = math.dist(a, b)
            if span < 0.05:
                continue
            s = station_at([a, b], [0, span], point)
            error = math.dist(point_on_line([a, b], [0, span], s), point)
            if error < distance:
                distance, nap = error, ya + (yb - ya) * s / span
        if distance < 1.5:
            return nap
        longitude = frame['lon0'] + point[0] / frame['x'][1]
        return 20.89 + (longitude - 5.67144) * 111.1

    def rail_profile(way_id, center_lonlat, radius, source, at_height, tie=False):
        road = scene_ways[f'w{way_id}']
        points = list(zip(road['pts'][::2], road['pts'][1::2]))
        ss = stations_of(points)
        midpoint = station_at(points, ss, xy(center_lonlat))
        start, end = max(0, midpoint - radius), min(ss[-1], midpoint + radius)
        assert start < end
        distances = sorted({start, end, midpoint, *[s for s in ss if start < s < end],
                            *[s for s in range(math.ceil(start), math.floor(end), 5)]})
        route = []
        for d in distances:
            p = point_on_line(points, ss, d)
            nap = at_height(p, d - midpoint)
            if tie:
                blend = max(0, min(1, (min(d - start, end - d)) / 18))
                nap = terrain.at(p) * (1 - blend) + blend * nap
            route.append([round(p[0], 2), round(p[1], 2), round(nap - terrain.nap, 3)])
        return dict(wayId=f'w{way_id}', points=route, source=source)

    rail_heights = [
        rail_profile(way, (5.67221, 52.02777), 167,
                     'ProRail Spoortakdeel and nearby parallel station rail survey', lambda p, _: station_height(p))
        for way in (227837719, 431639755, 431657554, 1052080205, 1052080207)
    ]
    level_rail_profiles = {}
    for key, surveyed in level_survey['railBallastNAP'].items():
        way_id = int(key)
        way = scene_ways[f'w{way_id}']
        points = list(zip(way['pts'][::2], way['pts'][1::2]))
        ss = stations_of(points)
        measured = [(*xy((lon, lat)), nap) for lon, lat, nap in surveyed]
        measured.extend(rail_crossings.get(way_id, {}).values())
        knots = sorted((station_at(points, ss, (x, z)), nap) for x, z, nap in measured)
        start, end = knots[0][0], knots[-1][0]
        if start < 0.01:
            start = 0
            knots[0] = (start, knots[0][1])
        if ss[-1] - end < 0.01:
            end = ss[-1]
            knots[-1] = (end, knots[-1][1])
        distances = sorted({*[s for s, _ in knots], *[s for s in ss if start < s < end],
                            *range(math.ceil(start), math.floor(end), 5)})
        route = [[round(x, 2), round(z, 2), round(fitting_curve(knots, s) - terrain.nap, 3)]
                 for s in distances for x, z in [point_on_line(points, ss, s)]]
        source = 'AHN 0.5 m western mainline ballast' if way_id in (431666247, 431666248) else (
            'AHN 0.5 m crossings and ProRail Valleilijn ballast')
        rail_heights.append(dict(wayId=f'w{way_id}', points=route, source=source, fittedBallast=True))
        level_rail_profiles[way_id] = (points, ss, knots)

    def a30_cut_height(point, _):
        beds = []
        for way_id in (431666247, 431666248):
            points, stations, knots = level_rail_profiles[way_id]
            beds.append(fitting_curve(knots, station_at(points, stations, point)))
        return min(beds)

    cut_points = rail_profile(431666248, (5.6172, 52.0379), 64, 'AHN 0.5 m ballast', a30_cut_height)['points']
    a30['excavation'] = envelope(dict(points=cut_points), 'a30-rail-cut', 10, -1.85)

    keesom_rail_center = (5.64608, 52.03260)
    def keesom_rail_height(point, nap):
        east = point[0] - xy(keesom_rail_center)[0]
        # The exposed mainline stays on its measured embankment well beyond the deck.
        t = max(0, min(1, (112 - abs(east)) / 52))
        weight = t * t * (3 - 2 * t)
        return terrain.at(point) * (1 - weight) + (nap + 0.0045 * east) * weight

    for rail_ways, nap in [((431662176, 6306101, 431666247), 14.95),
                           ((431666248, 431660809, 458879661), 15.05)]:
        for way in rail_ways:
            rail_heights.append(rail_profile(way, keesom_rail_center, 120,
                                            'AHN 0.5 m Keesomtunnel track deck and exposed ballast',
                                            lambda p, _: keesom_rail_height(p, nap)))

    for way_id, sign in [(431658944, -1), (1092211189, 1)]:
        rail_heights.append(rail_profile(way_id, (5.682945, 52.025802), 32, 'AHN 0.5 m Sysselt rail bed',
                                        lambda _, d: 24.10 + sign * d * 0.005, tie=True))

    sites = [alberts, west, a30, langekamp_site, park, keesom, keesom_decks, sysselt, *level_sites]
    for filename in ('ede-crossing-fits.json', 'ede-interior-fits.json', 'ede-discovered-crossing-fits.json'):
        surveyed = ROOT / 'tools/data' / filename
        if not surveyed.exists():
            continue
        for site in json.loads(surveyed.read_text())['sites']:
            rail_heights.extend(site.pop('auditRailHeights', []))
            sites.append(site)
    for site in sites:
        qa = []
        for p in site['profiles']:
            pts = p['points']
            ss = stations_of(pts)
            if site['kind'] == 'underpass':
                covers = p['covered']
                limits = covers if isinstance(covers[0], list) else [covers]
                middle = sum(limits[len(limits) // 2]) / 2
            elif site['kind'] == 'bridge':
                middle = sum(p['span']) / 2
            else:
                crossing_distances = [station_at(pts, ss, (q['x'], q['z'])) for q in site['crossings']
                                      if any(way in p['wayIds'] for way in q['roadWayIds'])]
                middle = (min(crossing_distances) + max(crossing_distances)) / 2
            before = point_on_line(pts, ss, min(9, ss[-1]))
            after = point_on_line(pts, ss, ss[-1] - min(9, ss[-1]))
            qa.append(dict(profile=p['id'], entry=list(map(lambda v: round(v, 3), before)),
                           sample=list(map(lambda v: round(v, 3), point_on_line(pts, ss, middle))),
                           exit=list(map(lambda v: round(v, 3), after)),
                           heading=round(math.atan2(after[0] - before[0], after[1] - before[1]), 5)))
        site['qa'] = qa

    output.write_text(json.dumps(dict(version=1, datumNAP=terrain.nap,
        sources=dict(osm='https://www.openstreetmap.org/copyright', ahn=AHN, bgt=BGT,
                     proRail=PRO_RAIL, verified='2026-11-18'),
        sites=sites, railHeights=rail_heights), ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Wrote {len(sites)} sites, {sum(len(s["profiles"]) for s in sites)} routes and '
          f'{len(rail_heights)} local rail profiles to {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('osm', type=Path, help='Ede Overpass snapshot with full OSM way geometry')
    parser.add_argument('--survey-dir', type=Path, help='Local ProRail layer 7 and 9 JSON query responses')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-grade.json')
    args = parser.parse_args()
    build(args.osm, args.output, args.survey_dir)

