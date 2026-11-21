"""Import Ede's public point inventories into the offline street-detail bake."""

from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
import gzip
import json
import math
from pathlib import Path
import subprocess
from urllib.parse import urlencode
from xml.etree import ElementTree

from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points

from ede_gis import Frame, source_crs

ROOT = Path(__file__).resolve().parents[1]
WFS = 'https://geo.ede.nl/geoserver/Ede/wfs'
LAYERS = {'bin': 'mor_afvalbakken', 'container': 'mor_acv_containers', 'playSite': 'mor_speelplekken'}
NATIVE_CRS = {'bin': 28992, 'container': 4326, 'playSite': 4326}
GATE_TAGS = {'gate', 'lift_gate', 'swing_gate', 'kissing_gate', 'entrance', 'cycle_barrier'}
MOTOR_PAVEMENT = {'ov-baan', 'verbindingsweg', 'overweg', 'verkeersdrempel', 'woonerf', 'inrit'}
MODELS = {
    'bin': {'generic': (.46, .46, .91), 'greenPost': (.48, .53, 1.02), 'city-split': (.42, .74, 1.02)},
    'container': {'generic': (.68, .68, 1.05), 'underground': (.68, .72, .98), 'surface': (1.03, 1.10, 1.37), 'semi-underground': (.95, 1.0, 1.17)},
}


def fetch(directory, geographic_bounds):
    directory.mkdir(parents=True, exist_ok=True)

    def download(layer):
        query = urlencode({'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature',
                           'typeNames': f'Ede:{layer}', 'outputFormat': 'application/json', 'count': 100000})
        raw = subprocess.check_output(['curl', '-fsSL', '--retry', '2', '--max-time', '25', f'{WFS}?{query}'])
        data = json.loads(raw)
        if not data.get('features') or data.get('numberMatched') != len(data['features']):
            raise ValueError(f'Incomplete municipal snapshot: {layer}')
        (directory / f'{layer}.json').write_bytes(raw)

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(download, LAYERS.values()))

    if not (directory / 'access.json').exists():
        bounds = ','.join(map(str, geographic_bounds))
        patterns = ['[entrance]', '[barrier~"^(gate|lift_gate|swing_gate|kissing_gate|entrance|cycle_barrier)$"]', '[kerb=lowered]']
        query = '[out:json][timeout:18];(' + ''.join(f'node{pattern}({bounds});' for pattern in patterns) + ');out;'
        for host in ('overpass.kumi.systems', 'overpass-api.de'):
            try:
                raw = subprocess.check_output(['curl', '-fsS', '--max-time', '24',
                                               f'https://{host}/api/interpreter?{urlencode({"data": query})}'])
                if not json.loads(raw).get('remark'):
                    (directory / 'access.json').write_bytes(raw)
                    break
            except (subprocess.CalledProcessError, ValueError):
                continue
        else:
            try:
                fetch_access_tiles(directory, geographic_bounds)
            except (subprocess.CalledProcessError, ValueError, ElementTree.ParseError):
                print('OSM access cache unavailable. Using fitted crossing, path and pavement clearance.', flush=True)


def fetch_access_tiles(directory, geographic_bounds):
    south, west, north, east = geographic_bounds
    nx, nz = math.ceil((east - west) / .017), math.ceil((north - south) / .012)
    xs = [west + (east - west) * x / nx for x in range(nx + 1)]
    zs = [south + (north - south) * z / nz for z in range(nz + 1)]
    boxes = [(a, b, c, d) for a, c in zip(xs, xs[1:]) for b, d in zip(zs, zs[1:])]

    def retrieve(bounds, depth=0):
        box_string = ','.join(f'{n:.8f}' for n in bounds)
        url = 'https://api.openstreetmap.org/api/0.6/map?bbox=' + box_string
        command = ['curl', '-fsS', '--compressed', '--max-time', '20', '--user-agent',
                   'Ede in 3D offline furniture audit (github.com/rolandsmeenk/ede-in-3d)', url]
        try:
            raw = subprocess.check_output(command)
        except subprocess.CalledProcessError:
            if depth >= 1:
                raise
            a, b, c, d = bounds
            m, k = (a + c) / 2, (b + d) / 2
            return [node for sub in [(a,b,m,k), (m,b,c,k), (a,k,m,d), (m,k,c,d)] for node in retrieve(sub, depth + 1)]
        nodes = []
        for node in ElementTree.fromstring(raw).findall('node'):
            tags = {tag.attrib['k']: tag.attrib['v'] for tag in node.findall('tag')}
            if 'entrance' in tags or tags.get('barrier') in GATE_TAGS or tags.get('kerb') == 'lowered':
                nodes.append({'id': int(node.attrib['id']), 'lon': float(node.attrib['lon']),
                              'lat': float(node.attrib['lat']), 'tags': tags})
        return nodes

    with ThreadPoolExecutor(max_workers=3) as pool:
        nodes = {node['id']: node for tile in pool.map(retrieve, boxes) for node in tile}
    access = {'source': 'https://api.openstreetmap.org/api/0.6/map',
              'retrieved': datetime.now(timezone.utc).date().isoformat(),
              'elements': sorted(nodes.values(), key=lambda node: node['id'])}
    (directory / 'access.json').write_text(json.dumps(access, separators=(',', ':')) + '\n')


def points(data, kind, frame, bounds):
    layer = LAYERS[kind]
    if (data.get('type') != 'FeatureCollection' or source_crs(data).to_epsg() not in {NATIVE_CRS[kind], 28992}
            or data.get('numberMatched') != len(data['features']) or not data.get('timeStamp')):
        raise ValueError(f'Unexpected {layer} response, verify snapshot completeness and CRS')
    result = []
    seen = set()
    for row in data['features']:
        identity = row.get('properties', {}).get('kvid')
        key = row.get('id')
        geometry = row.get('geometry') or {}
        coords = geometry.get('coordinates', ())
        # GeoServer declares geographic coordinates on two layers. Validate raw RD ranges before the override.
        if (type(identity) is not int or key != f'{layer}.{identity}' or key in seen
                or geometry.get('type') != 'Point' or len(coords) != 2
                or not (145000 < coords[0] < 200000 and 425000 < coords[1] < 485000)):
            raise ValueError(f'Unexpected RD coordinate or stable identifier: {row}')
        seen.add(key)
        x, z = frame.rd_to_scene(*coords)
        if bounds[0] <= x <= bounds[2] and bounds[1] <= z <= bounds[3]:
            result.append({'id': key, 'rd': coords, 'position': (x, z), 'kvid': identity})
    return sorted(result, key=lambda row: row['kvid'])


def grouped(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[tuple(round(v, 5) for v in row['rd'])].append(row)
    return list(groups.values())


def read_json(path):
    if path.suffix == '.gz':
        with gzip.open(path, 'rt') as source:
            return json.load(source)
    return json.loads(path.read_bytes())


def walk_obstacles(directory, frame, scene, detail, evidence):
    obstacles = defaultdict(list)
    supporting, parking = [], []
    walking_lines, road_lines = [], []
    asphalt = read_json(ROOT / 'assets/ede-road-surfaces.json.gz')
    for road in asphalt['surfaces']:
        kind = road['function']
        shapes = [detail['flat_polygon'](outer, holes) for outer, *holes in road['polygons']]
        if road['layer']:
            obstacles['ambiguous-elevation'].extend(shapes)
        elif kind.startswith('rijbaan ') or kind in MOTOR_PAVEMENT | {'fietspad'}:
            obstacles['vehicle-or-cycle-paving'].extend(shapes)
        else:
            supporting.extend(shape for shape in shapes if not shape.is_empty)
            if kind == 'parkeervlak':
                parking.extend(shapes)
    covered = asphalt['covered']
    for road in scene['roads']:
        mode = road['modes'][0] | road['modes'][1]
        if not mode:
            continue
        width = road.get('bgt', {}).get('width') or road['width']
        shape = LineString(detail['BGT']['pairs'](road['pts']))
        if shape.length < .05:
            continue
        if road['bridge'] or road['tunnel'] or road['layer']:
            obstacles['ambiguous-elevation'].append(shape.buffer(width / 2 + .1, cap_style='flat'))
            continue
        if road['kind'] == 'cycleway':
            obstacles['vehicle-or-cycle-paving'].append(shape.buffer(width / 2, cap_style='flat'))
        elif mode & 7:
            road_lines.append(shape)
            for i, (a, b) in enumerate(zip(shape.coords, list(shape.coords)[1:])):
                if i not in covered.get(road['id'], ()) and a != b:
                    obstacles['vehicle-or-cycle-paving'].append(LineString([a,b]).buffer(width / 2, cap_style='flat'))
        else:
            walking_lines.append(shape)
            obstacles['walking-line'].append(shape.buffer(min(width / 2, .70), cap_style='flat'))
        for cycle in road.get('cycle', []):
            if cycle.get('offset'):
                shoulder = shape.offset_curve(cycle['offset'])
                obstacles['vehicle-or-cycle-paving'].append(shoulder.buffer(cycle.get('width', 1.4) / 2, cap_style='flat'))

    _, _, boarding, structures, _, trees, lamps, buildings = evidence
    obstacles['boarding-area'] = [shape for _, _, shape in boarding]
    obstacles['solid-structure'] = [shape for level, shape in structures if level == 0]
    obstacles['building'] = list(buildings.geometries)
    obstacles['water'] = [detail['flat_polygon'](item['ring'], item.get('holes', ())) for item in scene['water']]
    crossings = read_json(ROOT / 'assets/ede-street-features.json.gz')['crossings']
    for row in crossings:
        if row.get('layer'):
            continue
        points = [s['point'] for s in row.get('sidewalks', []) if 'point' in s]
        if not points:
            points = row.get('ends', [])
        obstacles['entrance-or-ramp'].extend(Point(p).buffer(.85) for p in points)
    access_path = directory / 'access.json'
    access_source = None
    if access_path.is_file():
        access = read_json(access_path)
        access_source = {'date': access.get('osm3s', {}).get('timestamp_osm_base') or access.get('retrieved'),
                         'url': access.get('source', 'https://overpass-api.de/api/interpreter'),
                         'nodes': len(access['elements'])}
        for node in access['elements']:
            tags = node.get('tags', {})
            if tags.get('layer', '0') != '0':
                continue
            location = frame.lon_lat_to_scene(node['lon'], node['lat'])
            obstacles['entrance-or-ramp'].append(Point(location).buffer(1 if 'barrier' in tags else .85))

    areas = {key: STRtree([shape for shape in value if not shape.is_empty]) for key, value in obstacles.items()}
    parks = STRtree([detail['flat_polygon'](item['ring'], item.get('holes', ())) for item in scene['parks'] + scene['squares']])
    return areas, STRtree(supporting), parks, STRtree(walking_lines), STRtree(road_lines), STRtree(parking), trees, lamps, access_source


def placement(point, model, indexes, furniture, ignore, footprint, survey_angle=None):
    areas, pavement, parks, walking, roads, parking, trees, lamps, _ = indexes
    length, width, height = model

    def nearby_line(tree, distance):
        indices = tree.query(point, predicate='dwithin', distance=distance)
        return min((tree.geometries[i] for i in indices), key=lambda line: line.distance(point), default=None)

    def support(at):
        if len(pavement.query(at, predicate='intersects')):
            return 'BGT ground paving', .065
        if len(parks.query(at, predicate='intersects')):
            return 'mapped park or square', .05
        return 'AHN ground', 0

    foot = nearby_line(walking, 8)
    road = nearby_line(roads, 14)
    facing = 'mapped walking approach' if foot is not None else 'away from carriageway' if road is not None else 'neutral axis'
    reference = foot if foot is not None else road
    angle = 0
    if reference is not None:
        anchor = nearest_points(reference, point)[0]
        dx, dz = anchor.x - point.x, anchor.y - point.y
        angle = math.atan2(dx, dz) + (math.pi if foot is None else 0)

    if survey_angle is not None:
        angle = survey_angle
        facing = 'reviewed facade photo'

    def checks(location):
        hull = footprint(location, angle, length + .06, width + .06)
        reasons = [name for name, tree in areas.items() if len(tree.query(hull, predicate='intersects'))]
        # Kerbside collection pads can share a parking polygon boundary. Keep stalls and aprons free.
        pads = [parking.geometries[i] for i in parking.query(hull, predicate='intersects')]
        if any(pad.contains(location) and pad.boundary.distance(location) > .12
               or pad.intersection(hull).area > hull.area * .32 for pad in pads):
            reasons.append('parking-apron-clearance')
        if len(trees.query(hull, predicate='dwithin', distance=.12)):
            reasons.append('tree-clearance')
        if len(lamps.query(hull, predicate='dwithin', distance=.08)):
            reasons.append('lamp-clearance')
        ids, tree = furniture
        if any(ids[i] != ignore for i in tree.query(hull, predicate='intersects')):
            reasons.append('existing-furniture')
        return reasons

    source_point = Point(round(point.x, 2), round(point.y, 2))
    target = source_point
    reasons = checks(target)
    if reasons == ['building'] and survey_angle is not None:
        # The photo shows this surveyed bin immediately outside the facade.
        for move in (.15, .30, .45, .60):
            adjusted = Point(round(target.x + math.sin(angle) * move, 2),
                             round(target.y + math.cos(angle) * move, 2))
            if not checks(adjusted):
                target, reasons = adjusted, []
                break
    if reasons == ['walking-line'] and foot is not None:
        nearest = foot.interpolate(foot.project(target))
        dx, dz = target.x - nearest.x, target.y - nearest.y
        distance = math.hypot(dx, dz)
        if distance > .12:
            for move in (.20, .40):
                adjusted = Point(round(target.x + dx * move / distance, 2), round(target.y + dz * move / distance, 2))
                if support(adjusted) == support(target) and not checks(adjusted):
                    target, reasons = adjusted, []
                    break
    if reasons:
        return None, {'reasons': reasons}
    surface, base_offset = support(target)
    item = {'position': [target.x, target.y], 'angle': round(angle, 4), 'height': height,
            'length': length, 'width': width, 'baseOffset': base_offset, 'collidable': True}
    return item, {'support': surface, 'orientation': facing, 'adjustment': round(point.distance(target), 3)}


def outline_matches(plays, scene, survey, detail):
    parks = [park for park in scene['parks'] if park['kind'] == 'playground']
    shapes = [detail['flat_polygon'](park['ring'], park.get('holes', ())) for park in parks]
    tree = STRtree(shapes)
    pilots = {site['id']: site for site in survey.get('sites', [])}
    matches = []
    for row in plays:
        point = Point(row['position'])
        possible = sorted((shapes[i].distance(point), parks[i]['id'])
                          for i in tree.query(point, predicate='dwithin', distance=4))
        match = {'id': row['id'], 'position': [round(v, 2) for v in row['position']], 'rd': row['rd']}
        if pilot := pilots.get(row['id']):
            match.update(status='surveyed', osmId=pilot['osmId'], name=pilot['name'])
        elif possible and (len(possible) == 1 or possible[1][0] - possible[0][0] >= 1):
            match.update(status='outline-match', osmId=possible[0][1], outlineDistance=round(possible[0][0], 2))
        else:
            match.update(status='ambiguous' if possible else 'unmatched', candidates=[x[1] for x in possible])
        matches.append(match)
    return matches, len(parks)


def bake(directory, scene, base_asset, detail, acv_profiles, survey, bin_profiles):
    bounds = scene['meta']['bounds']
    frame = Frame(scene['meta']['lonLatAffine'])
    data = {kind: read_json(directory / f'{layer}.json') for kind, layer in LAYERS.items()}
    rows = {kind: points(document, kind, frame, bounds) for kind, document in data.items()}
    play_sites, outline_count = outline_matches(rows['playSite'], scene, survey, detail)
    evidence = detail['build_evidence'](scene, box(*bounds).buffer(15), tree_path=ROOT / 'assets/ede-trees-expanded.bin')
    indexes = walk_obstacles(directory, frame, scene, detail, evidence)

    old = base_asset['features']
    suppress = {item['id'] for item in old if item['type'] == 'playground'}
    features, records = [], {}
    occupied = []
    blocking_types = {'bench', 'bikeRack', 'shelter', 'bollard', 'bin', 'container'}
    baseline = [item for item in old if item['type'] in blocking_types and item.get('position') and not item.get('level')]
    existing = {kind: [item for item in baseline if item['type'] == kind] for kind in ('bin', 'container')}
    footprint = detail['footprint']
    furniture = ([item['id'] for item in baseline], STRtree([footprint(
        Point(item['position']), item['angle'], item['length'], item['width']) for item in baseline]))
    controls = {}
    for kind in ('bin', 'container'):
        groups = grouped(rows[kind])
        references = existing[kind]
        refs = STRtree([Point(item['position']) for item in references])
        distance = 1.5 if kind == 'bin' else 1.8
        pairs = []
        for i, group in enumerate(groups):
            point = Point(group[0]['position'])
            pairs.extend((point.distance(refs.geometries[j]), i, j)
                         for j in refs.query(point, predicate='dwithin', distance=distance))
        geometric_distances = defaultdict(list)
        for d, i, j in sorted(pairs):
            geometric_distances[i].append((d, j))

        used_rows, used_refs = {}, set()
        for d, i, j in sorted(pairs):
            choices = geometric_distances[i]
            ambiguous = len(choices) > 1 and choices[1][0] - choices[0][0] < .30
            if not ambiguous and i not in used_rows and j not in used_refs and j == choices[0][1]:
                used_rows[i] = d, references[j]
                used_refs.add(j)
        control_pairs = sorted((d, groups[i][0]['id'], item['id']) for i, (d, item) in used_rows.items() if d < .45)
        controls[kind] = [{'municipalId': m, 'bgtId': b, 'residualMetres': round(d, 3)} for d, m, b in control_pairs[:4]]

        records[kind] = []
        for i, group in enumerate(groups):
            point = Point(group[0]['position'])
            identity = group[0]['id']
            linked = used_rows.get(i)
            matched = linked[1]['id'] if linked else None
            audit = {'id': identity, 'type': kind, 'sourceIds': [r['id'] for r in group], 'sourceRD': group[0]['rd'],
                     'sourcePosition': [round(v, 2) for v in group[0]['position']], 'bgtMatch': matched}
            if linked:
                audit['bgtDistance'] = round(linked[0], 3)
            if not linked and i in geometric_distances:
                audit.update(status='review', reasons=['ambiguous-bgt-match'])
                records[kind].append(audit)
                continue
            metadata = {}
            if kind == 'container':
                for row in group:
                    attributes = acv_profiles.get(row['id'])
                    if attributes and math.dist(attributes['rd'], row['rd']) <= .02:
                        metadata[row['id']] = attributes
                    elif attributes:
                        audit.setdefault('staleTypeEvidence', []).append(row['id'])
            models = {entry['profile'] for entry in metadata.values() if entry.get('profile')}
            model = next(iter(models)) if len(models) == 1 else 'generic'
            litter = bin_profiles.get(identity) if kind == 'bin' else None
            if litter and math.dist(litter['rd'], group[0]['rd']) <= .02:
                model = litter['model']
                audit['typeEvidence'] = litter
            else:
                litter = None
            if model not in MODELS[kind]:
                raise ValueError(f'Unknown furniture model: {model}')
            streams = sorted({stream for entry in metadata.values() for stream in entry.get('streams', ())})
            if metadata:
                audit['typeEvidence'] = metadata
            dims = MODELS[kind][model]
            placement_data, details = placement(point, dims, indexes, furniture, matched, footprint,
                                                litter['angle'] if litter else None)
            audit.update(details)
            if placement_data:
                hull = footprint(Point(placement_data['position']), placement_data['angle'], dims[0] + .10, dims[1] + .10)
                if any(hull.intersects(other) for other in occupied):
                    placement_data = None
                    audit['reasons'] = ['municipal-fixture-clearance']
                else:
                    occupied.append(hull)
            if placement_data:
                fixture = {'type': kind, 'id': identity, 'level': 0, 'model': model, **placement_data}
                if streams:
                    fixture['streams'] = streams
                features.append(fixture)
                audit.update(status='placed', renderPosition=fixture['position'], model=model)
                if matched:
                    suppress.add(matched)
            else:
                audit['status'] = 'review'
            records[kind].append(audit)

    for site in survey.get('sites', []):
        if site['id'] not in {match['id'] for match in play_sites}:
            raise ValueError(f'Playground survey has unknown municipal ID: {site["id"]}')
        area = Polygon(site['boundary']).buffer(1)
        for feature in site['features']:
            geometry = detail['feature_geometry'](feature)
            if feature['type'] not in {'playEquipment', 'playSurface'} or geometry.is_empty or not area.covers(geometry):
                raise ValueError(f'Invalid surveyed playground placement: {feature["id"]}')
            features.append(feature)
        suppress.update(site.get('replaces', []))

    control_play = [site for site in play_sites if site['status'] == 'surveyed']
    controls['playSite'] = [{'municipalId': s['id'], 'osmId': s['osmId'], 'name': s['name']} for s in control_play]
    source = {'name': 'Gemeente Ede', 'url': WFS, 'accessConstraints': 'NONE at service level', 'licence': 'Not stated for these layers'}
    counts = dict(Counter(feature['type'] for feature in features))
    metadata = {kind: {'layer': f'Ede:{LAYERS[kind]}', 'timestamp': document['timeStamp'],
                       'declaredCrs': f'EPSG:{source_crs(document).to_epsg()}', 'usedCrs': 'EPSG:28992',
                       'total': document['numberMatched'], 'inBounds': len(rows[kind]), 'distinct': len(grouped(rows[kind])),
                       'sha256': sha256((directory / f'{LAYERS[kind]}.json').read_bytes()).hexdigest()}
                for kind, document in data.items()}
    audit = {'version': 1, 'source': source, 'snapshot': metadata, 'controls': controls, 'access': indexes[-1],
             'baseline': {**{kind: len(refs) for kind, refs in existing.items()}, 'osmPlaygroundOutlines': outline_count},
             'counts': counts, 'records': records, 'playSites': play_sites, 'replaces': sorted(suppress),
             'surveyedPlaygrounds': [{k: v for k, v in row.items() if k != 'features'} for row in survey.get('sites', [])]}
    return {'version': 1, 'source': source, 'features': features, 'replaces': sorted(suppress)}, audit
