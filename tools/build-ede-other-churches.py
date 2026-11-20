#!/usr/bin/env python3
"""Bake exact church BAG footprints and LoD 2.2 shells from cached 3DBAG API responses."""

import argparse
import gzip
import json
from math import hypot
from pathlib import Path

from ede_gis import Frame, RD, source_crs


ROOT = Path(__file__).resolve().parent.parent
SITES = [
    ('bethelkerk', 'Bethelkerk', '0228100000017301', 271377243, 'Jan Th. Tooroplaan', 'Reehorst'),
    ('lutherse-kerk', 'Evangelisch-Lutherse Kerk', '0228100000054166', 271510308, 'Beukenlaan', 'Centrum Ede'),
    ('hersteld-apostolische-kerk', 'Nieuw-Apostolische Kerk', '0228100000040131', 271377234, 'Regentesseplein', 'Reehorst'),
    ('emmaus', 'Emmaüs', '0228100000035779', 271178858, 'Lutulistate', 'De States'),
    ('proosdijkerk', 'Proosdijkerk', '0228100000012720', 271508053, 'Veenderweg', 'Vogelbuurt'),
    ('apostolisch-genootschap', 'Apostolisch Genootschap', '0228100000050080', 271509324, 'Hakselseweg', 'Bloemenbuurt'),
    ('taborkerk', 'Taborkerk', '0228100000010550', 271509740, 'Hovystraat', 'Beatrixpark'),
    ('tabernakel', 'De Tabernakel', '0228100000022639', 271510086, 'Verlengde Maanderweg', 'Bloemenbuurt'),
    ('adventkerk', 'Luthers gemeentecentrum / Sabbatvierende ZDA', '0228100000041904', 271515592, 'Maanderweg', 'Centrum Ede'),
    ('oud-gereformeerde-zuid', 'Oud Gereformeerde Gemeente · Noordelijke Spoorstraat', '0228100000021781', 271515929, 'Noordelijke Spoorstraat', 'Stationsbuurt'),
    ('de-wissel', 'De Wissel', '0228100000055145', 271544832, 'Bettekamp', 'Zeeheldenbuurt'),
    ('ontmoetingskerk', 'Ontmoetingskerk', '0228100000033927', 271546486, 'Proosdijweg', 'De Steinen'),
    ('oud-gereformeerde-noord', 'Oud Gereformeerde Gemeente · Schaapsweg', '0228100000062361', 271547063, 'Schaapsweg', 'Indische buurt'),
    ('sionkerk', 'Sionkerk', '0228100000056087', 271551093, 'Celebeslaan', 'Indische buurt'),
    ('elim', 'Elim', '0228100000069983', 271555718, 'Stakenberg', 'De Bergen'),
    ('petrakerk', 'Petrakerk', '0228100000073681', 271582074, 'Lunterseweg', 'Doesburg'),
    ('rehoboth', 'Kerkelijk centrum Rehoboth', '0228100000075639', 271604942, 'Driehoek', 'Centrum Ede'),
    ('open-hof', 'De Open Hof', '0228100000064565', 272136037, 'Hoflaan', 'De Hoven'),
    ('de-ark', 'De Ark', '0228100000005787', 272136119, 'Catharinadaal', 'De Dalen'),
    ('goede-herderkerk', 'Goede Herderkerk', '0228100000041937', 271514298, 'Ganzeweide', 'Vogelbuurt'),
    ('zuiderkerk', 'Zuiderkerk', '0228100000038507', 271377052, 'Zandlaan', 'Reehorst'),
    ('de-schuilplaats', 'De Schuilplaats', '0228100000062560', 271586823, 'Otterloseweg', 'Bosrand'),
    ('ericakerk', 'Ericakerk · Erica Theater', '0228100000045609', 271575941, 'Ericalaan', 'Centrum Ede'),
    ('de-akker', 'De Akker · Leger des Heils', '0228100000059903', 271377225, 'Reehorsterweg', 'Reehorst'),
    ('de-deur', 'Evangelie Gemeente De Deur', '0228100000013198', 271512483, 'Landbouwlaan', 'Bloemenbuurt'),
    ('mollenkerkje', 'Mollenkerkje · Eigen Gebouw', '0228100000066394', 271545151, 'Bettekamp', 'Zeeheldenbuurt'),
    ('koninkrijkszaal', 'Koninkrijkszaal', '0228100000011965', 271508334, 'Jachtlaan', 'Klaphek'),
]


def surfaces(geometry):
    semantics = geometry['semantics']
    if geometry['type'] == 'Solid':
        solids = [geometry['boundaries']]
        values = [semantics['values']]
    elif geometry['type'] in ('MultiSolid', 'CompositeSolid'):
        solids = geometry['boundaries']
        values = semantics['values']
    else:
        raise ValueError(f"Unsupported LoD 2.2 geometry {geometry['type']}")
    for solid, shell_types in zip(solids, values, strict=True):
        for shell, face_types in zip(solid, shell_types, strict=True):
            for rings, kind in zip(shell, face_types, strict=True):
                if kind is not None:
                    yield semantics['surfaces'][kind]['type'], rings


def bake_shell(path, bag, osm, name, frame, bounds):
    document = json.loads(path.read_bytes())
    metadata, feature = document['metadata'], document['feature']
    identifier = f'NL.IMBAG.Pand.{bag}'
    if feature['id'] != identifier or source_crs(metadata['metadata']) != source_crs({}, default=RD):
        raise ValueError(f'Unexpected source identifier or horizontal CRS in {path}')
    if not metadata['metadata']['referenceSystem'].endswith('/7415'):
        raise ValueError(f'Expected RD New with NAP elevations in {path}')
    transform = metadata['transform']
    objects = feature['CityObjects']
    building = objects[identifier]
    footprints = [rings for geometry in building['geometry'] if geometry['lod'] == '0'
                  for rings in geometry['boundaries']]
    if len(footprints) != 1:
        raise ValueError(f'Expected one BAG footprint, possibly with holes, in {path}')

    shell_faces, shell_ground = [], []
    for obj in [building, *(objects[child] for child in building.get('children', []))]:
        for geometry in obj.get('geometry', []):
            if geometry['lod'] != '2.2':
                continue
            for kind, rings in surfaces(geometry):
                if kind == 'GroundSurface':
                    shell_ground.extend(rings[0])
                elif kind in ('WallSurface', 'RoofSurface', 'OuterWallSurface', 'RoofOverhangSurface'):
                    shell_faces.append((int(kind in ('RoofSurface', 'RoofOverhangSurface')), rings))
    if not shell_ground or {flag for flag, _ in shell_faces} != {0, 1}:
        raise ValueError(f'Missing wall, roof or ground geometry in {path}')

    points = []
    indices = {}

    def projected_ring(ring):
        result = []
        for index in ring:
            if index not in indices:
                easting, northing, nap = (v * scale + shift for v, scale, shift in zip(
                    feature['vertices'][index], transform['scale'], transform['translate'], strict=True))
                x, z = frame.rd_to_scene(easting, northing)
                indices[index] = len(points)
                points.append([round(x, 2), round(nap, 2), round(z, 2)])
            result.append(indices[index])
        return result

    faces = [[flag, *(projected_ring(ring) for ring in rings)] for flag, rings in shell_faces]
    ground = [projected_ring(ring) for ring in footprints[0]]
    outer = [points[index] for index in ground[0]]
    xs, _, zs = zip(*outer)
    center = [round((min(xs) + max(xs)) / 2, 2), round((min(zs) + max(zs)) / 2, 2)]
    west, north, east, south = bounds
    if not (west <= center[0] <= east and north <= center[1] <= south):
        raise ValueError(f'{name} is outside the playable map')
    base = min(feature['vertices'][index][2] for index in shell_ground)
    base = round(base * transform['scale'][2] + transform['translate'][2], 2)
    height = round(max(point[1] for point in points) - base, 2)
    return dict(name=name, bag=bag, osm=f'w{osm}', center=center, base=base, height=height,
                points=points, faces=faces, ground=ground)


def road_approach(roads, street, center):
    x, z = center
    candidates = []
    for road in roads:
        if road.get('name') != street or road.get('layer') or road.get('bridge') or road.get('tunnel'):
            continue
        points = list(zip(road['pts'][::2], road['pts'][1::2]))
        for (a, b), (c, d) in zip(points, points[1:]):
            u, v = c - a, d - b
            length = u * u + v * v
            if length:
                t = max(0, min(1, ((x - a) * u + (z - b) * v) / length))
                dx, dz = x - a - t * u, z - b - t * v
                distance = hypot(dx, dz)
                offset = 0 if road['kind'] in {'footway', 'cycleway', 'pedestrian', 'path'} else road['width'] / 2 + 1.5
                weight = max(0, 1 - offset / distance) if distance else 0
                candidates.append((distance, x - dx * weight, z - dz * weight))
    if not candidates:
        raise ValueError(f'Missing ground-level street approach for {street}')
    _, approach_x, approach_z = min(candidates)
    return dict(x=round(approach_x, 2), z=round(approach_z, 2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path, help='Directory of individual 3DBAG CityJSON responses named by BAG ID')
    parser.add_argument('--out', type=Path, default=ROOT / 'js/ede-other-church-shells.js')
    args = parser.parse_args()
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz', 'rt') as src:
        map_data = json.load(src)
    meta = map_data['meta']
    frame = Frame(meta['lonLatAffine'])
    shells = {}
    for slug, name, bag, osm, road, district in SITES:
        shell = bake_shell(args.cache / f'{bag}.json', bag, osm, name, frame, meta['bounds'])
        shell.update(road=road, district=district, approach=road_approach(map_data['roads'], road, shell['center']))
        shells[slug] = shell
    lines = [
        '// Generated by tools/build-ede-other-churches.py. Horizontal coordinates are scene metres; point heights are NAP.',
        '// © 3DBAG by tudelft3d and 3DGI, adapted under CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
        'export const OTHER_CHURCH_SHELLS = {',
    ]
    for slug, shell in shells.items():
        lines.append(f'  {json.dumps(slug)}: {json.dumps(shell, ensure_ascii=False, separators=(",", ":"))},')
    lines.append('};')
    args.out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Baked {len(shells)} church shells to {args.out} ({args.out.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
