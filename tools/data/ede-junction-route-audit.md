# Ede junction and route audit

## Sources and rebuild

The November 18, 2026 21:21 UTC Geofabrik extracts supplied 50 OpenStreetMap turn relations whose member ways are in the checked-in Ede map. Forty-four use one via node and six use via ways. The importer found every required member and node location. Two Parkweide relations prohibit a same-way U-turn at nodes where the driving graph already offers no reversal.

The game matches the from and to ways through their OSM junction and preserves short links needed to make the maneuver explicit. Car, van and bus lanes use the directional permissions alongside turn arrows, and bus map matching carries the same restriction state between GTFS observations. The bicycle graph applies mode-specific node rules at mapped endpoints. None of the six via-way relations has a continuous mapped bicycle or pedestrian approach. The importer reports conditional or incomplete restrictions when present because their applicability needs more data. [OSM turn restriction tagging](https://wiki.openstreetmap.org/wiki/Relation:restriction) · [Geofabrik Netherlands extracts](https://download.geofabrik.de/europe/netherlands.html) · [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)

```sh
uv run --with osmium python -B tools/extract-ede-turn-restrictions.py gelderland.osm.pbf utrecht.osm.pbf
python3 -B tools/import-ede-gtfs.py /tmp/ede-gtfs.zip /tmp/ede-gtfs.json
node tools/export-ede-bus-road-graph.mjs > /tmp/ede-bus-graph.json
node tools/build-ede-bus-routes.mjs /tmp/ede-gtfs.json /tmp/ede-bus-graph.json assets/ede-bus-routes.json /tmp/ede-bus-match-report.json
node --test tests/ede-junctions.test.cjs tests/ede-bus-traffic.test.cjs
```

## Corridor results

| Corridor | Verified route |
| --- | --- |
| Polar Bearsplein | OVapi feed 9704 matches all seven local boarding IDs across platforms A, D, E, F, G and H. The forecourt has zero disconnected GTFS spans within X 84–260 m and Z 2138–2255 m. The signed bus entrance and platform ways accept buses. The separate public approach leads to the taxi and Kiss & Ride side. The mapped public foot route on OSM way 1091698001 joins the southern Oosttunnel portal. |
| Oosttunnel and Doctor Hartogspad | At OSM node 11665059358, the fitted Hartogspad ramp connects layer 2 way 1363871988 to ground approach 1549067719 in both directions for people walking and cycling. Local cycling can reach Westtunnel via the mapped surface network. The passenger passage connects north and south on ways 1091698001, 1507807928, 1507807929 and 1410324046. The upper platform walk and passenger passage are about 6.4 m apart where their mapped centerlines meet in plan. The route graph requires a fitted connector at that transition. |
| Stadspoort | All three OVapi boarding IDs match and there are zero disconnected GTFS spans within 220 m of X −1460 m, Z 3110 m. The Doctor W. Dreeslaan approach obeys OSM relation 17891121, and turn history enforces the separate via-way rules at the Laan der Verenigde Naties junction. The elevated shopping passage on way 262752271 and both lower paths on ways 25546150 and 25546158 are traversable in both directions on their respective levels. |

The station bus bake uses clear, legal lane connectors to enter the signed Akulaan bus lane and select the receiving lanes through the short Klinkenbergerweg junction links. With the same restricted graph and feed, the first bake reported 58 disconnected spans totaling 976 m south of the forecourt, within X 40–200 m and Z 2250–2320 m. Lane matching reduced that to 21 spans totaling 245 m across all variants. The remaining spans are retained as gaps where the required upstream lane could not be matched continuously to the operator shape. The bundle contains 81 variants and 304 verified connected slices. All 125 in-map boarding IDs remain marked, including the same four outlying IDs without a reliable driving-lane match. [Ede traffic order and signing plan](https://zoek.officielebekendmakingen.nl/gmb-2024-120844.html) · [OVapi feed](https://gtfs.ovapi.nl/nl/) · [OSM Stadspoort turn relation](https://www.openstreetmap.org/relation/17891121)

### Refuge approach near Stadspoort

The Frans Halslaan crossing at X −1276.4 m, Z 3223.0 m is tagged with a refuge. The street-feature snapshot supplies one estimated strip and no measured island. Both inferred curb ends match the same cycleway, way 24831856. The cycling graph contains a ground-level yield approach with an onward link on one side. The walking graph has no matching carriageway crossing. A complete route needs evidence for the opposite approach and the island connection. [OSM crossing 12516134849](https://www.openstreetmap.org/node/12516134849)

The station operator confirms stairs, up-only escalators and lifts to the platforms. The current grades support the passage itself and the surface walks. The platform stair and lift transitions need surveyed elevations before pedestrian routing can traverse them. [Spoorzone Ede station accessibility](https://www.spoorzone-ede.nl/nieuw-station/toegankelijkheid) · [Stations and platforms](https://www.spoorzone-ede.nl/nieuw-station/station-ede-wageningen) · [Ede crossing survey](ede-crossing-audit.md)
