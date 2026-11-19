#!/usr/bin/env python3
"""Build fitted surfaces for four covered crossings from recorded AHN controls."""

import argparse
import json
import math
from pathlib import Path
import runpy


ROOT = Path(__file__).resolve().parents[1]
GRADE = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))
STATION = 'https://www.spoorzone-ede.nl/fileadmin/spoorzone-ede/Documenten/Keuzenota_Spoorzone_Ede_29_oktober_2012.pdf'
STATION_STRUCTURE = 'https://www.stubeco.nl/assets/images/Stubeco%20Kennisdocument%204-2023_EdesPoort.pdf'
PARKING = 'https://www.p1.nl/parkeerplaats/pr-ede-wageningen/'
STADSPOORT = 'https://www.breeam.nl/projecten/wc-stadspoort-ede-passage-en-algemene-ruimten-3943'
PARKLAAN = 'https://www.cementonline.nl/artikelen/tunnel-underneath-highway-a12-near-ede?file=1510233017.9466.pdf'


def build():
    terrain = GRADE['Terrain']()
    scene = GRADE['load_scene']()
    roads = {int(way['id'][1:]): way for way in scene['roads']}
    point_at = GRADE['point_on_line']
    distance_along = GRADE['stations_of']

    def profile(id, ids, core, window, stations_nap, *, width=None, ends=(None, None), **fields):
        # Stations are measured from the start of the core OSM way, in its mapped direction.
        points, origin, spans = [], None, []
        length = 0
        for signed in ids:
            way = roads[abs(signed)]
            vertices = list(zip(way['pts'][::2], way['pts'][1::2]))
            vertices = [v for i, v in enumerate(vertices) if i == 0 or v != vertices[i - 1]]
            if signed < 0:
                vertices.reverse()
            if points:
                assert points[-1] == vertices[0], (id, signed)
            if signed == core:
                origin = length
            next_length = length + distance_along(vertices)[-1]
            spans.append((way['id'], length, next_length))
            points.extend(vertices[bool(points):])
            length = next_length

        stations = [s - origin for s in distance_along(points)]
        start, end = max(stations[0], window[0]), min(stations[-1], window[1])
        assert start < end, id
        ties = [(s, terrain.at(point_at(points, stations, s)) if nap is None else nap)
                for s, nap in zip((start, end), ends)]
        knots = sorted([*ties, *((s, nap) for s, nap in stations_nap if start + 0.05 < s < end - 0.05)])
        assert all(a[0] < b[0] for a, b in zip(knots, knots[1:])), (id, knots)
        marks = {math.floor(start) + d for d in range(1, math.ceil(end - start) + 1, 2)}
        marks.update(stations)
        marks.update(s for s, _ in knots)
        for key in ('covered', 'span'):
            if key not in fields:
                continue
            lo, hi = fields[key]
            lo, hi = max(start, lo), min(end, hi)
            assert lo < hi, (id, fields)
            fields[key] = [round(lo - start, 2), round(hi - start, 2)]
            marks.update((lo, hi))

        way = roads[core]
        mode_mask = way['modes'][0] | way['modes'][1]
        marks = [start, *sorted(s for s in marks if start + 0.05 < s < end - 0.05), end]
        result = []
        for s in marks:
            x, z = point_at(points, stations, s)
            shape = [round(x, 2), round(z, 2), round(GRADE['fitting_curve'](knots, s) - terrain.nap, 3)]
            if not result or math.dist(shape[:2], result[-1][:2]) > 0.04:
                result.append(shape)
        return dict(id=id, points=result, width=width or way['width'],
                    wayIds=[key for key, a, b in spans if a - origin < end and start < b - origin],
                    modes=[mode for mask, mode in ((7, 'motor'), (8, 'bike'), (16, 'foot')) if mode_mask & mask],
                    **fields)

    def site(id, name, kind, profiles, evidence, **fields):
        return dict(id=id, name=name, kind=kind, profiles=profiles, evidence=evidence, **fields)

    oost_evidence = dict(
        bgt=['L0004.61d022ae4d604ea69d68ae896bb71c8b'], project=STATION, construction=STATION_STRUCTURE,
        heights='AHN 0.5 m open south approach and Frisopark ties. Concealed floor and soffit are estimated '
                'using the BGT footprint and the functional design near 15.8 m NAP. The upper walking route ties to '
                'the modeled BGT platform at its landing.')
    oost_lower = profile('oosttunnel-passage', [1091698001, 1507807928, 1507807929, 1410324046],
        1507807928, (-44, 172),
        [(-34, 15.82), (-15, 15.64), (0, 15.44), (11, 15.50), (57, 15.55), (76, 15.61),
         (86, 15.75), (101, 16.42), (116, 17.48), (131, 18.62), (151, 18.89), (163, 19.31)],
        width=8.5, covered=(6.5, 75.69), clearance=4.15, cutBuildings=True, surface='paving_stones')
    oost_upper = [
        profile('oosttunnel-hartogspad', [1254180468, 1363871988, 1549067719], 1363871988, (-34, 52),
                [(-20, 20.52), (-7, 20.49), (0, 20.38), (11, 20.36), (19, 20.29),
                 (32, 20.59), (42, 20.74)], span=(0, 23)),
        profile('oosttunnel-platform-walk', [1409776591, 1579339204], 1409776591, (0, 24),
                [(5, 21.99), (10, 21.86), (15, 21.86), (19, 21.91), (21, 22.15)],
                ends=(21.90, 22.36), width=3.2, span=(0, 18.4), covered=(0, 19), clearance=3.1, cutBuildings=True),
    ]

    parking_evidence = dict(operator=PARKING, entryHeightLimit=2.1,
        heights='AHN 0.5 m pre-opening exterior pavement near 18.2 m NAP. The separately mapped entrance and '
                'exit ramps and their concealed soffit are estimated using the 2.10 m posted entry limit.')
    parking_upper = profile('polar-bearsplein-surface', [1193451506], 1193451506, (69, 106),
                           [(76, 18.20), (83, 18.20), (94, 18.22)], span=(73, 90))
    parking_lower = [
        profile('polar-bearsplein-exit', [1546549244, 1546549247], 1546549244, (0, 48),
                [(9.7, 15.56), (16, 15.88), (24, 16.65), (32, 17.53), (41, 18.11)],
                ends=(15.52, None), width=3.2, covered=(0, 9.7), clearance=2.18,
                entryHeightLimit=2.1, cutBuildings=True),
        profile('polar-bearsplein-entry', [1546549245, 1546549246], 1546549246, (-39, 10),
                [(-31, 18.12), (-22, 17.55), (-14, 16.66), (-6, 15.89), (0, 15.56)],
                ends=(None, 15.52), width=3.2, covered=(0, 9.8), clearance=2.18,
                entryHeightLimit=2.1, cutBuildings=True),
    ]

    stadspoort_evidence = dict(project=STADSPOORT,
        heights='AHN 0.5 m exposed lower carriageways about 10.2 m NAP and cycle paths about 11.85 m NAP. '
                'The concealed shopping passage follows its two exterior entrances. Floor and common soffit are fitted.')
    stadspoort_upper = profile('stadspoort-walkway', [956231553, 262752271, 956231554], 262752271, (-3, 95),
        [(0, 15.78), (12, 15.88), (38, 15.91), (66, 15.91), (82, 15.65), (90, 15.34)],
        width=4.5, span=(0, 91.3), covered=(0, 91.3), clearance=3.1, cutBuildings=True, surface='paving_stones')
    stadspoort_lower = []
    for core, ids, extent, covered, near, far, approaching, departing, width, clearance in [
        (25546150, [1055722527, 25546150, 25546151], (-42, 74), (0, 35), 11.86, 11.89, 11.89, 12.01, 2.6, 3.35),
        (25546154, [6921139, 25546154, 25546152], (-49, 74), (0, 31.8), 10.16, 10.16, 10.67, 10.26, 7.7, 5.04),
        (25546157, [262752272, 25546157, 25546156], (-43, 78), (0, 32.2), 10.13, 10.17, 10.29, 10.53, 7.7, 5.05),
        (25546158, [24831845, 25546158, 25546159], (-32, 90), (16, 48.4), 11.85, 11.84, 11.84, 11.87, 2.6, 3.35),
    ]:
        lo, hi = covered
        stadspoort_lower.append(profile(f'stadspoort-{core}', ids, core, extent,
            [(extent[0] + 10, approaching), (lo - 5, near), (lo, near), (hi, far), (hi + 5, far),
             (extent[1] - 12, departing)], width=width, covered=covered, clearance=clearance, cutBuildings=True))

    parklaan_evidence = dict(bgt=['G0228.7a08be34c7c84b6eaf9bf1d382c4f3af'], engineering=PARKLAAN,
        heights='AHN 0.5 m pavement on the A12 and exposed Hoekelumselaan approaches. '
                'The enclosed roadway and soffit are fitted using the engineering cross-section (Fig. 3).')
    parklaan_lower = profile('parklaan-hoekelumselaan', [805590138, 469675200, 1304343135, 787065956],
        469675200, (-61, 125),
        [(-37, 16.01), (-21, 16.17), (-8, 16.29), (0.9, 16.22), (12, 15.47), (23, 15.12),
         (54, 14.84), (73, 14.83), (82.3, 14.86), (93, 14.68), (108, 14.55)],
        width=10.25, covered=(0.9, 82.28), clearance=4.65)
    parklaan_upper = [
        profile('parklaan-a12-eastbound', [420569803], 420569803, (477, 560),
                [(490, 19.66), (505, 19.89), (516, 20.02), (529, 20.21), (544, 20.42), (551, 20.52)], span=(502, 531)),
        profile('parklaan-a12-westbound', [509484016], 509484016, (304, 394),
                [(315, 20.74), (331, 20.53), (345, 20.31), (360, 20.14), (371, 20.02), (383, 19.83)], span=(331, 357)),
    ]

    return dict(version=1, sites=[
        site('oosttunnel-upper', 'Oosttunnel surface paths', 'bridge', oost_upper, oost_evidence),
        site('oosttunnel-lower', 'Oosttunnel passenger passage', 'underpass', [oost_lower], oost_evidence, cutCoveredTerrain=True),
        site('polar-bearsplein-parking-upper', 'Polar Bearsplein surface road', 'bridge', [parking_upper], parking_evidence),
        site('polar-bearsplein-parking-lower', 'Polar Bearsplein parking ramps', 'underpass', parking_lower,
             parking_evidence, cutCoveredTerrain=True, surfacesOnly=True),
        site('stadspoort-upper', 'Stadspoort shopping passage', 'bridge', [stadspoort_upper], stadspoort_evidence),
        site('stadspoort-lower', 'Doctor W. Dreeslaan beneath Stadspoort', 'underpass', stadspoort_lower,
             stadspoort_evidence, cutCoveredTerrain=True, surfacesOnly=True),
        site('parklaan-a12-upper', 'A12 pavement above the Parklaan', 'bridge', parklaan_upper, parklaan_evidence),
        site('parklaan-a12-lower', 'Parklaan beneath the A12', 'underpass', [parklaan_lower], parklaan_evidence, cutCoveredTerrain=True),
    ])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'tools/data/ede-interior-fits.json')
    args = parser.parse_args()
    args.output.write_text(json.dumps(build(), ensure_ascii=False, separators=(',', ':')) + '\n')
