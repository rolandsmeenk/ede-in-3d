#!/usr/bin/env python3
"""Bake local traffic-sign face textures from the NDW SVG catalogue and sign records.

Requires Pillow and CairoSVG. Use the svg_verkeersborden directory from the
pinned NDW release as the catalogue argument.
"""

import argparse
from collections import Counter
from functools import lru_cache
import importlib.util
from io import BytesIO
import json
from math import ceil
from pathlib import Path
import re
import sys

import cairosvg
from PIL import Image, ImageDraw, ImageFont, ImageOps


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('ede_signs', HERE / 'build-ede-street-signs.py')
SIGNS = importlib.util.module_from_spec(SPEC)
sys.dont_write_bytecode = True
SPEC.loader.exec_module(SIGNS)
PNG = SIGNS.ROOT / 'assets/ede-street-sign-faces.png'
MAX_SIZE = 96
PADDING = 4
COLUMNS = 12
EV_SIGN = 'E8c.png'
# Generic L4/L5/L7/L10/L11 codes lack the actual lane layout, arrow or restriction.
VARIABLE_NUMBERS = {'A1', 'A2', 'A4', 'A5', 'C17', 'C18', 'C19', 'C20', 'C21', 'L1'}


@lru_cache
def font(size):
    for path in ('LiberationSans-Bold.ttf', 'DejaVuSans-Bold.ttf',
                 '/System/Library/Fonts/Supplemental/Arial Bold.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default(size)


def put_text(image, value, x, y, size, fill):
    w, h = image.size
    ImageDraw.Draw(image).text((w * x, h * y), value, fill=fill,
                              font=font(round(h * size)), anchor='mm')


@lru_cache
def template(path):
    with Image.open(BytesIO(cairosvg.svg2png(url=str(path), output_width=360))) as source:
        image = source.convert('RGBA')
    return image.crop(image.getbbox())


def town_face(value, ending):
    image = Image.new('RGBA', (1080, 320))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 1079, 319), 16, fill='#00539e')
    draw.rounded_rectangle((20, 20, 1059, 299), 8, outline='#ffffff', width=12)
    put_text(image, value, .5, .51, .57, 'white')
    if ending:
        points = [(40, 278), (1038, 42)]
        draw.line(points, fill='white', width=41)
        draw.line(points, fill='#d51423', width=27)
    return image


def zone_face(image, ending):
    panel = Image.new('RGBA', (330, 410))
    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((0, 0, 329, 409), 12, fill='white')
    draw.rounded_rectangle((10, 10, 319, 399), 7, outline='#151515', width=4)
    put_text(panel, 'ZONE', .5, .125, .104, '#767676' if ending else '#171717')
    if ending:
        gray = ImageOps.grayscale(image).point(lambda channel: round(98 + channel * 157 / 255))
        gray.putalpha(image.getchannel('A'))
        image = gray.convert('RGBA')
    image = ImageOps.contain(image, (255, 278), Image.Resampling.LANCZOS)
    panel.alpha_composite(image, ((330 - image.width) // 2, 236 - image.height // 2))
    if ending:
        for offset in (0, 16, 32):
            draw.line((14 + offset, 394, 283 + offset, 17), fill='#1c1c1c', width=6)
    return panel


def make_sign(catalogue, record):
    code = record['rvvCode']
    value = record.get('blackCode', '')
    zone = record.get('zoneCode')
    if code == 'onbekend':
        return None
    if code in ('H1', 'H2'):
        return town_face(value, code == 'H2') if value else None
    if code == 'E8c':
        path = catalogue / EV_SIGN
        if path.is_file():
            with Image.open(path) as source:
                image = source.convert('RGBA')
            return image.crop(image.getbbox())
        return None

    path = catalogue / f'{code}.svg'
    speed_zone = (code == 'A1' and zone in ('BEGIN', 'REPEAT')) or (code == 'A2' and zone == 'END')
    if speed_zone:
        path = catalogue / ('A1ZB.svg' if code == 'A1' else 'A2ZE.svg')
    if not path.is_file():
        return None
    if code in VARIABLE_NUMBERS and not re.fullmatch(r'\d+(?:[.,]\d+)?', value):
        return None
    image = template(path).copy()
    if (code == 'D2' and value == 'LO') or (code in ('C4', 'D5', 'D6') and value == 'L'):
        image = ImageOps.mirror(image)
    if code in VARIABLE_NUMBERS:
        digits = value.replace('.', ',')
        if code in ('A1', 'A2'):
            y, size = (.55, .25) if speed_zone else (.51, .40)
            if code == 'A2':
                # The termination bars cross the speed, which shows through between them.
                original = image.copy()
                gray = ImageOps.grayscale(original).point(lambda level: 255 if level < 96 else 0)
                put_text(image, digits, .50, y, size, '#666666')
                image.paste(original, mask=gray)
            else:
                put_text(image, digits, .50, y, size, '#151515')
        elif code in ('A4', 'A5'):
            put_text(image, digits, .50, .34, .44, '#ffffff')
            if code == 'A5':
                original = template(path)
                red = original.getchannel('R').point(lambda level: 255 if level > 150 else 0)
                image.paste(original, mask=red)
        elif code in ('C17', 'C18', 'C19', 'C20', 'C21'):
            center_y = .49 if code in ('C18', 'C19', 'C21') else .375
            put_text(image, digits, .43, center_y, .205, '#222824')
        else:
            put_text(image, digits, .5, .50, .25, '#ffffff')

    if not speed_zone and zone in ('BEGIN', 'REPEAT', 'END') and code not in ('E10', 'E11'):
        image = zone_face(image, zone == 'END')
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('signs', type=Path, help='Output from build-ede-street-signs.py')
    parser.add_argument('catalogue', type=Path, help='NDW svg_verkeersborden directory')
    args = parser.parse_args()
    records = [s for s in json.loads(args.signs.read_bytes())['signs'] if s['kind'] == 'traffic']
    by_face = {SIGNS.face_key(s): s for s in records}
    faces = {key: face for key, record in sorted(by_face.items())
             if (face := make_sign(args.catalogue, record)) is not None}
    if not faces:
        raise ValueError('No sign art found. Check the supplied NDW catalogue.')
    cell = MAX_SIZE + 2 * PADDING
    atlas = Image.new('RGBA', (COLUMNS * cell, ceil(len(faces) / COLUMNS) * cell))
    frames = {}
    for i, (key, image) in enumerate(faces.items()):
        image = ImageOps.contain(image, (MAX_SIZE, MAX_SIZE), Image.Resampling.LANCZOS)
        x = (i % COLUMNS) * cell + (cell - image.width) // 2
        y = (i // COLUMNS) * cell + (cell - image.height) // 2
        atlas.alpha_composite(image, (x, y))
        frames[key] = [x, y, image.width, image.height]

    encoded = BytesIO()
    atlas.save(encoded, format='PNG', optimize=True)
    SIGNS.write(PNG, encoded.getvalue())
    index = {'width': atlas.width, 'height': atlas.height, 'frames': frames}
    SIGNS.write(PNG.with_suffix('.json'), (json.dumps(index, separators=(',', ':')) + '\n').encode())
    missing = Counter(s['rvvCode'] for s in records if SIGNS.face_key(s) not in frames)
    print(f'{len(frames)} atlas entries. Sign records without matching art: {dict(missing)}')


if __name__ == '__main__':
    main()
