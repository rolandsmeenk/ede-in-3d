# Offline Ede GIS frame v1

The lane bake measures and matches horizontal geometry in RD New, EPSG:28992. The shared frame uses the existing Oude Kerk geographic affine at export. Scene X grows east and scene Z grows south. The origin still represents 5.671553° E, 52.0460029° N. The exported frame retains its established scale and orientation. Native 1GIS NAP values continue through the existing elevation and grade profiles.

The offline tools pin pyproj 3.8.0 with PROJ 9.8.1. The explicit Amersfoort to ETRS89 (9) operation uses NSGI's published horizontal RDNAPTRANS2018 grid, bundled in `proj/nl_nsgi_rdtrans2018.tif`. Its pinned SHA-256 is `7653831191b424e715a906468962fc60071cfb71a3186b2a58f098bab8bf41de`. The module refuses a different PROJ version or grid. The grid is used under CC BY 4.0. [NSGI RDNAPTRANS2018](https://www.nsgi.nl/coordinatenstelsels-en-transformaties/coordinatentransformaties/rdnap-etrs89-rdnaptrans) · [PROJ-data attribution](https://github.com/OSGeo/PROJ-data/blob/master/nl_nsgi/nl_nsgi_README.txt)

| Input | Axes and conversion |
| --- | --- |
| 1GIS ArcGIS layers | Horizontal WKID from the feature set or snapshot. EPSG:28992 uses easting/northing unchanged. Z stays in metres NAP. |
| OSM and legacy scene geometry | Published OSM longitude/latitude, or invert the stored Oude Kerk affine for an existing graph edge. The pinned transform supplies RD positions for matching. |
| BGT | Read the published CRS for raw polygons. RFC 7946 defaults to longitude/latitude. A pre-baked local polygon uses the same inverse affine as a graph edge. |
| NWB and WEGGEG | The supplied public OGC GeoJSON snapshots use CRS84 longitude/latitude. The CRS adapter also recognizes their RD New declarations when requested. |
| PDOK raster traces | Use the raster's declared CRS and full geotransform, including skew. Integer pixels use their centres. Raster affine coordinates use x/y order. |

EPSG:4326 and EPSG:4258 authority coordinates use latitude/longitude. Callers with explicit longitude/latitude serialization set x/y. The public WGS84 geographic sources omit an observation epoch and realization. The bake treats their geographic coordinates as ETRS89-aligned for the local horizontal conversion. Source capture dates, surveyed objects, and tracing tolerance account for additional differences between features. Lane coordinates, stations, distances, and widths export on a 1 mm grid. The horizontal transform performs no NAP-to-ellipsoid conversion.

## Coordinate checks

Published controls are saved in [ede-gis-controls.json](ede-gis-controls.json). The 34 RDinfo stations span the centre and areas near and beyond all four playable edges. These comparisons check the published geographic geometry against the published RD attributes. The independent GNSS angles at control 320-332-14 also check the ETRS89 operation directly. [PDOK RDinfo](https://www.pdok.nl/ogc-apis/-/article/rdinfo) · [NSGI control fields](https://www.nsgi.nl/documents/1888506/3754578/Beschrijving%2Bvelden%2BRDinfo%2BPDOK.pdf/6c15b99d-a3b3-a4bc-52ae-2c085ffa3a66?t=1609251977460)

| Check | Horizontal residual |
| --- | ---: |
| 34 published PDOK CRS84/RD station pairs | 16.3 mm mean, 31.4 mm maximum |
| Independent ETRS89 DMS values at 320-332-14 | 0.13 mm |
| Scene → RD → scene at the origin and all four playable corners | 0.000000002 m maximum |
| Millimetre rounding of the 34 controls in scene coordinates | 0.37 mm mean, 0.69 mm maximum, 0.71 mm theoretical planar bound |
| Existing rendered 1GIS converter compared to v1 across 16,786 raw layer 30 vertices | 21.2 mm mean, 31.9 mm maximum |

The coordinate checks report transformation and rounding separately. The lane-fit review reports differences between markings, road boundaries, aerial traces and the routing graph. Existing rendered 1GIS paint remains in place.

| Scene X, Z | RD easting, northing |
| --- | --- |
| 0, 0 | 174506.802, 450892.137 |
| −5412.3, −1613.8 | 169079.148, 452486.744 |
| 1981.8, −1613.8 | 176485.583, 452513.206 |
| −5412.3, 3785.2 | 169094.419, 447090.740 |
| 1981.8, 3785.2 | 176508.878, 447117.245 |

Run the tests using the pinned toolchain.

```sh
uv run --python 3.12 --with pyproj==3.8.0 python -m unittest discover -s tests -p test_ede_gis.py
```
