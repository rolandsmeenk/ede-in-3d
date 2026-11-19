"""Cache native 0.5 m PDOK AHN coverage for the targeted Ede elevation survey."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess

from pyproj import Transformer
import rasterio

from ede_map import load_scene


ROOT = Path(__file__).resolve().parents[1]
PILOT_SITES = {
    'bospoorttunnel', 'stadspoort', 'raadhuisstraat-passage',
    'albertstunnel', 'westtunnel', 'oosttunnel', 'polar-bearsplein-parking',
}
WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
RADIUS = 180


def validate(path, bounds):
    with rasterio.open(path) as raster:
        if (raster.crs.to_epsg() != 28992 or raster.res != (0.5, 0.5)
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / 'tools/data/ede-crossing-sites.json').read_text())
    affine = load_scene()['meta']['lonLatAffine']
    rd = Transformer.from_crs(4326, 28992, always_xy=True)
    with ThreadPoolExecutor(max_workers=4) as workers:
        jobs = []
        for site in catalog['sites']:
            if site['id'] not in PILOT_SITES:
                continue
            x, z = site['center']
            east, north = map(round, rd.transform(affine['lon0'] + x / affine['x'][1],
                                                  affine['lat0'] + z / affine['z'][2]))
            bounds = (east - RADIUS, north - RADIUS, east + RADIUS, north + RADIUS)
            for model in ('dtm', 'dsm'):
                jobs.append(workers.submit(fetch, args.directory, site['id'], bounds, model))
        for job in jobs:
            print(job.result())


if __name__ == '__main__':
    main()
