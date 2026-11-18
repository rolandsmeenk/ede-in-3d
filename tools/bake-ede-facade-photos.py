#!/usr/bin/env python3
"""Pack reviewed rectified Mapillary crops into a shared, attributed WebP atlas."""

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

PADDING = 4
LICENSE = 'CC BY-SA 4.0'


def crop(image, bounds, rect):
    sx, sy, sw, sh = bounds
    x, y, w, h = rect
    if min(w, h, sw, sh) <= 0 or x < sx or y < sy or x + w > sx + sw + 1e-6 or y + h > sy + sh + 1e-6:
        raise ValueError(f'Crop {rect} does not fit within {bounds}')
    box = ((x - sx) / sw, 1 - (y + h - sy) / sh, (x + w - sx) / sw, 1 - (y - sy) / sh)
    return image.crop(tuple(round(value * size) for value, size in zip(box, image.size * 2)))


def placement(images, width):
    x = y = line_height = 0
    slots = []
    for image in images:
        w, h = image.width + 2 * PADDING, image.height + 2 * PADDING
        if w > width:
            return None
        if x + w > width:
            x, y, line_height = 0, y + line_height, 0
        slots.append((x + PADDING, y + PADDING))
        x += w
        line_height = max(line_height, h)
    height = 2 ** math.ceil(math.log2(y + line_height))
    return width, height, slots


def build(recipe, source, atlas_path, metadata_path):
    images = []
    for entry in recipe['crops']:
        with Image.open(source / entry['source']) as image:
            cropped = crop(image.convert('RGB'), entry['sourceRect'], entry.get('cropRect', entry['rect']))
        cropped.thumbnail((512, 640), Image.Resampling.LANCZOS)
        images.append((entry, ImageEnhance.Brightness(cropped).enhance(entry.get('exposure', 1))))
    if not images:
        raise ValueError('No reviewed crops in photo recipe')
    images.sort(key=lambda item: -item[1].height)
    placements = (placement([image for _, image in images], width) for width in (256, 512, 1024, 2048))
    width, height, slots = min((p for p in placements if p and p[1] <= 2048), key=lambda p: p[0] * p[1])
    atlas = Image.new('RGB', (width, height))
    panels = defaultdict(list)
    for (entry, image), (x, y) in zip(images, slots):
        padded = ImageOps.expand(image, PADDING)
        for box, size, at in [
            ((0, 0, 1, image.height), (PADDING, image.height), (0, PADDING)),
            ((image.width - 1, 0, image.width, image.height), (PADDING, image.height), (image.width + PADDING, PADDING)),
        ]:
            padded.paste(image.crop(box).resize(size), at)
        for start, at in ((PADDING, 0), (image.height + PADDING - 1, image.height + PADDING)):
            padded.paste(padded.crop((0, start, padded.width, start + 1)).resize((padded.width, PADDING)), (0, at))
        atlas.paste(padded, (x - PADDING, y - PADDING))
        uvs = [(x + .5) / width, 1 - (y + image.height - .5) / height,
               (x + image.width - .5) / width, 1 - (y + .5) / height]
        panel = {key: entry[key] for key in ('rect', 'imageId', 'capturedAt', 'creator', 'recessed') if key in entry}
        panel.update(file=atlas_path.name, range=[round(value, 8) for value in uvs], license=LICENSE)
        panels[(entry['bagId'], entry['wallId'])].append(panel)
    atlas.save(atlas_path, 'WEBP', quality=86, method=6)
    metadata_path.write_text(json.dumps(dict(version=1, walls=[
        dict(bagId=bag_id, wallId=wall_id, photos=photos) for (bag_id, wall_id), photos in panels.items()
    ]), separators=(',', ':')) + '\n')
    print(f'{len(images)} crops, {width} × {height} atlas, {atlas_path.stat().st_size:,} bytes on disk')


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for argument in ('recipe', 'source', 'atlas', 'metadata'):
        cli.add_argument(argument, type=Path)
    args = cli.parse_args()
    build(json.loads(args.recipe.read_text()), args.source, args.atlas, args.metadata)
