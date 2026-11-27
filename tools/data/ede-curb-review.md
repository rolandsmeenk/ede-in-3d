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

The 26 November pilot comparison found a 50 ms p95 at Klinkenbergerweg with either variant. The concealed Albertstunnel curb dimensions remain unresolved.

## Municipality rollout

The 27 November bake applies the same configurable default at qualifying sites throughout the full map. It adds 2,572 sidewalk parts and two refuge island parts, including 10 matched crossing tapers and 430 driveway connections. Figures count the added polygon parts separately from the 25 reviewed pilot records. The five source paving packs are dated 18–26 November 2026. The profiles carry estimated rises at 120 mm above the adjacent carriageway. A 1.5 m nominal taper joins mapped low paving, with matching heights on both sides of a shared sidewalk boundary.

| Input pack | Added sidewalk parts | Added refuge parts |
| --- | ---: | ---: |
| Ede base | 1,502 | 2 |
| Corridors | 20 | 0 |
| Municipality extension | 749 | 0 |
| Playable fringe | 301 | 0 |

Eligibility requires at least 3 m of shared boundary with a separate detailed BGT local or regional carriageway on the same level. Shared streets, transit lanes, grade fits, bus platform areas, raised tables, ambiguous crossing approaches and duplicate source shapes retain their previous heights. The offline report gives review counts by reason and lists BGT IDs and scene coordinates for protected, split or too-narrow candidates. On the renderer, raised tops and sloped profiles share the grade-aware contact lookup and the existing paving tiles and materials. The 12 m AHN grid and Oude Kerk datum still supply the at-grade surface. Compact iPhone/iPad mode keeps the smaller pavement workload. The full municipality is available in Standard.

The shipped paving inventory has 16,160 distinct BGT footpath IDs, including 9,442 with `tegels`, 1,912 with `gebakken klinkers`, and 1,687 with `betonstraatstenen`. Local Ede construction plans show gray 300 × 300 mm concrete flags, with staggered and straight layouts in use. The renderer keeps the BGT material classes and uses subdued gray staggered flags for the tile class and unidentified sidewalk strips. Per-site dimensions and laying patterns generally remain estimates. [Verlengde Parkweg design](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Tekening_Verlengde_Parkweg.pdf) · [Hakselseweg design](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/20200514_Ontwerp_Hakselseweg.pdf)

```sh
uv run --with shapely==2.2.0 python -B tools/build-ede-curbs.py --municipal --audit /tmp/ede-curbs-audit.json
node --test tests/ede-curb-rollout.test.cjs tests/ede-curbs.test.cjs tests/ede-paving-worker.test.cjs
```

The compressed v2 asset is 1,050,036 bytes including the station area and Tooroplaan fits below. For a baseline with the new paving materials and the original pilot heights, run the `municipality-coverage` benchmark with `perf=1&curbRollout=off`. The full rollout uses `perf=1`.

The 27 November matched replay used separate Chrome WebGPU processes, Fast at 1200 × 720, active traffic, 75 frame samples per fixed view and the same benchmark seed. First playable frame was 24.51 s with pilot heights and 27.60 s with full-map heights. This is one pair and includes startup variability across scenery and traffic stages. Field checks compared worker mesh raycasts and travel heights at Kolkakkerweg, Stationsstraat in Lunteren, Margrietlaan in Harskamp and the Hoenderloo fringe. At the sampled raised positions they agreed within 0.02 mm. The Bunschoterweg zebra kept its level refuge opening and separate paint bands.

| View | Median draws pilot → full | p95 frame ms pilot → full |
| --- | ---: | ---: |
| Oude Kerk | 936 → 922 | 16.8 → 16.8 |
| Wekerom | 574 → 608 | 16.8 → 16.8 |
| Harskamp | 588 → 590 | 16.8 → 16.7 |
| Bennekom | 638 → 665 | 16.7 → 16.8 |
| Former cutoff flight | 679 → 688 | 16.8 → 33.3 |
| Hoenderloo flight | 365 → 364 | 16.8 → 16.8 |
| Veenendaal fringe | 415 → 410 | 16.7 → 16.7 |

## Station area follow-up

The 27 November site review identifies eight separate tiled boarding islands at Polar Bearsplein and six raised traffic islands at the Emmalaan–Klinkenbergerweg–Akulaan–Bennekomseweg signals. The automatic bake reserves bus areas and ambiguous crossing approaches. These 14 reviewed footprints are now included in both curb packs.

- Polar Bearsplein uses the project's 180 mm bus platform default above the adjacent bus lane. The two ends of each island use a 2.25 m estimated ramp run with a 350 mm level landing. The paved strip joined to the eastern forecourt remains at its existing height. [2026 PDOK station aerial](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=1000&HEIGHT=900&BBOX=52.02588063763694%2C5.67323269848565%2C52.02685081814373%2C5.675058457709183) · [Traffic decision 2024-120844](https://zoek.officielebekendmakingen.nl/gmb-2024-120844.html)
- The signal junction uses 120 mm above the adjacent carriageway. The eight mapped signal crossing paths retain level openings, with up to 1.5 m of taper where an island approaches a crossing. The two smaller splitter islands and surrounding sidewalk transitions remain open for review. [2026 PDOK junction aerial](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=1000&HEIGHT=900&BBOX=52.02523385063241%2C5.671874333623342%2C52.025862671331254%2C5.67323269848565) · [Municipal signal junction list](https://www.ede.nl/in-de-gemeente-ede/ede-fietst/fietsvriendelijke-verkeerslichten)

The profiles use dated BGT and aerial footprints. All 14 rises and the ramp dimensions are estimates. The updated compact pack has 39 reviewed profiles and is 14,465 bytes. The automatic municipality inventory still contributes 2,574 parts.

## Jan Th. Tooroplaan follow-up

The 27 November review adds 20 raised BGT island polygons at six junctions. The rise is the 120 mm default above the adjacent carriageway. Five previously flat cement concrete polygons at Oude Kerkweg and Diedenweg were outside the automatic material filter. Others were outside the matched-refuge criteria. The verified approaches retain the existing carriageway-level openings. The Diedenweg zebra now has a 2.1 m paint gap estimated from imagery. At Bovenbuurtweg, the small eastern inner island and the strips beside the zebras need closer review.

| Site | Added polygons | 2026 PDOK evidence |
| --- | ---: | --- |
| Oude Kerkweg / Johannes Bosboomlaan | 2 | [Aerial crop](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=660&HEIGHT=492&BBOX=52.0245870636%2C5.6617961427%2C52.0249553729%2C5.6625994768) |
| Diedenweg | 3 | [Aerial crop](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=696&HEIGHT=516&BBOX=52.0248745245%2C5.6639870538%2C52.0252608001%2C5.6648342061) |
| Bovenbuurtweg | 3 | [Aerial crop](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=936&HEIGHT=636&BBOX=52.0244972321%2C5.6595175952%2C52.0249733392%2C5.6606568690) |
| Arnold Koningstraat | 4 | [Aerial crop](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=828&HEIGHT=408&BBOX=52.0245331647%2C5.6555009249%2C52.0248385919%2C5.6565087440) |
| Rembrandtlaan | 4 | [Aerial crop](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=588&HEIGHT=540&BBOX=52.0242816364%2C5.6531055288%2C52.0246858783%2C5.6538212264) |
| Western signal approaches | 4 | [Aerial crop](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=684&HEIGHT=696&BBOX=52.0239582429%2C5.6495416468%2C52.0244792658%2C5.6503741930) |

Chrome WebGPU raycasts matched travel contact at three reviewed sites. The Diedenweg gap stayed at carriageway height and paint raycasts through its center returned no hits. The compact pack now contains 59 reviewed profiles and is 20,754 bytes. The 2,574 existing municipality profile parts retain their previous fitted heights.

## Other traffic islands and roundabout centers

A 27 November screen deduplicated BGT island IDs from the five paving inputs and checked the distance to the endpoint-to-endpoint axis of each baked ground-level crossing. Within 3 m it found 264 island IDs, of which 24 have curb profiles and 240 are review candidates. Of those 240, 74 are outside the automatic materials filter (46 cement concrete, 28 asphalt), 157 have no nearby crossing marked as a matched refuge, and nine pass those two checks. This distance screen includes splitter islands and potentially flush surfaces. Overlaying the 2026 imagery on BGT confirmed examples of raised footprints without curb profiles. [Edeseweg, Bennekom](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=528&HEIGHT=588&BBOX=52.0116333572%2C5.6727653041%2C52.0120735317%2C5.6734079714) · [Heelsumseweg, Bennekom](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=588&HEIGHT=636&BBOX=51.9962272501%2C5.6765920955%2C51.9967033572%2C5.6773077931) · [De Klomp](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=768&HEIGHT=672&BBOX=52.0480330925%2C5.5736484874%2C52.0485361491%2C5.5745832761)

Of 22 closed rings reconstructible from the shipped at-grade OSM roundabout ways, zero have a baked traffic-island profile inside the ring. The game drapes those centers on the terrain. BGT identifies the surface and level, and roundabout collars can surround a separately mapped planted center. Native PDOK AHN DTM samples at 0.5 m resolution show approximate median center ground rises of 31 cm at Bovenbuurtweg, 29 cm at Molenstraat, and 47 cm at Akulaan. Each uses a plane fitted to 48 samples around the circulating road and up to 25 central samples. The Chrome terrain sampler returns about +8 cm, +6 cm and −4 cm at the corresponding centers relative to the loop road samples. These values describe the broad ground rise. Individual curb and truck apron dimensions require finer evidence. [AHN raster products](https://www.ahn.nl/dataroom) · [BGT traffic island definition](https://geonovum.github.io/IMGeo-objectenhandboek/ondersteunendwegdeel)
