"""Match the alternate Ede tree inventory and enrich the same verified trunks."""

from collections import Counter, defaultdict
import gzip
from hashlib import sha256
import json
import math
import re

from shapely import STRtree, contains_xy, intersects_xy, make_valid, points, prepare
from shapely.geometry import LineString, Polygon

from ede_gis import Frame, source_crs
from ede_map import ROOT, load_playable_boundary, load_playable_scene, load_scene

BGT, OSM, SURVEYED, MOR, ROADSIDE, AHN, PHENOLOGY = 1, 4, 8, 16, 32, 64, 128
UNKNOWN = 255
ROAD_REFS = ('N224', 'N304', 'N781')
VEHICLE_SURFACES = {
    'rijbaan lokale weg', 'rijbaan regionale weg', 'rijbaan autosnelweg',
    'parkeervlak', 'inrit', 'verkeersdrempel', 'ov-baan', 'overweg', 'verbindingsweg', 'woonerf',
}
SOLID_STRUCTURES = {'abutment', 'civilWall', 'deck', 'foundation', 'platform', 'shed', 'tank'}
PHENOLOGY_GROUPS = (
    '',
    'abies cedrus chamaecyparis cupressus juniperus picea pinus pseudotsuga sequoia sequoiadendron taxus thuja',
    'alnus betula cercidiphyllum fraxinus ginkgo gleditsia larix metasequoia populus pterocarya robinia salix taxodium',
    'acer',
    'platanus',
    'aesculus',
    'carpinus fagus quercus',
    'amelanchier malus prunus pyrus sorbus',
)
GENUS_GROUP = {genus: group for group, names in enumerate(PHENOLOGY_GROUPS) for genus in names.split()}
# Both positions fall in the same courtyard crown. Preserve the documented photo-surveyed trunk.
VUUR_MOR = (173758.39585889, 450112.29981018)
# 2026 PDOK ortho and AHN review. Recheck if a source position moves.
REVIEWED_HOLDS = {
    59460: (172483.45741898, 451304.74021044),
    77638: (174735.5, 447322.6),
    1207: (174900.1, 447385.5),
    1320: (174906.2, 447386.3),
}


def xy(flat):
    return list(zip(flat[::2], flat[1::2], strict=True))


def poly(rings):
    shape = Polygon(xy(rings[0]), [xy(hole) for hole in rings[1:]])
    return shape if shape.is_valid else make_valid(shape)


def polygons(rows):
    return [poly([row['ring'], *row.get('holes', ())]) for row in rows]


def spatial_masks(scene):
    with gzip.open(ROOT / 'assets/ede-road-surfaces.json.gz', 'rt') as src:
        road = json.load(src)
    shapes = defaultdict(list)
    shapes['building'] = polygons(scene['buildings'])
    shapes['water'] = polygons(scene['water'])
    for row in road['surfaces']:
        if row['function'] in VEHICLE_SURFACES:
            key = 'vehicle pavement' if row['layer'] == 0 else 'grade separation'
            shapes[key].extend(poly(polygon) for polygon in row['polygons'])
    for way in scene['roads']:
        if not way.get('modes') or not any(mask & 7 for mask in way['modes']):
            continue
        covered = set(road['covered'].get(way['id'], []))
        coordinates = xy(way['pts'])
        halfwidth = max(0.5, (way.get('bgt', {}).get('width') or way['width']) / 2 - 0.55)
        if way['bridge'] or way['tunnel'] or way['layer'] != 0:
            shapes['grade separation'].append(LineString(coordinates).buffer(halfwidth, cap_style='flat'))
        else:
            for i, (a, b) in enumerate(zip(coordinates, coordinates[1:])):
                if i not in covered and a != b:
                    shapes['OSM vehicle surface'].append(LineString((a, b)).buffer(halfwidth, cap_style='flat'))
    data = json.loads((ROOT / 'assets/ede-bgt.json').read_text())
    for row in data['structures']:
        if row['kind'] in SOLID_STRUCTURES:
            shapes['BGT structure'].extend(poly(polygon) for polygon in row['polygons'])
    # The original point can round up to 14 cm into an obstacle in the runtime asset.
    for key in ('building', 'water', 'BGT structure'):
        shapes[key] = [shape.buffer(0.15) for shape in shapes[key] if not shape.is_empty]
    return {key: STRtree(areas) for key, areas in shapes.items()}


def in_bounds(world, limits):
    x, z = world
    return limits[0] <= x <= limits[2] and limits[1] <= z <= limits[3]


def get_points(document, frame, limits):
    features = document['features']
    if (document.get('type') != 'FeatureCollection' or document.get('numberMatched') != len(features)
            or source_crs(document).to_epsg() not in (4326, 28992)):
        raise ValueError('Unexpected MOR snapshot structure or CRS; revalidate the axis convention')
    ids, result = set(), []
    for feature in features:
        identity = feature['properties']['id']
        e, n = feature['geometry']['coordinates']
        if (not isinstance(identity, int) or identity in ids or feature['id'] != f'mor_bomen.{identity}'
                or feature['geometry']['type'] != 'Point'
                or not (160000 < e < 205000 and 425000 < n < 470000)):
            raise ValueError(f'Invalid MOR point {identity}')
        ids.add(identity)
        world = frame.rd_to_scene(e, n)
        if in_bounds(world, limits):
            result.append((identity, (e, n), world))
    return result


def match_rows(records, sites, radius, eligible=lambda *_: True, review_gap=0):
    """Return a deterministic one-to-one join and hold unresolved close points for review."""
    if not records or not sites:
        return {}, set()
    positions = points([tree.rd for tree in sites])
    record_positions = points([record[1] for record in records])
    tree = STRtree(positions)
    source_ids, target_ids = tree.query(record_positions, predicate='dwithin', distance=radius)
    distances = defaultdict(list)
    for i, j in zip(source_ids.tolist(), target_ids.tolist()):
        if eligible(records[i], sites[j]):
            distances[i].append((math.dist(records[i][1], sites[j].rd), j))
    ambiguous = set()
    for i, candidates in distances.items():
        candidates.sort()
        if review_gap and len(candidates) > 1 and candidates[0][0] > 0.6 and candidates[1][0] - candidates[0][0] < review_gap:
            ambiguous.add(i)
    pairs = sorted((distance, records[i][0], i, j) for i, cs in distances.items() if i not in ambiguous for distance, j in cs)
    matched, claimed = {}, set()
    for distance, _, i, j in pairs:
        if i not in matched and j not in claimed:
            matched[i] = (j, distance)
            claimed.add(j)
    near_conflicts = set(distances) - matched.keys()
    return matched, near_conflicts


def rejection_masks(records, masks):
    if not records:
        return {}
    positions = points([r[2] for r in records])
    reasons = defaultdict(list)
    for key, tree in masks.items():
        for source in set(tree.query(positions, predicate='intersects')[0].tolist()):
            reasons[source].append(key)
    return reasons


def range_m(label):
    if not label:
        return None
    values = [float(raw.replace(',', '.')) for raw in re.findall(r'\d+(?:[,.]\d+)?', label)]
    if len(values) == 2:
        return values
    if len(values) == 1:
        return (0, values[0]) if 'tot' in label else (values[0], None)
    raise ValueError(f'Unrecognized tree dimension class {label!r}')


def estimate(bounds):
    low, high = bounds
    return low if high is None else (low + high) / 2


def enrich_roadside(document, scene, frame, sites, classify):
    if source_crs(document).to_epsg() != 28992 or not document.get('features') or document.get('exceededTransferLimit'):
        raise ValueError('Expected a complete RD New snapshot for the Gelderland roadside trees')
    tags = json.loads((ROOT / 'js/ede-road-tags.js').read_text().split(' = ', 1)[1].strip().removesuffix(';'))
    corridors = {ref: STRtree([LineString(xy(way['pts'])) for way in scene['roads']
                              if tags.get(way['id'], {}).get('ref') == ref and way['layer'] == 0])
                 for ref in ROAD_REFS}
    matched = []
    for feature in document['features']:
        a = feature['attributes']
        ref = a['weg']
        if (ref not in ROAD_REFS or a['bgt_status'] != 'bestaand'
                or a['status'] not in ('Bestaand', None) or a['relatieve_hoogteligging'] not in (0, None)):
            continue
        rd = tuple(feature['geometry'][k] for k in ('x', 'y'))
        world = frame.rd_to_scene(*rd)
        if in_bounds(world, scene['meta']['bounds']):
            matched.append((a['boo_id'], rd, world, a))
    verified = []
    for ref, corridor in corridors.items():
        candidates = [r for r in matched if r[3]['weg'] == ref]
        # A nearby active provincial centreline corroborates the source's corridor id.
        indices = sorted(set(corridor.query(points([row[2] for row in candidates]),
                                           predicate='dwithin', distance=27)[0].tolist())) if candidates else []
        verified.extend(candidates[i] for i in indices)
    pairs, uncertain = match_rows(verified, sites, 2, lambda row, tree: not (tree.sources & SURVEYED), review_gap=0.3)
    counts, rows = Counter(), []
    counts['inBounds'], counts['corridorVerified'] = len(matched), len(verified)
    for i, (identity, rd, _, a) in enumerate(verified):
        if i not in pairs:
            result = 'ambiguous' if i in uncertain else 'unmatched'
            counts[result] += 1
            continue
        counts['matched'] += 1
        j, distance = pairs[i]
        tree = sites[j]
        species = classify(a['soortnaam_boom'])
        group = GENUS_GROUP.get((a['soortnaam_boom'] or '').lower().split(' ', 1)[0])
        height, diameter = range_m(a['boomhoogteklasse_actueel']), range_m(a['stamdiameterklasse'])
        fields = {}
        if not tree.height and height:
            tree.height = estimate(height)
            fields['heightClassMeters'] = height
        if not tree.diameter and diameter:
            tree.diameter = 100 * estimate(diameter)
            fields['diameterClassMeters'] = diameter
        if tree.species == UNKNOWN and species != UNKNOWN:
            tree.species = species
            fields['scientificName'] = a['soortnaam_boom']
        if not (tree.sources & PHENOLOGY) and group is not None and tree.species == species:
            tree.sources |= PHENOLOGY
            tree.season_group = group
            fields['seasonGroup'] = group
        if fields:
            tree.sources |= ROADSIDE
            counts.update(fields.keys())
        rows.append({'source': identity, 'rd': rd, 'matchedTrunkRD': tree.rd, 'distance': round(distance, 3),
                     'road': a['weg'], 'updated': a['lastupdate'], 'fields': fields})
    return dict(counts), rows


def coverage(sites):
    return {'count': len(sites), 'height': sum(t.height > 0 for t in sites),
            'diameter': sum(t.diameter > 0 for t in sites),
            'species': sum(t.species != UNKNOWN for t in sites),
            'crown': sum(t.crown_width > 0 for t in sites),
            'phenology': sum(bool(t.sources & PHENOLOGY) for t in sites)}


def expand(args, Tree, unpack_baseline, pack, classify, read_geojson, unique_trees, join):
    output = args.output or ROOT / 'assets/ede-trees-expanded.bin'
    if output.resolve() == args.baseline.resolve():
        raise ValueError('The expanded tree output must preserve the baseline asset')
    scene = load_playable_scene() if args.playable else load_scene()
    frame = Frame(scene['meta']['lonLatAffine'])
    base = unpack_baseline(args.baseline, frame)
    if pack(base) != args.baseline.read_bytes():
        raise ValueError('The expansion did not round-trip the baseline inventory')
    municipal = json.loads(args.mor.read_text())
    records = sorted(get_points(municipal, frame, scene['meta']['bounds']))
    boundary = load_playable_boundary() if args.playable else None
    if boundary is not None:
        prepare(boundary)
        records = [row for row in records if contains_xy(boundary, *row[2])]
        base = [tree for tree in base if intersects_xy(boundary, *tree.world)]
    masks = spatial_masks(scene)
    baseline_counts = coverage(base)
    bgt_count = osm_count = 0
    if args.playable and args.pdok:
        raw_bgt = [(identity, rd, world) for rd, p, identity in read_geojson(args.pdok, 'Point')
                   if p.get('plus_type', 'boom') == 'boom' and p.get('status', 'bestaand') == 'bestaand'
                   and contains_xy(boundary, *(world := frame.rd_to_scene(*rd)))
                   and not (scene['meta']['baseBounds'][0] <= world[0] <= scene['meta']['baseBounds'][2]
                            and scene['meta']['baseBounds'][1] <= world[1] <= scene['meta']['baseBounds'][3])]
        rejects = rejection_masks(raw_bgt, masks)
        additions = unique_trees([Tree(rd, world, sources=BGT) for i, (_, rd, world) in enumerate(raw_bgt) if i not in rejects])
        before = len(base)
        join(base, additions, 1.2)
        bgt_count = len(base) - before
    if args.playable and scene['meta'].get('fullMunicipality'):
        with gzip.open(ROOT / 'assets/ede-north-v1.json.gz', 'rt') as legacy:
            prior_bounds = json.load(legacy)['bounds']
        mapped = []
        for row in scene['trees']:
            world = row['x'], row['z']
            if in_bounds(world, prior_bounds):
                continue
            height = row.get('h', 0)
            mapped.append(Tree(frame.scene_to_rd(*world), world, height if height != 8 else 0, sources=OSM))
        before = len(base)
        join(base, unique_trees(mapped), 1.2)
        osm_count = len(base) - before
    surveyed = next((tree for tree in base if tree.sources & SURVEYED and math.dist(tree.rd, VUUR_MOR) < 5.6), None)
    alias = next((i for i, (identity, rd, _) in enumerate(records)
                  if identity == 9775 and math.dist(rd, VUUR_MOR) < 0.5), None) if surveyed else None
    # Reserve the reviewed trunk before the distance join.
    eligible = (lambda row, tree: row[0] != 9775 and tree is not surveyed) if alias is not None else (lambda *_: True)
    pairs, uncertain = match_rows(records, base, 2.5, eligible, review_gap=0.3)
    if alias is not None:
        uncertain.update(i for i, (_, rd, _) in enumerate(records)
                         if i != alias and i not in pairs and math.dist(rd, surveyed.rd) <= 2.5)
    unmatched = [r for i, r in enumerate(records) if i != alias and i not in pairs and i not in uncertain]
    rejections = rejection_masks(unmatched, masks)
    reasons = {unmatched[i][0]: drops for i, drops in rejections.items()}
    recent = []
    decisions = []
    counts = Counter()
    for i, (identity, rd, world) in enumerate(records):
        decision = {'source': identity, 'rd': rd}
        if i == alias:
            surveyed.sources |= MOR
            count = 'reviewed-survey-match'
            decision.update(world=surveyed.world, distance=round(math.dist(rd, surveyed.rd), 3),
                            confidence='reviewed against school photo and 2026 aerial')
        elif i in pairs:
            j, distance = pairs[i]
            base[j].sources |= MOR
            count = 'matched'
            decision.update(world=base[j].world, distance=round(distance, 3),
                            confidence='high' if distance <= 0.5 else 'medium')
        elif i in uncertain:
            count = 'ambiguous'
        elif identity in REVIEWED_HOLDS and math.dist(rd, REVIEWED_HOLDS[identity]) < 0.5:
            count = 'uncorroborated in imagery'
        elif identity in reasons:
            count = reasons[identity][0]
            decision['overlaps'] = reasons[identity]
        else:
            count = 'eligible'
            recent.append((rd, world, decision))
            decision['confidence'] = 'spatially screened inventory location'
        counts[count] += 1
        decision['decision'] = count
        decisions.append(decision)
    unique = []
    occupied, kept = set(), set()
    neighbours = defaultdict(list)
    if recent:
        positions = points([rd for rd, _, _ in recent])
        src, dst = STRtree(positions).query(positions, predicate='dwithin', distance=0.2)
        for i, j in zip(src.tolist(), dst.tolist()):
            if j < i:
                neighbours[i].append(j)
    for i, (rd, world, decision) in enumerate(recent):
        cell = tuple(round(value * 5) for value in world)
        if cell in occupied or any(neighbour in kept for neighbour in neighbours[i]):
            decision['decision'] = 'coincident MOR record'
            counts['coincident MOR record'] += 1
        else:
            occupied.add(cell)
            kept.add(i)
            unique.append(Tree(rd, world, sources=MOR))
    counts['added'] = len(unique)
    counts['eligible'] -= counts['coincident MOR record']
    base.extend(unique)
    province, provincial_rows = enrich_roadside(
        json.loads(args.roadside.read_text()), scene, frame, base, classify)
    if boundary is not None:
        base = [tree for tree in base if intersects_xy(boundary, *tree.world)]
    canopy_report, derived = {}, []
    if args.canopy:
        from ede_tree_canopy import enrich_canopy
        canopy_asset = output.with_name('ede-tree-canopy-v1.json')
        canopy_report, derived = enrich_canopy(args.canopy, canopy_asset, base, scene, frame, masks)
    if args.preserve:
        earlier = {tree.world: tree for tree in unpack_baseline(args.preserve, frame)}
        for tree in base:
            previous = earlier.get(tuple(round(v * 5) / 5 for v in tree.world))
            if not previous:
                continue
            tree.height = tree.height or previous.height
            tree.diameter = tree.diameter or previous.diameter
            tree.crown_width = tree.crown_width or previous.crown_width
            tree.season_group = tree.season_group or previous.season_group
            if tree.species == UNKNOWN:
                tree.species = previous.species
            tree.sources |= previous.sources & (SURVEYED | AHN | PHENOLOGY)
    data = pack(base)
    output.write_bytes(data)
    summary = {
        'morSnapshot': municipal['timeStamp'], 'sourceRecords': len(municipal['features']), 'inBounds': len(records),
        'mor': dict(counts), 'provincial': province, 'canopy': canopy_report, 'outerBgtAdded': bgt_count, 'outerOsmAdded': osm_count,
        'coverageBefore': baseline_counts, 'coverageAfter': coverage(base),
        'asset': {'filename': output.name, 'bytes': len(data), 'sha256': sha256(data).hexdigest()},
        'sourceHashes': {p.name: sha256(p.read_bytes()).hexdigest() for p in (args.baseline, args.mor, args.roadside, args.pdok) if p}
    }
    if args.audit:
        args.audit.write_text(json.dumps({'summary': summary, 'morDecisions': decisions,
                                          'roadsideDecisions': provincial_rows, 'canopyDecisions': derived},
                                         separators=(',', ':')) + '\n')
    print(json.dumps(summary, indent=2))
