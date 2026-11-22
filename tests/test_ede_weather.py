"""Weather payload validation and shared cache behavior for the local server."""

import json
import sys
import unittest
from urllib.parse import parse_qs, urlsplit
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from ede_weather import FIELDS, FRESH_SECONDS, RETRY_SECONDS, LiveWeather, fetch_weather


class EdeWeatherTest(unittest.TestCase):
    def test_current_payload_is_validated_before_use(self):
        current = {key: 0 for key in FIELDS}
        current.update(time=1795042800, interval=900)
        with patch('ede_weather.urlopen', return_value=BytesIO(json.dumps({'current': current}).encode())):
            data = json.loads(fetch_weather())
        self.assertEqual(data['current'], current)
        self.assertGreater(data['fetchedAt'], 0)

        current['time'] = '2026-11-18T23:00'
        with patch('ede_weather.urlopen', return_value=BytesIO(json.dumps({'current': current}).encode())):
            with self.assertRaises(ValueError):
                fetch_weather()

    def test_requests_town_and_park_in_one_call_and_preserves_hub_fields(self):
        current = {key: 0 for key in FIELDS}
        current.update(time=1795042800, interval=900)
        park = dict(time=current['time'], wind_speed_80m=18.6, wind_speed_120m=19.5,
                    wind_direction_80m=351, wind_direction_120m=351)
        hourly = {'time': [current['time'] - 3600], 'temperature_2m': [-6.3]}
        with patch('ede_weather.urlopen', return_value=BytesIO(json.dumps([
            {'current': current, 'hourly': hourly}, {'current': park},
        ]).encode())) as request:
            data = json.loads(fetch_weather())
        args = parse_qs(urlsplit(request.call_args.args[0]).query)
        self.assertEqual(len(args['latitude'][0].split(',')), 2)
        self.assertIn('wind_speed_120m', args['current'][0].split(','))
        self.assertEqual(data['current'], current)
        self.assertEqual(data['parkWind'], park)
        self.assertEqual(args['hourly'], ['temperature_2m'])
        self.assertEqual(args['past_hours'], ['48'])
        self.assertEqual(data['hourly'], hourly)

    def test_shared_cache_refreshes_and_keeps_last_success_on_failure(self):
        with patch('ede_weather.fetch_weather', side_effect=[b'first', OSError('timeout'), b'second']) as fetch, \
             patch('ede_weather.time.monotonic', return_value=100) as clock:
            weather = LiveWeather(offline=False)
            fetch.assert_not_called()
            with ThreadPoolExecutor(max_workers=8) as pool:
                self.assertEqual(list(pool.map(lambda _: weather.snapshot(), range(8))), [b'first'] * 8)
            fetch.assert_called_once()

            clock.return_value += FRESH_SECONDS
            self.assertEqual(weather.snapshot(), b'first')
            self.assertEqual(weather.snapshot(), b'first')
            self.assertEqual(fetch.call_count, 2)

            clock.return_value += RETRY_SECONDS
            self.assertEqual(weather.snapshot(), b'second')
            self.assertEqual(fetch.call_count, 3)

    def test_no_success_and_offline(self):
        with patch('ede_weather.fetch_weather', side_effect=OSError('timeout')) as fetch:
            self.assertIsNone(LiveWeather(offline=True).snapshot())
            fetch.assert_not_called()
            self.assertIsNone(LiveWeather(offline=False).snapshot())
            fetch.assert_called_once()
