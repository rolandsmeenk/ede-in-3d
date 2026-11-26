# Ede curb pilot

The bake reads the five shipped BGT paving packs and the baked street features. The packs from 18–26 November 2026 contain 67,179 rows and 66,352 unique IDs. Including the playable fringe, the inventory has 16,160 footpaths, 1,678 traffic islands, 12,415 driveways and 100 pedestrian-area polygons. Ordinarily these BGT tops and the adjacent carriageway sit 65 mm above the same terrain. The centreline fallback has separate visual curbs, with no equivalent contact profile. There are 242 baked crossing records. A BGT traffic island may be a splitter island or another road feature. The source class alone does not establish a pedestrian refuge or curb rise. [BGT](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html)

## Reviewed sites

| Site | Fit | Evidence |
| --- | --- | --- |
| Kastelenlaan at the N224 | Default 120 mm curb tops on 11 selected island polygons and six approach polygons. The selected island lips taper to the crossing corridor. The two mapped asphalt cut-throughs stay at carriageway height. | OSM crossings [270772153](https://www.openstreetmap.org/node/270772153) and [271607961](https://www.openstreetmap.org/node/271607961), same-level BGT road and path boundaries, and the [2026 aerial review](ede-zebra-review.md) confirm the two dashed, signal-controlled routes. The BGT paths traverse the refuge gaps for about 5 m. No explicit kerb heights were found at the site. |
| Klinkenbergerweg at Dennenlaan | Five tiled approach polygons meet the existing table. The 80 mm table rise is the previous NDW-based estimate. The top triangles used to place the zebra also supply contact heights. Two tactile warning panels have estimated pad dimensions and positions. | WKD VOP 22686, NDW Drempels 264233, the [2026 aerial review](ede-zebra-review.md), and [OSM 12496796646](https://www.openstreetmap.org/node/12496796646), updated 29 September 2026, record the zebra, table, flush kerb and tactile paving. The two Dennenlaan bus stop records also carry tactile tags. |
| Heideoordlaan and Zwarte Laantje | One approximately 4.8 m wide driveway ties into two raised sidewalk polygons. The kerb returns to carriageway height at the measured BGT edge. The rise of 120 mm and the 0.95 m tapers to the road and rear access are estimates. | BGT inrit `G0228.fe246f2da260d6d6e0400a0a35020533`, two adjoining BGT footpaths, OSM ways [6953530](https://www.openstreetmap.org/way/6953530) and [646986372](https://www.openstreetmap.org/way/646986372), and a [2026 aerial crop reviewed 26 November](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=640&HEIGHT=640&BBOX=52.03436971707135%2C5.6679306937005105%2C52.03469311057361%2C5.6683980880617355). |
| Albertstunnel | The four existing road and side-path profiles now use their rendered paving top for contact. The west and east side paths remain roughly 1.1 m and 1.8 m above the lower road minima. The rail deck and geometry are unchanged. | [Existing grade survey](ede-grade-sources.md), BGT rail viaduct `L0004.a868e3a0aea840a98f3d77833a6f3ac5`, and [municipal station drawings](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Tijdelijk-Spoorzone/ontwerp_stationsomgeving_1_2_3.pdf). Survey the curb width and concealed vertical profile before changing the footway geometry. |

The [review manifest](ede-curb-pilots.json) records source identities, dates, confidence and configurable height defaults. High confidence refers to the mapped arrangement. Vertical dimensions are estimates. Four local OSM map extracts retrieved 26 November yielded one `kerb=flush`, zero `kerb:height`, and three `tactile_paving=yes` nodes. Two tactile nodes belong to bus stops. The crossing controls, access rules, and bus-platform surfaces use their existing sources. [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

## Native AHN cross-check

PDOK native 0.5 m DTM slices were downloaded 26 November. Each line uses a 19 m window at one-metre spacing and the median of three lateral samples up to 0.55 m from the centre. The slope is the median of sample-pair slopes separated by at least 5 m.

| Location | RD New raster bounds in metres | Scene X/Z and sample direction | NAP range and slope |
| --- | --- | --- | --- |
| Kastelenlaan southern crossing | 172576, 450256, 172652, 450332 | −1891.6, 591.8 · 0.33, 0.945 | 13.96–14.09 m · −0.16% |
| Klinkenbergerweg table | 174499, 449531, 174575, 449607 | 24.68, 1323.83 · 0.183, 0.983 | 28.70–28.79 m · −0.40% |
| Heideoordlaan carriageway | 174242, 449575, 174318, 449651 | −231.7, 1279.0 · 0.978, −0.207 | 20.27–20.35 m · +0.27% |
| Albertstunnel exposed north carriageway | 174580, 448828, 174656, 448904 | 101.8, 2006 · −0.063, 0.998 | 16.93–16.97 m · −0.17% |

The first three samples check approach context. At Klinkenbergerweg this window crosses the table, so it cannot establish the ordinary road grade or the curb face. The Albertstunnel center under the deck had no usable DTM sample. The existing fitted profile anchors the exposed grades. The source supplies context for slopes but cannot establish an individual centimetre-scale curb height. The scene keeps the 12 m core AHN grid and the 22.54 m NAP Oude Kerk datum. [AHN source and vertical accuracy](https://www.ahn.nl/kwaliteitsbeschrijving) · [PDOK native coverage service](https://service.pdok.nl/rws/ahn/wcs/v1_0?service=WCS&request=GetCapabilities)

## Rebuild

```sh
uv run --with shapely==2.2.0 python -B tools/build-ede-curbs.py
node --test tests/ede-curbs.test.cjs tests/ede-grade.test.cjs tests/ede-paving-worker.test.cjs \
  tests/ede-street-features-world.test.cjs tests/pedestrian-signals.test.cjs
```

The first command rebuilds a deterministic versioned gzip file from repository inputs. Pass `--osm snapshot.xml ...` to include tag counts from dated OSM extracts and `--audit report.json` to export the count summary. The game reads the compact profile asset once and sends changed geometry through its existing pavement worker, tile cache and material batches. It samples contacts in local 32 m cells and only applies the at-grade profiles at ground level. A separate grade binding uses the existing Albertstunnel profiles.

```sh
EDE_BENCH_SCENARIOS=curb-pilot EDE_BENCH_CACHE=warm EDE_BENCH_TRAFFIC=active \
  EDE_BENCH_VIEWPORT=1200x720 node tools/benchmark-ede.mjs /tmp/ede-curbs.json \
  http://127.0.0.1:8990 9297 'perf=1&curbs=off' 'perf=1&curbs=on'
```

## Pilot verification

The 26 November Chrome WebGPU replay used Fast, 1200 × 720, active traffic, a fixed simulation seed and time, and 90 sampled frames per view (180 for moving vehicles). Profiles off and on ran in separate Chrome processes on the same route. Time to first playable frame was 28.48 s off and 28.41 s on. An earlier comparison returned 27.71 s off and 30.19 s on while the pilot was being developed.

| View | Median draws off → on | p95 frame ms off → on |
| --- | ---: | ---: |
| Kastelenlaan at street level | 1,671 → 1,624 | 33.4 → 33.4 |
| Kastelenlaan from above | 723 → 726 | 16.8 → 16.8 |
| Klinkenbergerweg raised zebra | 1,909 → 1,902 | 50.0 → 50.0 |
| Heideoordlaan driveway | 1,450 → 1,439 | 33.4 → 33.4 |
| Albertstunnel cycling | 1,145 → 1,182 | 33.4 → 33.3 |
| Albertstunnel driving | 1,186 → 1,225 | 33.4 → 33.4 |

Street-level and aerial inspections showed separated crossing markings and level refuge gaps at Kastelenlaan, paint on the raised table at Klinkenbergerweg, tapered connections at Heideoordlaan, and separate grades at Albertstunnel. The fixed-step movement replay completed 18 traversals with ambient traffic paused for repeatability. It walked both directions across both refuges, the zebra, the driveway sidewalk and the west tunnel path. It cycled the permitted Kastelenlaan direction, both driveway directions and each tunnel side in its mapped direction. It drove past the driveway, across the table and along the lower tunnel carriageway. The largest frame-to-frame player height change was 12 mm at 60 simulation steps per second. The replay recorded up to 10 mm of vertical chase-camera movement per step and 9 mm between the rendered wheel bottom and the common surface query. The automated paving test also raycasts the worker mesh on the existing AHN grid.

The baked pilot covers 13 sidewalk/approach polygons, 11 island polygons, one driveway, two retained refuge cut-throughs, two tactile panels and four fitted tunnel travel surfaces. All 25 new curb heights use defaults or a connection to the existing table estimate. There are zero newly measured curb rises. The compressed asset is 8,600 bytes. Across the input inventory, 16,147 footpaths, 1,667 traffic islands and 12,414 driveways remain outside the reviewed height fits. These counts include features that may be flush or lack evidence of a curb.

Municipality-wide expansion is on hold. The Klinkenbergerweg view exceeded the 33.3 ms target in both variants, and the concealed Albertstunnel curb dimensions remain unresolved. The remaining municipality needs review where pavement classes meet at crossings, driveways, plazas, shared streets or surveyed platforms and structures.
