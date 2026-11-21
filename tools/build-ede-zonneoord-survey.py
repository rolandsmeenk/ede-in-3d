#!/usr/bin/env python3
"""Bake the above-ground Groot Zonneoord parts from a 3DBAG CityJSON collection."""

import argparse
import gzip
import json
from pathlib import Path
from urllib.request import urlopen

from ede_gis import Frame, SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
BAG = "0228100000042048"
CITY_ID = f"NL.IMBAG.Pand.{BAG}"
API = "https://api.3dbag.nl/collections/pand/items?bbox=173220,452870,173430,453090&limit=100"
OSM_PARTS = ("w271586515", "w1446735307", "w1446735306", "w1446735309", "w1446735308")


def pack(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def bake(source, frame):
    meta = source["metadata"]
    if not meta["metadata"]["referenceSystem"].endswith("/7415"):
        raise ValueError("Expected RD New and NAP from 3DBAG")
    transform = meta["transform"]
    feature = next(feature for feature in source["features"] if feature["id"] == CITY_ID)
    points = []
    for raw in feature["vertices"]:
        easting, northing, nap = (i * s + t for i, s, t in zip(raw, transform["scale"], transform["translate"], strict=True))
        x, z = frame.rd_to_scene(easting, northing)
        points.append([round(v, 2) for v in (x, nap - SCENE_NAP_ORIGIN, z)])
    if any(not (-1226 <= x <= -1139 and -2145 <= z <= -2040) for x, _, z in points):
        raise ValueError("3DBAG placed Groot Zonneoord outside its surveyed estate")
    records = []
    for index, osm in enumerate(OSM_PARTS):
        obj = feature["CityObjects"][f"{CITY_ID}-{index}"]
        geom = next(geometry for geometry in obj["geometry"] if geometry["lod"] == "2.2")
        if geom["type"] != "Solid" or len(geom["boundaries"]) != 1:
            raise ValueError(f"Unexpected above-ground geometry for {osm}")
        classes = geom["semantics"]
        faces = []
        outline = None
        for rings, value in zip(geom["boundaries"][0], classes["values"][0], strict=True):
            if value is None:
                continue
            surface = classes["surfaces"][value]["type"]
            if surface == "GroundSurface":
                if outline is not None:
                    raise ValueError(f"More than one footprint for {osm}")
                outline = [[points[i][::2] for i in ring] for ring in rings]
            elif surface in ("WallSurface", "RoofSurface"):
                faces.append([int(surface == "RoofSurface"), *rings])
        if not outline or {kind for kind, *_ in faces} != {0, 1}:
            raise ValueError(f"Incomplete 3DBAG surfaces for {osm}")
        used = sorted({point for _, *rings in faces for ring in rings for point in ring})
        ids = {old: new for new, old in enumerate(used)}
        verts = [points[i] for i in used]
        records.append(dict(osmId=osm, ground=min(y for _, y, _ in verts), outline=outline, points=verts,
                            faces=[[kind, *[[ids[i] for i in ring] for ring in rings]] for kind, *rings in faces]))
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    if args.fetch and not args.cache.exists():
        with urlopen(API, timeout=35) as response:
            args.cache.write_bytes(response.read())
    with gzip.open(ROOT / "assets/ede-map-v1.json.gz") as source:
        frame = Frame(json.load(source)["meta"]["lonLatAffine"])
    records = bake(json.loads(args.cache.read_text()), frame)
    output = [
        "// 3DBAG LoD 2.2, © tudelft3d and 3DGI, CC BY 4.0. https://docs.3dbag.nl/en/copyright/",
        "// Ede scene metres. The estate BAG record includes the underground connectors.",
        "// Above-ground footprints remain separate so the paths between pavilions stay open.",
        "",
        "export const ZONNEOORD_SURVEYS = [",
    ]
    for index, record in enumerate(records):
        output += [
            f'  {{ osmId: {pack(record["osmId"])}, ground: {record["ground"]},'
            f' wallColor: {"0xdddcd0" if index == 0 else "0x725640"},'
            f' roofColor: {"0x655850" if index == 0 else "0x454b4a"},',
            f'    outline: {pack(record["outline"])},',
        ]
        for field, size in (("points", 5), ("faces", 6)):
            output.append(f"    {field}: [")
            rows = record[field]
            output.extend("      " + ", ".join(map(pack, rows[i:i + size])) + "," for i in range(0, len(rows), size))
            output.append("    ],")
        output.append("  },")
    output += [
        "];",
        "",
        "export const EDE_ZONNEOORD_LANDMARKS = [",
        "  { id: 'groot-zonneoord', name: 'Groot Zonneoord', district: 'Doesburgerheide', road: 'Zonneoordlaan',",
        f"    osmId: ZONNEOORD_SURVEYS[0].osmId, annexOsmIds: ZONNEOORD_SURVEYS.slice(1).map(part => part.osmId), bagIds: [{pack(BAG)}],",
        "    x: -1164.5, z: -2055.6, height: 12.2, focusHeight: 3.0, worldSpace: true, mapScenic: true,",
        "    approach: { x: -1151.4, z: -2034.2 },",
        "    surveyFootprints: ZONNEOORD_SURVEYS.map(({ outline }) => {",
        "      const [outer, ...holes] = outline.map(ring => ring.map(([x, z]) => ({ x, z })));",
        "      return { outer, holes };",
        "    }),",
        "  },",
        "  { id: 'jan-hilgers-monument', name: 'Jan Hilgersmonument', district: 'Edese Bos', road: 'Zonneoordlaan',",
        "    osmId: 'n300493406', x: 403.99, z: -2500.35, height: 2.2, focusHeight: 1.10, worldSpace: true,",
        "    mapScenic: true, approach: { x: 401.56, z: -2505.62 },",
        "  },",
        "];",
        "",
    ]
    (ROOT / "js/ede-zonneoord-surveys.js").write_text("\n".join(output))


if __name__ == "__main__":
    main()
