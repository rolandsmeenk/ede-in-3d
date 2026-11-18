#!/usr/bin/env python3
"""Extract the Ede bus lines from a local OVapi GTFS ZIP for route matching."""

import argparse
from bisect import bisect_left
from collections import defaultdict
import csv
from datetime import date, timedelta
import io
import json
from math import dist
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
FEED_URL = 'https://gtfs.ovapi.nl/nl/gtfs-nl.zip'
ROUTES = {
    ('RRREIS', '162158'): '1',
    ('RRREIS', '162159'): '2',
    ('RRREIS', '162160'): '3',
    ('RRREIS', '162161'): '4',
    ('UOV', '153917'): '4',
    ('RRREIS', '162163'): '103',
    ('RRREIS', '162169'): '303',
}
# U-OV shares line 4 in the November 2026 schedule through 12 December.
REQUIRED_ROUTES = {key for key in ROUTES if key[0] == 'RRREIS'}
WEEKDAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
DAY = timedelta(days=1)


def read_table(archive, name, key=None, ids=None):
    path = f'{name}.txt'
    if path not in archive.namelist():
        return
    with io.TextIOWrapper(archive.open(path), encoding='utf-8-sig', newline='') as stream:
        reader = csv.reader(stream)
        columns = next(reader)
        index = columns.index(key) if key else None
        for values in reader:
            if values and (index is None or values[index] in ids):
                yield dict(zip(columns, values))


def load_projection():
    prefix = 'export const EDE_DATA = '
    with (ROOT / 'js' / 'ede-geodata.js').open() as source:
        line = next(line for line in source if line.startswith(prefix))
    affine = json.loads(line.removeprefix(prefix).strip().removesuffix(';'))['meta']['lonLatAffine']

    def project(lon, lat):
        dx = float(lon) - affine['lon0']
        dy = float(lat) - affine['lat0']
        return tuple(round(offset + a * dx + b * dy, 2) for offset, a, b in (affine['x'], affine['z']))

    return project


def gtfs_date(value):
    return date(int(value[:4]), int(value[4:6]), int(value[6:8]))


def service_dates(archive, service_ids):
    dates = defaultdict(set)
    for row in read_table(archive, 'calendar', 'service_id', service_ids):
        current = gtfs_date(row['start_date'])
        end = gtfs_date(row['end_date'])
        while current <= end:
            if row[WEEKDAYS[current.weekday()]] == '1':
                dates[row['service_id']].add(current)
            current += DAY
    for row in read_table(archive, 'calendar_dates', 'service_id', service_ids):
        current = gtfs_date(row['date'])
        service = dates[row['service_id']]
        if row['exception_type'] == '1':
            service.add(current)
        elif row['exception_type'] == '2':
            service.discard(current)
        else:
            raise ValueError(f'Unknown calendar exception: {row}')
    return dates


def time_seconds(clock):
    hour, minute, second = map(int, clock.split(':'))
    if hour < 0 or not (0 <= minute < 60 and 0 <= second < 60):
        raise ValueError(f'Invalid GTFS time {clock}')
    return hour * 3600 + minute * 60 + second


def stop_times(rows, trip_id):
    departure = time_seconds(rows[0]['departure_time'])
    times = []
    for row in rows:
        arrival = time_seconds(row['arrival_time']) - departure
        leave = time_seconds(row['departure_time']) - departure
        if arrival > leave or (times and times[-1][1] > arrival):
            raise ValueError(f'Times go backwards in trip {trip_id} at stop {row["stop_id"]}')
        times.append([arrival, leave])
    return departure, times


def shape_geometry(rows, project):
    rows = sorted(rows, key=lambda row: int(row['shape_pt_sequence']))
    points = tuple(project(row['shape_pt_lon'], row['shape_pt_lat']) for row in rows)
    distances = []
    if all(row.get('shape_dist_traveled') for row in rows):
        distances = [float(row['shape_dist_traveled']) for row in rows]
        if any(a > b for a, b in zip(distances, distances[1:])):
            distances = []
    progress = [0]
    for a, b in zip(points, points[1:]):
        progress.append(progress[-1] + dist(a, b))
    return points, distances, progress


def stop_progress(raw, distances, progress):
    if not raw or not distances:
        return None
    distance = float(raw)
    index = bisect_left(distances, distance)
    if index >= len(distances) or distance < distances[0]:
        return None
    if distances[index] == distance:
        return round(progress[index], 2)
    weight = (distance - distances[index - 1]) / (distances[index] - distances[index - 1])
    return round(progress[index - 1] + weight * (progress[index] - progress[index - 1]), 2)


def import_feed(archive, project):
    agency = {row['agency_id']: row for row in read_table(archive, 'agency')}
    routes = {row['route_id']: row for row in read_table(archive, 'routes')
              if ROUTES.get((row['agency_id'], row['route_id'])) == row['route_short_name']
              and row['route_type'] == '3'}
    missing = REQUIRED_ROUTES - {(row['agency_id'], route_id) for route_id, row in routes.items()}
    if missing:
        raise ValueError(f'Expected Ede bus routes are missing from the feed: {sorted(missing)}')
    trips = {row['trip_id']: row for row in read_table(archive, 'trips', 'route_id', routes)}
    dates = service_dates(archive, {row['service_id'] for row in trips.values()})
    trips = {trip_id: row for trip_id, row in trips.items() if dates[row['service_id']]}
    empty_routes = {route_id for _, route_id in REQUIRED_ROUTES} - {row['route_id'] for row in trips.values()}
    if empty_routes:
        raise ValueError(f'No scheduled Ede bus trips for GTFS routes {sorted(empty_routes)}')

    days = sorted(set().union(*dates.values()))
    day_index = {day: index for index, day in enumerate(days)}
    date_indices = {service_id: sorted(day_index[day] for day in active)
                    for service_id, active in dates.items() if active}

    shape_ids = {row['shape_id'] for row in trips.values()}
    shape_rows = defaultdict(list)
    for row in read_table(archive, 'shapes', 'shape_id', shape_ids):
        shape_rows[row['shape_id']].append(row)
    shapes = {shape_id: shape_geometry(rows, project) for shape_id, rows in shape_rows.items()}
    missing = {shape_id for shape_id in shape_ids if shape_id not in shapes or len(shapes[shape_id][0]) < 2}
    if missing:
        raise ValueError(f'Ede bus trips have missing GTFS shapes: {sorted(missing)}')

    calls = defaultdict(list)
    stop_ids = set()
    for row in read_table(archive, 'stop_times', 'trip_id', trips):
        calls[row['trip_id']].append(row)
        stop_ids.add(row['stop_id'])
    stops = {}
    for row in read_table(archive, 'stops', 'stop_id', stop_ids):
        x, z = project(row['stop_lon'], row['stop_lat'])
        stops[row['stop_id']] = {
            'id': row['stop_id'], 'name': row['stop_name'], 'platform': row.get('platform_code', ''),
            'x': x, 'z': z,
        }

    def trip_order(item):
        trip_id, trip = item
        return int(routes[trip['route_id']]['route_short_name']), trip_id

    variants = {}
    for trip_id, row in sorted(trips.items(), key=trip_order):
        route_id = row['route_id']
        route = routes[route_id]
        line = route['route_short_name']
        agency_id = route['agency_id']
        shape, distances, progress = shapes[row['shape_id']]
        rows = sorted(calls[trip_id], key=lambda call: int(call['stop_sequence']))
        if len(rows) < 2:
            raise ValueError(f'Ede bus trip {trip_id} has fewer than two stops')
        direction = int(row['direction_id']) if row.get('direction_id') else None
        headsign = row['trip_headsign']
        stop_sequence = tuple((call['stop_id'], call.get('stop_headsign', ''),
                               stop_progress(call.get('shape_dist_traveled'), distances, progress)) for call in rows)
        key = route_id, direction, headsign, shape, stop_sequence
        if key not in variants:
            variant_stops = []
            for stop_id, stop_headsign, distance in stop_sequence:
                stop = stops[stop_id].copy()
                if stop_headsign:
                    stop['headsign'] = stop_headsign
                if distance is not None:
                    stop['distance'] = distance
                variant_stops.append(stop)
            variants[key] = {
                'id': f'{route_id}:{row["shape_id"]}:{len(variants) + 1}',
                'agencyId': agency_id, 'operator': agency[agency_id]['agency_name'],
                'routeId': route_id, 'routeName': route['route_long_name'], 'line': line,
                'headsign': headsign, 'direction': direction, 'shape': shape, 'stops': variant_stops,
                'trips': [],
            }
        departure, times = stop_times(rows, trip_id)
        trip = {'id': trip_id, 'departure': departure, 'dates': date_indices[row['service_id']], 'stops': times}
        sequences = [int(call['stop_sequence']) for call in rows]
        if sequences != list(range(1, len(rows) + 1)):
            trip['stopSequences'] = sequences
        variants[key]['trips'].append(trip)
    for variant in variants.values():
        variant['trips'].sort(key=lambda trip: (trip['departure'], trip['id']))

    feed = next(read_table(archive, 'feed_info'), {})
    source = {'url': FEED_URL, 'publisher': feed.get('feed_publisher_name', 'OVapi')}
    if feed.get('feed_version'):
        source['feedVersion'] = feed['feed_version']
    if feed.get('feed_start_date'):
        source['feedStartDate'] = gtfs_date(feed['feed_start_date']).isoformat()
    licenses = [row for row in read_table(archive, 'licenses') if row['licensed_table_name'] in ('', 'shapes')]
    if licenses:
        source['licenses'] = {row['licensed_table_name'] or 'default': row['license_spdx_id'] for row in licenses}
    return {
        'source': source, 'firstDate': days[0].isoformat(), 'lastDate': days[-1].isoformat(),
        'services': [day.isoformat() for day in days], 'variants': list(variants.values()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('feed', type=Path, help='Local gtfs-nl.zip from OVapi')
    parser.add_argument('output', type=Path, help='Path for the extracted route, stop and service JSON')
    args = parser.parse_args()
    if args.feed.resolve() == args.output.resolve():
        parser.error('The feed ZIP and output JSON must have different paths')
    with ZipFile(args.feed) as archive:
        data = import_feed(archive, load_projection())
    args.output.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n',
                           encoding='utf-8')
    trips = sum(len(variant['trips']) for variant in data['variants'])
    print(f"{len(data['variants'])} Ede bus variants and {trips} trips from {data['firstDate']} to {data['lastDate']}")


if __name__ == '__main__':
    main()
