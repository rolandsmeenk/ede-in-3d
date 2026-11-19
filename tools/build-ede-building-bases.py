"""Fit the pilot building bases against exterior 0.5 m AHN samples."""

import argparse
from contextlib import ExitStack
from importlib import import_module
import json
import math
from pathlib import Path
from statistics import median, quantiles

from pyproj import Transformer
import rasterio
from shapely import Polygon, STRtree, transform
from shapely.geometry import shape

from ede_map import load_scene


ROOT = Path(__file__).resolve().parents[1]
Terrain = import_module('build-ede-grade').Terrain
PILOT = (
    ('bospoorttunnel', 'w271586543', '0228100000073270', 't/7/608/480.glb'),
)


def ring(points):
    return list(zip(points[::2], points[1::2]))


def surveyed_ring(footprint, neighbours, offset, dtm, dsm, project):
    outline = footprint.buffer(offset).exterior
    points = [outline.interpolate(s) for s in range(math.floor(outline.length))]
    points = [point for point in points if all(p.distance(point) >= .35 for p in neighbours)]
    coords = [project(point.x, point.y) for point in points]
    heights = []
    for ground, top in zip(dtm.sample(coords, masked=True), dsm.sample(coords, masked=True)):
        if ground.mask[0] or top.mask[0]:
            continue
        ground, top = float(ground[0]), float(top[0])
        if -2 < ground < 95 and -.15 <= top - ground <= .45:
            heights.append(ground)
    if len(heights) < 12:
        raise ValueError('Insufficient exterior ground samples')
    limits = quantiles(heights, n=10, method='inclusive')
    return median(heights), limits[8] - limits[0], len(heights)


def build(survey_dir, bag_dir):
    scene = load_scene()
    frame = scene['meta']['lonLatAffine']
    lon0, lat0, x_scale, z_scale = frame['lon0'], frame['lat0'], frame['x'][1], frame['z'][2]
    to_rd = Transformer.from_crs(4326, 28992, always_xy=True)
    to_local = lambda lon, lat: ((lon - lon0) * x_scale, (lat - lat0) * z_scale)
    to_raster = lambda x, z: to_rd.transform(lon0 + x / x_scale, lat0 + z / z_scale)
    terrain = Terrain()
    buildings = [b for b in scene['buildings'] if len(b.get('ring', [])) >= 6]
    indices = {b['id']: i for i, b in enumerate(buildings)}
    footprints = [Polygon(ring(b['ring']), [ring(h) for h in b.get('holes', [])]).buffer(0) for b in buildings]
    index = STRtree(footprints)
    output = []
    for site, osm_id, bag_id, tile in PILOT:
        i = indices[osm_id]
        record, footprint = buildings[i], footprints[i]
        neighbours = [footprints[j] for j in index.query(footprint.buffer(2.5)) if i != j]
        if footprint.geom_type != 'Polygon' or footprint.interiors or record.get('part') or record.get('minHeight'):
            raise ValueError(f'{osm_id} needs one complete simple footprint')
        if any(other.distance(footprint) < .7 for other in neighbours):
            raise ValueError(f'{osm_id} is attached to another building or part')
        source = json.loads((bag_dir / f'{site}-bag.geojson').read_text())
        features = source['features'] if source.get('type') == 'FeatureCollection' else [source]
        matches = [f for f in features if f['properties']['identificatie'] == bag_id]
        if len(matches) != 1 or matches[0]['properties']['status'] != 'Pand in gebruik':
            raise ValueError(f'{bag_id} missing or inactive in BAG')
        bag = transform(shape(matches[0]['geometry']), to_local, interleaved=False).buffer(0)
        overlap = bag.intersection(footprint).area / bag.union(footprint).area
        if overlap < .95:
            raise ValueError(f'Ambiguous OSM/BAG footprint match {osm_id} / {bag_id}: {overlap:.3f}')

        with ExitStack() as stack:
            dtm, dsm = (stack.enter_context(rasterio.open(survey_dir / f'{site}-{kind}.tif')) for kind in ('dtm', 'dsm'))
            if any(r.crs.to_epsg() != 28992 or r.res != (.5, .5) for r in (dtm, dsm)) or dtm.transform != dsm.transform:
                raise ValueError(f'{site} needs co-registered native RD New 0.5 m DTM and DSM')
            inner, outer = (surveyed_ring(footprint, neighbours, offset, dtm, dsm, to_raster) for offset in (.8, 1.35))
        if max(inner[1], outer[1]) > .28 or abs(inner[0] - outer[0]) > .08:
            raise ValueError(f'Exterior ground is too variable for one building base at {osm_id}: {inner}, {outer}')

        x0, z0, x1, z1 = footprint.bounds
        old = terrain.at(((x0 + x1) / 2, (z0 + z1) / 2))
        base_nap = round((inner[0] + outer[0]) / 2, 2)
        wall = footprint.exterior
        coarse_wall_heights = [terrain.at(wall.interpolate(s).coords[0]) for s in range(math.floor(wall.length))]
        if abs(base_nap - old) < .08 or base_nap > min(coarse_wall_heights) + .14 or base_nap < max(coarse_wall_heights) - .24:
            raise ValueError(f'{osm_id} cannot improve the base while meeting the coarse terrain seam')
        output.append(dict(osmId=osm_id, bagId=bag_id, tile=tile, y=round(base_nap - terrain.nap, 2)))
        print(f'{site} {osm_id}/{bag_id}: {old:.2f} → {base_nap:.2f} m NAP ({base_nap-old:+.2f} m) '
              f'overlap={overlap:.3f}; samples/spread={inner[2]}/{inner[1]:.2f} and {outer[2]}/{outer[1]:.2f} m; '
              f'coarse perimeter={min(coarse_wall_heights):.2f}–{max(coarse_wall_heights):.2f} m NAP')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('survey_dir', type=Path, help='Native <site>-dtm.tif and <site>-dsm.tif samples')
    parser.add_argument('bag_dir', type=Path, help='Local <site>-bag.geojson snapshots in CRS84')
    parser.add_argument('--out', type=Path, default=ROOT / 'js/ede-building-bases.js')
    args = parser.parse_args()
    rows = build(args.survey_dir, args.bag_dir)
    args.out.write_text('// Native AHN building bases in scene metres. Generated by tools/build-ede-building-bases.py.\n'
                        'export const EDE_BUILDING_BASES = ' + json.dumps(rows, separators=(',', ':')) + ';\n')
