# Northern Valleilijn and Lunteren station

The 22 November 2026 bake adds two station tracks with surveyed platforms and six access ramps. Timetabled RS34 trains use platform 1 toward Ede and platform 2 toward Barneveld. Both reach the northern boundary along the existing OpenStreetMap alignment and continue for a short approach beyond it. The published stops at Lunteren and Ede Centrum apply to both directions. Services use the same local timetable or live delay updates as the rest of the route. [OVapi GTFS](https://gtfs.ovapi.nl/nl/gtfs-nl.zip) · [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright)

The platform footprints are ProRail Transfer layer 7 objects 576 and 577. The matching surveyed edges in layer 2 are 155 and 708. Access ramps come from layer 9. Platform 1 matches OSM way 431760849 and ProRail track 5667. Platform 2 matches OSM way 431760850 and ProRail track 3273. The nearest rail centre is about 1.83 m from each platform’s edge at the stopping position. The platform surface is modeled about 0.76 m above the railhead, or roughly 17.52–17.56 m NAP. This rise is an estimate. The ramp geometry follows the surveyed footprints and ties to exposed AHN ground at its outer ends. [ProRail Transfer, reusable with attribution](https://maps.prorail.nl/arcgis/rest/services/Transfer/MapServer) · [PDOK AHN](https://www.ahn.nl/dataroom)

The line uses ProRail Basiskaart layer 9 for elevation and checks the loop against layer 7 switches 21 and 23. The OSM junction points are respectively 0.08 and 3.97 m from the mapped switch geometry. The game retains the OSM junctions and uses a continuous elevation through them. The southbound profile ties into the existing Ede rail fit before the new Zonneoordlaan crossing. The two single-track sections are reserved from front-cab entry until the rear clears. If an opposing train holds a section, the following train can wait at its previous stop, including at Lunteren on its own platform. The visible shared track also remains occupied until a delayed consist clears in the simulation. [ProRail Basiskaart, reusable with attribution](https://maps.prorail.nl/arcgis/rest/services/ProRail_basiskaart/FeatureServer)

There are 14 active public crossings from ProRail layer 0 and one additional separately controlled foot crossing at Boslaan. These represent 17 shared rail and road or path nodes. The grade profiles preserve mapped vehicle access. Native 0.5 m AHN checks put the original differences between exposed crossing ground and modeled railhead at 0.00–0.18 m. The fitted paving and wheel contact then share the same surface. The barrier models represent the mapped AHOB, AHOB-MINI and AOB controls with shared game hardware. Exact pole positions and boom dimensions are approximate. Closed and private crossings get no new crossing control. [PDOK AHN WCS](https://service.pdok.nl/rws/ahn/wcs/v1_0?service=WCS&request=GetCapabilities) · [Boslaan foot crossing](https://www.openstreetmap.org/node/4369359172)

## Refresh

Bake the northern map overlay first. During a source refresh, point at a new dated cache directory so the downloader can retain each previous snapshot. The command below fetches missing ProRail and AHN clips. Omit `--fetch` to repeat a bake from the same cache.

```sh
uv run --with rasterio --with pyproj==3.8.0 --python 3.12 python -B tools/build-ede-north-rail.py \
  /tmp/ede-north-rail-2026-11-22 --osm /tmp/ede-north/osm-north.json --date 2026-11-22 --fetch
node --test tests/ede-lunteren-rail.test.cjs tests/ede-train-tracks.test.cjs \
  tests/ede-train-traffic.test.cjs tests/ede-level-crossings.test.cjs
```
