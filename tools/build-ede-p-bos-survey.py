#!/usr/bin/env python3
"""Bake the P. Bos factory shell and its measured exterior tanks."""

import argparse
import gzip
import json
from pathlib import Path
from runpy import run_path
from statistics import median
from urllib.parse import urlencode
from urllib.request import urlopen

import rasterio
from rasterio.features import geometry_mask
from shapely.geometry import shape

from ede_gis import Frame
from ede_raster import require_rd_raster
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
BAKE = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))['bake']
BAG_ID = '0228100000020797'
BAG_API = 'https://api.3dbag.nl/collections/pand/items'
BGT_API = 'https://api.pdok.nl/lv/bgt/ogc/v1/collections/overigbouwwerk/items'
AHN_WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
RD_CRS = 'http://www.opengis.net/def/crs/EPSG/0/28992'
# The BGT request explicitly uses RD New for the bounds and the response.
SURVEY_BOUNDS = (168045, 452510, 168116, 452569)
TANK_IDS = (
    'G0228.786f4b469c604188811c8cb3598e4082',
    'G0228.8c2ebbfaa7a34d86bba6bd94fc7df2a7',
    'G0228.d092d83d5b674932b58d7d8588f17d1f',
    'G0228.f7e7ed1d856a44149b5d3dd491880f25',
)


def pack(value):
    return json.dumps(value, separators=(',', ':'))


def fetch_sources(cache):
    cache.mkdir(parents=True, exist_ok=True)
    requests = [
        ('collection.json', BAG_API, {'bbox': '167972,452454,168151,452600', 'limit': 100}),
        ('bgt.json', BGT_API, {
            'bbox': ','.join(map(str, SURVEY_BOUNDS)), 'bbox-crs': RD_CRS, 'crs': RD_CRS, 'limit': 100,
        }),
        *((f'{model}.tif', AHN_WCS, {
            'service': 'WCS', 'version': '2.0.1', 'request': 'GetCoverage',
            'coverageId': f'{model}_05m', 'format': 'image/tiff',
            'subset': ['x(168018,168147)', 'y(452484,452570)'],
        }) for model in ('dtm', 'dsm')),
    ]
    for filename, url, params in requests:
        path = cache / filename
        if path.exists():
            continue
        with urlopen(f'{url}?{urlencode(params, doseq=True)}', timeout=45) as response:
            if filename == 'bgt.json' and response.headers.get('Content-Crs') != f'<{RD_CRS}>':
                raise ValueError('The BGT response did not declare the requested RD New CRS')
            contents = response.read()
        path.write_bytes(contents)


def controls(frame, cache):
    bgt = json.loads((cache / 'bgt.json').read_text())
    tanks = []
    with rasterio.open(cache / 'dtm.tif') as ground, rasterio.open(cache / 'dsm.tif') as surface:
        for raster in (ground, surface):
            require_rd_raster(raster)
            if raster.res != (0.5, 0.5):
                raise ValueError('P. Bos requires the native 0.5 m AHN survey')
        if ground.transform != surface.transform or ground.shape != surface.shape:
            raise ValueError('P. Bos AHN ground and surface grids are misaligned')
        terrain, roofs = (r.read(1, masked=True) for r in (ground, surface))
        records = {feature['properties']['lokaal_id']: feature for feature in bgt['features']
                   if feature['properties']['type'] == 'opslagtank' and feature['properties']['status'] == 'bestaand'}
        for tank_id in TANK_IDS:
            feature = records[tank_id]
            outline = shape(feature['geometry'])
            west, south, east, north = outline.bounds
            if not (SURVEY_BOUNDS[0] <= west < east <= SURVEY_BOUNDS[2]
                    and SURVEY_BOUNDS[1] <= south < north <= SURVEY_BOUNDS[3]):
                raise ValueError(f'Unexpected RD New coordinates for {tank_id}')
            x, z = frame.rd_to_scene(*outline.centroid.coords[0])
            core = geometry_mask([outline.buffer(-0.25)], out_shape=surface.shape,
                                 transform=surface.transform, invert=True)
            surroundings = geometry_mask([outline.buffer(1.2)], out_shape=ground.shape,
                                         transform=ground.transform, invert=True) & ~core
            tops = [float(y) for y in roofs[core].compressed() if 8 <= y < 30]
            bases = [float(y) for y in terrain[surroundings].compressed() if 5 <= y < 10]
            if len(tops) < 4 or len(bases) < 4:
                raise ValueError(f'Not enough usable AHN tank samples for {tank_id}')
            lower, upper = median(bases), median(tops)
            tanks.append([round(x, 2), round(z, 2), round((east - west + north - south) / 4, 2),
                          round(lower - SCENE_NAP_ORIGIN, 2), round(upper - SCENE_NAP_ORIGIN, 2)])
        stacks = []
        # High AHN returns corroborate both exhaust shafts in the drone photograph.
        for e, n, bottom, radius in [(168077.75, 452527.75, 34.45, 0.37),
                                     (168079.25, 452521.75, 36.96, 0.31)]:
            top = float(next(surface.sample([(e, n)], masked=True))[0])
            if not bottom + 3 < top < 50:
                raise ValueError('AHN did not resolve a photographed mill exhaust shaft')
            x, z = frame.rd_to_scene(e, n)
            stacks.append([round(x, 2), round(z, 2), radius,
                           round(bottom - SCENE_NAP_ORIGIN, 2), round(top - SCENE_NAP_ORIGIN, 2)])
    return tanks, stacks


def render(cache, frame):
    source = json.loads((cache / 'collection.json').read_text())
    reference = source['metadata']['metadata']['referenceSystem']
    if not reference.endswith('/7415'):
        raise ValueError(f'Unexpected factory survey CRS {reference}')
    base, outline, points, faces = BAKE(source, BAG_ID, frame, SCENE_NAP_ORIGIN)
    min_x, max_x = min(p[0] for p in points), max(p[0] for p in points)
    min_z, max_z = min(p[2] for p in points), max(p[2] for p in points)
    x, z = frame.rd_to_scene(168079, 452526)
    if not min_x < x < max_x or not min_z < z < max_z:
        raise ValueError('The independently identified factory control point misses the shell')
    tanks, stacks = controls(frame, cache)
    xx, zz = frame.rd_to_scene(168067, 452500)
    # Measured shell orientation. The recent silo bank uses a fit to the 2026 contractor drone photograph.
    bank_start = frame.rd_to_scene(168090.55, 452518.95)
    bank_end = frame.rd_to_scene(168103.25, 452518.40)
    sign_start = frame.rd_to_scene(168080.18, 452523.73)
    sign_end = frame.rd_to_scene(168089.23, 452523.15)
    equipment = {'tanks': tanks, 'stacks': stacks,
                 'bank': [[round(v, 2) for v in p] for p in (bank_start, bank_end)],
                 'sign': [[round(v, 2) for v in p] for p in (sign_start, sign_end)]}
    height = round(max(y for _, _, _, _, y in stacks) - base, 2)
    lines = [
        '// 3DBAG LoD 2.2 and AHN 0.5 m measurements in Oude Kerk scene metres.',
        '// © 3DBAG by tudelft3d and 3DGI, adapted under CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
        '// Rebuild with tools/build-ede-p-bos-survey.py.',
        'export const P_BOS_SHELL = {',
        f"  bagId: '{BAG_ID}', osmId: 'w267691593', ground: {base}, wallColor: 0xe4e1d5, roofColor: 0x51585a,",
        f'  outline: {pack(outline)},',
    ]
    for field, values in [('points', points), ('faces', faces)]:
        lines.append(f'  {field}: [')
        lines.extend('    ' + ', '.join(map(pack, values[i:i + 5])) + ',' for i in range(0, len(values), 5))
        lines.append('  ],')
    lines += ['};', '',
              f'export const P_BOS_EQUIPMENT = {pack(equipment)};', '',
              'const [outer, ...holes] = P_BOS_SHELL.outline.map(ring => ring.map(([x, z]) => ({ x, z })));',
              'export const EDE_P_BOS_LANDMARKS = [{',
              "  id: 'p-bos-veevoeders', name: 'P. Bos Veevoeders', district: 'Ederveen', road: 'Hoofdweg',",
              f'  x: {x:.2f}, z: {z:.2f}, height: {height}, focusHeight: 12, worldSpace: true, mapScenic: true,',
              f'  approach: {{ x: {xx:.2f}, z: {zz:.2f} }},',
              '  bagIds: [P_BOS_SHELL.bagId], osmId: P_BOS_SHELL.osmId, surveyFootprints: [{ outer, holes }],',
              '}];', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Cached collection.json, bgt.json, dtm.tif and dsm.tif inputs')
    parser.add_argument('--fetch', action='store_true', help='Fetch missing public source snapshots')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.fetch:
        fetch_sources(args.cache)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as map_file:
        frame = Frame(json.load(map_file)['meta']['lonLatAffine'])
    output = render(args.cache, frame)
    destination = ROOT / 'js/ede-p-bos-survey.js'
    if args.check:
        if destination.read_text() != output:
            raise SystemExit(f'{destination} differs from the survey bake')
    else:
        destination.write_text(output)


if __name__ == '__main__':
    main()
