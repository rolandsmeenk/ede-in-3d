#!/usr/bin/env python3
"""Bake visible Vallei en Veluwe structures into the existing Ede scene."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import gzip
import json
import math
from pathlib import Path
import runpy
import subprocess
from urllib.parse import urlencode
from urllib.request import urlopen

from shapely import STRtree, force_2d, make_valid, transform, union_all
from shapely.geometry import LineString, Point, Polygon, box, shape

from ede_gis import Frame, SCENE_NAP_ORIGIN, source_crs
from ede_map import ROOT, load_playable_boundary


ASSETS = ROOT / 'assets'
PDOK = 'https://api.pdok.nl/hwh/'
COLLECTIONS = {
    'duiker': 'waterschappen-kunstwerken-imwa/ogc/v2',
    'stuw': 'waterschappen-kunstwerken-imwa/ogc/v2',
    'profielverdediging': 'waterschappen-oppervlaktewateren-imwa/ogc/v1',
    'oppervlaktewaterlichaam': 'waterschappen-oppervlaktewateren-imwa/ogc/v1',
}
RD_CRS = 'http://www.opengis.net/def/crs/EPSG/0/28992'
WATERBOARD = 'Waterschap Vallei en Veluwe'
TERRAIN = runpy.run_path(str(ROOT / 'tools/build-ede-grade.py'))['Terrain']
MATERIALS = {
    'beton': 'concrete', 'gewapend beton': 'concrete', 'hout': 'wood', 'steen': 'stone',
    'metselwerk': 'brick', 'grasbetontegels': 'stone', 'staal': 'steel', 'ijzer': 'steel',
    'roestvrij staal': 'steel', 'gegolfd plaatstaal': 'steel', 'aluminium': 'steel',
    'pvc': 'plastic', 'kunststof': 'plastic',
}
BANKS = {
    'beschoeiing': ('timber', 'wood', .58), 'damwand': ('sheet', 'steel', .85),
    'keer- of kademuur': ('wall', 'concrete', .85), 'taludbekleding': ('riprap', 'stone', .38),
    'talud- en bodembekleding': ('riprap', 'stone', .38), '(perkoen)paaltjes': ('stakes', 'wood', .45),
}


def read(path):
    with (gzip.open if path.suffix == '.gz' else open)(path, 'rt', encoding='utf-8') as stream:
        return json.load(stream)


def write(path, doc):
    data = (json.dumps(doc, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    path.write_bytes(gzip.compress(data, mtime=0) if path.suffix == '.gz' else data)


def download(collection, cache, bounds, snapshot):
    fields = urlencode({'bbox': ','.join(f'{n:.8f}' for n in bounds), 'limit': 1000,
                        'crs': RD_CRS, 'f': 'json'})
    url = f'{PDOK}{COLLECTIONS[collection]}/collections/{collection}/items?{fields}'
    features = {}
    while url:
        with urlopen(url, timeout=35) as response:
            if (response.headers.get('Content-Crs') or '').strip('<>') != RD_CRS:
                raise ValueError(f'{collection} did not return RD New')
            page = json.load(response)
        for row in page['features']:
            features[row['id']] = row
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)
    write(cache / f'{collection}.geojson.gz', {
        'type': 'FeatureCollection', 'horizontalCrs': 'EPSG:28992', 'snapshot': snapshot,
        'features': list(features.values()),
    })


def parts(geometry, kind):
    if geometry.is_empty:
        return
    if geometry.geom_type == kind:
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for child in geometry.geoms:
            yield from parts(child, kind)


def polygon(ring, holes=()):
    def coords(flat):
        return list(zip(flat[::2], flat[1::2]))
    return make_valid(Polygon(coords(ring), [coords(hole) for hole in holes]))


def rows(doc, area, kind):
    seen = set()
    for row in doc['features']:
        p = row['properties']
        identity = p.get('nen3610id') or row['id']
        if (identity in seen or p.get('waterbeheerder') != WATERBOARD
                or p.get('statusobject') != 'gerealiseerd' or not row.get('geometry')):
            continue
        geometry = shape(row['geometry'])
        if not area.intersects(force_2d(geometry)):
            continue
        seen.add(identity)
        for i, part in enumerate(parts(geometry, kind)):
            yield f'{identity}:{i}' if i else identity, p, part


def credible(value, low, high):
    return isinstance(value, (int, float)) and low <= value <= high


def heading(frame, p, q):
    x, z = frame.rd_to_scene(*p)
    x2, z2 = frame.rd_to_scene(*q)
    return round(math.atan2(x2 - x, z2 - z), 4)


def span(p, along, width, depth):
    dx, dy = along
    return LineString([(p.x - dy * width / 2, p.y + dx * width / 2),
                       (p.x + dy * width / 2, p.y - dx * width / 2)]).buffer(depth)


def direction(origin, target):
    dx, dy = target[0] - origin[0], target[1] - origin[1]
    length = math.hypot(dx, dy)
    return (dx / length, dy / length) if length > .05 else None


def unit_tangent(line, point):
    s = line.project(point)
    return direction(line.interpolate(max(0, s - 2)).coords[0],
                     line.interpolate(min(line.length, s + 2)).coords[0])


def build(scene, frame, area, docs):
    to_rd = lambda geometry: transform(geometry, frame.scene_to_rd, interleaved=False)
    tiles = [TERRAIN(ASSETS / name) for name in (
        'ede-a12-embankment.bin', 'ede-wvede-terrain.bin', 'ede-ahn.bin', 'ede-terrain-tiles/collision.bin',
    ) if (ASSETS / name).exists()]

    def ground(x, z):
        for g in tiles:
            if g.x <= x < g.x + (g.columns - 1) * g.step and g.z <= z < g.z + (g.rows - 1) * g.step:
                return g.at((x, z))

    water = [to_rd(polygon(r['ring'], r.get('holes', []))) for r in scene['water'] if len(r['ring']) >= 6]
    water_index = STRtree(water)
    wet_interiors = [interior for surface in water if not (interior := surface.buffer(-.90)).is_empty]
    wet_index = STRtree(wet_interiors)
    channels = [force_2d(g) for _, _, g in rows(docs['oppervlaktewaterlichaam'], area, 'LineString') if g.length > 1.]
    channel_index = STRtree(channels)

    def near_water(geometry, water_reach, channel_reach):
        return (water_index.query(geometry, predicate='dwithin', distance=water_reach).size > 0
                or channel_index.query(geometry, predicate='dwithin', distance=channel_reach).size > 0)

    def visible_channel(point, along):
        ax, az = along
        approach = LineString([(point.x, point.y), (point.x + 5 * ax, point.y + 5 * az)]).buffer(.75)
        if water_index.query(approach, predicate='intersects').size:
            return 'shoreline'
        # AHN can support a dry ditch where the water mesh has no outline.
        front = (point.x + 1.6 * ax, point.y + 1.6 * az)
        floor = ground(*frame.rd_to_scene(*front))
        shoulders = [ground(*frame.rd_to_scene(front[0] - offset * az, front[1] + offset * ax))
                     for offset in (-4., 4.)]
        if floor is not None and all(value is not None and value - floor >= .16 for value in shoulders):
            return 'ahn-ditch'

    roads = []
    for way in scene['roads'] + scene['railways']:
        pts = way['pts']
        if len(pts) < 4 or way.get('tunnel') or way.get('area'):
            continue
        line = to_rd(LineString(list(zip(pts[::2], pts[1::2]))))
        half_width = (way.get('bgtWidth') or way.get('width') or 3.5) / 2
        roads.append(line.buffer(half_width + .35, quad_segs=2))
    road_index = STRtree(roads)

    walls = [
        to_rd(polygon(ring, holes)).buffer(.75)
        for structure in read(ASSETS / 'ede-bgt.json')['structures']
        if structure['layer'] == 0 and structure['kind'] in ('civilWall', 'retainingWall', 'abutment')
        for ring, *holes in structure['polygons']
    ]
    wall_index = STRtree(walls)
    report = {key: Counter() for key in ('duiker', 'stuw', 'profielverdediging')}
    culverts, weirs, banks = [], [], []
    occupied = set()

    culvert_sources = sorted(rows(docs['duiker'], area, 'LineString'),
                             key=lambda row: (row[1].get('tijdstipregistratie') or '', row[0]), reverse=True)
    for identity, p, geometry in culvert_sources:
        report['duiker']['active lines'] += 1
        coords = list(geometry.coords)
        width, height = p.get('breedteopening'), p.get('hoogteopening')
        if (geometry.length < 1.5 or not credible(width, .15, 8) or not credible(height, .15, 5)
                or p.get('aantaldoorstroomopeningen') != 1):
            report['duiker']['unsupported opening or dimensions'] += 2
            continue
        profile = (p.get('vormkoker') or '').lower()
        if profile not in ('rond', 'rechthoekig'):
            report['duiker']['unverified bore shape'] += 2
            continue
        for suffix, points in [('a', coords), ('b', coords[::-1])]:
            start = points[0]
            pt = Point(start[:2])
            source_nap = start[2] if len(start) > 2 else None
            if not area.covers(pt) or not credible(source_nap, 0, 50) or not near_water(pt, 6., 4.):
                report['duiker']['unmatched mouth or NAP'] += 1
                continue
            inside = next((q[:2] for q in points[1:] if pt.distance(Point(q[:2])) > .85), None)
            along = inside and direction(inside, start[:2])
            if not along:
                report['duiker']['unmatched mouth or NAP'] += 1
                continue
            footprint = span(pt, along, width + .65, .48)
            if road_index.query(footprint, predicate='intersects').size or wall_index.query(footprint, predicate='intersects').size:
                report['duiker']['pavement or structure conflict'] += 1
                continue
            x, z = frame.rd_to_scene(*start[:2])
            grade = ground(x, z)
            if grade is None or not -.28 <= grade - source_nap <= .92:
                report['duiker']['terrain obscures surveyed mouth'] += 1
                continue
            match = visible_channel(pt, along)
            if not match:
                report['duiker']['no visible channel in the game'] += 1
                continue
            # Dry terrain and most water surfaces share the coarse AHN grid.
            fitted = max(source_nap, grade - min(.13, height / 4))
            target = (start[0] + along[0], start[1] + along[1])
            angle = heading(frame, start[:2], target)
            if any(math.hypot(x - r['x'], z - r['z']) < .70 and math.cos(angle - r['heading']) > .97
                   and abs(width - r['width']) < .20 and abs(height - r['height']) < .20 for r in culverts):
                report['duiker']['coincident opening'] += 1
                continue
            culverts.append({
                'id': f'{identity}/{suffix}', 'code': p.get('code'), 'x': round(x, 2), 'z': round(z, 2),
                'y': round(fitted - SCENE_NAP_ORIGIN, 3), 'sourceNap': round(source_nap, 3),
                'heading': angle, 'width': round(width, 3), 'height': round(height, 3),
                'shape': 'round' if profile == 'rond' else 'box', 'match': match,
                'material': MATERIALS.get((p.get('typemateriaal') or '').lower(), 'concrete'),
            })
            report['duiker']['terrain-fitted mouths' if fitted - source_nap > .02 else 'survey-height mouths'] += 1

    for identity, p, geometry in rows(docs['stuw'], area, 'Point'):
        report['stuw']['active points'] += 1
        pt = force_2d(geometry)
        width = p.get('kruinbreedte')
        sill, top = p.get('drempelpeil'), p.get('hoogteconstructie')
        kind = p.get('typestuw')
        if (not credible(width, .45, 22) or not credible(sill, 0, 50)
                or kind not in ('vaste stuw', 'klepstuw', 'schotbalkstuw', 'schuifstuw', 'kantelstuw')):
            report['stuw']['unsupported type or dimensions'] += 1
            continue
        choices = channel_index.query(pt, predicate='dwithin', distance=3.5)
        candidates = sorted((channels[i].distance(pt), int(i)) for i in choices)
        along = None
        if candidates:
            distance, idx = candidates[0]
            along = unit_tangent(channels[idx], pt)
            for d, other in candidates[1:]:
                if d > distance + .5:
                    break
                axis = unit_tangent(channels[other], pt)
                if along and axis and abs(sum(a * b for a, b in zip(along, axis))) < .72:
                    along = None
                    break
        frankeneng = p.get('code') == 'KST-1106'
        if frankeneng:
            # The surveyed point is a junction. Use the culvert axis toward WS000611.
            down = frame.to_rd(5.6163599083, 52.02461362358, 'OGC:CRS84')
            along = direction(pt.coords[0], down)
            # Fit the exposed front to the terrain cut at the edge of the upper reach.
            pt = Point(pt.x - along[0] * 1.1, pt.y - along[1] * 1.1)
        if along is None:
            report['stuw']['unmatched or ambiguous channel axis'] += 1
            continue
        footprint = span(pt, along, width + .75, .55)
        if wall_index.query(footprint, predicate='intersects').size or road_index.query(footprint, predicate='intersects').size:
            report['stuw']['pavement or structure conflict'] += 1
            continue
        x, z = frame.rd_to_scene(pt.x, pt.y)
        grade = ground(x, z)
        if grade is None or not frankeneng and not -.65 <= grade - sill <= 1.15:
            report['stuw']['terrain conflicts with sill'] += 1
            continue
        match = visible_channel(pt, along) or visible_channel(pt, (-along[0], -along[1]))
        if not frankeneng and not match:
            report['stuw']['no visible channel in the game'] += 1
            continue
        crest = sill if frankeneng else max(sill, grade + .04)
        pier_top = top if credible(top, crest + .18, crest + 2.6) else crest + .38
        key = (round(x * 2), round(z * 2))
        if key in occupied:
            report['stuw']['coincident structure'] += 1
            continue
        occupied.add(key)
        weirs.append({
            'id': identity, 'code': p.get('code'), 'name': p.get('naam'), 'x': round(x, 2), 'z': round(z, 2),
            'y': round(crest - SCENE_NAP_ORIGIN, 3), 'sourceNap': sill,
            'heading': heading(frame, (pt.x, pt.y), (pt.x + along[0], pt.y + along[1])),
            'width': round(width, 3), 'height': round(pier_top - crest, 3),
            'type': 'fixed' if kind == 'vaste stuw' else 'gate', 'match': 'shoreline' if frankeneng else match,
            'material': MATERIALS.get((p.get('typemateriaal') or '').lower(), 'concrete'),
        })
        report['stuw']['terrain-fitted crests' if crest - sill > .02 else 'survey-height crests'] += 1

    bank_lines = []
    accepted_banks = {}
    bank_sources = sorted(rows(docs['profielverdediging'], area, 'LineString'),
                          key=lambda row: (not row[1].get('typeprofielverdediging'), -row[2].length, row[0]))
    bank_sources_2d = [force_2d(geometry) for _, _, geometry in bank_sources]
    source_index = STRtree(bank_sources_2d)
    for source_i, (identity, p, _) in enumerate(bank_sources):
        report['profielverdediging']['active lines'] += 1
        kind = (p.get('typeprofielverdediging') or '').lower()
        if not kind and (p.get('opmerking') or '').casefold().strip() == 'beschoeiing':
            kind = 'beschoeiing'
        if kind not in BANKS or p.get('relatievehoogteligging') not in (None, 0):
            report['profielverdediging']['bed lining, unsupported type or level'] += 1
            continue
        style, default_material, height = BANKS[kind]
        material = MATERIALS.get((p.get('typemateriaaloever') or '').lower(), default_material)
        if style == 'timber' and material != 'wood':
            style = 'wall'
        geometry = bank_sources_2d[source_i].intersection(area)
        exclusions = [roads[i].buffer(.28) for i in road_index.query(geometry, predicate='dwithin', distance=.28)]
        wet_areas = [wet_interiors[i] for i in wet_index.query(geometry, predicate='intersects')]
        if wet_areas:
            report['profielverdediging']['trimmed submerged runs'] += 1
        duplicates = [walls[i] for i in wall_index.query(geometry, predicate='intersects')]
        if duplicates:
            report['profielverdediging']['trimmed against existing BGT walls'] += 1
        overlapping = [
            match.buffer(.20) for i in source_index.query(geometry, predicate='dwithin', distance=.20)
            for match in accepted_banks.get(i, []) if match.distance(geometry) <= .20
        ]
        shared = [mask for mask in overlapping if geometry.intersection(mask).length > 1.2]
        if shared:
            report['profielverdediging']['trimmed coincident registered bank lines'] += 1
        for j, line in enumerate(parts(geometry.difference(union_all(exclusions + wet_areas + duplicates + shared)), 'LineString')):
            if line.length < 1.8 or not near_water(line, 4.5, 10.):
                continue
            sampled = line.simplify(.32, preserve_topology=False).segmentize(7)
            points = []
            for x, z in transform(sampled, frame.rd_to_scene, interleaved=False).coords:
                nap = ground(x, z)
                if nap is None:
                    points = []
                    break
                points.append([round(x, 2), round(nap - SCENE_NAP_ORIGIN + .09, 3), round(z, 2)])
            if len(points) < 2:
                continue
            bank_lines.append(line)
            accepted_banks.setdefault(source_i, []).append(line)
            banks.append({'id': f'{identity}/{j}', 'type': style, 'material': material, 'height': height, 'points': points})
        if not banks or not banks[-1]['id'].startswith(f'{identity}/'):
            report['profielverdediging']['no supported water-side section'] += 1

    bank_index = STRtree(bank_lines)
    suppress_edges = []
    for feature in read(ASSETS / 'ede-bgt-detail.json.gz')['features']:
        if feature['type'] != 'waterEdge' or feature.get('level', 0) != 0 or len(feature['points']) < 2:
            continue
        line = to_rd(LineString(feature['points']))
        candidates = bank_index.query(line, predicate='dwithin', distance=.65)
        if candidates.size and line.intersection(union_all([bank_lines[i].buffer(.65) for i in candidates])).length >= line.length * .85:
            suppress_edges.append(feature['id'])
    return {'culverts': culverts, 'weirs': weirs, 'banks': banks, 'suppressWaterEdges': suppress_edges}, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--date', type=date.fromisoformat, default=date.today())
    parser.add_argument('--output', type=Path, default=ASSETS / 'ede-water-works.json.gz')
    args = parser.parse_args()
    # Use the same merged map and exact bounds as the browser, including the north extension.
    scene = json.loads(subprocess.check_output(['node', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--input-type=module', '-e', "import { EDE_DATA } from './js/ede-geodata.js'; "
        "const { meta, water, roads, railways } = EDE_DATA; console.log(JSON.stringify({meta, water, roads, railways}));"], cwd=ROOT))
    frame = Frame(scene['meta']['lonLatAffine'])
    area = transform(load_playable_boundary(), frame.scene_to_rd, interleaved=False)
    if args.fetch:
        args.cache.mkdir(parents=True, exist_ok=True)
        bounds = frame.geographic_bounds(scene['meta']['bounds'])
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda k: download(k, args.cache, bounds, args.date.isoformat()), COLLECTIONS))
    docs = {name: read(args.cache / f'{name}.geojson.gz') for name in COLLECTIONS}
    dates = {d['snapshot'] for d in docs.values()}
    if len(dates) != 1 or any(source_crs(d).to_epsg() != 28992 for d in docs.values()):
        raise ValueError('Use one dated set of RD New snapshots')
    asset, report = build(scene, frame, area, docs)
    doc = {
        'version': 1, 'snapshot': dates.pop(), 'license': 'CC-BY-SA-4.0',
        'source': {'owner': WATERBOARD, 'publisher': 'Het Waterschapshuis via PDOK',
                   'services': sorted({f'{PDOK}{path}' for path in COLLECTIONS.values()})},
        **asset,
    }
    write(args.output, doc)
    print(json.dumps({'records': {k: len(d['features']) for k, d in docs.items()},
        'rendered': {k: len(v) for k, v in asset.items()}, 'matching': report,
        'assetBytes': args.output.stat().st_size}, indent=2))


if __name__ == '__main__':
    main()
