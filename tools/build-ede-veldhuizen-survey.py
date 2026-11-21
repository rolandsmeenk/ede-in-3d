#!/usr/bin/env python3
"""Bake the Bellestein and Laathof exteriors from 3DBAG and the Ede scene map."""

import argparse
import gzip
import json
from pathlib import Path
import runpy
from urllib.parse import urlencode
from urllib.request import urlopen

from ede_gis import Frame, SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_SURVEY = runpy.run_path(str(ROOT / "tools/build-ede-public-survey.py"))
API = PUBLIC_SURVEY["API"]
survey, pack = PUBLIC_SURVEY["survey"], PUBLIC_SURVEY["pack"]

SITES = {
    "bellestein": {
        "name": "Winkelcentrum Bellestein",
        "road": "Bellestein",
        "bbox": "172530,450350,172700,450580",
        "point": (-1877.8, 507.0),
        "target": (-1867.7, 479.8),
        # Main complex, then the matching service garage row.
        "buildings": (59704, 7407, 42646, 42296, 13237, 68229, 71511, 69340, 70685, 68568,
                      65017, 71497, 66487, 71166, 69672, 70439, 65345, 65793, 70010, 66133),
        "wall": 0xc8bda4,
        "roof": 0x985b43,
    },
    "laathof": {
        "name": "Terrasflat Laathof",
        "road": "Laathof",
        "bbox": "171900,450385,172110,450477",
        "point": (-2487.0, 466.2),
        "target": (-2518.0, 449.4),
        # Both terraced blocks, the stair towers, and their detached service stores.
        "buildings": (47520, 36591, 10519, 58736, 2802, 16496, 3578, 6585, 32252, 17900, 43879,
                      21586, 19478, 10977, 58101, 25605, 53763, 59392, 13091, 23836, 53523, 6394,
                      56794, 13356, 29559, 413, 36563, 10133),
        "wall": 0xb6b5ab,
        "roof": 0x797971,
    },
}


def bounds(points):
    return tuple(function(point[axis] for point in points) for axis in (0, 1) for function in (min, max))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "js/ede-veldhuizen-survey.js")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / "assets/ede-map-v1.json.gz") as source:
        scene = json.load(source)
    frame = Frame(scene["meta"]["lonLatAffine"])
    osm_bounds = {item["id"]: bounds(list(zip(item["ring"][::2], item["ring"][1::2])))
                  for item in scene["buildings"]}
    registry, surveys = [], []
    for site, settings in SITES.items():
        sources = {}
        needed = {f"NL.IMBAG.Pand.02281000{suffix:08d}" for suffix in settings["buildings"]}
        offset, total = 0, 1
        while offset < total:
            page = f"-{offset}" if offset else ""
            path = args.cache / f"{site}-bag{page}.json"
            if args.fetch and not path.is_file():
                # The API treats an explicit offset=0 differently from its default first page.
                page_query = {"limit": 50, "offset": offset} if offset else {"limit": 100}
                query = urlencode({"bbox": settings["bbox"], **page_query})
                with urlopen(f"{API}?{query}", timeout=45) as response:
                    path.write_bytes(response.read())
            source = json.loads(path.read_text())
            sources.update((feature["id"], source) for feature in source["features"])
            offset += 50
            total = source["numberMatched"]
            if needed <= sources.keys():
                break
        bags, footprints, heights = [], [], []
        surveys.append(f"  {pack(site)}: [")
        for suffix in settings["buildings"]:
            bag = f"02281000{suffix:08d}"
            points, faces, outline = survey(sources[f"NL.IMBAG.Pand.{bag}"], bag, frame)
            extent = bounds(outline[0])

            def match_distance(other):
                return sum(abs(a - b) for a, b in zip(extent, osm_bounds[other], strict=True))

            osm = min(osm_bounds, key=match_distance)
            if match_distance(osm) > 1.8 or osm in footprints:
                raise ValueError(f"Missing distinct OSM match for {bag}: {osm}, distance {match_distance(osm):.2f}")
            bags.append(bag)
            footprints.append(osm)
            base = min(p[1] for p in points)
            heights.append(max(p[1] for p in points) - base)
            surveys += [
                f'    {{ bagId: "{bag}", ground: {base}, wallColor: {settings["wall"]:#08x}, roofColor: {settings["roof"]:#08x},',
                "      outline: " + pack(outline) + ",",
                "      points: [",
                *["        " + ", ".join(map(pack, points[i:i+5])) + "," for i in range(0, len(points), 5)],
                "      ],",
                "      faces: [",
                *["        " + ", ".join(map(pack, faces[i:i+4])) + "," for i in range(0, len(faces), 4)],
                "      ],",
                "    },",
            ]
        surveys.append("  ],")
        primary, *annexes = footprints
        x, z = settings["target"]
        ax, az = settings["point"]
        registry += [
            f'  {{ id: {pack(site)}, name: {pack(settings["name"])}, district: "Veldhuizen", road: {pack(settings["road"])},',
            f"    osmId: {pack(primary)}, annexOsmIds: {pack(annexes)},",
            f"    bagIds: {pack(bags)},",
            f"    x: {x}, z: {z}, height: {max(heights):.2f}, worldSpace: true, approach: {{ x: {ax}, z: {az} }} }},",
        ]
    lines = [
        "// 3DBAG LoD 2.2, © tudelft3d and 3DGI, CC BY 4.0. https://docs.3dbag.nl/en/copyright/",
        f"// Ede scene metres, Y relative to {SCENE_NAP_ORIGIN} m NAP. Face codes are 0 for walls and 1 for roofs.",
        "",
        "export const EDE_VELDHUIZEN_LANDMARKS = [",
        *registry,
        "];",
        "",
        "export const VELDHUIZEN_SURVEYS = {",
        *surveys,
        "};",
        "",
    ]
    args.output.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
