# Ede crossing profiles

The checked-in [grade asset](../../assets/ede-grade.json) uses the same easting, southing, and World Y as the map. Heights are in metres relative to 22.54 m NAP. The asset is loaded locally with the application.

| Site | Horizontal verification | Height fit |
| --- | --- | --- |
| Albertstunnel, Klinkenbergerweg | OSM ways 6952984 and 1063323754 carry road traffic. Ways 25098905 and 1063323753 carry the parallel cycle and foot routes. BGT lists the rail viaduct as `L0004.a868e3a0aea840a98f3d77833a6f3ac5` over the two municipal carriageways. The station plan identifies the Albertstunnel. | AHN samples place the open carriageways near 16.0 m NAP at the portals and the side paths near 17.0 m west and 17.7 m east. The roofed floors are fitted between these observations. The mapped motor-vehicle height limit is 4.1 m. Side-path clearances are estimates using the common soffit. |
| Westtunnel | OSM ways 1549283975 and 1287248249 connect Stationsweg to the south approach. The separate BGT cycle and foot polygons lie within `L0004.20c74afecca8440c909b29a46147fb5e`. The operator announced public opening on June 6, 2025. | The AHN terrain anchors the approaches at about 20.0–20.7 m NAP. The covered corridor floor is estimated near 17.0 m NAP below the ProRail station tracks near 20.9 m NAP. The modeled clearance is 3.0 m. |
| A30 railway viaduct | OSM motorway ways 6960078 and 6960132 plus ramps 70490957 and 70490959 cross OSM tracks 431666247 and 431666248. BGT shows the raised deck `L0002.73bbac3ff8164220957d09d21d823920` at relative level +1 and the two tracks at level 0. | AHN surface heights over the deck are 18.3–18.7 m NAP. AHN ground heights on the exposed ballast at both abutments are 9.8–10.0 m NAP. ProRail agrees horizontally and reports around 15 m NAP in the cut, so the fit uses AHN for the visible track bed. The modeled underside clearance is 7.5 m based on estimated deck thickness. |
| Telefoonweg level crossing | OSM road 6953582 and railway 431865751 share node 828435934. ProRail layer 0 records it as public, active, and AHOB (automatic barriers), PUIC `1058febe-631b-4d94-b470-8115b64a54e4`. The BGT crossing polygon is `L0004.e3161f37a99649789c8824e422269bc4`. | The road and rail share the observed AHN surface at 20.98 m NAP. |
| Parkweidepad Zuid, N224 | OSM cycleway 363124901 and approaches 363124900 and 363124902 align with four BGT tunnel polygons. The separate roof sections carry the two N224 carriageways and their parallel cycle paths. | AHN ground samples in the open sections put the floor around 11.8 m NAP. Surface samples put the N224 roof near 15.0 m NAP. The modeled clearance is 2.6 m. |
| Keesomtunnel, Kastelenlaan and Keesomstraat | OSM one-way carriageways 25710948, 430622525, 25710950 and 430622524 run between the separate cycle paths 163607273 and 421594656. They cross under BGT railway deck `L0004.1ba1a93d4c164a0b85ba15d59881870b` and the Noorder Parallelweg and Frankeneng viaducts. | AHN measures the open road near 9.8–10.0 m NAP and the side paths near 11.4–11.5 m NAP by the rail portals. The covered floors are fitted between those observations. Both tracks sit near 15 m NAP and the adjoining road decks near 15.3–15.5 m NAP. OSM records a 4.2 m vehicle height limit. Side-path clearance is estimated at 2.6 m. |
| Sysseltsepad cycle and footbridge | OSM viaduct 1115504037 and its mapped ramps cross two separate rail alignments, 431658944 and 1092211189. [Provincie Gelderland confirms the completed Sysselt cycle viaduct](https://www.gelderland.nl/themas/bereikbaar/ov/stations). | The [AHN6 surface model](https://www.ahn.nl/dataroom) measures about 32.2 m NAP above the tracks. The rail bed is about 24.1 m NAP. Modeled clearance is approximately 7.4 m given the estimated slab and the rail geometry. The approaches tie into the scene terrain at both ends. |

Sources are [OpenStreetMap](https://www.openstreetmap.org/copyright), [PDOK BGT](https://api.pdok.nl/lv/bgt/ogc/v1/), [PDOK AHN DTM and DSM](https://service.pdok.nl/rws/ahn/wcs/v1_0?service=WCS&request=GetCapabilities), [ProRail Basiskaart](https://maps.prorail.nl/arcgis/rest/services/ProRail_basiskaart/FeatureServer), [the station plan](https://www.prorail.nl/siteassets/homepage/projecten/ede-spoorzone/2.1.-spoorzone-ede-2022-p2-1.pdf), and [the Westtunnel opening announcement](https://www.spoorzone-ede.nl/nieuws/opening-westtunnel-en-fietsenstalling-station-ede-wageningen). The source check used the November 18, 2026 BGT snapshot, ProRail’s Basiskaart layers 0 and 6–9, and local half-metre AHN tiles.

## Rail alignment check

The game keeps the 45 separate OSM rail ways. Comparing samples at up to 12 m intervals across the playable bounds put the 95th-percentile offset at 0.39 m for the 21 ProRail track features and 0.43 m for the 11 switch features. All ProRail samples were within 3 m of a game rail. The 43 active BGT rail features had a 0.44 m 95th-percentile offset and 97.6% of samples were within 3 m. Five BGT features had an offset over 5 m somewhere along their length and remain flagged for review.

| BGT feature | Largest sampled offset |
| --- | ---: |
| `L0004.3be10b6f9fd045369f593239b5f62a21` | 19.8 m |
| `G0228.33a386988c0e4f7aaf7c6eb5b46baba7` | 25.5 m |
| `G0228.59c58fcc807b45b58c4446de849dc853` | 30.0 m |
| `G0228.bf28a1a2c82a4b21a932ecfcad8dd440` | 24.6 m |
| `G0228.dd84ce2812204f05bd942be0c9a69dc1` | 29.2 m |

## Map-wide level-crossing audit

The ProRail layer 0 query returned 14 crossings in the map bounds. Each record was in use, public, and AHOB. Each matched a BGT `overweg` polygon at relative level 0 and a node shared by the OSM road and rail ways. The matches include Amsterdamseweg, Asakkerweg (mapped as Kernhemseweg), Brouwerstraat, Doolhoflaan, Dwarsweg, Kade, Larixlaan, Molenstraat, Nieuwe Stationsstraat, Prins Bernhardlaan, Rijksweg (N224), Schabernauseweg, Schaapsweg, and Telefoonweg.

The control headings follow the mapped approach. Divided roads use the combined corridor width. The N224 and Schaapsweg include controls for their parallel cycle routes. The Schabernauseweg, Dwarsweg, and Kade locations include both tracks. Telefoonweg has a local height fit. The remaining crossings retain the shared AHN terrain surface.

## Additional grade-separated crossings

The audit intersected OSM road, path, and railway centerlines at different mapped levels inside the scene. It grouped nearby intersections of parallel carriageways and tracks and checked the crossing against BGT bridge and tunnel footprints. The table lists the 20 locations still awaiting height and clearance fits.

| Crossing | Representative OSM ways | Corroboration |
| --- | --- | --- |
| Rail and Spoorpad over Koepeltunnel | 458879655, 458879659, 458879660, 723960811 | BGT bridge `L0004.8021e18cafe842bfa83edfcea3461a7b` |
| Rail and Verlengde Blokkenweg over Somatunnel | 643484750, 643484752, 643484754, 1030482946 | BGT deck `L0004.fb9b31a1c6c149b6bf4e960c04edc544` |
| Maanderbuurtweg over A12 | 6959876, 27006606, 199420019, 750476158 | BGT deck `G0228.5b4d62846acf4d8583e58aceea0b9f2f` |
| A30 over A12 at Knooppunt Maanderbroek | 6960104, 493246904, 750476158 | BGT bridge `L0002.e467d67f4f5a48aa8585c8c5262631e2` |
| Shared road and cycle passage under A30 west of Frankeneng | 483714717, 483714724, 25120568, 1392410752 | BGT tunnel `G0228.32fc3227bf3a4c66929a44b29a7786f4` |
| A12 link over A30 and A12 at Knooppunt Maanderbroek | 6960110, 6960114, 380485855, 493246904 | BGT bridge `L0002.6ec5b0cd61a04e1d84ddc0ea09f67fd2` |
| A30 over Galvanistraat | 6960068, 6960069, 6959961, 1074368502 | BGT bridge `L0002.518f5bbc876446ffafbcfa30fa81f146` |
| A30 over N224 | 6960119, 6960136, 34918095, 45036439 | BGT bridge `L0002.2573aa9218024f128d65b5e87a70ffaf` |
| Statenpad over A12 | 26380388, 366343570, 405313254 | BGT deck `G0228.c6922d2214d545bd940c60dfe183829a` |
| Stadspoort path above the Doctor W. Dreeslaan passage | 262752271, 25546150, 25546154, 25546157, 25546158 | OSM centerlines and mapped layers |
| Frans Halslaan over Doctor W. Dreeslaan | 25031366, 840619077, 6921140, 6921141 | BGT deck `G0228.700fe0c98a254dbd819af20bfca6388f` |
| A12 links over the Maanderdijk passage | 1212023123, 1212023126, 848069425, 993493475 | BGT tunnel `G0228.dec5411415274a62972f491067649e3f` |
| De Poortwachter over A12 | 6921137, 24831859, 25551033, 723962249, 723962252 | BGT deck `P0025.b0bfa821bc3d48d9ada3988a6111fc49` |
| Bovenbuurtweg over A12 | 115834965, 723962245, 723962247 | BGT deck `G0228.c4590e9df88c4ee0b05ae3ab7ddd7298` |
| Parklaan under A12 | 469675200, 420569803, 509484016 | BGT tunnel `G0228.7a08be34c7c84b6eaf9bf1d382c4f3af` |
| Hoekelum cycle tunnel under Hoekelumselaan | 1170998332, 1193458974, 1193458975 | [Municipal Pico Bello Pad project](https://www.ede.nl/in-de-gemeente-ede/ede-in-ontwikkeling/snelle-fietsroute-ede-wageningen) |
| A12 over Edeseweg | 6920863, 6920865, 723962409 | BGT bridge `L0002.d9669594c77a4ef6b37ee58d90557562` |
| N224 cycle tunnel at Otterloseweg | 24994852, 6954006, 6954256, 1285013611 | BGT tunnel `G0228.3a511d78757642e0b304baa3d9cf9423` |
| Parking access below Polar Bearsplein | 1546549244, 1546549246, 1193451506 | OSM centerlines and [municipal P+R information](https://www.ede.nl/in-de-gemeente-ede/ede-werkt-aan/p-r-garage-ede-wageningen) |
| Baron van Wassenaertunnel under A12 | 6919176, 6919291, 6919294 | BGT tunnel `G0228.5bdf19670017480b8171396ea7fb7bca` |



## Rebuild

Use the same full-geometry Overpass snapshot as the Ede map builder. The checked-in AHN grid supplies the profile endpoints. The fitted interior heights and BGT roof intersections are recorded in the builder. To include the local ProRail track samples used for the checked-in asset, download the two layer queries first.

```sh
survey_dir=/tmp/ede-grade-survey
mkdir -p "$survey_dir"
for layer in 7 9; do
  curl -fsSG "https://maps.prorail.nl/arcgis/rest/services/ProRail_basiskaart/FeatureServer/$layer/query" \
    --data-urlencode 'f=json' --data-urlencode 'where=1=1' \
    --data-urlencode 'geometry=5.5925,52.012,5.7005,52.0605' \
    --data-urlencode 'geometryType=esriGeometryEnvelope' \
    --data-urlencode 'inSR=4326' --data-urlencode 'outSR=4326' \
    --data-urlencode 'spatialRel=esriSpatialRelIntersects' \
    --data-urlencode 'outFields=*' --data-urlencode 'returnZ=true' \
    -o "$survey_dir/slop-ede-grade-pr-$layer.json"
done
python3 tools/build-ede-grade.py tools/data/osm_ede.json --survey-dir "$survey_dir"
```

The `qa` entries in the generated asset give a playable route’s approach, crossing sample and exit as `[x, z, y]`, with a heading in radians. The covered intervals are distances in metres along each route. Rail alignment and physical clearance estimates are for the simulation.

