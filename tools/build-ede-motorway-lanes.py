#!/usr/bin/env python3
"""Fetch WEGGEG/NWB lane evidence or rebuild the directed Ede motorway lane asset offline."""

import argparse
from bisect import bisect_right
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import groupby
import json
import math
from pathlib import Path
import re
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from ede_map import load_scene as read_scene
from ede_traffic_geometry import RoadGraph, Segment, SegmentIndex

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'tools/data/ede-motorway-lanes.snapshot.json'
REVIEW = ROOT / 'tools/data/ede-motorway-lanes.review.json'
OUTPUT = ROOT / 'assets/ede-motorway-lanes.json'
SOURCES = {
    'weggeg': 'https://api.pdok.nl/rws/weggegevens/ogc/v1/collections/wegvak_rijstroken',
    'nwb': 'https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1/collections/wegvakken',
}
OSM = 'https://api.openstreetmap.org/api/0.6/ways'
AERIAL = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0'
KINDS = {'HR', 'OPR', 'AFR', 'PST', 'VBD', 'VBI', 'PR'}


def fetch_pages(url):
    seen = set()
    features = []
    while url:
        if url in seen:
            raise ValueError(f'Repeated page: {url}')
        seen.add(url)
        with urlopen(url, timeout=40) as response:
            page = json.load(response)
        if page.get('type') != 'FeatureCollection':
            raise ValueError(f'Expected GeoJSON FeatureCollection from {url}')
        features.extend(page['features'])
        following = next((link['href'] for link in page.get('links', ()) if link['rel'] == 'next'), None)
        url = urljoin(url, following) if following else None
    return features


def osm_tags(way_ids):
    fields = {'ref', 'carriageway_ref', 'lanes', 'access:lanes', 'turn:lanes'}
    tags = {}
    way_ids = list(way_ids)
    for offset in range(0, len(way_ids), 40):
        query = urlencode({'ways': ','.join(way_ids[offset:offset + 40])})
        request = Request(OSM + '?' + query, headers={'User-Agent': 'slop-ede/1.0 (https://github.com/rolandsmeenk/slop-ede)'})
        with urlopen(request, timeout=40) as response:
            ways = ET.parse(response).getroot().findall('way')
        for way in ways:
            tags[way.get('id')] = {tag.get('k'): tag.get('v') for tag in way.findall('tag') if tag.get('k') in fields}
    if set(tags) != set(way_ids):
        raise ValueError('Incomplete OSM motorway way metadata')
    return tags


def fetch_snapshot(scene):
    south, west, north, east = scene['meta']['geographicBounds']
    # Buffer the scene so a source crossing the edge can be joined to its NWB section.
    bounds = [round(west - .002, 5), round(south - .002, 5), round(east + .01, 5), round(north + .0025, 5)]
    query = urlencode({'bbox': ','.join(map(str, bounds)), 'limit': 1000, 'f': 'json'})
    with ThreadPoolExecutor(3) as pool:
        weggeg = pool.submit(fetch_pages, SOURCES['weggeg'] + '/items?' + query)
        nwb = pool.submit(fetch_pages, SOURCES['nwb'] + '/items?' + query + '&wegbehsrt=R')
        tags = pool.submit(osm_tags, motorway_ways(scene))
        records, roads = weggeg.result(), nwb.result()
        checked_tags = tags.result()
    if not records or not roads:
        raise ValueError('Refusing to write an incomplete WEGGEG/NWB snapshot')
    linked = {record['properties']['wvk_id'] for record in records}
    return {
        'version': 1,
        'retrievedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'bounds': bounds,
        'sources': {**SOURCES, 'osm': OSM},
        'osmTags': checked_tags,
        'weggeg': sorted(records, key=lambda record: record['id']),
        'nwb': sorted((road for road in roads if road['properties']['wvk_id'] in linked),
                      key=lambda road: road['properties']['wvk_id']),
    }


def geometry_line(feature):
    geometry = feature['geometry']
    if geometry['type'] == 'LineString':
        return geometry['coordinates']
    if geometry['type'] == 'MultiLineString' and len(geometry['coordinates']) == 1:
        return geometry['coordinates'][0]
    raise ValueError(f"Disconnected or invalid geometry for {feature['id']}")


class Line:
    def __init__(self, points, data):
        self.segments = []
        self.offsets = [0]
        for a, b in zip(points, points[1:]):
            segment = Segment(a, b, data)
            if segment.length:
                self.segments.append(segment)
                self.offsets.append(self.offsets[-1] + segment.length)
        self.length = self.offsets[-1]

    def at(self, distance):
        index = min(len(self.segments) - 1, bisect_right(self.offsets, distance) - 1)
        segment = self.segments[index]
        offset = distance - self.offsets[index]
        return (segment.a[0] + segment.ux * offset, segment.a[1] + segment.uz * offset), segment

    def nearest(self, point):
        return min((distance, self.offsets[index] + along)
                   for index, segment in enumerate(self.segments)
                   for distance, along in [project_on_segment(point, segment)])


def project_on_segment(point, segment):
    along, _ = segment.project(*point)
    along = max(0, min(segment.length, along))
    x = segment.a[0] + segment.ux * along
    z = segment.a[1] + segment.uz * along
    return math.hypot(point[0] - x, point[1] - z), along


def motorway_ways(scene):
    ways = {}
    for road in scene['roads']:
        if road['kind'] not in ('motorway', 'motorway_link') or not road['oneway']:
            continue
        points = list(zip(road['pts'][::2], road['pts'][1::2]))
        ways[road['id'][1:]] = road, Line(points, road['id'][1:])
    return ways


def nearest_way(point, heading, index, roads, tags, record):
    candidates = {}
    for segment in index.near(*point):
        road = roads[segment.data][0]
        way_tags = tags.get(segment.data)
        if way_tags is None:
            continue
        osm_ref = way_tags.get('ref')
        if osm_ref and record['route'] not in osm_ref.split(';'):
            continue
        osm_side = way_tags.get('carriageway_ref')
        if osm_side and osm_side != record['carriagewayRef']:
            continue
        sign = -1 if road['reverse'] else 1
        dot = sign * (segment.ux * heading.ux + segment.uz * heading.uz)
        if dot < .87:
            continue
        distance, _ = project_on_segment(point, segment)
        if distance > 6:
            continue
        score = distance + (1 - dot) * 8
        candidates[segment.data] = min(score, candidates.get(segment.data, math.inf))
    ranked = sorted(candidates, key=candidates.get)
    if not ranked or len(ranked) > 1 and candidates[ranked[1]] - candidates[ranked[0]] < .8:
        return None
    return ranked[0]


def match_spans(source, roads, index, tags, record):
    count = max(2, math.ceil(source.length / 2.5))
    step = source.length / count
    samples = [nearest_way(*source.at((i + .5) * step), index, roads, tags, record) for i in range(count)]
    for way, run in groupby(enumerate(samples), key=lambda sample: sample[1]):
        first, *rest = run
        if way is None or not rest and count > 2:
            continue
        last = rest[-1] if rest else first
        road, shape = roads[way]
        start, end = sorted(shape.nearest(source.at(distance)[0])[1]
                            for distance in (first[0] * step, (last[0] + 1) * step))
        # The winning centreline can change one sample before the common OSM endpoint.
        clipped_start = first[0] > 0
        clipped_end = last[0] + 1 < count
        if road['reverse']:
            clipped_start, clipped_end = clipped_end, clipped_start
        if clipped_start and start < 2.5:
            start = 0
        if clipped_end and shape.length - end < 2.5:
            end = shape.length
        if end - start >= min(3, shape.length * .65):
            yield way, {
                'start': round(start / shape.length, 6),
                'end': round(end / shape.length, 6),
                'direction': 'backward' if road['reverse'] else 'forward',
            }


def verified_transition(key, check, spans, roads, source, record):
    if not check:
        return None
    before, after = check
    matched = defaultdict(list)
    for way, span in spans:
        matched[way].append(span)
    if before not in matched or after not in matched:
        return None
    upstream, upstream_line = roads[before]
    downstream, downstream_line = roads[after]
    if not any(span['start' if upstream['reverse'] else 'end'] == (0 if upstream['reverse'] else 1)
               for span in matched[before]):
        return None
    if not any(span['end' if downstream['reverse'] else 'start'] == (1 if downstream['reverse'] else 0)
               for span in matched[after]):
        return None
    upstream_at = 0 if upstream['reverse'] else upstream_line.length
    downstream_at = downstream_line.length if downstream['reverse'] else 0
    join = upstream_line.at(upstream_at)[0]
    other = downstream_line.at(downstream_at)[0]
    before_lanes, after_lanes = upstream['lanes'], downstream['lanes']
    # Some published transitions give the two counts in the opposite order from
    # the offset geometry. The observed markings and OSM geometry establish order.
    distance, source_at = source.nearest(join)
    if (math.dist(join, other) > .05 or distance > 5 or not 0 < source_at < source.length
            or before_lanes == after_lanes
            or {before_lanes, after_lanes} != {record['beginLanes'], record['endLanes']}):
        return None
    return {'record': key, 'fromWay': before, 'toWay': after, 'world': [round(n, 1) for n in join],
            'fromLanes': before_lanes, 'toLanes': after_lanes}


def build(snapshot, scene, aerial_reviews):
    meta = scene['meta']
    frame = RoadGraph({**meta, 'edges': []})
    roads = motorway_ways(scene)
    index = SegmentIndex((segment for _, shape in roads.values() for segment in shape.segments), margin=6)
    nwb = {(item['properties']['wvk_id'], item['properties']['wvk_begdat']): item for item in snapshot['nwb']}
    ways, records, review, transitions = defaultdict(list), {}, [], []
    tags = snapshot['osmTags']
    for feature in snapshot['weggeg']:
        props = feature['properties']
        key = feature['id']
        road_id = props['wvk_id'], props['wvk_begdat']
        nwb_feature = nwb.get(road_id)
        if not nwb_feature:
            review.append({'record': key, 'reason': 'NWB segment or version unavailable'})
            continue
        nwb_props = nwb_feature['properties']
        route, category = nwb_props['wegnr_hmp'], nwb_props['bst_code']
        if route not in ('A12', 'A30') or category not in KINDS:
            continue
        counts = re.fullmatch(r'([1-9])\s*->\s*([1-9])', props['omschr'])
        if not counts:
            review.append({'record': key, 'reason': 'Unrecognized lane count'})
            continue
        begin_lanes, end_lanes = map(int, counts.groups())
        try:
            coords = geometry_line(feature)
            source = Line([frame.project(*point) for point in coords], None)
            nwb_line = Line([frame.project(*point) for point in geometry_line(nwb_feature)], None)
        except (KeyError, ValueError, TypeError):
            review.append({'record': key, 'reason': 'Disconnected or invalid source geometry'})
            continue
        offset_start, offset_end = props['begafstand'], props['endafstand']
        letter = nwb_props['hecto_lttr']
        side = props['izi_side']
        carriageway_ref = letter if letter and letter != '#' else {'L': 'Li', 'R': 'Re'}.get(side)
        record = {
            'objectId': props['objectid'], 'nwbId': road_id[0], 'nwbFrom': road_id[1][:10],
            'route': route, 'carriageway': category, 'carriagewaySide': side, 'carriagewayRef': carriageway_ref,
            'hectometreLetter': letter, 'nwbDirection': nwb_props['rijrichtng'], 'laneDirection': props['kantcode'],
            'beginOffsetM': offset_start, 'endOffsetM': offset_end,
            'beginLanes': begin_lanes, 'endLanes': end_lanes,
            'beginLonLat': coords[0], 'endLonLat': coords[-1],
        }
        records[key] = record
        if not source.length or not nwb_line.length:
            review.append({'record': key, 'reason': 'Empty lane geometry'})
            continue
        start_match = nwb_line.nearest(source.at(0)[0])
        end_match = nwb_line.nearest(source.at(source.length)[0])
        expected = nwb_props['begafstand'], nwb_props['endafstand']
        if start_match[0] > 2 or end_match[0] > 2 or expected[1] <= expected[0] or any(
                abs(expected[0] + match[1] / nwb_line.length * (expected[1] - expected[0]) - offset) > 3
                for match, offset in zip((start_match, end_match), (offset_start, offset_end))):
            review.append({'record': key, 'reason': 'Geometry disagrees with NWB offsets'})
            continue
        travel = nwb_props['rijrichtng']
        if travel not in ('H', 'T') or props['kantcode'] != travel:
            review.append({'record': key, 'reason': 'Unconfirmed lane direction'})
            continue
        if travel == 'T':
            source = Line([frame.project(*point) for point in reversed(coords)], None)
        spans = list(match_spans(source, roads, index, tags, record))
        visual = aerial_reviews.get(key, {})
        if visual:
            record['aerial'] = {field: visual[field] for field in ('observation', 'crop')}
        transition = verified_transition(key, visual.get('transition'), spans, roads, source, record)
        if transition:
            transitions.append(transition)
        if not spans:
            review.append({'record': key, 'reason': 'No unambiguous motorway geometry in the scene'})
        for way, span in spans:
            baseline = roads[way][0]['lanes']
            confirmed_taper = transition and way in (transition['fromWay'], transition['toWay'])
            if confirmed_taper or begin_lanes == end_lanes == baseline:
                ways[way].append({**span, 'lanes': baseline, 'source': 'weggeg', 'records': [key]})
                continue
            review.append({
                'record': key, 'way': way, **span, 'osmLanes': baseline,
                'reason': ('Published lane taper has no single physical count' if begin_lanes != end_lanes
                           else 'Published and OSM lane counts disagree'),
            })
    for way, spans in ways.items():
        merged = []
        for span in sorted(spans, key=lambda row: (row['start'], row['end'])):
            if merged and span['start'] < merged[-1]['end'] and span['lanes'] != merged[-1]['lanes']:
                raise ValueError(f'Conflicting accepted lane counts for OSM {way}: {merged[-1]} and {span}')
            if merged and span['start'] <= merged[-1]['end'] and span['lanes'] == merged[-1]['lanes']:
                merged[-1]['end'] = max(merged[-1]['end'], span['end'])
                merged[-1]['records'] = sorted(set(merged[-1]['records'] + span['records']))
            else:
                merged.append(span)
        ways[way] = merged
    coverage = {records[key]['route'] for spans in ways.values() for span in spans for key in span['records']}
    if coverage != {'A12', 'A30'}:
        raise ValueError(f'Found accepted lane intervals for {sorted(coverage)}, expected A12 and A30')
    return {'version': 1, 'retrievedAt': snapshot['retrievedAt'], 'sources': snapshot['sources'],
            'aerial': {'source': AERIAL, 'layer': '2026_orthoHR', 'licence': 'CC BY 4.0',
                       'attribution': 'Beeldmateriaal Nederland'},
            'ways': ways, 'records': records, 'transitions': transitions, 'review': review}


def write_json(path, data):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, sort_keys=True, separators=(',', ':')) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--fetch', action='store_true', help='Refresh the raw snapshot before building')
    parser.add_argument('--snapshot', type=Path, default=SNAPSHOT)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    mode.add_argument('--check', action='store_true', help='Check that the offline build reproduces the asset')
    args = parser.parse_args()
    scene = read_scene()
    if args.fetch:
        write_json(args.snapshot, fetch_snapshot(scene))
    snapshot = json.loads(args.snapshot.read_text())
    aerial_reviews = json.loads(REVIEW.read_text())
    asset = build(snapshot, scene, aerial_reviews)
    if args.check:
        if asset != json.loads(args.output.read_text()):
            raise ValueError('The checked-in motorway lane asset differs from the offline build')
    else:
        write_json(args.output, asset)
    print(f"Matched {sum(map(len, asset['ways'].values()))} lane intervals on {len(asset['ways'])} OSM ways")
    for reason, count in Counter(row['reason'] for row in asset['review']).most_common():
        print(f'{count:3}  {reason}')


if __name__ == '__main__':
    main()
