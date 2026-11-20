"""Read the canonical Ede map snapshot for offline GIS tools."""

import gzip
import json
from functools import cache
from pathlib import Path

MAP_ASSET = 'assets/ede-map-v1.json.gz'
SHORELINE_ASSET = 'assets/ede-shorelines.json.gz'
ROOT = Path(__file__).resolve().parents[1]


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
