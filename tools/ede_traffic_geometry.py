"""Project traffic source coordinates and match them to the simulator's directed graph."""

import json
import math
import subprocess
from collections import defaultdict
from pathlib import Path

from ede_scene import SceneAffine

TOOLS = Path(__file__).resolve().parent
CELL = 40


def load_graph(*, street_features=False):
    command = ['node', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', str(TOOLS / 'export-ede-traffic-graph.mjs')]
    if street_features:
        command.append('--street-features')
    result = subprocess.run(
        command,
        capture_output=True, check=True, timeout=15,
    )
    return RoadGraph(json.loads(result.stdout))


class Segment:
    def __init__(self, a, b, data):
        self.a, self.b = a, b
        dx, dz = (b[0] - a[0], b[1] - a[1])
        self.length = math.hypot(dx, dz)
        self.ux, self.uz = (dx / self.length, dz / self.length) if self.length else (0, 0)
        self.data = data

    def project(self, x, z):
        dx, dz = x - self.a[0], z - self.a[1]
        return dx * self.ux + dz * self.uz, abs(dx * self.uz - dz * self.ux)

    def samples(self):
        count = max(3, math.ceil(self.length / 7))
        for index in range(count):
            distance = self.length * (index + 0.5) / count
            yield self.a[0] + self.ux * distance, self.a[1] + self.uz * distance


class SegmentIndex:
    def __init__(self, segments, margin=10, bounds=None):
        self.cells = defaultdict(list)
        for segment in segments:
            if not segment.length:
                continue
            lo_x, hi_x = sorted((segment.a[0], segment.b[0]))
            lo_z, hi_z = sorted((segment.a[1], segment.b[1]))
            lo_x, lo_z, hi_x, hi_z = lo_x - margin, lo_z - margin, hi_x + margin, hi_z + margin
            if bounds:
                lo_x, lo_z = max(lo_x, bounds[0]), max(lo_z, bounds[1])
                hi_x, hi_z = min(hi_x, bounds[2]), min(hi_z, bounds[3])
            for col in range(math.floor(lo_x / CELL), math.floor(hi_x / CELL) + 1):
                for row in range(math.floor(lo_z / CELL), math.floor(hi_z / CELL) + 1):
                    self.cells[col, row].append(segment)

    def near(self, x, z):
        return self.cells.get((math.floor(x / CELL), math.floor(z / CELL)), ())


def normalize_name(name):
    return ''.join(character for character in (name or '').casefold() if character.isalnum())


def edge_level(edge):
    return edge['layer'], bool(edge['bridge']), bool(edge['tunnel'])


class RoadGraph:
    def __init__(self, payload):
        self.bounds = payload['bounds']
        self.geographic_bounds = payload['geographicBounds']
        self.affine = payload['lonLatAffine']
        self.frame = SceneAffine(self.affine)
        self.edges = [Segment(edge['a'], edge['b'], edge) for edge in payload['edges']]
        self.index = SegmentIndex(self.edges, margin=22)
        self.paths = [Segment(edge['a'], edge['b'], edge) for edge in payload.get('paths', ())]

    def project(self, lon, lat):
        return self.frame.lon_lat_to_scene(lon, lat)

    def point_matches(self, x, z, heading=None, lane_count=None, carriageway=None, layer=None):
        candidates = []
        for edge in self.index.near(x, z):
            data = edge.data
            if layer is not None and layer != data['layer']:
                continue
            if carriageway in ('entrySlipRoad', 'exitSlipRoad', 'connectingCarriageway') and not (data.get('kind') or '').endswith('_link'):
                continue
            if carriageway == 'mainCarriageway' and (data.get('kind') or '').endswith('_link'):
                continue
            if heading and edge.ux * heading[0] + edge.uz * heading[1] < 0.86:
                continue
            along, center = edge.project(x, z)
            if not 0 <= along <= edge.length or center > 13:
                continue
            # A detector can lie on the outer lane of a divided carriageway.
            right = -(x - edge.a[0]) * edge.uz + (z - edge.a[1]) * edge.ux
            lane = min(abs(right - offset) for offset in data['lanes'])
            score = center if data['oneway'] else min(center, lane + 2)
            if lane_count is not None and lane_count != len(data['lanes']):
                score += min(3, abs(lane_count - len(data['lanes'])))
            candidates.append((score, edge))
        candidates.sort(key=lambda item: (item[0], item[1].data['key']))
        return candidates

    def detector(self, x, z, heading=None, lane_count=None, carriageway=None, layer=None):
        candidates = self.point_matches(x, z, heading, lane_count, carriageway, layer)
        if not candidates or candidates[0][0] > (9 if heading else 7):
            return None
        score, best = candidates[0]
        for other_score, other in candidates[1:]:
            if other_score - score >= 3:
                break
            if other.data['way'] != best.data['way'] or best.ux * other.ux + best.uz * other.uz < 0.86:
                return None
        if heading is None and not best.data['oneway']:
            return None
        return best.data['key']

    def level_conflict(self, edge, x, z, separation, max_distance, source):
        for other in self.index.near(x, z):
            if edge_level(other.data) == edge_level(edge.data) or abs(edge.ux * other.ux + edge.uz * other.uz) < 0.86:
                continue
            along, distance = other.project(x, z)
            if not 0 <= along <= other.length or distance > max_distance:
                continue
            source_along, source_distance = source.project(other.a[0] + along * other.ux, other.a[1] + along * other.uz)
            if 0 <= source_along <= source.length and source_distance <= separation + 1.7:
                return True
        return False

    def match_line(self, points, *, both=False, reverse=False, layer=None, carriageway=None):
        if reverse:
            points = points[::-1]
        segments = [Segment(a, b, None) for a, b in zip(points, points[1:])]
        index = SegmentIndex(segments, bounds=self.bounds)
        candidates = dict.fromkeys(edge for cell in index.cells for edge in self.index.cells.get(cell, ()))
        result = []
        for edge in candidates:
            data = edge.data
            if layer is not None and layer != data['layer']:
                continue
            is_ramp = (data.get('kind') or '').endswith('_link')
            if carriageway == 'mainCarriageway' and is_ramp:
                continue
            if carriageway in ('entrySlipRoad', 'exitSlipRoad', 'connectingCarriageway') and not is_ramp:
                continue
            hits = 0
            count = 0
            for x, z in edge.samples():
                count += 1
                hits += any(self._line_hits(edge, source, x, z, both, layer) for source in index.near(x, z))
            if hits >= max(2, math.ceil(count * 0.75)):
                result.append(data['key'])
        return sorted(result)

    def _line_hits(self, edge, source, x, z, both, layer):
        dot = edge.ux * source.ux + edge.uz * source.uz
        along, distance = source.project(x, z)
        if (abs(dot) if both else dot) < 0.89 or not 0 <= along <= source.length or distance > 5:
            return False
        if layer is None and self.level_conflict(edge, x, z, distance, 8, source):
            return False
        # Decline closely parallel roads unless the reported line makes one clearly nearer.
        for other in self.index.near(x, z):
            if other.data['way'] == edge.data['way'] or (layer is not None and other.data['layer'] != layer):
                continue
            other_dot = other.ux * source.ux + other.uz * source.uz
            if (abs(other_dot) if both else other_dot) < 0.89:
                continue
            cross, gap = other.project(x, z)
            if gap > 7 or not 0 <= cross <= other.length:
                continue
            offset, separation = source.project(other.a[0] + other.ux * cross, other.a[1] + other.uz * cross)
            if 0 <= offset <= source.length and separation < distance + 1.25:
                return False
        return True
