#!/usr/bin/env python3
"""Bake the six Rembrandtlaan HAT blocks from 3DBAG LoD 2.2."""

import argparse
import gzip
import json
from pathlib import Path
import runpy
from urllib.request import urlopen

from ede_gis import Frame, SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_SURVEY = runpy.run_path(str(ROOT / "tools/build-ede-public-survey.py"))
API, survey, pack = (PUBLIC_SURVEY[key] for key in ("API", "survey", "pack"))

# Three adjoining BAG records per block, ordered from one portiek to the other.
PARTS = (
    ("0228100000035393", "w271470332"), ("0228100000028819", "w271378403"), ("0228100000047188", "w271470532"),
    ("0228100000010200", "w271470523"), ("0228100000030351", "w271377890"), ("0228100000054281", "w271376470"),
    ("0228100000027276", "w271470906"), ("0228100000013319", "w271465744"), ("0228100000010675", "w271470439"),
    ("0228100000038607", "w271471519"), ("0228100000049462", "w271379360"), ("0228100000059061", "w271470529"),
    ("0228100000059967", "w271471453"), ("0228100000000450", "w271465846"), ("0228100000045393", "w271470422"),
    ("0228100000028571", "w271470526"), ("0228100000059515", "w271462841"), ("0228100000015356", "w271470281"),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "js/ede-rembrandtlaan-survey.js")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / "assets/ede-map-v1.json.gz") as source:
        frame = Frame(json.load(source)["meta"]["lonLatAffine"])
    sources = {}
    for path in sorted(args.cache.glob("bag-*.json")):
        batch = json.loads(path.read_text())
        sources.update((feature["id"], batch) for feature in batch["features"])
    bag_ids, osm_ids = map(list, zip(*PARTS, strict=True))
    lines = [
        "// 3DBAG LoD 2.2 by tudelft3d and 3DGI, CC BY 4.0. https://docs.3dbag.nl/en/copyright/",
        f"// Surveyed 2026-11-21 in Ede scene metres, Y relative to {SCENE_NAP_ORIGIN} m NAP.",
        "export const REMBRANDTLAAN_SITE = {",
        "  id: 'rembrandtlaan-hat', name: 'Rembrandtlaan HAT-woningen', district: 'Maandereng', road: 'Rembrandtlaan',",
        f"  osmId: {pack(osm_ids[0])}, annexOsmIds: {pack(osm_ids[1:])},",
        f"  bagIds: {pack(bag_ids)},",
        "  x: -1386, z: 3047, height: 13.4, focusHeight: 4.2, worldSpace: true, mapScenic: true, approach: { x: -1378.4, z: 3065.7 },",
        "};",
        "",
        "export const REMBRANDTLAAN_SURVEY = [",
    ]
    for bag in bag_ids:
        identifier = f"NL.IMBAG.Pand.{bag}"
        source = sources.get(identifier)
        if source is None:
            path = args.cache / f"{bag}.json"
            if args.fetch and not path.is_file():
                with urlopen(f"{API}/{identifier}", timeout=45) as response:
                    path.write_bytes(response.read())
            raw = json.loads(path.read_text())
            source = {**raw, "features": [raw["feature"]]}
        points, faces, outline = survey(source, bag, frame)
        ground = min(p[1] for p in points)
        lines += [
            f'  {{ bagId: "{bag}", ground: {ground}, wallColor: 0x977a69, roofColor: 0x555257,',
            "    outline: " + pack(outline) + ",",
            "    points: [",
            *["      " + ", ".join(map(pack, points[i:i + 5])) + "," for i in range(0, len(points), 5)],
            "    ],",
            "    faces: [",
            *["      " + ", ".join(map(pack, faces[i:i + 4])) + "," for i in range(0, len(faces), 4)],
            "    ],",
            "  },",
        ]
    args.output.write_text("\n".join([*lines, "];", ""]), encoding="utf-8")


if __name__ == "__main__":
    main()
