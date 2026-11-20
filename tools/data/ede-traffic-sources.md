# Ede traffic access sources

OpenStreetMap supplies the directed way geometry and access, lane, one-way, speed and vehicle-clearance tags. Traffic follows shared OSM node IDs across junctions. A crossing in plan view leaves the road networks separate unless the ways share a node. Ambient through traffic uses general-access ways. Local-access, delivery-only, permit-only and private ways require a destination or permission. The simulator’s ambient fleet has neither.

The generated map combines OSM with the [Rijkswaterstaat WKD vehicle type and clearance service](https://geo.rijkswaterstaat.nl/services/ogc/gdr/wkd_wegkenmerkendatabase/ows). The 18 November 2026 query returned 6,767 vehicle-type segments and seven height-limit segments within the playable bounds, with zero weight, length or axle-load examples. Matching samples close, nearly parallel lines and uses directional permissions only when most samples agree. Direct OSM access and lane tags, known signed facilities, and precise GTFS route evidence take precedence over ambiguous matches. WKD attaches the 2.0 m limit around Molenstraat to the NWB through-road geometry. OSM identifies the adjacent capped car-park approaches, so that imperfect match stays off the through road.

To rebuild the WKD-enriched OSM export, run this from the repository root with the original Overpass snapshot available.

```sh
mkdir -p /tmp/ede-wkd
for layer in verkeerstypen hoogtebeperkingen; do
  curl -fsSG 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/wkd_wegkenmerkendatabase/ows' \
    --data 'service=WFS' --data 'version=2.0.0' --data 'request=GetFeature' \
    --data "typeNames=$layer" --data 'srsName=EPSG:4326' \
    --data 'bbox=5.5925,52.012,5.7005,52.0605,EPSG:4326' \
    --data 'outputFormat=application/json' -o "/tmp/ede-wkd/$layer.json"
done
node tools/build-ede-geodata.mjs tools/data/osm_ede.json assets/ede-map-v1.json.gz /tmp/ede-wkd
```

[Kadaster BGT road areas](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections) provide physical role and width evidence where the same-layer overlap is strong. Explicit OSM widths take precedence. The BGT physical role by itself conveys no traffic permission.

The [Ede station traffic decision and signing plan](https://zoek.officielebekendmakingen.nl/gmb-2024-120844.html) reserve the north-east platforms, the turn toward them, and a dedicated Akulaan approach lane for scheduled buses. The remaining public forecourt includes taxi and Kiss & Ride access. The station’s general 10 m restriction exempts scheduled buses. The public through portion of Akulaan has three ordinary lanes and a bus lane on the mapped four-lane approach. Willy Brandtlaan has a separate tagged busway and one adjacent through segment with an ordinary lane and a bus lane. OSM, WKD, and mapped GTFS routes distinguish these connections from their neighboring public lanes.

The posted-speed asset comes from the 1 November 2026 WKD `Snelheden.gpkg` release. The build compares the clipped NWB road sections to directed simulator edges in RD New, using the source’s H, T and B direction codes, geometry, and street names where available. It requires agreement across at least 80% of the edge and uses the WKD’s 100% confidence rows. OSM limits or the simulator’s road defaults cover unmatched edges. The asset contains 6,524 directed matches, including 282 limits with daily schedules evaluated in Europe/Amsterdam. [WKD Maximum snelheden](https://docs.ndw.nu/handleidingen/wkd/wkd_maxsnelheden/) · [November GeoPackage](https://downloads.rijkswaterstaatdata.nl/wkd/geogegevens/Geopackage/Maximum%20snelheden/01-11-2026/)

Rebuild the local asset from the extracted GeoPackage.

```sh
uv run --with pyproj==3.8.0 python -B tools/build-ede-posted-speeds.py Snelheden.gpkg 2026-11-01 assets/ede-posted-speeds.json
```

The local server joins the NDW speed and intensity publication to the exact site and configuration version. It takes aggregate vehicle counts per direction and weights observed lane speeds by their sample counts. Matched detectors influence their own directed edge. For temporary speed limits and complete closures, the server requires a mandatory, implemented record with a validity window and a directional GML line covering enough of the edge. Point-only measures, lane-only closures, ambiguous level matches, and records located only through unverified ALERT-C/VILD codes, OpenLR references or external identifiers fall outside that coverage. Traffic observations expire six minutes after the measured minute. Measures expire by their stated end time or five minutes after their source publication, whichever comes first. [NDW open data](https://opendata.ndw.nu/) · [DATEX II v3.6 traffic profile](https://mogin.nl/publicaties/Verkeersinformatie/Verkeersdata/vigerend/index.html) · [DATEX II v3.6 location profile](https://mogin.nl/publicaties/Verkeersinformatie/Locatiereferentie/vigerend/index.html)

The 19 November 2026 00:09 Amsterdam sample supplied flows on 32 directed Ede edges and observed speeds on 23 of those. It returned eight closure records covering parts of Lunterseweg, Stakenberg, Rembrandtlaan and Lumièrestraat. The 00:20 Amsterdam temporary-speed publication had 133 records with GML lines, zero OpenLR-only records, and zero GML lines intersecting the Ede map bounds. [NDW open data](https://opendata.ndw.nu/)

The rail sites with elevation profiles are listed in [the grade source notes](ede-grade-sources.md). For other mapped tunnels, the model preserves the topology and avoids placing ambient agents on an unverified floor. Timetabled bus progress is preserved through sections without a modeled interior.

## Walking and cycling

Cycle routing follows OSM cycleways, designated shared paths, and explicitly mapped cycle lanes or tracks. Directional access combines OSM permissions with WKD on corroborated BGT cycle paths. A shared motor-road connector may be up to 24 m long when both ends meet dedicated facilities at mapped nodes. Shared-lane markings and explicitly advisory strips, including the tagged stretches of Arnhemseweg and Willy Brandtlaan, stay outside the ambient cycling graph pending imagery that identifies a cycle lane. [OSM cycleway tagging](https://wiki.openstreetmap.org/wiki/Key:cycleway)

The separate [WKD cycle-strip extract](ede-wkd-cycle-strips.json) contains 266 Ede records from the latest published GeoPackage, reference date January 31, 2026. The RWS layer combines cycle lanes and advisory strips, so its direction flags only corroborate an already mapped lane. Matching found consistent flags on 78 of 141 OSM ways tagged with a lane or shared lane, including 51 of 97 ways used for cycling lanes. WKD flags also matched 27 excluded ways. One plain lane tag on Nieuwe Maanderbuurtweg was narrowed to the forward direction. Explicit OSM sides and directions retain priority, and missing, inconsistent or out-of-date data leaves the OSM default in place. Bridges, tunnels and other non-ground-level routes retain their OSM direction. [NDW field definitions](https://docs.ndw.nu/en/handleidingen/wkd/wkd_fietssuggestiestroken/) · [Rijkswaterstaat CC0 data record](https://data.overheid.nl/en/dataset/73729-wegkenmerkendatabase-voor-fiets-suggestie-stroken)

To refresh the local extract, unpack the official download, read its reference date in `Definitie.txt`, and run the clip before rebuilding Ede geodata.

```sh
cycle_source='https://downloads.rijkswaterstaatdata.nl/wkd/geogegevens/Geopackage/Fiets%28suggestie%29stroken/01-01-2026.zip'
uv run --with pyproj==3.8.0 python -B tools/clip-ede-wkd-cycle-strips.py /path/to/WKD_FIETSSTRK.gpkg \
  2026-01-31 "$cycle_source" tools/data/ede-wkd-cycle-strips.json
```

The [supplemental crossing snapshot](ede-active-crossing-nodes.json) records 69 crossing, give-way and stop nodes from the November 19 OpenStreetMap API map responses around the old town centre and the N224. The generator matches the node IDs to its existing OSM way geometry. Zebra, signal and other crossing tags stay attached to the active route where the geometry actually intersects a motor road on the same level. [OpenStreetMap API](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data:_GET_/api/0.6/map)

Plaza paths stay inside publicly mapped squares and around water, building footprints, street furniture and mapped holes. Shops map to a nearby walkable approach within 16 m. Grotestraat and Maandereind connect through the public pedestrian network to Markt and Oude Kerkplein.

## Live buses

The local server decodes the OVapi VehiclePositions feed, filters for exact imported Ede trip IDs and drops positions outside the playable area. Feed and vehicle timestamps expire after two minutes. The browser joins a fresh vehicle to the exact service date, trip, route direction and headsign, then projects it to the baked lanes when the snapshot arrives. An unmatched trip continues on the timetable. A matched position that cannot be placed safely on its own route does not create a separate actor. [OVapi GTFS-Realtime](https://gtfs.ovapi.nl/nl/vehiclePositions.pb)

A live browser check received 32 flow observations, 23 observed speeds, eight closure records and seven Ede bus positions from the local server. A fresh OVapi position activated one line 103 bus to Ede Station on its matched route.

The same schedule and live trip share one actor. Fresh observations guide speed toward predicted progress along the route while stop dwell, local traffic and closures still govern movement. An active bus clears its current edge and tries a bounded legal detour back to a connected route lane before its next boarding stop. It waits when no such route is available. New buses activate within 350 m of the camera and recycle beyond 430 m. The city’s offline timetable is bundled with the game.

## Local population and timings

The [traffic pilot](ede-traffic-pilot.md) documents the current destination sampling, verified controls and level crossings. The historical measurements below predate the pilot.

Directed lane area inside the camera radius determines car demand. NDW count estimates adjust the weight of the represented direction. Cycle and walking spawns are weighted by the nearby usable path and plaza area. The engine refreshes the nearby spatial queries when the camera has moved 35 m. It caps normal spawn attempts at three each for cars, bicycles and pedestrians per frame. After a jump the caps are eight each for cars and bicycles and twelve for pedestrians. Offscreen margins absorb normal replenishment. The same actor pools serve both offline and live play.

Measured on 19 November 2026 in headless Chrome WebGPU on macOS using a 960 × 680 browser window, the 09:30 Amsterdam demand profile and a cold profile with external requests blocked. The baseline was `fee6163` with the same pinned Three.js runtime served locally. Each measurement used 80 rendered frames, first near the town centre and then across five camera jumps. CPU time measures the game’s traffic update including pedestrian poses. Frame intervals also include render and GPU pacing.

| Scenario | Traffic CPU p50 / p95 before | Traffic CPU p50 / p95 after | Frame interval p95 before / after |
| --- | ---: | ---: | ---: |
| Street level | 1.7 / 2.0 ms | 0.4 / 0.6 ms | 16.7 / 16.7 ms |
| Camera jumps | 1.9 / 4.0 ms | 0.5 / 0.8 ms | 33.4 / 33.3 ms |

A repeat after the final WKD cycle-strip import measured traffic CPU p95 of 0.7 ms at street level and 0.8 ms at camera jumps. Total frame interval p95 in that run was 33.4 ms and 50.0 ms respectively. These runs show a traffic CPU reduction while total frame pacing varied.

The centre sample went from 200 cars, 450 bikes and 1,000 pedestrians to 25 cars, 20 bikes and 73 pedestrians. The new road and active-travel setup took about 0.70 s at startup compared with 0.42 s before. The upgraded game reached an interactive offline scene with all external URLs blocked.

A browser fixture applied a 12 km/h temporary limit to an occupied directed edge. The car held the cap while the reverse direction stayed at 30 km/h, and the cap reverted on expiry. A line 2 bus to Rietkampen held its route and identity across a simulated position correction and reverted to the timetable after expiry. At Parkweidepad Zuid, a cyclist reached the far approach while a car passed at a height difference of about 2.6 m. The downtown check walked a usable plaza path and cleared a mapped 4.1 m yield crossing.
