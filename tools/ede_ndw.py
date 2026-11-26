"""Filter public DATEX II v3 observations and traffic measures to the Ede road graph."""

import gzip
import math
from datetime import datetime
from urllib.request import urlopen
from xml.etree import ElementTree as ET

NDW = 'https://opendata.ndw.nu/'
CONFIG = 'snelheden_en_intensiteiten_configuratie_meetlocaties.xml.gz'
MEASUREMENTS = 'snelheden_en_intensiteiten_meetgegevens.xml.gz'
CLOSURES = 'tijdelijke_verkeersmaatregelen_afsluitingen.xml.gz'
TEMPORARY_SPEEDS = 'tijdelijke_verkeersmaatregelen_maximum_snelheden.xml.gz'
DRIP_MSI = 'dynamische_route_informatie_panelen.xml.gz'
XSI_TYPE = '{http://www.w3.org/2001/XMLSchema-instance}type'
# NDW supplies the start of the measured minute, which arrives several minutes later.
OBSERVATION_AGE_MS = 360_000
RESTRICTION_AGE_MS = 300_000
MSI_AGE_MS = 180_000
SPAT_AGE_MS = 30_000

MSI_VALID_LEGENDS = frozenset({
    'A01-50', 'A01-70', 'A01-80', 'A01-90', 'A01-100',
    'F01', 'F02-L', 'F02-R', 'F08', 'J33', 'BLANK',
})

SPAT_STATE_MAP = {
    'dark': 'DARK',
    'stop-And-Remain': 'STOP_AND_REMAIN',
    'STOP_AND_REMAIN': 'STOP_AND_REMAIN',
    'red': 'STOP_AND_REMAIN',
    'permissive-Movement-Allowed': 'PERMISSIVE_MOVEMENT_ALLOWED',
    'PERMISSIVE_MOVEMENT_ALLOWED': 'PERMISSIVE_MOVEMENT_ALLOWED',
    'protected-Movement-Allowed': 'PROTECTED_MOVEMENT_ALLOWED',
    'PROTECTED_MOVEMENT_ALLOWED': 'PROTECTED_MOVEMENT_ALLOWED',
    'green': 'PROTECTED_MOVEMENT_ALLOWED',
    'pre-Movement': 'PRE_MOVEMENT',
    'PRE_MOVEMENT': 'PRE_MOVEMENT',
    'stop-Then-Proceed': 'STOP_THEN_PROCEED',
    'STOP_THEN_PROCEED': 'STOP_THEN_PROCEED',
    'amber': 'STOP_THEN_PROCEED',
    'yellow': 'STOP_THEN_PROCEED',
    'caution-Conflicting-Traffic': 'FLASHING_AMBER',
    'FLASHING_AMBER': 'FLASHING_AMBER',
    'flashing-amber': 'FLASHING_AMBER',
}


class LimitedReader:
    def __init__(self, stream, limit):
        self.stream = stream
        self.remaining = limit

    def read(self, size):
        data = self.stream.read(min(size, self.remaining + 1))
        self.remaining -= len(data)
        if self.remaining < 0:
            raise ValueError('NDW XML exceeded the expected size')
        return data


def fetch_xml(filename, parse):
    with urlopen(NDW + filename, timeout=12) as response, gzip.GzipFile(fileobj=response) as stream:
        return parse(LimitedReader(stream, 256 * 1024 * 1024))


def records(stream, name, publication_type):
    stack = []
    matched_publication = False
    for event, element in ET.iterparse(stream, events=('start', 'end')):
        tag = element.tag.rsplit('}', 1)[-1]
        if event == 'start':
            stack.append(element)
            if tag == 'payload' and element.get(XSI_TYPE, '').split(':')[-1] == publication_type:
                matched_publication = True
            continue
        if matched_publication and tag in (name, 'publicationTime'):
            yield tag, element
            if len(stack) > 1:
                stack[-2].remove(element)
        if tag == 'situation' and len(stack) > 1:
            stack[-2].remove(element)
        stack.pop()
    if not matched_publication:
        raise ValueError(f'Unexpected NDW publication, expected {publication_type}')


def first(element, name):
    return None if element is None else element.find('.//{*}' + name)


def value(element, name):
    child = first(element, name)
    return None if child is None else child.text


def number(text):
    try:
        result = float(text)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def timestamp(text):
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
        return int(parsed.timestamp() * 1000) if parsed.tzinfo else None
    except (AttributeError, ValueError, OverflowError):
        return None


def read_sites(stream, graph):
    sites = {}
    south, west, north, east = graph.geographic_bounds
    for tag, site in records(stream, 'measurementSite', 'MeasurementSiteTablePublication'):
        if tag == 'publicationTime':
            continue
        position = first(site, 'pointByCoordinates')
        lat, lon = (number(value(position, field)) for field in ('latitude', 'longitude'))
        if lat is None or lon is None or not (south <= lat <= north and west <= lon <= east):
            continue
        site_id, version = site.get('id'), site.get('version')
        bearing = number(value(position, 'bearing'))
        heading = None if bearing is None else (math.sin(math.radians(bearing)), -math.cos(math.radians(bearing)))
        lane_count = number(value(site, 'measurementSiteNumberOfLanes'))
        location = first(site, 'measurementSiteLocation')
        carriageway = value(first(location, 'carriageway'), 'carriageway')
        layer = number(value(location, 'layer'))
        key = graph.detector(*graph.project(lon, lat), heading=heading, lane_count=lane_count,
                             carriageway=carriageway, layer=layer)
        if not key or not site_id or not version:
            continue
        characteristics = {}
        for characteristic in site.findall('{*}measurementSpecificCharacteristics'):
            if value(characteristic, 'vehicleType') != 'anyVehicle':
                continue
            metric = value(characteristic, 'specificMeasurementValueType')
            if metric in ('trafficFlow', 'trafficSpeed'):
                lane = value(characteristic, 'laneNumber')
                characteristics[characteristic.get('index')] = metric, lane
        if characteristics:
            sites[site_id, version] = key, lane_count, characteristics
    return sites


def site_metrics(measurement, lane_count, characteristics):
    flows, speeds = {}, {}
    for block in measurement.findall('{*}physicalQuantity'):
        metadata = characteristics.get(block.get('index'))
        if not metadata or value(block, 'dataError') == 'true':
            continue
        metric, lane = metadata
        if metric == 'trafficFlow':
            rate = number(value(block, 'vehicleFlowRate'))
            if rate is not None and 0 <= rate <= 30000:
                flows[lane] = rate
        else:
            speed = first(block, 'averageVehicleSpeed')
            kmh = number(value(speed, 'speed'))
            samples = number(speed.get('numberOfInputValuesUsed')) if speed is not None else None
            if kmh is not None and 0 < kmh < 255 and (samples is None or samples > 0):
                speeds[lane] = kmh, samples
    result = {}
    if None in flows:
        result['flowPerHour'] = flows[None]
    elif lane_count and len(flows) == lane_count:
        result['flowPerHour'] = sum(flows.values())
    if None in speeds:
        result['speedKmh'] = speeds[None][0]
    elif speeds:
        weighted = [(kmh, samples or flows.get(lane, 0)) for lane, (kmh, samples) in speeds.items()]
        weight = sum(samples for _, samples in weighted)
        if weight > 0:
            result['speedKmh'] = round(sum(kmh * samples for kmh, samples in weighted) / weight, 1)
        elif len(weighted) == 1:
            result['speedKmh'] = weighted[0][0]
    return result


def read_observations(stream, sites, now):
    by_edge = {}
    for tag, measurement in records(stream, 'siteMeasurements', 'MeasuredDataPublication'):
        if tag == 'publicationTime':
            continue
        ref = first(measurement, 'measurementSiteReference')
        match = None if ref is None else sites.get((ref.get('id'), ref.get('version')))
        if not match:
            continue
        observed = timestamp(value(first(measurement, 'measurementTimeDefault'), 'timeValue'))
        if observed is None or observed > now + 30_000 or observed + OBSERVATION_AGE_MS <= now:
            continue
        key, lanes, characteristics = match
        metrics = site_metrics(measurement, lanes, characteristics)
        if not metrics:
            continue
        rank = observed, lanes or 0, len(metrics), ref.get('id')
        record = dict(key=key, observedAt=observed, expiresAt=observed + OBSERVATION_AGE_MS, **metrics)
        if key not in by_edge or rank > by_edge[key][0]:
            by_edge[key] = rank, record
    return [by_edge[key][1] for key in sorted(by_edge)]


def shape_points(line, graph):
    if line.get('srsDimension', '2') != '2' or line.get('srsName', 'EPSG:4326') not in ('WGS 84', 'EPSG:4326'):
        return []
    positions = [number(part) for part in (value(line, 'posList') or '').split()]
    if len(positions) < 4 or len(positions) % 2 or None in positions:
        return []
    lat, lon = positions[::2], positions[1::2]
    if any(not -90 <= a <= 90 or not -180 <= b <= 180 for a, b in zip(lat, lon)):
        return []
    south, west, north, east = graph.geographic_bounds
    if max(lat) < south or min(lat) > north or max(lon) < west or min(lon) > east:
        return []
    if (lat[0], lon[0]) == (lat[-1], lon[-1]):
        return []
    return [graph.project(b, a) for a, b in zip(lat, lon)]


def restriction_effect(record, closure):
    if value(record, 'probabilityOfOccurrence') != 'certain' or value(record, 'operatorActionStatus') != 'implemented':
        return None
    if value(record, 'complianceOption') != 'mandatory' or first(record, 'forVehiclesWithCharacteristicsOf') is not None:
        return None
    if closure:
        kind = value(record, 'roadOrCarriagewayOrLaneManagementType')
        if kind in ('roadClosed', 'carriagewayClosures'):
            return {'closed': True}
        return None
    limit = number(value(record, 'temporarySpeedLimit'))
    if value(record, 'speedManagementType') == 'speedRestrictionInOperation' and limit is not None and 5 <= limit <= 130:
        return {'limitKmh': limit}
    return None


def read_restrictions(stream, graph, now, closure):
    result = {}
    published = None
    for tag, record in records(stream, 'situationRecord', 'SituationPublication'):
        if tag == 'publicationTime':
            published = timestamp(record.text)
            continue
        if published is None or published > now + 30_000 or published + RESTRICTION_AGE_MS <= now:
            continue
        effect = restriction_effect(record, closure)
        validity = first(record, 'validityTimeSpecification')
        if not effect or value(record, 'validityStatus') not in ('definedByValidityTimeSpec', 'active'):
            continue
        if validity is None or any(child.tag.rsplit('}', 1)[-1] not in ('overallStartTime', 'overallEndTime') for child in validity):
            continue
        start = timestamp(value(validity, 'overallStartTime'))
        end_text = value(validity, 'overallEndTime')
        end = timestamp(end_text) if end_text is not None else published + RESTRICTION_AGE_MS
        if end is None:
            continue
        expires = min(end, published + RESTRICTION_AGE_MS)
        if start is None or expires <= max(start, now):
            continue
        location = first(record, 'locationReference')
        if location is None:
            continue
        direction = value(location, 'alertCAffectedDirection')
        if direction not in (None, 'aligned', 'opposite', 'both'):
            continue
        keys = set()
        linear_locations = [location, *location.findall('.//{*}location')]
        for linear in linear_locations:
            line = linear.find('{*}gmlLineString')
            if line is None:
                continue
            points = shape_points(line, graph)
            if not points:
                continue
            lane_uses = [value(lane, 'laneUsage') for lane in linear.findall('.//{*}lane')]
            if any(use not in ('allLanesCompleteCarriageway', 'allLanesCompleteCarriageWay') for use in lane_uses):
                continue
            if first(linear, 'laneNumber') is not None:
                continue
            carriageway = value(first(linear, 'carriageway'), 'carriageway')
            layer = number(value(linear, 'layer'))
            keys.update(graph.match_line(points, both=direction == 'both', reverse=direction == 'opposite',
                                         layer=layer, carriageway=carriageway))
        for key in keys:
            record_key = key, start, expires, tuple(effect.items())
            result[record_key] = dict(key=key, startsAt=start, expiresAt=expires, **effect)
    return [result[key] for key in sorted(result)]


def normalize_msi_legend(code, direction=None):
    """Normalize raw NDW / RVV matrix sign codes to canonical legend identifiers."""
    if not code:
        return 'BLANK'
    raw = str(code).strip().upper().replace('_', '-').replace(' ', '-')
    if raw in ('BLANK', 'OFF', 'NONE', 'CLEAR', '0'):
        return 'BLANK'
    if raw in MSI_VALID_LEGENDS:
        return raw
    if raw in ('50', '70', '80', '90', '100'):
        return f'A01-{raw}'
    if raw.startswith('A1-'):
        candidate = 'A01-' + raw[3:]
        if candidate in MSI_VALID_LEGENDS:
            return candidate
    if raw in ('X', 'CROSS', 'LANE-CLOSED', 'RED-CROSS', 'F1'):
        return 'F01'
    if raw in ('F02', 'F2', 'MERGE', 'ARROW-LEFT', 'ARROW-RIGHT'):
        hint = str(direction or raw).upper()
        return 'F02-L' if 'LEFT' in hint or hint.endswith('-L') else 'F02-R'
    if raw in ('F8', 'END-RESTRICTIONS', 'ALL-CLEAR'):
        return 'F08'
    if raw in ('QUEUE', 'CONGESTION', 'FILE', 'TRAFFIC-JAM'):
        return 'J33'
    return 'BLANK'


def read_msi_signs(stream, now):
    """Parse DATEX II VmsPublication matrix sign legends with optional flashers."""
    published = None
    items = []
    for tag, element in records(stream, 'vmsUnit', 'VmsPublication'):
        if tag == 'publicationTime':
            published = timestamp(element.text)
            continue
        if published is None or published > now + 30_000 or published + MSI_AGE_MS <= now:
            continue
        unit_id = element.get('id') or value(first(element, 'vmsUnitReference'), 'id')
        if not unit_id:
            continue
        for vms in element.findall('.//{*}vms'):
            lane = number(value(vms, 'laneNumber'))
            pictogram = value(vms, 'pictogramDescription') or value(vms, 'vmsLegendCode') or value(vms, 'legendCode')
            direction = value(vms, 'pictogramDirection') or value(vms, 'direction')
            legend = normalize_msi_legend(pictogram, direction)
            flashing = value(vms, 'flashingBeacon') in ('true', '1') or legend in ('J33', 'F01', 'F02-L', 'F02-R')
            items.append({
                'gantryId': unit_id,
                'laneIndex': int(lane) if lane is not None and lane >= 1 else 1,
                'legend': legend,
                'flashers': bool(flashing),
                'observedAt': published,
                'expiresAt': published + MSI_AGE_MS,
            })
    return items


def read_spat_json(payload, now):
    """Parse NDW / Talking Traffic SPaT JSON into normalized VRI signal group states."""
    if not isinstance(payload, dict):
        return []
    intersections = payload.get('intersections') or payload.get('kruispunten') or []
    results = []
    for item in intersections:
        if not isinstance(item, dict):
            continue
        intersection_id = item.get('id') or item.get('kruispunt_id') or item.get('intersectionId')
        if not intersection_id:
            continue
        groups = []
        for sg in item.get('states') or item.get('signalGroups') or []:
            if not isinstance(sg, dict):
                continue
            sg_id = sg.get('signalGroupId') or sg.get('signalGroup') or sg.get('id')
            raw_state = sg.get('state') or sg.get('eventState')
            state = SPAT_STATE_MAP.get(str(raw_state), 'DARK')
            likely = number(sg.get('likelyTime') or sg.get('minEndTime'))
            groups.append({
                'signalGroupId': str(sg_id),
                'state': state,
                'likelyTime': likely,
            })
        if groups:
            results.append({
                'intersectionId': str(intersection_id),
                'observedAt': now,
                'expiresAt': now + SPAT_AGE_MS,
                'signalGroups': groups,
            })
    return results
