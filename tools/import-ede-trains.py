#!/usr/bin/env python3
"""Extract the Ede rail timetable from a local OVapi Dutch GTFS archive."""

import argparse
from collections import defaultdict
import json
from math import dist
from pathlib import Path
from runpy import run_path
from zipfile import ZipFile


GTFS = run_path(str(Path(__file__).with_name('import-ede-gtfs.py')))
read_table = GTFS['read_table']
service_dates = GTFS['service_dates']
time_seconds = GTFS['time_seconds']
gtfs_date = GTFS['gtfs_date']
load_projection = GTFS['load_projection']
FEED_URL = GTFS['FEED_URL']

STATION_KEYS = {
    'ut': 'utrecht-centraal',
    'utvr': 'utrecht-vaartsche-rijn',
    'bnk': 'bunnik',
    'db': 'driebergen-zeist',
    'mrn': 'maarn',
    'klp': 'de-klomp',
    'ed': 'ede-wageningen',
    'wf': 'wolfheze',
    'otb': 'oosterbeek',
    'ah': 'arnhem-centraal',
    'bnn': 'barneveld-noord',
    'bnc': 'barneveld-centrum',
    'bnz': 'barneveld-zuid',
    'ltn': 'lunteren',
    'edc': 'ede-centrum',
}
# The order runs east toward Arnhem and south toward Ede-Wageningen.
ROUTE_STATIONS = {
    'main': ('ut', 'utvr', 'bnk', 'db', 'mrn', 'klp', 'ed', 'wf', 'otb', 'ah'),
    'rs34': ('bnn', 'bnc', 'bnz', 'ltn', 'edc', 'ed'),
}
LOCAL_STATIONS = {'ed', 'edc'}
ANCHORS_PER_SIDE = 2


def rail_route(row):
    if row['route_type'] != '2':
        return None
    if row['agency_id'] in {'IFF:NS', 'IFF:NS_INT'}:
        return 'main', 'NS'
    if row['agency_id'].startswith('IFF:RRREIS') and row['route_short_name'] == 'RS34':
        return 'rs34', 'RRReis'
    return None


def nearby_calls(calls, station_order):
    local = [index for index, call in enumerate(calls) if call[0] in LOCAL_STATIONS]
    if local:
        return calls[max(0, local[0] - ANCHORS_PER_SIDE):local[-1] + ANCHORS_PER_SIDE + 1], False

    if 'edc' in station_order:
        return [], False
    ed = station_order.index('ed')
    sides = [station_order.index(call[0]) < ed for call in calls]
    if sides and sides[0] != sides[-1]:
        split = sides.index(sides[-1])
        return calls[max(0, split - ANCHORS_PER_SIDE):split + ANCHORS_PER_SIDE], True
    return [], False


def local_shapes(archive, shape_ids, project, station):
    found = set()
    if not shape_ids:
        return found
    # A scheduled Utrecht–Arnhem service can also reach Arnhem via Nijmegen.
    for point in read_table(archive, 'shapes', 'shape_id', shape_ids):
        if dist(project(point['shape_pt_lon'], point['shape_pt_lat']), station) < 350:
            found.add(point['shape_id'])
    return found


def import_feed(archive, project):
    station_rows = list(read_table(archive, 'stops'))
    parents = {row['stop_id']: row for row in station_rows
               if row['location_type'] == '1' and row['stop_code'] in STATION_KEYS}
    centers = {row['stop_code']: project(row['stop_lon'], row['stop_lat']) for row in parents.values()}
    stops = {stop_id: (row['stop_code'], '') for stop_id, row in parents.items()}
    for row in station_rows:
        parent = parents.get(row['parent_station'])
        if parent and row['location_type'] == '0' and row['stop_name'] == parent['stop_name']:
            stops[row['stop_id']] = parent['stop_code'], row.get('platform_code', '')

    routes = {}
    for row in read_table(archive, 'routes'):
        route = rail_route(row)
        if route:
            routes[row['route_id']] = route
    trips = {row['trip_id']: row for row in read_table(archive, 'trips', 'route_id', routes)}
    calls_by_trip = defaultdict(list)
    for row in read_table(archive, 'stop_times', 'trip_id', trips):
        if row['stop_id'] in stops:
            station, platform = stops[row['stop_id']]
            trip = trips[row['trip_id']]
            route, _ = routes[trip['route_id']]
            if station in ROUTE_STATIONS[route]:
                calls_by_trip[row['trip_id']].append((station, platform, row))

    selected = {}
    through = set()
    for trip_id, calls in calls_by_trip.items():
        trip = trips[trip_id]
        route, _ = routes[trip['route_id']]
        calls.sort(key=lambda call: int(call[2]['stop_sequence']))
        calls, requires_shape = nearby_calls(calls, ROUTE_STATIONS[route])
        if len(calls) >= 2:
            selected[trip_id] = calls
            if requires_shape:
                through.add(trip_id)

    shapes = local_shapes(archive, {trips[tid]['shape_id'] for tid in through}, project, centers['ed'])
    selected = {tid: calls for tid, calls in selected.items()
                if tid not in through or trips[tid]['shape_id'] in shapes}
    dates = service_dates(archive, {trips[tid]['service_id'] for tid in selected})
    days = sorted(set().union(*dates.values()))
    day_indices = {day: index for index, day in enumerate(days)}

    all_trips = []
    calendars = {}
    represented_days = defaultdict(set)
    used_stations = set()
    for trip_id, calls in sorted(selected.items()):
        trip = trips[trip_id]
        active = dates[trip['service_id']]
        if not active:
            continue
        route, operator = routes[trip['route_id']]
        if not trip['trip_short_name']:
            raise ValueError(f'Missing train number in trip {trip_id}')
        station_order = ROUTE_STATIONS[route]
        positions = [station_order.index(station) for station, _, _ in calls]
        if positions[0] == positions[-1]:
            continue
        direction = 1 if positions[0] < positions[-1] else -1
        # Split sub-platforms can have consecutive calls at the same station.
        if any(direction * (last - first) < 0 for first, last in zip(positions, positions[1:])):
            raise ValueError(f'Stations out of order in trip {trip_id}')

        trip_stops = []
        for station, platform, row in calls:
            arrival = time_seconds(row['arrival_time'])
            departure = time_seconds(row['departure_time'])
            if arrival > departure or (trip_stops and trip_stops[-1]['departure'] > arrival):
                raise ValueError(f'Times go backwards in trip {trip_id} at stop {row["stop_id"]}')
            stop = {'station': STATION_KEYS[station], 'arrival': arrival, 'departure': departure,
                    'sequence': int(row['stop_sequence']), 'stopId': row['stop_id']}
            if platform:
                stop['platform'] = platform
            trip_stops.append(stop)

        # Coupled services can share a train number and identical calls over this section.
        movement = (operator, route, direction, trip['trip_short_name'],
                    tuple((stop['stopId'], stop['arrival'], stop['departure']) for stop in trip_stops))
        active = active - represented_days[movement]
        if not active:
            continue
        represented_days[movement].update(active)
        used_stations.update(station for station, _, _ in calls)
        day_pattern = tuple(sorted(day_indices[day] for day in active))
        calendar = calendars.setdefault(day_pattern, len(calendars))
        all_trips.append({
            'operator': operator, 'number': trip['trip_short_name'], 'tripId': trip_id,
            'routeId': trip['route_id'], 'realtimeTripId': trip['realtime_trip_id'],
            'serviceType': trip['trip_long_name'], 'calendar': calendar,
            'route': route, 'direction': direction, 'stops': trip_stops,
        })

    if {trip['route'] for trip in all_trips} != ROUTE_STATIONS.keys():
        raise ValueError('Expected scheduled journeys on the NS main line and RRReis RS34')
    feed = next(read_table(archive, 'feed_info'), {})
    source = {'url': FEED_URL, 'publisher': feed.get('feed_publisher_name', 'OVapi')}
    if feed.get('feed_version'):
        source['feedVersion'] = feed['feed_version']
    for field, key in [('feed_start_date', 'feedStartDate'), ('feed_end_date', 'feedEndDate')]:
        if feed.get(field):
            source[key] = gtfs_date(feed[field]).isoformat()
    for row in read_table(archive, 'licenses'):
        if not row['licensed_table_name']:
            source['license'] = row['license_spdx_id']
    return {
        'version': 1, 'source': source,
        'stations': {STATION_KEYS[code]: centers[code] for code in STATION_KEYS if code in used_stations},
        'platforms': {sid: platform for sid, (code, platform) in stops.items()
                      if code in LOCAL_STATIONS and platform},
        'dates': [day.isoformat() for day in days],
        'calendars': list(calendars), 'trips': all_trips,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('feed', type=Path, help='Local gtfs-nl.zip from OVapi')
    parser.add_argument('output', type=Path, help='Path for the extracted rail timetable JSON')
    args = parser.parse_args()
    if args.feed.resolve() == args.output.resolve():
        parser.error('The feed ZIP and output JSON must have different paths')
    with ZipFile(args.feed) as archive:
        data = import_feed(archive, load_projection())
    args.output.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n',
                           encoding='utf-8')
    print(f"{len(data['trips'])} Ede rail trips from {data['dates'][0]} to {data['dates'][-1]}")


if __name__ == '__main__':
    main()
