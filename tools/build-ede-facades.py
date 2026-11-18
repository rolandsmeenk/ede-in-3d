#!/usr/bin/env python3
"""Build observed and inferred wall appearances from a BAG wall catalogue and reviewed observations."""

import argparse
from collections import defaultdict
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import re
from statistics import median
import tempfile


BUILDING_TYPES = {'terraced', 'apartments', 'detached', 'shop'}
WALL_TYPES = {'street', 'side', 'rear', 'shared'}
OPENING_TYPES = ('window', 'door', 'storefront')
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
    for name in ('frame', 'sill'):
        value = item.get(name)
        if value is not None:
            if not number(value) or not 0 <= value <= 0.3:
                raise ValueError(f'Invalid opening {name}: {value}')
            out[name] = value
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


def checked_photos(rows, walls, observed):
    photos = defaultdict(list)
    for row in rows:
        identity = key(row)
        if identity not in observed:
            raise ValueError(f'Photo atlas requires a reliable observed wall: {identity}')
        wall = walls[identity]
        for photo in row['photos']:
            file, region, rect = [photo[k] for k in ('file', 'range', 'rect')]
            if (not re.fullmatch(r'ede-facade-[a-z0-9-]+\.webp', file)
                    or len(region) != 4 or not all(number(v) and 0 <= v <= 1 for v in region)
                    or region[0] >= region[2] or region[1] >= region[3]
                    or len(rect) != 4 or not all(number(v) and v >= 0 for v in rect)
                    or min(rect[2:]) <= 0 or rect[0] + rect[2] > wall_width(wall) + 0.03
                    or rect[1] + rect[3] > wall['height'] + 0.03):
                raise ValueError(f'Invalid local photo atlas region for {identity}')
            if photo.get('license') != ATTRIBUTION['license']:
                raise ValueError(f'Photo atlas lacks the stated Mapillary license for {identity}')
            source = checked_source(photo)
            clean = dict(file=file, range=region, rect=rect, **source, license=photo['license'])
            if 'recessed' in photo:
                if type(photo['recessed']) is not bool:
                    raise ValueError('recessed must be a boolean')
                clean['recessed'] = photo['recessed']
            if clean not in photos[identity]:
                photos[identity].append(clean)
    return photos


def checked_observations(rows, walls):
    by_wall = defaultdict(list)
    for row in rows:
        identity = key(row)
        if identity not in walls:
            raise ValueError(f'Observation refers to unknown wall {identity}')
        confidence = row['confidence']
        if not number(confidence) or not 0 <= confidence <= 1:
            raise ValueError(f'Invalid wall confidence for {identity}')
        if confidence < MIN_CONFIDENCE or walls[identity]['wallType'] == 'shared':
            continue
        wall = walls[identity]
        clean = {'confidence': confidence}
        for name in ('wallColor', 'roofColor'):
            if value := row.get(name):
                if not color(value):
                    raise ValueError(f'Invalid {name} for {identity}')
                clean[name] = value.lower()
        if (spacing := row.get('storeySpacing')) is not None:
            if not number(spacing) or not 1.8 <= spacing <= 6.5:
                raise ValueError(f'Invalid storey spacing for {identity}')
            clean['storeySpacing'] = spacing
        if 'openings' in row:
            clean['openings'] = [checked_opening(item, wall_width(wall), wall['height']) for item in row['openings']]
        if 'wallColor' not in clean and not clean.get('openings'):
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
    merged = {k: v for k, v in ordered[0].items() if k not in ('detail', 'openings', 'sources')}
    openings, sources, detail = [], {}, None
    for view in ordered:
        for source in view['sources']:
            sources.setdefault(source['imageId'], source)
        for name in ('wallColor', 'roofColor', 'storeySpacing'):
            if name in view:
                merged.setdefault(name, view[name])
        for index, opening in enumerate(view.get('openings', ())):
            match = next((item for item in openings if overlap(item, opening) >= 0.45), None)
            if match is None:
                match = opening.copy()
                openings.append(match)
            elif match['kind'] == opening['kind']:
                for part in ('frame', 'sill'):
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
    for name in ('wallColor', 'roofColor'):
        votes = [hex_color(median(c[i] for c in values) for i in range(3))
                 for walls in buildings.values()
                 if (values := [rgb(w[name]) for w in walls if name in w])]
        if name == 'wallColor' or len(votes) >= 2:
            palettes[name] = sorted(votes)
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
        target = 'storefront' if exemplar['buildingType'] == 'shop' else 'door'
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
                groundSizes=templates, buildings=len(buildings))


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
    for opening in profile['ground'] if base < 0.6 else []:
        scale = width / profile['groundWidth']
        center = (opening['x'] + opening['width'] / 2) * scale
        typical = profile['groundSizes'][opening['kind']]
        size = (2 * opening['width'] + typical['width']) / 3
        if opening['kind'] == 'storefront':
            size *= min(1.6, max(0.5, scale))
        detail = {k: opening.get(k, typical[k]) for k in ('frame', 'sill') if k in typical}
        slots.append((center, {**detail, **opening, 'width': size, 'y': max(0, opening['y'] * y_scale - base),
                               'height': (2 * opening['height'] + typical['height']) / 3 * y_scale}))
    openings = []
    slots.sort(key=lambda slot: slot[0])
    for i, (center, opening) in enumerate(slots):
        left = (slots[i - 1][0] + center) / 2 if i else 0
        right = (slots[i + 1][0] + center) / 2 if i + 1 < len(slots) else width
        x = max(left + 0.07, center - opening['width'] / 2)
        end = min(right - 0.07, center + opening['width'] / 2)
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
                w = min(size, (min(center, width - center) - 0.07) * 2)
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
    if 'wallColor' in actual:
        result['srgbColorError'] = round(math.dist(rgb(actual['wallColor']), rgb(inferred['wallColor'])), 2)
    if not actual.get('layoutMeasured', True):
        return result
    measured = actual.get('storeySpacing', inferred['storeySpacing'])
    actual_rows = row_openings(actual['openings'], measured)
    inferred_rows = row_openings(inferred['openings'], inferred['storeySpacing'])
    a, b = bay_spacing(actual_rows), bay_spacing(inferred_rows)
    if a is not None and b is not None:
        result['windowSpacingErrorM'] = round(abs(a - b), 3)
    def entrance(o):
        return o['x'] + o['width'] / 2, o['y']
    a = sorted(entrance(o) for o in actual_rows.get(0, []) if o['kind'] == 'door')
    b = sorted(entrance(o) for o in inferred_rows.get(0, []) if o['kind'] == 'door')
    if a and b:
        result['doorAlignmentErrorM'] = round(median(min(math.dist(q, p) for p in b) for q in a), 3)
    result['observedDoors'], result['inferredDoors'] = len(a), len(b)
    result['observedWindows'] = sum(o['kind'] == 'window' for o in actual['openings'])
    result['inferredWindows'] = sum(o['kind'] == 'window' for o in inferred['openings'])
    return result


def rounded(value):
    if isinstance(value, float):
        return round(value, 3)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded(v) for v in value]
    return value


def bake(catalogue, observations, holdout=None, photos=()):
    walls = checked_walls(catalogue)
    observed = checked_observations(observations, walls)
    photos = checked_photos(photos, walls, observed)
    holdout = choose_holdouts(walls, observed) if holdout is None else set(holdout)
    if invalid := holdout - {bag for bag, _ in observed}:
        raise ValueError(f'Held-out BAG ID has no reliable photo: {", ".join(sorted(invalid))}')
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
    runs = terrace_runs(walls)
    terrace_colors = defaultdict(lambda: defaultdict(list))
    for identity, observation in observed.items():
        if identity in runs and identity[0] not in holdout and 'wallColor' in observation:
            terrace_colors[runs[identity]][identity[0]].append(rgb(observation['wallColor']))
    anchors = {
        run: hex_color(median(median(c[i] for c in samples) for samples in buildings.values()) for i in range(3))
        for run, buildings in terrace_colors.items()
    }
    results, checks = [], []
    for identity in sorted(walls):
        wall = walls[identity]
        actual = observed.get(identity)
        evaluate = actual is not None and identity[0] in holdout
        if actual is not None and not evaluate:
            row = wall | actual
            if identity in photos:
                row['photos'] = photos[identity]
            results.append(row)
            continue
        if wall['wallType'] == 'shared':
            continue
        group = (wall.get('buildingType'), wall['wallType'])
        local = (wall.get('neighbourhood'), *group)
        group_key = local if local in profiles else ('Ede', *group)
        profile = profiles.get(group_key)
        style = None
        if profile and wall_width(wall) >= 1.8 and wall['height'] >= 1.6:
            run = runs.get(identity)
            style = infer(wall, profile, run or identity[0], anchors.get(run))
            style['profile'] = '/'.join(group_key)
            results.append(wall | style)
        if evaluate:
            check = dict(bagId=identity[0], wallId=identity[1], sources=actual['sources'])
            if style:
                check.update(profile=style['profile'], **compare(actual, style))
            else:
                check['fallback'] = 'Fewer than three suitable training buildings or no reliable storey spacing'
            checks.append(check)
    detailed_bags = {wall['bagId'] for wall in results}
    for identity in sorted(walls):
        if identity[0] in detailed_bags and walls[identity]['wallType'] == 'shared':
            results.append(walls[identity] | dict(openings=[], status='inferred'))
    report = {
        'catalogueWalls': len(walls), 'reliableObservedWalls': len(observed),
        'heldOutBuildings': sorted(holdout), 'holdoutComparisons': checks,
        'observedWalls': sum(item['status'] == 'observed' for item in results),
        'inferredWalls': sum('profile' in item for item in results),
        'blankSharedWalls': sum(item['wallType'] == 'shared' for item in results),
        'proceduralWalls': len(walls) - len(results),
        'profiles': {'/'.join(k): v['buildings'] for k, v in sorted(profiles.items())},
        'trainingCoverage': {'/'.join(k): len(v) for k, v in sorted(training.items())},
    }
    return rounded(dict(version=1, attribution=ATTRIBUTION, walls=results)), report


def load(path, name):
    value = json.loads(path.read_text())
    if value.get('version') != 1 or not isinstance(value.get(name), list):
        raise ValueError(f'Expected a version 1 {name} array in {path}')
    return value[name]


def save(path, value):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as temporary:
        try:
            temporary.write(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
            temporary.flush()
            Path(temporary.name).replace(path)
        finally:
            Path(temporary.name).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalogue', type=Path)
    parser.add_argument('observations', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'assets/ede-facades.json')
    parser.add_argument('--report', type=Path, help='Write whole-building holdout errors and profile coverage')
    parser.add_argument('--photos', type=Path, help='Attach attributed local photo atlas regions to observed walls')
    parser.add_argument('--hold-out', action='append', metavar='BAG_ID', help='Override the automatic BAG ID holdout selection')
    args = parser.parse_args()
    try:
        asset, report = bake(load(args.catalogue, 'walls'), load(args.observations, 'observations'), args.hold_out,
                             load(args.photos, 'walls') if args.photos else ())
        save(args.output, asset)
        if args.report:
            save(args.report, report)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
