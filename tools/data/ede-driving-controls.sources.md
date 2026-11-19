# Ede traffic control pilot

The pilot uses the direction, layer, mode and station already baked into the Ede street furniture. Humps and tables require a matched footprint. A zebra must have marked carriageway geometry, two linked curb endpoints and a same-level walking route that crosses a linked carriageway. Waiting and crossing pedestrians use the same crossing ID as the driver. [Street feature sources](ede-street-sign-sources.md)

Stop points and give-way markings also use OpenStreetMap nodes on their original way. The extractor keeps explicitly directed nodes and nodes on one-way roads with a single usable direction. The runtime checks heading, layer, lateral offset and distance to a junction. The standing stop in the simulation is 1.25 seconds. A directional B7 sign alone cannot locate the stop point. An unconditional B6 sign can establish a give-way approach when its directional match reaches the junction. [OSM stop tagging](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dstop) · [OSM give-way tagging](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dgive_way)

Roundabout entries yield to traffic on the same-level ring when the driving graph has an actual movement onto an OSM-tagged ring and a circulating approach. [OSM roundabout tagging](https://wiki.openstreetmap.org/wiki/Tag:junction%3Droundabout)

## Mapped checks

| Site | Evidence | Behavior checked |
| --- | --- | --- |
| Asakkerweg approach near the N224 | NDW B7 `c01d0793-4a00-4365-9b03-025898639479` and [OSM stop node 14029357144](https://www.openstreetmap.org/node/14029357144) | The directed approach stops upstream of the junction, stands for 1.25 seconds and checks cross traffic. |
| Doctor Willem Dreeslaan | [OSM stop node 9931984746](https://www.openstreetmap.org/node/9931984746) | The node matches the forward motor approach. |
| Molenstraat | NDW zebra `ndw-vop-4407`, hump `ndw-drempel-263167` and [OSM crossing 9726439421](https://www.openstreetmap.org/node/9726439421) | The hump caps approach speed and the road and walking route share one zebra ID. |
| Klinkenbergerweg | NDW table `ndw-drempel-264233` and zebra `ndw-vop-22686` | The table's approach cap is applied on both driving directions. The zebra still needs a usable pedestrian route in the simulation. |
| Telefoonweg | [OSM approach 6953898](https://www.openstreetmap.org/way/6953898), [ring 668532572](https://www.openstreetmap.org/way/668532572) | Entering traffic checks the circulating approach. |

The headless road-graph check linked 898 of 966 humps and tables, 17 of 119 marked zebras with walking routes, 94 of 558 B6 signs and 70 of 141 directional OSM control nodes. The linked nodes include two stops and 68 give-way points. Fifty-three more zebras have motor lane geometry and still need a usable walking route. The graph binds 49 roundabout entries. Runtime totals use the final drivable and walkable graph, which reflects local obstructions.

The map contains 251 OSM signal locations and the street features identify 82 signalized crossings. Those sources lack lane-to-signal-group assignments and timing plans. The 85 signal junctions in the headless graph use the existing simulated cycle. [NDW signal data documentation](https://docs.ndw.nu/handleidingen/DEXTER/verkeersregelinstallaties/) · [Ede's signal locations and cycling measures](https://www.ede.nl/in-de-gemeente-ede/ede-fietst/fietsvriendelijke-verkeerslichten)

## Rebuild

The baked JavaScript asset comes from the Geofabrik Gelderland and Utrecht extracts dated 2026-11-18 21:21 UTC. OpenStreetMap data is available under the ODbL. The extractor also uses the checked-in Ede map to limit results to identifiable motor ways. [Geofabrik Netherlands extracts](https://download.geofabrik.de/europe/netherlands.html) · [OpenStreetMap attribution and licence](https://www.openstreetmap.org/copyright)

```sh
uv run --with 'osmium==4.3.2' python tools/build-ede-driving-control-evidence.py gelderland.osm.pbf utrecht.osm.pbf
node --test tests/ede-driving-controls.test.cjs
```
