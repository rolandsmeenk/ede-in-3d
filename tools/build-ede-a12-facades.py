#!/usr/bin/env python3
"""Fit local façade parameters to a dated motorway or railway visibility survey."""

import argparse
from collections import Counter, defaultdict
import gzip
import json
import math
from pathlib import Path
import re
import runpy

ROOT = Path(__file__).resolve().parents[1]
FACADES = runpy.run_path(str(ROOT / 'tools/build-ede-facades.py'))
TILE_SIZE = FACADES['TILE_SIZE']
save = FACADES['save']

# Layouts fitted from the photographed side of each building, with distances
# scaled to the surveyed wall. The source catalogue records the images and dates.
REVIEWED = {
    '0228100000075635': ('Toyota Material Handling', 'toyota', 1, 'corten', '#784b39', '#485b67',
                        'https://www.metadecor.eu/projects/toyota-material-handling-nederland-ede/', '2013'),
    '0228100000082773': ('BERG Toys warehouse', 'berg', 1, 'corten', '#805441', '#485b67',
                        'https://www.vanmiddendorp.nl/projecten/berg-toys', '2024'),
    '0228100000062900': ('BERG Toys offices', 'berg-office', 1, 'brick', '#844b3e', '#516575',
                        'https://www.gelderlander.nl/ede/zorgen-aanwonenden-om-te-hoog-bouwplan-berg-toys-langs-a12~ab75a5fc/', '2022'),
    '0228100000069928': ('Maxwellstraat 55', 'maxwell', 1, 'panel', '#5d6264', '#58717e',
                        'https://activast.nl/objecten/maxwellstraat-55/', '2019'),
    '0228100000082376': ('Delektro and Van van Ee', 'delectro', 1, 'metal', '#414748', '#537782',
                        'https://www.coarearchitectuur.nl/projecten/nieuwbouw-delektro-en-van-van-ee/', '2019'),
    '0228100000080906': ('Boylestraat 26–28A', 'boyle', 1, 'corten', '#895e46', '#4c6975',
                        'https://www.cmcbedrijfsmakelaars.nl/nieuws/kantoorruimte-ede-op-absolute-zichtlocatie-met-hoge-attentiewaarde', '2026'),
    '0228100000082724': ('Delektro showroom', 'delectro-dark', 1, 'metal', '#414748', '#537782',
                        'https://www.coarearchitectuur.nl/projecten/nieuwbouw-delektro-en-van-van-ee/', '2019'),
    '0228100000082723': ('Van van Ee showroom', 'delectro-glass', 1, 'metal', '#414748', '#537782',
                        'https://www.coarearchitectuur.nl/projecten/nieuwbouw-delektro-en-van-van-ee/', '2019'),
    '0228100000076440': ('NatureGreen', 'nature', 1, 'panel', '#606a6d', '#4d6971',
                        'https://www.naturegreen.nl/over-ons/', '2025'),
    '0228100000074215': ('Van Mourik Group', 'mourik', 1, 'panel', '#54585a', '#516674',
                        'https://vanmourik-feedandsolids.com/over-ons/', '2013'),
    '0228100000083326': ('Kreeft', 'kreeft', 1, 'panel', '#a7a295', '#4d6570',
                        'https://bouwbedrijfkreeft.nl/projecten/kreeft-2020/', '2020'),
    '0228100000088782': ('ITN', 'itn', 1, 'panel', '#b0b0a9', '#536f83',
                        'https://bouwbedrijfkreeft.nl/projecten/bedrijfspand-itn/', '2025'),
    '0228100000072837': ('InnovaN', 'innovan', 1, 'metal', '#424b53', '#476573',
                        'https://www.bta12.nl/gevestigde-bedrijven.html', '2026'),
    '0228100000000163': ('Albers', 'albers', 1, 'brick', '#4e4640', '#4c6370',
                        'https://www.bta12.nl/gevestigde-bedrijven.html', '2026'),
    '0228100000053361': ('Maxwellstraat 51', 'kpn', 1, 'brick', '#a56848', '#406675',
                        'https://dunoair.com/properties/maxwellstraat-51-ede/', '2026'),
    '0228100000059215': ('Schipper Ede', 'schipper', 1, 'panel', '#a3a69d', '#4c6671',
                        'https://schipper-ede.nl/wp-content/uploads/2019/05/schipper-ede-gebouw-v1.jpg', '2019'),
    '0228100000081645': ('Valley Center East', 'valley', 1, 'brick', '#7d6d59', '#4c6678',
                        'https://www.coarearchitectuur.nl/projecten/valley-center-west/', '2020'),
    '0228100000081646': ('Valley Center West', 'valley', 1, 'brick', '#7d6d59', '#4c6678',
                        'https://www.coarearchitectuur.nl/projecten/valley-center-west/', '2020'),
}

# Photo-controlled end points in scene metres, west to east. A long side wall
# can have more visible area than the photographed motorway elevation.
PHOTO_AXES = {
    '0228100000075635': ((-3016.2, 2814.76), (-2895.08, 2887.12)),
    '0228100000082773': ((-2859.74, 2908.24), (-2758.39, 2967.53)),
    '0228100000076440': ((-4486.84, 1880.77), (-4433.68, 1916.27)),
}

A30_REVIEWED = {
    '0228100000010849': ('A.S. Watson, Celsiusstraat 37', 'watson', 1, 'panel', '#a0a6a7', '#53778a',
                        'https://www.architectuurgids.nl/project/item/prj_id/2240', '2004'),
    '0228100000017623': ('Celsiusstraat 34–38', 'celsius', 1, 'brick', '#855b4c', '#54727a',
                        'https://flexoffiz.nl/kantoorruimte-huren-ede/', '2026'),
    '0228100000021848': ('Galvanistraat 119 / Celsiusstraat 18', 'citylink', 1, 'panel', '#838984', '#486273',
                        'https://citylink-logistics.com/citylink-buys-business-building-on-business-park-heestereng-in-ede-2/', '2021'),
    '0228100000020170': ('Bruil, Neonstraat 31', 'bruil', -1, 'panel', '#626468', '#709da6',
                        'https://www.bruil.nl/projecten/uitbreiding-bruil-beton-en-mix', '2026'),
    '0228100000065203': ('Autobedrijf G. Braber, Dwarsweg 20', 'braber', 1, 'metal', '#98a1a3', '#4b7180',
                        'https://www.autobraber.nl/over-ons/', '2026'),
    '0228100000068595': ('Henk Scholten Volvo, Neonstraat 19', 'volvo', -1, 'panel', '#5e6667', '#899da1',
                        'https://rodeca.nl/ede-volvodealer-henk-scholten/', '2003'),
}
A30_PHOTO_AXES = {
    '0228100000010849': ((-3820.45, 1588.71), (-3874.55, 1721.39)),
    '0228100000017623': ((-3904.39, 1783.06), (-3917.96, 1813.85)),
    '0228100000020170': ((-3705.70, 455.83), (-3698.67, 403.94)),
    '0228100000065203': ((-3608.42, 1277.50), (-3569.39, 1276.53)),
    '0228100000068595': ((-3741.43, 125.52), (-3769.11, 124.52)),
}

ENKA_SOURCE = 'https://www.mix-architectuur.nl/werk/ede-enka/'
CASIMIR_SOURCE = 'https://www.atlasvanede.nl/thema-s/stadsontwikkeling/verleden-1900-nu/1960-1980/flats-ede-zuid'
RAIL_REVIEWED = {
    '0228100000086249': ('MIX architectuur · Akulaan H4', 'enka-gallery', -1, 'brick',
                        '#978571', '#819395', ENKA_SOURCE, '2023'),
    '0228100000086250': ('MIX architectuur · Akulaan H2', 'enka-gallery', -1, 'brick',
                        '#98836e', '#819395', ENKA_SOURCE, '2023'),
    '0228100000082617': ('Rockpanel · Parkveste', 'parkveste', -1, 'brick',
                        '#a08868', '#465763',
                        'https://www.rockpanel.com/nl/inspiratie/appartementencomplex-parkveste-ede/', '2020'),
    '0228100000080937': ('Coare Architectuur · De Blokken', 'de-blokken', -1, 'brick',
                        '#965842', '#4c626d',
                        'https://www.coarearchitectuur.nl/projecten/woningen-park-blokken/', '2019'),
    **{bag: ('Allard Bijlsma · Ernst Casimirlaan', 'casimir-flats', 1, 'brick',
             '#9f9277', '#55626b', CASIMIR_SOURCE, '2023-02-07')
       for bag in ('0228100000041591', '0228100000053183', '0228100000061112', '0228100000039479')},
}
RAIL_PHOTO_AXES = {
    '0228100000086249': ((435.54, 2231.82), (367.06, 2208.63)),
    '0228100000086250': ((332.46, 2202.20), (271.47, 2181.55)),
    '0228100000082617': ((-165.00, 1998.96), (-214.47, 2003.92)),
    '0228100000080937': ((-1110.74, 1733.21), (-1163.13, 1717.89)),
}

PALETTES = {
    'brick': ('#865b47', '#98715a', '#91766c', '#a0856f'),
    'modern': ('#a29986', '#886f63', '#aaa091', '#978475'),
    'hall': ('#667075', '#828780', '#515b64', '#9a9c94'),
    'office': ('#797b76', '#58636a', '#8a8e8a', '#776d62'),
    'showroom': ('#5f6668', '#798187', '#807a70', '#575d61'),
    'blank': ('#867c6e', '#736b59', '#968f86', '#69675f'),
}
MATERIALS = {'brick': 'brick', 'modern': 'brick', 'hall': 'metal', 'office': 'panel', 'showroom': 'panel', 'blank': 'concrete'}

# These precise exclusions are already authored 3DBAG replacements.
LANDMARK_REGISTRY = (ROOT / 'js/ede-landmark-sites.js').read_text()
LANDMARKS = set(re.findall(r"'(\d{16})'", LANDMARK_REGISTRY))
LANDMARK_OSM = set(re.findall(r"'(w\d+)'", LANDMARK_REGISTRY))


def frame(wall):
    a, b = wall['a'], wall['b']
    width = math.dist(a, b)
    if width < 0.3:
        raise ValueError(f"Undersized wall {wall.get('wallId')}")
    return width, (b[0] - a[0]) / width, (b[1] - a[1]) / width


def opening(kind, x, y, width, height, **detail):
    return dict(kind=kind, x=x, y=y, width=width, height=height, **detail)


def repeat(w, x0, x1, y, height, spacing, fraction, panes=2):
    count = max(1, min(28, round((x1 - x0) / spacing)))
    step = (x1 - x0) / count
    if step <= 0.6:
        return []
    return [opening('window', x0 + (i + (1 - fraction) / 2) * step, y,
                    min(w - 0.05, step * fraction), height, panes=panes, frame=0.075)
            for i in range(count)]


def building_profile(wall, metadata, osm):
    height = wall['height']
    area = wall.get('footprintArea', 0)
    kind = osm.get('kind', '')
    year = metadata.get('year') or osm.get('buildYear', 0) or wall.get('year') or 0
    use = set(metadata.get('use', ()))
    if (height < 3.2 or kind in ('shed', 'garage', 'garages', 'barn', 'greenhouse', 'roof', 'service')
            or area < 37 and kind not in ('house', 'detached', 'residential') and 'woonfunctie' not in use):
        return 'blank', year
    if kind in ('industrial', 'warehouse', 'manufacture') or 'industriefunctie' in use and area >= 420:
        return 'hall', year
    if 'woonfunctie' in use or kind in ('house', 'apartments', 'detached', 'residential', 'terrace', 'semidetached_house'):
        return ('modern' if year >= 1995 or kind == 'apartments' and height >= 10 else 'brick'), year
    if 'winkelfunctie' in use or kind in ('retail', 'supermarket'):
        return 'showroom', year
    if use & {'kantoorfunctie', 'onderwijsfunctie', 'logiesfunctie', 'gezondheidszorgfunctie'} or kind in ('office', 'commercial', 'school', 'hotel'):
        return 'office', year
    if 'industriefunctie' in use or area >= 420 and height <= 15:
        return 'hall', year
    return ('brick' if height >= 4.6 and area < 330 else 'blank'), year


def inferred(wall, profile, year, motorway, motorway_flag):
    w, _, _ = frame(wall)
    h = wall['height']
    seed = FACADES['stable_number'](wall.get('bagId') or wall.get('osmId') or wall['wallId'])
    palette = PALETTES[profile]
    color = palette[seed % len(palette)]
    openings = []
    if w >= 2.3 and h >= 3.3 and profile in ('brick', 'modern', 'office', 'showroom'):
        pitch, floor, proportion, sill = {
            'brick': (2.68, 2.95, 0.51, 0.96), 'modern': (2.9, 3.10, 0.61, 0.92),
            'office': (3.55, 3.45, 0.76, 0.82), 'showroom': (3.75, 3.6, 0.85, 0.57),
        }[profile]
        margin = min(w * 0.14, 0.80)
        residential = profile in ('brick', 'modern')
        ceiling = h - 0.55
        if residential and wall.get('roofType') == 'slanted':
            ceiling = min(ceiling, h * 0.80)
        levels = wall.get('storeys')
        if not isinstance(levels, int) or levels < 1:
            levels = 15
        count = min(levels, 15, max(1, round(ceiling / floor)))
        for i in range(count):
            y = sill + i * floor
            span = min(ceiling - y, 1.43 if residential else 2.15)
            if span >= 0.57:
                openings.extend(repeat(w, margin, w - margin, y, span, pitch, proportion))
    confidence = 0.65 if year and profile not in ('hall', 'blank') else 0.52
    return dict(status='inferred', profile=f'{motorway}/{profile}', wallColor=color, **motorway_flag,
                wallMaterial=MATERIALS[profile], confidence=confidence, openings=openings), profile


def front_coordinates(wall, front):
    width, tx, tz = frame(wall)
    if tx * front[0] + tz * front[1] < 0.87:
        return None
    t = wall['a'][0] * front[0] + wall['a'][1] * front[1]
    lo, hi = (t - front[2]) / front[3], (t + width - front[2]) / front[3]
    return lo, hi


def review_front(walls, side, axis, motorway):
    if axis:
        a, b = axis
        width = math.dist(a, b)
        tx, tz = (b[0] - a[0]) / width, (b[1] - a[1]) / width
        return tx, tz, a[0] * tx + a[1] * tz, width, -a[0] * tz + a[1] * tx
    # The A12 and rail corridor run east–west. The A30 runs mostly north–south.
    candidates = [wall for wall in walls if frame(wall)[2 if motorway == 'A30' else 1] * side > 0.70
                  and wall['height'] >= 3.2]
    if not candidates:
        return None
    normal = max(candidates, key=lambda wall: frame(wall)[0] * min(wall['height'], 15))
    _, tx, tz = frame(normal)
    across = lambda p: p[0] * tx + p[1] * tz
    offset = lambda p: -p[0] * tz + p[1] * tx
    edges = [wall for wall in candidates if frame(wall)[1] * tx + frame(wall)[2] * tz > 0.87
             and abs(offset(wall['a']) - offset(normal['a'])) <= 9]
    lo, hi = min(across(wall['a']) for wall in edges), max(across(wall['b']) for wall in edges)
    return tx, tz, lo, hi - lo, offset(normal['a'])


def reviewed(wall, definition, front, ordinary, profile, motorway_flag):
    name, recipe, side, finish, tint, glazing, source, date = definition
    w, tx, tz = frame(wall)
    h = wall['height']
    fit = front_coordinates(wall, front) if front else None
    if fit and abs(-wall['a'][0] * front[1] + wall['a'][1] * front[0] - front[4]) > 10:
        fit = None
    if recipe == 'kpn' and tx > 0.18 and h > 5 and w >= 1.5:
        fit = (0, 1)
    if ('motorway' in motorway_flag or 'rail' in motorway_flag) and fit and (fit[1] <= 0 or fit[0] >= 1):
        fit = None
    citylink_office = recipe == 'citylink' and h > 6 and w < 45 and (
        tx < -0.87 and 1345 <= wall['a'][1] <= 1350 or
        tz > 0.87 and -3661 <= wall['a'][0] <= -3648 and 1345 <= wall['a'][1] <= 1364)
    if citylink_office:
        fit = (0, 1)
    watson_office = (recipe == 'watson' and tz > 0.65 and
                     6.5 <= wall.get('baseOffset', 0) <= 8 and 3.5 <= h <= 6.5)
    if watson_office:
        fit = (0, 1)
    if not fit or h <= 3.4:
        if recipe in ('toyota', 'berg') or recipe.startswith('delectro'):
            return ordinary | dict(wallMaterial=finish if recipe == 'toyota' else 'metal',
                                   wallColor=tint if recipe == 'toyota' else '#4b5051', openings=[]), 'rust' if recipe == 'toyota' else 'hall'
        return ordinary, profile
    fields = []
    lower, upper = fit
    def band(kind, start, end, bottom, top, **detail):
        a, b = max(0.06, w * (start - lower) / (upper - lower)), min(w - 0.06, w * (end - lower) / (upper - lower))
        if b - a < 0.45 or (top - bottom) * h < 0.28:
            return
        fields.append(opening(kind, a, bottom * h, b - a, (top - bottom) * h, **detail))

    frame_color = '#777c7b'
    if recipe == 'toyota':
        band('storefront', 0.145, 0.44, 0.18, 0.65, panes=8, transom=0.5, depth=0.80, frame=0.12)
        band('window', 0.71, 0.85, 0.31, 0.63, panes=6, transom=0.43)
        for a, b in [(0.032, 0.17), (0.20, 0.51), (0.55, 0.68), (0.73, 0.97)]:
            band('window', a, b, 0.79, 0.87, panes=8, frame=0.085)
        fallback = 'showroom' if any(f['kind'] == 'storefront' for f in fields) else 'rust'
    elif recipe == 'berg':
        frame_color = '#42474a'
        for edge, left, width in [(0.07, 0.18, 0.028), (0.38, 0.28, 0.023), (0.57, 0.46, 0.024),
                                  (0.70, 0.65, 0.026), (0.90, 0.85, 0.023)]:
            points = [(w * (value - lower) / (upper - lower), y * h) for value, y in
                      [(left, 0.03), (left + width, 0.03), (edge + width, 0.98), (edge, 0.98)]]
            a, b = max(0, min(x for x, _ in points)), min(w, max(x for x, _ in points))
            if b - a > 0.12:
                fields.append(opening('panel', a, h * 0.03, b - a, h * 0.95, points=points))
        band('panel', 0.10, 0.81, 0.46, 0.515)
        fallback = 'rust'
    elif recipe == 'enka-gallery':
        frame_color = '#b1a79a'
        for y in range(1, math.ceil(h / 2.95)):
            floor = (y * 2.95 - wall.get('baseOffset', 0)) / h
            if 0.07 < floor < 0.88:
                # The north-facing galleries use diffuse glass with a light slab edge.
                for a, b in ((0.025, 0.49), (0.51, 0.975)):
                    band('storefront', a, b, floor, min(0.96, floor + 1.03 / h), panes=11, frame=0.07, depth=0)
                band('panel', 0.025, 0.975, floor - 0.30 / h, floor)
        fallback = 'modern'
    elif recipe == 'parkveste':
        frame_color = '#545858'
        for y in range(math.ceil(h / 3.05)):
            floor = (y * 3.05 + 0.57 - wall.get('baseOffset', 0)) / h
            if 0.02 < floor < 0.90:
                count = max(1, round(front[3] / 3.15))
                for bay in range(count):
                    wide = bay % 3 != 0
                    left = (bay + 0.11) / count
                    right = (bay + (0.84 if wide else 0.40)) / count
                    band('window', left, right, floor, min(0.97, floor + 2.28 / h),
                         panes=2 if wide else 1, frame=0.10, depth=0.48 if wide and y < 2 else 0)
        fallback = 'modern'
    elif recipe in ('de-blokken', 'casimir-flats'):
        blocks = recipe == 'de-blokken'
        frame_color = '#c5c4b6' if blocks else '#ddd9ce'
        floor = 2.91 if blocks else 2.78
        spacing = 3.15 if blocks else 3.55
        front_width = front[3]
        count = max(1, round(front_width / spacing))
        for level in range(2 if blocks else 3):
            y = (level * floor + (0.66 if blocks else 1.05)) / h
            for bay in range(count):
                left = (bay + 0.18) / count
                right = (bay + (0.81 if blocks else 0.86)) / count
                band('window', left, right, y, min(0.96, y + (1.52 if blocks else 1.46) / h),
                     panes=2, frame=0.08, depth=0)
        fallback = 'brick'
    elif recipe == 'berg-office':
        if w >= 3.5:
            for floor in (0.28, 0.47, 0.65, 0.82):
                fields.extend(repeat(w, w * 0.08, w * 0.92, floor * h, min(1.22, h * 0.11), 2.25, 0.59))
            band('storefront', 0.06, 0.97, 0.09, 0.25, panes=8, frame=0.10)
        fallback = 'modern'
    elif recipe == 'maxwell':
        if h > 8.5 and w <= 52:
            for floor in (0.47, 0.71):
                fields.extend(repeat(w, w * 0.08, w * 0.92, floor * h, min(1.5, h * 0.17), 2.45, 0.67))
            band('storefront', 0.01, 0.99, 0.07, 0.34, panes=8, transom=0.75, frame=0.105)
            fallback = 'office'
        else:
            band('window', 0.03, 0.98, 0.72, 0.86, panes=min(8, max(2, int(w / 4))), frame=0.11)
            fallback = 'hall'
        frame_color = '#c1c5c0'
    elif recipe.startswith('delectro'):
        if recipe != 'delectro-dark':
            band('storefront', 0.06 if recipe == 'delectro-glass' else 0.51, 0.98,
                 0.10, 0.88, panes=8, transom=0.47, frame=0.145)
        band('panel', 0.015, 0.985, 0.90, 0.985)
        frame_color = '#aaa9a1'
        fallback = 'showroom' if any(f['kind'] == 'storefront' for f in fields) else 'hall'
    elif recipe == 'boyle':
        band('storefront', 0.06, 0.94, 0.26, 0.57, panes=8, transom=0.58, frame=0.11)
        band('storefront', 0.06, 0.94, 0.60, 0.87, panes=8, frame=0.11)
        fallback = 'showroom'
    elif recipe == 'watson':
        if watson_office:
            band('storefront', 0.015, 0.985, 0.12, 0.88, panes=max(3, min(8, round(w / 4))),
                 transom=0.52, frame=0.135)
            frame_color = '#b1b9bb'
            fallback = 'showroom'
        else:
            band('panel', 0.015, 0.985, 0.88, 0.96)
            frame_color = '#68737b'
            fallback = 'hall'
    elif recipe == 'celsius':
        for lo, hi in ((0.10, 0.22), (0.30, 0.43), (0.53, 0.66), (0.76, 0.90)):
            band('storefront', 0.09, 0.82, lo, hi, panes=max(2, min(8, round(w / 2))), frame=0.095)
        band('storefront', 0.84, 0.96, 0.07, 0.66, panes=2, transom=0.45, frame=0.12)
        frame_color = '#444b4d'
        fallback = 'office'
    elif recipe == 'citylink':
        if not citylink_office:
            finish, tint = 'metal', '#626c74'
            band('panel', 0.015, 0.985, 0.86, 0.94)
            fallback = 'hall'
        else:
            band('storefront', 0.045, 0.955, 0.12, 0.43, panes=8, frame=0.10)
            band('window', 0.045, 0.955, 0.57, 0.86, panes=8, frame=0.10)
            fallback = 'office'
        frame_color = '#5e6668'
    elif recipe == 'braber':
        band('storefront', 0.025, 0.98, 0.12, 0.47, panes=8, frame=0.10)
        band('storefront', 0.025, 0.98, 0.55, 0.86, panes=8, frame=0.10)
        band('panel', 0.015, 0.99, 0.88, 0.965)
        frame_color = '#bfc6c8'
        fallback = 'showroom'
    elif recipe == 'bruil':
        fallback = 'hall'
    elif recipe == 'volvo':
        band('storefront', 0.08, 0.45, 0.08, 0.69, panes=4, transom=0.48, frame=0.085)
        band('storefront', 0.45, 0.98, 0.08, 0.69, panes=8, frame=0.04)
        band('panel', 0.02, 0.98, 0.70, 0.83)
        frame_color = '#bfc2bc'
        fallback = 'showroom'
    elif recipe in ('innovan', 'albers', 'kpn', 'schipper'):
        if recipe == 'innovan':
            band('storefront', 0.08, 0.94, 0.10, 0.41, panes=8, transom=0.64)
            band('window', 0.07, 0.95, 0.57, 0.75, panes=8)
            band('panel', 0.08, 0.57, 0.52, 0.565)
            frame_color = '#ae6542'
        elif recipe == 'albers':
            for lo, hi in [(0.22, 0.40), (0.56, 0.74)]:
                band('window', 0.07, 0.94, lo, hi, panes=8, frame=0.09)
        elif recipe == 'kpn':
            for lo, hi in [(0.15, 0.30), (0.48, 0.60), (0.70, 0.82)]:
                band('window', 0.01, 0.99, lo, hi, panes=3 if w < 5 else 8, frame=0.06)
        else:
            band('panel', 0.22, 0.52, 0.39, 0.82)
            band('storefront', 0.56, 0.80, 0.13, 0.84, panes=5, transom=0.47)
            frame_color = '#b59550'
        fallback = 'office'
    elif recipe in ('nature', 'mourik', 'kreeft', 'itn'):
        if recipe == 'nature':
            band('storefront', 0.045, 0.955, 0.43, 0.82, panes=8, transom=0.58)
            band('storefront', 0.12, 0.9, 0.10, 0.29, panes=7)
            band('panel', 0.015, 0.985, 0.36, 0.44)
            frame_color = '#848d8a'
        elif recipe == 'mourik':
            for lo, hi in [(0.28, 0.39), (0.62, 0.73)]:
                band('panel', 0.02, 0.98, lo, hi)
            band('window', 0.09, 0.93, 0.44, 0.61, panes=8)
            frame_color = '#9a4b3c'
        else:
            for bottom in (0.10, 0.36, 0.63):
                band('storefront', 0.015, 0.985, bottom, bottom + 0.20, panes=8, frame=0.11)
                if recipe == 'kreeft':
                    band('panel', 0.01, 0.99, bottom + 0.20, bottom + 0.245)
            frame_color = '#c0c0b6'
        fallback = 'showroom'
    else:
        band('storefront', 0.02, 0.98, 0.07, 0.25, panes=8, frame=0.09)
        for y in (0.32, 0.53, 0.74):
            fields.extend(repeat(w, w * 0.04, w * 0.96, y * h, min(h * 0.18, 2.8), 3.30, 0.88, panes=2))
        fallback = 'office'
    if 'rail' in motorway_flag and not fields:
        return ordinary, profile
    confidence = (0.67 if recipe == 'casimir-flats' else 0.78) if 'rail' in motorway_flag else 0.86
    return dict(status='observed', **motorway_flag, wallMaterial=finish, wallColor=tint,
                glazingColor=glazing, frameColor=frame_color, confidence=confidence,
                openings=fields, sources=[dict(url=source, referenceDate=date, creator=name, confidence=confidence)]), fallback


def find_osm_edge(wall, source):
    a, b = wall['a'], wall['b']
    width, tx, tz = frame(wall)
    ring = list(zip(source['ring'][::2], source['ring'][1::2]))
    if 'osmEdge' in wall:
        i = wall['osmEdge']
        if isinstance(i, int) and 0 <= i < len(ring):
            return i, *ring[i], *ring[(i + 1) % len(ring)]
    best, result = -math.inf, None
    for i, p in enumerate(ring):
        q = ring[(i + 1) % len(ring)]
        length = math.dist(p, q)
        if length < 0.3 or abs((q[0] - p[0]) * tx + (q[1] - p[1]) * tz) / length < 0.87:
            continue
        d = abs((p[1] - a[1]) * tx - (p[0] - a[0]) * tz)
        if d > 2.6:
            continue
        x = (p[0] - a[0]) * tx + (p[1] - a[1]) * tz
        y = (q[0] - a[0]) * tx + (q[1] - a[1]) * tz
        span = min(width, max(x, y)) - max(0, min(x, y))
        score = span - d * 0.8
        if span > 0.50 and score > best:
            best, result = score, (i, *p, *q)
    return result


def publish(walls, fallbacks, manifest_path, fallback_path, prefix):
    cells = defaultdict(list)
    for wall in walls:
        cell = tuple(math.floor((a + b) / (2 * TILE_SIZE)) for a, b in zip(wall['a'], wall['b']))
        cells[cell].append(FACADES['rounded'](wall))
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('version') != 2 or manifest.get('tileSize') != TILE_SIZE:
        raise ValueError('Expected the published façade tile manifest')
    tiles = {}
    size = 0
    for (x, z), rows in sorted(cells.items()):
        name = f'{manifest_path.stem}/{prefix}_{x}_{z}.json.gz'
        size += save(manifest_path.parent / name, {'version': 2, 'walls': rows})
        tiles[f'{x},{z}'] = name
    key = f'{prefix}Tiles'
    previous = manifest.get(key, {})
    manifest[key] = tiles
    save(manifest_path, manifest)
    for unused in set(previous.values()) - set(tiles.values()):
        if re.fullmatch(rf'ede-facades/{prefix}_-?\d+_-?\d+\.json\.gz', unused):
            (manifest_path.parent / unused).unlink(missing_ok=True)
    fallback_bytes = save(fallback_path, {'version': 1, 'buildings': fallbacks})
    return {'facadeTiles': len(tiles), 'tileBytes': size, 'fallbackBytes': fallback_bytes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('visibility', type=Path)
    parser.add_argument('pand_metadata', type=Path)
    corridor = parser.add_mutually_exclusive_group()
    corridor.add_argument('--motorway', choices=('A12', 'A30'), default='A12')
    corridor.add_argument('--rail', action='store_true', help='Bake the east–west mainline railway')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'assets/ede-facades.json')
    parser.add_argument('--fallback', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    route = 'rail' if args.rail else args.motorway
    prefix = route.lower()
    fallback_path = args.fallback or ROOT / f'assets/ede-{prefix}-fallbacks.json.gz'
    review_data, axes, corridor_flag = {
        'A12': (REVIEWED, PHOTO_AXES, {'a12': True}),
        'A30': (A30_REVIEWED, A30_PHOTO_AXES, {'motorway': 'A30'}),
        'rail': (RAIL_REVIEWED, RAIL_PHOTO_AXES, {'rail': True}),
    }[route]

    def read(path):
        raw = path.read_bytes()
        return json.loads(gzip.decompress(raw) if raw.startswith(b'\x1f\x8b') else raw)
    visibility = read(args.visibility)
    if args.rail and not visibility.get('railSamples'):
        parser.error('--rail requires a railway visibility survey')
    metadata = read(args.pand_metadata)
    metadata = metadata.get('buildings', metadata)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz', 'rt') as source:
        osm = {row['id']: row for row in json.load(source)['buildings']}
    surveyed = defaultdict(list)
    for wall in visibility['walls']:
        if wall.get('bagId'):
            surveyed[wall['bagId'][-16:]].append(wall)
    fronts = {bag: review_front(surveyed[bag], row[2], axes.get(bag), route)
              for bag, row in review_data.items()}
    walls, fallbacks, partial, totals = [], defaultdict(dict), defaultdict(set), Counter()
    served = set()
    for wall in visibility['walls']:
        bag = wall['bagId'][-16:] if wall.get('bagId') else ''
        way = wall.get('osmId')
        plantion = bag in ('0228100000000182', '0228100000000142') or way in ('w271151642', 'w271151018')
        if bag in LANDMARKS or route != 'A12' and plantion or args.rail and way in LANDMARK_OSM:
            partial['authoredLandmarks'].add(bag or way)
            totals['authoredWalls'] += 1
            continue
        if wall.get('wallType') == 'shared':
            continue
        if math.dist(wall['a'], wall['b']) < 0.8 or wall['height'] < 0.45:
            totals['smallSurfaceFragments'] += 1
            continue
        source = osm.get(way, {})
        if args.rail and source.get('kind') in ('church', 'chapel', 'mosque', 'synagogue', 'temple', 'religious'):
            partial['retainedReligiousBuildings'].add(bag or way)
            totals['retainedReligiousWalls'] += 1
            continue
        profile, year = building_profile(wall, metadata.get(bag, {}), source)
        style, fallback = inferred(wall, profile, year, route, corridor_flag)
        if bag in review_data:
            style, fallback = reviewed(wall, review_data[bag], fronts[bag], style, fallback, corridor_flag)
        if way and source:
            edge = find_osm_edge(wall, source)
            if edge:
                i, *points = edge
                candidate = [*points, fallback, int(style['wallColor'][1:], 16)]
                if i not in fallbacks[way] or style['status'] == 'observed':
                    fallbacks[way][i] = candidate
            else:
                partial['buildingsWithUnmatchedFallbackEdges'].add(way)
        if bag:
            geom = {key: wall[key] for key in ('bagId', 'wallId', 'a', 'b', 'minY', 'height', 'baseOffset', 'wallType') if key in wall}
            for row in style['openings']:
                check = FACADES['checked_opening'](row | {'kind': 'door'} if row['kind'] == 'panel' else row,
                                                   frame(wall)[0], wall['height'])
                assert check['width'] > 0 and check['height'] > 0, row
            walls.append(geom | style)
            served.add(bag)
            totals[style['status']] += 1
            if bag in review_data and style['status'] == 'observed':
                partial['individuallyReviewed'].add(bag)
        elif not way or way not in fallbacks:
            totals['unmatchedVisibleWalls'] += 1
    asset = publish(walls, fallbacks, args.manifest, fallback_path, prefix)
    report = dict(date=visibility.get('date'), visibility=visibility['stats'], styles=dict(totals),
                  coverage={key: sorted(value) for key, value in partial.items()}, bagBuildings=len(served),
                  fallbackBuildings=len(fallbacks), fallbackWalls=sum(len(r) for r in fallbacks.values()), assets=asset)
    if args.report:
        save(args.report, report)
    print(json.dumps({k: v for k, v in report.items() if k != 'coverage'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
