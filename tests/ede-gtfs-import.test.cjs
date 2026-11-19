const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const test = require('node:test');

test('Ede GTFS import keeps the selected bus routes, midnight service and platform geometry', () => {
  execFileSync('python3', ['-B', '-c', `
import csv
from io import BytesIO, StringIO
from runpy import run_path
from zipfile import ZipFile

module = run_path('tools/import-ede-gtfs.py')
routes = [(route, agency, line) for (agency, route), line in module['ROUTES'].items() if agency == 'RRREIS']
with ZipFile(BytesIO(), 'w') as feed:
    def table(name, header, rows):
        content = StringIO()
        writer = csv.writer(content)
        writer.writerow(header.split())
        writer.writerows(rows)
        feed.writestr(f'{name}.txt', content.getvalue())

    table('agency', 'agency_id agency_name', [('RRREIS', 'RRReis'), ('ARR', 'Arriva')])
    table('routes', 'route_id agency_id route_short_name route_long_name route_type',
          [(*route, 'Ede', '3') for route in routes] + [('9', 'ARR', '1', 'Elsewhere', '3')])
    table('trips', 'route_id service_id trip_id trip_headsign direction_id shape_id',
          [(route, 'weekday', route, 'Ede Station', '0', '7') for route, _, _ in routes]
          + [('9', 'weekday', '9', 'Elsewhere', '0', '8')])
    table('calendar', 'service_id monday tuesday wednesday thursday friday saturday sunday start_date end_date',
          [('weekday', 1, 1, 1, 1, 1, 0, 0, 20261116, 20261122)])
    table('calendar_dates', 'service_id date exception_type', [('weekday', 20261117, 2), ('weekday', 20261121, 1)])
    table('shapes', 'shape_id shape_pt_sequence shape_pt_lon shape_pt_lat shape_dist_traveled',
          [('7', 2, 40, 0, 200), ('7', 1, 0, 0, 100)])
    table('stops', 'stop_id stop_name platform_code stop_lon stop_lat',
          [('A', 'Stop, A', 'G', 20, 1), ('B', 'Stop B', '', 40, 0)])
    table('stop_times', 'trip_id stop_sequence stop_id arrival_time departure_time shape_dist_traveled', [
        call for route, _, _ in routes for call in [
            (route, 8 if route == '162158' else 2, 'B', '25:04:21', '25:04:21', 200),
            (route, 1, 'A', '25:04:04', '25:04:05', 150),
        ]
    ])
    data = module['import_feed'](feed, lambda x, z: (float(x), float(z)))

assert [v['routeId'] for v in data['variants']] == [route for route, _, _ in routes]
assert data['services'] == [f'2026-11-{day}' for day in (16, 18, 19, 20, 21)]
variant = data['variants'][0]
assert variant['operator'] == 'RRReis'
assert variant['headsign'] == 'Ede Station'
assert variant['shape'] == ((0, 0), (40, 0))
assert variant['stops'][0] == {'id': 'A', 'name': 'Stop, A', 'platform': 'G', 'x': 20, 'z': 1, 'distance': 20}
assert variant['trips'] == [{'id': '162158', 'departure': 90245, 'dates': [0, 1, 2, 3, 4], 'stops': [[-1, 0], [16, 16]], 'stopSequences': [1, 8]}]
assert 'stopSequences' not in data['variants'][1]['trips'][0]
`], { cwd: join(__dirname, '..') });
});

test('Ede rail import keeps scheduled platforms, overnight times and the direct through route', () => {
  execFileSync('python3', ['-B', '-c', `
import csv
from io import BytesIO, StringIO
from runpy import run_path
from zipfile import ZipFile

module = run_path('tools/import-ede-trains.py')
with ZipFile(BytesIO(), 'w') as feed:
    def table(name, header, rows):
        content = StringIO()
        writer = csv.writer(content)
        writer.writerow(header.split())
        writer.writerows(rows)
        feed.writestr(f'{name}.txt', content.getvalue())

    stations = [('ut', 'Utrecht Centraal', -800), ('ed', 'Ede-Wageningen', 0),
                ('edc', 'Ede Centrum', 30), ('ah', 'Arnhem Centraal', 800)]
    table('stops', 'stop_id stop_name stop_code location_type parent_station platform_code stop_lon stop_lat',
          [(code, name, code, 1, '', '', x, 0) for code, name, x in stations]
          + [(code + 'p', name, '', 0, code, platform, x, 0)
             for (code, name, x), platform in zip(stations, ['19', '4', '1', '4b'])]
          + [('eda', 'Ede-Wageningen', '', 0, 'ed', '1a', -1, 0),
             ('aha', 'Arnhem Centraal', '', 0, 'ah', '4a', 800, 0)])
    table('routes', 'route_id agency_id route_short_name route_type',
          [('ns', 'IFF:NS', 'S72', 2), ('rr', 'IFF:RRREIS_K', 'RS34', 2),
           ('ice', 'IFF:NS_INT', 'ICE', 2)])
    table('trips', 'route_id service_id trip_id trip_short_name realtime_trip_id trip_long_name shape_id', [
        ('ns', 'weekday', 'A', 7501, 'IFF:SPR:7501', 'Sprinter', 'direct'),
        ('rr', 'weekend', 'B', 31300, 'IFF:SPR:31300', 'Sprinter', 'branch'),
        ('ice', 'weekday', 'C', 123, 'IFF:ICE:123', 'ICE', 'direct'),
        ('ice', 'weekday', 'D', 124, 'IFF:ICE:124', 'ICE', 'diverted'),
        ('ice', 'weekday', 'E', 123, 'IFF:ICE:123', 'ICE', 'direct'),
    ])
    table('calendar_dates', 'service_id date exception_type',
          [('weekday', 20261119, 1), ('weekend', 20261119, 1), ('weekday', 20261120, 2)])
    table('shapes', 'shape_id shape_pt_lon shape_pt_lat', [('direct', 0, 0), ('diverted', 0, 800)])
    table('stop_times', 'trip_id stop_sequence stop_id arrival_time departure_time', [
        (trip, sequence * 3, stop, f'25:{sequence:02}:00', f'25:{sequence:02}:20')
        for trip, stops in [('A', ['edp', 'ahp', 'aha']), ('B', ['eda', 'edcp']),
                            ('C', ['utp', 'ahp']), ('D', ['ahp', 'utp']), ('E', ['utp', 'ahp'])]
        for sequence, stop in enumerate(stops, 1)
    ])
    data = module['import_feed'](feed, lambda x, z: (float(x), float(z)))

assert data['version'] == 1
assert data['dates'] == ['2026-11-19']
assert data['calendars'] == [(0,)]
assert data['platforms'] == {'edp': '4', 'eda': '1a', 'edcp': '1'}
ns, rr, ice = data['trips']
assert (ns['route'], ns['direction'], ns['realtimeTripId']) == ('main', 1, 'IFF:SPR:7501')
assert ns['stops'][0] == {'station': 'ede-wageningen', 'arrival': 90060, 'departure': 90080,
                          'stopId': 'edp', 'sequence': 3, 'platform': '4'}
assert [stop['platform'] for stop in ns['stops']] == ['4', '4b', '4a']
assert (rr['operator'], rr['route'], rr['direction']) == ('RRReis', 'rs34', -1)
assert [stop['station'] for stop in ice['stops']] == ['utrecht-centraal', 'arnhem-centraal']
`], { cwd: join(__dirname, '..') });
});
