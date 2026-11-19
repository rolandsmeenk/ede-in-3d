# Ede shorelines

The November 19, 2026 bake combines the existing OpenStreetMap water and land snapshot with PDOK BGT `waterdeel` and `ondersteunendwaterdeel` tiles covering the playable town. It selects the latest active ground-level feature per source ID and excludes dry ditches. BGT supplies the shoreline when compatible surveyed water covers at least 80% of the OSM footprint. In partial matches the OSM outline covers survey gaps and surveyed bank polygons remove stale extensions onto dry banks. [PDOK waterdeel](https://api.pdok.nl/lv/bgt/ogc/v1/collections/waterdeel) · [PDOK ondersteunendwaterdeel](https://api.pdok.nl/lv/bgt/ogc/v1/collections/ondersteunendwaterdeel) · [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

The bake checked 1,030 active water features and 1,883 bank features. It used 152 compatible BGT water features to refine 129 complete and 18 partial OSM footprints. It retained 30 additional OSM footprints where there was no compatible survey match. The remaining 878 BGT water features need review as standalone features. Some are drainage ditches beside roads and simulated lanes. Activating all of them removed eight scheduled bus route sections from the routing graph. The compatible shoreline retains all 304 scheduled sections and the original 9,642 directed edges with clear lanes.

The versioned asset is 100,294 bytes compressed. Its 178 water polygons and corrected land outlines feed the street atlas, world meshes, and movement checks. The bake cuts water from ground-level parks, grass, woodland, gardens, and squares before triangulation. It inserts shared shoreline joins, preserves island holes, and splits disconnected land. It uses 0.30 m topology-preserving simplification for surveyed vertices. A pair of split parks brings the total to 2,856 park polygons with 116 holes, up from 2,854 polygons with 98 holes. The existing 12 m AHN terrain grid and routing graph are retained.

## Ground mesh overlap audit

The audit intersects each water polygon with the union of ground-level park and square meshes. An overlap must exceed 0.01 m² to count. The raw map has 22 fully covered and seven partly covered water polygons. The corrected map has zero of either. The old park surface sat 0.04 m above the water surface at Victoriavijver. Geometry now leaves a shoreline opening.

| Site | Scene sample in water, X and Z in metres | Before | Resolved water area |
| --- | --- | --- | ---: |
| Victoriavijver, also called Proosdijvijver | −1726.18, 715.90 | Entirely covered | 25,259.49 m² |
| Kikker- en Paddenpoel | −1438.15, 639.20 | Entirely covered | 88.71 m², OSM fallback |
| Veldhuizerbos main pond | −3032.76, 675.16 | 7,183.52 of 9,462.46 m² covered | 10,250.32 m² |
| Veldhuizerbos smaller pond | −3058.85, 790.41 | Entirely covered | 484.90 m² |
| Kamelenvijver | 389.51, −564.67 | Previously visible | 1,231.57 m² |

The corrected shore excludes 29 mapped tree centres in water, six more than the original water layer. Procedural trees and fallback placements also stay out of those polygons.

## Route and paving review

The corrected shoreline has 18 surveyed level-zero paving overlaps over 0.01 m², totalling 37.98 m² across ten footpath pieces, four cycle pieces, three local road polygons and one driveway. None add water along more than 0.5 m of a ground motor centreline. Fifteen bridge alignments cross newly refined water and retain their travel layer. Two short ground path crossings meet those bridge approaches. The following larger or representative overlaps were checked in 2026 PDOK aerial imagery.

| Site | Scene position, X and Z in metres | Observation |
| --- | --- | --- |
| Victoriavijver west bank | −1787.70, 755.69 | The 2.48 m² footway overlap is at a projecting fishing platform. The platform remains. [PDOK aerial image](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=660&HEIGHT=660&BBOX=52.038944927%2C5.645003540%2C52.039483916%2C5.645879904) |
| Maandereng quay | −2203.33, 2802.89 | The 7.56 m² overlap follows the paved quay. The footway remains. [PDOK aerial image](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=660&HEIGHT=660&BBOX=52.020572582%2C5.638962029%2C52.021075639%2C5.639779970) |
| Hoekelum woodland | 450.63, 3368.60 | The 8.79 m² general BGT road overlap is at a visible bridge deck. The deck remains. [PDOK aerial image](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=660&HEIGHT=660&BBOX=52.015472757%2C5.677696753%2C52.016011746%2C5.678573117) |
| Singelpad | −1940.15, 2947.89 | The cycle overlap is at the mapped bridge and bank approach. [PDOK aerial image](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=660&HEIGHT=660&BBOX=52.019305958%2C5.642864480%2C52.019737149%2C5.643565572) |
| Paddenpoel woods | 644.90, 2811.40 | 32.46 m of OSM path `w199911474` crosses the revised shoreline without a supporting paved BGT footprint. Shadows and tree cover obscure the exact path and lake edge. Field check needed. [PDOK aerial image](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=660&HEIGHT=660&BBOX=52.020172742%2C5.680037668%2C52.021322586%2C5.681907246) |
| Western woodland | −3110.95, 482.35 | 2.74 m of OSM path `w893913256` intersects mapped water. Existing imagery does not establish the bank or path alignment under the trees. Field check needed. [PDOK aerial image](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A4326&FORMAT=image%2Fjpeg&WIDTH=660&HEIGHT=660&BBOX=52.041382415%2C5.625646840%2C52.041957337%2C5.626581629) |

## Refresh

Use the saved full-town GeoJSON tiles from the BGT street-detail refresh. The files retain the dates and source IDs. Run the shoreline bake after rebuilding the OSM map and before running downstream imports.

```sh
uv run --offline --with 'shapely>=2.1' python tools/build-ede-shorelines.py /tmp/slop-ede-bgt-town-20261119 --date 2026-11-19
uv run --offline --with 'shapely>=2.1' python tools/build-ede-shorelines.py --audit --osm
uv run --offline --with 'shapely>=2.1' python tools/build-ede-shorelines.py --audit
```
