const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('facade bake merges sources and withholds complete buildings from local and Ede-wide profiles', () => {
  execFileSync('python3', ['-B', '-c', `
import runpy

m = runpy.run_path('tools/build-ede-facades.py')
def bag(n):
    return f'NL.IMBAG.Pand.02281000000{n:05d}'
def wall(n, section='front', neighbourhood='BU1', base=0, kind='street'):
    return dict(bagId=bag(n), wallId=section, a=[n * 6, 0], b=[(n + 1) * 6, 0],
                minY=base, baseOffset=base, height=3.2 if base else 6.4,
                neighbourhood=neighbourhood, buildingType='terraced', wallType=kind, storeys=2)
def opening(kind, x, y, width=1.2, height=1.4):
    return dict(kind=kind, x=x, y=y, width=width, height=height)
def observed(n, wall_id='front', color='#906045', image=None):
    return dict(bagId=bag(n), wallId=wall_id, wallColor=color, storeySpacing=3.2,
                confidence=0.9, sources=[dict(imageId=str(image or 100 + n), capturedAt='2025-03-15', confidence=0.9)],
                openings=[opening('window', 1, 4.1), opening('door', 0.6, 0, 1, 2.1),
                          opening('window', 3.8, 4.1), opening('window', 3.8, 0.8)])

catalogue = [wall(n) for n in range(1, 7)]
catalogue.extend([wall(4, 'side', kind='side'), wall(4, 'shared', kind='shared'), wall(7, 'shared', kind='shared'),
                  wall(6, 'upper', base=3.2), wall(8, neighbourhood='BU2')])
observations = [observed(n) for n in range(1, 4)]
observations.extend([observed(4, color='#ffffff'), observed(4, 'side', '#ffffff')])
observations[0]['detail'] = dict(opening=1, depth=0.6, surround=0.1, interior=False)
repeat = observed(1, image=456)
repeat.update(confidence=0.8, openings=[opening('window', 1, 4.1), opening('window', 2.1, 0.8)])
observations.append(repeat)

asset, report = m['bake'](catalogue, observations, [bag(4)])
walls = {(w['bagId'], w['wallId']): w for w in asset['walls']}
first = walls[bag(1), 'front']
assert first['status'] == 'observed' and len(first['sources']) == 2 and len(first['openings']) == 5
assert first['openings'][first['detail']['opening']]['kind'] == 'door'
assert report['heldOutBuildings'] == [bag(4)] and len(report['holdoutComparisons']) == 2
assert walls[bag(4), 'front']['status'] == 'inferred' and walls[bag(4), 'front']['profile'] == 'BU1/terraced/street'
assert walls[bag(4), 'front']['wallColor'] != '#ffffff' and (bag(4), 'side') not in walls
assert walls[bag(8), 'front']['profile'] == 'Ede/terraced/street'
assert walls[bag(4), 'shared']['openings'] == [] and (bag(7), 'shared') not in walls
assert all(o['kind'] == 'window' for o in walls[bag(6), 'upper']['openings'])
assert abs(int(walls[bag(4), 'front']['wallColor'][1:3], 16) - int(walls[bag(5), 'front']['wallColor'][1:3], 16)) <= 6
assert report['profiles'] == {'BU1/terraced/street': 3, 'Ede/terraced/street': 3}
assert report['holdoutComparisons'][0]['windowSpacingErrorM'] < 0.3
assert report['holdoutComparisons'][0]['doorAlignmentErrorM'] < 0.1
assert report['holdoutComparisons'][1]['fallback']
assert m['bake'](catalogue[::-1], observations[::-1], [bag(4)])[0] == asset
`], { cwd: join(__dirname, '..'), stdio: 'pipe' });
});
