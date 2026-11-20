"""Bake mapped outdoor pitches and courts from an OpenStreetMap snapshot."""

import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from shapely import get_parts, make_valid, set_precision, union_all
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import polygonize
from shapely.strtree import STRtree

from ede_map import ROOT, load_scene
from ede_scene import SceneAffine


# Reviewed positions in the PDOK 2026_orthoHR 1200 by 1500 pixel crop.
MOORFIELDERS_BBOX = (5.66331, 52.0137, 5.66618, 52.01595)
DIAMONDS = {
    'w113726375': ((418, 1082), (517, 1048), 'baseball'),
    'w1223801296': ((154, 479), (216, 514), 'softball'),
    'w1223801297': ((780, 259), (735, 382), 'baseball'),
}


def diamond_control(identity, frame):
    home, toward, rules = DIAMONDS[identity]
    west, south, east, north = MOORFIELDERS_BBOX

    def pixel_to_scene(pixel):
        x, y = pixel
        lon = west + (x + 0.5) / 1200 * (east - west)
        lat = north - (y + 0.5) / 1500 * (north - south)
        return [round(v, 1) for v in frame.lon_lat_to_scene(lon, lat)]

    return {'home': pixel_to_scene(home), 'toward': pixel_to_scene(toward), 'rules': rules}


def sport_feature(tags):
    return tags.get('leisure') in {'pitch', 'practice_pitch'} or (
        tags.get('leisure') == 'track' and tags.get('sport') == 'athletics'
    )


def xml_tags(element):
    return {tag.get('k'): tag.get('v') for tag in element.findall('tag')}


def osm_tiles(paths, geographic_bounds):
    nodes, ways, relations = {}, {}, {}
    coverage = []
    for path in paths:
        root = ET.parse(path).getroot()
        bounds = root.find('bounds')
        if root.tag != 'osm' or bounds is None:
            raise ValueError(f'Expected an OpenStreetMap API map tile: {path}')
        coverage.append(box(*(float(bounds.get(key)) for key in ('minlon', 'minlat', 'maxlon', 'maxlat'))))
        for element in root:
            identity = int(element.get('id', 0))
            if element.tag == 'node':
                nodes[identity] = (float(element.get('lon')), float(element.get('lat')))
            elif element.tag == 'way':
                ways[identity] = ([int(nd.get('ref')) for nd in element.findall('nd')], xml_tags(element))
            elif element.tag == 'relation':
                tags = xml_tags(element)
                if sport_feature(tags):
                    relations[identity] = (tags, [
                        (m.get('role'), int(m.get('ref'))) for m in element.findall('member') if m.get('type') == 'way'
                    ])
    south, west, north, east = geographic_bounds
    if not union_all(coverage).covers(box(west, south, east, north)):
        raise ValueError('OpenStreetMap tiles must cover the complete playable bounds')

    def points(refs):
        return [
            dict(lon=nodes[ref][0], lat=nodes[ref][1]) for ref in refs
        ] if all(ref in nodes for ref in refs) else []

    for identity, (refs, tags) in ways.items():
        if sport_feature(tags):
            yield dict(type='way', id=identity, tags=tags, geometry=points(refs))
    for identity, (tags, members) in relations.items():
        yield dict(type='relation', id=identity, tags=tags, members=[
            dict(role=role, geometry=points(ways[ref][0]) if ref in ways else []) for role, ref in members
        ])


def osm_features(paths, geographic_bounds):
    if all(path.suffix == '.xml' for path in paths):
        return osm_tiles(paths, geographic_bounds)
    if len(paths) != 1 or paths[0].suffix != '.json':
        raise ValueError('Provide either tiled OSM XML map responses or one Overpass JSON snapshot')
    data = json.loads(paths[0].read_text())
    if data.get('remark') or not data.get('elements'):
        raise ValueError('Expected a complete Overpass out geom response')
    return data['elements']


def source_polygon(feature, frame):
    def points(geometry):
        return [frame.lon_lat_to_scene(node['lon'], node['lat']) for node in geometry]

    if feature['type'] == 'way':
        ring = points(feature.get('geometry', []))
        return make_valid(Polygon(ring)) if len(ring) >= 4 and ring[0] == ring[-1] else Polygon()

    members = [(m.get('role'), points(m.get('geometry') or []))
               for m in feature.get('members', []) if m.get('type', 'way') == 'way']
    if not members or any(len(line) < 2 for _, line in members):
        return Polygon()
    shells = polygonize([LineString(line) for role, line in members if role in {'outer', ''}])
    holes = polygonize([LineString(line) for role, line in members if role == 'inner'])
    return union_all(list(shells)).difference(union_all(list(holes)))


def unpack_ring(values):
    return list(zip(values[::2], values[1::2]))


def packed_ring(ring):
    return [round(coord, 1) for point in list(ring.coords)[:-1] for coord in point]


def polygon_parts(geometry):
    if geometry.geom_type == 'Polygon':
        return [geometry] if geometry.area >= 12 else []
    if hasattr(geometry, 'geoms'):
        return [part for geom in get_parts(geometry) for part in polygon_parts(geom)]
    return []


def tesqua_courts():
    survey = (ROOT / 'js/ede-next-survey.js').read_text()
    rows = json.loads(re.search(r'^export const TESQUA_COURTS = (.+);$', survey, re.MULTILINE).group(1))
    for pad, (kind, ring, count) in enumerate(rows):
        sport = 'tennis' if kind.startswith('clay') else kind
        surface = {'tennis': 'clay', 'padel': 'artificial_turf', 'pickleball': 'hard'}[sport]
        a, b, c, d = ring

        def lerp(start, end, t):
            return [p + (q - p) * t for p, q in zip(start, end)]

        for court in range(count):
            start, end = court / count, (court + 1) / count
            polygon = Polygon([lerp(a, b, start), lerp(a, b, end), lerp(d, c, end), lerp(d, c, start)])
            yield dict(id=f'tesqua:{pad + 1}-{court + 1}', name='Tesqua', sports=[sport],
                       surface=surface, surveyed=True), polygon


def excluded_as_indoor(tags, polygon, buildings):
    if tags.get('indoor') not in {None, 'no'} or tags.get('building') not in {None, 'no'}:
        return True
    candidates = buildings.query(polygon, predicate='intersects')
    return any(polygon.intersection(buildings.geometries[index]).area > polygon.area * 0.9
               for index in candidates)


def build(paths, snapshot, scene):
    frame = SceneAffine(scene['meta']['lonLatAffine'])
    bounds = box(*scene['meta']['bounds'])
    buildings = STRtree([
        make_valid(Polygon(unpack_ring(row['ring']), [unpack_ring(hole) for hole in row.get('holes', [])]))
        for row in scene['buildings'] if not row.get('part') and len(row['ring']) >= 6
    ])
    surveys = list(tesqua_courts())
    surveyed_area = union_all([polygon for _, polygon in surveys])
    stats = Counter()
    records = []
    superseded = []
    for row in osm_features(paths, scene['meta']['geographicBounds']):
        tags = row.get('tags', {})
        if row['type'] not in {'way', 'relation'} or not sport_feature(tags) or tags.get('area') == 'no':
            continue
        identity = f"{row['type'][0]}{row['id']}"
        geometry = source_polygon(row, frame)
        if geometry.is_empty:
            stats['incomplete'] += 1
            continue
        clipped = set_precision(geometry, 0.1).intersection(bounds)
        parts = sorted(polygon_parts(clipped), key=lambda polygon: (-polygon.area, polygon.bounds))
        if not parts:
            stats['outsideOrSmall'] += 1
        sports = list(dict.fromkeys(sport.strip().lower() for sport in tags.get('sport', '').split(';') if sport.strip()))
        for index, polygon in enumerate(parts):
            if excluded_as_indoor(tags, polygon, buildings):
                stats['indoor'] += 1
                continue
            if polygon.intersection(surveyed_area).area > polygon.area * 0.5:
                stats['tesquaOverlaps'] += 1
                superseded.append(identity)
                continue
            pitch = dict(id=identity if index == 0 else f'{identity}:{index + 1}', sports=sports)
            if identity in DIAMONDS:
                pitch['diamond'] = diamond_control(identity, frame)
            if name := tags.get('name') or tags.get('operator'):
                pitch['name'] = name
            if surface := tags.get('surface'):
                pitch['surface'] = surface.lower()
            if tags['leisure'] == 'track':
                pitch['kind'] = 'track'
                if athletics := tags.get('athletics'):
                    pitch['athletics'] = athletics
            lanes = tags.get('lanes', '')
            if lanes.isdecimal() and 1 <= int(lanes) <= 12:
                pitch['lanes'] = int(lanes)
            records.append((pitch, polygon))

    # Relations carry the chosen holes for near-identical ways.
    records.sort(key=lambda record: (not record[0]['id'].startswith('r'), record[0]['id']))
    distinct = []
    for pitch, polygon in records:
        overlapping = next((candidate for candidate, area in distinct
                            if polygon.bounds[0] <= area.bounds[2] and polygon.bounds[2] >= area.bounds[0]
                            and polygon.bounds[1] <= area.bounds[3] and polygon.bounds[3] >= area.bounds[1]
                            and polygon.intersection(area).area >= 0.93 * max(polygon.area, area.area)), None)
        if overlapping is None:
            distinct.append((pitch, polygon))
            continue
        stats['duplicate'] += 1
        overlapping['sports'] = list(dict.fromkeys([*overlapping['sports'], *pitch['sports']]))
        overlapping.setdefault('sourceIds', []).append(pitch['id'])
        for key in ('surface', 'name'):
            if key in pitch:
                overlapping.setdefault(key, pitch[key])

    pitches = []
    for pitch, polygon in sorted([*distinct, *surveys], key=lambda row: row[0]['id']):
        polygon = orient(polygon, sign=-1)
        pitch['ring'] = packed_ring(polygon.exterior)
        if polygon.interiors:
            pitch['holes'] = [packed_ring(hole) for hole in polygon.interiors]
        pitches.append(pitch)
    return {
        'version': 1,
        'source': {'name': 'OpenStreetMap contributors', 'license': 'ODbL 1.0',
                   'url': 'https://www.openstreetmap.org/copyright', 'date': snapshot,
                   'tesqua': 'Existing Ede in 3D court survey',
                   'moorfielders': 'PDOK 2026_orthoHR diamond alignment',
                   'tesquaSupersedes': sorted(set(superseded))},
        'counts': {'pitches': len(pitches), 'bySport': dict(sorted(Counter(
            sport for pitch in pitches for sport in (pitch['sports'] or ['unspecified'])
        ).items())), **dict(sorted(stats.items()))},
        'pitches': pitches,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', nargs='+', type=Path, help='Overpass out geom JSON or complete tiled API XML map responses')
    parser.add_argument('--date', required=True, type=date.fromisoformat, help='Source snapshot date')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-sports.json')
    args = parser.parse_args()
    data = build(args.snapshot, args.date.isoformat(), load_scene(include_shorelines=False))
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(data['counts']))


if __name__ == '__main__':
    main()
