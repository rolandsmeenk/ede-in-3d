#!/usr/bin/env python3
"""Cache the named Mapillary images and camera metadata from a façade review file."""

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FIELDS = ("id,geometry,computed_geometry,camera_type,camera_parameters,computed_rotation,is_pano,"
          "captured_at,creator,thumb_original_url,thumb_2048_url")


def fetch(token, output, view):
    image_id, resolution = view
    query = urllib.parse.urlencode({"fields": FIELDS})
    req = urllib.request.Request(f"https://graph.mapillary.com/{image_id}?{query}",
                                 headers={"Authorization": f"OAuth {token}"})
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            record = json.load(response)
        url = record.get(f"thumb_{resolution}_url")
        if not url:
            raise ValueError(f"Mapillary image {image_id} has no {resolution} download")
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".fbcdn.net"):
            raise ValueError(f"Unexpected Mapillary image host for {image_id}")
        filename = output / f"{image_id}.jpg"
        tmp = filename.with_suffix(".tmp")
        try:
            with urllib.request.urlopen(url, timeout=45) as response, tmp.open("wb") as file:
                shutil.copyfileobj(response, file)
            with tmp.open("rb") as file:
                if file.read(2) != b"\xff\xd8":
                    raise ValueError(f"Mapillary image {image_id} is not a JPEG")
            tmp.replace(filename)
        finally:
            tmp.unlink(missing_ok=True)
    except urllib.error.HTTPError as exc:
        raise ValueError(f"Mapillary image {image_id} returned HTTP {exc.code}") from None
    except urllib.error.URLError:
        raise ValueError(f"Mapillary image {image_id} could not be downloaded") from None
    return {k: v for k, v in record.items() if not k.endswith("_url")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review", type=Path)
    parser.add_argument("cache", type=Path)
    args = parser.parse_args()
    token = os.environ.get("MAPILLARY_TOKEN")
    if not token:
        parser.error("set MAPILLARY_TOKEN to a Mapillary client access token")
    views = {}
    for review in json.loads(args.review.read_text())["reviews"]:
        for view in review["views"]:
            image_id = str(view["imageId"])
            resolution = view.get("resolution", "2048")
            if not re.fullmatch(r"[0-9]{1,24}", image_id) or resolution not in ("2048", "original"):
                parser.error("expected a numeric Mapillary image ID and supported resolution")
            if image_id in views and views[image_id] != resolution:
                parser.error(f"inconsistent resolution for Mapillary image {image_id}")
            views[image_id] = resolution
    args.cache.mkdir(parents=True, exist_ok=True)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            rows = list(pool.map(lambda view: fetch(token, args.cache, view), views.items()))
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    tmp = args.cache / "metadata.tmp"
    tmp.write_text(json.dumps({"data": rows}, indent=2) + "\n")
    tmp.replace(args.cache / "metadata.json")
    print(f"Cached {len(rows)} Mapillary views")


if __name__ == "__main__":
    main()
