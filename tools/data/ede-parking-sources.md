# Ede parking inventory

The 19 November 2026 bake fits 18,193 surface parking spaces across 1,562 areas inside the playable map. It places 16,189 spaces on mapped BGT parking surfaces, including 9,638 corroborated by WKD. It fits another 2,004 on OpenStreetMap parking geometries and aisle edges, including 27 from individually mapped parking-space polygons. The fit gives a capacity estimate wherever the source supplies no count.

- The [PDOK BGT road-area collections](https://api.pdok.nl/lv/bgt/ogc/v1/collections) supply 5,264 playable `parkeervlak` records from the 18 November snapshot in `assets/ede-road-surfaces.json.gz`. These polygons can represent entire strips of parking. They give physical placement, surface and relative level. The builder fits a 4.65 m × 1.96 m sedan footprint inside the polygon or conservatively leaves the space blank.
- [Rijkswaterstaat WKD Parkeervakken](https://docs.ndw.nu/handleidingen/wkd/wkd_parkeervakken/), also published as [NDW Langsparkeren](https://verkeersveiligheid.ndw.nu/dataset/langsparkeren), projects BGT coverage onto the NWB road network. Of 4,497 records in the response, 4,389 reference January 2026 NWB geometry and 108 reference January 2025. The matcher uses the projected line, its direction and the reported left or right side. The final fit references 1,472 distinct WKD records. WKD covers a different snapshot and the coverage line lacks the physical bay offsets.
- [OpenStreetMap](https://www.openstreetmap.org/copyright) supplies mapped parking polygons, vehicle access and parking tags, lane orientation, barriers and parking aisle geometry. This bake uses [Geofabrik Gelderland and Utrecht extracts](https://download.geofabrik.de/europe/netherlands.html) timestamped 18 November at 21:21 UTC. Individually mapped OSM polygons take priority over overlapping BGT shapes. OSM fills other geometrically supported gaps. Surface-lot estimates follow mapped aisles and leave open pavement blank.
- Same-level BGT carriageway, cycleway, sidewalk and driveway geometry, the rendered traffic lanes, mapped buildings, and crossing and bus-stop buffers filter the fits. Crossing buffers extend 5 m and bus-stop buffers extend 12 m. The model uses the local AHN terrain at each parking location or a verified grade profile linked to its access way. [RVV 1990, article 23](https://wetten.overheid.nl/BWBR0004825/#HoofdstukII_Paragraaf10_Artikel23)
- Across the map, 8,873 fitted spaces have an adjacent public motor route or verified parking aisle and pass the direct approach clearance checks. The game checks the full maneuver again. The baked parking-only data preserve 228 aisle ways and 117 shared-node gates across 99 lots. Access flags use mapped tags and closely matched NDW signs where available. A public estimate may still have signed restrictions missing from the map.
- Kuiperplein has 132 geometric fits, including 116 eligible for maneuvers. The 218-space estimate comes from the historical Dutch National Parking Register record. The active register record omits a capacity. The only baked street gate uses the approved Telefoonweg driveway and yields to Telefoonweg traffic. The pedestrian ring stays outside the parking route. The builder keeps ordinary maneuvers out of individual bays near mapped accessible and charging signs. [Historical NPR record](https://npropendata.rdw.nl/parkingdata/v2/static/6b673145-0ca2-4b4d-b6ca-acc2bb3b7f46) · [Active NPR record](https://npropendata.rdw.nl/parkingdata/v2/static/e997aca8-1629-4422-8121-404b13e38567) · [Kuiperplein traffic decision](https://zoek.officielebekendmakingen.nl/stcrt-2020-11132.html)
- Parkweg's named street grouping has seven fitted spaces. The published occupancy survey covers the wider neighborhood bounded by the railway, Kerkweg, Jan Th. Tooroplaan and Oude Bennekomseweg. The inventory marks the matched street and gives the demand model the street name. Garage capacities and access routes, including the station P+R, come from the separately verified facility asset. [Municipal Parkweg survey](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Ontwikkeling/2020-08-26_Parkeeronderzoek_Parkweg_Ede.pdf)

Rebuild with Node.js, Python, Shapely 2.1 or newer, pyosmium and local extracts covering both provinces.

```sh
curl -fsSG 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/wkd_wegkenmerkendatabase/ows' \
  --data 'service=WFS' --data 'version=2.0.0' --data 'request=GetFeature' \
  --data 'typeNames=parkeervlakken' --data 'srsName=EPSG:4326' \
  --data 'bbox=5.5925,52.012,5.7005,52.0605,EPSG:4326' \
  --data 'outputFormat=application/json' -o /tmp/ede-wkd-parking.json
python3 -B tools/build-ede-parking.py --osm utrecht.osm.pbf gelderland.osm.pbf \
  --wkd /tmp/ede-wkd-parking.json
python3 -B -m unittest discover -s tests -p test_ede_parking_inventory.py
```

Parking geometries incorporate © OpenStreetMap contributors, licensed under the Open Database License. PDOK BGT is available under CC0 1.0.
