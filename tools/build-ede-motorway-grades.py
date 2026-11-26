#!/usr/bin/env python3
"""Bake motorway crossing pavement and approaches from the native AHN survey."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import math
from pathlib import Path
from statistics import median

import numpy as np
import rasterio

from ede_gis import Frame
from ede_map import load_playable_scene
from ede_raster import require_rd_raster
from ede_rail_profiles import point_on_line, station_at, stations_of
from ede_scene import SCENE_NAP_ORIGIN as DATUM


ROOT = Path(__file__).resolve().parents[1]
MOTOR = ['motor']
ACTIVE = ['bike', 'foot']
SURVEY_BOUNDS = {
    'maanderbroek': (-4320, 1860, -3696, 2712),
    'a12-ede-east': (-540, 3468, 324, 3864),
    'a12-wageningen': (744, 3540, 1428, 3876),
    'a12-oud-reemst': (2800, 2450, 3750, 3050),
    'a12-ginkel': (4820, 2400, 5310, 2970),
    'a12-planken-wambuis': (6420, 2460, 7780, 2910),
    'a12-rondweg-oost': (-6390, 725, -5910, 1200),
    'a12-verlengde-arnhemseweg': (8550, 2290, 9240, 2890),
    'a30-galvanistraat': (-3936, 1056, -3720, 1476),
    'a30-lunteren': (-5060, -3580, -4515, -3070),
    'a30-postweg': (-5430, -4860, -4880, -4340),
    'a30-a1': (-7475, -8780, -7030, -8230),
}


def fetch_surveys(cache):
    fetch = import_module('fetch-ede-ahn-survey').fetch
    frame = Frame(load_playable_scene()['meta']['lonLatAffine'])
    cache.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=5) as workers:
        jobs = []
        for name, (x0, z0, x1, z1) in SURVEY_BOUNDS.items():
            east, north = zip(*(frame.scene_to_rd(x, z) for x in (x0, x1) for z in (z0, z1)))
            bounds = (int(min(east)) - 6, int(min(north)) - 6, int(max(east)) + 8, int(max(north)) + 8)
            jobs.extend(workers.submit(fetch, cache, name, bounds, band) for band in ('dtm', 'dsm'))
        for job in jobs:
            print(job.result())



class Survey:
    def __init__(self, directory, name, frame):
        self.frame = frame
        self.bands = {}
        for model in ('dtm', 'dsm'):
            with rasterio.open(directory / f'{name}-{model}.tif') as raster:
                require_rd_raster(raster)
                if raster.res != (0.5, 0.5):
                    raise ValueError(f'{name} needs native 0.5 m AHN')
                self.bands[model] = (raster.read(1, masked=True).filled(np.nan), ~raster.transform)

    def sample(self, model, x, z):
        pixels, inverse = self.bands[model]
        col, row = inverse @ self.frame.scene_to_rd(x, z)
        i, j = math.floor(row), math.floor(col)
        if 0 <= i < pixels.shape[0] and 0 <= j < pixels.shape[1]:
            return float(pixels[i, j])
        return math.nan


class Baker:
    def __init__(self, directory):
        scene = load_playable_scene()
        self.roads = {road['id']: road for road in scene['roads']}
        self.frame = Frame(scene['meta']['lonLatAffine'])
        self.directory = directory
        self.surveys = {}

    def path(self, ids):
        points, ranges = [], {}
        for id in ids:
            coords = self.roads[id]['pts']
            way = list(zip(coords[::2], coords[1::2]))
            if points and math.dist(points[-1], way[0]) > 0.2:
                raise ValueError(f'Disconnected approach before {id}')
            ranges[id] = (max(0, len(points) - 1), len(points) + len(way) - 1 - bool(points))
            points.extend(way[bool(points):])
        stations = stations_of(points)
        return points, stations, {id: (stations[a], stations[b]) for id, (a, b) in ranges.items()}

    def fit(self, source, id, ids, *, structure=None, anchor=None, window=None, core=None,
            kind='bridge', floor=None, portal=None, blend=24, width=None, modes=MOTOR, clearance=None):
        points, stations, ranges = self.path(ids)
        if structure:
            span = ranges[structure]
        else:
            middle = station_at(points, stations, anchor)
            span = (middle - core, middle + core)
        if window:
            start, end = window
        else:
            start, end = max(0, span[0] - 48), min(stations[-1], span[1] + 48)
        if not (0 <= start <= span[0] <= span[1] <= end <= stations[-1] + .001):
            raise ValueError(f'Invalid crossing extent for {id}')

        road = self.roads[structure or ids[0]]
        width = width or road.get('bgtWidth') or road['width']
        if source not in self.surveys:
            self.surveys[source] = Survey(self.directory, source, self.frame)
        survey = self.surveys[source]
        def observed(model, at):
            x, z = point_on_line(points, stations, at)
            a = point_on_line(points, stations, max(0, at - 1))
            b = point_on_line(points, stations, min(stations[-1], at + 1))
            length = math.dist(a, b)
            nx, nz = (a[1] - b[1]) / length, (b[0] - a[0]) / length
            side = width * .24
            values = [survey.sample(model, x + nx * side * k, z + nz * side * k) for k in (-1., -.5, 0., .5, 1.)]
            valid = [v for v in values if 0 < v < 65]
            return median(valid) if len(valid) >= 3 else math.nan

        chain = np.linspace(start, end, math.ceil((end - start) / 4) + 1)
        levels = []
        for at in chain:
            base = observed('dtm', at)
            if kind == 'underpass' and span[0] - 4 <= at <= span[1] + 4:
                value = float(np.interp(at, span, portal))
            elif kind != 'underpass' and span[0] - 2 <= at <= span[1] + 2:
                top = observed('dsm', at)
                guess = float(np.interp(at, span, floor))
                value = top if abs(top - guess) < .4 else guess
            elif kind == 'bridge' and abs(at - min(max(at, span[0]), span[1])) < 18:
                top = observed('dsm', at)
                value = top if abs(top - floor[int(at > span[1])]) < 1.2 else base
            else:
                value = base
            levels.append(value)
        valid = np.isfinite(levels)
        if valid.sum() < max(5, len(chain) * .65):
            raise ValueError(f'Insufficient height observations for {id}')
        values = np.interp(chain, chain[valid], np.asarray(levels)[valid])
        # A median window removes isolated vehicle, overhead and raster-edge returns.
        # Keep the surveyed linear trend in the bundle rather than flattening embankments.
        trend = []
        for i, value in enumerate(values):
            local = values[max(0, i - 2):i + 3]
            filtered = median(local) if 1 < i < len(values) - 2 else value
            trend.append(filtered if abs(value - filtered) > .12 else value)
        marks = sorted({start, end, *span, *chain, *[at for at in stations if start < at < end]})
        dense = [marks[0]]
        for at in marks[1:-1]:
            if at - dense[-1] > .08 and end - at > .08:
                dense.append(at)
        dense.append(end)
        shaped = []
        for at in dense:
            x, z = point_on_line(points, stations, at)
            y = float(np.interp(at, chain, trend))
            shaped.append([round(x, 2), round(z, 2), round(y - DATUM, 3)])
        result = dict(id=id, width=width, points=shaped, modes=modes,
                      wayIds=[id for id in ids if ranges[id][0] < end and ranges[id][1] > start],
                      approachBlend=[min(blend, span[0] - start), min(blend, end - span[1])],
                      surface=road.get('surface') or 'asphalt')
        if kind == 'bridge':
            result.update(span=[round(at - start, 2) for at in span], fillApproaches=True, replaceGround=True)
        elif kind == 'underpass':
            result.update(covered=[round(at - start, 2) for at in span], clearance=clearance)
        return result


def build(directory):
    baker = Baker(directory)
    base = json.loads((ROOT / 'assets/ede-grade.json').read_text())
    sites, replacements = [], []
    for site in base['sites']:
        if site['id'] not in {'parklaan-a12-upper', 'galvanistraat-a30-upper',
                              'statenpad-a12-upper', 'bovenbuurtweg-a12-upper', 'n224-a30-upper', 'a30-rail-bridge',
                              'frankeneng-west-passage-upper'}:
            continue
        for entry in site['profiles']:
            if 'motor' not in entry['modes']:
                continue
            replacements.append(dict(entry, approachBlend=[14, 14], surface='asphalt'))

    for id, structure, ids, floor in [
        ('maanderbroek-a30-a12-upper-w6960104', 'w6960104', ['w6960101', 'w6960104', 'w6960067'], (15.1, 15.12)),
        ('maanderbroek-link-upper-w6960110', 'w6960110', ['w636835435', 'w6960110', 'w663875342'], (14.85, 15.11)),
    ]:
        replacements.append(baker.fit('maanderbroek', id, ids, structure=structure, floor=floor, blend=30))

    for id, way, ids, floor in [
        ('edeseweg-a12-upper-w6920863', 'w6920863', ['w6919291', 'w6920863', 'w509484016'], (23.22, 23.22)),
        ('edeseweg-a12-upper-w6920865', 'w6920865', ['w1085149040', 'w6920865', 'w6919294'], (23.23, 23.23)),
    ]:
        replacements.append(baker.fit('a12-ede-east', id, ids, structure=way, floor=floor))

    for way, floor in [('w6919291', (29.03, 28.65)), ('w6919294', (28.62, 29.02))]:
        replacements.append(baker.fit('a12-wageningen', f'baron-van-wassenaertunnel-upper-{way}', [way],
                                      anchor=(1074, 3716), core=12, floor=floor))

    def site(id, name, kind, profiles, **fields):
        sites.append(dict(id=id, name=name, kind=kind, profiles=profiles, expandedTerrainCut=True, **fields))

    for source, id, name, pairs in [
        ('a12-oud-reemst', 'a12-spoorviaduct', 'A12 Spoorviaduct', [
            ('w6952602', ['w259328716', 'w6952602', 'w6919291'], (38.18, 38.16)),
            ('w6952603', ['w6919294', 'w6952603', 'w6850995'], (38.30, 38.30)),
        ]),
        ('a30-lunteren', 'a30-klomperweg', 'A30 Klomperweg', [
            ('w6960734', ['w1092220133', 'w6960734', 'w509686214'], (16.09, 16.10)),
            ('w6960735', ['w941873172', 'w6960735', 'w6960738'], (16.11, 16.10)),
        ]),
        ('a30-postweg', 'a30-postweg', 'A30 Postweg', [
            ('w6960743', ['w372270143', 'w6960743', 'w1092220136'], (16.45, 16.48)),
            ('w6960744', ['w321166474', 'w6960744', 'w1092220134'], (16.39, 16.37)),
        ]),
        ('a12-rondweg-oost', 'rondweg-oost', 'Rondweg-Oost above A12', [
            ('w28880318', ['w565075030', 'w28880318', 'w961106506'], (13.53, 13.48)),
            ('w28880316', ['w28880312', 'w28880316', 'w28880317'], (13.47, 13.54)),
            ('w44507520', ['w157551043', 'w44507520', 'w44507513'], (13.38, 13.37)),
        ]),
        ('a12-verlengde-arnhemseweg', 'verlengde-arnhemseweg', 'Verlengde Arnhemseweg above A12', [
            ('w6850943', ['w6850940', 'w6850943', 'w6850944'], (39.57, 38.75)),
            ('w761070436', ['w761070431', 'w761070436', 'w761070437'], (38.70, 39.50)),
        ]),
        ('a30-a1', 'a30-north-viaduct', 'A30 Scherpenzeelseweg', [
            ('w6959313', ['w365868352', 'w1092220606', 'w6959313', 'w1092220608'], (14.59, 14.60)),
            ('w1092220607', ['w6958691', 'w1092220607', 'w1092220605'], (14.64, 14.64)),
        ]),
    ]:
        profiles = [baker.fit(source, f'{id}-{way}', ids, structure=way, floor=floor,
                              modes=ACTIVE if baker.roads[way]['kind'] == 'cycleway' else MOTOR) for way, ids, floor in pairs]
        site(id, name, 'bridge', profiles)

    for source, id, name, location, pairs, lower in [
        ('a12-oud-reemst', 'renkumseweg', 'Renkumseweg', (3534, 2670),
         [(['w6850995'], (31.58, 31.14)), (['w259328716'], (31.56, 31.94))],
         (['w113010278', 'w25996359', 'w25996358'], 'w25996359', (26.29, 26.32), 3, ACTIVE)),
        ('a12-ginkel', 'wijde-veldweg', 'Wijde Veldweg', (5110, 2726),
         [(['w6850995', 'w509484013'], (25.37, 25.37)), (['w259328716'], (25.34, 25.34))],
         (['w170337149', 'w25099286', 'w25099285'], 'w25099286', (20.90, 20.83), 2.9, ACTIVE)),
        ('a12-planken-wambuis', 'buunderkamp', 'De Buunderkamp', (6793, 2689),
         [(['w509484014'], (30.95, 31.15)), (['w829732188'], (31.18, 30.94))],
         (['w1149740684', 'w163474477', 'w1149740675'], 'w163474477', (26.9, 26.9), 2.9, MOTOR + ACTIVE)),
    ]:
        profiles = [baker.fit(source, f'a12-{id}-{ways[0]}', ways, anchor=location, core=15,
                              kind='level', floor=floor) for ways, floor in pairs]
        site(f'a12-{id}-upper', f'A12 above {name}', 'level', profiles)
        ways, way, levels, clearance, modes = lower
        site(f'a12-{id}-lower', f'{name} below A12', 'underpass', [
            baker.fit(source, f'a12-{id}-{way}', ways, structure=way, kind='underpass',
                      portal=levels, clearance=clearance, modes=modes)
        ])

    for source, id, name, profiles in [
        ('a12-rondweg-oost', 'a12-rondweg-oost', 'A12 below Rondweg-Oost', [
            (['w509484018', 'w509484019'], (-6149, 970), 18, (7.41, 7.35), MOTOR, 5.2),
            (['w509484020'], (-6154, 985), 18, (7.36, 7.36), MOTOR, 5.2),
        ]),
        ('a12-verlengde-arnhemseweg', 'a12-verlengde-arnhemseweg', 'A12 below Verlengde Arnhemseweg', [
            (['w491674572'], (8889, 2593), 17, (32.76, 32.73), MOTOR, 5.15),
            (['w491674573'], (8900, 2607), 17, (32.99, 33.00), MOTOR, 5.15),
        ]),
        ('a30-lunteren', 'a30-klomperweg-lower', 'Klomperweg below A30', [
            (['w6960682', 'w6960714'], (-4802, -3312.5), 17, (10.52, 10.64), MOTOR + ACTIVE, 4.85),
        ]),
        ('a30-postweg', 'a30-postweg-lower', 'Postweg below A30', [
            (['w6960646', 'w1333472365'], (-5159, -4625.5), 17, (10.9, 10.94), MOTOR, 4.75),
            (['w1444551335'], (-5160, -4642), 17, (10.67, 10.64), ACTIVE, 5.0),
            (['w1444719101'], (-5159, -4611), 17, (10.63, 10.68), ACTIVE, 5.0),
        ]),
        ('a30-a1', 'a30-scherpenzeelseweg-lower', 'Scherpenzeelseweg below A30', [
            (['w6959311', 'w6959308', 'w973577111'], (-7242, -8491), 21, (8.93, 8.99), MOTOR, 4.85),
        ]),
    ]:
        entries = [baker.fit(source, f'{id}-{ways[0]}', ways, anchor=anchor, core=core, kind='underpass',
                             portal=portal, modes=modes, clearance=clearance)
                   for ways, anchor, core, portal, modes, clearance in profiles]
        site(id, name, 'underpass', entries, surfacesOnly=True, cutCoveredTerrain=True)

    site('a12-planken-wambuis-ecoduct', 'A12 beneath the Planken Wambuis ecoduct', 'underpass', [
        baker.fit('a12-planken-wambuis', f'a12-ecoduct-{way}', ways, structure=way,
                  kind='underpass', portal=levels, clearance=5.2)
        for way, ways, levels in [
            ('w829732185', ['w509484014', 'w829732185', 'w829732186'], (32.38, 32.37)),
            ('w829732187', ['w177925552', 'w829732187', 'w829732188'], (32.36, 32.39)),
        ]
    ], cutCoveredTerrain=True)
    fixed = {entry['id'] for entry in replacements}
    for site in base['sites']:
        for entry in site['profiles']:
            motorway = any(baker.roads.get(way, {}).get('kind') in {'motorway', 'motorway_link'}
                           for way in entry['wayIds'])
            if motorway and entry['id'] not in fixed and 'motor' in entry['modes']:
                replacements.append(dict(entry, surface='asphalt'))
    return dict(version=1, datumNAP=DATUM, survey='PDOK AHN DTM/DSM 0.5 m and Rijkswaterstaat 1GIS',
                profiles=replacements, sites=sites)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('survey_cache', type=Path, help='Directory with the named native 0.5 m DTM and DSM tiles')
    parser.add_argument('--fetch', action='store_true', help='Fill the cache from PDOK')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-motorway-grades.json')
    args = parser.parse_args()
    if args.fetch:
        fetch_surveys(args.survey_cache)
    result = build(args.survey_cache)
    args.output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    print(f"Refit {len(result['profiles'])} existing profiles and baked {len(result['sites'])} crossings")


if __name__ == '__main__':
    main()
