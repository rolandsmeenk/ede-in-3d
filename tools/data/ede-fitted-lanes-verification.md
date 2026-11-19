# Ede carriageway fitting

The 2026-11-19 1GIS marking snapshot, 2026-11-18 BGT road surfaces and selected 2026 PDOK aerial traces feed an offline RD New bake. OSM supplies the direction, junctions, turn restrictions and lane access. NWB and WEGGEG corroborate motorway sections, counts and offsets. The existing NAP road and deck profiles still provide height, and the 12 m AHN grid still provides background terrain.

The compact asset stores each polyline against its original logical edge or junction station, with cumulative physical distance and local width. Traffic, generated paint, bus positioning and parking approaches sample the same geometry. Posted limits, crossings, signs, stop lines and other station-indexed references use their original keys and stations. The renderer retains the original surveyed 1GIS paint.

## Source alignment and fallback

| Check | Result |
| --- | --- |
| Published RDinfo geographic and RD values, 34 controls including the map edges | 16.3 mm mean, 31.4 mm maximum |
| Independent ETRS89 control | 0.13 mm |
| Export rounding on the controls | 0.37 mm mean, 0.69 mm maximum |
| Existing 1GIS paint export versus the pinned transform | 21.2 mm mean, 31.9 mm maximum over 16,786 vertices |
| Maanderbroek upper A30 divider, 59 comparable longitudinal samples | 0.232 m median, 1.715 m maximum lateral source disagreement |
| Maanderbroek eastbound A12 blocks, 39 comparable samples | 0.703 m median, 1.087 m maximum lateral source disagreement |

The last two rows compare georeferenced independent source features. The aerial pixels are georeferenced in RD from the raster transform. Manual tracing and which part of a marking is visible contribute to the feature comparisons. [Projection, controls and attribution](ede-gis-v1.md) · [Aerial pixels, review decisions and attribution](ede-lane-aerial-traces.json)

| Fitting outcome | Directed edges |
| --- | ---: |
| 1GIS markings | 292 |
| 1GIS and reviewed aerial trace | 2 |
| BGT motor pavement | 2,179 |
| BGT and reviewed aerial trace | 1 |
| Original geometry already aligned | 92 |
| Original geometry retained pending evidence or clearance | 6,637 |
| Total | 9,203 |

Published NWB/WEGGEG corroborates 238 accepted motorway edges. The asset is 957,297 compressed bytes and contains 2,818 lanes and 2,270 validated connectors. A second offline bake reproduced both the asset and review byte for byte. The largest accepted lateral change is 6.154 m. The common fallback reasons are intermittent or ambiguous cross-sections (4,234), and a swept footprint extending beyond the usable pavement (2,132). An additional 5,161 junction-pair checks required the original join or an earlier return to the original lane centre.

The offline footprint audit covers 4,698 edges with usable matching evidence. Of these, 2,447 original swept envelopes extended outside the mapped usable pavement, including mapped islands, cycle space and protected polygons. The updated network retains 2,079 such results, all on the original geometry. Every shipped fitted lane and connector cleared the offline footprint checks after millimetre rounding. The outside-envelope metric includes incomplete and conflicting pavement geometry. A physical curb needs corroboration from imagery or surveyed pavement. [Per-edge review and source IDs](ede-fitted-lanes.review.json.gz)

The existing traffic pool previously dropped directed motorway through routes from its town-loop selection. Cars and vans can now use legal lane transitions to a motorway clip endpoint or an existing town connection. This applies to 181 A12/A30 mainline edges and 233 motorway-link edges accessible to cars. The OSM directed edge roster remains at 9,203 and the browser still binds all 304 GTFS route slices. A12 east, A12 west and A30 north have existing graph ends near the map margin. An actor retires after passing the end of its lane. The west A12 end is about 500 m inside the rectangular map bounds, so its last modeled segment can end visibly when the camera is nearby.

## In-game route checks

| Site | Captured result |
| --- | --- |
| Maanderbroek | Paired actual tracks on the fitted upper A30 and ramp. All 100 fitted-run poses cleared same-level pavement. The A30 grade profile was available for all 44 on-edge height samples. The accepted eastbound A12 lane is plotted. Its actor track was captured in the baseline. |
| A12 exit 24 | Paired actual tracks on fitted ramp w469675212 and original eastbound mainline w723962252. All 100 fitted-run poses cleared the mapped motor surface. The accepted westbound mainline fit is shown in the overlay. |
| Akulaan | Paired tracks in the fitted turn pocket on w1156964960. The paired start positions moved about 1.5 m toward the mapped lane centre. All 50 fitted-run poses cleared the pavement and the bus-only lane retained its permission. |
| Nachtegaallaan | Paired tracks on the unmarked residential carriageway. All 50 fitted-run poses fit inside the mapped pavement alongside the separately mapped parking area. |
| Frans Halslaan | Paired tracks in the fitted direction on the upper bridge deck, w840619077. All 50 fitted-run poses cleared the same-level pavement and matched the fitted deck profile. |
| Albertstunnel | Paired tracks on the retained lower road. All 50 fitted-run poses lack enough level −1 BGT motor pavement for a lateral clearance verdict. |
| Kolkakkerweg | The earlier baseline capture confirmed the westbound sedan overlapping the north sidewalk near X −890 to −903, Z 860–862. The mapped footpath overlap persisted along 50 sampled baseline poses and reached 2.73 m² beyond the buffered motor surface. That direction retains its original geometry. The follow-up probe yielded no additional usable passes on that stretch. |

Across the fitted build's 400 captured sedan poses, 350 cleared same-level motor pavement and reviewed exclusion areas. The remaining 50 are the concealed Albertstunnel samples. The figures combine the PDOK aerial raster, same-level BGT pavement, 1GIS markings, reviewed traces, nominal lanes and actual sedan paths. [Aerial and overlay source notes](ede-lane-aerial.sources.md)

## Reproduce

Run the offline bake using the command in the README. Serve the checkout and open an isolated Chrome tab with remote debugging on port 9297. These commands record the same directed lane on each paired camera route, and drive a pooled sedan through the normal traffic update. The before view disables the fitted asset while keeping the same graph, traffic eligibility, time, weather and parking. The sample includes automatic steering, existing yielding, and collisions with other traffic.

```sh
node tools/verify-ede-fitted-lanes.mjs before
node tools/verify-ede-fitted-lanes.mjs after
uv run --python 3.12 --with pyproj==3.8.0 --with rasterio --with pillow --with 'shapely>=2.1' \
  python tools/render-ede-lane-overlays.py /tmp/ede-lane-evidence/before.json \
  /tmp/ede-lane-evidence/after.json --cache /tmp/ede-lane-aerial --out /tmp/ede-lane-evidence/overlays --fetch
```

## Paired performance

Chrome 152 on Apple Silicon, WebGPU, Fast preset, 1600 × 900. Two alternating repeats per option used the same seeded traffic, parking, midday camera paths and viewport. Startup is navigation to the first playable GPU frame. The startup figures are the midpoint of the two cold or two warm repeats. The route ranges cover both warm repeats of 75 sampled frames. Traffic CPU measures the full camera-local update, including bus, car, bike, pedestrian and parking activity.

| Startup | Fitted geometry off | Fitted geometry on |
| --- | ---: | ---: |
| Cold | 9.683 s | 9.818 s |
| Warm | 9.654 s | 9.743 s |

| Camera route | Frame p95 off → on | Traffic CPU p95 off → on |
| --- | ---: | ---: |
| Maanderbroek A12 east | 16.7–33.4 → 16.7–16.8 ms | 0.70–0.80 → 0.70 ms |
| Maanderbroek A30 | 16.7–16.8 → 16.7 ms | 0.60 → 0.60 ms |
| A12 exit 24 | 16.7–16.8 → 16.8 ms | 0.60–0.70 → 0.70–0.80 ms |
| Akulaan turn pocket | 16.7 → 16.7–16.8 ms | 0.70 → 0.70–0.80 ms |
| Nachtegaallaan | 16.7–16.8 → 16.8 ms | 0.50 → 0.50–0.60 ms |
| Frans Halslaan | 16.7–16.8 → 16.7 ms | 0.70 → 0.70–0.80 ms |
| Albertstunnel | 16.8 → 16.8 ms | 0.80–0.90 → 0.90 ms |

Median frame time was 16.7 ms at every site in both options. The highest traffic CPU p95 was 0.90 ms in both. At Akulaan, median draw calls were 2,168–2,173 off and 2,171–2,177 on. Median triangles were 10.544–10.548 million off and 10.548–10.559 million on. The startup stages show roughly 20–33 ms for the additional traffic initialization and 46–75 ms for generating curved paint. This comparison isolates the fitted geometry with motorway traffic enabled in both options. A later long-running headless capture session became unresponsive after repeated navigations. The targeted captures finished in a fresh browser. These timing results cover short paired runs.

```sh
EDE_BENCH_SCENARIOS=lane-fits EDE_BENCH_RUNS=2 EDE_BENCH_FRAMES=75 EDE_BENCH_TRAFFIC=active \
  node tools/benchmark-ede.mjs /tmp/ede-lane-evidence/paired.json http://127.0.0.1:8995 9297 \
  'perf=1&laneFits=off' 'perf=1&laneFits=on'
```
