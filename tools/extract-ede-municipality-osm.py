#!/usr/bin/env python3
"""Extract complete OSM ways and areas around the full Ede municipality from dated PBFs."""

import argparse
import json
from pathlib import Path

import osmium
from shapely import box, prepare, transform
from shapely.geometry import shape

from ede_gis import Frame
from ede_map import load_scene_metadata

PLACE_TYPES = {'city', 'town', 'village', 'hamlet'}
PARK_NATURAL = {'wood', 'heath', 'sand', 'bare_rock', 'scrub', 'grassland'}
PARK_LANDUSE = {'grass', 'recreation_ground', 'cemetery', 'village_green', 'forest'}
PARK_LEISURE = {'park', 'garden', 'playground', 'pitch'}
NODES = {'crossing', 'give_way', 'stop', 'traffic_signals'}
KEYS = ('building', 'building:part', 'highway', 'railway', 'natural', 'waterway',
        'landuse', 'leisure', 'place', 'barrier', 'traffic_calming', 'entrance', 'kerb')
GATES = {'gate', 'lift_gate', 'swing_gate', 'kissing_gate', 'entrance', 'cycle_barrier'}


def wanted(tags):
    return ('building' in tags or 'building:part' in tags or 'highway' in tags
            or tags.get('railway') in {'rail', 'light_rail', 'tram', 'subway'}
            or tags.get('natural') in PARK_NATURAL | {'water'}
            or tags.get('waterway') in {'riverbank', 'dock'}
            or tags.get('landuse') in PARK_LANDUSE
            or tags.get('leisure') in PARK_LEISURE
            or tags.get('place') == 'square' or 'barrier' in tags or 'traffic_calming' in tags)


def as_points(points):
    return [{'lon': point.lon, 'lat': point.lat} for point in points]


def overlaps(points, area):
    longitudes = [point['lon'] for point in points]
    latitudes = [point['lat'] for point in points]
    return bool(points) and area.intersects(box(min(longitudes), min(latitudes), max(longitudes), max(latitudes)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('municipality', type=Path, help='Official EPSG:28992 Ede GeoJSON')
    parser.add_argument('output', type=Path)
    parser.add_argument('pbf', type=Path, nargs='+')
    parser.add_argument('--margin-m', type=float, default=750, help='OSM source margin outside Ede in RD New metres')
    args = parser.parse_args()

    feature = json.loads(args.municipality.read_bytes())
    if feature['type'] == 'FeatureCollection':
        feature = feature['features'][0]
    if feature['properties']['identificatie'] != 'GM0228':
        raise ValueError('Expected official GM0228 boundary')
    frame = Frame(load_scene_metadata()['lonLatAffine'])
    area = transform(shape(feature['geometry']).buffer(args.margin_m), lambda x, y: frame.scene_to_lon_lat(
        *frame.rd_to_scene(x, y)), interleaved=False)
    prepare(area)
    entities = {}
    timestamps = {}
    for path in args.pbf:
        with osmium.io.Reader(str(path)) as reader:
            timestamps[path.name] = reader.header().get('osmosis_replication_timestamp')
        processor = (osmium.FileProcessor(path).with_locations().with_areas()
                     .with_filter(osmium.filter.KeyFilter(*KEYS)))
        for item in processor:
            tags = dict(item.tags)
            if item.is_node():
                if not (tags.get('highway') in NODES or tags.get('natural') == 'tree' or tags.get('place') in PLACE_TYPES
                        or tags.get('railway') in {'crossing', 'level_crossing'} or 'traffic_calming' in tags
                        or 'entrance' in tags or tags.get('barrier') in GATES or tags.get('kerb') == 'lowered'):
                    continue
                if not overlaps([{'lon': item.lon, 'lat': item.lat}], area):
                    continue
                entities[('node', item.id)] = dict(type='node', id=item.id, lon=item.lon, lat=item.lat, tags=tags)
            elif item.is_way() and wanted(tags):
                if not all(node.location.valid() for node in item.nodes):
                    continue
                points = as_points(item.nodes)
                if overlaps(points, area):
                    entities[('way', item.id)] = dict(type='way', id=item.id, tags=tags,
                                                      nodes=[node.ref for node in item.nodes], geometry=points)
            elif item.is_area() and not item.from_way() and wanted(tags):
                members = []
                for outer in item.outer_rings():
                    points = as_points(outer)
                    if overlaps(points, area):
                        members.append(dict(role='outer', geometry=points))
                        members.extend(dict(role='inner', geometry=as_points(inner)) for inner in item.inner_rings(outer))
                if members:
                    identity = item.orig_id()
                    entities[('relation', identity)] = dict(type='relation', id=identity, tags=tags, members=members)
        print(f'{path.name}: {len(entities):,} unique features in coverage', flush=True)

    if not any(key[0] == 'way' for key in entities):
        raise ValueError('No OSM ways in the official Ede outline')
    args.output.write_text(json.dumps({'osm3s': {'timestamp_osm_base': min(timestamps.values()),
        'sources': timestamps}, 'elements': [entities[key] for key in sorted(entities)]},
        ensure_ascii=False, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
