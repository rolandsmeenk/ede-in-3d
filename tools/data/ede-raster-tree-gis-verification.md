# Pinned raster and tree verification

The imports sample in RD New with the stored Oude Kerk affine and the pinned RDNAPTRANS2018 pipeline. GDAL only assembles and normalizes the imagery within RD New. All height observations are metres NAP. The shipped terrain still uses the original 669 × 502 vertices at 12 m, with scene zero at 22.54 m NAP. [Shared frame and controls](ede-gis-v1.md)

## Horizontal alignment

The legacy GDAL geographic-to-RD path and the pinned transform used the same longitude and latitude at each test point. These differences are horizontal distances in RD New and exclude raster resampling and packed rounding. Pinned RD-to-scene round trips were within 2 nanometres in this numerical test.

| Control | Legacy to pinned, m |
| --- | ---: |
| Oude Kerk | 0.0132 |
| Northwest corner | 0.0103 |
| Northeast corner | 0.0050 |
| Southwest corner | 0.0193 |
| Southeast corner | 0.0325 |
| Bospoorttunnel | 0.0096 |
| Oosttunnel | 0.0231 |
| De Poortwachter | 0.0248 |

## Rebuilt assets

- **AHN terrain and De Eder Kuil.** The same PDOK WCS source reproduced the previous terrain bit for bit with the legacy tool. The pinned bake addresses pixel centres through the full affine and retains a triangular downsampling filter. Height changes have a median of 0 cm, p95 of 2 cm, p99 of 4 cm and p99.9 of 12 cm. The source gives 22.542 m at the church vertex, which rounds to the retained 22.54 m datum. Packed height quantization is at most 0.5 cm. The local De Eder Kuil patch rebuilt against the new grid and passed its seam tolerance of 0.00501 m. [PDOK AHN WCS](https://service.pdok.nl/rws/ahn/wcs/v1_0?service=WCS&request=GetCapabilities)
- **Nodata review.** The 21 changes at or above 0.50 m were checked against independent native 0.5 m tiles. The two largest are interpolated ground without a native centre return. At scene X −516, Z 2928, the grid moved from 17.64 to 19.03 m NAP. The nearby native median is 19.36 m and the point is 20.50 m from the nearest mapped road centreline. At X −156, Z 540 the grid moved from 20.91 to 19.58 m NAP against a native-window median of 18.85 m, 15.36 m from the road. A Maasvallei source gap 2.22 m from its centreline has a 0.63 m grid change. There is no measured centre height at that point.
- **Local grade and base controls.** The six Oosttunnel east-footway knots still meet the surrounding ground and shoulders. The peak lift is 0.432 m and median absolute deviation from usable exposed ground samples is 0.246 m, versus 0.410 m on the coarse grid. The Bospoort house footprint match is 99.5% IoU in RD New. The exterior AHN rings reproduce the existing 22.74 m NAP building seat byte for byte. The native crossing survey regenerated 74 of 78 fitted profiles on the control run. At shared XY samples, observed fit changes were 0.005 m p95 and 0.088 m maximum. Maanderbuurtweg lacked enough returns on both exposed floor approaches. The checked-in combined crossing, interior and rail profiles retain their reviewed elevations pending the original OSM/ProRail cache and a complete clearance run. These fit differences are elevation residuals and do not measure horizontal transformation error. [Targeted AHN pilot](ede-ahn-pilot.md) · [Crossing controls](ede-grade-sources.md)
- **Parking.** Re-seated 8,179 terrain-backed bays on the updated AHN grid, including Kuiperplein. The largest bay-height change was 0.141 m. All IDs, horizontal positions, headings, layer assignments, access rules and aisle geometry compare equal. Bays supported by fitted profiles or unresolved layer evidence keep their prior elevations. [Parking sources and offline re-seat](ede-parking-sources.md)
- **2025 aerial imagery.** Rebuilt from the same dated 0.5 m PDOK WMS export. The 3 m ground grid is still 2567 × 1901. It averages subpixel samples at pinned RD positions. Roof interiors and road centres use the same original geometry and output order. The new palette has 44,832 usable roofs of 44,844 and 21,828 usable road segments of 29,072. The same-source legacy bake had the same roof count and 21,834 road segments. The lookup asset stayed at 221,760 bytes and the ground JPEG grew from 1,407,293 to 1,565,251 bytes. Orthophoto relief, shadows, footprint offsets and colour averaging remain separate from the centimetre-scale transform comparison. [PDOK 2025 aerial imagery](https://www.pdok.nl/-/luchtfoto-2025-nu-beschikbaar-bij-pdok)
- **Trees.** Rebuilt baseline and expanded placements retain the 0.2 m XY grid, at most 0.10 m per axis or 0.1415 m radially from rounding. The baseline is 50,355 versus 50,352, the expansion 70,124 versus 70,125. Source tags reproduce 5,054 measured heights, 4,468 diameters and 5,000 classified species in the baseline. The baseline audit includes 48,353 BGT, 4,841 municipal, 2,437 OSM and one surveyed source-point ID association. Some multi-point municipal features share an ID. MOR and Gelderland IDs remain in the expansion audit. Five woodland coverage values and the site-surveyed school tree were preserved. [Source dates and inventory](ede-tree-inventory.md)

PDOK BGT was requested for 18 November 2026. The municipal monumental tree response and the OpenStreetMap nodes were recovered on 20 November 2026. The latter came from tiled OSM API map queries after the historic Overpass request was unavailable. MOR, Gelderland, woodland, AHN canopy and PDOK street reference evidence reuse their 20 November 2026 caches. The AHN ground and native pavement downloads use the documented current WCS coverages retrieved on 20 November 2026. Their source measurements can predate retrieval. [OSM API](https://wiki.openstreetmap.org/wiki/Api06#Retrieving_map_data_by_bounding_box:_GET_/api/0.6/map) · [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)

Focused verification includes rotated and translated affine samples, withheld NAP returns, the roof/road palette fixture, road/contact alignment and Eder Kuil seams. All ten Node tests and six Python raster/tree tests passed.
