#!/usr/bin/env python3
"""Download PDOK's 2025 Ede orthophoto in RD New and build a local VRT."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import time
from urllib.parse import urlencode
from urllib.request import urlopen


WMS = "https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0"
LAYER = "2025_ortho25"
CRS = "EPSG:28992"
PIXEL = 0.5
TILE_METRES = 1000
# Includes the full Ede scene and the bake's 150 m overview margin.
BOUNDS = 168000, 446000, 177000, 454000


def download_tile(args):
    directory, x, y = args
    image = directory / f"{x}_{y}.jpg"
    world = image.with_suffix(".jgw")
    size = int(TILE_METRES / PIXEL)
    if not image.exists():
        query = urlencode({
            "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap",
            "LAYERS": LAYER, "STYLES": "", "CRS": CRS, "FORMAT": "image/jpeg",
            "WIDTH": size, "HEIGHT": size, "BBOX": f"{x},{y},{x + TILE_METRES},{y + TILE_METRES}",
        })
        for attempt in range(3):
            try:
                with urlopen(f"{WMS}?{query}", timeout=45) as response:
                    data = response.read()
                if not (data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9")):
                    raise ValueError("PDOK returned an incomplete image")
                image.with_suffix(".tmp").write_bytes(data)
                image.with_suffix(".tmp").replace(image)
                print(f"Downloaded {image.name}", flush=True)
                break
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
    world.write_text(f"{PIXEL}\n0\n0\n{-PIXEL}\n{x + PIXEL / 2}\n{y + TILE_METRES - PIXEL / 2}\n")
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Local directory for JPEG tiles and the VRT")
    directory = parser.parse_args().directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    west, south, east, north = BOUNDS
    tiles = [(directory, x, y) for x in range(west, east, TILE_METRES) for y in range(south, north, TILE_METRES)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        images = list(executor.map(download_tile, tiles))
    vrt = directory / "ede-aerial-2025.vrt"
    subprocess.run(["gdalbuildvrt", "-overwrite", "-strict", "-addalpha", "-a_srs", CRS, str(vrt), *map(str, images)], check=True)
    print(vrt)


if __name__ == "__main__":
    main()
