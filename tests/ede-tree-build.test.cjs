const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('Ede tree builder merges surveyed attributes and retains distinct nearby trunks', () => {
  const bytes = execFileSync('python3', ['-B', '-c', `
import runpy, sys
m = runpy.run_path('tools/build-ede-trees.py')
Tree, classify, measure = m['Tree'], m['classify'], m['measure']
def tree(x, z, source, height=0, diameter=0, species=255):
    return Tree((x, z), (x, z), height, diameter, species, source)

sites = m['unique']([tree(2.55, -1, 1), tree(3.5, -1, 1), tree(2.49, -1, 1),
                     tree(210, 0, 1), tree(100, 210, 1), tree(101, 0, 1)])
municipal = [
    tree(2.4, -1, 2, measure('12 - 15 m', 'm'), measure('30 - 45 cm', 'cm'),
         classify('Robinia pseudoacacia')),
    tree(3.4, -1, 2, measure('> 24 m', 'm'), 75, classify("Quercus robur 'Fastigiata'")),
    tree(8, -1, 2, species=classify('Pinus sylvestris')),
]
m['join'](sites, municipal, m['MUNICIPAL_REACH'])
m['join'](sites, [tree(2.42, -1, 4, 9, 21, 0), tree(8.3, -1, 4, 15),
                  tree(-1, -1, 4, 0, 0, classify('unknown'))], m['OSM_REACH'])
sys.stdout.buffer.write(m['pack'](sites))
`], { cwd: join(__dirname, '..') });
  assert.equal(bytes.toString('ascii', 0, 4), 'EDT1');
  assert.equal(bytes.readUInt32LE(4), 7);
  const records = [];
  for (let i = 8; i < bytes.length; i += 9) {
    records.push([bytes.readInt16LE(i), bytes.readInt16LE(i + 2), bytes.readUInt16LE(i + 4),
      bytes[i + 6], bytes[i + 7], bytes[i + 8]]);
  }
  assert.deepEqual(records, [
    [-5, -5, 0, 0, 255, 4],
    [12, -5, 135, 38, 1, 7],
    [18, -5, 240, 75, 2, 3],
    [40, -5, 150, 0, 3, 6],
    [505, 0, 0, 0, 255, 1],
    [500, 1050, 0, 0, 255, 1],
    [1050, 0, 0, 0, 255, 1]
  ]);
});
