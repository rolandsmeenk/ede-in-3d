#!/usr/bin/env python3
"""Build observed and inferred wall appearances from a BAG wall catalogue and reviewed observations."""

import argparse
from collections import Counter, defaultdict
from datetime import date
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
from statistics import median
import tempfile


BUILDING_TYPES = {'terraced', 'apartments', 'detached', 'semi-detached', 'shop', 'mixed-use'}
WALL_TYPES = {'street', 'side', 'rear', 'shared'}
OPENING_TYPES = ('window', 'door', 'storefront')
WALL_MATERIALS = {'brick', 'block', 'stone', 'stucco', 'timber', 'concrete'}
APPEARANCE_COLORS = ('wallColor', 'roofColor', 'frameColor', 'doorColor', 'sillColor', 'glazingColor', 'surroundColor')
OPENING_DIMENSIONS = {'frame': 0.3, 'sill': 0.3, 'surround': 0.5, 'depth': 3.0, 'arch': 2.0}
OPENING_DETAILS = ('frame', 'sill', 'surround', 'depth', 'arch', 'panes', 'transom', 'tracery')
TILE_SIZE = 384
MIN_BUILDINGS = 3
MIN_CONFIDENCE = 0.7
ATTRIBUTION = {
    'provider': 'Mapillary',
    'license': 'CC BY-SA 4.0',
    'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'imageUrl': 'https://www.mapillary.com/app/?pKey=',
}


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def color(value):
    return isinstance(value, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', value)


def rgb(value):
    return tuple(bytes.fromhex(value[1:]))


def hex_color(channels):
    return '#' + bytes(round(max(0, min(255, v))) for v in channels).hex()


def middle(values):
    return median(values) if values else None


def key(row):
    return row['bagId'], row['wallId']


def stable_number(value):
    return int.from_bytes(hashlib.blake2s(value.encode(), digest_size=4).digest(), 'big')


def wall_width(wall):
    return math.dist(wall['a'], wall['b'])


def checked_walls(rows):
    walls = {}
    for row in rows:
        bag, segment = key(row)
        if (not re.fullmatch(r'(?:NL\.IMBAG\.Pand\.)?[0-9]{16}', bag) or not isinstance(segment, str) or not segment
                or (bag, segment) in walls):
            raise ValueError(f'Invalid or repeated wall identity {bag}/{segment}')
        if (any(len(row[end]) != 2 or not all(map(number, row[end])) for end in ('a', 'b'))
                or wall_width(row) < 0.3 or not number(row['minY'])
                or not number(row['height']) or row['height'] < 0.3
                or row['wallType'] not in WALL_TYPES):
            raise ValueError(f'Invalid wall geometry for {bag}/{segment}')
        selected = ('bagId', 'wallId', 'a', 'b', 'minY', 'height', 'baseOffset', 'site',
                    'neighbourhood', 'buildingType', 'wallType', 'storeys')
        walls[bag, segment] = {k: row[k] for k in selected if k in row}
    return walls


def checked_opening(item, width, height):
    out = {k: item[k] for k in ('kind', 'x', 'y', 'width', 'height')}
    x, y, w, h = [out[k] for k in ('x', 'y', 'width', 'height')]
    if (out['kind'] not in OPENING_TYPES or not all(map(number, (x, y, w, h)))
            or min(x, y) < -0.05 or min(w, h) < 0.1 or x + w > width + 0.05 or y + h > height + 0.05):
        raise ValueError(f'Opening outside wall bounds: {out}')
    out.update(x=max(0, x), y=max(0, y), width=min(width - max(0, x), w), height=min(height - max(0, y), h))
    for name, maximum in OPENING_DIMENSIONS.items():
        if name in item:
            value = item[name]
            if name == 'arch' and (type(value) is bool or value in ('pointed', 'round')):
                out[name] = value
                continue
            if not number(value) or not 0 <= value <= maximum:
                raise ValueError(f'Invalid opening {name}: {value}')
            out[name] = value
    if 'transom' in item:
        value = item['transom']
        if not number(value) or not 0.1 <= value <= 0.95:
            raise ValueError(f'Invalid opening transom fraction: {value}')
        out['transom'] = value
    if 'tracery' in item:
        value = item['tracery']
        if type(value) is not bool:
            raise ValueError(f'Invalid opening tracery: {value}')
        out['tracery'] = value
    if 'panes' in item:
        value = item['panes']
        if type(value) is not int or not 1 <= value <= 12:
            raise ValueError(f'Invalid opening panes: {value}')
        out['panes'] = value
    return out


def checked_source(source):
    clean = {k: source[k] for k in ('imageId', 'capturedAt', 'creator', 'confidence') if k in source}
    if not re.fullmatch(r'[0-9]+', str(clean.get('imageId', ''))):
        raise ValueError('A Mapillary source requires a numeric image ID')
    clean['imageId'] = str(clean['imageId'])
    date.fromisoformat(clean['capturedAt'][:10])
    confidence = clean.get('confidence', 1)
    if not number(confidence) or not 0 <= confidence <= 1:
        raise ValueError('Invalid source confidence')
    return clean


def checked_detail(detail, openings):
    if not detail:
        return None
    index = detail.get('opening')
    if type(index) is not int or not 0 <= index < len(openings) or openings[index]['kind'] == 'window':
        raise ValueError('Recessed detail requires a valid entrance or storefront opening')
    clean = {'opening': index}
    for name, limit in (('depth', 3), ('surround', 0.5)):
        value = detail.get(name)
        if value is not None:
            if not number(value) or not 0 < value <= limit:
                raise ValueError(f'Invalid entrance {name}')
            clean[name] = value
    if 'interior' in detail:
        if type(detail['interior']) is not bool:
            raise ValueError('interior must be a boolean')
        clean['interior'] = detail['interior']
    return clean


def resolve_wall(identity, walls, by_bag):
    if identity in walls:
        return identity, 0.0
    bag, segment = identity
    try:
        ax, az, bx, bz, base = map(float, segment.split(','))
    except (ValueError, AttributeError):
        raise ValueError(f'Observation refers to unknown wall {identity}') from None
    matches = []
    for candidate in by_bag[bag]:
        wall = walls[candidate]
        da = math.dist((ax, az), wall['a'])
        db = math.dist((bx, bz), wall['b'])
        if max(da, db) <= 0.25 and abs(wall.get('baseOffset', 0) - base) <= 0.15:
            matches.append((da + db, candidate))
    matches.sort()
    if not matches or (len(matches) > 1 and matches[1][0] - matches[0][0] < 0.05):
        raise ValueError(f'Observation has no unambiguous wall match within 0.25 m: {identity}')
    _, candidate = matches[0]
    wall = walls[candidate]
    x, z = wall['a']
    dx, dz = wall['b'][0] - x, wall['b'][1] - z
    offset = ((ax - x) * dx + (az - z) * dz) / wall_width(wall)
    return candidate, offset


def checked_observations(rows, walls):
    by_wall, by_bag = defaultdict(list), defaultdict(list)
    for identity in walls:
        by_bag[identity[0]].append(identity)
    for row in rows:
        confidence = row['confidence']
        if not number(confidence) or not 0 <= confidence <= 1:
            raise ValueError(f'Invalid wall confidence for {key(row)}')
        if confidence < MIN_CONFIDENCE:
            continue
        identity, offset = resolve_wall(key(row), walls, by_bag)
        wall = walls[identity]
        if wall['wallType'] == 'shared':
            continue
        clean = {'confidence': confidence}
        for name in APPEARANCE_COLORS:
            if value := row.get(name):
                if not color(value):
                    raise ValueError(f'Invalid {name} for {identity}')
                clean[name] = value.lower()
        if 'wallMaterial' in row:
            value = row['wallMaterial']
            if value not in WALL_MATERIALS:
                raise ValueError(f'Invalid wall material for {identity}: {value}')
            clean['wallMaterial'] = value
        if (spacing := row.get('storeySpacing')) is not None:
            if not number(spacing) or not 1.8 <= spacing <= 6.5:
                raise ValueError(f'Invalid storey spacing for {identity}')
            clean['storeySpacing'] = spacing
        if 'occludedKinds' in row:
            kinds = row['occludedKinds']
            if not isinstance(kinds, list) or any(kind not in OPENING_TYPES for kind in kinds):
                raise ValueError(f'Invalid occluded opening kinds for {identity}')
            clean['occludedKinds'] = sorted(set(kinds))
        if 'openings' in row and row.get('layoutMeasured', True):
            inputs = ({**item, 'x': item['x'] + offset} for item in row['openings'])
            clean['openings'] = [checked_opening(item, wall_width(wall), wall['height']) for item in inputs]
        if not any(name in clean for name in (*APPEARANCE_COLORS, 'wallMaterial', 'openings')):
            continue
        clean['sources'] = [checked_source(source) for source in row['sources']]
        if not clean['sources']:
            raise ValueError(f'Reliable observation needs attribution for {identity}')
        if detail := checked_detail(row.get('detail'), clean.get('openings', [])):
            clean['detail'] = detail
        by_wall[identity].append(clean)
    return {identity: merge_views(views) for identity, views in by_wall.items()}


def overlap(a, b):
    w = min(a['x'] + a['width'], b['x'] + b['width']) - max(a['x'], b['x'])
    h = min(a['y'] + a['height'], b['y'] + b['height']) - max(a['y'], b['y'])
    intersect = max(0, w) * max(0, h)
    return intersect / (a['width'] * a['height'] + b['width'] * b['height'] - intersect)


def merge_views(views):
    # Quality decides ambiguous overlaps. Date breaks ties and favours newer alterations.
    ordered = sorted(views, key=lambda v: (v['confidence'], max(
        (s['capturedAt'], s['imageId']) for s in v['sources'])), reverse=True)
    merged = {k: v for k, v in ordered[0].items() if k not in ('detail', 'openings', 'sources', 'occludedKinds')}
    if hidden := set.intersection(*(set(view.get('occludedKinds', ())) for view in ordered)):
        merged['occludedKinds'] = sorted(hidden)
    openings, sources, detail = [], {}, None
    for view in ordered:
        for source in view['sources']:
            sources.setdefault(source['imageId'], source)
        for name in (*APPEARANCE_COLORS, 'wallMaterial', 'storeySpacing'):
            if name in view:
                merged.setdefault(name, view[name])
        for index, opening in enumerate(view.get('openings', ())):
            match = next((item for item in openings if overlap(item, opening) >= 0.45), None)
            if match is None:
                match = opening.copy()
                openings.append(match)
            elif match['kind'] == opening['kind']:
                for part in OPENING_DETAILS:
                    if part in opening:
                        match.setdefault(part, opening[part])
            if detail is None and view.get('detail', {}).get('opening') == index and match['kind'] == opening['kind']:
                detail = (view['detail'], match)
    openings.sort(key=lambda v: (v['y'], v['x']))
    merged.update(openings=openings, sources=list(sources.values()), status='observed')
    if not any('openings' in view for view in ordered):
        merged['layoutMeasured'] = False
    if detail:
        source, target = detail
        merged['detail'] = {**source, 'opening': next(i for i, item in enumerate(openings) if item is target)}
    return merged


def row_openings(openings, spacing):
    rows = defaultdict(list)
    for opening in openings:
        rows[int((opening['y'] + 0.04) / spacing)].append(opening)
    return rows


def bay_spacing(rows, single_width=None):
    distances = []
    found_window = False
    for row in rows.values():
        centers = sorted(o['x'] + o['width'] / 2 for o in row if o['kind'] == 'window')
        distances.extend(b - a for a, b in zip(centers, centers[1:]))
        found_window |= bool(centers)
    return middle(distances) if distances else single_width if found_window else None


def aggregate(buildings, values):
    # Aggregate the windows on each distinct BAG building before learning a median.
    return middle([median(samples) for walls in buildings.values() if (samples := list(values(walls)))])


def learn(buildings):
    spacing = aggregate(buildings, lambda walls: (w['storeySpacing'] for w in walls if 'storeySpacing' in w))
    palettes = {}
    for name in APPEARANCE_COLORS:
        votes = [hex_color(median(c[i] for c in values) for i in range(3))
                 for walls in buildings.values()
                 if (values := [rgb(w[name]) for w in walls if name in w])]
        if name == 'wallColor' or len(votes) >= 2:
            palettes[name] = sorted(votes)
    materials = Counter(
        Counter(wall['wallMaterial'] for wall in walls if 'wallMaterial' in wall).most_common(1)[0][0]
        for walls in buildings.values() if any('wallMaterial' in wall for wall in walls)
    )
    material = min(materials, key=lambda label: (-materials[label], label)) if materials else None
    if not spacing:
        return None
    samples = {}
    for bag, walls in buildings.items():
        samples[bag] = [
            (wall_width(w), row_openings(w['openings'], w.get('storeySpacing', spacing)))
            for w in walls
        ]
    # A wall component that starts above the building base cannot teach entrance layout.
    ground_samples = {bag: [sample for w, sample in zip(buildings[bag], walls) if w.get('baseOffset', 0) < 0.6]
                      for bag, walls in samples.items()}
    ground_count = aggregate(ground_samples, lambda walls: (len(r.get(0, [])) for _, r in walls if r.get(0)))
    typical_width = aggregate(ground_samples, lambda walls: (width for width, _ in walls))
    ground_candidates = [(width, rows[0]) for walls in ground_samples.values() for width, rows in walls if rows.get(0)]
    exemplar = next(iter(buildings.values()))[0]
    if exemplar['wallType'] == 'street':
        # Parked cars and planting commonly hide a doorway while leaving its upstairs windows.
        target = 'storefront' if exemplar['buildingType'] in {'shop', 'mixed-use'} else 'door'
        entrances = [item for item in ground_candidates if any(o['kind'] == target for o in item[1])]
        ground_candidates = entrances or ground_candidates
    representative = min(
        ground_candidates,
        key=lambda wall: (abs(len(wall[1]) - ground_count), abs(wall[0] - typical_width)),
        default=(1, []),
    )
    upper_share = aggregate(samples, lambda walls: (int(any(k > 0 for k in r)) for _, r in walls))
    upper = defaultdict(list)
    for bag, walls in samples.items():
        for _, rows in walls:
            for floor, openings in rows.items():
                if floor > 0:
                    upper[bag].extend((floor, item) for item in openings if item['kind'] == 'window')
    standard = max(1.8, spacing)
    upper_profile = {}
    if upper_share >= 0.5 and len(upper) >= 2:
        for part in ('width', 'height', 'frame', 'sill'):
            value = aggregate(upper, lambda wall: (o[part] for _, o in wall if part in o))
            if value is not None:
                upper_profile[part] = value
        offsets = {
            bag: [o['y'] - floor * w.get('storeySpacing', spacing)
                  for w in walls for floor, openings in row_openings(w['openings'], w.get('storeySpacing', spacing)).items()
                  if floor > 0 for o in openings if o['kind'] == 'window']
            for bag, walls in buildings.items()
        }
        upper_profile['y'] = aggregate(offsets, iter)
        upper_profile['spacing'] = aggregate(samples, lambda walls: (
            gap for width, rows in walls
            if (gap := bay_spacing({i: floor for i, floor in rows.items() if i > 0}, width)) is not None))
        upper_rows = {bag: [(width, wins) for width, rows in walls for floor, items in rows.items()
                            if floor > 0 and (wins := [o for o in items if o['kind'] == 'window'])]
                      for bag, walls in samples.items()}
        upper_count = aggregate(upper_rows, lambda walls: (len(wins) for _, wins in walls))
        upper_width = aggregate(upper_rows, lambda walls: (width for width, _ in walls))
        ref_width, ref_openings = min((row for walls in upper_rows.values() for row in walls),
                                     key=lambda row: (abs(len(row[1]) - upper_count), abs(row[0] - upper_width)))
        upper_profile['reference'] = (ref_width, ref_openings)
    templates = {}
    for kind in OPENING_TYPES:
        stats = {}
        for part in ('width', 'height', 'frame', 'sill'):
            value = aggregate(ground_samples, lambda walls: (
                o[part] for _, rows in walls for o in rows.get(0, []) if o['kind'] == kind and part in o))
            if value is not None:
                stats[part] = value
        templates[kind] = stats
    width, ground = representative
    return dict(spacing=standard, palettes=palettes, groundWidth=width, ground=ground, upper=upper_profile,
                groundSizes=templates, buildings=len(buildings),
                wallMaterial=material if material is not None and materials[material] >= 2 else None)


def infer(wall, profile, palette_seed, row_color=None):
    width, height = wall_width(wall), wall['height']
    base = wall.get('baseOffset', 0)
    spacing = profile['spacing']
    known_floors = wall.get('storeys')
    measured = type(known_floors) is int and 1 <= known_floors <= 100
    # BAG can count an attic which sits above the eave of this façade.
    visible_floors = max(1, math.floor((base + height) / spacing + 0.25))
    count = min(known_floors, visible_floors) if measured else visible_floors
    if base < 0.6:
        spacing = min(spacing, (height + base) / count)
    y_scale = spacing / profile['spacing']
    slots = []
    corner = min(0.35, max(0.12, width * 0.055))
    for opening in profile['ground'] if base < 0.6 else []:
        scale = width / profile['groundWidth']
        center = (opening['x'] + opening['width'] / 2) * scale
        typical = profile['groundSizes'][opening['kind']]
        size = (2 * opening['width'] + typical['width']) / 3
        if opening['kind'] == 'storefront':
            size *= min(1.6, max(0.5, scale))
        detail = {k: opening.get(k, typical[k]) for k in ('frame', 'sill') if k in typical}
        slots.append((center, {'kind': opening['kind'], **detail, 'width': size, 'y': max(0, opening['y'] * y_scale - base),
                               'height': (2 * opening['height'] + typical['height']) / 3 * y_scale}))
    openings = []
    slots.sort(key=lambda slot: slot[0])
    for i, (center, opening) in enumerate(slots):
        left = (slots[i - 1][0] + center) / 2 if i else 0
        right = (slots[i + 1][0] + center) / 2 if i + 1 < len(slots) else width
        x = max(corner, left + 0.07, center - opening['width'] / 2)
        end = min(width - corner, right - 0.07, center + opening['width'] / 2)
        h = min(opening['height'], height - opening['y'] - 0.04)
        if end - x >= 0.3 and h >= 0.3:
            openings.append({**opening, 'x': x, 'width': end - x, 'height': h})
    upper = profile['upper']
    if upper and upper['spacing']:
        ref_width, ref_openings = upper['reference']
        if 0.75 < width / ref_width < 1.35:
            windows = [((o['x'] + o['width'] / 2) * width / ref_width, o['width']) for o in ref_openings]
        else:
            bay_count = max(1, round(width / max(0.9, upper['spacing'])))
            bay = width / bay_count
            windows = [((j + 0.5) * bay, min(upper['width'], bay - 0.18)) for j in range(bay_count)]
        detail = {k: upper[k] for k in ('frame', 'sill') if k in upper}
        for floor in range(max(1, math.floor(base / spacing)), count):
            y = (floor * spacing) + upper['y'] * y_scale - base
            if y < 0.07:
                continue
            h = min(upper['height'] * y_scale, height - y - 0.08)
            if h < 0.3:
                break
            for center, size in windows:
                w = min(size, (min(center, width - center) - corner) * 2)
                if w >= 0.3:
                    openings.append(dict(kind='window', x=center - w / 2, y=y, width=w, height=h, **detail))
    selection = stable_number(palette_seed)
    variation = stable_number(wall['bagId']) % 7 - 3
    result = {}
    for name, palette in profile['palettes'].items():
        if not palette:
            continue
        # The same row shares a base tint. A small BAG-stable offset breaks uniformity.
        selected = row_color if name == 'wallColor' and row_color else palette[selection % len(palette)]
        result[name] = hex_color(chan + variation for chan in rgb(selected))
    if profile['wallMaterial']:
        result['wallMaterial'] = profile['wallMaterial']
    return dict(**result, openings=openings, storeySpacing=spacing, status='inferred')


def terrace_runs(walls):
    parents, cells, directions = {}, defaultdict(list), {}

    def leader(identity):
        while identity != parents[identity]:
            parents[identity] = parents[parents[identity]]
            identity = parents[identity]
        return identity

    for identity, wall in walls.items():
        if wall.get('buildingType') != 'terraced' or wall['wallType'] != 'street':
            continue
        parents[identity] = identity
        a, b = wall['a'], wall['b']
        size = wall_width(wall)
        ux, uz = directions[identity] = ((b[0] - a[0]) / size, (b[1] - a[1]) / size)
        for x, z in (a, b):
            ix, iz = math.floor(x), math.floor(z)
            neighbourhood = wall.get('neighbourhood')
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for near, nx, nz in cells.get((neighbourhood, ix + dx, iz + dz), ()):
                        vx, vz = directions[near]
                        if math.hypot(nx - x, nz - z) < 0.9 and abs(ux * vx + uz * vz) > 0.96:
                            p, q = sorted((leader(near), leader(identity)))
                            parents[q] = p
            cells[neighbourhood, ix, iz].append((identity, x, z))
    return {identity: '/'.join(leader(identity)) for identity in parents}


def supports_profile(wall, observation):
    return (wall.get('buildingType') in BUILDING_TYPES and 'wallColor' in observation
            and observation.get('layoutMeasured', True))


def choose_holdouts(walls, observed):
    groups = defaultdict(set)
    for identity in observed:
        wall = walls[identity]
        if supports_profile(wall, observed[identity]):
            groups[wall['buildingType'], wall['wallType']].add(identity[0])
    chosen = set()
    # A single holdout per supported class is enough for a pilot. Every wall from
    # that BAG ID is withheld, even when it could also train another class.
    for buildings in sorted(groups.values(), key=lambda g: (len(g), sorted(g))):
        if len(buildings) < MIN_BUILDINGS + 1 or buildings & chosen:
            continue
        for bag in sorted(buildings, key=stable_number):
            if all(len(group - chosen - {bag}) >= min(MIN_BUILDINGS, len(group))
                   for group in groups.values() if bag in group):
                chosen.add(bag)
                break
    return chosen


def compare(actual, inferred):
    result = {}
    if 'wallColor' in actual and 'wallColor' in inferred:
        result['srgbColorError'] = round(math.dist(rgb(actual['wallColor']), rgb(inferred['wallColor'])), 2)
    if 'storeySpacing' in actual:
        result['storeySpacingErrorM'] = round(abs(actual['storeySpacing'] - inferred['storeySpacing']), 3)
    if not actual.get('layoutMeasured', True):
        return result
    measured = actual.get('storeySpacing', inferred['storeySpacing'])
    hidden = set(actual.get('occludedKinds', ()))
    if hidden:
        result['occludedKinds'] = sorted(hidden)
    visible_actual = [item for item in actual['openings'] if item['kind'] not in hidden]
    visible_inferred = [item for item in inferred['openings'] if item['kind'] not in hidden]
    actual_rows = row_openings(visible_actual, measured)
    inferred_rows = row_openings(visible_inferred, inferred['storeySpacing'])
    a, b = bay_spacing(actual_rows), bay_spacing(inferred_rows)
    if a is not None and b is not None:
        result['windowSpacingErrorM'] = round(abs(a - b), 3)
    def entrance(o):
        return o['x'] + o['width'] / 2, o['y']
    a = sorted(entrance(o) for o in actual_rows.get(0, []) if o['kind'] == 'door')
    b = sorted(entrance(o) for o in inferred_rows.get(0, []) if o['kind'] == 'door')
    if a and b:
        result['doorAlignmentErrorM'] = round(median(min(math.dist(q, p) for p in b) for q in a), 3)
    if 'door' not in hidden:
        result['observedDoors'], result['inferredDoors'] = len(a), len(b)
    if 'window' not in hidden:
        result['observedWindows'] = sum(o['kind'] == 'window' for o in visible_actual)
        result['inferredWindows'] = sum(o['kind'] == 'window' for o in visible_inferred)
        result['windowCountError'] = abs(result['observedWindows'] - result['inferredWindows'])
    pairs = []
    for floor, actual_openings in actual_rows.items():
        for kind in OPENING_TYPES:
            a = [o for o in actual_openings if o['kind'] == kind]
            b = [o for o in inferred_rows.get(floor, ()) if o['kind'] == kind]
            distances = sorted(
                (math.dist((p['x'] + p['width'] / 2, p['y'] + p['height'] / 2),
                           (q['x'] + q['width'] / 2, q['y'] + q['height'] / 2)), i, j)
                for i, p in enumerate(a) for j, q in enumerate(b)
            )
            matched_a, matched_b = set(), set()
            for distance, i, j in distances:
                if i not in matched_a and j not in matched_b:
                    matched_a.add(i)
                    matched_b.add(j)
                    pairs.append(distance)
    result['matchedOpenings'] = len(pairs)
    result['unmatchedObservedOpenings'] = len(visible_actual) - len(pairs)
    result['unmatchedInferredOpenings'] = len(visible_inferred) - len(pairs)
    if pairs:
        result['openingCenterErrorM'] = round(median(pairs), 3)
    return result


def rounded(value):
    if isinstance(value, float):
        return round(value, 3)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded(v) for v in value]
    return value


def fitting_context(walls, observed, runs, holdout):
    training = defaultdict(lambda: defaultdict(list))
    for identity, observation in sorted(observed.items()):
        wall = walls[identity]
        if identity[0] in holdout or not supports_profile(wall, observation):
            continue
        group = (wall['buildingType'], wall['wallType'])
        training[('Ede', *group)][identity[0]].append(wall | observation)
        if neighbourhood := wall.get('neighbourhood'):
            training[(neighbourhood, *group)][identity[0]].append(wall | observation)
    profiles = {
        k: profile for k, buildings in training.items()
        if len(buildings) >= MIN_BUILDINGS and (profile := learn(buildings))
    }
    terrace_colors = defaultdict(lambda: defaultdict(list))
    for identity, observation in observed.items():
        if identity in runs and identity[0] not in holdout and 'wallColor' in observation:
            terrace_colors[runs[identity]][identity[0]].append(rgb(observation['wallColor']))
    anchors = {
        run: hex_color(median(median(c[i] for c in samples) for samples in buildings.values()) for i in range(3))
        for run, buildings in terrace_colors.items()
    }
    return profiles, anchors, training


def fit_style(identity, wall, profiles, runs, anchors):
    if wall['wallType'] == 'shared' or wall_width(wall) < 1.8 or wall['height'] < 1.6:
        return None
    group = (wall.get('buildingType'), wall['wallType'])
    local = (wall.get('neighbourhood'), *group)
    group_key = local if local in profiles else ('Ede', *group)
    profile = profiles.get(group_key)
    if profile is None:
        return None
    run = runs.get(identity)
    style = infer(wall, profile, run or identity[0], anchors.get(run))
    style['profile'] = '/'.join(group_key)
    return style


def compare_holdout(identity, actual, style):
    check = dict(bagId=identity[0], wallId=identity[1], sources=actual['sources'])
    if style:
        check.update(profile=style['profile'], **compare(actual, style))
    else:
        check['fallback'] = 'Fewer than three suitable training buildings or no reliable storey spacing'
    return check


def validate(catalogue, observations, holdout=None):
    walls = checked_walls(catalogue)
    observed = checked_observations(observations, walls)
    runs = terrace_runs(walls)
    bags = sorted({bag for bag, _ in observed})
    folds = [{bag} for bag in bags] if holdout is None else [set(holdout)]
    if invalid := set().union(*folds) - set(bags):
        raise ValueError(f'Held-out BAG ID has no reliable photo: {", ".join(sorted(invalid))}')
    validation = []
    for fold in folds:
        profiles, anchors, _ = fitting_context(walls, observed, runs, fold)
        checks = [
            compare_holdout(identity, actual, fit_style(identity, walls[identity], profiles, runs, anchors))
            for identity, actual in sorted(observed.items()) if identity[0] in fold
        ]
        validation.append(dict(heldOutBuildings=sorted(fold), checks=checks,
                               profiles={'/'.join(k): v['buildings'] for k, v in sorted(profiles.items())}))
    return validation


def bake(catalogue, observations, holdout=None):
    walls = checked_walls(catalogue)
    observed = checked_observations(observations, walls)
    holdout = choose_holdouts(walls, observed) if holdout is None else set(holdout)
    if invalid := holdout - {bag for bag, _ in observed}:
        raise ValueError(f'Held-out BAG ID has no reliable photo: {", ".join(sorted(invalid))}')
    runs = terrace_runs(walls)
    profiles, anchors, training = fitting_context(walls, observed, runs, holdout)
    results, checks = [], []
    for identity in sorted(walls):
        wall = walls[identity]
        actual = observed.get(identity)
        evaluate = actual is not None and identity[0] in holdout
        style = fit_style(identity, wall, profiles, runs, anchors)
        if actual is not None and not evaluate:
            row = wall | actual
            if style and not actual.get('layoutMeasured', True):
                row = wall | style | actual | {'openings': style['openings'], 'layoutStatus': 'inferred'}
            results.append(row)
        elif wall['wallType'] == 'shared':
            results.append(wall | dict(openings=[], status='inferred'))
        elif style:
            results.append(wall | style)
        if evaluate:
            checks.append(compare_holdout(identity, actual, style))
    groups = defaultdict(lambda: defaultdict(set))
    for identity, wall in walls.items():
        area, kind = wall.get('neighbourhood') or 'outside-CBS-Ede', wall.get('buildingType') or 'other'
        for group in ((area, kind), ('Ede', kind)):
            groups[group]['catalogueBuildings'].add(identity[0])
            if identity in observed:
                groups[group]['reviewedBuildings'].add(identity[0])
    for row in results:
        area, kind = row.get('neighbourhood') or 'outside-CBS-Ede', row.get('buildingType') or 'other'
        category = ('shared' if row['wallType'] == 'shared' else row['status']) + 'Buildings'
        for group in ((area, kind), ('Ede', kind)):
            groups[group][category].add(row['bagId'])
    report = {
        'catalogueBuildings': len({bag for bag, _ in walls}),
        'catalogueWalls': len(walls), 'reliableObservedWalls': len(observed),
        'observationsBelowConfidence': sum(row['confidence'] < MIN_CONFIDENCE for row in observations),
        'coverage': {
            '/'.join(group): {name: len(bags) for name, bags in sorted(counts.items())}
            for group, counts in sorted(groups.items())
        },
        'heldOutBuildings': sorted(holdout), 'holdoutComparisons': checks,
        'observedWalls': sum(item['status'] == 'observed' for item in results),
        'inferredWalls': sum(item['status'] != 'observed' and 'profile' in item for item in results),
        'blankSharedWalls': sum(item['wallType'] == 'shared' for item in results),
        'proceduralWalls': len(walls) - len(results),
        'profiles': {'/'.join(k): v['buildings'] for k, v in sorted(profiles.items())},
        'trainingCoverage': {'/'.join(k): len(v) for k, v in sorted(training.items())},
    }
    return rounded(dict(version=2, attribution=ATTRIBUTION, walls=results)), report


def load(path, name):
    value = json.loads(path.read_text())
    if value.get('version') != 1 or not isinstance(value.get(name), list):
        raise ValueError(f'Expected a version 1 {name} array in {path}')
    return value


def save(path, value):
    raw = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    if path.suffix == '.gz':
        raw = gzip.compress(raw, compresslevel=9, mtime=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        try:
            temporary.write(raw)
            temporary.flush()
            os.chmod(temporary.name, 0o644)
            Path(temporary.name).replace(path)
        finally:
            Path(temporary.name).unlink(missing_ok=True)
    return len(raw)


def tile_assets(path, value):
    blocks = defaultdict(list)
    for wall in value['walls']:
        ix, iz = (math.floor((a + b) / (2 * TILE_SIZE)) for a, b in zip(wall['a'], wall['b']))
        blocks[ix, iz].append({name: param for name, param in wall.items()
                               if name not in ('buildingType', 'neighbourhood', 'storeys', 'site')})
    tiles = {}
    tile_bytes = 0
    for (ix, iz), walls in sorted(blocks.items()):
        name = f'{path.stem}/{ix}_{iz}.json.gz'
        tile_bytes += save(path.parent / name, {'version': 2, 'walls': walls})
        tiles[f'{ix},{iz}'] = name
    index_bytes = save(path, dict(version=2, attribution=value['attribution'], tileSize=TILE_SIZE, tiles=tiles))
    return {'tiles': len(tiles), 'tileBytes': tile_bytes, 'indexBytes': index_bytes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalogue', type=Path)
    parser.add_argument('observations', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'assets/ede-facades.json')
    parser.add_argument('--report', type=Path, help='Write whole-building holdout errors and profile coverage')
    parser.add_argument('--hold-out', action='append', metavar='BAG_ID', help='Override the automatic BAG ID holdout selection')
    args = parser.parse_args()
    try:
        catalogue = load(args.catalogue, 'walls')
        observations = load(args.observations, 'observations')['observations']
        asset, report = bake(catalogue['walls'], observations, holdout=())
        validation = validate(catalogue['walls'], observations, args.hold_out)
        report['heldOutBuildings'] = sorted({bag for fold in validation for bag in fold['heldOutBuildings']})
        report['holdoutComparisons'] = [row for fold in validation for row in fold['checks']]
        report['validationProfiles'] = [
            {k: fold[k] for k in ('heldOutBuildings', 'profiles')} for fold in validation
        ]
        report['metrics'] = {
            name: {'samples': len(values), 'median': round(median(values), 3), 'max': max(values)}
            for name in ('windowCountError', 'openingCenterErrorM', 'storeySpacingErrorM', 'srgbColorError')
            if (values := [row[name] for row in report['holdoutComparisons'] if name in row])
        }
        report['neighbourhoodNames'] = catalogue.get('neighbourhoodNames', {})
        report['catalogueSources'] = catalogue.get('source', {})
        report['assets'] = tile_assets(args.output, asset)
        if args.report:
            save(args.report, report)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps({key: value for key, value in report.items()
                      if key not in ('coverage', 'neighbourhoodNames', 'catalogueSources')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
