"""Cache native 0.5 m PDOK AHN coverage for the targeted Ede elevation survey."""

import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
from statistics import median
import subprocess

import rasterio

from ede_gis import Frame
from ede_map import load_scene
from ede_raster import require_rd_raster


ROOT = Path(__file__).resolve().parents[1]
PILOT_SITES = {
    'bospoorttunnel', 'stadspoort', 'raadhuisstraat-passage',
    'albertstunnel', 'westtunnel', 'oosttunnel', 'polar-bearsplein-parking',
}
WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
RADIUS = 180


def validate(path, bounds):
    with rasterio.open(path) as raster:
        require_rd_raster(raster)
        if (raster.res != (0.5, 0.5)
                or tuple(raster.bounds) != bounds or raster.count != 1):
            raise ValueError(f'{path} must be native 0.5 m AHN in RD New covering {bounds}')


def fetch(directory, site, bounds, model):
    path = directory / f'{site}-{model}.tif'
    if path.exists():
        validate(path, bounds)
        return path
    west, south, east, north = bounds
    temporary = path.with_suffix('.part')
    params = ('service=WCS', 'request=GetCoverage', 'version=2.0.1',
              f'coverageId={model}_05m', 'format=image/tiff',
              f'subset=x({west},{east})', f'subset=y({south},{north})')
    try:
        subprocess.run(['curl', '-fsSG', '--retry', '2', '--max-time', '60', WCS,
                        *[arg for value in params for arg in ('--data-urlencode', value)],
                        '-o', str(temporary)], check=True)
        validate(temporary, bounds)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def rail_survey(directory, output):
    scene = load_scene()
    min_x, min_z, max_x, max_z = scene['meta']['bounds']
    frame = Frame(scene['meta']['lonLatAffine'])
    tiles = defaultdict(list)
    observations = {}
    for way in scene['railways']:
        if way.get('tunnel'):
            continue
        observations[way['id']] = []
        chainage = 0
        points = list(zip(way['pts'][::2], way['pts'][1::2]))
        for (ax, az), (bx, bz) in zip(points, points[1:]):
            length = math.hypot(bx - ax, bz - az)
            if length == 0:
                continue
            ux, uz = (bx - ax) / length, (bz - az) / length
            count = math.ceil(length / 5)
            for k in range(count + 1):
                at = length * k / count
                x, z = ax + ux * at, az + uz * at
                if not (min_x - 250 <= x <= max_x + 250 and min_z - 250 <= z <= max_z + 250):
                    continue
                coords = [frame.scene_to_rd(x - uz * offset, z + ux * offset)
                          for offset in (-0.6, 0, 0.6)]
                e, n = coords[1]
                model = 'dsm' if way.get('bridge') else 'dtm'
                tiles[(int(e // 512) * 512, int(n // 512) * 512, model)].append(
                    (way['id'], round(chainage + at, 3), coords))
            chainage += length

    def sample_tile(tile, rows):
        e, n, model = tile
        bounds = (e - 4, n - 4, e + 516, n + 516)
        path = fetch(directory, f'rail-{e}-{n}', bounds, model)
        with rasterio.open(path) as source:
            raster = source.read(1, masked=True).filled(float('nan'))
            for way, distance, coords in rows:
                pixels = [raster[source.index(x, y)] for x, y in coords]
                valid = [float(z) for z in pixels if math.isfinite(z) and 5 < z < 70]
                if valid:
                    yield way, distance, round(median(valid), 3)

    with ThreadPoolExecutor(max_workers=5) as workers:
        jobs = [workers.submit(lambda tile, rows: list(sample_tile(tile, rows)), tile, rows)
                for tile, rows in sorted(tiles.items())]
        for job in jobs:
            for way, distance, nap in job.result():
                observations[way].append((distance, nap))
    output.write_text(json.dumps(dict(version=1, source=WCS, ways={
        way: sorted(set(rows)) for way, rows in observations.items()
    }), separators=(',', ':')) + '\n')
    print(f'Sampled {sum(map(len, observations.values()))} AHN observations in {len(tiles)} tiles')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--rail-output', type=Path, help='Sample the rail corridors into this JSON file')
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    if args.rail_output:
        rail_survey(args.directory, args.rail_output)
        return
    catalog = json.loads((ROOT / 'tools/data/ede-crossing-sites.json').read_text())
    frame = Frame(load_scene()['meta']['lonLatAffine'])
    with ThreadPoolExecutor(max_workers=4) as workers:
        jobs = []
        for site in catalog['sites']:
            if site['id'] not in PILOT_SITES:
                continue
            x, z = site['center']
            east, north = map(round, frame.scene_to_rd(x, z))
            bounds = (east - RADIUS, north - RADIUS, east + RADIUS, north + RADIUS)
            for model in ('dtm', 'dsm'):
                jobs.append(workers.submit(fetch, args.directory, site['id'], bounds, model))
        for job in jobs:
            print(job.result())


if __name__ == '__main__':
    main()
