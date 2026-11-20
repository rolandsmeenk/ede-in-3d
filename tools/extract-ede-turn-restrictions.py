"""Bake Ede turn restrictions from local Geofabrik OSM PBF extracts."""

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

import osmium

from ede_map import load_scene
from ede_scene import SceneAffine

ROOT = Path(__file__).resolve().parents[1]
KINDS = {f'{prefix}_{turn}' for prefix in ('no', 'only')
         for turn in ('left_turn', 'right_turn', 'straight_on', 'u_turn')} | {'no_entry', 'no_exit'}
MODE_KEYS = {
    1: ('motorcar', 'motor_vehicle', 'vehicle'),
    2: ('goods', 'motorcar', 'motor_vehicle', 'vehicle'),
    4: ('bus', 'psv', 'motor_vehicle', 'vehicle'),
    8: ('bicycle', 'vehicle'),
    16: ('foot',),
}


def rules_for(tags):
    if any(key.endswith(':conditional') and key.startswith('restriction') for key in tags):
        return {}
    except_modes = set(tags.get('except', '').replace(' ', '').split(';'))
    scope = tags.get('type', '').removeprefix('restriction:')
    masks = defaultdict(int)
    for mode, keys in MODE_KEYS.items():
        if except_modes.intersection(keys):
            continue
        for key in keys:
            value = tags.get(f'restriction:{key}') or (tags.get('restriction') if key == scope else None)
            if value is not None:
                break
        else:
            value = tags.get('restriction') if scope == 'restriction' and mode != 16 else None
        if value in KINDS:
            masks[value] |= mode
    return masks


def members_for(members, roads, kind):
    roles = {role: [(typ, ref) for typ, ref, key in members if key == role] for role in ('from', 'via', 'to')}
    starts, via, ends = roles['from'], roles['via'], roles['to']
    if not starts or not ends or not via or len(members) != sum(map(len, roles.values())):
        return
    if len(starts) != 1 and kind != 'no_entry' or len(ends) != 1 and kind != 'no_exit':
        return
    if any(typ != 'w' or ref not in roads for typ, ref in starts + ends):
        return
    if len(via) == 1 and via[0][0] == 'n':
        node = via[0][1]
        if all(node in roads[ref] for _, ref in starts + ends):
            for _, start in starts:
                for _, end in ends:
                    yield [start, end], [node]
        return
    if any(typ != 'w' or ref not in roads for typ, ref in via):
        return
    for _, start in starts:
        for _, end in ends:
            ways = [start, *(ref for _, ref in via), end]
            shared = [set(roads[a]) & set(roads[b]) for a, b in zip(ways, ways[1:])]
            if all(len(nodes) == 1 for nodes in shared):
                nodes = [next(iter(ids)) for ids in shared]
                if all(a != b and {a, b} == {roads[way][0], roads[way][-1]}
                       for way, a, b in zip(ways[1:-1], nodes, nodes[1:])):
                    yield ways, nodes


def extract(paths, data):
    roads = {int(road['id'][1:]): road['nodeIds'] for road in data['roads']}
    records = {}
    snapshots = set()
    class Restrictions(osmium.SimpleHandler):
        def relation(self, relation):
            tags = dict(relation.tags)
            if tags.get('type', '').split(':')[0] != 'restriction':
                return
            members = [(m.type, m.ref, m.role) for m in relation.members]
            if any(typ == 'w' and ref in roads for typ, ref, _ in members):
                if relation.id not in records or records[relation.id][0] < relation.version:
                    records[relation.id] = (relation.version, tags, members)

    reader = Restrictions()
    for path in paths:
        with osmium.io.Reader(str(path)) as source:
            snapshots.add(source.header().get('osmosis_replication_timestamp'))
        reader.apply_file(str(path))

    rows = []
    omitted = []
    for ident, (_, tags, members) in sorted(records.items()):
        count = len(rows)
        for kind, modes in rules_for(tags).items():
            rows.extend([ident, kind, modes, [f'w{way}' for way in ways], nodes]
                        for ways, nodes in members_for(members, roads, kind))
        if len(rows) == count:
            omitted.append(ident)

    needed = {node for *_, nodes in rows for node in nodes}
    points = {}
    frame = SceneAffine(data['meta']['lonLatAffine'])
    class Junctions(osmium.SimpleHandler):
        def node(self, node):
            if node.id not in needed:
                return
            points[node.id] = [math.floor(value * 10 + 0.5) / 10
                               for value in frame.lon_lat_to_scene(node.location.lon, node.location.lat)]

    reader = Junctions()
    for path in paths:
        reader.apply_file(str(path))
    if needed != points.keys():
        raise ValueError(f'Missing restriction node locations: {sorted(needed - points.keys())}')
    return {'sourceTimestamps': sorted(snapshots), 'nodes': dict(sorted(points.items())), 'rules': rows, 'omitted': omitted}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path, nargs='+')
    parser.add_argument('--output', type=Path, default=ROOT / 'js' / 'ede-turn-restriction-data.js')
    args = parser.parse_args()
    result = extract(args.pbf, load_scene())
    body = json.dumps(result, separators=(',', ':'))
    args.output.write_text('// OpenStreetMap turn restrictions via Geofabrik (ODbL). Generated by tools/extract-ede-turn-restrictions.py.\n'
                           f'export const EDE_TURN_RESTRICTION_DATA = {body};\n', encoding='utf-8')
    print(f"{len(result['rules'])} rules, {len(result['nodes'])} via nodes, {len(result['omitted'])} skipped relations")


if __name__ == '__main__':
    main()
