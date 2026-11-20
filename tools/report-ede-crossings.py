"""Render the browser audit and survey observations as one row per route level."""

import argparse
from collections import Counter
from functools import cache
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def point(value):
    return ', '.join(f'{v:.2f}' for v in value[:2])


def pose(value):
    return ', '.join(f'{v:.2f}' for v in value if v is not None)


def span(values):
    numbers = [v for v in values if v is not None]
    if not numbers:
        return '—'
    if max(numbers) - min(numbers) < .025:
        return f'{min(numbers):.2f}'
    return f'{min(numbers):.2f}–{max(numbers):.2f}'


@cache
def frame():
    from ede_gis import Frame
    from ede_map import load_scene

    return Frame(load_scene()['meta']['lonLatAffine'])


def surveyed_heights(directory, site, samples):
    if not directory:
        return ''
    import rasterio
    from ede_raster import require_rd_raster

    coords = [frame().scene_to_rd(p['x'], p['z']) for p in samples]
    parts = []
    for kind in ('dtm', 'dsm'):
        source = directory / f"{site['id']}-{kind}.tif"
        if not source.exists():
            continue
        with rasterio.open(source) as raster:
            require_rd_raster(raster)
            values = [float(v[0]) for v in raster.sample(coords)]
        plausible = [v for v in values if -2 < v < 95]
        if plausible:
            parts.append(f'{kind.upper()} {span(plausible)}')
    return 'Observed AHN 0.5 m ' + ', '.join(parts) if parts else ''


def report(raw, catalog, output, survey=None):
    snapshots = {s['id']: s for s in raw['sites']}
    rows = []
    levels = Counter()
    checks_total = Counter()
    for site in catalog['sites']:
        sample = snapshots.get(site['id'], {})
        for side in ('shared',) if site['kind'] == 'level' else ('upper', 'lower'):
            routes = [r for r in sample.get('routes', []) if r['level'] == side]
            checks = [(r, key, value) for r in routes for key, value in r['checks'].items()]
            state = Counter(c['status'] for _, _, c in checks)
            checks_total.update(state)
            heights = [r['heights'][1] for r in routes]
            modelled = any(r['modelled'] or any(h['roofNAP'] is not None for h in r['heights']) for r in routes)
            source = sorted({h['source'] for h in heights})
            unfitted = side == ('upper' if site['kind'] == 'bridge' else 'lower') and side != 'shared' and not modelled
            wrong_moves = sample.get('wrongLevelMoves', [])
            status = 'Fail' if state['fail'] or wrong_moves else 'Unverified' if not state or state['unverified'] or unfitted or site['status'] == 'candidate' else 'Pass'
            levels[status] += 1
            modes = []
            for mode in ('car', 'van', 'bus', 'cyclist', 'person', 'train'):
                directions = Counter(k.split('/')[0] for _, k, _ in checks if k.endswith('/' + mode))
                result = Counter(c['status'] for _, k, c in checks if k.endswith('/' + mode))
                if directions:
                    modes.append(f'{mode} {directions["forward"]}F/{directions["reverse"]}R ({result["pass"]}P/{result["fail"]}F/{result["unverified"]}U)')
            movement = ', '.join(modes) or 'No mapped gameplay route'
            referenced = sorted({r['way'].removeprefix('w') for r in routes})
            if referenced:
                movement += '<br>OSM ' + ', '.join(referenced)
            measure = ''
            if routes:
                triplet = [span([r['heights'][i]['surfaceNAP'] for r in routes]) for i in range(3)]
                measure = ' → '.join(triplet)
                measure += ' (' + ', '.join(source) + ')'
                ceiling = span([h['roofNAP'] for h in heights])
                if ceiling != '—':
                    measure += '<br>Estimated soffit ' + ceiling + ', clearance ' + span([h['clearance'] for h in heights])
                portals = [p for route in routes for p in route.get('portals', ())]
                if portals:
                    measure += '<br>Portal or abutment surface ' + span([p['surfaceNAP'] for p in portals])
                observed = surveyed_heights(survey, site, heights)
                if observed:
                    measure += '<br>' + observed
            samples = []
            for junction in wrong_moves:
                samples.append(f'Unexpected transfer between levels at `{point(junction["center"])}`')
            for route, mode, result in checks:
                if result['status'] != 'fail':
                    continue
                bad = result.get('exit') or route['middle']
                entry = result.get('entry')
                samples.append(f'{route["way"]} {mode} at `{pose(bad)}`'
                               + (f' from `{pose(entry)}`' if entry else '')
                               + ' (' + ', '.join(result.get('issues', ())) + ')')
            if not samples:
                if not routes:
                    samples.append('No route controller or transition is mapped for this level')
                elif unfitted:
                    samples.append('Independent floor or deck height and clearance still need survey or photos')
                elif state['unverified']:
                    samples.append('At least one listed direction or traffic mode lacks a movement observation')
            samples.append(f'Site X/Z `{point(site["center"])}`')
            if sample.get('trafficByLevel'):
                samples.append(f'{sample["trafficByLevel"].get(side, 0)} matching nearby traffic actors in the brief site sample')
            label = f'{site["evidence"].get("inventory")}. ' if site.get('evidence', {}).get('inventory') else ''
            rows.append(f'| {label}{site["name"]} | {side} | **{status}** | {movement} | {measure or "—"} | ' + '<br>'.join(samples) + ' |')
    topology = catalog['topology']
    counts = catalog['counts']
    with output.open('w') as file:
        file.write('# Slop Ede crossing audit\n\n')
        file.write(f'The catalogue contains {counts["knownStructural"]} requested structures, {counts["confirmed"]} additional confirmed map features, '
                   f'{counts["candidate"]} discovery candidates and {counts["level"]} public level crossings. '
                   f'This run used Chrome {raw["backend"]}. There are {levels["Pass"]} passed, {levels["Fail"]} failed and {levels["Unverified"]} unverified route levels. '
                   f'The direction and mode checks comprise {checks_total["pass"]} passes, {checks_total["fail"]} failures and {checks_total["unverified"]} unverified checks.\n\n')
        file.write('A structure passes overall when both rows pass. F and R follow the sampled path order. '
                   'The counts in parentheses give pass, fail and unverified per travel mode. The browser steers each player controller along its centreline, '
                   'tries direct midpoint and approach spawns and checks the chase camera in covered sections. Train checks sweep the actual train alignment sampler in the listed direction. '
                   'The road graph is queried for buses and vans, and observed local traffic is counted separately. A brief observation can leave a supported service unverified.\n\n')
        file.write('The height column gives the simulation surface at the approach, crossing and exit in metres NAP. “AHN grid” means the game’s 12 m terrain grid. '
                   '“Fitted grade” and “rail profile” are modeled elevations. Two-sided exposed approaches and AHN and ProRail observations constrain the fits where available. '
                   'DTM and DSM observations refer to exposed ground and the visible top surface, which may be a roof or deck. Hidden floors, slab thicknesses and soffits are estimates except where noted. '
                   'Failure positions are in X, Z and world Y where available. Use them to reproduce the approach and stop, and use the site X/Z for a map-level view. '
                   'The scene uses X east, Z south and Y = NAP minus 22.54 m.\n\n')
        table = ', '.join(f'{key.upper()} {row["tripleOverlapCount"]}' for key, row in topology.items() if isinstance(row, dict) and 'tripleOverlapCount' in row)
        file.write(f'Three-level footprint overlaps above 0.01 m² by check are {table}. The fitted check uses independent elevations more than 0.8 m apart. '
                   'The inputs contain route surfaces and exclude road paint, soffits and decorative geometry.\n\n')
        file.write('The priority survey gaps include the Oosttunnel platform stairs and lifts and the concealed Hoekelum floor. '
                   'The fitted Polar Bearsplein ramps, Stadspoort walkway and Parklaan floor and soffits still need as-built measurements. '
                   'The [station access documentation](https://www.spoorzone-ede.nl/nieuw-station/toegankelijkheid) identifies the Oosttunnel connections. '
                   'The [Pico Bello Pad project](https://www.ede.nl/in-de-gemeente-ede/ede-in-ontwikkeling/snelle-fietsroute-ede-wageningen) identifies the Hoekelum tunnel.\n\n')
        file.write('| Site | Level | Status | Travel checks and approaches | Elevation evidence, m NAP | Reproduction and remaining checks |\n')
        file.write('| --- | --- | --- | --- | --- | --- |\n')
        file.write('\n'.join(rows) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('browser_results', type=Path)
    parser.add_argument('--survey-dir', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'tools/data/ede-crossing-audit.md')
    args = parser.parse_args()
    report(json.loads(args.browser_results.read_text()),
           json.loads((ROOT / 'tools/data/ede-crossing-sites.json').read_text()), args.output, args.survey_dir)
