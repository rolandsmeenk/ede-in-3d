#!/usr/bin/env python3
"""Match public BAG building uses to the bundled OSM footprints for window lighting."""

import argparse
from collections import defaultdict
import gzip
import json
from pathlib import Path

from shapely import STRtree, make_valid, transform
from shapely.geometry import Polygon, shape

from ede_gis import Frame, source_crs
from ede_map import ROOT, load_scene


def usage(value):
    uses = set((value or '').split(','))
    if 'woonfunctie' in uses:
        return 'mixed' if uses & {'kantoorfunctie', 'winkelfunctie'} else 'home'
    if 'winkelfunctie' in uses:
        return 'shop'
    if uses & {'kantoorfunctie', 'onderwijsfunctie'}:
        return 'office'
    if uses <= {'industriefunctie', 'overige gebruiksfunctie'}:
        return 'unlit'
    return None


def building_uses(cache, frame):
    paths = sorted(cache.glob('rd-*-pand.geojson'))
    if not paths:
        raise ValueError(f'No BAG pand snapshots in {cache}')
    found = set()
    for path in paths:
        source = json.loads(path.read_bytes())
        if source_crs(source).to_epsg() != 28992:
            raise ValueError(f'Expected an RD New snapshot in {path}')
        for row in source['features']:
            props = row['properties']
            kind = usage(props.get('gebruiksdoel'))
            if not kind or not row['geometry'] or props.get('status') not in {
                'Pand in gebruik', 'Pand in gebruik (niet ingemeten)', 'Verbouwing pand',
            } or row['id'] in found:
                continue
            found.add(row['id'])
            mapped = transform(shape(row['geometry']), frame.rd_to_scene, interleaved=False)
            yield make_valid(mapped), kind


def ring(points):
    return list(zip(points[::2], points[1::2]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bag_cache', type=Path, help='RD New pand snapshots from the parcel-detail bake')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-window-uses.json.gz')
    args = parser.parse_args()

    scene = load_scene(include_shorelines=False)
    with gzip.open(ROOT / 'assets/ede-corridors-v1.json.gz', 'rt') as source:
        scene['buildings'].extend(json.load(source)['buildings'])
    shapes, kinds = zip(*building_uses(args.bag_cache, Frame(scene['meta']['lonLatAffine'])))
    index = STRtree(shapes)
    matches = defaultdict(list)
    for building in scene['buildings']:
        if len(building.get('ring', ())) < 6 or building.get('part'):
            continue
        footprint = make_valid(Polygon(ring(building['ring']), [ring(hole) for hole in building.get('holes', ())]))
        if not footprint.area:
            continue
        coverage = defaultdict(float)
        for hit in index.query(footprint, predicate='intersects'):
            overlap = footprint.intersection(shapes[hit]).area
            if overlap >= 0.55 * min(footprint.area, shapes[hit].area):
                coverage[kinds[hit]] += overlap
        ranked = sorted(coverage.items(), key=lambda entry: (-entry[1], entry[0]))
        if ranked and ranked[0][1] >= 0.65 * footprint.area and (
            len(ranked) == 1 or ranked[1][1] < 0.25 * footprint.area
        ):
            matches[ranked[0][0]].append(building['id'])
    asset = {'version': 1, 'uses': {kind: sorted(ids) for kind, ids in sorted(matches.items())}}
    data = json.dumps(asset, separators=(',', ':')).encode()
    args.output.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    print(', '.join(f'{kind}: {len(ids)}' for kind, ids in sorted(matches.items())))
    print(f'{args.output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
