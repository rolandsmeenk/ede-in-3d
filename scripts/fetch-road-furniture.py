#!/usr/bin/env python3
"""Build the Ede road furniture index from cached or freshly downloaded public data.

uv run --python 3.12 --with pyproj==3.8.0 --with shapely==2.1.2 --with ijson \
    python scripts/fetch-road-furniture.py --cache /tmp/ede-road-furniture --fetch
"""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import chain
import gzip
import json
from math import atan2, cos, floor, hypot, isfinite, radians, sin
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode, urljoin

import ijson
from shapely import Point, prepare

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from ede_gis import Frame, to_rd
from ede_map import load_playable_boundary, load_scene_metadata

NWB = 'https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1/collections'
NDW = 'https://opendata.ndw.nu/verkeersborden_actueel_beeld_rd.geojson.gz'
OVERPASS = 'https://overpass.kumi.systems/api/interpreter'
GELDERLAND = 'https://download.geofabrik.de/europe/netherlands/gelderland-latest.osm.pbf'
NWB_CRS = 'http://www.opengis.net/def/crs/EPSG/0/28992'
ROADS = {'A12', 'A30', 'N224', 'N304', 'N310', 'N781', 'N801'}
EXITS = {'A12': {'23', '24', '25'}, 'A30': {'1', '2', '3'}}
RVV_CODES = {'J02', 'J03', 'J04', 'J05', 'BB01', 'BB02', 'BB14', 'BB15',
             'BB07', 'BB08', 'BB09', 'BB10', 'L08', 'L09'}
CELL_SIZE = 500
SURVEYED_SIGNS = ROOT / 'assets/ede-nbd-signs.json.gz'
SURVEYED_PORTALS = ROOT / 'assets/ede-1gis-detail.json.gz'


def write_atomic(path, contents):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_bytes(contents)
    tmp.replace(path)


def download(url, *options):
    return subprocess.check_output(['curl', '-fsSL', '--retry', '2', '--max-time', '180',
                                    *options, url])


def nwb_pages(collection, bbox):
    url = f'{NWB}/{collection}/items?' + urlencode({
        'bbox': ','.join(f'{value:.8f}' for value in bbox),
        'limit': 1000, 'f': 'json', 'crs': NWB_CRS,
    })
    start, visited, rows = url.split('?')[0], set(), []
    while url:
        if url in visited or url.split('?')[0] != start:
            raise ValueError(f'Unexpected NWB pagination at {url}')
        visited.add(url)
        page = json.loads(download(url))
        if page.get('type') != 'FeatureCollection':
            raise ValueError(f'Expected GeoJSON at {url}')
        rows.extend(page['features'])
        following = next((item['href'] for item in page['links'] if item['rel'] == 'next'), None)
        url = urljoin(url, following) if following else None
    if not rows:
        raise ValueError(f'Empty NWB collection: {collection}')
    return rows


def overpass_query(bbox):
    west, south, east, north = bbox
    bounds = f'({south:.8f},{west:.8f},{north:.8f},{east:.8f})'
    return ('[out:json][timeout:45];'
            f'node[highway=motorway_junction]{bounds}->.junctions;'
            'way(bn.junctions)[highway~"^motorway(_link)?$"]->.roads;'
            f'(.junctions;.roads;nwr[man_made=gantry]{bounds};);out geom;')



def osm_from_pbf(path, bbox):
    import osmium

    west, south, east, north = bbox
    elements = []

    def inside(lon, lat):
        return west <= lon <= east and south <= lat <= north

    class Furniture(osmium.SimpleHandler):
        def node(self, node):
            tags = dict(node.tags)
            if tags.get('highway') != 'motorway_junction' and tags.get('man_made') != 'gantry':
                return
            if inside(node.lon, node.lat):
                elements.append({'type': 'node', 'id': node.id, 'lon': node.lon, 'lat': node.lat,
                                 'tags': tags})

        def way(self, way):
            tags = dict(way.tags)
            if tags.get('highway') not in {'motorway', 'motorway_link'} and tags.get('man_made') != 'gantry':
                return
            if any(not node.location.valid() for node in way.nodes):
                return
            if any(inside(node.lon, node.lat) for node in way.nodes):
                elements.append({'type': 'way', 'id': way.id, 'nodes': [node.ref for node in way.nodes],
                                 'geometry': [{'lon': node.lon, 'lat': node.lat} for node in way.nodes],
                                 'tags': tags})

    with osmium.io.Reader(str(path)) as reader:
        timestamp = reader.header().get('osmosis_replication_timestamp')
    Furniture().apply_file(str(path), locations=True, filters=[osmium.filter.TagFilter(
        ('highway', 'motorway_junction'), ('highway', 'motorway'), ('highway', 'motorway_link'),
        ('man_made', 'gantry'))])
    return {'osm3s': {'source': GELDERLAND, 'timestamp_osm_base': timestamp}, 'elements': elements}


def fetch(cache, bbox, osm_file=None, osm_pbf=None):
    cache.mkdir(parents=True, exist_ok=True)

    def get_nwb(collection):
        write_atomic(cache / f'{collection}.json',
                     json.dumps(nwb_pages(collection, bbox), separators=(',', ':')).encode())

    def get_ndw():
        path = cache / 'ndw.geojson.gz'
        tmp = path.with_suffix('.gz.tmp')
        headers = download(NDW, '--dump-header', '-', '--output', str(tmp)).decode()
        modified = re.findall(r'^last-modified:\s*(.+)$', headers, re.I | re.M)
        tmp.replace(path)
        return modified[-1].strip() if modified else None

    def get_osm():
        if osm_pbf:
            doc = osm_from_pbf(osm_pbf, bbox)
        elif osm_file:
            doc = json.loads(osm_file.read_bytes())
        else:
            doc = json.loads(download(OVERPASS, '--get', '--data-urlencode', 'data=' + overpass_query(bbox)))
        if doc.get('remark') or not doc.get('elements'):
            raise ValueError('Empty or incomplete OSM motorway extract')
        write_atomic(cache / 'osm.json', json.dumps(doc, separators=(',', ':')).encode())

    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = [pool.submit(get_nwb, name) for name in ('hectopunten', 'wegvakken')]
        ndw = pool.submit(get_ndw)
        jobs.append(pool.submit(get_osm))
        for job in jobs:
            job.result()
        modified = ndw.result()
    snapshot = {'retrievedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                'ndwLastModified': modified}
    write_atomic(cache / 'sources.json', json.dumps(snapshot).encode())


def line_parts(feature):
    geometry = feature.get('geometry') or {}
    if geometry.get('type') == 'LineString':
        return [geometry['coordinates']]
    if geometry.get('type') == 'MultiLineString':
        return geometry['coordinates']
    return []


def nearest_tangent(rd, road, frame):
    best = None
    for line in line_parts(road):
        for a, b in zip(line, line[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            length2 = dx * dx + dy * dy
            if not length2:
                continue
            t = max(0, min(1, ((rd[0] - a[0]) * dx + (rd[1] - a[1]) * dy) / length2))
            distance = hypot(rd[0] - a[0] - t * dx, rd[1] - a[1] - t * dy)
            if best is None or distance < best[0]:
                best = (distance, (dx, dy))
    if best is not None:
        return scene_tangent(rd, best[1], frame)
    return None


def scene_tangent(rd, direction, frame):
    dx, dy = direction
    x, z = frame.rd_to_scene(*rd)
    x1, z1 = frame.rd_to_scene(rd[0] + dx, rd[1] + dy)
    scale = hypot(x1 - x, z1 - z)
    return ((x1 - x) / scale, (z1 - z) / scale) if scale else None


def reverse(vector):
    return tuple(-value for value in vector) if vector else None


def yaw(tangent):
    return round(atan2(*tangent), 7) if tangent else None


def daytime_badge(road, side, letter, section):
    return road in {'A12', 'A30'} and side in {'Re', 'Li'} and not letter and section == 'R'


def point_list(geometry):
    if geometry.get('type') == 'Point':
        return [geometry['coordinates']]
    if geometry.get('type') == 'MultiPoint':
        return geometry['coordinates']
    return []


def shortened_rvv(value):
    match = re.fullmatch(r'([A-Z]+)0*(\d+)', value or '')
    return f'{match[1]}{int(match[2]):02}' if match else value


def hectos(points, roads, frame):
    for point in points:
        p = point['properties']
        road = roads.get(p['wvk_id'])
        if road is None:
            continue
        r = road['properties']
        road_ref = r.get('wegnr_hmp') or r.get('wegnummer')
        if road_ref not in ROADS or p.get('hectomtrng') is None:
            continue
        letter = (p.get('hecto_lttr') or '').strip('# ')
        side = p.get('zijde') or {'R': 'Re', 'L': 'Li'}.get(r.get('pos_tv_wol'), '')
        km_begin, km_end = r.get('beginkm'), r.get('eindkm')
        value = f"{p['hectomtrng'] / 10:.1f}".replace('.', ',')
        for index, rd in enumerate(point_list(point['geometry'])):
            direction = nearest_tangent(rd, road, frame)
            if km_begin is not None and km_end is not None and km_begin != km_end:
                tangent = direction if km_begin < km_end else reverse(direction)
            else:
                tangent = reverse(direction) if r.get('admrichtng') == 'T' else direction
            # Both motorway sides face oncoming traffic. On ramps use the actual direction of travel.
            if letter:
                front = direction if r.get('rijrichtng') == 'T' else reverse(direction)
            else:
                front = tangent if side == 'Li' else reverse(tangent)
            yield rd, {'id': f"nwb:{point['id']}" + (f':{index}' if index else ''),
                       'type': 'hecto', 'wegnummer': road_ref, 'hectometer': value,
                       'hecto_lttr': letter, 'pos_tv_wol': side, 'weglet': letter,
                       'roadTangent': [round(v, 7) for v in tangent] if tangent else None,
                       'yaw': yaw(front), 'layer': r.get('rel_hoogte'),
                       'roadSectionId': p['wvk_id'],
                       'daytimeBadge': daytime_badge(road_ref, side, letter, r.get('wegdeelltr'))}


def rvv_signs(path, roads, frame, rd_bounds):
    west, south, east, north = rd_bounds
    with gzip.open(path, 'rb') as stream:
        for source in ijson.items(stream, 'features.item', use_float=True):
            p = source['properties']
            code = shortened_rvv(p.get('rvvCode'))
            if code not in RVV_CODES or p.get('status') != 'PLACED':
                continue
            geometry = source.get('geometry') or {}
            if geometry.get('type') != 'Point':
                continue
            rd = geometry['coordinates']
            if not (west <= rd[0] <= east and south <= rd[1] <= north):
                continue
            road = roads.get(p.get('roadSectionId'))
            bearing = p.get('bearing')
            direction = p.get('drivingDirection')
            if isinstance(bearing, (int, float)) and isfinite(bearing):
                angle = radians(bearing + 180)
                face = scene_tangent(rd, (sin(angle), cos(angle)), frame)
            elif road and direction in ('H', 'T'):
                tangent = nearest_tangent(rd, road, frame)
                face = reverse(tangent) if direction == 'H' else tangent
            else:
                face = None
            yield rd, {'id': f"ndw:{source['id']}", 'type': 'rvv', 'rvvCode': code,
                       'sourceCode': p['rvvCode'], 'yaw': yaw(face),
                       'mountingHeightClass': {'B': 'overhead', 'L': 'roadside'}.get(p.get('placement'), 'unknown'),
                       'layer': road['properties'].get('rel_hoogte') if road else None,
                       'sourceBearing': bearing}


def tokens(value):
    return [word.strip() for word in re.split(r'[;|]', value or '') if word.strip()]


def osm_point(node):
    return to_rd(node['lon'], node['lat'], 'OGC:CRS84')


def osm_records(document, frame):
    elements = document['elements']
    ramps, mainlines = defaultdict(list), defaultdict(list)
    for row in elements:
        highway = row.get('tags', {}).get('highway')
        if row['type'] != 'way' or highway not in {'motorway', 'motorway_link'}:
            continue
        if not row.get('nodes') or not row.get('geometry'):
            continue
        if highway == 'motorway_link':
            ramps[row['nodes'][0]].append(row)
        else:
            for node_id in row['nodes']:
                mainlines[node_id].append(row)
    for row in elements:
        tags = row.get('tags', {})
        node_id = row['id']
        if row['type'] != 'node' or tags.get('highway') != 'motorway_junction':
            continue
        connected = mainlines[node_id]
        exit_number = tags.get('ref')
        matching = [(way, ref) for way in connected for ref in tokens(way['tags'].get('ref'))
                    if exit_number in EXITS.get(ref, ())]
        if not matching:
            continue
        approach, road_ref = min(matching, key=lambda entry: (entry[0]['nodes'][0] == node_id, entry[0]['id']))
        candidates = ramps[node_id]
        ramp = min(candidates, key=lambda way: (not way['tags'].get('destination'), way['id']), default=None)
        ramp_tags = ramp['tags'] if ramp else {}
        destinations = tokens(ramp_tags.get('destination') or tags.get('destination') or tags.get('name'))
        if not destinations:
            continue
        rd = osm_point(row)
        i = approach['nodes'].index(node_id)
        other = osm_point(approach['geometry'][max(0, i - 1) if i else 1])
        tangent = scene_tangent(rd, (other[0] - rd[0], other[1] - rd[1]), frame)
        face = tangent if i else reverse(tangent)
        exit_record = {'id': f'osm:node:{node_id}', 'type': 'exit', 'exitNumber': exit_number,
                       'destinations': destinations,
                       'roadShields': tokens(ramp_tags.get('destination:ref') or tags.get('destination:ref')),
                       'roadRef': road_ref, 'isOverheadGantry': False, 'yaw': yaw(face),
                       'wayId': f"w{approach['id']}", 'layer': 0}
        yield rd, exit_record
    # Gantries with destination evidence stand alone. Unlabelled gantries cannot establish a sign face.
    for row in elements:
        tags = row.get('tags', {})
        exit_number = tags.get('junction:ref') or tags.get('exit_ref')
        road_ref = tags.get('ref')
        destinations = tokens(tags.get('destination'))
        if tags.get('man_made') != 'gantry' or exit_number not in EXITS.get(road_ref, ()) or not destinations:
            continue
        span = []
        if row['type'] == 'way' and row.get('geometry'):
            start, end = (osm_point(row['geometry'][i]) for i in (0, -1))
            rd = tuple((a + b) / 2 for a, b in zip(start, end))
            span = [list(frame.rd_to_scene(*p)) for p in (start, end)]
        elif row['type'] == 'node':
            rd = osm_point(row)
        else:
            continue
        direction = tags.get('direction')
        face = None
        if direction and direction.isdecimal():
            angle = radians(int(direction) + 180)
            face = scene_tangent(rd, (sin(angle), cos(angle)), frame)
        record = {'id': f"osm:{row['type']}:{row['id']}", 'type': 'exit', 'exitNumber': exit_number,
                  'destinations': destinations, 'roadShields': tokens(tags.get('destination:ref')),
                  'roadRef': road_ref, 'isOverheadGantry': True, 'yaw': yaw(face), 'layer': 0}
        if span:
            record['span'] = span
        yield rd, record



def surveyed_exits(signs, portals, frame):
    mounts = {row['id']: row for row in portals if row['type'] == 'gantry'}
    for sign in signs:
        mount = mounts.get(sign.get('mountId'))
        if mount is None:
            continue
        road_ref = mount.get('route')
        exit_number = {'A12': '24', 'A30': '1'}.get(road_ref)
        display = sign.get('displayText', [])
        if exit_number is None or exit_number not in display:
            continue
        shields = [line for line in display if re.fullmatch(r'[AEN]\d+', line)]
        destinations = [line for line in display
                        if line in sign.get('destinations', []) and line not in shields]
        if not destinations:
            continue
        rd = frame.scene_to_rd(*sign['position'])
        yield rd, {'id': sign['id'], 'type': 'exit', 'exitNumber': exit_number,
                   'destinations': destinations, 'roadShields': shields, 'roadRef': road_ref,
                   'isOverheadGantry': True, 'yaw': sign['angle'], 'layer': sign['level'],
                   'surveyedId': sign['id'], 'mountId': mount['id'], 'wayId': sign['wayId'],
                   'span': [mount['points'][0], mount['points'][-1]],
                   'panelWidth': sign['width'], 'panelHeight': sign['height'],
                   'observedNap': sign['observedNap'], 'centerNap': sign['centerY']}


def read_packed(path):
    with gzip.open(path, 'rt') as stream:
        return json.load(stream)


def index_records(records, boundary, frame):
    origin = frame.scene_to_rd(0, 0)
    cells, identities = defaultdict(list), set()
    prepare(boundary)
    for rd, record in records:
        x, z = frame.rd_to_scene(*rd)
        if record['id'] in identities or not boundary.covers(Point(x, z)):
            continue
        identities.add(record['id'])
        record.update(rdX=rd[0], rdY=rd[1],
                      sceneCorrection=[x - (rd[0] - origin[0]), z - (origin[1] - rd[1])])
        cells[f'{floor(x / CELL_SIZE)}/{floor(z / CELL_SIZE)}'].append(record)
    return {'version': 1, 'cellSize': CELL_SIZE, 'rdOrigin': list(origin),
            'cells': {key: sorted(rows, key=lambda row: row['id']) for key, rows in sorted(cells.items())}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True, help='Directory for the downloadable source files')
    parser.add_argument('--fetch', action='store_true', help='Refresh all public source files first')
    osm_source = parser.add_mutually_exclusive_group()
    osm_source.add_argument('--osm-file', type=Path, help='Use a previously saved public Overpass-format extract')
    osm_source.add_argument('--osm-pbf', type=Path,
                            help='Use a Geofabrik Gelderland extract (requires osmium)')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-road-furniture.json.gz')
    args = parser.parse_args()
    boundary = load_playable_boundary()
    frame = Frame(load_scene_metadata()['lonLatAffine'])
    bbox = frame.geographic_bounds(boundary.bounds)
    if args.fetch:
        fetch(args.cache, bbox, args.osm_file, args.osm_pbf)
    source_meta_path = args.cache / 'sources.json'
    source_meta = json.loads(source_meta_path.read_bytes()) if source_meta_path.exists() else {}
    points = json.loads((args.cache / 'hectopunten.json').read_bytes())
    road_rows = json.loads((args.cache / 'wegvakken.json').read_bytes())
    roads = {}
    for road in sorted(road_rows, key=lambda row: row['properties'].get('wvk_begdat') or ''):
        roads[road['properties']['wvk_id']] = road
    if args.fetch:
        osm = json.loads((args.cache / 'osm.json').read_bytes())
    elif args.osm_pbf:
        osm = osm_from_pbf(args.osm_pbf, bbox)
    else:
        osm = json.loads((args.osm_file or args.cache / 'osm.json').read_bytes())
    min_x, min_z, max_x, max_z = boundary.bounds
    east, north = zip(*(frame.scene_to_rd(x, z) for x in (min_x, max_x) for z in (min_z, max_z)))
    rd_bounds = (min(east) - 10, min(north) - 10, max(east) + 10, max(north) + 10)
    nbd = read_packed(SURVEYED_SIGNS)
    gis = read_packed(SURVEYED_PORTALS)
    document = index_records(chain(hectos(points, roads, frame),
                                   rvv_signs(args.cache / 'ndw.geojson.gz', roads, frame, rd_bounds),
                                   osm_records(osm, frame),
                                   surveyed_exits(nbd['features'], gis['features'], frame)), boundary, frame)
    document['sources'] = {
        'boundary': 'GM0228',
        'nwb': {'hectopunten': f'{NWB}/hectopunten/items', 'wegvakken': f'{NWB}/wegvakken/items', 'license': 'CC0 1.0'},
        'ndw': {'url': NDW, 'lastModified': source_meta.get('ndwLastModified')},
        'osm': {'url': osm.get('osm3s', {}).get('source', OVERPASS),
                'timestamp': osm.get('osm3s', {}).get('timestamp_osm_base'), 'license': 'ODbL 1.0'},
        'surveyedGantryPanels': {
            'nbd': {'url': nbd['source'], 'date': nbd['date'], 'license': nbd['license']},
            '1gis': {'url': gis['source'], 'date': gis['date'], 'license': gis['license']},
        },
        'retrievedAt': source_meta.get('retrievedAt'),
    }
    data = (json.dumps(document, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()
    write_atomic(args.output, gzip.compress(data, mtime=0))
    counts = Counter(row['type'] for cell in document['cells'].values() for row in cell)
    print(f'Wrote {dict(counts)} in {len(document["cells"])} cells to {args.output}')


if __name__ == '__main__':
    main()
