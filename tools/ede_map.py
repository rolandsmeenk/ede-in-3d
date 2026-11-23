"""Read the canonical Ede map snapshot for offline GIS tools."""

import gzip
import json
from functools import cache
from pathlib import Path

MAP_ASSET = 'assets/ede-map-v1.json.gz'
SHORELINE_ASSET = 'assets/ede-shorelines.json.gz'
MUNICIPAL_ASSET = 'assets/ede-municipality-v1.json.gz'
COMPLETION_ASSET = 'assets/ede-complete-v1.json.gz'
ROOT = Path(__file__).resolve().parents[1]
LAYERS = ('buildings', 'roads', 'railways', 'water', 'parks', 'squares', 'trees', 'signals')
GRAPHS = ('roadGraph', 'activeGraph')


def read_packed(path):
    with gzip.open(ROOT / path, 'rt', encoding='utf-8') as source:
        return json.load(source)


def shoreline_base(scene):
    return {'bounds': scene['meta']['bounds'], 'counts': [len(scene[key]) for key in ('water', 'parks', 'squares')]}


def load_scene(include_shorelines=True):
    with gzip.open(ROOT / MAP_ASSET, 'rt', encoding='utf-8') as source:
        scene = json.load(source)
    if not include_shorelines or not (ROOT / SHORELINE_ASSET).exists():
        return scene
    with gzip.open(ROOT / SHORELINE_ASSET, 'rt', encoding='utf-8') as source:
        shoreline = json.load(source)
    if shoreline['version'] != 1 or shoreline['base'] != shoreline_base(scene):
        raise ValueError('Ede shoreline asset does not match the OSM map, rerun the shoreline bake')
    for key, changes in shoreline['land'].items():
        rows = list(scene[key])
        for index, identity, fragments in reversed(changes):
            if rows[index]['id'] != identity:
                raise ValueError('Ede shoreline asset does not match the OSM land IDs')
            rows[index:index + 1] = [{**rows[index], **fragment} for fragment in fragments]
        scene[key] = rows
        scene['meta']['counts'][key] = len(rows)
    scene['water'] = shoreline['water']
    scene['meta']['counts']['water'] = len(shoreline['water'])
    return scene


@cache
def load_scene_metadata():
    """Expose the unchanged source frame to importers and live services."""
    return load_scene(include_shorelines=False)['meta']


def load_playable_scene(include_shorelines=True, *, municipal=True, complete=True):
    """Read the two OSM expansion overlays and the municipal bake, preserving the original core prefix."""
    scene = load_scene(include_shorelines)
    meta = scene['meta']
    meta.update(baseBounds=meta['bounds'], baseRoadCount=len(scene['roads']), baseBuildingCount=len(scene['buildings']),
                baseRoadNodeCount=len(scene['roadGraph']['nodes']) // 2, baseParkCount=len(scene['parks']))
    for label in ('corridors', 'north'):
        overlay = read_packed(f'assets/ede-{label}-v1.json.gz')
        original = overlay['base']
        if (original['bounds'] != meta['bounds'] or original['roads'] != len(scene['roads'])
                or original['buildings'] != len(scene['buildings'])
                or any(original[key.replace('Graph', 'Nodes')] != len(scene[key]['nodes']) for key in GRAPHS)):
            raise ValueError(f'Ede {label} overlay does not match the map prefix')
        rail = {row['id']: row for row in overlay.get('railExtensions', [])}
        scene['railways'] = [rail.get(row['id'], row) for row in scene['railways']]
        for key in LAYERS:
            scene[key].extend(overlay[key])
        for key in GRAPHS:
            for field in ('nodes', 'links', 'names'):
                scene[key][field].extend(overlay[key][field])
            if 'controls' in overlay[key]:
                scene[key].setdefault('controls', {}).update(overlay[key]['controls'])
        meta['bounds'] = overlay['bounds']
        meta['geographicBounds'] = overlay['geographicBounds']
        if label == 'corridors':
            meta['corridorDetail'] = overlay['detail']
        else:
            meta.update(north=True, northStart=original['bounds'][1])
            for field in ('arrivals', 'routes'):
                meta['corridorDetail'][field].extend(overlay['detail'][field])
            meta['corridorDetail']['zones'] = overlay['detail']['zones']
    completion = read_packed(COMPLETION_ASSET) if complete and (ROOT / COMPLETION_ASSET).is_file() else None
    if include_shorelines:
        if completion:
            apply_complete_coverage(scene, completion)
        patch = completion['municipality'] if completion else (
            read_packed(MUNICIPAL_ASSET) if (ROOT / MUNICIPAL_ASSET).exists() else None)
        if municipal and patch:
            apply_municipal_coverage(scene, patch)
    elif completion or (municipal and (ROOT / MUNICIPAL_ASSET).exists()):
        # Shoreline-indexed overlays require the normal refined base before application.
        refined = load_playable_scene(municipal=municipal, complete=complete)
        scene['meta'] = refined['meta']
        for key in (*LAYERS, *GRAPHS):
            if key not in ('water', 'parks', 'squares'):
                scene[key] = refined[key]
    scene['meta']['counts'] = {key: len(scene[key]) for key in LAYERS}
    return scene


def apply_complete_coverage(scene, completion):
    if completion['version'] != 1 or completion['base'] != municipal_base(scene):
        raise ValueError('Ede completion bake does not match the existing map assets')
    for key in LAYERS:
        layer = completion['layers'][key]
        rows = scene[key].copy()
        for index, replacement in layer['replace']:
            rows[index] = replacement
        rows.extend(layer['add'])
        scene[key] = rows
    scene.update(completion['graphs'])
    scene['meta'].update(bounds=completion['bounds'], geographicBounds=completion['geographicBounds'],
                         areas=completion['areas'], fullMunicipality=True, osmCompletion=completion['source'])
    if 'travelBounds' in completion:
        scene['meta']['travelBounds'] = completion['travelBounds']


def apply_municipal_coverage(scene, patch):
    def apply(rows, layer, by_id):
        replacements = dict(layer['changes'])
        return [value for i, row in enumerate(rows) for value in replacements.get(row['id'] if by_id else i, [row])]

    if patch['base'] != municipal_base(scene):
        raise ValueError('Ede municipal bake does not match the expanded map, rerun build-ede-municipality.py')
    roads = dict(patch['layers']['roads']['changes'])
    road_map, index = [], 0
    for i in range(len(scene['roads'])):
        road_map.append(index)
        index += len(roads[i]) if i in roads else 1
    for key, layer in patch['layers'].items():
        scene[key] = apply(scene[key], layer, key == 'water')
    for key, layer in patch['graphs'].items():
        graph = scene[key]
        replacements = dict(layer['changes'])
        graph['links'] = [value for i, row in enumerate(graph['links']) for value in replacements.get(
            i, [[*row[:7], road_map[row[7]], *row[8:]]])]
        graph['nodes'].extend(layer['addNodes'])
        drop = set(layer['dropNodes'])
        keep = [i for i in range(len(graph['nodes']) // 2) if i not in drop]
        indices = {old: new for new, old in enumerate(keep)}
        graph['nodes'] = [coordinate for i in keep for coordinate in graph['nodes'][2*i:2*i+2]]
        for link in graph['links']:
            link[0], link[1] = indices[link[0]], indices[link[1]]
        if 'controls' in graph:
            controls = graph['controls']
            graph['controls'] = {str(i): controls[str(old)] for i, old in enumerate(keep) if str(old) in controls}
    scene['meta']['municipality'] = patch['source']
    scene['meta']['playableBoundary'] = patch['boundary']
    scene['meta'].update(patch['prefix'])


def municipal_base(scene):
    return {'bounds': scene['meta']['bounds'], 'counts': [len(scene[key]) for key in LAYERS],
            'graphs': [[len(scene[key]['nodes']), len(scene[key]['links'])] for key in GRAPHS]}


@cache
def load_coverage_polygon(field):
    from shapely.geometry import MultiPolygon, Polygon
    rows = json.loads((ROOT / 'assets/ede-coverage-v1.json').read_bytes())[field]
    return MultiPolygon([Polygon(list(zip(outer[::2], outer[1::2])),
                                 [list(zip(ring[::2], ring[1::2])) for ring in holes]) for outer, *holes in rows])


@cache
def load_playable_boundary():
    """The playable GM0228 footprint in Oude Kerk scene metres."""
    from shapely.geometry import MultiPolygon, Polygon
    polygons = (read_packed(COMPLETION_ASSET)['municipality'] if (ROOT / COMPLETION_ASSET).exists()
                else read_packed(MUNICIPAL_ASSET))['boundary']
    return MultiPolygon([Polygon(list(zip(outer[::2], outer[1::2])),
                                 [list(zip(ring[::2], ring[1::2])) for ring in holes]) for outer, *holes in polygons])
