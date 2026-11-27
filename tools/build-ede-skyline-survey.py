#!/usr/bin/env python3
"""Bake the Ede skyline's surveyed shells and map viewpoints from public data."""

import argparse
import gzip
import json
from math import hypot
from pathlib import Path
from runpy import run_path
from urllib.request import urlopen

from ede_gis import Frame
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
BAKE = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))['bake']
BAG_API = 'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.'

# Site names, streets, the exact replacement identifiers, and the facade type.
SITES = [
    ('leeuwenhorst', 'Leeuwenhorst · Slotlaan', 'Veldhuizen', 'Leeuwenhorst', 'leeuwenhorst', [('0228100000071622', 'w421608706')]),
    ('mariendaal', 'Veldzicht · Mariëndaal', 'Veldhuizen', 'Mariëndaal', 'large', [('0228100000059678', 'w272136026')]),
    ('langenhorst', 'Langenhorstflat', 'Veldhuizen', 'Langenhorst', 'langenhorst', [('0228100000043230', 'w272135506')]),
    ('valkestein-west', 'Valkestein · West', 'Veldhuizen', 'Valkestein', 'point', [('0228100000034643', 'w271546092')]),
    ('valkestein-midden', 'Valkestein · Midden', 'Veldhuizen', 'Valkestein', 'point', [('0228100000058982', 'w271546167')]),
    ('valkestein-oost', 'Valkestein · Oost', 'Veldhuizen', 'Valkestein', 'point', [('0228100000039667', 'w271546178')]),
    ('mariendaal-zuid', 'Mariëndaal · Zuid', 'Veldhuizen', 'Mariëndaal', 'gallery', [('0228100000009215', 'w272135800')]),
    ('groenendaal-zuid', 'Groenendaal · Zuid', 'Veldhuizen', 'Groenendaal', 'gallery', [('0228100000041912', 'w272136058')]),
    ('groenendaal-noord', 'Groenendaal · Noord', 'Veldhuizen', 'Groenendaal', 'gallery', [('0228100000057647', 'w272136076')]),
    ('weerdestein-flat', 'Weerdesteinflat', 'Veldhuizen', 'Weerdestein', 'point', [('0228100000032686', 'w271547108')]),
    ('groot-derxsgoed', 'Groot Derxsgoed', 'Ede-Zuid', 'Arnold Koningstraat', 'large', [('0228100000017826', 'w271377146')]),
    ('de-brugge-flat', 'De Brugge', 'Ede-Zuid', 'Van der Hagenstraat', 'gallery', [('0228100000036024', 'w271377088')]),
    ('groot-haversteeg', 'Groot Haversteeg', 'Ede-Zuid', 'Van der Hagenstraat', 'gallery', [('0228100000012942', 'w271377084')]),
    ('de-elskamp', 'De Elskamp', 'Ede-Zuid', 'Van der Hagenstraat', 'gallery', [('0228100000022362', 'w1265920515')]),
    ('willem-marisflat', 'Willem Marisflat', 'Ede-Zuid', 'Willem Marislaan', 'gallery', [('0228100000026977', 'w1265920516')]),
    ('stroombergflat', 'Stroombergflat', 'Ede-Zuid', 'Jan Th. Tooroplaan', 'gallery', [('0228100000023743', 'w271471505')]),
    ('merlijnflat', 'Merlijnflat', 'Ede-Zuid', 'Willem Witsenlaan', 'gallery', [('0228100000024450', 'w271376880')]),
    ('veluwse-proeftuin', 'De Veluwse Proeftuin', 'World Food Center', 'Generaal Hackettlaan', 'terraces',
     [('0228100000086507', 'w1056707757'), (None, 'w1547295471')]),
    ('ej-bos-diervoeding', 'E.J. Bos Diervoeding', 'Ederveen', 'Hoofdweg', 'mill',
     [('0228100000068674', 'w267691240'), ('0228100000073073', 'w267691492')]),
]


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def load_map(name):
    with gzip.open(ROOT / 'assets' / name) as stream:
        return json.load(stream)


def outline_osm(building):
    return [list(zip(ring[::2], ring[1::2])) for ring in [building['ring'], *building['holes']]]


def shell(bag_id, cache, fetch, frame):
    path = cache / f'{bag_id}.json'
    if not path.exists() and fetch:
        with urlopen(BAG_API + bag_id, timeout=40) as response:
            path.write_bytes(response.read())
    payload = json.loads(path.read_bytes())
    if not payload['metadata']['metadata']['referenceSystem'].endswith('/7415'):
        raise ValueError(f'Expected RD New and NAP for {bag_id}')
    ground, outline, points, faces = BAKE({**payload, 'features': [payload['feature']]}, bag_id, frame, SCENE_NAP_ORIGIN)
    return dict(ground=ground, outline=outline, points=points, faces=faces)


def viewpoint(center, street, roads, buildings, distance, broad_side):
    cx, cz = center
    candidates = []
    for road in roads:
        if road.get('bridge') or road.get('tunnel') or road.get('kind') in {'motorway', 'trunk'}:
            continue
        path = list(zip(road['pts'][::2], road['pts'][1::2]))
        active = road['kind'] in {'footway', 'path', 'cycleway', 'pedestrian'}
        accessible = active or any(mode & 16 for mode in road.get('modes', []))
        if not accessible:
            continue
        for (ax, az), (bx, bz) in zip(path, path[1:]):
            if not (min(ax, bx) - 120 < cx < max(ax, bx) + 120 and min(az, bz) - 120 < cz < max(az, bz) + 120):
                continue
            length = hypot(bx - ax, bz - az)
            if length < 1:
                continue
            steps = max(1, round(length / 5))
            offset = 0 if active else road['width'] / 2 + 1.7
            for i in range(steps):
                t = (i + 0.5) / steps
                x, z = ax + (bx - ax) * t, az + (bz - az) * t
                for sign in ([-1, 1] if offset else [0]):
                    px, pz = x + sign * offset * (bz - az) / length, z + sign * offset * (ax - bx) / length
                    radius = hypot(px - cx, pz - cz)
                    if 20 < radius < 110:
                        score = abs(radius - distance) + (0 if active else 8) + (0 if road['name'] == street else 27)
                        if broad_side:
                            dx, dz = broad_side
                            side = abs((px - cx) * dz - (pz - cz) * dx) / radius
                            score += (1 - side) * 108
                        candidates.append((score, px, pz))
    for _, x, z in sorted(candidates):
        if any(w - 2 <= x <= e + 2 and s - 2 <= z <= n + 2 for w, s, e, n in buildings):
            continue
        return dict(x=round(x, 2), z=round(z, 2))
    raise ValueError(f'No mapped approach for {street} near {center}')


def long_axis(ring):
    edges = [(bx - ax, bz - az) for (ax, az), (bx, bz) in zip(ring, ring[1:] + ring[:1])]
    dx, dz = max(edges, key=lambda edge: hypot(*edge))
    length = hypot(dx, dz)
    return dx / length, dz / length


# The Willem Marislaan car park exposes the existing east-wall artwork.
# The Bosbeshof footpath approaches the terrace tower from the southeast.
VIEWPOINTS = {
    'leeuwenhorst': dict(x=-2046.0, z=251.13),
    'groot-derxsgoed': dict(x=-932, z=2261),
    # Both points frame the main façade from pedestrian space between the trees.
    'mariendaal': dict(x=-1983.0, z=684.2),
    'veluwse-proeftuin': dict(x=523.5, z=1458.5),
}


def bounds(ring):
    xs, zs = zip(*ring)
    return min(xs), min(zs), max(xs), max(zs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'js/ede-skyline-survey.js')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    base = load_map('ede-map-v1.json.gz')
    corridors = load_map('ede-corridors-v1.json.gz')
    frame = Frame(base['meta']['lonLatAffine'])
    mapped = {building['id']: building for data in (base, corridors) for building in data['buildings']}
    roads = [road for data in (base, corridors) for road in data['roads']]
    map_bounds = [bounds(outline_osm(building)[0]) for building in mapped.values()]
    lines = ['// © 3DBAG by tudelft3d and 3DGI, adapted under CC BY 4.0. https://docs.3dbag.nl/en/copyright/',
             '// Surveyed LoD 2.2 geometry, OSM outlines and mapped approaches in Oude Kerk scene metres.',
             '// Rebuild with tools/build-ede-skyline-survey.py.', 'export const SKYLINE_SHELLS = {']
    sites = []
    for key, name, district, street, style, sources in SITES:
        shells = []
        for bag, osm in sources:
            if style == 'terraces':
                outline = outline_osm(mapped[osm])
                ground, height, stories = (12.51, 35.1, 11) if not shells else (12.51, 13.4, 4)
                shells.append(dict(ground=ground, height=height, stories=stories, outline=outline))
            else:
                shells.append(shell(bag, args.cache, args.fetch, frame))
        outer = [point for part in shells for point in part['outline'][0]]
        low_x, low_z, high_x, high_z = bounds(outer if style != 'terraces' else shells[0]['outline'][0])
        x = round((low_x + high_x) / 2, 2)
        z = round((low_z + high_z) / 2, 2)
        height = max(part['height'] if 'height' in part else max(p[1] for p in part['points']) - part['ground'] for part in shells)
        broad_side = long_axis(outer) if style in {'large', 'langenhorst', 'gallery'} else None
        distance = 68 if broad_side or style == 'mill' else 47
        approach = VIEWPOINTS.get(key) or viewpoint((x, z), street, roads, [*map_bounds, bounds(outer)], distance, broad_side)
        sites.append(dict(id=key, name=name, district=district, road=street, style=style, x=x, z=z,
                          height=round(height, 2), focusHeight=min(13, round(height * 0.35, 1)), approach=approach,
                          osmId=sources[0][1], annexOsmIds=[osm for _, osm in sources[1:]],
                          bagIds=[bag for bag, _ in sources if bag]))
        if style == 'leeuwenhorst':
            sites[-1]['hideOnMap'] = True
        lines.append(f"  '{key}': [")
        for part in shells:
            lines.append('    {')
            for prop, value in part.items():
                if prop == 'points' or prop == 'faces':
                    lines.append(f'      {prop}: [')
                    lines.extend('        '+', '.join(map(compact, value[i:i + 6]))+',' for i in range(0, len(value), 6))
                    lines.append('      ],')
                else:
                    lines.append(f'      {prop}: {compact(value)},')
            lines.append('    },')
        lines.append('  ],')
    lines.extend(['};', '', 'export const EDE_SKYLINE_LANDMARKS = [', *('  '+compact(s)+',' for s in sites),
                  '].map(site => ({', '  ...site, worldSpace: true, mapScenic: true,',
                  '  surveyFootprints: SKYLINE_SHELLS[site.id].map(({ outline: [outer, ...holes] }) => ({',
                  '    outer: outer.map(([x, z]) => ({ x, z })),',
                  '    holes: holes.map(ring => ring.map(([x, z]) => ({ x, z }))),',
                  '  })),', '}));'])
    args.output.write_text('\n'.join(lines)+'\n')


if __name__ == '__main__':
    main()
