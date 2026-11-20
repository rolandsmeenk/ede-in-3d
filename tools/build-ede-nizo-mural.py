#!/usr/bin/env python3
"""Bake the visible paint from the 743 × 476 ROOTS reference photograph."""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# Paired left and right wall panels. The physical stair and branches are masked.
PANELS = (
    (
        (43, 43, 0, 475, 368, 475, 338, -15),
        (
            (
                (47, 100), (66, 90), (90, 98), (111, 117), (141, 117), (153, 113),
                (174, 119), (183, 108), (195, 102), (214, 113), (240, 105), (258, 111),
                (274, 117), (284, 125), (273, 152), (263, 180), (260, 216), (264, 253),
                (277, 277), (284, 292), (269, 312), (264, 349), (265, 400), (276, 432),
                (290, 453), (310, 470), (322, 475), (10, 475), (15, 371), (20, 328),
                (50, 296), (69, 305), (113, 274), (137, 267), (113, 253), (84, 219),
                (53, 202), (45, 180), (51, 160), (47, 147),
            ),
        ),
    ),
    (
        (405, -16, 428, 475, 742, 475, 653, 47),
        (
            (
                (452, 131), (468, 105), (494, 86), (524, 80), (555, 88),
                (580, 108), (600, 137), (606, 166), (594, 190), (567, 208),
                (532, 216), (503, 209), (479, 194), (454, 179), (447, 157),
            ),
            (
                (608, 196), (638, 193), (652, 210), (647, 238), (629, 258), (608, 267),
                (586, 277), (563, 300), (541, 320), (517, 339), (498, 338), (493, 347),
                (510, 362), (534, 395), (541, 420), (533, 440), (516, 440), (503, 431),
                (488, 418), (463, 419), (441, 429), (425, 424), (421, 386), (432, 361),
                (452, 350), (465, 353), (479, 354), (502, 332), (511, 314), (539, 296),
                (553, 286), (562, 277), (561, 255), (575, 237), (595, 229), (579, 221),
                (587, 206), (601, 204),
            ),
        ),
    ),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('photograph', type=Path)
    options = parser.parse_args()

    source = Image.open(options.photograph).convert('RGBA')
    if source.size != (743, 476):
        raise ValueError('Use the original 743 × 476 image recorded in the mural catalogue')

    atlas = Image.new('RGBA', (512, 384))
    for index, (corners, outlines) in enumerate(PANELS):
        alpha = Image.new('L', source.size)
        painter = ImageDraw.Draw(alpha)
        for outline in outlines:
            painter.polygon(outline, fill=255)
        panel = source.copy()
        panel.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.9)))
        panel = panel.transform((250, 380), Image.Transform.QUAD, corners, Image.Resampling.BICUBIC)
        atlas.paste(panel, (index * 256 + 3, 2))

    output = Path(__file__).resolve().parents[1] / 'assets/ede-murals/structures/nizo-food.webp'
    atlas.save(output, quality=86, method=6)


if __name__ == '__main__':
    main()
