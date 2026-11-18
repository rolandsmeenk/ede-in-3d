#!/usr/bin/env python3
"""Extract metric wall observations from orthofacade output and reviewed Mapillary views."""

import argparse
import datetime as dt
import json
import math
import re
import struct
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PPM = 64


def read(path):
    return json.loads(Path(path).read_text())


def scene_frame():
    prefix = "export const EDE_DATA = "
    with (ROOT / "js/ede-geodata.js").open() as source:
        line = next(line for line in source if line.startswith(prefix))
    return json.loads(line[len(prefix):].strip().removesuffix(";"))["meta"]["lonLatAffine"]


def project(frame, lonlat):
    lon, lat = lonlat
    return np.array([(lon - frame["lon0"]) * frame["x"][1], (lat - frame["lat0"]) * frame["z"][2]])


class Ground:
    def __init__(self):
        terrain = (ROOT / "assets/ede-ahn.bin").read_bytes()
        magic, width, height, self.x, self.z, self.step, self.datum = struct.unpack_from("<4sIIffff", terrain)
        if magic != b"AHN1":
            raise ValueError("Unexpected AHN format")
        self.values = np.frombuffer(terrain, dtype="<i2", offset=28).reshape(height, width)

    def at(self, x, z):
        cx, cz = (x - self.x) / self.step, (z - self.z) / self.step
        i, j = math.floor(cz), math.floor(cx)
        if not (0 <= i < len(self.values) - 1 and 0 <= j < self.values.shape[1] - 1):
            raise ValueError("Camera outside the AHN raster")
        u, v = cx - j, cz - i
        (a, b), (c, d) = self.values[i:i+2, j:j+2].astype(float)
        if u + v <= 1:
            height = a + (b - a) * u + (c - a) * v
        else:
            height = d + (c - d) * (1 - u) + (b - d) * (1 - v)
        return height / 100 - self.datum


def load_metadata(files):
    result = {}
    for file in files:
        data = read(file)
        records = data if isinstance(data, list) else data.get("panos", data.get("data", []))
        for record in records:
            key = str(record["id"])
            result[key] = {**result.get(key, {}), **record}
    return result


def source_info(meta, confidence):
    when = dt.datetime.fromtimestamp(meta["captured_at"] / 1000, dt.timezone.utc)
    creator = (meta.get("creator") or {}).get("username")
    result = {"imageId": str(meta["id"]), "capturedAt": when.date().isoformat(), "confidence": round(confidence, 3)}
    if creator:
        result["creator"] = creator
    return result


def rectification(image, meta, wall, frame, terrain, bounds, correction=None):
    # Inverse-map output texels from the BAG plane through the calibrated Mapillary
    # camera, following orthofacade's ENU and OpenSfM world-to-camera conventions.
    correction = correction or {}
    if "corners" in correction:
        # Reviewed controls are source pixels for TL, TR, BR, BL of the metric crop.
        corners = np.asarray(correction["corners"], dtype=np.float32)
        if corners.shape != (4, 2) or not np.isfinite(corners).all() or abs(cv2.contourArea(corners)) < 25:
            raise ValueError("Expected four separated source pixels around the wall crop")
    x0, y0, x1, y1 = bounds
    width, height = round((x1 - x0) * PPM), round((y1 - y0) * PPM)
    if not (2 <= width <= 8192 and 2 <= height <= 4096):
        raise ValueError("Unexpected wall crop size")
    if "corners" in correction:
        dst = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
        matrix = cv2.getPerspectiveTransform(corners, dst)
        rgb = cv2.warpPerspective(image, matrix, (width, height))
        mask = cv2.warpPerspective(np.full(image.shape[:2], 255, dtype=np.uint8), matrix, (width, height))
        return np.dstack((rgb, mask))

    use_gps = correction.get("gps", False)
    geometry = meta.get("geometry") if use_gps else meta.get("computed_geometry") or meta.get("geometry")
    camera_x, camera_z = project(frame, geometry["coordinates"])
    dx, dz = correction.get("shift", (0, 0))
    camera_y = terrain.at(camera_x, camera_z) + correction.get("cameraHeight", 1.8)
    camera_x += dx
    camera_z += dz
    x, y = np.meshgrid(x0 + (np.arange(width) + .5) / PPM, y1 - (np.arange(height) + .5) / PPM)
    a, b = np.asarray(wall["a"]), np.asarray(wall["b"])
    u = (b - a) / np.linalg.norm(b - a)
    wall_x = a[0] + x*u[0]
    wall_z = a[1] + x*u[1]
    rays = np.stack((wall_x-camera_x, camera_z-wall_z, wall["minY"] + y - camera_y), axis=-1)
    axes, _ = cv2.Rodrigues(np.asarray(meta["computed_rotation"], dtype=float))
    rx, ry, rz = np.moveaxis(rays @ axes.T, -1, 0)
    hh, ww = image.shape[:2]
    spherical = meta.get("is_pano") or meta.get("camera_type") == "spherical"
    if spherical:
        sx = (0.5 + np.arctan2(rx, rz) / (2*np.pi)) * ww - .5
        vertical = np.clip(ry / np.maximum(np.linalg.norm(rays, axis=-1), 1e-9), -1., 1.)
        sy = (0.5 + np.arcsin(vertical) / np.pi) * hh - .5
        visible = np.ones(sx.shape, dtype=bool)
    elif meta.get("camera_type") == "perspective":
        focal, k1, k2 = meta["camera_parameters"][:3]
        px, py = rx / np.maximum(rz, .01), ry / np.maximum(rz, .01)
        r2 = px*px + py*py
        scale = max(ww, hh) * focal * (1 + k1*r2 + k2*r2*r2)
        sx, sy = (ww-1)/2 + px*scale, (hh-1)/2 + py*scale
        visible = (rz > .01) & (sx >= 0) & (sx < ww-1) & (sy >= 0) & (sy < hh-1)
    else:
        raise ValueError("Unsupported Mapillary camera model; use reviewed planar controls")
    rgb = cv2.remap(image, sx.astype(np.float32), sy.astype(np.float32), cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_WRAP if spherical else cv2.BORDER_CONSTANT)
    return np.dstack((rgb, visible.astype(np.uint8)*255))


def wall_color(patches):
    values = np.concatenate([p.reshape(-1, 3) for p in patches]) if patches else np.empty((0, 3))
    # Use the bright-middle tones of unobstructed masonry, excluding deep shadows
    # and highlights. Samples are taken from masonry masks or reviewed masonry only.
    if len(values) < 9:
        return None
    lum = values @ [.2126, .7152, .0722]
    low, high = np.percentile(lum, [45, 90])
    good = values[(lum >= low) & (lum <= high) & (lum > 16) & (lum < 244)]
    if len(good) < 5:
        return None
    r, g, b = np.round(np.median(good, axis=0)).astype(int)
    return f"#{r:02x}{g:02x}{b:02x}"


def adjust_exposure(rgb, stops):
    if not -2 <= stops <= 3:
        raise ValueError("Reviewed exposure adjustment must be within -2 to 3 stops")
    if not stops:
        return rgb
    srgb = rgb / 255.
    linear = np.where(srgb < .04045, srgb / 12.92, ((srgb+.055)/1.055)**2.4)
    linear = np.clip(linear*(2**stops), 0., 1.)
    return 255*np.where(linear < .0031308, 12.92*linear, 1.055*linear**(1/2.4)-.055)


def match_wall(record, candidates, frame):
    a = project(frame, record["a_lonlat"])
    b = project(frame, record["b_lonlat"])
    length = np.linalg.norm(b-a)
    if length < 1:
        return None
    direction = (b-a) / length
    options = []
    for wall in candidates:
        if wall["wallType"] == "shared" or wall.get("baseOffset", 0) > .75:
            continue
        w0, w1 = np.array(wall["a"]), np.array(wall["b"])
        target_width = np.linalg.norm(w1-w0)
        if target_width < 1:
            continue
        unit = (w1-w0) / target_width
        normal = np.array([-unit[1], unit[0]])
        s0, s1 = (a-w0) @ unit, (b-w0) @ unit
        offset = max(abs((a-w0) @ normal), abs((b-w0) @ normal))
        overlap = min(max(s0, s1), target_width) - max(min(s0, s1), 0)
        if abs(unit @ direction) < .985 or offset > 1 or overlap < .64*min(target_width, length):
            continue
        options.append((offset + .5*(1-overlap/max(target_width, length)), wall, s0, (s1-s0)/length))
    options.sort(key=lambda option: option[0])
    if not options:
        return None
    if len(options) > 1 and options[1][1]["bagId"] != options[0][1]["bagId"] and options[1][0]-options[0][0] < .2:
        return None
    return options[0][1:]


def clip_opening(kind, x0, y0, x1, y1, wall, **detail):
    x0, x1 = max(0., min(x0,x1)), min(wall["width"], max(x0,x1))
    y0, y1 = max(0., y0), min(wall["height"], y1)
    if x1-x0 < .24 or y1-y0 < .25:
        return None
    return {"kind":kind, "x":round(float(x0), 3), "y":round(float(y0), 3),
            "width":round(float(x1-x0), 3), "height":round(float(y1-y0), 3), **detail}


def storey_spacing(openings):
    heights = sorted(o["y"] + o["height"]/2 for o in openings if o["kind"] == "window")
    rows = []
    for height in heights:
        if not rows or height - rows[-1] > .4:
            rows.append(height)
    spacing = [b-a for a,b in zip(rows, rows[1:]) if 1.9 <= b-a <= 4.5]
    return round(float(np.median(spacing)), 2) if spacing else None


def observation(wall, confidence, sources, color=None, openings=(), **extra):
    result = {"bagId":wall["bagId"], "wallId":wall["wallId"], "confidence":round(confidence, 3), "sources":sources, **extra}
    if color:
        result["wallColor"] = color
    if openings:
        result["openings"] = openings
        spacing = storey_spacing(openings)
        if spacing:
            result["storeySpacing"] = spacing
    return result


def from_orthofacade(run, by_osm, walls, frame, metadata, omit):
    for file in sorted((run / "facades").glob("*.json")):
        building = read(file)
        candidates = by_osm.get("w" + str(building["osm_id"]), walls)
        for record in building.get("walls", []):
            if record.get("tier") not in {"A","B"} or record.get("unknown_share", 1) > .35 or record["confidence"] < .62:
                continue
            hit = match_wall(record, candidates, frame)
            if hit is None:
                continue
            wall, shift, scale = hit
            if (wall["bagId"], wall["wallId"]) in omit:
                continue
            sources = [source_info(metadata[view["pano"]], min(record["confidence"], .82))
                       for view in record["views"] if view["pano"] in metadata and metadata[view["pano"]].get("captured_at")]
            if not sources or not record.get("png"):
                continue
            grid_path = run / "texture" / "blocks" / record["png"]
            grid = cv2.imread(str(grid_path), cv2.IMREAD_UNCHANGED)
            if grid is None or grid.ndim != 3 or grid.shape[2] != 4:
                continue
            alpha = grid[:, :, 3]
            masonry = grid[alpha == 255, :3][:, ::-1].astype(float)
            if not len(masonry):
                continue
            red, green, blue = masonry.T
            sky = (blue - red > 23) & (blue - green > 12) & (blue > 135)
            foliage = (green - red > 16) & (green - blue > 17)
            if np.mean(sky | foliage) > .2:
                continue
            color = wall_color([masonry[~(sky | foliage)]])
            openings = []
            x_start = record["extent"]["s_l"]
            for code, kind in [(192, "window"), (128, "door")]:
                count, _, stats, _ = cv2.connectedComponentsWithStats((alpha==code).astype(np.uint8), connectivity=4)
                for x,y,w,h, area in stats[1:count]:
                    if area < .62*w*h or (kind=="door" and y+h < len(alpha)-1):
                        continue
                    opening = clip_opening(kind, shift + scale*(x_start+x), len(alpha)-y-h,
                                           shift + scale*(x_start+x+w), len(alpha)-y, wall)
                    if opening:
                        openings.append(opening)
            # Upstream labels are one-metre blocks. Keep only measured-within-a-metre
            # proposals, leaving frames/sills and complex ground floors to reviews.
            if color or openings:
                yield observation(wall, min(record["confidence"], .78), sources, color, openings)


def rect_slice(rect, bounds):
    x, y, width, height = rect
    left, top = round((x-bounds[0])*PPM), round((bounds[3]-y-height)*PPM)
    return slice(top, top+round(height*PPM)), slice(left, left+round(width*PPM))


def reviewed_observation(review, wall, metadata, frames, frame, terrain, crops):
    views = []
    for spec in review["views"]:
        image_id = str(spec["imageId"])
        meta = metadata[image_id]
        paths = [frames / (image_id + ending) for ending in (".jpg", "_2048.jpg", ".png")]
        image_path = next((path for path in paths if path.is_file()), None)
        if image_path is None:
            raise ValueError(f"No local image for Mapillary {image_id}")
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Unreadable image {image_path}")
        bounds = spec["bounds"]
        if len(bounds) != 4 or not (0 <= bounds[0] < bounds[2] <= wall["width"] + .05 and
                                    0 <= bounds[1] < bounds[3] <= wall["height"] + .05):
            raise ValueError(f"Crop outside BAG wall {wall['wallId']}")
        rectified = rectification(image[:,:,::-1], meta, wall, frame, terrain, bounds, spec)
        views.append((spec, meta, rectified))
        if crops:
            cv2.imwrite(str(crops / f"{image_id}-{abs(round(wall['a'][0]*100))}-{abs(round(wall['a'][1]*100))}.png"),
                        rectified[:,:,[2,1,0,3]])
            photo = spec.get("photo")
            if photo:
                name, rect = photo["name"], photo["rect"]
                x, y, width, height = rect
                if not re.fullmatch(r"[a-z0-9-]+\.png", name) or not (
                    width > 0 and height > 0 and bounds[0] <= x < x+width <= bounds[2]
                    and bounds[1] <= y < y+height <= bounds[3]
                ):
                    raise ValueError(f"Invalid photo export on {wall['wallId']}")
                detail = rectified[rect_slice(rect, bounds)]
                if not cv2.imwrite(str(crops/name), detail[:,:,[2,1,0,3]]):
                    raise ValueError(f"Could not write {name}")
    patches = []
    for spec, _, rectified in views:
        for rect in spec.get("masonry", []):
            patch = rectified[rect_slice(rect, spec["bounds"])]
            if patch.size:
                patches.append(adjust_exposure(patch[patch[:,:,3]>=250,:3], spec.get("exposureStops", 0)))
    sources = [source_info(meta, spec.get("confidence", review["confidence"])) for spec, meta, _ in views]
    openings = []
    for opening in review.get("openings", []):
        kind = opening["kind"]
        x, y, w, h = (opening[name] for name in ("x","y","width","height"))
        details = {key:opening[key] for key in ("frame","sill") if key in opening}
        rect = clip_opening(kind, x, y, x+w, y+h, wall, **details)
        if rect:
            openings.append(rect)
    extra = {key:review[key] for key in ("detail","roofColor") if key in review}
    return observation(wall, review["confidence"], sources, wall_color(patches), openings, **extra)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("walls", type=Path, help="BAG wall catalogue")
    parser.add_argument("--orthofacade", type=Path, action="append", default=[], help="Repeatable upstream out/RUN directory")
    parser.add_argument("--metadata", type=Path, action="append", required=True, help="Local Mapillary image metadata or upstream panos.json")
    parser.add_argument("--review", type=Path, help="Optional reviewed metric crops and opening annotations")
    parser.add_argument("--images", type=Path, help="Local image directory for reviewed views")
    parser.add_argument("--crops", type=Path, help="Optional local diagnostic crop output directory")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    walls = read(args.walls)["walls"]
    by_id = {(wall["bagId"],wall["wallId"]):wall for wall in walls}
    by_osm = {}
    for wall in walls:
        if wall.get("osmId"):
            by_osm.setdefault(wall["osmId"], []).append(wall)
    frame = scene_frame()
    metadata = load_metadata(args.metadata)
    reviewed = read(args.review)["reviews"] if args.review else []
    omit = {(review["bagId"],review["wallId"]) for review in reviewed}
    observations = [obs for run in args.orthofacade for obs in from_orthofacade(run, by_osm, walls, frame, metadata, omit)]
    if reviewed:
        if not args.images:
            parser.error("--review requires --images")
        if args.crops:
            args.crops.mkdir(parents=True, exist_ok=True)
        terrain = Ground()
        observations.extend(reviewed_observation(r,by_id[(r["bagId"],r["wallId"])],metadata,args.images,frame,terrain,args.crops)
                            for r in reviewed)
    if not observations:
        raise SystemExit("No usable wall observations in these inputs")
    observations.sort(key=lambda o: (o["bagId"],o["wallId"],-o["confidence"]))
    tmp = args.output.with_suffix(args.output.suffix + ".tmp")
    tmp.write_text(json.dumps({"version":1,"observations":observations},indent=2)+"\n")
    tmp.replace(args.output)
    print(f"{len(observations)} observations on {len({o['bagId'] for o in observations})} BAG buildings")

if __name__ == "__main__":
    main()
