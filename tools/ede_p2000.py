"""Reduce the public Municipality of Ede P2000 feed to recent simulator inputs."""

from email.utils import parsedate_to_datetime
from hashlib import blake2s
import re
import time
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
from xml.etree.ElementTree import fromstring
from zoneinfo import ZoneInfo


FEED_URL = 'https://112-nu.nl/regio/gemeente-ede/alles/0/rss'
MAX_BYTES = 128 * 1024
AMSTERDAM = ZoneInfo('Europe/Amsterdam')
SERVICES = {'AMB': 'ambulance', 'BRA': 'fire', 'POL': 'police'}
PLACES = {'ede', 'bennekom', 'de-klomp', 'deelen', 'ederveen', 'harskamp', 'hoenderloo', 'lunteren', 'otterlo', 'wekerom'}
STREET = re.compile(r"[^\W\d_]+(?:[-'][^\W\d_]+)*")
AMBULANCE_EXCLUSIONS = re.compile(
    r'\b(?:VWS|B[123]|opstellen bij (?:ambulance)?post|herpositioneren|paraatstelling|besteld vervoer)\b',
    re.IGNORECASE,
)
AMBULANCE_TRIP = re.compile(r'\brit(?:nummer)?\s*:?\s*(\d{4,10})\b', re.IGNORECASE)


def recent_p2000(published_at, now):
    return -5_000 <= now - published_at <= 600_000


def read_p2000_xml(xml, now):
    channel = fromstring(xml).find('channel')
    if channel is None:
        raise ValueError('P2000 RSS channel missing')

    alerts = {}
    for item in channel.findall('item'):
        service = SERVICES.get(item.findtext('category'))
        if service is None:
            continue
        message = item.findtext('title', '') + ' ' + item.findtext('description', '')
        if 'intrekken alarm' in message.lower() or (service == 'ambulance' and AMBULANCE_EXCLUSIONS.search(message)):
            continue
        try:
            link = urlsplit(item.findtext('link', ''))
            raw_time = item.findtext('pubDate', '')
            date = parsedate_to_datetime(raw_time)
            # 112-nu writes Dutch wall-clock times with a literal Z suffix.
            times = [date.replace(tzinfo=AMSTERDAM, fold=fold) for fold in (0, 1)] if raw_time.endswith(' Z') else [date]
            published_at = max(int(t.timestamp() * 1000) for t in times
                               if t.tzinfo and recent_p2000(int(t.timestamp() * 1000), now))
        except (ValueError, OverflowError, OSError):
            continue

        parts = link.path.strip('/').split('/')
        if (link.hostname != '112-nu.nl' or len(parts) not in (4, 5) or parts[0] != 'melding'
                or not parts[1].isascii() or not parts[1].isdigit() or parts[2] not in PLACES):
            continue
        trip = AMBULANCE_TRIP.search(message) if service == 'ambulance' else None
        key = f'trip:{trip[1]}' if trip else f'alert:{parts[1]}'
        alert_id = blake2s(key.encode(), digest_size=8).hexdigest()
        if alert_id in alerts and alerts[alert_id]['publishedAt'] <= published_at:
            continue
        alert = {'id': alert_id, 'service': service, 'place': parts[2], 'publishedAt': published_at}
        if len(parts) == 5:
            street = unquote(parts[3])
            if len(street) <= 70 and STREET.fullmatch(street):
                alert['street'] = street.replace('-', ' ').lower()
        alerts[alert_id] = alert
    return sorted(alerts.values(), key=lambda alert: alert['publishedAt'])


def read_p2000():
    request = Request(FEED_URL, headers={'Accept': 'application/rss+xml', 'User-Agent': 'Ede-in-3D'})
    with urlopen(request, timeout=8) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError('P2000 feed exceeds size limit')
    return read_p2000_xml(body, int(time.time() * 1000))
