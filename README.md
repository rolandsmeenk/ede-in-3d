# Slop Ede

Explore Ede in 3D, from Oude Kerk and Marktplein to Kernhem, Rietkampen, Maandereng, Veluwse Poort, and the western business parks. Travel on foot, by car, bicycle, or helicopter.

Forked from [Slop Utrecht](https://github.com/bertt/slop-utrecht), based on [Slop New York](https://github.com/mrdoob/slop-newyork).

## Run locally

Run the local server and open [localhost:8000](http://localhost:8000). Live road data matching uses Node.js 22 or later.

```sh
python3 tools/serve-ede.py
```

Add `--offline` to skip upstream traffic and weather feeds. A plain static server such as `python3 -m http.server 8000` also runs the offline traffic model. Three.js, OpenStreetMap geometry, posted limits, and the timetable are local. The simulator streams LoD 2.2 buildings when 3DBAG is reachable and uses OpenStreetMap footprints otherwise.

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

## Refresh structures and grade-separated routes

The BGT snapshot provides decks, abutments, railway platforms, walls, pylons, tanks, open sheds and turbines. The builder joins related geometry, clips to the map extent and filters overlapping BAG/OSM structures. A second build matches BGT surfaces and widths to OSM ways at the same relative level. The road build combines that physical evidence with directional access tags and WKD.

```sh
uv run --with 'shapely>=2.1' python tools/build-ede-bgt.py /tmp/ede-bgt --date 2026-11-18 --fetch
uv run --with 'shapely>=2.1' python tools/build-ede-bgt-roads.py /tmp/ede-bgt-roads --date 2026-11-18 --fetch --report /tmp/ede-bgt-road-report.json
```

Omit `--fetch` to reuse a downloaded snapshot. The road evidence builder samples the generated OSM map, so build a new OSM snapshot before matching it and rebuild the map afterward to apply the evidence. The [crossing profile notes](tools/data/ede-grade-sources.md) give the ProRail refresh queries and record the measured and estimated heights for each modeled crossing. Road and path contact, walls, and the follow camera use those layered surfaces while the rail renderer keeps its OSM alignment. Level crossing equipment is modeled in its open position.

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

Add `--fetch` to the sign importer for the latest placed signs. Reuse the downloaded inputs to rebuild offline. The resulting `assets/ede-street-features.json.gz` is loaded locally. Each road or path reference gives a directed key, layer, mode mask, confidence, and a distance or interval in metres from the directed edge's start. The mask uses 1 for car, 2 for van, 4 for bus, 8 for bicycle, and 16 for foot. `forRoad(edge)`, `forPath(track, direction, mode)`, and `forEdge(key)` return features in travel order. A single feature can have several references. Uncertain and unmatched records retain their raw evidence and review reason. The renderer uses these records for geometry only. The existing simulation still handles access, speed, and yielding.

Measured footprints supply length and width where available. OSM-only hump, short bump, raised table, and cushion length defaults are 3.5, 1.2, 7, and 2.5 m, with modelled heights of 8, 6, 8, and 7 cm respectively. Tables use short linear ramps and humps use a rounded longitudinal profile. The same profile sets the stripe height on a raised zebra. [NDW Drempels](https://verkeersveiligheid.ndw.nu/dataset/drempels) · [WKD pedestrian crossings](https://verkeersveiligheid.ndw.nu/dataset/voetgangersoversteekplaatsen) · [NDW open-data terms](https://docs.ndw.nu/algemeen/data-gebruiksvoorwaarden/)

The snapshot contains 6,345 sign locations, 966 humps and tables, and 201 crossings. The renderer has exact artwork for 5,958 sign faces and paints 119 confirmed zebras. The 82 other crossing records retain their mapped signal controls. Nine crossings link to a raised feature. Of the 18 reported refuges, four have a mapped position and separate carriageway strips.

Review is needed for 248 sign matches and 109 partial crossing matches. The asset also retains 2,016 signs, 66 raised surfaces, and five crossings whose positions lack a reliable directed edge association. Common cases are a sign between approaches, different relative layer codes in NWB and OSM, or an unlinked sidewalk endpoint.

The review covered the C3 sign on Notaris Fischerstraat, the raised zebra on Klinkenbergerweg, both carriageways at the signal-controlled refuge on Kastelenlaan, and the 4.2 m clearance sign at Keesomtunnel. In a headless Chromium WebGPU run, the layer added about 8–40 draw calls in the tested views. Median frame times generally stayed in the same 16.7 or 33.3 ms refresh interval. The final sign and supplementary-text atlases used 17.9 MiB of texture memory and building the layer took 209 ms.

## Refresh the aerial colors

The 2025 PDOK orthophoto is downloaded in 1 km RD New tiles and sampled at 0.5 m. Inset building footprints use the median of brighter interior pixels to limit shadows and edge bleed. Roads and mapped cycle paths sample along their centerlines. A 3 m color grid supplies terrain, parks, pavement and squares, including Markt and Oude Kerkplein.

The browser uses the baked samples as vertex colors and keeps the procedural surface detail and road markings. It reads local assets at startup and uses procedural colors if the assets are unavailable.

With Python 3 and GDAL on your PATH:

```sh
python3 tools/fetch-ede-aerial.py /tmp/ede-aerial
python3 tools/build-ede-aerial.py /tmp/ede-aerial/ede-aerial-2025.vrt
```

## Refresh the Mapillary façade pilot

The pilot uses individual LoD 2.2 wall segments at Kolkakkerweg, on Torenstraat, and at the Oude Kerk west entrance. Reviewed Mapillary views supply measured masonry and openings. The builder groups observations by CBS neighbourhood, building type, and wall type, with one statistical vote per BAG building and Ede-wide profiles for groups with enough coverage. The game fits the layouts to the original BAG meshes and keeps the procedural texture on unsupported walls.

A shared mask atlas supplies opaque glazing, doors, frames, and sills in the original building batches. The Oude Kerk entrance has a fitted recess and projecting surround. The church and storefront share a photo atlas that loads when the camera approaches. Valid PDOK roof samples take priority over street-image or learned roof colours.

Set `MAPILLARY_TOKEN` to a Mapillary client access token for the imagery refresh. The image cache and reviewed crops stay local. With `uv` on your PATH:

```sh
uv run --with 'shapely>=2.1' --with pyproj python tools/catalogue-ede-facade-walls.py \
  /tmp/ede-facade-bag /tmp/ede-facade-walls.json --fetch
python3 tools/fetch-ede-facade-views.py tools/data/ede-facade-reviews.json /tmp/ede-facade-images
uv run --with numpy --with opencv-python python tools/extract-ede-facades.py /tmp/ede-facade-walls.json \
  --metadata /tmp/ede-facade-images/metadata.json --images /tmp/ede-facade-images \
  --review tools/data/ede-facade-reviews.json --crops /tmp/ede-facade-crops \
  --output tools/data/ede-facade-observations.json
uv run --with pillow python tools/bake-ede-facade-photos.py tools/data/ede-facade-photo-crops.json \
  /tmp/ede-facade-crops assets/ede-facade-pilot.webp /tmp/ede-facade-photos.json
python3 tools/build-ede-facades.py /tmp/ede-facade-walls.json tools/data/ede-facade-observations.json \
  --photos /tmp/ede-facade-photos.json --report /tmp/ede-facade-report.json \
  --hold-out NL.IMBAG.Pand.0228100000073648
```

Omit `--fetch` to reuse the BAG and CBS cache. The extractor also reads candidate walls from [orthofacade](https://github.com/louis-e/orthofacade) with `--orthofacade /path/to/orthofacade/out/RUN --metadata /path/to/orthofacade/cache/panos.json`. Review new views and opening bounds before expanding the pilot. The bake report shows coverage and compares inferred layouts against photos of complete held-out BAG buildings. [Photo credits and licence](assets/ede-facade-pilot.LICENSE.md)

The pilot ships 10 observed walls, 178 inferred terraced street façades, and 10 blank shared walls. Three distinct terraced houses train the neighbourhood and Ede-wide street profiles. Apartment, detached-house and shop observations remain specific to the measured buildings while those groups collect coverage. The modelled Oude Kerk entrance depth is estimated at 0.28 m from the visible surround.

Separate holdout runs withheld BAG buildings `0228100000073648` and `0228100000073646`. Each inferred the three measured windows and one door. Window-spacing errors were 0.126 m and 0.031 m, and door-position errors were 0.311 m and 0.339 m. Wall-colour distances were 8.37 and 3.0 in sRGB. A third split, `0228100000073661`, had a 0.459 m spacing error and a 72.23 sRGB colour distance. Its photo did not provide a usable door measurement. To repeat the other splits, replace the `--hold-out` ID and set `--output` to a temporary path.

A paired WebGPU run used the same walking-height frontal and oblique cameras with the façade asset enabled and blocked. The 198 wall records matched four BAG batches. The first local frame took 8.90 s without the pilot and 9.05 s with it. The mask atlas and the camera-local photo atlas used 10.5 MB and 2.8 MB of texture memory, respectively. The visible photo tile added one batched draw, and the first shopping approach peaked at 33.3 ms in both runs.

## Refresh the tree inventory

PDOK BGT supplies individual tree locations. Ede’s municipal inventory enriches nearby points with species groups and height and trunk-diameter ranges. OpenStreetMap contributes additional tree locations. The build joins the sources in RD New, then writes one compact asset for the current scene grid. Missing sizes and species receive deterministic estimates, and woodland outside mapped clusters still gets procedural trees.

```sh
python3 tools/fetch-ede-trees.py /tmp/ede-tree-sources --date 2026-11-18
python3 tools/build-ede-trees.py /tmp/ede-tree-sources/pdok.geojson /tmp/ede-tree-sources/municipal.geojson --osm tools/data/osm_ede.json
```

The builder requires GDAL on your PATH. The optional OpenStreetMap snapshot is produced by the map refresh command. The browser samples AHN at each planted location and renders the trees with shared, instanced geometry in 200 m × 200 m tiles. Detail and visibility update with camera distance.

## Refresh the lamp-post inventory

```sh
python3 tools/build-ede-lamps.py
```

The checked-in asset contains active PDOK BGT lamp posts within the game map. Pole bases follow AHN terrain, and the lamp models use a standard height and face the nearest road where possible.

## Refresh the bus routes

The game loads a local timetable and lane matches for both directions of Ede lines 1–4, 103 and 303. Stop signs use the GTFS boarding coordinates and platform letters. Buses display the GTFS trip headsign, and dwell at stops they can reach on connected lanes. Fresh OVapi positions guide the same scheduled actor along its route. Buses approach and leave the camera area at their current route positions. If no service is running at startup, the simulation opens at the next mapped departure.

```sh
curl -fL https://gtfs.ovapi.nl/nl/gtfs-nl.zip -o /tmp/ede-gtfs.zip
python3 tools/import-ede-gtfs.py /tmp/ede-gtfs.zip /tmp/ede-gtfs.json
node tools/export-ede-bus-road-graph.mjs > /tmp/ede-bus-graph.json
node tools/build-ede-bus-routes.mjs /tmp/ede-gtfs.json /tmp/ede-bus-graph.json assets/ede-bus-routes.json /tmp/ede-bus-match-report.json
```

The match report lists gaps by variant, including coordinates and affected boarding points. Matching uses actual graph turns, with separate edges for the mapped busways and selected underpasses. Buses are hidden inside tunnels whose interiors are outside the terrain model. Sections with no reliable connected lane are omitted from the driving simulation.

The November 2026 snapshot contains 79 variants, 62 of which enter the playable map. All 125 GTFS boarding locations in the scene are marked. See the match report for the current list of stops and route sections that lack a reliable lane.

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
- Façade observations use [Mapillary](https://www.mapillary.com/) imagery. The photo adaptations are distributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). [Photo credits](assets/ede-facade-pilot.LICENSE.md)
- Lamp-post locations are from [PDOK BGT](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/paal?f=html) (CC0).
- Civil structures and road surface evidence use [PDOK BGT](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html) (CC0). Rail alignment and crossing controls were checked against [ProRail Basiskaart](https://maps.prorail.nl/arcgis/rest/services/ProRail_basiskaart/FeatureServer).
- Directional access and selected clearance limits use the [Rijkswaterstaat WKD](https://docs.ndw.nu/en/handleidingen/wkd/).
- Tree locations are from [PDOK BGT](https://api.pdok.nl/kadaster/bgt/ogc/v1?f=html&lang=nl) (CC0). Tree attributes are from the [municipal Ede inventory](https://data.overheid.nl/dataset/39339aa2-a7dc-4f52-bcdb-f1eff423b69f) (public domain).
- Bus timetables and stops come from the [OVapi Dutch GTFS feed](https://gtfs.ovapi.nl/nl/) (CC0 1.0, shapes ODbL 1.0). Line identities and station platforms were cross-checked against the [RRReis Ede overview](https://www.rrreis.nl/reisinformatie/haltes-dienstverlening/dienstregeling-bus/regio-ede).
