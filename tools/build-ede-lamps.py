#!/usr/bin/env python3
"""Bake BGT lamp elevations and aim in the Oude Kerk frame."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
import gzip
import json
import math
from pathlib import Path
import runpy
import struct
import subprocess
from urllib.parse import urlencode

from shapely.geometry import Point, Polygon

from ede_gis import Frame, source_crs
from ede_map import load_scene
from ede_traffic_geometry import Segment, SegmentIndex

ROOT = Path(__file__).resolve().parents[1]
PDOK = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/paal/items'
RWS = 'https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer/6'
RECORD = struct.Struct('<hhhHhHBb')
POORT = (-1450, 3450, -1370, 3530)


def read(path):
    content = path.read_bytes()
    return json.loads(gzip.decompress(content) if path.suffix == '.gz' else content)


def write(path, data):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_bytes(data)
    tmp.replace(path)


def bgt_tile(bounds):
    url = PDOK + '?' + urlencode({'bbox': ','.join(map(str, bounds)), 'limit': 1000,
                                  'f': 'json', 'plus_type': 'lichtmast'})
    seen = set()
    rows = []
    crs = None
    while url:
        if url in seen:
            raise ValueError('PDOK returned a repeated page')
        seen.add(url)
        page = json.loads(subprocess.check_output(['curl', '-fsSL', '--max-time', '25', '--retry', '2', url]))
        page_crs = source_crs(page)
        if crs is not None and page_crs != crs:
            raise ValueError('PDOK changed pole coordinates CRS between pages')
        crs = page_crs
        for feature in page['features']:
            p = feature['properties']
            if (p['plus_type'] != 'lichtmast' or p['status'] != 'bestaand'
                    or p['termination_date'] or p['eind_registratie']):
                continue
            geom = feature['geometry']
            if geom['type'] != 'Point' or len(geom['coordinates']) != 2:
                raise ValueError('Expected two-dimensional BGT pole coordinates')
            rows.append([p['lokaal_id'], p['version'], int(p.get('relatieve_hoogteligging') or 0),
                         *geom['coordinates'], p['tijdstip_registratie'][:10]])
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)
    return crs, rows


def fetch_bgt(bounds):
    south, west, north, east = bounds
    mid_x, mid_y = (west + east) / 2, (south + north) / 2
    boxes = [(a, c, b, d) for a, b in ((west, mid_x), (mid_x, east))
             for c, d in ((south, mid_y), (mid_y, north))]
    latest = {}
    crs = None
    with ThreadPoolExecutor(max_workers=4) as pool:
        for page_crs, rows in pool.map(bgt_tile, boxes):
            if crs is not None and page_crs != crs:
                raise ValueError('PDOK returned different pole coordinates CRS by tile')
            crs = page_crs
            for row in rows:
                if row[0] not in latest or latest[row[0]][-1] < row[-1]:
                    latest[row[0]] = row
    if not latest:
        raise ValueError('PDOK returned no active lamp posts in Ede')
    return {'date': date.today().isoformat(), 'source': PDOK, 'horizontalCrs': crs.to_string(),
            'rows': sorted(latest.values())}


def edges(points, data):
    return [Segment(a, b, data) for a, b in zip(points, points[1:]) if a[:2] != b[:2]]


def projection(edge, x, z):
    raw, lateral = edge.project(x, z)
    along = min(edge.length, max(0, raw))
    return along, math.hypot(raw - along, lateral), raw, lateral


class LampSurfaces:
    def __init__(self, scene, frame):
        self.bounds = scene['meta']['bounds']
        self.terrain = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))['Terrain']()
        grade = read(ROOT / 'assets/ede-grade.json')
        corrections = read(ROOT / 'assets/ede-ahn-surfaces.json')
        self.nap = grade['datumNAP']
        roads = {road['id']: road for road in scene['roads']}
        road_edges = [edge for road in roads.values()
                      for edge in edges(list(zip(road['pts'][::2], road['pts'][1::2])), road)]
        self.roads = SegmentIndex(road_edges, margin=25)
        self.decks = {}
        for feature in read(ROOT / 'assets/ede-bgt.json')['structures']:
            if feature['kind'] != 'deck':
                continue
            polygons = []
            for outer, *holes in feature['polygons']:
                ring = lambda coords: list(zip(coords[::2], coords[1::2]))
                polygons.append(Polygon(ring(outer), [ring(coords) for coords in holes]).buffer(1.2))
            self.decks.update((identity, polygons) for identity in feature['ids'])
        fitted = []
        self.profile_spans = {}
        for site in [*grade['sites'], *corrections['sites']]:
            for profile in site.get('profiles', []):
                road = next((roads[key] for key in profile.get('wayIds', []) if key in roads), None)
                if road is None:
                    continue
                level = road.get('layer') or (1 if site['kind'] == 'bridge' else 0)
                attached = [polygon for identity in site.get('evidence', {}).get('bgt', [])
                            for polygon in self.decks.get(identity, ())]
                spans = edges(profile['points'], (profile, site['kind'], level, attached))
                fitted.extend(spans)
                self.profile_spans[profile['id']] = spans
        self.fitted = SegmentIndex(fitted, margin=24)
        self.corridor = SegmentIndex([
            Segment(frame.scene_to_rd(*edge.a), frame.scene_to_rd(*edge.b), edge.data)
            for edge in road_edges if edge.data['kind'] in ('motorway', 'motorway_link')
        ], margin=45)

    def in_corridor(self, easting, northing):
        return any(projection(edge, easting, northing)[1] <= 45
                   for edge in self.corridor.near(easting, northing))

    def terrain_at(self, x, z):
        x0, z0, x1, z1 = self.bounds
        return self.terrain.at((max(x0, min(x1, x)), max(z0, min(z1, z))))

    def height(self, hit, x, z):
        if hit is None:
            return self.terrain_at(x, z)
        edge, along, _, _, lateral = hit
        profile, kind, _, _ = edge.data
        y = edge.a[2] + along / edge.length * (edge.b[2] - edge.a[2])
        if kind == 'surface':
            scale = max(0, min(1, (profile['width'] / 2 - lateral) / profile['shoulder']))
            return self.terrain_at(x, z) + y * scale
        return self.nap + y

    def surface(self, level, x, z):
        hits = []
        support = {}
        point = Point(x, z) if level > 0 else None
        for edge in self.fitted.near(x, z):
            profile, kind, tag_level, decks = edge.data
            if level != tag_level or (level > 0 and kind != 'bridge'):
                continue
            along, distance, raw, lateral = projection(edge, x, z)
            reach = profile['width'] / 2 + (5 if level > 0 else 1)
            if point is not None and decks:
                if profile['id'] not in support:
                    support[profile['id']] = any(deck.covers(point) for deck in decks)
                if support[profile['id']]:
                    reach = max(reach, 24)
            if distance > reach or (kind == 'surface' and not 0 <= raw <= edge.length):
                continue
            hits.append((edge, along, distance, raw, lateral))
        return min(hits, key=lambda hit: hit[2], default=None)

    def aim(self, hit, level, x, z):
        if hit is not None:
            edge = hit[0]
        else:
            edge = min((part for part in self.roads.near(x, z)
                        if part.data.get('layer', 0) == level and projection(part, x, z)[1] <= 25),
                       key=lambda part: projection(part, x, z)[1], default=None)
        ux, uz = (edge.ux, edge.uz) if edge else (0, 1)
        side = 1 if edge is None or (edge.a[0] - x) * -uz + (edge.a[1] - z) * ux >= 0 else -1
        nx, nz = -uz * side, ux * side
        tx, tz = x + nx * 3.5, z + nz * 3.5
        target = None
        if hit is not None:
            spans = self.profile_spans[edge.data[0]['id']]
            target = min(((part, *projection(part, tx, tz)) for part in spans), key=lambda row: row[2])
        return math.atan2(nz, nx), self.height(target, tx, tz)


def source_date(props):
    for key in ('datum_inwinning', 'datum_controle', 'datum_mutatie', 'datumaanleg'):
        value = props.get(key)
        if isinstance(value, (int, float)) and 0 < value < 3e12:
            return datetime.fromtimestamp(value / 1e3, timezone.utc).date().isoformat()
    return None


def read_gis(path, frame, surfaces):
    raw = read(path)
    if source_crs(raw).to_epsg() != 28992:
        raise ValueError('1GIS light points require outSR=28992')
    if 'layers' in raw and raw.get('verticalDatum') == 'NAP':
        features = raw['layers']['6']
    elif 'features' in raw and raw.get('hasZ'):
        # Raw ArcGIS layer 6 uses NAP for its Z samples, as supplied by returnZ=true.
        features = raw['features']
    else:
        raise ValueError('1GIS light points require NAP elevation samples')
    out = []
    counts = Counter()
    levels = {'Maaiveld': 0, 'MaaiveldPlus1': 1, 'MaaiveldMin1': -1}
    for row in features:
        p, g = row['attributes'], row['geometry']
        height = g.get('z')
        if p['type'] not in ('Lichtmast', 'Verlichtingsobject', 'Lijnverlichtingsmast'):
            counts['fixtureOnly'] += 1
            continue
        if p['niveau'] not in levels or height is None or not math.isfinite(height):
            counts['missingZOrLevel'] += 1
            continue
        rd = g['x'], g['y']
        x, z = frame.rd_to_scene(*rd)
        x0, z0, x1, z1 = surfaces.bounds
        if not (x0 <= x <= x1 and z0 <= z <= z1 and surfaces.in_corridor(*rd)):
            counts['outsideCorridor'] += 1
            continue
        out.append({'id': str(p.get('globalid') or p['objectid']), 'objectId': p['objectid'],
                    'x': x, 'z': z, 'nap': height, 'rd': rd,
                    'level': levels[p['niveau']], 'type': p['type'], 'fixture': p.get('armatuurtype'),
                    'lamp': p.get('lamptype'), 'height': p.get('lichtpunthoogte'), 'mast': p.get('lengte'),
                    'doubleArm': p.get('type_2') == 'Lichtmast-Dubbele uitlegger', 'date': source_date(p)})
    return out, counts, raw.get('date')


def encode(rows, datum):
    packed = []
    for r in sorted(rows, key=lambda item: (round(item['x'] * 5), round(item['z'] * 5), item['level'], item['id'])):
        flags = int(r['fixtureLED']) | (2 if r['source'] == '1GIS surveyed base' else 0) | (4 if r['profile'] else 0)
        if r['doubleArm']:
            flags |= 8
        packed.append(RECORD.pack(round(r['x'] * 5), round(r['z'] * 5), round((r['base'] - datum) * 100),
                                  round((r['angle'] % math.tau) * 65536 / math.tau) % 65536,
                                  round((r['target'] - datum) * 100), round(r['height'] * 100), flags, r['level']))
    return b'EDL2' + struct.pack('<I', len(packed)) + b''.join(packed)


def bake(scene, snapshot, gis_path):
    frame = Frame(scene['meta']['lonLatAffine'])
    surfaces = LampSurfaces(scene, frame)
    official, counts, gis_date = read_gis(gis_path, frame, surfaces) if gis_path else ([], Counter(), None)
    crs = source_crs(snapshot, default='OGC:CRS84')  # Older snapshots used the GeoJSON default.
    poles = []
    review = {'date': snapshot['date'], 'BGT': {'source': PDOK, 'license': 'CC0-1.0', 'count': len(snapshot['rows']), 'horizontalCrs': crs.to_string()},
              '1GIS': {'source': RWS, 'license': 'CC0-1.0', 'eligible': len(official), 'verticalDatum': 'NAP',
                       'horizontalCrs': 'EPSG:28992', 'snapshotDate': gis_date},
              'duplicates': [], 'ambiguous': [], 'matches': [], 'poortwachter': []}
    overlap = {}
    used = set()
    source_rows = []
    for identity, version, level, x, y, updated in snapshot['rows']:
        rd = frame.to_rd(x, y, crs, axis_order='xy')
        source_rows.append((identity, version, level, *frame.rd_to_scene(*rd), updated, rd))

    def add(row, candidates, native=False):
        identity, version, level, x, z, updated, _ = row
        hit = surfaces.surface(level, x, z)
        profile = hit[0].data[0]['id'] if hit else None
        fitted = surfaces.height(hit, x, z)
        target_angle, target = surfaces.aim(hit, level, x, z)
        accepted = [(d, g) for d, g in candidates if g['level'] == level and abs(g['nap'] - fitted) <= 0.65]
        gis = accepted[0][1] if accepted else None
        reason = None
        if len(accepted) > 1 and accepted[1][0] - accepted[0][0] < 0.15:
            reason = 'parallel-1gis-candidates'
            gis = None
        if candidates and not gis:
            reason = reason or '1gis-height-or-level-disagreement'
        if level and not hit:
            reason = 'no-fitted-elevation-for-level'
            gis = None
        if reason:
            review['ambiguous'].append({'id': identity, 'position': [round(x, 2), round(z, 2)],
                                        'level': level, 'reason': reason, 'candidateIds': [g['objectId'] for d, g in candidates]})
        if level and not hit:
            counts['unplacedBGTLevel'] += 1
            return
        if native and not gis:
            counts['unplaced1gis'] += 1
            return
        base = gis['nap'] if gis else fitted
        height = next((gis[key] for key in ('height', 'mast') if gis and isinstance(gis[key], (int, float))
                       and 3 <= gis[key] <= 20), 8.2)
        label = '1GIS surveyed base' if gis else 'fitted profile' if hit else 'AHN terrain'
        fixture_led = bool(gis and 'led' in (gis['lamp'] or '').lower())
        result = {'id': identity, 'version': version, 'level': level, 'x': x, 'z': z, 'date': updated,
                  'base': base, 'target': target, 'angle': target_angle, 'height': height, 'fixtureLED': fixture_led,
                  'doubleArm': bool(gis and gis['doubleArm']), 'profile': profile, 'source': label}
        if ((level == 1 and profile and profile.startswith('de-poortwachter-'))
                or (level == 0 and POORT[0] <= x <= POORT[2] and POORT[1] <= z <= POORT[3] and not native)):
            review['poortwachter'].append({**result, 'oldNAP': round(surfaces.terrain_at(x, z), 3)})
        key = round(x * 5), round(z * 5), level
        if key in overlap:
            review['duplicates'].append({'kept': overlap[key], 'omitted': identity,
                                         'position': [round(x, 2), round(z, 2)], 'level': level})
            return
        overlap[key] = identity
        poles.append(result)
        if gis:
            used.add(gis['id'])
            review['matches'].append({'id': identity, 'fixture': gis['fixture'], '1GIS': gis,
                                      'baseNAP': round(base, 3), 'profile': profile, 'nativeOnly': native})
        counts[label] += 1
        if result['doubleArm']:
            counts['doubleArm'] += 1
        if native:
            counts['new1gis'] += 1

    for row in source_rows:
        rd = row[-1]
        candidates = [(math.dist(rd, g['rd']), g) for g in official
                      if abs(rd[0] - g['rd'][0]) <= 1.3 and abs(rd[1] - g['rd'][1]) <= 1.3 and g['id'] not in used]
        add(row, sorted(((d, g) for d, g in candidates if d <= 1.3), key=lambda item: (item[0], item[1]['objectId'])))

    for g in official:
        if g['id'] in used:
            continue
        if any(math.dist(row[-1], g['rd']) <= 2 for row in source_rows):
            counts['overlapping1gis'] += 1
            continue
        if g['type'] not in ('Lichtmast', 'Lijnverlichtingsmast') or g['level']:
            counts['unplaced1gis'] += 1
            continue
        add((g['id'], None, g['level'], g['x'], g['z'], g['date'], g['rd']), [(0, g)], native=True)
    review['counts'] = {**counts, 'BGT duplicate placements': len(review['duplicates']), 'rendered': len(poles)}
    return gzip.compress(encode(poles, surfaces.nap), mtime=0), review


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bgt', type=Path, help='Read a downloaded BGT lamp snapshot')
    parser.add_argument('--save-bgt', type=Path, help='Save the BGT lamp snapshot for offline refresh')
    parser.add_argument('--gis', type=Path, help='1GIS snapshot or ArcGIS layer 6 queried in RD New with Z')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/ede-lamps.bin.gz')
    parser.add_argument('--report', type=Path, help='Detailed lamp source matching and Poortwachter audit')
    args = parser.parse_args()
    scene = load_scene()
    snapshot = read(args.bgt) if args.bgt else fetch_bgt(scene['meta']['geographicBounds'])
    if args.save_bgt:
        data = json.dumps(snapshot, separators=(',', ':')).encode()
        write(args.save_bgt, gzip.compress(data, mtime=0) if args.save_bgt.suffix == '.gz' else data)
    asset, review = bake(scene, snapshot, args.gis)
    write(args.output, asset)
    if args.report:
        report = (json.dumps(review, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        write(args.report, gzip.compress(report, mtime=0) if args.report.suffix == '.gz' else report)
    print(json.dumps(review['counts'], sort_keys=True), f'({len(asset):,} bytes)')


if __name__ == '__main__':
    main()
