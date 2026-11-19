"""Fetch and share current Open-Meteo conditions for Ede's Oude Kerk."""

import json
import math
import sys
import time
from http.client import HTTPException
from threading import Lock
from urllib.parse import urlencode
from urllib.request import urlopen

FIELDS = (
    'temperature_2m', 'weather_code', 'cloud_cover', 'rain', 'showers', 'snowfall',
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
)
URL = 'https://api.open-meteo.com/v1/forecast?' + urlencode({
    'latitude': 52.0460029, 'longitude': 5.671553,  # lonLatAffine in the Ede map asset
    'current': ','.join(FIELDS), 'timezone': 'GMT', 'timeformat': 'unixtime',
    'temperature_unit': 'celsius', 'wind_speed_unit': 'kmh', 'precipitation_unit': 'mm',
})
FRESH_SECONDS = 900
RETRY_SECONDS = 60


def fetch_weather():
    limit = 16 * 1024
    with urlopen(URL, timeout=5) as response:
        body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError('Open-Meteo response exceeded the expected size')
    data = json.loads(body)
    current = data.get('current') if isinstance(data, dict) else None
    if not isinstance(current, dict) or not all(
        type(current.get(key)) in (int, float) and math.isfinite(current[key])
        for key in ('time', 'interval', *FIELDS)
    ) or current['time'] <= 0 or current['interval'] <= 0:
        raise ValueError('Open-Meteo response has invalid current conditions')
    data['fetchedAt'] = int(time.time() * 1000)
    return json.dumps(data, allow_nan=False, separators=(',', ':')).encode()


class LiveWeather:
    def __init__(self, offline):
        self.offline = offline
        self.payload = None
        self.next_at = float('-inf')
        self.lock = Lock()

    def snapshot(self):
        if self.offline:
            return None
        with self.lock:
            if time.monotonic() >= self.next_at:
                try:
                    self.payload = fetch_weather()
                except (OSError, ValueError, OverflowError, HTTPException, RecursionError) as error:
                    print(f'weather feed unavailable: {error}', file=sys.stderr)
                    self.next_at = time.monotonic() + RETRY_SECONDS
                else:
                    self.next_at = time.monotonic() + FRESH_SECONDS
            return self.payload
