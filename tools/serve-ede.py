#!/usr/bin/env python3
"""Serve the local Ede simulator with optional same-origin traffic, train, parking and weather feeds."""

import argparse
import json
import sys
import time
from functools import partial
from http.client import HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from subprocess import SubprocessError
from threading import Thread
from urllib.parse import urlsplit
from xml.etree.ElementTree import ParseError

sys.dont_write_bytecode = True
from ede_ndw import CLOSURES, CONFIG, MEASUREMENTS, TEMPORARY_SPEEDS, fetch_xml, read_observations, read_restrictions, read_sites
from ede_live_parking import parking_readers, parking_snapshot
from ede_live_trains import TrainUpdates, ns_position_snapshots, train_snapshot
from ede_traffic_geometry import load_graph
from ede_weather import LiveWeather

ROOT = Path(__file__).resolve().parents[1]


def now_ms():
    return int(time.time() * 1000)


class LiveFeeds:
    def __init__(self, offline):
        self.data = {}
        if not offline:
            Thread(target=self.start_ndw, daemon=True).start()
            self.refresh('buses', 30, self.read_buses)
            self.refresh('trainUpdates', 60, TrainUpdates())
            Thread(target=self.start_ns_positions, daemon=True).start()
            for key, read in parking_readers():
                self.refresh(key, 60, read)

    def start_ns_positions(self):
        try:
            for records in ns_position_snapshots():
                self.data['trainGps'] = records
        except ImportError:
            print('NS GPS feed requires pyzmq', file=sys.stderr)

    @staticmethod
    def read_buses():
        from ede_live_buses import read_ede_bus_feed

        return read_ede_bus_feed()

    def start_ndw(self):
        try:
            graph = load_graph()
        except (OSError, SubprocessError, ValueError) as error:
            print(f'NDW road graph unavailable: {error}', file=sys.stderr)
            return

        sites, config_at = {}, float('-inf')

        def observations():
            nonlocal sites, config_at
            if time.monotonic() - config_at > 900:
                try:
                    sites = fetch_xml(CONFIG, partial(read_sites, graph=graph))
                    config_at = time.monotonic()
                except (OSError, ValueError, ParseError, EOFError, HTTPException):
                    if not sites:
                        raise
            return fetch_xml(MEASUREMENTS, lambda stream: read_observations(stream, sites, now_ms()))

        self.refresh('observations', 60, observations)
        self.refresh('closures', 60, lambda: fetch_xml(CLOSURES, lambda stream: read_restrictions(stream, graph, now_ms(), True)))
        self.refresh('speedLimits', 60, lambda: fetch_xml(TEMPORARY_SPEEDS, lambda stream: read_restrictions(stream, graph, now_ms(), False)))

    def refresh(self, key, seconds, read):
        def run():
            last_error = None
            while True:
                try:
                    self.data[key] = read()
                    last_error = None
                except (OSError, ValueError, ParseError, EOFError, HTTPException, ImportError) as error:
                    message = str(error)
                    if last_error != message:
                        print(f'{key} feed unavailable: {message}', file=sys.stderr)
                        last_error = message
                time.sleep(seconds)

        Thread(target=run, daemon=True).start()

    def trains_snapshot(self):
        return train_snapshot(self.data.copy(), time.time())

    def parking_snapshot(self):
        return parking_snapshot(self.data.copy(), time.time())

    def snapshot(self):
        now = now_ms()
        feeds = self.data.copy()
        snapshot = {
            'version': 1,
            'observations': [record for record in feeds.get('observations', ()) if record['expiresAt'] > now],
            'restrictions': [
                record for key in ('closures', 'speedLimits') for record in feeds.get(key, ()) if record['expiresAt'] > now
            ],
        }
        buses = feeds.get('buses')
        if buses and 0 <= now - buses['timestamp'] * 1000 < 120_000:
            snapshot['buses'] = buses
        return snapshot


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, feeds, weather, **kwargs):
        self.feeds = feeds
        self.weather = weather
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if urlsplit(self.path).path not in ('/api/ede-traffic', '/api/ede-trains', '/api/ede-parking', '/api/ede-weather'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        status = 200
        if path == '/api/ede-traffic':
            payload = json.dumps(self.feeds.snapshot(), allow_nan=False, separators=(',', ':')).encode()
        elif path == '/api/ede-trains':
            payload = json.dumps(self.feeds.trains_snapshot(), allow_nan=False, separators=(',', ':')).encode()
        elif path == '/api/ede-parking':
            payload = json.dumps(self.feeds.parking_snapshot(), allow_nan=False, separators=(',', ':')).encode()
        elif path == '/api/ede-weather':
            payload = self.weather.snapshot()
            if payload is None:
                status = 503
                payload = b'{"error":"Live weather unavailable"}'
        else:
            super().do_GET()
            return
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--offline', action='store_true', help='serve static assets without contacting traffic, train, parking or weather feeds')
    args = parser.parse_args()
    handler = partial(Handler, feeds=LiveFeeds(args.offline), weather=LiveWeather(args.offline))
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f'Open http://{args.bind}:{server.server_port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
