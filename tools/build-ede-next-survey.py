#!/usr/bin/env python3
"""Bake De Eder Kuil's native AHN terrain patch and local 3DBAG landmark surveys."""

import argparse
import gzip
import json
from math import floor
from pathlib import Path
from statistics import median
from struct import unpack_from
from urllib.parse import urlencode
from urllib.request import urlopen

from ede_gis import Frame

ROOT = Path(__file__).resolve().parents[1]
SITES = {
    'kuil': ((174849, 450195, 175065, 450379), ('0228100000006512', '0228100000037062', '0228100000069647')),
    'technova': ((173764, 448108, 173994, 448278), ('0228100000028941',)),
    'tesqua': ((172530, 449407, 172790, 449643), ('0228100000041390',)),
    'pallas': ((172393, 449817, 172493, 449936), ('0228100000057211',)),
}
SURFACES = {'WallSurface': 0, 'RoofSurface': 1}
COURT_FRAME = (172440, 449407, 172790, 449643)
COURT_IMAGE = (1050, 708)
# Court outlines traced in the 2025 PDOK orthophoto, using the RD frame above.
COURTS = [
    ('clay', [(124, 155), (232, 151), (241, 262), (133, 268)], 2),
    ('clay-cross', [(132, 269), (350, 254), (354, 317), (136, 330)], 2),
    ('clay', [(358, 160), (473, 143), (486, 251), (369, 265)], 2),
    ('padel', [(249, 214), (303, 210), (307, 250), (253, 254)], 1),
    ('padel', [(307, 189), (344, 186), (350, 248), (313, 249)], 1),
    ('padel', [(277, 146), (343, 142), (344, 181), (281, 187)], 1),
    ('pickleball', [(239, 150), (276, 147), (279, 205), (242, 210)], 2),
]


def compact(value):
    return json.dumps(value, separators=(',', ':'))


def cached(path, fetch, url):
    if not path.exists() and fetch:
        with urlopen(url, timeout=45) as response:
            path.write_bytes(response.read())
    return path


def building_shell(feature, transform, frame, origin):
    points = []
    for vertex in feature['vertices']:
        e, n, y = [v * scale + offset for v, scale, offset
                   in zip(vertex, transform['scale'], transform['translate'])]
        x, z = frame.rd_to_scene(e, n)
        points.append([round(x, 2), round(y - origin, 2), round(z, 2)])
    faces = []
    for obj in feature['CityObjects'].values():
        for geom in obj.get('geometry', []):
            if geom['lod'] != '2.2':
                continue
            semantics = geom['semantics']
            multi = geom['type'] == 'MultiSolid'
            solids = geom['boundaries'] if multi else [geom['boundaries']]
            values = semantics['values'] if multi else [semantics['values']]
            for solid, parts in zip(solids, values):
                for shell, indices in zip(solid, parts):
                    for rings, index in zip(shell, indices):
                        kind = SURFACES.get(semantics['surfaces'][index]['type']) if index is not None else None
                        if kind is not None:
                            faces.append([kind, *rings])
    if not faces:
        raise ValueError(f'No LoD 2.2 walls and roofs for {feature["id"]}')
    return points, faces


def bake_buildings(cache, fetch, frame, origin):
    lines = ['// 3DBAG LoD 2.2 survey parts in the Oude Kerk scene coordinate and NAP datum.']
    for name, (bounds, ids) in SITES.items():
        url = 'https://api.3dbag.nl/collections/pand/items?' + urlencode({'bbox': ','.join(map(str, bounds)), 'limit': 50})
        data = json.loads(cached(cache / f'{name}-bag.json', fetch, url).read_text())
        meta = data['metadata']
        if not meta['metadata']['referenceSystem'].endswith('/7415'):
            raise ValueError(f'Unexpected 3DBAG CRS for {name}')
        features = {feature['id'].rsplit('.', 1)[-1]: feature for feature in data['features']}
        lines.append(f'export const {name.upper()}_SHELLS = [')
        for bag in ids:
            feature = features[bag]
            points, faces = building_shell(feature, feature.get('transform', meta['transform']), frame, origin)
            lines += ['  {', f'    id: {compact(bag)},', '    points: [']
            lines += ['      ' + ', '.join(map(compact, points[i:i + 5])) + ',' for i in range(0, len(points), 5)]
            lines += ['    ],', '    faces: [', *('      ' + compact(face) + ',' for face in faces), '    ],', '  },']
        lines.append('];')

    west, south, east, north = COURT_FRAME
    width, height = COURT_IMAGE
    def court_position(pixel):
        col, row = pixel
        e = west + col * (east - west) / width
        n = north - row * (north - south) / height
        return [round(coord, 2) for coord in frame.rd_to_scene(e, n)]
    courts = [[kind, [court_position(pixel) for pixel in pixels], count] for kind, pixels, count in COURTS]
    lines.append('export const TESQUA_COURTS = ' + compact(courts) + ';')
    (ROOT / 'js/ede-next-survey.js').write_text('\n'.join(lines) + '\n')


def bake_terrain(cache, fetch, frame, coarse):
    import rasterio
    from ede_raster import require_rd_raster

    west, south, east, north = SITES['kuil'][0]
    query = urlencode([('service', 'WCS'), ('request', 'GetCoverage'), ('version', '2.0.1'),
                       ('coverageId', 'dtm_05m'), ('format', 'image/tiff'),
                       ('subset', f'x({west},{east})'), ('subset', f'y({south},{north})')])
    url = 'https://service.pdok.nl/rws/ahn/wcs/v1_0?' + query
    with rasterio.open(cached(cache / 'kuil-dtm.tif', fetch, url)) as raster:
        require_rd_raster(raster)
        if raster.res != (0.5, 0.5):
            raise ValueError('Expected native 0.5 m AHN')
        pixels = raster.read(1, masked=True).filled(float('nan'))
        inverse = ~raster.transform
    height, width = pixels.shape
    magic, cols, rows, x0, z0, town_step, datum = unpack_from('<4sIIffff', coarse)
    if magic != b'AHN1' or town_step != 12:
        raise ValueError('Expected the 12 m town grid')

    def town_height(x, z):
        u, v = (x - x0) / town_step, (z - z0) / town_step
        i, j = floor(u), floor(v)
        if not 0 <= i < cols - 1 or not 0 <= j < rows - 1:
            raise ValueError('Patch sample outside the town grid')
        u, v = u - i, v - j
        k = j * cols + i
        a, b, c, d = [unpack_from('<h', coarse, 28 + 2 * index)[0] / 100 - datum
                      for index in (k, k + 1, k + cols, k + cols + 1)]
        return a + (b - a) * u + (c - a) * v if u + v <= 1 else d + (c - d) * (1 - u) + (b - d) * (1 - v)

    def native_height(x, z, fallback):
        e, n = frame.scene_to_rd(x, z)
        col, row = map(floor, inverse * (e, n))
        for reach in (1, 3, 7):
            samples = [y for i in range(max(0, col - reach), min(width, col + reach + 1))
                       for j in range(max(0, row - reach), min(height, row + reach + 1))
                       if abs(y := pixels[j, i]) < 1000]
            if len(samples) >= 3:
                return median(samples) - datum
        return fallback

    step = 3
    min_x, min_z, max_x, max_z = 432, 552, 528, 684
    cols_f, rows_f = (max_x - min_x) // step + 1, (max_z - min_z) // step + 1
    lines = ['// Native 0.5 m PDOK AHN DTM sampled in RD New and baked to a 3 m patch.',
             f'export const EDER_KUIL_TERRAIN = {{ minX: {min_x}, minZ: {min_z}, maxX: {max_x}, maxZ: {max_z},'
             f' step: {step}, columns: {cols_f}, rows: {rows_f}, heights: [']
    for j in range(rows_f):
        values = []
        for i in range(cols_f):
            x, z = min_x + i * step, min_z + j * step
            blend = min(1, min(i, j, cols_f - 1 - i, rows_f - 1 - j) / 3)
            base = town_height(x, z)
            values.append(round(100 * (base + (native_height(x, z, base) - base) * blend)))
        lines.append('  ' + compact(values)[1:-1] + ',')
    lines.append('].map(y => y / 100) };')
    (ROOT / 'js/ede-kuil-terrain.js').write_text('\n'.join(lines) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true', help='Download only missing source files')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as scene:
        frame = Frame(json.load(scene)['meta']['lonLatAffine'])
    coarse = (ROOT / 'assets/ede-ahn.bin').read_bytes()
    origin = unpack_from('<f', coarse, 24)[0]
    bake_terrain(args.cache, args.fetch, frame, coarse)
    bake_buildings(args.cache, args.fetch, frame, origin)


if __name__ == '__main__':
    main()
