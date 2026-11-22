"""Bake Ede's public shelter and advertising records from Gelderland's stop register."""

import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


LAYER = 'https://geoportaal.gelderland.nl/gisserver/rest/services/Infra/Infra/MapServer/123/query'
FIELDS = ('quaycode', 'qnd_quayname', 'qld_town', 'qb_compassdirection',
          'qf_shelterpublicity', 'qf_seatavailable', 'qea_greenstop')
GREEN_ROOF_STOPS = {'Centrum/Raadhuis', 'Politiebureau', 'Station Ede Centrum', 'Centrum/Grotestraat'}


def main():
    query = urlencode(dict(f='json', outSR=4326, outFields=','.join(FIELDS), where=(
        "qm_municipalitycode='G0228' AND qsd_quaystatus='available' AND qld_level='0' AND "
        "qf_shelter='true' AND qda_transportmode='bus'")))
    with urlopen(f'{LAYER}?{query}', timeout=30) as response:
        payload = json.load(response)
    features = payload.get('features')
    if not features or payload.get('exceededTransferLimit'):
        raise ValueError('Expected a complete Ede shelter inventory')
    rows = {}
    for feature in features:
        props, point = feature['attributes'], feature['geometry']
        stop_id = props['quaycode']
        name, town = props['qnd_quayname'], props['qld_town']
        bearing = float(props['qb_compassdirection'])
        if not 0 <= bearing < 360 or not (5 < point['x'] < 6 and 51 < point['y'] < 53):
            raise ValueError(f'Invalid location for {stop_id}')
        rows[stop_id] = dict(id=stop_id, name=name, town=town,
                             lon=round(point['x'], 7), lat=round(point['y'], 7), bearing=bearing,
                             ad=props['qf_shelterpublicity'] == 'true', bench=props['qf_seatavailable'] == 'true',
                             green=props['qea_greenstop'] == 'true' or town == 'Ede' and name in GREEN_ROOF_STOPS)
    target = Path(__file__).resolve().parents[1] / 'js/ede-bus-shelter-sites.js'
    records = ',\n'.join('  ' + json.dumps(row, ensure_ascii=False, separators=(',', ':'))
                         for _, row in sorted(rows.items()))
    target.write_text('// Gelderland Bushaltes per consessiegebied, layer 123. See tools/build-ede-bus-shelters.py.\n'
                      f'export const EDE_BUS_SHELTER_SITES = [\n{records},\n];\n', encoding='utf-8')
    print(f'{len(rows)} shelters, {sum(row["ad"] for row in rows.values())} with advertising')


if __name__ == '__main__':
    main()
