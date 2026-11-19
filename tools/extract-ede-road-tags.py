"""Extract current tags for the checked-in road geometry from local OSM PBFs."""

import argparse
import json
from pathlib import Path

import osmium

from ede_map import load_scene


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path, nargs='+')
    args = parser.parse_args()
    data = load_scene()
    road_ids = {int(road['id'][1:]) for road in data['roads']}
    ways = {}

    class RoadTags(osmium.SimpleHandler):
        def way(self, way):
            if way.id in road_ids and 'highway' in way.tags:
                ways[way.id] = {'type': 'way', 'id': way.id, 'tags': dict(way.tags)}

    reader = RoadTags()
    for path in args.pbf:
        reader.apply_file(str(path))
    print(json.dumps({'elements': [ways[key] for key in sorted(ways)]}, separators=(',', ':')))


if __name__ == '__main__':
    main()
