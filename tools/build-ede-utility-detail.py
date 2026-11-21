#!/usr/bin/env python3
"""Match Ede's utility structures offline and export only reviewed exteriors."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from functools import partial
import gzip
from hashlib import sha256
import json
import math
from pathlib import Path
import runpy
from time import sleep
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from shapely import STRtree, make_valid, orient_polygons, transform
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape

from ede_gis import Frame, RD, SCENE_NAP_ORIGIN, source_crs, to_rd
from ede_map import ROOT, load_scene
from ede_municipal_detail import walk_obstacles

LIANDER = 'https://services1.arcgis.com/v6W5HAVrpgSg3vts/arcgis/rest/services/Liander_Open_Data_Elektra/FeatureServer'
BAG = 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items'
BGT = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/kast/items'
THREE_DBAG = 'https://api.3dbag.nl/collections/pand/items'
AERIAL = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0'
OSM = 'https://api.openstreetmap.org/api/0.6/ways.json'
STANDING = {'Pand in gebruik', 'Pand in gebruik (niet ingemeten)', 'Verbouwing pand', 'Pand buiten gebruik'}
HISTORIC_IDS = {'0228100000071608', '0228100000071156'}
COLORS = {'brick': 0x8B6253, 'prefab': 0xA0A292}


def fetch(url, params=None, timeout=30, attempts=3):
    url = url + '?' + urlencode(params) if params else url
    for attempt in range(attempts):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'Ede-in-3D utility survey'}), timeout=timeout) as result:
                return result.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            sleep(1 + attempt)


def json_response(url, params=None, **options):
    data = json.loads(fetch(url, params, **options))
    if data.get('error') or data.get('remark'):
        raise ValueError(str(data.get('error') or data.get('remark')))
    return data


def pages(api, params):
    url = api + '?' + urlencode(params)
    visited = set()
    while url:
        if url in visited or urlsplit(url)._replace(query='', fragment='').geturl() != api:
            raise ValueError(f'Unexpected pagination from {api}')
        visited.add(url)
        current = json_response(url)
        crs = source_crs(current)
        for row in current['features']:
            yield row, crs
        url = next((link['href'] for link in current.get('links', []) if link['rel'] == 'next'), None)


def geom_rd(raw, crs):
    return make_valid(transform(shape(raw), partial(to_rd, crs=crs, axis_order='xy'), interleaved=False))


def write_json(path, data):
    contents = (json.dumps(data, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n').encode()
    path.write_bytes(gzip.compress(contents, mtime=0) if path.suffix == '.gz' else contents)


def read_json(path):
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes())


def stations(layer, rd_bounds):
    query = {
        'f': 'json', 'where': '1=1', 'geometry': ','.join(map(str, rd_bounds)),
        'geometryType': 'esriGeometryEnvelope', 'inSR': '28992', 'outSR': '28992',
        'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'OBJECTID', 'returnGeometry': 'true',
    }
    page = json_response(f'{LIANDER}/{layer}/query', query)
    if page.get('exceededTransferLimit'):
        raise ValueError(f'Liander layer {layer} exceeded its record limit')
    crs = source_crs(page)
    return [(f"{layer}:{row['attributes']['OBJECTID']}",
             *to_rd(row['geometry']['x'], row['geometry']['y'], crs, axis_order='xy'))
            for row in page['features'] if row.get('geometry')]


def bag_tile(bounds):
    rows = []
    for row, crs in pages(BAG, {'f': 'json', 'bbox': ','.join(map(str, bounds)), 'limit': 1000}):
        props = row['properties']
        if props.get('status') not in STANDING or not row.get('geometry'):
            continue
        polygon = geom_rd(row['geometry'], crs)
        if isinstance(polygon, Polygon):
            rows.append((props['identificatie'], mapping(polygon)))
    return rows


def cabinets(bounds):
    out = {}
    for row, crs in pages(BGT, {'f': 'json', 'bbox': ','.join(map(str, bounds)),
                                'plus_type': 'elektrakast', 'limit': 1000}):
        p = row['properties']
        if (p.get('eind_registratie') is not None or p.get('eind_geldigheid') is not None
                or p.get('plus_type') != 'elektrakast' or not row.get('geometry')):
            continue
        geom = geom_rd(row['geometry'], crs)
        if isinstance(geom, Point):
            out[p['lokaal_id']] = [geom.x, geom.y, p.get('relatieve_hoogteligging') or 0]
    return out


def osm_building_tags(candidates):
    ids = sorted({row["osm"]["id"][1:] for row in candidates.values()
                  if row["osm"] and row["osm"]["id"].startswith("w") and row["osm"]["id"][1:].isdigit()})
    rows = []
    for first in range(0, len(ids), 25):
        page = json_response(OSM, {"ways": ",".join(ids[first:first + 25])})
        rows.extend(page["elements"])
    return {"elements": rows}


def snapshot(directory, nearby, day):
    frame, bounds, rd_bounds = nearby
    west, south, east, north = frame.geographic_bounds(bounds)
    lon = [west + i * (east - west) / 6 for i in range(7)]
    lat = [south + i * (north - south) / 5 for i in range(6)]
    tiles = [(w, s, e, n) for w, e in zip(lon, lon[1:]) for s, n in zip(lat, lat[1:])]
    directory.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        source = pool.map(partial(stations, rd_bounds=rd_bounds), (642, 643))
        cabinet_task = pool.submit(cabinets, (west, south, east, north))
        station_rows = [row for rows in source for row in rows]
        bag_rows = dict(pair for tile in pool.map(bag_tile, tiles) for pair in tile)
        report = {
            'date': day, 'horizontalCrs': RD, 'bounds': bounds, 'stations': station_rows,
            'bag': bag_rows, 'cabinets': cabinet_task.result(),
        }
    if not station_rows or not bag_rows:
        raise ValueError('The station and BAG source snapshots must both contain data')
    write_json(directory / 'utility-sources.json.gz', report)
    print(f'Saved {len(station_rows)} station rows and {len(bag_rows)} BAG footprints', flush=True)


def source_fitted_candidates(scene, frame, data):
    playable = box(*scene['meta']['bounds'])
    bag_polygons = {bid: shape(raw) for bid, raw in data['bag'].items()}
    bag_ids = list(bag_polygons)
    bag_shapes = list(bag_polygons.values())
    bag_tree = STRtree(bag_shapes)
    osm_ids, osm_shapes = [], []
    for p in scene['buildings']:
        raw = [list(zip(ring[::2], ring[1::2])) for ring in (p['ring'], *p['holes'])]
        polygon = make_valid(Polygon(raw[0], raw[1:]))
        if polygon.is_empty or not polygon.area:
            continue
        osm_ids.append(p)
        osm_shapes.append(transform(polygon, frame.scene_to_rd, interleaved=False))
    osm_tree = STRtree(osm_shapes)

    located = defaultdict(list)
    unresolved = []
    for sid, x, y in data['stations']:
        if not playable.covers(Point(*frame.rd_to_scene(x, y))):
            continue
        point = Point(x, y)
        hits = list(bag_tree.query(point, predicate='covered_by'))
        if not hits:
            hits = list(bag_tree.query(point, predicate='dwithin', distance=0.8))
        if len(hits) != 1:
            unresolved.append({'source': sid, 'reason': 'ambiguous-footprint' if hits else 'no-detached-footprint'})
            continue
        bid = bag_ids[hits[0]]
        footprint = bag_polygons[bid]
        if bid in HISTORIC_IDS:
            unresolved.append({'source': sid, 'bagId': bid, 'reason': 'historic-custom-model'})
        elif not (4 <= footprint.area <= 100 and not footprint.interiors):
            unresolved.append({'source': sid, 'bagId': bid, 'reason': 'outside-detached-size-or-shape'})
        else:
            located[bid].append(sid)

    results = {}
    for bid, station_ids in sorted(located.items()):
        footprint = bag_polygons[bid]
        if not playable.covers(transform(footprint, frame.rd_to_scene, interleaved=False)):
            unresolved.append({'source': sorted(station_ids), 'bagId': bid, 'reason': 'footprint-crosses-map-edge'})
            continue
        overlaps = []
        for j in osm_tree.query(footprint, predicate='intersects'):
            other = osm_shapes[j]
            intersection = footprint.intersection(other).area
            if intersection > 0.25 * min(footprint.area, other.area):
                overlaps.append((osm_ids[j], intersection / footprint.area, intersection / other.area))
        matched = None
        if overlaps:
            if len(overlaps) != 1 or min(overlaps[0][1:]) < 0.65:
                unresolved.append({'source': sorted(station_ids), 'bagId': bid, 'reason': 'osm-overlap-ambiguous'})
                continue
            matched = overlaps[0][0]
            if matched['kind'] in {'house', 'residential', 'apartments', 'terrace', 'retail', 'office', 'commercial'}:
                unresolved.append({'source': sorted(station_ids), 'bagId': bid, 'reason': 'ordinary-building-or-indoor-equipment'})
                continue
        results[bid] = {'footprint': footprint, 'stationIds': sorted(station_ids), 'osm': matched}
    return results, unresolved


def photo_bounds(footprint):
    x, y = footprint.centroid.coords[0]
    return tuple(round(value + offset, 2) for value, offset in zip((x, y, x, y), (-11, -11, 11, 11)))


def aerial_image(directory, bid, footprint, layer):
    from PIL import Image

    west, south, east, north = photo_bounds(footprint)
    path = directory / f'{bid}-{layer}.jpg'
    if not path.exists():
        query = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': layer,
                 'STYLES': '', 'CRS': RD, 'FORMAT': 'image/jpeg', 'WIDTH': 256, 'HEIGHT': 256,
                 'BBOX': f'{west},{south},{east},{north}'}
        contents = fetch(AERIAL, query, attempts=1)
        if not contents.startswith(b'\xff\xd8'):
            raise ValueError(f'PDOK returned an invalid aerial image for {bid}')
        path.write_bytes(contents)
    with Image.open(path) as result:
        return result.convert('RGB'), (west, south, east, north)


def contact_sheets(directory, candidates, layer):
    from PIL import Image, ImageDraw

    def crop(item):
        bid, candidate = item
        try:
            photo, (west, south, east, north) = aerial_image(directory, bid, candidate['footprint'], layer)
        except (OSError, ValueError):
            photo = Image.new('RGB', (256, 256), (125, 125, 125))
            return bid, candidate, photo
        draw = ImageDraw.Draw(photo)
        xy = [((e - west) * 256 / (east - west) - 0.5, (north - n) * 256 / (north - south) - 0.5)
              for e, n in candidate['footprint'].exterior.coords]
        draw.line(xy, width=1, fill='#42e9ff')
        return bid, candidate, photo

    with ThreadPoolExecutor(max_workers=8) as pool:
        cards = list(pool.map(crop, candidates.items()))
    for first in range(0, len(cards), 30):
        sheet = Image.new('RGB', (1200, math.ceil(len(cards[first:first+30]) / 6) * 221), '#111111')
        draw = ImageDraw.Draw(sheet)
        for i, (bid, candidate, photo) in enumerate(cards[first:first+30]):
            x, y = i % 6 * 200, i // 6 * 221
            sheet.paste(photo.resize((200, 200)), (x, y))
            matched = candidate['osm'] or {}
            draw.text((x + 4, y + 201), f"{bid[-7:]} {matched.get('kind', '-')} {candidate['footprint'].area:.0f}m²",
                      fill='white')
        sheet.save(directory / f'utility-review-{first//30 + 1}.jpg', quality=92)
    return [bid for bid, _, _ in cards]


def roof_height(directory, bid, fetch_missing):
    path = directory / f'{bid}-3dbag.json'
    if not path.exists():
        if not fetch_missing:
            return None
        try:
            record = json_response(f'{THREE_DBAG}/NL.IMBAG.Pand.{bid}', attempts=1)
        except (OSError, ValueError):
            return None
        write_json(path, record)
    feature = read_json(path).get('feature', {})
    objects = feature.get('CityObjects', {})
    record = objects.get(f'NL.IMBAG.Pand.{bid}', {}).get('attributes', {})
    ground, top = (record.get(key) for key in ('b3_h_maaiveld', 'b3_h_dak_max'))
    if isinstance(ground, (float, int)) and isinstance(top, (float, int)) and 1.5 <= top - ground <= 8:
        ridge, eaves = (record.get(key) for key in ("b3_h_nok", "b3_h_dak_min"))
        rise = ridge - eaves if isinstance(ridge, (float, int)) and isinstance(eaves, (float, int)) else 0
        return round(top - ground, 2), round(ground - SCENE_NAP_ORIGIN, 2), round(rise, 2)
    return None


def cabinet_clearance(scene, frame, area, directory):
    detail = runpy.run_path(str(Path(__file__).with_name("build-ede-bgt-detail.py")))
    evidence = detail["build_evidence"](scene, area.buffer(1))
    return walk_obstacles(directory, frame, scene, detail, evidence)[0]


def build(data, candidates, unresolved, frame, areas, review, directory, fetch_roofs, obstacles, osm_tags):
    features, accepted = [], []
    withheld = set(review.get('withheld', []))
    with ThreadPoolExecutor(max_workers=6) as pool:
        confirmed = [(bid, row) for bid, row in sorted(review['houses'].items()) if bid in candidates]
        roofs = dict(zip((bid for bid, _ in confirmed),
                         pool.map(lambda bid: roof_height(directory, bid, fetch_roofs), (bid for bid, _ in confirmed))))
    for bid, candidate in candidates.items():
        evidence = review['houses'].get(bid)
        footprint = candidate['footprint']
        if evidence and evidence['center'] != [round(x, 1) for x in footprint.centroid.coords[0]]:
            raise ValueError(f'BAG footprint {bid} moved since aerial review. Review its new placement.')
        if not evidence:
            reason = 'aerial-does-not-confirm-freestanding' if bid in withheld else 'awaiting-exterior-review'
            unresolved.append({'source': candidate['stationIds'], 'bagId': bid, 'reason': reason})
            continue
        style = evidence['style']
        polygon = orient_polygons(transform(footprint, frame.rd_to_scene, interleaved=False))
        vertices = [[round(x, 2), round(z, 2)] for x, z in list(polygon.exterior.coords)[:-1]]
        osm_id = (candidate["osm"] or {}).get("id")
        tags = osm_tags.get(osm_id, {})
        if tags.get("ref:bag", bid) != bid:
            unresolved.append({"source": candidate["stationIds"], "bagId": bid, "reason": "osm-bag-identity-conflict"})
            continue
        height, base, rise = roofs[bid] or (2.7 if style == "brick" else 2.45, None, 0)
        feature = {'id': f'utility:{bid}', 'type': 'utilityHouse', 'polygon': vertices, 'holes': [],
                   'height': height, 'style': style, 'color': COLORS[style], 'bagId': bid, 'status': 'observed'}
        if base is not None:
            feature['baseY'] = base
        if osm_id:
            feature["osmId"] = osm_id
        if len(vertices) == 4 and 0.4 < rise < height - 1.6:
            feature["roofRise"] = rise
        if bid == "0228100000069714":
            # The Ede Doet photo shows the doors on the long wall facing Ericalaan.
            sides = [LineString([a, vertices[(i + 1) % len(vertices)]]) for i, a in enumerate(vertices)]
            streets = evidence["streetPoints"]
            frontage = min((i for i, side in enumerate(sides) if side.length >= 5),
                           key=lambda i: min(sides[i].interpolate(.5, normalized=True).distance(Point(p)) for p in streets))
            feature["door"] = [frontage, .28]
        features.append(feature)
        accepted.append({**feature, 'liander': candidate['stationIds'], 'imageryLayer': review['imageryLayer'],
                         'reviewDate': review['date'], 'heightSource': '3DBAG NAP' if base is not None else 'estimated default',
                         'styleSource': evidence.get('styleSource', 'generic exterior'),
                         'cropBoundsRd': photo_bounds(footprint), 'osmBagRefVerified': tags.get('ref:bag') == bid,
                         **({'streetSource': evidence['streetSource']} if 'streetSource' in evidence else {})})
    for bid in sorted(set(review['houses']) - set(candidates)):
        unresolved.append({'bagId': bid, 'reason': 'reviewed-footprint-no-longer-matches'})
    for bid, (x, y, level) in sorted(data['cabinets'].items()):
        sx, sz = frame.rd_to_scene(x, y)
        if not areas.covers(Point(sx, sz)) or level != 0:
            unresolved.append({'source': bid, 'reason': 'cabinet-outside-playable-or-elevated'})
            continue
        width, depth = .70, .35
        hull = box(sx - width / 2 - .04, sz - depth / 2 - .04, sx + width / 2 + .04, sz + depth / 2 + .04)
        blocked = [name for name, index in obstacles.items() if len(index.query(hull, predicate="intersects"))]
        if blocked:
            unresolved.append({"source": bid, "reason": "cabinet-clearance", "obstacles": blocked})
            continue
        feature = {'id': f'elektrakast:{bid}', 'type': 'electricalCabinet', 'position': [round(sx, 2), round(sz, 2)],
                   "width": width, "depth": depth, "height": .95, "angle": 0, "status": "observed", "collidable": True}
        features.append(feature)
        accepted.append({**feature, 'source': bid, 'dimensionsSource': 'generic electrical cabinet'})
    report = {'version': 1, 'date': data['date'], 'sourceCounts': dict(Counter(s[0].split(':')[0] for s in data['stations'])),
              'cabinets': len(data['cabinets']), 'candidateBuildings': len(candidates),
              'duplicateBags': sum(len(row['stationIds']) - 1 for row in candidates.values()),
              'sourceLinks': {'Alliander (CC BY 4.0)': LIANDER, 'PDOK BAG': BAG, 'PDOK BGT': BGT,
                              'OpenStreetMap contributors (ODbL)': OSM, '3DBAG': THREE_DBAG,
                              'Beeldmateriaal / PDOK': AERIAL},
              'accepted': accepted, 'unresolved': sorted(unresolved, key=lambda row: (row['reason'], str(row)))}
    return {'version': 1, 'features': features}, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--date', default=date.today().isoformat())
    parser.add_argument('--fetch', action='store_true', help='fetch and save Liander, BAG and BGT in the snapshot')
    parser.add_argument('--contact-sheets', action='store_true', help='fetch and label local photo crops for review')
    parser.add_argument('--imagery-layer', default='2026_orthoHR')
    parser.add_argument('--fetch-roofs', action='store_true')
    parser.add_argument('--evidence', type=Path, default=ROOT / 'tools/data/ede-utility-review.json')
    parser.add_argument('--asset', type=Path, default=ROOT / 'assets/ede-utility-detail.json.gz')
    parser.add_argument('--report', type=Path, default=ROOT / 'tools/data/ede-utility-detail.audit.json')
    args = parser.parse_args()
    scene = load_scene()
    bounds = scene['meta']['bounds']
    frame = Frame(scene['meta']['lonLatAffine'])
    area = box(*bounds)
    rd_bounds = transform(area, frame.scene_to_rd, interleaved=False).bounds
    if args.fetch:
        snapshot(args.snapshot, (frame, bounds, rd_bounds), args.date)
    data = read_json(args.snapshot / 'utility-sources.json.gz')
    if data['bounds'] != bounds or data['horizontalCrs'] != RD or data['date'] != args.date:
        raise ValueError('Snapshot scene bounds, CRS or date do not match the requested bake')
    candidates, unresolved = source_fitted_candidates(scene, frame, data)
    tag_path = args.snapshot / "osm-building-tags.json"
    if args.fetch:
        write_json(tag_path, osm_building_tags(candidates))
    osm_tags = {f"w{row['id']}": row.get("tags", {}) for row in read_json(tag_path)["elements"]}
    if args.contact_sheets:
        ordered = contact_sheets(args.snapshot, candidates, args.imagery_layer)
        write_json(args.snapshot / 'utility-candidates.json', {bid: {
            'center': [round(x, 1) for x in row['footprint'].centroid.coords[0]],
            'osm': (row['osm'] or {}).get('id'), 'kind': (row['osm'] or {}).get('kind'),
            'tags': osm_tags.get((row['osm'] or {}).get('id'), {}),
            'area': round(row['footprint'].area, 2), 'stations': row['stationIds'],
            } for bid, row in candidates.items() if bid in ordered})
        print(f'Review {len(candidates)} candidates in the contact sheets.')
        return
    review = read_json(args.evidence)
    if review.get("version") != 1:
        raise ValueError("Unsupported exterior review format")
    asset, audit = build(data, candidates, unresolved, frame, area, review, args.snapshot, args.fetch_roofs,
                         cabinet_clearance(scene, frame, area, args.snapshot), osm_tags)
    audit['snapshotSha256'] = sha256((args.snapshot / 'utility-sources.json.gz').read_bytes()).hexdigest()
    write_json(args.asset, asset)
    write_json(args.report, audit)
    print(f"{len(asset['features'])} utility exteriors from {len(candidates)} candidate footprints. {args.asset.stat().st_size} bytes.")


if __name__ == '__main__':
    main()
