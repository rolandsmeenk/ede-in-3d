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
node tools/build-ede-geodata.mjs tools/data/osm_ede.json js/ede-geodata.js /tmp/ede-wkd
```

[Kadaster BGT road areas](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections) provide physical role and width evidence where the same-layer overlap is strong. Explicit OSM widths take precedence. The BGT physical role by itself conveys no traffic permission.

The [Ede station traffic decision and signing plan](https://zoek.officielebekendmakingen.nl/gmb-2024-120844.html) reserve the north-east platforms, the turn toward them, and a dedicated Akulaan approach lane for scheduled buses. The remaining public forecourt includes taxi and Kiss & Ride access. The station’s general 10 m restriction exempts scheduled buses. The public through portion of Akulaan has three ordinary lanes and a bus lane on the mapped four-lane approach. Willy Brandtlaan has a separate tagged busway and one adjacent through segment with an ordinary lane and a bus lane. OSM, WKD, and mapped GTFS routes distinguish these connections from their neighboring public lanes.

The [NDW temporary speed and closure feeds](https://opendata.ndw.nu/) were reviewed at 22:58 Amsterdam time on 18 November 2026. The speed feed used location references without explicit point geometry, and the closure feed’s only point within the Ede map was an overnight RWS rerouting record. Those references left the affected game segments ambiguous. The [municipal works list](https://www.ede.nl/in-de-gemeente-ede/werk-aan-de-weg) separately reported the Rembrandtlaan closure between Jan Th. Tooroplaan and Pieter de Hooghstraat from 9 November to 18 December. The retained OSM ways share nodes at the Tooroplaan end, while the Pieter de Hooghstraat endpoint requires a manual match. The dated observations are recorded here for review.

The rail sites with elevation profiles are listed in [the grade source notes](ede-grade-sources.md). For other mapped tunnels, the model preserves the topology and avoids placing ambient agents on an unverified floor. Timetabled bus progress is preserved through sections without a modeled interior.
