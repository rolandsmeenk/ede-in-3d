const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('Ede aerial builder samples inset roofs and centerlines in scene order', () => {
  const bytes = execFileSync('python3', ['-B', '-c', `
import runpy
import sys

sys.path.insert(0, 'tools')
m = runpy.run_path('tools/build-ede-aerial.py')
step = m['SAMPLE_STEP']
width, height = 64, 32
north = height * step
pixels = bytearray()
for row in range(height):
    y = north - (row + 0.5) * step
    for column in range(width):
        x = (column + 0.5) * step
        if x >= 16:
            if y >= 10:
                rgb = (118, 131, 122)  # slightly green asphalt
            elif y >= 7:
                rgb = (150, 99, 82) if 17.5 < x < 30.5 else (230, 230, 230)
            else:
                rgb = (65, 100, 50)  # vegetation should fall back
        elif abs(x - 7) < 4 and abs(y - 7) < 4:
            rgb = (240, 240, 240)  # courtyard
        elif min(x, y, 14 - x, 14 - y) < 1:
            rgb = (180, 190, 170)  # border
        else:
            rgb = (80, 93, 104) if x < 8 else (29, 31, 33)
        pixels.extend((*rgb, 255))

scene = {
    'buildings': [
        {'ring': [0, 0, 14, 0, 14, 14, 0, 14], 'holes': [[3, 3, 11, 3, 11, 11, 3, 11]]},
        {'ring': [0, 20, 2, 20, 2, 22, 0, 22], 'holes': []},
    ],
    'roads': [
        {'pts': [16, 8, 32, 8, 32, 8, 40, 8], 'width': 3, 'tunnel': False},
        {'pts': [16, 6, 32, 6], 'width': 3, 'tunnel': False},
        {'pts': [16, 8, 32, 8], 'width': 3, 'tunnel': True},
        {'pts': [16, 12, 32, 12], 'width': 3, 'tunnel': False},
    ],
}
projected = {}
for coords in [
    *[ring for b in scene['buildings'] for ring in [b['ring'], *b['holes']]],
    *[r['pts'] for r in scene['roads']],
]:
    projected.update((point, point) for point in m['points'](coords))
grid = m['ground_grid']((-81, -12, 95, 89))
assert grid == {'minX': -231, 'minZ': -162, 'step': 3, 'width': 160, 'height': 135}
image = m['Image'](pixels, width, height, (0, step, 0, north, 0, -step))
rotated = m['Image'](pixels, width, height, (174500, .45, .10, 450900, -.15, -.45))
# Read pixel (3, 4) at its center in a translated, rotated affine.
assert rotated.offset(174500 + 3.5*.45 + 4.5*.10, 450900 - 3.5*.15 - 4.5*.45) == (4 * width + 3) * 4
sys.stdout.buffer.write(m['bake_colors'](scene, projected, image))
`], { cwd: join(__dirname, '..') });
  assert.equal(bytes.toString('ascii', 0, 4), 'EAC1');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), 6);
  assert.deepEqual([...bytes.subarray(12, 18)], [82, 93, 102, 0, 0, 0]);
  assert.deepEqual([...bytes.subarray(18)], [146, 100, 85, ...Array(12).fill(0), 123, 129, 125]);
});
