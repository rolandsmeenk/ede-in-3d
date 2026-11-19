"""Fit a local exposed travel surface from signed 0.5 m AHN ground residuals."""

import argparse
import json
import math
from pathlib import Path
import runpy
from statistics import median

from pyproj import Transformer
import rasterio
from shapely.geometry import LineString

from ede_map import load_scene


ROOT = Path(__file__).resolve().parents[1]
Terrain = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))['Terrain']
WAY = 'w652044681'
ADJOINING_ROAD = 'w1546917694'
# Tie into level ground before the edge of w1257245293 at the path crossing.
FROM, TO = 18, 29
TOLERANCE = 0.025


def fewest_knots(samples):
    """Choose the shortest height polyline within the residual error tolerance."""
    paths = [[0]]
    for right in range(1, len(samples)):
        end, y_end = samples[right]
        choices = []
        for left, path in enumerate(paths):
            start, y_start = samples[left]
            slope = (y_end - y_start) / (end - start)
            if all(abs(y_start + slope * (s - start) - y) <= TOLERANCE
                   for s, y in samples[left + 1:right]):
                choices.append(path)
        paths.append(min(choices, key=lambda path: (len(path), path)) + [right])
    return paths[-1]


def build(directory):
    scene = load_scene()
    frame = scene['meta']['lonLatAffine']
    road = next(road for road in scene['roads'] if road['id'] == WAY)
    axis = LineString(zip(road['pts'][::2], road['pts'][1::2]))
    project = Transformer.from_crs(4326, 28992, always_xy=True)
    terrain = Terrain()
    samples = []
    with (rasterio.open(directory / 'oosttunnel-dtm.tif') as dtm,
          rasterio.open(directory / 'oosttunnel-dsm.tif') as dsm):
        for raster in (dtm, dsm):
            if raster.crs.to_epsg() != 28992 or raster.res != (0.5, 0.5):
                raise ValueError('Expected a native AHN 0.5 m raster in RD New')
        for station in range(FROM, TO + 1):
            point = axis.interpolate(station)
            a, b = axis.interpolate(station - 0.5), axis.interpolate(station + 0.5)
            nx, nz = a.y - b.y, b.x - a.x
            q = math.hypot(nx, nz)
            xy = [project.transform(frame['lon0'] + (point.x + offset * nx / q) / frame['x'][1],
                                    frame['lat0'] + (point.y + offset * nz / q) / frame['z'][2])
                  for offset in (-1.5, -1, -0.5, 0, 0.5, 1, 1.5)]
            ground = [float(y[0]) for y in dtm.sample(xy)]
            surface = [float(y[0]) for y in dsm.sample(xy)]
            exposed = [y for y, top in zip(ground, surface) if 0 < y < 50 and abs(top - y) <= 0.3]
            if len(exposed) < 3:
                raise ValueError(f'Insufficient exposed AHN samples at {WAY} station {station}')
            samples.append(median(exposed) - terrain.at(point.coords[0]))

    observations = []
    for i, _ in enumerate(samples):
        smooth = median(samples[max(0, i - 1):i + 2])
        # Tie into the original travel and shoulder surface at both ends.
        t = min(1.0, i / 6, (len(samples) - 1 - i) / 6)
        observations.append((FROM + i, max(0, smooth) * t * t * (3 - 2 * t)))
    knots = fewest_knots(observations)
    points = []
    for i in knots:
        station, lift = observations[i]
        x, z = axis.interpolate(station).coords[0]
        points.append([round(x, 4), round(z, 4), round(lift, 3)])
    residual = []
    for i, old in enumerate(samples):
        for j, (a, b) in enumerate(zip(knots, knots[1:])):
            if a <= i <= b:
                lift = points[j][2] + (points[j + 1][2] - points[j][2]) * (i - a) / (b - a)
                residual.append(abs(old - lift))
                break
    return {'version': 1, 'source': 'PDOK AHN DTM and DSM 0.5 m, EPSG:28992, NAP',
            'sites': [{'id': 'ede-station-east-footway', 'kind': 'surface', 'profiles': [{
                'id': 'ede-station-east-footway', 'wayIds': [WAY, ADJOINING_ROAD], 'width': 2.4, 'shoulder': 0.7,
                'modes': ['foot', 'bike', 'motor'], 'points': points,
            }]}]}, [round(median(map(abs, samples)), 3), round(median(residual), 3), max(p[2] for p in points)]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, help='Native AHN survey cache with the Oosttunnel raster pair')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-ahn-surfaces.json')
    args = parser.parse_args()
    asset, summary = build(args.directory)
    args.output.write_text(json.dumps(asset, separators=(',', ':')) + '\n')
    print('Median absolute error before/after and peak correction (m)', *summary)
