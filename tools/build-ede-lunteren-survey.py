#!/usr/bin/env python3
"""Bake the northern landmark footprints, structures and 3DBAG LoD 2.2 shells."""
import argparse
import gzip
import json
from pathlib import Path
from runpy import run_path
from urllib.parse import urlencode

from shapely.geometry import Polygon

from ede_gis import Frame, source_crs
from ede_scene import SCENE_NAP_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
CACHE_FILE = run_path(str(ROOT / 'tools/build-ede-school-survey.py'))['cached_file']
BAKE = run_path(str(ROOT / 'tools/build-ede-estate-survey.py'))['bake']
BAG_API = 'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.'
TRANSFER_API = 'https://maps.prorail.nl/arcgis/rest/services/Transfer/MapServer/3/query'
# BAG building centre, public approach (longitude first), focus, and observed brick/roof colours.
BUILDINGS = (
    ('station-lunteren', 'Station Lunteren', 'Spoorstraat',
     '0228100000059243', 'w271717576', (5.6241127, 52.0850995), (5.6239126, 52.0851850), 4, 0x695248, 0xb17251),
    ('de-koepel', 'Uitkijktoren De Koepel', 'Boslaan',
     '0228100000050340', 'w271724980', (5.648061, 52.082925), (5.648170, 52.082921), 12, 0x78534a, 0x424849),
    ('oude-kerk-lunteren', 'Oude Kerk Lunteren', 'Dorpsstraat',
     '0228100000054819', 'w271717267', (5.6217411, 52.0837909), (5.62135, 52.08381), 8, 0x7e6858, 0x424648),
    ('molen-de-hoop', 'Molen De Hoop', 'Spoorwiel',
     '0228100000044974', 'w271853619', (5.6193812, 52.0900569), (5.619236, 52.089993), 8, 0x403b32, 0x4d4335),
    ('museum-lunteren', 'Museum Lunteren', 'Dorpsstraat',
     '0228100000039464', 'w271719879', (5.6208154, 52.0839567), (5.621014, 52.084016), 3.2, 0x875c4b, 0x4a4844),
    ('dennenhorst', 'Pinetum De Dennenhorst', 'Boslaan',
     '0228100000056442', 'w271723989', (5.6357641, 52.0856898), (5.635888, 52.085623), 3.5, 0x493a2e, 0x484641),
    ('de-wormshoef', 'De Wormshoef', 'Dorpsstraat',
     '0228100000016955', 'w271849772', (5.6183187, 52.0925428), (5.61805, 52.09254), 4, 0xd1caba, 0x865747),
    ('de-eekhorst', 'D’Eekhorst', 'Dorpsstraat',
     '0228100000008039', 'w271849367', (5.6176985, 52.0939622), (5.61736, 52.093999), 4, 0x7d5748, 0x865a48),
)
# Digitized at the RD New georeferencing of the 2026 PDOK aerial crops, metres.
FARM = [
    [(174121.4, 457743.8), (174123.8, 457749.1), (174135.7, 457744.1), (174133.8, 457738.4)],
    [(174117.1, 457759.3), (174117.4, 457762.1), (174120.0, 457761.8), (174119.7, 457759.0)],
]
HESSEN_WALK = [
    (5.6432821, 52.0993189), (5.643241, 52.0993493), (5.6432037, 52.0993761),
    (5.6431637, 52.0994064), (5.6431226, 52.0994365),
]


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def render(cache, fetch, frame):
    def xy(e, n):
        return [round(v, 2) for v in frame.rd_to_scene(e, n)]

    def geographic(lon, lat):
        return xy(*frame.to_rd(lon, lat, 'OGC:CRS84'))

    structures = {
        'hessenWalk': [geographic(*p) for p in HESSEN_WALK],
        'hessenDeck': xy(172534.8, 456832.3),
        # The three OSM sector edges fit the same 8.60/9.60/12.60 m centre.
        'middelpuntRing': xy(172750.06, 456996.02),
        'middelpuntStone': geographic(5.6462273, 52.1009105),
        'middelpuntBoulders': [xy(172753.85, 456999.85), xy(172754.75, 456991.50)],
        'middelpuntLime': geographic(5.6463004, 52.1008954),
        'farm': [[xy(*p) for p in ring] for ring in FARM],
    }
    query = urlencode({'where': "BGT_ID='L0004.ab16f8c74b376508e05332a1e90aa656'",
                       'outFields': 'BGT_ID', 'returnGeometry': 'true', 'outSR': 28992, 'f': 'json'})
    canopy_id = 'L0004.ab16f8c74b376508e05332a1e90aa656'
    transfer = json.loads(CACHE_FILE(cache, 'transfer-3.json', f'{TRANSFER_API}?{query}', fetch).read_bytes())
    crs = source_crs(transfer)
    canopy = next(item for item in transfer['features'] if item['attributes']['BGT_ID'] == canopy_id)
    structures['stationCanopy'] = [
        xy(*frame.to_rd(*p[:2], crs, axis_order='xy')) for p in canopy['geometry']['rings'][0][:-1]
    ]
    if not 80 < Polygon(structures['stationCanopy']).area < 115:
        raise ValueError('The station canopy area differs from the ProRail survey')

    lines = ['// Northern landmark shells and anchors in the Oude Kerk scene frame.',
             '// Sources and refresh are documented in tools/data/ede-lunteren-landmarks.sources.md.',
             'export const LUNTEREN_SURVEYS = {']
    sites = []

    def site(key, name, road, center, approach, height, focus):
        data = dict(id=key, name=name, district='Lunteren', road=road, x=center[0], z=center[1],
                    height=height, focusHeight=focus, approach=dict(x=approach[0], z=approach[1]))
        sites.append('  ' + compact(data) + ',')

    for key, name, road, bag, osm, center, approach, focus, wall, roof in BUILDINGS:
        payload = json.loads(CACHE_FILE(cache, key + '-city.json', BAG_API + bag, fetch).read_bytes())
        source = {'metadata': payload['metadata'], 'features': [payload['feature']]}
        reference = source['metadata']['metadata']['referenceSystem']
        if not reference.endswith('/7415'):
            raise ValueError(f'Unexpected survey CRS for {bag}: {reference}')
        base, outline, points, faces = BAKE(source, bag, frame, SCENE_NAP_ORIGIN)
        footprint = Polygon(outline[0], outline[1:])
        x, z = geographic(*center)
        ax, az = geographic(*approach)
        if not (footprint.bounds[0] <= x <= footprint.bounds[2] and footprint.bounds[1] <= z <= footprint.bounds[3]):
            raise ValueError(f'{bag} is outside the independent BAG control point')
        props = dict(bagId=bag, osmId=osm, ground=base, wallColor=wall, roofColor=roof)
        lines += [f'  {compact(key)}: {{', '    ' + ', '.join(f'{k}: {compact(v)}' for k, v in props.items()) + ',',
                  f'    outline: {compact(outline)},']
        for field, data in (('points', points), ('faces', faces)):
            lines.append(f'    {field}: [')
            lines.extend('      ' + ', '.join(map(compact, data[i:i + 5])) + ',' for i in range(0, len(data), 5))
            lines.append('    ],')
        lines.append('  },')
        peak = max(point[1] for point in points)
        if key == 'oude-kerk-lunteren':
            peak = 53.52 - SCENE_NAP_ORIGIN  # Native AHN DSM, excluding the rooftop finial.
        elif key == 'molen-de-hoop':
            peak = base + 24.60  # Hub and the 12 m sail radius.
        site(key, name, road, [x, z], [ax, az], round(peak - base, 2), focus)

    site('hessenhut', 'De Hessenhut', 'Hessenweg', structures['hessenDeck'], geographic(5.643295, 52.099309), 6.5, 3)
    site('ijzertijdboerderij', 'IJzertijdboerderij en spieker', 'Vijfsprongweg', xy(174128, 457744),
         xy(174106, 457764), 5, 2)
    site('middelpunt-van-nederland', 'Middelpunt van Nederland', 'Lindeboomsbergweg',
         structures['middelpuntRing'], xy(172741.15, 457010.0), 1.3, 0.8)
    lines += ['};', '', 'export const LUNTEREN_STRUCTURES = {']
    lines.extend(f'  {key}: {compact(value)},' for key, value in structures.items())
    lines += ['};', '', 'export const EDE_LUNTEREN_LANDMARKS = [', *sites, '].map(site => {',
              '  const building = LUNTEREN_SURVEYS[site.id];',
              '  const footprint = building?.outline.map(ring => ring.map(([x, z]) => ({ x, z })));',
              '  return { ...site, worldSpace: true, mapScenic: true, ...(building && {',
              '    osmId: building.osmId, bagIds: [building.bagId],',
              "    ...(site.id === 'station-lunteren' && { excludeOsmIds: ['w1436261542'] }),",
              '    surveyFootprints: [{ outer: footprint[0], holes: footprint.slice(1) }],',
              '  }) };',
              '});', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(ROOT / 'assets/ede-map-v1.json.gz') as snapshot:
        frame = Frame(json.load(snapshot)['meta']['lonLatAffine'])
    output = render(args.cache, args.fetch, frame)
    target = ROOT / 'js/ede-lunteren-survey.js'
    if args.check:
        if target.read_text() != output:
            raise SystemExit(f'{target.name} differs from the survey bake')
    else:
        target.write_text(output)


if __name__ == '__main__':
    main()
