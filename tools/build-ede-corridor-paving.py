#!/usr/bin/env python3
"""Bake BGT paving outside the original Ede town area."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import gzip
import json
import math
from pathlib import Path
import runpy

from shapely import STRtree, make_valid, prepare, union_all
from shapely.geometry import Polygon, box

from ede_map import ROOT, load_scene_metadata
from ede_scene import SceneAffine


# Rectangles follow N224 to Planken Wambuis, with separate arrival site surveys.
BOUNDS = [
    (5.700, 52.0437, 5.7175, 52.0520), (5.716, 52.0370, 5.7365, 52.0480),
    (5.734, 52.031, 5.756, 52.041), (5.754, 52.027, 5.772, 52.036),
    (5.770, 52.027, 5.796, 52.034),
    (5.568, 52.041, 5.579, 52.051), (5.641, 52.059, 5.657, 52.069),
    (5.755, 52.057, 5.770, 52.068),
    (5.673, 52.0669, 5.681, 52.0701),  # Jan Hilgersmonument
    (5.734, 52.069, 5.741, 52.0726),  # Uitkijkpunt De Valenberg
]


def fetch(module, directory, day, bounds):
    directory.mkdir(parents=True, exist_ok=True)
    rows = {key: {} for key in module['COLLECTIONS']}
    jobs = [(name, area, day) for area in bounds for name in rows]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for name, features in pool.map(lambda params: module['BGT']['fetch_tile'](*params), jobs):
            for feature in features:
                props = feature['properties']
                rows[name][props['lokaal_id'], props.get('tijdstip_registratie', '')] = feature
    for name, entries in rows.items():
        (directory / f'{name}.geojson').write_text(json.dumps({
            'type': 'FeatureCollection', 'features': [entries[key] for key in sorted(entries)]
        }))


def municipality_tiles(area, affine):
    west, south, east, north = affine.geographic_bounds(area.bounds)
    columns = math.ceil((east - west) / .024)
    rows = math.ceil((north - south) / .012)
    for i in range(columns):
        w = west + (east - west) * i / columns
        e = west + (east - west) * (i + 1) / columns
        for j in range(rows):
            s = south + (north - south) * j / rows
            n = south + (north - south) * (j + 1) / rows
            tile = box(*affine.lon_lat_to_scene(w, n), *affine.lon_lat_to_scene(e, s))
            if area.intersects(tile):
                yield w, s, e, n


def read_paving(path):
    with gzip.open(path, "rt") as file:
        return json.load(file)


def paving_geometry(row, pairs):
    return make_valid(union_all([make_valid(Polygon(pairs(outer), [pairs(ring) for ring in holes]))
                                 for outer, *holes in row["polygons"]]))


def summarize_paving(asset, surfaces, covered):
    return {**asset, "surfaces": surfaces, "covered": covered,
            "counts": dict(sorted(Counter(row["material"] for row in surfaces).items())),
            "resolutions": dict(sorted(Counter(row["resolution"] for row in surfaces).items()))}


def merge_municipal_paving(module, fresh, retained, corridor, boundary, area, roads, original_roads):
    prepare(boundary)
    prepare(area)
    pairs, encode = module["BGT"]["pairs"], module["encode_surface"]
    surveyed = defaultdict(list)
    corridor_rows, surfaces = [], []
    for asset, rows in ((corridor, corridor_rows), (retained, surfaces)):
        for row in asset["surfaces"]:
            geometry = paving_geometry(row, pairs)
            if not boundary.covers(geometry):
                geometry = geometry.intersection(boundary)
                row = {**row, "polygons": encode(geometry)}
            if row["polygons"]:
                surveyed[row["layer"]].append(geometry)
                rows.append(row)
    indexes = {layer: STRtree(geometries) for layer, geometries in surveyed.items()}
    reviewed_count = len(surfaces)
    for row in fresh["surfaces"]:
        geometry = paving_geometry(row, pairs)
        clipped = not area.covers(geometry)
        if clipped:
            geometry = geometry.intersection(area)
        index = indexes.get(row["layer"])
        if index is not None:
            collisions = index.query(geometry, predicate="intersects")
            if collisions.size:
                geometry = geometry.difference(union_all(index.geometries[collisions]))
                clipped = True
        if clipped:
            row = {**row, "polygons": encode(geometry)}
        if row["polygons"]:
            surfaces.append(row)
    original = {row["id"]: pairs(row["pts"]) for row in original_roads}

    def kept_segments(asset):
        segments = {}
        for road, indices in asset["covered"].items():
            points = original.get(road, [])
            segments[road] = {(points[i], points[i + 1]) for i in indices if i + 1 < len(points)}
        kept = {}
        for row in roads:
            matches = segments.get(row.get("osmId", row["id"]))
            if matches:
                points = pairs(row["pts"])
                indices = [i for i, segment in enumerate(zip(points, points[1:])) if segment in matches]
                if indices:
                    kept[row["id"]] = indices
        return kept

    if corridor["source"].get("coverage") == "Gemeente Ede":
        corridor_covered = corridor["covered"]
    else:
        corridor_covered = kept_segments(corridor)
        corridor["source"]["coverage"] = "Gemeente Ede"
    covered = defaultdict(set)
    for coverage in (corridor_covered, kept_segments(retained), fresh["covered"]):
        for road, segments in coverage.items():
            covered[road].update(segments)
    fresh["source"].update(coverage="Gemeente Ede", reviewedDate=retained["date"], retainedSurfaces=reviewed_count)
    result = summarize_paving(fresh, surfaces, {road: sorted(indices) for road, indices in covered.items()})
    return result, summarize_paving(corridor, corridor_rows, corridor_covered), reviewed_count


def write_paving(output, asset):
    output.write_bytes(gzip.compress(json.dumps(asset, separators=(",", ":"), ensure_ascii=False,
                                                     allow_nan=False).encode(), mtime=0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--fetch', action='store_true')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--north", action="store_true")
    mode.add_argument("--municipality", action="store_true", help="Extend surveyed paving across the playable Gemeente Ede area")
    parser.add_argument("--reviewed", type=Path, help="Previously reviewed north paving preserved by --municipality")
    parser.add_argument('--map', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--reviewed-corridor', type=Path, help='Original corridor paving before municipality clipping')
    parser.add_argument('--corridor-output', type=Path, help='Write the municipality-clipped corridor paving here')
    args = parser.parse_args()
    module = runpy.run_path(str(ROOT / 'tools/build-ede-bgt-roads.py'))
    coverage = json.loads((ROOT / 'tools/data/ede-outer-coverage.json').read_text())
    base = load_scene_metadata()
    north = args.north or args.municipality
    output = args.output or ROOT / "assets" / ("ede-north-paving.json.gz" if north else "ede-corridor-paving.json.gz")
    if args.municipality:
        from ede_map import load_playable_boundary, load_playable_scene
        if not args.reviewed:
            parser.error("--municipality requires --reviewed pointing to the previous north paving asset")
        boundary = load_playable_boundary()
        area = boundary.difference(box(*base["bounds"]))
        scene = load_playable_scene()
        bounds = list(municipality_tiles(area, SceneAffine(base["lonLatAffine"])))
    else:
        mapping = args.map or ROOT / "assets" / ("ede-north-v1.json.gz" if north else "ede-corridors-v1.json.gz")
        data = read_paving(mapping)
        area = box(*data["bounds"]).difference(box(*base["bounds"]))
        scene = {"meta": base, "roads": data["roads"]}
        bounds = coverage["northDetail"]["pavingBounds"] if north else BOUNDS
    if args.fetch:
        fetch(module, args.snapshot, args.date, bounds)
    index, surfaces, collections = module['get_snapshot'](args.snapshot, scene, area)
    source = {'url': f"{module['BGT']['API']}/collections?f=html", 'license': 'CC0 1.0',
              'collections': collections}
    tags = {row['id']: row['surface'] for row in scene['roads'] if row.get('surface')}
    result = module['build_surfaces'](scene, index, surfaces, tags, source, args.date)
    if args.municipality:
        previous = read_paving(args.reviewed)
        corridor_path = ROOT / "assets/ede-corridor-paving.json.gz"
        corridor = read_paving(args.reviewed_corridor or corridor_path)
        fresh_count = len(result["surfaces"])
        result, clipped_corridor, reviewed_count = merge_municipal_paving(
            module, result, previous, corridor, boundary, area, scene["roads"],
            load_playable_scene(municipal=False)["roads"])
        write_paving(args.corridor_output or corridor_path, clipped_corridor)
        print(f"Gemeente Ede outer paving: {len(bounds)} request tiles, {area.area / 1e6:.2f} km², "
              f"{reviewed_count} retained and {len(result['surfaces']) - reviewed_count} new surfaces "
              f"({fresh_count} before removing overlap).", flush=True)
    write_paving(output, result)
    print(f"Corridor paving: {len(result['surfaces'])} BGT surfaces, {len(result['covered'])} covered OSM ways.")


if __name__ == '__main__':
    main()
