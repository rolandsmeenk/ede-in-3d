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
