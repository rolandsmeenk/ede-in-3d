#!/usr/bin/env python3
"""Bake the Lunteren track profile, public crossings and station platforms."""
import argparse
import gzip
import json
from math import atan2, hypot, inf, isfinite
from pathlib import Path
from statistics import median
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
import rasterio

from ede_gis import Frame, source_crs
from ede_map import load_playable_scene
from ede_raster import require_rd_raster, sample_bilinear
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
SOUTH = 'w431762038'
LOOP = ('w431760849', 'w431760850')
NORTH_APPROACH = 'w1299229167'
NORTH_EDGE_BRIDGE = 'w6305163'
TRACKS = {SOUTH: 7794, 'w431760968': 7794, LOOP[0]: None, LOOP[1]: None,
          'w227525838': 1075, 'w431725851': 1075, NORTH_APPROACH: 1075}
CONCRETE_PLATFORM_RISE = .89  # Above base of ballast. Railhead is 0.13 m above the same base.
ROAD_TOP = .055
PRORAIL = 'https://maps.prorail.nl/arcgis/rest/services/'
WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'


def read(path):
    with (gzip.open(path, 'rt') if path.suffix == '.gz' else path.open()) as handle:
        return json.load(handle)


def fetch_snapshot(directory):
    directory.mkdir(parents=True, exist_ok=True)

    def fetch(path, url, query):
        if path.is_file():
            return
        request = Request(f'{url}?{urlencode(query, doseq=True)}', headers={'User-Agent': 'Ede-in-3D public geometry bake'})
        with urlopen(request, timeout=45) as response:
            content = response.read()
        if path.suffix == '.json' and 'features' not in json.loads(content):
            raise ValueError(f'Incomplete ProRail response for {path.name}')
        if path.suffix == '.tif' and not content.startswith((b'II', b'MM')):
            raise ValueError(f'Expected an AHN GeoTIFF for {path.name}')
        temporary = path.with_suffix('.part')
        temporary.write_bytes(content)
        temporary.replace(path)

    for prefix, service, layers, bbox, where in [
        ('pro', 'ProRail_basiskaart/FeatureServer', [0, 7, 9], '5.592,52.0605,5.674,52.119', 'GEOCODE_NR=211'),
        ('transfer', 'Transfer/MapServer', [2, 7, 9], '5.622,52.084,5.626,52.088', 'GEOCODE_NR=211'),
    ]:
        for layer in layers:
            fetch(directory / f'{prefix}-{layer}.json', f'{PRORAIL}{service}/{layer}/query',
                  dict(f='json', geometry=bbox, geometryType='esriGeometryEnvelope', inSR=4326, outSR=4326,
                       spatialRel='esriSpatialRelIntersects', outFields='*', returnZ='true', where=where))

    def dtm(label, x0, y0, x1, y1):
        fetch(directory / f'ahn-{label}.tif', WCS,
              dict(service='WCS', request='GetCoverage', version='2.0.1', coverageId='dtm_05m',
                   format='image/tiff', subset=[f'x({x0},{x1})', f'y({y0},{y1})']))

    dtm('platforms', 171145, 455160, 171310, 455400)
    for row in read(directory / 'pro-0.json')['features']:
        attrs = row['attributes']
        if attrs['KARAKTER'].startswith('Openbare') and attrs['IN_GEBRUIK'] == 'Ja':
            x, y = round(attrs['X']), round(attrs['Y'])
            dtm(attrs['OBJECTID'], x - 50, y - 50, x + 50, y + 50)


def geometry(points):
    return list(zip(points[::2], points[1::2]))


def ahn_sampler(path, frame):
    with rasterio.open(path) as raster:
        require_rd_raster(raster)
        if raster.res != (.5, .5):
            raise ValueError(f'{path} must be native 0.5 m AHN')
        pixels, transform = raster.read(1, masked=True).filled(np.nan), raster.transform

    def ground(x, z):
        height = sample_bilinear(pixels, transform, *frame.scene_to_rd(x, z), footprint=.75).item()
        return height - SCENE_NAP_ORIGIN if isfinite(height) else None

    return ground


class Line:
    def __init__(self, points):
        self.points = points
        self.spans = []
        self.length = 0
        for a, b in zip(points, points[1:]):
            dx, dz = b[0] - a[0], b[1] - a[1]
            length = hypot(dx, dz)
            if length:
                self.spans.append((a, b, dx, dz, length, self.length))
                self.length += length

    def project(self, x, z):
        best = (inf, 0, self.points[0])
        for a, b, dx, dz, length, start in self.spans:
            t = min(1, max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / length**2))
            hit = self.mix(a, b, t)
            error = hypot(x - hit[0], z - hit[1])
            if error < best[0]:
                best = (error, start + t * length, hit)
        return best

    @staticmethod
    def mix(a, b, t):
        return tuple(v + (w - v) * t for v, w in zip(a, b))

    def at(self, distance):
        for a, b, _, _, length, start in self.spans:
            if distance <= start + length:
                return self.mix(a, b, max(0, (distance - start) / length))
        return self.points[-1]

    def samples(self, step, start=0, end=None):
        end = self.length if end is None else end
        values = {start, end}
        values.update(d for *_, d in self.spans if start <= d <= end)
        values.update(start + i * step for i in range(1, int((end - start) / step) + 1))
        return sorted(values)


def rounded(point, digits=3):
    return [round(value, digits) for value in point]


def extend_municipal_rails(profiles, ways, survey):
    """Continue the northbound track to the municipal edge on the same ProRail centerline."""
    by_id = {way['id']: way for way in ways}
    if NORTH_EDGE_BRIDGE not in by_id:
        return
    approach = next(profile for profile in profiles if profile['wayId'] == NORTH_APPROACH)
    line = Line(geometry(by_id[NORTH_APPROACH]['pts']))
    x, z, anchor_y = approach['points'][-1]
    seam_error, start, _ = line.project(x, z)
    if seam_error > 1 or not start < line.length:
        raise ValueError('Old northern rail end does not align with the full OSM way')
    _, _, old_seam = survey.project(x, z)
    offset = anchor_y - old_seam[2]

    def measured(x, z):
        distance, _, point = survey.project(x, z)
        if distance > 5:
            raise ValueError(f'Northern rail leaves ProRail survey at {(x, z)} by {distance:.2f} m')
        return point[2]

    for distance in line.samples(6, start)[1:]:
        x, z = line.at(distance)
        weight = max(0, 1 - (distance - start) / 30)
        approach['points'].append(rounded((x, z, measured(x, z) + offset * weight)))

    edge = by_id[NORTH_EDGE_BRIDGE]
    xy = geometry(edge['pts'])
    anchor = tuple(approach['points'][-1][:2])
    if xy[-1] == anchor:
        xy.reverse()
    if xy[0] != anchor:
        raise ValueError('Disconnected bridge at the northern municipal rail boundary')
    points = [approach['points'][-1], *(rounded((x, z, measured(x, z))) for x, z in xy[1:])]
    for vertices in (approach['points'], points):
        if any(abs(a[2] - b[2]) > .03 * hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(vertices, vertices[1:])):
            raise ValueError('Extended northern rail grade exceeds 3%')
    profiles.append(dict(wayId=NORTH_EDGE_BRIDGE, bridge=edge['bridge'], points=points))


def bake(args):
    base = read(ROOT / 'assets/ede-map-v1.json.gz')
    corridor = read(ROOT / 'assets/ede-corridors-v1.json.gz')
    north = read(args.overlay)
    old_grade = read(ROOT / 'assets/ede-grade.json')
    frame = Frame(base['meta']['lonLatAffine'])
    railways = {w['id']: w for layer in (base, corridor, north) for w in layer.get('railways', [])}
    roads = {w['id']: w for layer in (base, corridor, north) for w in layer.get('roads', [])}
    rails = {key: Line(geometry(railways[key]['pts'])) for key in TRACKS}

    def source(name):
        data = read(args.cache / f'{name}.json')
        crs = source_crs(data)
        return data['features'], lambda x, y, *_: frame.to_scene(x, y, crs, axis_order='xy')

    pro_tracks, pro_xy = source('pro-9')
    surveyed = {f['attributes']['OBJECTID']: Line([
        (*pro_xy(*point), point[2] - SCENE_NAP_ORIGIN)
        for path in f['geometry']['paths'] for point in path])
        for f in pro_tracks}
    for key in LOOP:
        x, z = rails[key].at(rails[key].length / 2)
        TRACKS[key] = min((3273, 5667), key=lambda number: surveyed[number].project(x, z)[0])
    if len({TRACKS[key] for key in LOOP}) != 2:
        raise ValueError('Station loop tracks must match two different ProRail objects')
    existing = Line(next(c['points'] for c in old_grade['railCorridors'] if c['wayId'] == SOUTH))

    def bed(key, x, z):
        measured = surveyed[TRACKS[key]].project(x, z)[2][2]
        if key != SOUTH or z <= -1800:
            return measured
        previous = existing.project(x, z)[2][2]
        t = min(1, max(0, (-z - 1350) / 450))
        return previous + t * t * (3 - 2 * t) * (measured - previous)

    at_endpoint = {}
    for key, line in rails.items():
        for x, z in [line.points[0], line.points[-1]]:
            at_endpoint.setdefault((x, z), []).append(bed(key, x, z))

    # bounds is [minX,minZ,maxX,maxZ]. Draw only a train-length approach beyond the terrain.
    limit_z = north['bounds'][1] - 123
    rail_corridors = []
    fits = {}
    for key, line in rails.items():
        points = []
        for d in line.samples(6):
            x, z = line.at(d)
            if z < limit_z:
                # Add the exact artificial track end where the longest OSM way
                # continues beyond the playable world.
                if points and points[-1][1] >= limit_z:
                    x = points[-1][0] + (x - points[-1][0]) * (limit_z - points[-1][1]) / (z - points[-1][1])
                    points.append(rounded((x, limit_z, bed(key, x, limit_z))))
                continue
            y = sum(at_endpoint[x, z]) / len(at_endpoint[x, z]) if (x, z) in at_endpoint else bed(key, x, z)
            points.append(rounded((x, z, y)))
        if key == SOUTH:
            points = [p for p in existing.points if p[1] >= -1350] + [p for p in points if p[1] < -1350]
        fits[key] = Line(points)
        rail_corridors.append(dict(wayId=key, bridge=False, points=points))

    municipality = load_playable_scene(include_shorelines=False)
    extend_municipal_rails(rail_corridors, municipality['railways'], surveyed[TRACKS[NORTH_APPROACH]])

    platform_faces, face_xy = source('transfer-2')
    deck_features, deck_xy = source('transfer-7')
    platforms = []
    for face in platform_faces:
        props = face['attributes']
        if props['STATIONSNAAM'] != 'Lunteren' or props['DIENSTREGELPUNTSPOORNAAM'] not in {'1', '2'}:
            continue
        number = props['DIENSTREGELPUNTSPOORNAAM']
        edge = Line([face_xy(*point) for point in face['geometry']['paths'][0]])
        center = edge.at(edge.length / 2)
        way = min(LOOP, key=lambda key: rails[key].project(*center)[0])
        deck_id = {'1': 576, '2': 577}[number]
        deck = next(f for f in deck_features if f['attributes']['OBJECTID'] == deck_id)
        polygon = [rounded(deck_xy(*p)) for p in deck['geometry']['rings'][0][:-1]]
        slopes = [rounded((x, z, fits[way].project(x, z)[2][2] + CONCRETE_PLATFORM_RISE)) for x, z in (edge.points[0], edge.points[-1])]
        error, _, stop = rails[way].project(*center)
        platforms.append(dict(number=number, wayId=way, stop=rounded(stop), polygon=polygon,
                              edge=[rounded(p) for p in edge.points], slope=slopes, sourceId=deck_id,
                              bgtId=deck['attributes']['BGT_ID']))
        print(f'Platform {number}: {way}, ProRail track {TRACKS[way]}, platform-to-track distance {error:.2f} m')

    access, access_xy = source('transfer-9')
    ramps = []
    ground = ahn_sampler(args.cache / 'ahn-platforms.tif', frame)
    for ramp in access:
        ring = [access_xy(*p) for p in ramp['geometry']['rings'][0][:-1]]
        x = sum(p[0] for p in ring) / len(ring)
        z = sum(p[1] for p in ring) / len(ring)
        platform = min(platforms, key=lambda p: Line(p['polygon'] + p['polygon'][:1]).project(x, z)[0])
        line = Line(platform['slope'])
        projected = [(line.project(x, z)[1], (x, z)) for x, z in ring]
        # Along-track ends are known deck joints at the north/south noses.
        nose = min((0, line.length), key=lambda d: abs(d - median(t for t, _ in projected)))
        tip = line.at(nose)
        run = ((line.points[-1][0] - line.points[0][0]) / line.length,
               (line.points[-1][1] - line.points[0][1]) / line.length)
        outwards = -1 if nose == 0 else 1
        distances = [(p[0] - tip[0]) * run[0] * outwards + (p[1] - tip[1]) * run[1] * outwards for p in ring]
        runout = max(distances)
        far = (tip[0] + run[0] * outwards * runout, tip[1] + run[1] * outwards * runout)
        low = ground(*ring[distances.index(runout)])
        if low is None or runout <= 1:
            raise ValueError(f'Insufficient surveyed ramp approach {ramp["attributes"]["OBJECTID"]}')
        ramps.append(dict(id=ramp['attributes']['OBJECTID'], platform=platform['number'],
                          polygon=[rounded(p) for p in ring],
                          slope=[rounded(tip), rounded((*far, low))]))

    # Shared OSM nodes identify the permitted at-grade paths. ProRail establishes
    # location, control type and track count independently of the road graph.
    osm = read(args.osm)
    nodes = {n['id']: n for n in osm['elements'] if n['type'] == 'node' and n.get('tags', {}).get('railway') in ('level_crossing', 'crossing')}
    osm_lines = {f"w{w['id']}": w for w in osm['elements'] if w['type'] == 'way'}
    contacts = []
    for key in rails:
        raw = osm_lines.get(key)
        if raw is None:
            continue
        for node_id in set(raw['nodes']) & nodes.keys():
            node = nodes[node_id]
            xy = frame.lon_lat_to_scene(node['lon'], node['lat'])
            error, _, point = rails[key].project(*xy)
            if error <= 0.8 and point[1] >= limit_z:
                choices = [id for id, w in roads.items() if not (w.get('layer') or w.get('bridge') or w.get('tunnel'))
                           and node_id in w.get('nodeIds', ())]
                if choices:
                    contacts.append(dict(nodeId=node_id, railWayId=key, x=point[0], z=point[1], raw=xy, ways=choices))

    crossing_features, crossing_xy = source('pro-0')
    # This parallel public footway has separate full barriers in OSM. Its
    # crossing is eight metres north of the Boslaan road and has no own record
    # in ProRail’s public layer. The same AHN clip covers both.
    separate_footway = 4369359172
    node = nodes.get(separate_footway)
    if node and all(node['tags'].get(f'crossing:{key}') == value for key, value in
                    dict(activation='automatic', barrier='full', light='yes').items()):
        crossing_features.append(dict(
            attributes=dict(OBJECTID=f'osm-{separate_footway}', KARAKTER='Openbare overweg (voetpad)',
                            OVERWEG_TYPE='AOB', LOCATIEAANDUIDING='Boslaan voetpad', AANTAL_SPOREN=1),
            geometry=dict(x=node['lon'], y=node['lat'])))
    sites, unmatched = [], []
    for record in crossing_features:
        attrs = record['attributes']
        if not attrs['KARAKTER'].startswith('Openbare') or attrs.get('IN_GEBRUIK', 'Ja') != 'Ja':
            continue
        geom = record['geometry']
        id = attrs['OBJECTID']
        name = attrs['LOCATIEAANDUIDING']
        osm_only = id == f'osm-{separate_footway}'
        x, z = frame.lon_lat_to_scene(geom['x'], geom['y']) if osm_only else crossing_xy(geom['x'], geom['y'])
        subset = [p for p in contacts if (p['nodeId'] == separate_footway if osm_only else
                  hypot(x - p['x'], z - p['z']) <= 7.5 and p['nodeId'] != separate_footway)]
        subset.sort(key=lambda p: hypot(x - p['x'], z - p['z']))
        selected = {}
        for point in subset:
            selected.setdefault(point['railWayId'], point)
        selected = list(selected.values())[:attrs['AANTAL_SPOREN']]
        if len(selected) != attrs['AANTAL_SPOREN']:
            unmatched.append(name)
            continue
        way_ids = sorted({w for p in selected for w in p['ways']})
        xs = [p['x'] for p in selected]
        zs = [p['z'] for p in selected]
        center = (sum(xs) / len(xs), sum(zs) / len(zs))
        road_lines = {key: Line(geometry(roads[key]['pts'])) for key in way_ids}
        main_id = max(way_ids, key=lambda key: road_lines[key].length)
        main = road_lines[main_id]
        _, at, _ = main.project(*center)
        a, b = main.at(max(0, at - 3)), main.at(min(main.length, at + 3))
        heading = atan2(b[0] - a[0], b[1] - a[1])
        track_span = hypot(max(xs) - min(xs), max(zs) - min(zs))
        point_heights = [fits[p['railWayId']].project(p['x'], p['z'])[2][2] for p in selected]
        profiles = []
        ground = ahn_sampler(args.cache / f'ahn-{242 if osm_only else id}.tif', frame)
        for key, road in road_lines.items():
            way = roads[key]
            bits = 0
            for direction in way.get('modes', ()):
                bits |= direction
            modes = [mode for mask, mode in [(7, 'motor'), (8, 'bike'), (16, 'foot')] if bits & mask]
            hits = sorted((road.project(p['x'], p['z'])[1], height + .13 - ROAD_TOP)
                          for p, height in zip(selected, point_heights) if key in p['ways'])
            lo, hi = max(0, hits[0][0] - 27), min(road.length, hits[-1][0] + 27)
            samples = set(road.samples(3, lo, hi))
            samples.update(distance for distance, _ in hits)
            points = []
            for s in sorted(samples):
                px, pz = road.at(s)
                sampled = ground(px, pz)
                distance, height = min(hits, key=lambda p: abs(p[0] - s))
                if len(hits) > 1 and hits[0][0] < s < hits[-1][0]:
                    t = (s - hits[0][0]) / (hits[-1][0] - hits[0][0])
                    height = hits[0][1] + t * (hits[-1][1] - hits[0][1])
                elif sampled is not None:
                    t = max(0, min(1, (abs(distance - s) - 1.6) / 19))
                    height += (sampled - ROAD_TOP - height) * t * t * (3 - 2 * t)
                points.append(rounded((px, pz, height)))
            profiles.append(dict(id=f'lunteren-crossing-{id}-{key}', points=points, width=way['width'],
                                 modes=modes, wayIds=[key], layer=0, surface='asphalt'))
        if not profiles:
            unmatched.append(name)
            continue
        public_controls = dict(x=round(center[0], 3), z=round(center[1], 3), heading=round(heading, 6),
                               width=max(p['width'] for p in profiles), type=attrs['OVERWEG_TYPE'],
                               trackSpan=round(track_span, 3), roadWayIds=way_ids,
                               railWayIds=[p['railWayId'] for p in selected], nodeIds=[str(p['nodeId']) for p in selected])
        crossings = [{
            'x': round(p['x'], 3), 'z': round(p['z'], 3), 'y': round(h + .13 - ROAD_TOP, 3), 'nodeId': str(p['nodeId']),
            'railWayId': p['railWayId'], 'roadWayIds': p['ways'],
        } for p, h in zip(selected, point_heights)]
        sites.append(dict(id=f'north-level-crossing-{id}', name=name, kind='level', profiles=profiles,
                          controls=public_controls, crossings=crossings,
                          evidence=dict(proRailId=attrs.get('PUIC'), osmNode=separate_footway if osm_only else None,
                                        public=True, heights='ProRail rail with AHN DTM approaches')))
    switches = [next(p for p, keys in at_endpoint.items() if len(keys) == 3 and p in (rails[key].points[0], rails[key].points[-1]))
                for key in ('w227525838', 'w431760968')]
    switch_records, switch_xy = source('pro-7')
    for number, point in zip(('21', '23'), switches):
        survey = next(f for f in switch_records if f['attributes']['NAAM'] == number)
        line = Line([switch_xy(*p) for p in survey['geometry']['paths'][0]])
        error = line.project(*point)[0]
        if error > 4:
            raise ValueError(f'OSM switch {number} offsets ProRail by {error:.2f} m')
        print(f'Switch {number}: OSM centre {error:.2f} m from surveyed switch geometry')
    print(f'{len(sites)} matched public crossings. Unmatched: {unmatched}.')
    result = dict(version=1, snapshot=args.date, tracks=TRACKS, railCorridors=rail_corridors, sites=sites,
                  platforms=platforms, ramps=ramps, switches=[rounded(p) for p in switches], unmatched=unmatched)
    payload = json.dumps(result, separators=(',', ':'), ensure_ascii=False)
    args.output.write_text('''// Generated by tools/build-ede-north-rail.py.\nexport const EDE_NORTH_RAIL = ''' + payload + ''';\n\nexport function hasNorthRail(data) {\n  if (data.meta.north !== true) return false;\n  const ids = new Set(data.railways.map(way => way.id));\n  return Object.keys(EDE_NORTH_RAIL.tracks).every(id => ids.has(id));\n}\n''')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--osm', type=Path, required=True)
    parser.add_argument('--date', required=True, help='Source snapshot date (YYYY-MM-DD)')
    parser.add_argument('--fetch', action='store_true', help='Fetch any missing ProRail and AHN snapshots')
    parser.add_argument('--overlay', type=Path, default=ROOT / 'assets/ede-north-v1.json.gz')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-north-rail-data.js')
    args = parser.parse_args()
    if args.fetch:
        fetch_snapshot(args.cache)
    bake(args)
