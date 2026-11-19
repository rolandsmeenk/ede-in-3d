# Slop Ede

Explore Ede in 3D, from Oude Kerk and Marktplein to Kernhem, Rietkampen, Maandereng, Veluwse Poort, and the western business parks. Travel on foot, by car, bicycle, or helicopter.

Forked from [Slop Utrecht](https://github.com/bertt/slop-utrecht), based on [Slop New York](https://github.com/mrdoob/slop-newyork).

## Run locally

Run the local server and open [localhost:8000](http://localhost:8000). Live road data matching uses Node.js 22 or later.

```sh
python3 tools/serve-ede.py
```

Add `--offline` to skip upstream traffic, rail and weather feeds. A plain static server such as `python3 -m http.server 8000` also runs the offline traffic model. Three.js, OpenStreetMap geometry, posted limits, and the timetable are local. The simulator streams LoD 2.2 buildings when 3DBAG is reachable and uses OpenStreetMap footprints otherwise.

## Landmarks

The **Teleport** menu includes Astrant, the Van Eekelenflat, Plantion, the Johan Willem Friso-kazerne and station Ede-Wageningen. Their models use the mapped building plans and surveyed elevations where available.

The historic exterior models include ENKA Westhal and Poortgebouw, Mauritskazerne, Oude Kerk, the old Ede Centrum station, Huis Kernhem and its coach house, De Vuurvogel, Raadhuis Ede and Cultura. See the [exterior references and fitted details](tools/data/ede-landmark-exteriors.md).

Astrant’s yellow-and-charcoal music artwork and the Van Eekelenflat’s winged horse and parachutes are original, generated game illustrations. The real murals are [Muzikanten by Studio Giftig](https://www.bezoek-ede.nl/locaties/4164762835/street-art-muzikanten) and [Pegasus by Nina Valkhoff with SMOK](https://www.woonstede.nl/nieuws/airborne-komt-tot-leven-op-de-van-eekelenflat/).

## Graphics and profiling

The **Graphics** menu offers **Fast** and **Standard**. Fast is the default and keeps bloom and color grading. Standard enables screen-space reflections and multisample antialiasing. The terrain uses the same 12 m AHN grid in both presets.

Append `?perf=1` to collect a rolling frame history. Open the browser console and run `await __slopwaw.perf.report()` for median and p95 frame time, subsystem CPU time, and render pass statistics. Pass `{frames: true}` for individual samples. GPU times are available on WebGPU devices with timestamp queries. `__slopwaw.perf.reset()` starts a fresh sample.

In profiling mode, append any of `shadows`, `ssr`, `bloom`, `msaa`, `buildingDetail`, `vegetation`, `trafficDraw` and `trafficUpdates` with `=on` or `=off` to override one setting. `scale=0.75` tests a lower internal resolution, and `bag=eager` restores the original all-tiles startup path for comparison. You can freeze existing traffic with `__slopwaw.perf.setTrafficUpdates(false)` and independently hide it with `__slopwaw.perf.setTrafficDraw(false)`.

On the test device, serve the game locally and start a separate Chrome profile with `--remote-debugging-port=9297`. The script replays the station, Kuiperplein, Kolkakkerweg, helicopter and camera-jump views at 1600 × 900. Use the offline server to fix external traffic, weather and parking observations. The public 3DBAG tiles remain enabled. The script fixes the random seed, simulation timestep and service clock. It reports network bytes from DevTools and sampled V8 heap plus backing storage. Browser/GPU process memory is a separate metric.

```sh
EDE_BENCH_TRAFFIC=active node tools/benchmark-ede.mjs /tmp/ede-benchmark.json http://127.0.0.1:8000 9297 'perf=1&quality=standard' 'perf=1'
```

The frame budget is 33.3 ms for 30 FPS. Use p95 for recurring dips and the maximum interval for single-frame jumps. The [performance report](tools/data/ede-performance.md) records the comparison and terrain budget.

The live server caches the national NDW DATEX II v3 and OVapi GTFS-Realtime feeds and serves only matches within the Ede map. NDW readings change demand and cruising speed on their matched direction. Posted or applicable temporary limits cap speed. Valid closures block new entry. The camera-local simulation uses Amsterdam time-of-day demand and the timetable when live data expires. See the [traffic data notes](tools/data/ede-traffic-sources.md) for coverage, fallbacks, and the frame-time measurements.

## Live Weather

Turn on **Live Weather** in the toolbar to use current model estimates for Oude Kerk. The weather card shows the source and model update time in Europe/Amsterdam. You can use Live Weather with any preset or Live Time. Turning it off restores the selected lighting mode’s weather settings.

The game requests an update about every 15 minutes while visible. The local server shares one cached reading across clients. Static hosting requests the same conditions from Open-Meteo when the server endpoint is absent. A reading is marked stale after 30 minutes and fades back to the selected mode after an hour. When no reading is available, the selected mode supplies the weather settings.

Rain and snow use one camera-local draw with at most 1,200 particles. The effect is suppressed below mapped tunnel roofs, bridge decks and open sheds. Rain wets the roads and the surface dries gradually as rain stops. The timestamped reading and freshness status are available through `window.__slopwaw.weather`.

[Open-Meteo](https://open-meteo.com/en/docs) supplies the weather estimates. [Isometric Warsaw](https://bedirhanyildirim.com/warsaw-izo/) and [Slop Geneva](https://github.com/emmanpi/slop-geneva/blob/HEAD/js/weather.js) are references for the weather controls and camera-local precipitation.

In headless Chrome WebGPU at 960 × 537, two 100-frame passes along the same street-level route had a median frame interval of 16.7 ms with rain hidden and with roughly 1,200 particles visible. The 95th percentile was 16.7 ms with rain hidden and 16.7–16.8 ms with rain visible. Both runs were near the browser’s 60 Hz frame limit.

## Refresh the Ede map

Use Node.js 22 or later.

```sh
bash tools/overpass.sh tools/data/osm_ede.json tools/data/q_ede.overpassql
node tools/build-ede-geodata.mjs
node tools/build-ede-shops.mjs
```

Rebuild the aerial palettes after refreshing the map so their records follow the updated geometry.
Rebuild the bus routes after changing the road graph.
See the [traffic data notes](tools/data/ede-traffic-sources.md) for the WKD input and the access review.

The roughly 7.4 × 5.4 km extraction covers Ede’s built-up town. The coordinate origin is Oude Kerk. Use **Show all of Ede** in the street atlas for the town-wide view. Building geometry from 3DBAG is projected into the same coordinate system and seated on the AHN terrain.

## Refresh the AHN terrain

Terrain comes from the PDOK AHN ground model (DTM). The input raster uses RD New (EPSG:28992) horizontally and metres NAP vertically. The checked-in asset samples it every 12 m across the map and its surroundings. Scene Y is relative to the AHN height at Oude Kerk, 22.54 m NAP in this asset. The existing true-north scene X/Z and saved map positions keep their coordinates.

With Python 3 and GDAL on your PATH:

```sh
curl -fsSG https://service.pdok.nl/rws/ahn/wcs/v1_0 \
  --data-urlencode service=WCS --data-urlencode request=GetCoverage \
  --data-urlencode version=2.0.1 --data-urlencode coverageId=dtm_05m \
  --data-urlencode format=image/tiff \
  --data-urlencode 'subset=x(168650,176950)' \
  --data-urlencode 'subset=y(446650,452950)' \
  --data-urlencode 'scalesize=x(1384),y(1050)' -o /tmp/ede-ahn-rd.tif
python3 tools/build-ede-terrain.py /tmp/ede-ahn-rd.tif
```

Existing OSM street, cycleway, park and water outlines follow the terrain. Fitted bridges and tunnels have their own travel surfaces. The browser loads the local terrain asset and can fall back to level ground if the file is unavailable.

The [targeted AHN survey](tools/data/ede-ahn-pilot.md) shows how to refresh the native 0.5 m DTM and DSM inputs for the elevation pilot. The game loads the resulting small profiles and building base records locally. Use **Teleport → Openluchttheater Ede** to visit the theatre from Van Pabstlaan.

## Refresh structures and grade-separated routes

The BGT snapshot provides decks, abutments, railway platforms, walls, pylons, tanks, open sheds and turbines. The builder joins related geometry, clips to the map extent and filters overlapping BAG/OSM structures. A second build matches BGT surfaces and widths to OSM ways at the same relative level. The road build combines that physical evidence with directional access tags and WKD.

```sh
uv run --with 'shapely>=2.1' python tools/build-ede-bgt.py /tmp/ede-bgt --date 2026-11-18 --fetch
uv run --python 3.12 --with pyproj==3.8.0 --with 'shapely>=2.1' python tools/build-ede-bgt-roads.py /tmp/ede-bgt-roads --date 2026-11-18 --fetch --report /tmp/ede-bgt-road-report.json
```

Omit `--fetch` to reuse a downloaded snapshot. The road evidence builder samples the generated OSM map, so build a new OSM snapshot before matching it and rebuild the map afterward to apply the evidence. The [crossing profile notes](tools/data/ede-grade-sources.md) give the ProRail refresh queries and record the measured and estimated heights for each modeled crossing. Road and path contact, walls, and the follow camera use those layered surfaces while the rail renderer keeps its OSM alignment. At mapped public level crossings, warnings and barriers share train progress with the simulation. See the [traffic pilot](tools/data/ede-traffic-pilot.md) for timing and coverage.

### Verify bridges, tunnels and passages

The [crossing audit](tools/data/ede-crossing-audit.md) lists the two route levels independently and includes the 14 public level crossings. The [catalogue and source notes](tools/data/ede-crossing-scan.sources.md) describe the geographic discovery and two-level overlap checks.

Open the game with `?debug=1` and choose **Debug** in the toolbar for temporary test teleports to the 19 repaired crossings. Each destination selects the appropriate travel mode and places you at the tested surface height.

Start the local game and an isolated Chrome session with `--remote-debugging-port=9297`. The audit sends test inputs through the actual player controllers and samples the train routes used by the game.

```sh
node tools/audit-ede-crossings.mjs /tmp/ede-crossing-checks.json http://127.0.0.1:8990 9297
python3 tools/report-ede-crossings.py /tmp/ede-crossing-checks.json
```

Supply a fourth argument to the Node script to test one site by name or ID. To rebuild surveyed additions, put the local PDOK AHN 0.5 m coverage rasters in a directory as `<site-id>-dtm.tif` and `<site-id>-dsm.tif`. Run the profile fitter, then rebuild the main grade asset with the OSM and ProRail inputs in the crossing profile notes.

```sh
uv run --with shapely --with rasterio --with pyproj python tools/build-ede-crossing-fits.py /tmp/ede-crossing-survey
```

## Refresh road materials and lanes

PDOK BGT polygons supply physical material boundaries and surveyed carriageway widths. Detailed BGT classes take precedence. Compatible OpenStreetMap surface tags refine broad classes. The materials use the local PDOK aerial vertex colours as tint and respond to the existing wetness controls. Roads and paths use their mapped level and the fitted bridge and tunnel profiles.

Use the map’s Overpass JSON for `osm-road-tags.json`, or extract tags for the checked-in road IDs from the [Gelderland and Utrecht PBFs](https://download.geofabrik.de/europe/netherlands.html). This refresh retains the original OSM geometry and junction connections. Motorway curves subdivide at existing shape points. Their original directed keys still resolve posted speeds, traffic updates, and street features.

```sh
uv run --with osmium python tools/extract-ede-road-tags.py gelderland.osm.pbf utrecht.osm.pbf > /tmp/osm-road-tags.json
uv run --python 3.12 --with pyproj==3.8.0 --with 'shapely>=2.1' python tools/build-ede-bgt-roads.py /tmp/ede-bgt-roads --date 2026-11-18 --fetch --osm /tmp/osm-road-tags.json --report /tmp/ede-bgt-road-report.json
node tools/build-ede-road-tags.mjs /tmp/osm-road-tags.json
python3 tools/build-ede-motorway-lanes.py --fetch
```

Set `--date` to the BGT snapshot date. The shared lane definition supplies both painted markings and traffic lane centres. It retains turn lanes, bus permissions, and cycle and advisory strips. Accepted A12 and A30 sections link to the original NWB offsets and WEGGEG counts. The [motorway evidence and imagery review](tools/data/ede-motorway-lanes.sources.md) records ambiguous matches and confirmed tapers. Rebuild the reviewed motorway asset offline by omitting `--fetch`.

### Refresh fitted vehicle lanes

The offline bake fits A12 and A30 lanes to 1GIS markings, cross-checks available NWB/WEGGEG lane counts, and fits town lanes to same-level BGT carriageway polygons and reviewed PDOK traces. It retains the routing graph, directed edge keys, lane permissions, and the original along-edge stations. The game uses the compact local asset for vehicle trajectories, junction connectors, and generated paint. Surveyed paint keeps priority.

```sh
uv run --python 3.12 --with pyproj==3.8.0 --with 'shapely>=2.1' python tools/build-ede-fitted-lanes.py
```

The bake reads the checked-in 1GIS and motorway snapshots, the BGT road asset, and the [aerial trace manifest](tools/data/ede-lane-aerial-traces.json). The [GIS frame and controls](tools/data/ede-gis-v1.md) document the pinned PROJ release, RDNAPTRANS2018 grid, axis order, and Oude Kerk export. The [verification report](tools/data/ede-fitted-lanes-verification.md) records the reviewed sites, fallback reasons, and paired browser checks.

## Refresh traffic signs, speed bumps and crossings

NDW Verkeersborden v5 supplies placed signs and their codes, values, bearings, conditions, and supplementary plates. PDOK BGT supplies wayfinder locations. The Drempels and WKD VOP snapshots supply bump, table, and zebra geometry. The surface import merges OpenStreetMap speed-calming tags, marked paths, refuge islands, and crossing controls. [Sign sources and face atlas refresh](tools/data/ede-street-sign-sources.md)

Use the town Overpass snapshot from the map refresh step. Download the source ZIPs and the supplemental OSM features before running the local import.

```sh
mkdir -p /tmp/ede-street
python3 tools/build-ede-street-signs.py --output /tmp/ede-street/signs.json
bash tools/overpass.sh /tmp/ede-street/osm-features.json tools/data/q_ede_street_surfaces.overpassql
curl -fsSL 'https://verkeersveiligheid.ndw.nu/cms/api/dataset-files/file/Drempels.zip?prefix=dataset' -o /tmp/ede-street/drempels.zip
curl -fsSL 'https://verkeersveiligheid.ndw.nu/cms/api/dataset-files/file/VOPs.zip?prefix=dataset' -o /tmp/ede-street/vops.zip
uv run --with 'shapely>=2.1' python tools/build-ede-street-surfaces.py \
  tools/data/osm_ede.json /tmp/ede-street/osm-features.json /tmp/ede-street/drempels.zip \
  /tmp/ede-street/vops.zip /tmp/ede-street/surfaces.json
uv run --with 'shapely>=2.1' python tools/build-ede-street-features.py \
  /tmp/ede-street/signs.json /tmp/ede-street/surfaces.json
```

Add `--fetch` to the sign importer for the latest placed signs. Reuse the downloaded inputs to rebuild offline. The resulting `assets/ede-street-features.json.gz` is loaded locally. Each road or path reference gives a directed key, layer, mode mask, confidence, and a distance or interval in metres from the directed edge's start. The mask uses 1 for car, 2 for van, 4 for bus, 8 for bicycle, and 16 for foot. `forRoad(edge)`, `forPath(track, direction, mode)`, and `forEdge(key)` return features in travel order. A single feature can have several references. Uncertain and unmatched records retain their raw evidence and review reason. The renderer draws those features. The [traffic pilot](tools/data/ede-traffic-pilot.md) also uses verified directed references for hump speed, stop lines, give-way approaches and zebras.

Measured footprints supply length and width where available. OSM-only hump, short bump, raised table, and cushion length defaults are 3.5, 1.2, 7, and 2.5 m, with modelled heights of 8, 6, 8, and 7 cm respectively. Tables use short linear ramps and humps use a rounded longitudinal profile. The same profile sets the stripe height on a raised zebra. [NDW Drempels](https://verkeersveiligheid.ndw.nu/dataset/drempels) · [WKD pedestrian crossings](https://verkeersveiligheid.ndw.nu/dataset/voetgangersoversteekplaatsen) · [NDW open-data terms](https://docs.ndw.nu/algemeen/data-gebruiksvoorwaarden/)

The snapshot contains 6,345 sign locations, 966 humps and tables, and 201 crossings. The renderer has exact artwork for 5,958 sign faces. It paints 119 zebras at 121 carriageway strips, supported by NDW VOP at 67 locations and explicit OSM zebra tags at 52. The crossing layer also paints 37 dashed and 31 dotted crossings from the mapped OSM patterns. Two explicitly unmarked crossings and 12 with unknown markings have bare pavement. The layer confines paint to the mapped carriageway and level, clips it around surveyed BGT islands, trims edge markings at sidewalks, and follows the fitted table height. If the asset is unavailable, ordinary road markings still load. [Zebra source and site review](tools/data/ede-zebra-review.md)

For a documented imagery decision, pass `--marking-review` to `build-ede-street-surfaces.py` with a JSON object keyed by the source crossing ID. Each decision records `markings`, an `imagery` URL, a capture date or imagery vintage in `date`, and a short `note`. An optional `markingColour` records the paint colours. The bake retains split, paired and bicolour zebra tags and explicit edge markings, including combined patterns such as zebra bars with dotted borders. The renderer uses the recorded colours for bicolour zebras. It uses standard paint when no colours are recorded. The bake records provenance per carriageway strip and withholds disputed paint pending review. [OSM crossing marking patterns](https://wiki.openstreetmap.org/wiki/Key:crossing:markings)

Review is needed for 248 sign matches and 109 partial crossing matches. The asset also retains 2,016 signs, 66 raised surfaces, and five crossings whose positions lack a reliable directed edge association. Common cases are a sign between approaches, different relative layer codes in NWB and OSM, or an unlinked sidewalk endpoint.

The review covered the C3 sign on Notaris Fischerstraat, the raised zebra on Klinkenbergerweg, both carriageways at the signal-controlled refuge on Kastelenlaan, and the 4.2 m clearance sign at Keesomtunnel. In a headless Chromium WebGPU run, the layer added about 8–40 draw calls in the tested views. Median frame times generally stayed in the same 16.7 or 33.3 ms refresh interval. The final sign and supplementary-text atlases used 17.9 MiB of texture memory and building the layer took 209 ms.

## Refresh BGT street detail and 1GIS motorway infrastructure

The town-wide BGT bake fits vegetation, boundaries, street furniture, roadside barriers, drains and banks to the existing scene. It checks mapped gates, paths, driveways, boarding corridors, existing trees and civil structures. The land-cover mask distinguishes woodland, heath, grass, planting beds and courtyards and combines their materials with the existing aerial tint. The shoreline bake reconciles compatible BGT and OSM water polygons and cuts out ground-level park and square overlaps offline. The map, world and movement use those same outlines. Both bakes use the current Oude Kerk frame and 12 m AHN runtime grid. [PDOK BGT collections](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html) · [BGT source notes](tools/data/ede-bgt-detail.sources.md) · [Shoreline audit](tools/data/ede-shorelines.md)

Use local Gelderland and Utrecht OSM PBF extracts for gate openings. Fetch the dated BGT tiles, rebuild shorelines, then bake detail and land cover again against the new water outlines.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with osmium --with pyproj --with rasterio \
  python tools/build-ede-bgt-detail.py /tmp/ede-bgt-town --date 2026-11-19 --coverage town \
  --fetch --station-ahn --osm /tmp/gelderland.osm.pbf /tmp/utrecht.osm.pbf
uv run --with 'shapely>=2.1' python tools/build-ede-shorelines.py /tmp/ede-bgt-town \
  --date 2026-11-19 --report /tmp/ede-shoreline-report.json
uv run --offline --python 3.12 --with 'shapely>=2.1' --with pyproj --with rasterio \
  python tools/build-ede-bgt-detail.py /tmp/ede-bgt-town --date 2026-11-19 --coverage town
```

Run `build-ede-shorelines.py --audit --osm` to check the original OSM water polygons and `--audit` to check the shipped shorelines. Reuse the original snapshot date for an offline refresh.

Rijkswaterstaat’s Geografische Areaalregistratie supplies A12 and A30 infrastructure in RD New and metres NAP. The bake matches features to directed carriageways, NWB sections and fitted elevations. Surveyed paint replaces coincident procedural paint on the matching way. The lane graph supplies simulation lanes and access. [Rijkswaterstaat 1GIS](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer)

```sh
uv run --python 3.12 --with pyproj==3.8.0 --with 'shapely>=2.1' python tools/build-ede-1gis.py --report /tmp/ede-1gis-report.json
```

Add `/tmp/ede-1gis --fetch --save-snapshot tools/data/ede-1gis.snapshot.json.gz` to refresh the 1GIS snapshot. [Historical DTB reference](tools/data/ede-dtb-detail.sources.md)

NBd provides the destinations and drawing references for the blue motorway direction signs. 1GIS supplies mounting evidence and NDW supplies standard signs and supplementary plates. [NBd exports](https://downloads.rijkswaterstaatdata.nl/bewegwijzering/) · [NDW Verkeersborden](https://docs.ndw.nu/en/data-uitwisseling/interface-beschrijvingen/verkeersborden-api/v5/)

```sh
uv run --with 'pillow>=12.1' python tools/build-ede-nbd-signs.py /tmp/ede-nbd /tmp/ede-1gis --date 2026-11-18 --fetch
```

The game loads the baked assets locally in the Oude Kerk scene frame. Props use spatially tiled instances. Long barriers and directional sign faces use batched geometry. For a performance comparison, open the game with `?perf=1` and use `bgtStage=street`, `bgtStage=infrastructure`, or `bgtStage=all`. The existing `detail=off`, `bgtDetail=off`, `motorwayDetail=off`, and `nbdSigns=off` switches remain available. [Town and shoreline verification](tools/data/ede-bgt-town-verification.md) · [Motorway pilot verification](tools/data/ede-1gis-verification.md)

## Refresh the aerial colors

The 2025 PDOK orthophoto is downloaded in 1 km RD New tiles and sampled at 0.5 m. Inset building footprints use the median of brighter interior pixels to limit shadows and edge bleed. Roads and mapped cycle paths sample along their centerlines. A 3 m color grid supplies terrain, parks, pavement and squares, including Markt and Oude Kerkplein.

The browser uses the baked samples as vertex colors and keeps the procedural surface detail and road markings. It reads local assets at startup and uses procedural colors if the assets are unavailable.

With Python 3 and GDAL on your PATH:

```sh
python3 tools/fetch-ede-aerial.py /tmp/ede-aerial
python3 tools/build-ede-aerial.py /tmp/ede-aerial/ede-aerial-2025.vrt
```

## Refresh Ede’s façade layouts

The offline bake matches reviewed Mapillary views to individual LoD 2.2 walls. It uses CBS neighbourhoods, building types and wall roles to choose layouts for unobserved walls. Each distinct BAG building contributes one vote to a profile. The game uses an individual measurement first, then a supported neighbourhood profile, an Ede-wide profile for the same building type, or procedural shading. Mapped shared walls stay blank.

The game reads façade parameters near the camera alongside the existing BAG tiles. Shared tileable surfaces and material masks draw masonry, glazing, doors, frames and sills. Selected openings, including the Oude Kerk entrance and the Torenstraat storefront, use modeled recesses near the camera. The buildings retain their BAG proportions, and PDOK aerial colour supplies the roof reference. Street imagery stays in the offline review cache. [Mapillary evidence credits](assets/ede-facades.SOURCES.md)

The catalogue and bake can reuse the checked-in measurements. Omit `--fetch` to reuse the pinned BAG and CBS source cache.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 --with flatgeobuf \
  python tools/catalogue-ede-facade-walls.py /tmp/ede-facades-catalogue /tmp/ede-facades-walls.json --fetch
python3 tools/build-ede-facades.py /tmp/ede-facades-walls.json tools/data/ede-facade-observations.json \
  --report tools/data/ede-facade-coverage.json
```

To review new Mapillary views, set `MAPILLARY_TOKEN` in the local shell and add the views and measured opening bounds to the review manifest. The extractor accepts candidate views from [orthofacade](https://github.com/louis-e/orthofacade) through `--orthofacade /path/to/orthofacade/out/RUN` and `--metadata /path/to/orthofacade/cache/panos.json`.

```sh
python3 tools/fetch-ede-facade-views.py tools/data/ede-facade-reviews.json /tmp/ede-facade-images
uv run --with numpy --with opencv-python python tools/extract-ede-facades.py /tmp/ede-facades-walls.json \
  --metadata /tmp/ede-facade-images/metadata.json --images /tmp/ede-facade-images \
  --review tools/data/ede-facade-reviews.json --crops /tmp/ede-facade-crops \
  --output /tmp/ede-facade-observations.json
```

Review source matches, occlusion, colour and opening measurements before replacing the checked-in observation file. The bake report records profiles, fallback coverage and whole-building holdout results. [Coverage data](tools/data/ede-facade-coverage.json) · [Rendering verification](tools/data/ede-facades-verification.md)

## Refresh the tree inventory

PDOK BGT supplies individual tree locations. Ede’s municipal inventory enriches nearby points with species groups and height and trunk-diameter ranges. OpenStreetMap contributes additional tree locations. The build joins the sources in RD New, then writes one compact asset for the current scene grid. Missing sizes and species receive deterministic estimates, and woodland outside mapped clusters still gets procedural trees.

```sh
python3 tools/fetch-ede-trees.py /tmp/ede-tree-sources --date 2026-11-18
python3 tools/build-ede-trees.py /tmp/ede-tree-sources/pdok.geojson /tmp/ede-tree-sources/municipal.geojson --osm tools/data/osm_ede.json
```

The builder requires GDAL on your PATH. The optional OpenStreetMap snapshot is produced by the map refresh command. The browser samples AHN at each planted location and renders the trees with shared, instanced geometry in 200 m × 200 m tiles. Detail and visibility update with camera distance.

## Refresh the lamp-post inventory

```sh
uv run --with 'shapely>=2.1' python tools/build-ede-lamps.py --gis /tmp/ede-1gis/6.json \
  --save-bgt /tmp/ede-lamps-bgt.json.gz --report tools/data/ede-lamps.review.json.gz
```

The checked-in lamp asset joins the active PDOK BGT inventory to compatible 1GIS light points. Bridge lamps use the same level and fitted surface for their base, mounting direction, light target and pedestrian footprint. Reuse the saved BGT file with `--bgt` and keep the same layer 6 snapshot for an offline rebuild. [Lamp matching and De Poortwachter audit](tools/data/ede-lamps.sources.md)

## Refresh the bus routes

The game loads a local timetable and lane matches for both directions of Ede lines 1–4, 103 and 303. Stop signs use the GTFS boarding coordinates and platform letters. Buses display the GTFS trip headsign, and dwell at stops they can reach on connected lanes. Fresh OVapi positions guide the same scheduled actor along its route. Buses approach and leave the camera area at their current route positions. If no service is running at startup, the simulation opens at the next mapped departure.

```sh
curl -fL https://gtfs.ovapi.nl/nl/gtfs-nl.zip -o /tmp/ede-gtfs.zip
python3 tools/import-ede-gtfs.py /tmp/ede-gtfs.zip /tmp/ede-gtfs.json
node tools/export-ede-bus-road-graph.mjs > /tmp/ede-bus-graph.json
node tools/build-ede-bus-routes.mjs /tmp/ede-gtfs.json /tmp/ede-bus-graph.json assets/ede-bus-routes.json /tmp/ede-bus-match-report.json
```

The match report lists gaps by variant, including coordinates and affected boarding points. Matching uses actual graph turns, with separate edges for the mapped busways and selected underpasses. Buses are hidden inside tunnels whose interiors are outside the terrain model. Sections with no reliable connected lane are omitted from the driving simulation.

The November 2026 snapshot contains 81 variants, 64 of which enter the playable map. Of the 125 marked GTFS boarding locations, 121 have a reliable driving-lane match. See the [junction and route audit](tools/data/ede-junction-route-audit.md) for checks at the station forecourt, Oosttunnel and Stadspoort.

## Parking simulation

Parking uses 18,193 fitted spaces in 1,562 areas, in the same horizontal and vertical datum as the street scene. The bake merges mapped bays and estimates row capacity from BGT surfaces, WKD roadside coverage, and OpenStreetMap data. The [parking inventory notes](tools/data/ede-parking-sources.md) document sources, fit counts, restrictions, clearances, and the rebuild command.

Parkweg and Kuiperplein use local survey anchors. Other streets use Amsterdam time-of-day and weekday profiles. The station P+R has a weekday commuter profile and honours its published closure through 27 November 2026. Each garage has virtual spaces and separate access routes where mapped. The [demand notes](tools/data/ede-parking-demand.md) explain the source and dwell assumptions.

Parked cars use reusable instance tiles. Departures replace ambient spawns and arrivals divert cars already in the traffic pool. Up to four nearby cars can reserve spaces or manoeuvre at once. Cars yield at the Kuiperplein driveway, and the approach checker rejects curb movements across protected paths without a verified opening.

The local server supplies `/api/ede-parking`. Exact Q-Park readings require authorised NPR credentials in `EDE_NPR_USERNAME` and `EDE_NPR_PASSWORD` on the server. The simulation places cars in the mapped spaces or at garage entrances and exits. Readings expire after three minutes and occupancy eases into the local profile. Parkweg, Kuiperplein and the new station garage use surveyed or inferred occupancy. [NPR data access](https://www.nationaalparkeerregister.nl/downloads/certificaten-en-aanvraagformulieren)

For profiling, append `?parking=off` to the game URL. The debug API `window.__slopwaw.trafficSystem.parking.summary()` reports local capacity, occupancy, source, and completed arrivals and departures by area. The [parking verification report](tools/data/ede-parking-verification.md) records the fixed-time checks and performance comparison.

## Passenger trains

NS services follow the Utrecht–Arnhem main line through Ede-Wageningen. RRReis RS34 follows the Valleilijn through Ede Centrum and reverses at Ede-Wageningen. The trains use the same mapped rails, turnouts and elevation profiles as the track renderer. Berth centers are estimated from the mapped platforms. The simulator keeps up to eight nearby trains in a reusable pool and shows the closest train’s number, data status and track when known.

The server publishes local services at `/api/ede-trains`. NS position reports come from NDOV’s key-free stream. To enable that stream, install `pyzmq` in the server’s Python environment or start with `uv run --with pyzmq python tools/serve-ede.py`. The default GPS prediction window is 32 seconds and can be changed with `data-train-prediction-seconds` in `index.html`. The browser advances each train along the matched track and brakes for the next confirmed stop. After the window, a matched service continues on a timetable estimate aligned with the last predicted position. An unmatched service retires when its prediction expires. [NDOV real-time feeds](https://govi.nu/realtime.html)

OVapi supplies RS34 delays, changes to station times and platforms, skipped stops and cancellations. The server polls every minute. After three minutes, timing switches to a timetable estimate. The server retains dated cancellations through feed gaps. Train status reads **GPS**, **estimated from live updates**, or **timetable**. Service dates follow Europe/Amsterdam, including trips continuing after midnight, regardless of the lighting mode. [OVapi rail updates](https://gtfs.ovapi.nl/nl/)

The bundled timetable covers 18 November 2026 through 11 December 2027. Offline mode and static hosting use that timetable for both operators. Outside the bundled dates, the simulator reuses the closest bundled service pattern for the same weekday. Refresh the local asset from the [OVapi GTFS archive](https://gtfs.ovapi.nl/nl/).

```sh
python3 tools/import-ede-trains.py ./gtfs-nl.zip assets/ede-train-timetable.json
```

The final WebGPU check in headless Chrome at 960 × 537 ran two 100-frame passes with two trains drawn and two passes along the same camera route with train drawing hidden. All four passes measured 16.7 ms at the median and 95th percentile. An earlier pair of runs measured 33.4 ms at the 95th percentile in both conditions. The train update itself measured 0.1 ms at the 95th percentile. These tests used the offline map.

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

Explore other cities and community remixes in [Slop Cities](https://github.com/zz85/slop-cities).

## License and data

- Project code is available under the [MIT License](LICENSE).
- Streets, parks, water, trees, shops, and fallback building footprints are © OpenStreetMap contributors under [ODbL](https://www.openstreetmap.org/copyright).
- Building geometry is © 3DBAG by tudelft3d and 3DGI under [CC BY 4.0](https://docs.3dbag.nl/en/copyright/).
- District labels are based on the [CBS Wijk- en Buurtkaart 2025](https://www.cbs.nl/nl-nl/dossier/nederland-regionaal/geografische-data/wijk-en-buurtkaart-2025).
- Ede’s coat of arms is from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Coat_of_arms_of_Ede.svg) (public domain).
- Terrain uses the [AHN ground model via PDOK](https://www.pdok.nl/introductie/-/article/actueel-hoogtebestand-nederland-ahn).
- Vertex colors are derived from the [2025 Beeldmateriaal.nl aerial orthophoto via PDOK](https://nationaalgeoregister.nl/geonetwork/srv/metadata/7b424340-25c5-4c95-8dbf-bf1d87888566) under CC BY 4.0.
- Offline façade measurements use Mapillary imagery under CC BY-SA 4.0. [Evidence credits](assets/ede-facades.SOURCES.md)
- Lamp-post locations are from [PDOK BGT](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/paal?f=html) (CC0).
- Civil structures and road surface evidence use [PDOK BGT](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html) (CC0). Rail alignment and crossing controls were checked against [ProRail Basiskaart](https://maps.prorail.nl/arcgis/rest/services/ProRail_basiskaart/FeatureServer).
- Directional access and selected clearance limits use the [Rijkswaterstaat WKD](https://docs.ndw.nu/en/handleidingen/wkd/).
- Tree locations are from [PDOK BGT](https://api.pdok.nl/kadaster/bgt/ogc/v1?f=html&lang=nl) (CC0). Tree attributes are from the [municipal Ede inventory](https://data.overheid.nl/dataset/39339aa2-a7dc-4f52-bcdb-f1eff423b69f) (public domain).
- Bus timetables and stops come from the [OVapi Dutch GTFS feed](https://gtfs.ovapi.nl/nl/) (CC0 1.0, shapes ODbL 1.0). Line identities and station platforms were cross-checked against the [RRReis Ede overview](https://www.rrreis.nl/reisinformatie/haltes-dienstverlening/dienstregeling-bus/regio-ede).
