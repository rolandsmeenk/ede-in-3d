# Ede tree inventory and canopy bake

This report covers the expanded tree asset from 20 November 2026. The original inventory remains available as `assets/ede-trees.bin`. The expanded build stores `assets/ede-trees-expanded.bin` and five woodland-coverage values. The WFS response, source images, LERC tiles and AHN rasters stay in the offline cache.

The figures in the original expansion report below describe its 20 November 2026 baseline. The later pinned GIS refresh rebuilt both assets from the dated sources. It yielded 50,355 baseline placements and 70,124 expanded placements. The baseline importer can save stable source ID associations and input hashes with `--audit`. [Pinned raster and tree verification](ede-raster-tree-gis-verification.md)

## Sources and reuse

| Source | Use in the bake | Reuse and attribution |
| --- | --- | --- |
| Gemeente Ede, `Ede:mor_bomen` WFS 2.0.0, snapshot timestamp 2026-11-20 10:58 UTC | Active point locations and stable `mor_bomen.<id>` identifiers | The public WFS capabilities say `Fees=NONE` and `AccessConstraints=NONE`. The layer lists no separate licence. Attribute the point locations to Gemeente Ede. [WFS capabilities](https://geo.ede.nl/geoserver/Ede/wfs?service=WFS&version=2.0.0&request=GetCapabilities) |
| Existing BGT, municipal, OSM and photo-surveyed Slop Ede inventory | Reference trunks, surveyed sizes and spatial masks | The original asset remains byte for byte. PDOK BGT is CC0, the separate municipal monumental layer is marked public domain, and OpenStreetMap is ODbL. [PDOK BGT](https://api.pdok.nl/lv/bgt/ogc/v1/collections) · [Municipal catalogue](https://data.overheid.nl/en/dataset/39339aa2-a7dc-4f52-bcdb-f1eff423b69f) · [OSM attribution](https://www.openstreetmap.org/copyright) |
| Provincie Gelderland, `imbor2020.gisib.arcgis_all_boom_punt` via layer 673, excerpt fetched 20 November 2026 | Existing roadside trunk attributes and class bounds | The national catalogue lists this exact points dataset as public domain. [Gelderland service](https://geoportaal.gelderland.nl/gisserver/rest/services/Overig/Mobiliteit/MapServer/673) · [National catalogue](https://data.overheid.nl/dataset/43235-wegen--gisib-bomen-langs-provinciale-wegen--punten-) |
| Friedenau Society, Klimaateffectatlas canopy monitoring, 2022 AHN4 slice at 25 cm | Crown masks and woodland coverage | Underlying data is open CC BY 4.0. Credit Friedenau Society and Klimaateffectatlas. The public Esri Nederland mirror also publishes service terms. The 2024 AHN5 slice returned empty native pixels in the Ede check. [Publisher](https://www.friedenau.eu/praktijkvoorbeelden/boomkroonbedekkingskaart-voor-nederland) · [Atlas reuse terms](https://www.klimaateffectatlas.nl/nl/faq) · [Image service metadata](https://www.arcgis.com/home/item.html?id=04dd321ea3d44f168863570e46a97259) |
| PDOK AHN WCS and 2026 PDOK ortho RGB | DTM and DSM at 50 cm for height estimates, and orthophotography for position checks | Heights were downloaded on 20 November 2026. The aerial photos remain in the audit cache. [AHN data room](https://www.ahn.nl/dataroom) · [PDOK imagery](https://www.pdok.nl/-/artikel/luchtfoto%20beeldmateriaal) |

## MOR positions

The WFS advertises EPSG:4326. Its point values and east/north axis order match **RD New**. Four independent controls intersected known active BGT tree points across Ede. The MOR geometry residuals below are the RD distances to exact BGT source points. The bake projects with the shared pinned RDNAPTRANS2018 pipeline and clips to the playable scene extent after conversion. [Shared GIS frame](ede-gis-v1.md)

| MOR source ID | Independent BGT ID | RD distance |
| --- | --- | ---: |
| 27200 | `G0228.fe246f3aa01ad6d6e0400a0a35020533` | 0.144 m |
| 94606 | `G0228.fe246f34ff11d6d6e0400a0a35020533` | 0.124 m |
| 87641 | `G0228.fe246f533a0bd6d6e0400a0a35020533` | 0.048 m |
| 9533 | `P0025.fd1d608d6db648c2e04014ac0e2861a4` | 0.018 m |

91,428 source points yielded **52,638 in bounds**. The 2.5 m one-to-one join preserves the active inventory position and dimensions. Spatial matches had a median distance of 0.110 m and p95 of 1.206 m. Points with nearly equidistant alternatives, or whose only possible matches had already been claimed, were held for review. Unmatched points passed through building, refined shoreline, vehicle pavement, bridge, tunnel and BGT structure masks. A conservative OSM vehicle segment footprint supplies a check where BGT pavement is missing. Rejections below use the first blocking mask. The per-point audit retains the other mask hits. No additional unmatched points hit a bridge, tunnel or BGT structure mask in this snapshot.

| Result in bounds | Count |
| --- | ---: |
| Joined within 2.5 m | 32,029 |
| Reviewed De Vuurvogel alias | 1 |
| New positions passing the bake | **19,773** |
| Ambiguous near a reference trunk | 569 |
| BGT vehicle pavement | 113 |
| Water | 48 |
| Coincident or identically quantized MOR duplicates | 39 |
| OSM-only vehicle surface | 36 |
| Building | 26 |
| Held after orthophoto and AHN review | 4 |

At De Vuurvogel, MOR 9775 is at RD E173758.396 N450112.300, 5.26 m from the photo-surveyed RD E173755.75 N450107.75. Both project into the same canopy. The school entrance photo supports one mature trunk, and the aerial view gave no independent second-trunk evidence. One placement keeps the photo-surveyed trunk and its 15.2 m height and 12.5 m crown. [Surveyed tree record](ede-surveyed-trees.json)

The 2026 ortho and local 50 cm DSM–DTM check held MOR 59460 at a construction site, 77638 on low field vegetation, and 1207 and 1320 on the gravel forecourt without clear independent trunks. The local AHN P90 within roughly 2 m of those four points was 0.0 m, 0.0 m, 0.17 m and 0.0 m respectively. MOR 48508 and 93805 retain catalogued locations near the N224 median. That leaf-off aerial is inconclusive for their size, so the pilot leaves those attributes unset. A lack of retrospective canopy alone does not establish removal.

## Roadside classes and canopy estimates

The exact clip returned 1,151 provincial points. 1,134 were corroborated by an at-grade road tagged with the named provincial route and matched one-to-one within 2 m. The joined records split into N224 987, N304 139 and N781 8. The median match distance was 0.081 m, p95 was 0.126 m and the largest was 0.151 m. Gelderland added 973 height classes, 973 diameter classes, 972 morphology groups and 1,126 phenology groups. Class intervals stay in the audit. The packed estimate uses the midpoint of finite ranges and the lower bound of an open-ended class. For example, 15–18 m renders as 16.5 m and 24 m or higher as 24 m. Existing nonzero dimensions and surveyed values take precedence.

The canopy check sampled eight 200 m cells, including De Vuurvogel, the N224, Sijsselt and Hoekelum. An isolated crown must have a separate connected 25 cm canopy patch, no conflicting trunk and enough current AHN support. The height estimate is the 90th percentile of current DSM minus DTM over usable canopy pixels. Crown width is the equivalent diameter of the mapped canopy area. Roof, bridge and structure pixels are excluded. Overlapping crowns contribute only to the area statistic. Of the checked records, 36 gained both dimensions, 165 were in cover connected beyond the sampling window, 13 shared a neighbouring trunk, 22 had weak current height evidence, and 12 were absent from the 2022 canopy mask. Estimates are medium-confidence observations bounded to these audited windows.

The 105-byte woodland summary stores canopy-covered area divided by mapped woodland area. Cells require at least 10% mapped woodland. The five sampled woodland cells were 71.4–91.3% covered. These fractions guide procedural fills locally and represent overlapping canopy as area. Baseline procedural woodland retains its original density beyond sampled cells.

| Field | Baseline | Expanded |
| --- | ---: | ---: |
| Mapped trunks | 50,352 | 70,125 |
| Source or estimated height values | 5,054 | 6,063 |
| Source or class-based diameters | 4,468 | 5,441 |
| Morphology groups | 5,000 | 5,972 |
| Surveyed or canopy-derived widths | 1 | 37 |
| Source-based phenology groups | 0 | 1,126 |

The original inventory includes its own municipal class estimates. The expanded bake preserves them. Values from the provincial classes or canopy pilot are estimates. Unknown fields remain unset and use the renderer's deterministic defaults. The expanded mapped growth above precedes the runtime procedural woodland recalculation.

The national monumental register and the Haskoning sample have separate source notes. Haskoning's public item did not establish redistribution terms. [National register and runtime verification](ede-tree-update.md) · [Haskoning review](ede-haskoning-tree-review.md)

## Reproduce the expanded asset

Use the pinned GIS environment, Shapely 2.1, NumPy and Pillow. The optional canopy stage also needs the Esri LERC library. The macOS bundled QGIS library works via `LERC_LIBRARY=/Applications/QGIS.app/Contents/Frameworks/libLerc.dylib`.

```sh
uv run --with pyproj==3.8.0 python -B tools/fetch-ede-trees.py /tmp/ede-tree-refresh --date 2026-11-20 --expansion-only
uv run --with pyproj==3.8.0 --with shapely==2.1.2 --with pillow --with numpy \\
  python -B tools/ede_tree_canopy.py /tmp/ede-tree-refresh/canopy
uv run --with pyproj==3.8.0 --with shapely==2.1.2 --with pillow --with numpy \\
  python -B tools/build-ede-trees.py --mor /tmp/ede-tree-refresh/mor-2026-11-20.geojson \\
  --roadside /tmp/ede-tree-refresh/gelderland-2026-11-20.geojson \\
  --canopy /tmp/ede-tree-refresh/canopy --audit /tmp/ede-tree-refresh/audit.json
```

Reuse the dated caches to reproduce this exact result. A fresh server response supplies the live inventory and its current timestamp. The bake's audit contains input SHA-256 hashes, source IDs, trunk associations, rejection masks and raw roadside intervals. The shipped EDT3 asset is 632,296 bytes with SHA-256 `8c50cee28b4c8d24a3ba7bcbdcd963dc0e391e60ecc3e9d3e370f65ed3194df7`. The original EDT2 asset remains 453,177 bytes.

EDT3 keeps the 9-byte tree records in 200 m tile order. A sparse crown byte follows surveyed or AHN-derived records. A sparse phenology byte follows records with a verified genus-derived group. Source flags 16, 32, 64 and 128 track MOR, Gelderland, canopy/AHN derivation and phenology respectively.
