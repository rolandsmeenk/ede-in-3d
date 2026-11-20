# Targeted native AHN elevation pilot

The source survey uses native 0.5 m PDOK DTM and DSM GeoTIFFs in RD New (EPSG:28992) with heights in NAP. Each cached site uses a 360 × 360 m window on the native raster grid. The import checks the pixel size, projection and extent. The town-wide runtime grid stays at 12 m and the Oude Kerk datum stays at 22.54 m NAP. [PDOK AHN service](https://www.pdok.nl/ogc-webservices/-/article/actueel-hoogtebestand-nederland-ahn)

The pilot measurements and benchmarks below describe the original release. The pinned-coordinate refresh retained the same base and rebuilt the station footway lift and its coarse terrain inputs. [Pinned raster and tree verification](ede-raster-tree-gis-verification.md)

## Elevation checks

| Site | Retained correction | Outstanding measurement |
| --- | --- | --- |
| Bospoorttunnel | The north walking and cycling ramp follows the exposed DTM and DSM down from the previous OSM node. The revised profile uses 63 points for the full ramp and passage, down from 68. Across 40 native check samples, mean absolute error fell from 0.597 to 0.022 m. The upper routes and the existing concealed profile meet the revised slope. A detached house near the approach shares one measured base at 22.74 m NAP in the OSM fallback, collision model and 3DBAG. | Survey the concealed floor and soffit, which still use an estimated 2.10 m clearance, and verify the house's actual door threshold. |
| Stadspoort | Both southern Doctor Willem Dreeslaan carriageways follow exposed native pavement and meet the adjacent Frans Halslaan approaches at shared XYZ points. Across 13 samples per carriageway, mean error fell from 0.223 to 0.012 m southbound and from 0.104 to 0.011 m northbound. | Check the concealed soffits and the shopping walkway by field survey. The shopping building's perimeter ground varies by 5.60 m between its 10th and 90th percentiles, so it needs separate entrance and structural measurements before applying a building base. |
| Ede-Wageningen | An exposed footway east of the station on OSM way `w652044681` has six elevation knots over 11 m. The lift peaks at 0.40 m and tapers to meet the ground at both ends and at the shoulders. Median absolute error fell from 0.378 to 0.231 m. The footway and adjacent BGT shoulder share the same fit with player and traffic contact. | Survey the passenger tunnel landings, concealed floors and soffits, garage entrances, and building thresholds. The station DTM and DSM include roof and apron returns and samples inconsistent with the newer construction. Keep the measured ProRail track profiles as the rail reference. |
| Raadhuisstraat | Both carriageways retain the mapped 4.2 m clearance in the Stadhuis passage. Exposed approach residuals were approximately 0.00–0.17 m in the usable DTM samples. | The exterior ground spans 4.85 m between its 10th and 90th percentiles. The DSM samples the roof and the DTM has gaps under it. Survey the actual opening, its columns, underside and door thresholds before changing the Stadhuis model. |

For the Bospoort house, OSM footprint `w271586543` overlaps BAG `0228100000073270` by 99.5% of their union. Exterior sample rings had 25 and 37 points after rejecting obstructed returns, with 10th-to-90th percentile spreads of 0.02 m and 0.14 m. The fallback moved down 0.13 m and the published BAG mesh moved up 0.04 m to the shared base. The BAG check found the same translation at all 480 vertices for that building. Measured heights around the existing ground mesh support the base. Parked-space inventory checks found zero bays in the corrected travel corridors, and the station shoulder lift ends outside both Frisopark lanes and their tyre paths.

## Performance release check

The baseline was commit `188e1ff` on Apple M4 Pro in Chrome WebGPU at 1600 × 900. After three baseline runs, two paired runs alternated the baseline and the same commit with the elevation and teleport changes. Cold runs clear the HTTP cache and share the GPU driver cache. V8 peak memory is the sampled JavaScript heap plus backing storage. The final drive traveled 14.50 m in every run.

| Measure | Baseline range | Revised range |
| --- | ---: | ---: |
| Cold to first playable frame | 9.15–9.24 s | 9.20–9.28 s |
| Warm to first playable frame | 9.18–9.32 s | 9.06–9.18 s |
| Peak V8 memory at cold startup | 2.204–2.224 GB | 2.205–2.208 GB |
| Peak V8 memory during warm replay | 2.450–2.517 GB | 2.367–2.502 GB |

Median frame interval was 16.7 ms throughout. Draws and triangles below are ranges of per-run medians. All intervals are in milliseconds.

| Scene | Baseline p95 | Revised p95 | Draws before → after | Million triangles before → after |
| --- | ---: | ---: | ---: | ---: |
| Bospoorttunnel | 33.4 | 16.8–33.4 | 2,119–2,135 → 2,119–2,130 | 9.70–9.78 → 9.71–9.72 |
| Stadspoort | 16.7–33.4 | 33.3–33.4 | 1,989–2,010 → 1,998 | 11.67–11.69 → 11.68 |
| Ede-Wageningen | 16.7–16.8 | 16.7–16.8 | 973–992 → 978–1,001 | 4.73–4.79 → 4.77–4.78 |
| Raadhuisstraat | 16.7 | 16.7–16.8 | 1,469–1,481 → 1,466–1,473 | 8.38–8.40 → 8.38–8.39 |
| Albertstunnel drive | 16.7–16.8 | 16.7 | 1,133–1,149 → 1,134–1,144 | 5.67–5.73 → 5.71–5.72 |
| Camera jump | 16.8 | 16.8 | 1,439–1,455 → 1,442–1,445 | 8.16–8.17 → 8.16 |

Cold startup shifted by about 0.06 s at the median, within the 0.09 s baseline spread. The 30 FPS p95 budget remains 33.3 ms, with the same 33.4 ms display-interval rounding at Bospoort and Stadspoort. Individual camera jumps still reach about 100 ms during tile work. Existing grade clips, pavement and shoulders cover the accepted corrections. The added local data totals 604 bytes net, and the 12 m terrain asset is byte-for-byte identical.

The WebGPU route replay passed 127 direction and mode checks, with no failures or wrong-level network transfers. It exercised both sides of Bospoorttunnel and Stadspoort, the adjacent Frans Halslaan crossing, the station tunnels and garage, and both Raadhuisstraat carriageways. Another 30 checks remain unverified, chiefly van and bus operation and individual train service paths. Walk-throughs on the corrected station footway reached both ends. Rays checked 115 points across the path and adjacent shoulder. At Bospoort and the new Stadspoort approach joins, the sampled rendered road matched the fitted contact plus the pavement lift within 1 mm. The matched candidate passed 351 JavaScript tests.

## Reproduce the survey and checks

```sh
survey=/tmp/ede-crossing-survey
uv run --python 3.12 --with rasterio --with pyproj==3.8.0 python tools/fetch-ede-ahn-survey.py "$survey"
uv run --python 3.12 --with rasterio --with pyproj==3.8.0 --with shapely python tools/build-ede-ahn-surfaces.py "$survey"
curl -fsS 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items/6cc1a6a1-2450-5bc5-9c93-33cf738916a5?f=json' -o "$survey/bospoorttunnel-bag.geojson"
uv run --python 3.12 --with rasterio --with pyproj==3.8.0 --with 'shapely>=2.1' python tools/build-ede-building-bases.py "$survey" "$survey"
```

The Bospoort and Frans Halslaan profiles use `tools/build-ede-crossing-fits.py` with the full existing crossing survey cache. The Stadspoort profile uses `tools/build-ede-interior-fits.py`. Rebuild the combined asset with the [existing OSM and ProRail refresh commands](ede-grade-sources.md).

Use the same Chrome WebGPU device, DPR 1, 1600 × 900, fixed midday and date, and **Fast** quality for the benchmark. The street drive uses the car controller through Albertstunnel with traffic and parking active. Compare cold and warm navigation and the same approach and jump paths with the candidate on a separate local server.

```sh
EDE_BENCH_SCENARIOS=ahn EDE_BENCH_RUNS=3 EDE_BENCH_FRAMES=90 EDE_BENCH_TRAFFIC=active node tools/benchmark-ede.mjs /tmp/ede-ahn-benchmark.json http://127.0.0.1:8990 9297 'perf=1'
node tools/audit-ede-crossings.mjs /tmp/ede-ahn-crossings.json http://127.0.0.1:8990 9297 'bospoorttunnel,stadspoort,frans-halslaan,albertstunnel,westtunnel,oosttunnel,polar bearsplein,raadhuisstraat-passage'
```
