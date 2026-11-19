"""Read the canonical Ede map snapshot for offline GIS tools."""

import gzip
import json
from pathlib import Path

MAP_ASSET = 'assets/ede-map-v1.json.gz'


def load_scene():
    with gzip.open(Path(__file__).resolve().parents[1] / MAP_ASSET, 'rt', encoding='utf-8') as source:
        return json.load(source)
