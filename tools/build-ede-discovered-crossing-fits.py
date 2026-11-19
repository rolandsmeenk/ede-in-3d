"""Build the six surveyed walking and cycling bridges over water in Ede."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'tools/data'
SURVEY = runpy.run_path(str(ROOT / 'tools/build-ede-crossing-fits.py'))
GRADE = SURVEY['GRADE']

# Distance from the first bridge node, metres NAP. These PDOK 0.5 m DSM
# observations exclude vegetation and parapets. DTM supplies the two short
# approaches to 544853927 and the west approach to 24860907.
CONTROLS = {
    'w544853927': [(-2, 9.38), (6, 10.02), (12, 10.34), (18, 10.18), (26, 9.42)],
    'w225819919': [(-6, 12.95), (0, 12.98), (6, 13.18), (13, 13.26), (21, 13.15), (26, 12.93)],
    'w1249928597': [(0, 9.98), (6, 10.46), (12, 10.86), (16, 10.91), (24, 10.44), (30, 9.98), (34, 9.96)],
    'w24860907': [(0, 10.37), (10, 11.38), (14, 11.38), (18, 11.22), (24, 10.75), (29, 10.44)],
    'w421611755': [(-4, 13.73), (0, 13.75), (6, 13.82), (11, 13.87), (20, 13.79), (22, 13.76)],
    'w373643286': [(0, 13.83), (6, 14.09), (12, 14.19), (20, 14.07), (26, 13.89), (32, 14.03)],
}


def build():
    scene = GRADE['load_scene']()
    terrain = GRADE['Terrain']()
    catalog = json.loads((DATA / 'ede-crossing-sites.json').read_text())['sites']
    widths = json.loads((DATA / 'ede-bgt-road-evidence.json').read_text())['ways']
    ways = {road['id']: road for road in scene['roads'] if len(road['pts']) >= 4}
    endpoints = defaultdict(list)
    for road in ways.values():
        points = SURVEY['coordinates'](road)
        endpoints[points[0]].append((road, 1))
        endpoints[points[-1]].append((road, -1))

    sites = []
    for way_id, observations in CONTROLS.items():
        site = next(site for site in catalog if site['upperWayIds'] == [way_id] and site['bgtIds'])
        way = ways[way_id]
        line, parts = SURVEY['extension'](way, endpoints)
        _, a, b = next(part for part in parts if part[0] == way_id)
        start = max(0, a - 16)
        end = min(line.length, b + 16)
        knots = [(start, terrain.at(line.interpolate(start).coords[0])),
                 *((a + s, y) for s, y in observations),
                 (end, terrain.at(line.interpolate(end).coords[0]))]
        assert all(lo < hi for (lo, _), (hi, _) in zip(knots, knots[1:])), (way_id, knots)
        marks = sorted({start, end, a, b, *[s for s, _ in knots],
                        *[s for s in range(int(start) + 1, int(end), 2) if start < s < end],
                        *[s for s in GRADE['stations_of'](list(line.coords)) if start < s < end]})
        points = []
        for at in marks:
            p = line.interpolate(at)
            x, z = round(p.x, 2), round(p.y, 2)
            if points and points[-1][:2] == [x, z]:
                continue
            points.append([x, z, round(GRADE['fitting_curve'](knots, at) - terrain.nap, 3)])
        profile = dict(id=f"{site['id']}-deck", points=points,
                       wayIds=[key for key, lo, hi in parts if lo < end and start < hi],
                       modes=SURVEY['mode_names'](way), width=SURVEY['modeled_width'](way, widths),
                       span=[round(a - start, 2), round(b - start, 2)])
        sites.append(dict(id=site['id'], name=site['name'], kind='bridge', profiles=[profile],
                          evidence=dict(bgt=site['bgtIds'],
                                        heights='PDOK AHN DTM and DSM 0.5 m deck and approaches, tied to game terrain')))
    return dict(version=1, sites=sites)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DATA / 'ede-discovered-crossing-fits.json')
    args = parser.parse_args()
    args.output.write_text(json.dumps(build(), separators=(',', ':')) + '\n')
