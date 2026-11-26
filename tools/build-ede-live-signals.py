#!/usr/bin/env python3
"""Build static A12/A30 MSI gantry lane mounts and Ede VRI intersection signal groups.

Produces `assets/ede-live-signals.json` in the local Oude Kerk scene frame
(EPSG:28992 coordinates with the local RD origin `(x0, y0)` subtracted).
"""

import argparse
import gzip
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / 'assets' / 'ede-live-signals.json'

# Oude Kerk Ede RD New (EPSG:28992) origin used by the local scene frame.
RD_ORIGIN_X = 174208.0
RD_ORIGIN_Y = 450425.0
SCENE_NAP_ORIGIN = 22.54

CORRIDOR_ZONES = (
    ('station-ede-wageningen', (-350, 1250, 450, 2100)),
    ('ede-centrum', (-650, -650, 650, 650)),
    ('kennisas-parklaan', (-1700, 1600, -100, 2700)),
    ('n224-arnhemseweg-rijksweg', (-4500, -350, 9500, 2900)),
    ('n781-bennekom-mansholtlaan', (-1900, 2700, -800, 6200)),
    ('lunteren-otterlo', (-4500, -9000, 9500, -1800)),
)


def rd_to_scene(rd_x, rd_y, origin_x=RD_ORIGIN_X, origin_y=RD_ORIGIN_Y):
    """Convert RD New (EPSG:28992) metres to local scene (x east, z south)."""
    return [round(rd_x - origin_x, 2), round(-(rd_y - origin_y), 2)]


def read_json(path):
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == '.gz' else data)


def classify_zone(x, z):
    for name, (min_x, min_z, max_x, max_z) in CORRIDOR_ZONES:
        if min_x <= x <= max_x and min_z <= z <= max_z:
            return name
    return 'ede-local'


def classify_motorway_exit(route, x, z):
    if route == 'A12':
        if x < -3200:
            return 'A12-23a-Veenendaal'
        if x < 500:
            return 'A12-24-Ede'
        return 'A12-25-Oosterbeek'
    if route == 'A30':
        if z > 1500:
            return 'A30-1-Maanderbroek'
        if z > -1500:
            return 'A30-2-Ede-Noord'
        return 'A30-3-Lunteren'
    return route or 'motorway'


def road_heading_at(road, x, z):
    pts = road.get('pts') or []
    coords = list(zip(pts[::2], pts[1::2]))
    if len(coords) < 2:
        return None
    if road.get('reverse'):
        coords.reverse()
    best_dist = math.inf
    best_dir = None
    for (ax, az), (bx, bz) in zip(coords, coords[1:]):
        dx, dz = bx - ax, bz - az
        seg_len = math.hypot(dx, dz)
        if seg_len < 1e-3:
            continue
        t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (seg_len * seg_len)))
        px, pz = ax + t * dx, az + t * dz
        d = math.hypot(x - px, z - pz)
        if d < best_dist:
            best_dist = d
            best_dir = (dx / seg_len, dz / seg_len)
    return best_dir


def lane_count_for_way(way_id, motorway_ways, road):
    osm_id = way_id[1:] if isinstance(way_id, str) and way_id.startswith('w') else str(way_id or '')
    entries = motorway_ways.get(osm_id) or []
    if entries:
        lanes = max(int(item.get('lanes') or 0) for item in entries)
        if lanes > 0:
            return min(lanes, 6)
    width = float(road.get('width') or 0) if road else 0.0
    if width >= 10.5:
        return 3
    if width >= 6.8:
        return 2
    return 2


def build_msi_gantries(detail_data, motorway_lanes, roads_by_id, street_features, signal_hardware):
    vri_gantry_ids = {
        s.get('existingId') for s in signal_hardware.get('supports', []) if s.get('existingId')
    }
    candidate_gantries = []
    for feature in detail_data.get('features', []):
        if feature.get('type') != 'gantry' or feature['id'] in vri_gantry_ids:
            continue
        pts = feature.get('points')
        if not isinstance(pts, list) or len(pts) != 2:
            continue
        (ax, az), (bx, bz) = pts
        span_len = math.hypot(bx - ax, bz - az)
        if span_len < 4.0:
            continue
        candidate_gantries.append((feature, ax, az, bx, bz, span_len, (bx - ax) / span_len, (bz - az) / span_len))

    # Match surveyed NDW overhead A3 (matrix sign) records to their exact 1GIS gantry spans.
    a3_signs = [
        s for s in street_features.get('signs', [])
        if s.get('rvvCode') == 'A3' and s.get('placement') == 'ABOVE' and not s.get('supplementarySigns')
    ]
    matched_by_gantry = defaultdict(list)
    replaced_sign_ids = []

    for sign in a3_signs:
        bearing = sign.get('bearing')
        if not isinstance(bearing, (int, float)):
            continue
        rad = math.radians(bearing)
        nx, nz = math.sin(rad), -math.cos(rad)
        sx, sz = float(sign['x']), float(sign['z'])
        best = None
        reach = 4.0
        for entry in candidate_gantries:
            feature, ax, az, _bx, _bz, span_len, ux, uz = entry
            if abs(nx * ux + nz * uz) > 0.65:
                continue
            along = (sx - ax) * ux + (sz - az) * uz
            if along < -1.5 or along > span_len + 1.5:
                continue
            clamped = max(0.0, min(span_len, along))
            tx, tz = ax + ux * clamped, az + uz * clamped
            dist = math.hypot(sx - tx, sz - tz)
            if dist < reach:
                reach = dist
                best = (feature, tx, tz, clamped, ux, uz, nx, nz)
        if best is None:
            continue
        feature, tx, tz, along, ux, uz, nx, nz = best
        matched_by_gantry[feature['id']].append((sign, tx, tz, along, nx, nz))
        replaced_sign_ids.append(sign['id'])

    gantry_by_id = {entry[0]['id']: entry for entry in candidate_gantries}
    gantries = []

    for gantry_id, items in matched_by_gantry.items():
        feature, ax, az, bx, bz, span_len, ux, uz = gantry_by_id[gantry_id]
        mx, mz = (ax + bx) * 0.5, (az + bz) * 0.5
        road_names = {s.get('roadName') or '' for s, *_ in items}
        route = feature.get('route')
        if route not in ('A12', 'A30'):
            if any('A12' in name for name in road_names):
                route = 'A12'
            elif any('A30' in name for name in road_names):
                route = 'A30'
            else:
                route = 'A12'

        # Group heads by carriageway direction (facing normal) so opposite carriageways on a shared portal
        # each number their lanes 1..N left-to-right from the approaching driver's perspective.
        by_dir = defaultdict(list)
        for sign, tx, tz, along, nx, nz in items:
            # Bucket facing direction into two sides of the gantry span.
            side = 1 if (nx * uz - nz * ux) >= 0 else -1
            by_dir[side].append((sign, tx, tz, along, nx, nz))

        beam_nap = feature.get('beamY')
        beam_y = round(beam_nap - SCENE_NAP_ORIGIN, 3) if isinstance(beam_nap, (int, float)) else None
        heads = []
        primary_yaw = None
        primary_way = feature.get('wayId')

        for side in sorted(by_dir):
            group_items = by_dir[side]
            # Snap head yaw cleanly to the gantry's perpendicular facing normal so housings sit flush on the truss.
            normal_x, normal_z = side * uz, -side * ux
            gantry_yaw = round(math.atan2(normal_x, normal_z), 5)
            # Order left-to-right from approaching driver's perspective.
            # Approaching driver travels in (-normal_x, -normal_z), so driver's right is (normal_z, -normal_x).
            right_x, right_z = normal_z, -normal_x
            dir_sign = 1.0 if (ux * right_x + uz * right_z) >= 0 else -1.0
            group_items.sort(key=lambda item: item[3] * dir_sign)

            for lane_idx, (sign, tx, tz, _along, _nx, _nz) in enumerate(group_items, start=1):
                if primary_yaw is None:
                    primary_yaw = gantry_yaw
                way_id = sign.get('renderWay') or primary_way
                heads.append({
                    'id': f"{gantry_id}:{'A' if side > 0 else 'B'}:L{lane_idx}",
                    'sourceSignId': sign['id'],
                    'laneIndex': lane_idx,
                    'wayId': way_id,
                    'x': round(tx, 2),
                    'z': round(tz, 2),
                    'yaw': gantry_yaw,
                })

        gantries.append({
            'id': gantry_id,
            'route': route,
            'exitZone': classify_motorway_exit(route, mx, mz),
            'wayId': primary_way,
            'nwbId': feature.get('nwbId'),
            'level': int(feature.get('level') or 0),
            'span': [[round(ax, 2), round(az, 2)], [round(bx, 2), round(bz, 2)]],
            'center': [round(mx, 2), round(mz, 2)],
            'beamY': beam_y,
            'yaw': primary_yaw or 0.0,
            'laneCount': len(heads),
            'heads': heads,
        })

    # Cluster any remaining unmatched overhead A3 signs (e.g. A12 east outside 1GIS portal coverage)
    # into synthesized overhead gantries so zero overhead matrix signs fall back to standalone poles.
    matched_ids = set(replaced_sign_ids)
    unmatched_above = [s for s in a3_signs if s['id'] not in matched_ids and isinstance(s.get('bearing'), (int, float))]
    syn_clusters = []
    for sign in unmatched_above:
        sx, sz = float(sign['x']), float(sign['z'])
        placed = False
        for cluster in syn_clusters:
            if math.hypot(sx - cluster[0]['x'], sz - cluster[0]['z']) < 22.0:
                cluster.append(sign)
                placed = True
                break
        if not placed:
            syn_clusters.append([sign])

    for idx, cluster in enumerate(syn_clusters, start=1):
        avg_nx = sum(math.sin(math.radians(s['bearing'])) for s in cluster) / len(cluster)
        avg_nz = sum(-math.cos(math.radians(s['bearing'])) for s in cluster) / len(cluster)
        nlen = math.hypot(avg_nx, avg_nz) or 1.0
        nx, nz = avg_nx / nlen, avg_nz / nlen
        # Span perpendicular to facing normal (driver's right direction).
        ux, uz = nz, -nx
        cx = sum(float(s['x']) for s in cluster) / len(cluster)
        cz = sum(float(s['z']) for s in cluster) / len(cluster)
        projected = sorted(((float(s['x']) - cx) * ux + (float(s['z']) - cz) * uz, s) for s in cluster)
        min_t = projected[0][0] - 3.6
        max_t = projected[-1][0] + 3.6
        ax, az = cx + ux * min_t, cz + uz * min_t
        bx, bz = cx + ux * max_t, cz + uz * max_t
        gantry_id = f'synthetic:msi-gantry:{idx}'
        gantry_yaw = round(math.atan2(nx, nz), 5)
        road_names = {s.get('roadName') or '' for s in cluster}
        route = 'A30' if any('A30' in name for name in road_names) else 'A12'
        heads = []
        for lane_idx, (t_val, sign) in enumerate(projected, start=1):
            replaced_sign_ids.append(sign['id'])
            heads.append({
                'id': f'{gantry_id}:A:L{lane_idx}',
                'sourceSignId': sign['id'],
                'laneIndex': lane_idx,
                'wayId': sign.get('renderWay'),
                'x': round(cx + ux * t_val, 2),
                'z': round(cz + uz * t_val, 2),
                'yaw': gantry_yaw,
            })
        gantries.append({
            'id': gantry_id,
            'route': route,
            'exitZone': classify_motorway_exit(route, cx, cz),
            'wayId': heads[0]['wayId'],
            'nwbId': None,
            'level': int(cluster[0].get('layer') or 0),
            'syntheticGantry': True,
            'span': [[round(ax, 2), round(az, 2)], [round(bx, 2), round(bz, 2)]],
            'center': [round(cx, 2), round(cz, 2)],
            'beamY': None,
            'yaw': gantry_yaw,
            'laneCount': len(heads),
            'heads': heads,
        })

    gantries.sort(key=lambda item: (item['route'], item['center'][0], item['center'][1], item['id']))
    replaced_sign_ids.sort()
    return gantries, replaced_sign_ids


def cluster_signals(signals, radius=42.0):
    clusters = []
    for signal in signals:
        x, z = float(signal['x']), float(signal['z'])
        matched = None
        best = radius
        for cluster in clusters:
            d = math.hypot(x - cluster['cx'], z - cluster['cz'])
            if d < best:
                best = d
                matched = cluster
        if matched is None:
            clusters.append({'cx': x, 'cz': z, 'signals': [signal]})
        else:
            matched['signals'].append(signal)
            n = len(matched['signals'])
            matched['cx'] = sum(s['x'] for s in matched['signals']) / n
            matched['cz'] = sum(s['z'] for s in matched['signals']) / n
    return clusters


def build_vri_intersections(map_data, signal_hardware):
    signals = map_data.get('signals') or []
    heads_by_anchor = defaultdict(list)
    for head in signal_hardware.get('heads', []):
        anchor = head.get('anchor')
        if isinstance(anchor, list) and len(anchor) == 2:
            heads_by_anchor[f'{anchor[0]}/{anchor[1]}'].append(head)
    supports = signal_hardware.get('supports', [])

    clusters = cluster_signals(signals, radius=44.0)
    intersections = []
    for index, cluster in enumerate(sorted(clusters, key=lambda c: (round(c['cx'], 1), round(c['cz'], 1))), start=1):
        cx, cz = round(cluster['cx'], 2), round(cluster['cz'], 2)
        zone = classify_zone(cx, cz)
        intersection_id = f'EDE-VRI-{index:03d}'
        approaches = []
        signal_groups = []
        sg_num = 1
        minor_junction = True

        for sig in cluster['signals']:
            anchor_key = f"{sig['x']}/{sig['z']}"
            surveyed = heads_by_anchor.get(anchor_key, [])
            if surveyed:
                by_way = defaultdict(list)
                for head in surveyed:
                    by_way[head.get('wayId') or anchor_key].append(head)
                for way_id, group_heads in by_way.items():
                    avg_heading = math.atan2(
                        sum(math.sin(h['heading']) for h in group_heads),
                        sum(math.cos(h['heading']) for h in group_heads),
                    )
                    # Group into N-S (axis 0) vs E-W (axis 1) conflict sets.
                    axis = 0 if abs(math.cos(avg_heading)) >= abs(math.sin(avg_heading)) else 1
                    has_overhead = any(h.get('mount') == 'overhead' for h in group_heads)
                    if has_overhead or len(group_heads) >= 2:
                        minor_junction = False
                    sg_id = f'SG-{sg_num:02d}'
                    sg_num += 1
                    arrows = sorted({h['arrow'] for h in group_heads if h.get('arrow')})
                    movement = arrows[0] if len(arrows) == 1 else 'all'
                    signal_groups.append({
                        'signalGroupId': sg_id,
                        'axis': axis,
                        'kind': 'motor',
                        'movement': movement,
                        'wayId': way_id,
                        'anchor': [sig['x'], sig['z']],
                        'heading': round(avg_heading, 5),
                        'headCount': len(group_heads),
                        'mount': 'overhead' if has_overhead else 'roadside',
                        'supports': sorted({
                            supports[h['support']]['kind']
                            for h in group_heads
                            if h.get('mount') == 'overhead' and isinstance(h.get('support'), int) and h['support'] < len(supports)
                        }),
                    })
                    approaches.append({
                        'signalGroupId': sg_id,
                        'wayId': way_id,
                        'stopLine': [round(sig['x'], 2), round(sig['z'], 2)],
                        'heading': round(avg_heading, 5),
                        'axis': axis,
                        'lanes': max(1, len(group_heads)),
                    })
            else:
                dx, dz = sig['x'] - cx, sig['z'] - cz
                heading = math.atan2(dx, dz) if math.hypot(dx, dz) > 0.5 else 0.0
                axis = 0 if abs(math.cos(heading)) >= abs(math.sin(heading)) else 1
                sg_id = f'SG-{sg_num:02d}'
                sg_num += 1
                signal_groups.append({
                    'signalGroupId': sg_id,
                    'axis': axis,
                    'kind': 'motor',
                    'movement': 'all',
                    'anchor': [sig['x'], sig['z']],
                    'heading': round(heading, 5),
                    'headCount': 1,
                    'mount': 'roadside',
                    'supports': [],
                })
                approaches.append({
                    'signalGroupId': sg_id,
                    'stopLine': [round(sig['x'], 2), round(sig['z'], 2)],
                    'heading': round(heading, 5),
                    'axis': axis,
                    'lanes': 1,
                })

        # Add pedestrian / cyclist (B06 / fiets) signal groups paired with each active axis.
        active_axes = sorted({sg['axis'] for sg in signal_groups})
        for axis in active_axes:
            signal_groups.append({
                'signalGroupId': f'SG-C{axis + 1}',
                'axis': axis,
                'kind': 'cyclist',
                'movement': 'straight',
                'headCount': 1,
                'mount': 'roadside',
                'supports': [],
            })
            signal_groups.append({
                'signalGroupId': f'SG-P{axis + 1}',
                'axis': axis,
                'kind': 'pedestrian',
                'movement': 'straight',
                'headCount': 1,
                'mount': 'roadside',
                'supports': [],
            })

        intersections.append({
            'id': intersection_id,
            'zone': zone,
            'center': [cx, cz],
            'minor': minor_junction and len(cluster['signals']) <= 2,
            'cycleSeconds': 60 if not minor_junction else 48,
            'offsetSeconds': (index * 7) % 60,
            'signalGroups': signal_groups,
            'approaches': approaches,
        })
    return intersections


def build_asset():
    detail_data = read_json(ROOT / 'assets' / 'ede-1gis-detail.json.gz')
    motorway_lanes = read_json(ROOT / 'assets' / 'ede-motorway-lanes.json')
    map_data = read_json(ROOT / 'assets' / 'ede-map-v1.json.gz')
    signal_hardware = read_json(ROOT / 'assets' / 'ede-signal-hardware.json')
    sf_gz = ROOT / 'assets' / 'ede-street-features.json.gz'
    street_features = read_json(sf_gz if sf_gz.exists() else ROOT / 'assets' / 'ede-street-features.json')
    roads_by_id = {road['id']: road for road in map_data.get('roads', [])}

    gantries, replaced_sign_ids = build_msi_gantries(
        detail_data, motorway_lanes, roads_by_id, street_features, signal_hardware
    )
    intersections = build_vri_intersections(map_data, signal_hardware)
    return {
        'version': 1,
        'crs': 'EPSG:28992-local',
        'rdOrigin': [RD_ORIGIN_X, RD_ORIGIN_Y],
        'napOrigin': SCENE_NAP_ORIGIN,
        'counts': {
            'msiGantries': len(gantries),
            'msiHeads': sum(len(g['heads']) for g in gantries),
            'replacedSigns': len(replaced_sign_ids),
            'vriIntersections': len(intersections),
            'vriSignalGroups': sum(len(i['signalGroups']) for i in intersections),
        },
        'replacedSignIds': replaced_sign_ids,
        'msiGantries': gantries,
        'vriIntersections': intersections,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    asset = build_asset()
    args.output.write_text(json.dumps(asset, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"Wrote {args.output}: {asset['counts']}")


if __name__ == '__main__':
    main()
