# Ede streetlights and bridge mounts

The 19 November 2026 bake starts with 15,102 active BGT light-mast records. It retains the relative layer and uses one physical mast for records with coincident positions on the same layer. The 1GIS layer 6 query returned 446 light records in RD New with Z. The bake clips it to 45 m around the A12 and A30 carriageways and ramps. [PDOK BGT poles](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/paal) · [1GIS light-point catalogue](https://data.overheid.nl/dataset/83397-geografische-areaalregistratie-licht-punten)

The packed asset has 15,242 lamps. It stores the base, mounting level, arm direction, light height and target height in the Oude Kerk frame. Both public sources are CC0. The [matching report](ede-lamps.review.json.gz) retains the matched light IDs, native RD coordinates and NAP heights, fixture metadata, source dates where supplied, fit IDs, duplicate BGT records and ambiguous observations.

| Decision | Records |
| --- | ---: |
| BGT coordinate/layer duplicates removed | 87 |
| BGT poles corroborated by a compatible 1GIS mounting elevation | 52 |
| Standalone 1GIS ground masts with consistent elevations | 227 |
| Surveyed masts with the 1GIS double-arm type | 94 |
| Additional overlapping 1GIS measurements discarded | 22 |
| Other 1GIS lights without sufficient distinct mounting evidence | 111 |
| 1GIS fixture-only points and positions outside the corridor | 34 |

A 1GIS base can replace a BGT estimate when the same-level survey is within 1.3 m horizontally and 0.65 m vertically of the fitted surface or terrain. Additional 1GIS-only ground masts need the same vertical check and separation from BGT placements. An elevated BGT pole follows the applicable road or path profile. The native BGT bridge footprint extends support to deck edges and parapets. Positive surveyed heights for the fixture or mast determine the model height when available. Missing dimensions use 8.2 m. Arm and target geometry follow the same surface. The double-arm model uses two opposite arms along the baked axis. The source does not provide a usable second-arm bearing for these records. A short maximum light range limits upper spotlights to the deck. Pedestrian footprints use the same relative level.

## De Poortwachter audit

All 35 BGT upper poles use the existing upper crossing fits. 25 use a consistent 1GIS mounting Z and 10 use the fitted road or path. Three level-zero source rows in the immediate crossing audit window include two coincident municipal records at X −1418.45, Z 3529.93. They give two distinct level-zero poles. The matching evidence records both source IDs. Their bases are about 13.39 m and 12.02 m NAP.

At X −1395.17, Z 3489.69, BGT pole `P0025.105ebde7da3446b8b66990361d986c28` moves from 12.88 to 18.97 m NAP, a rise of 6.10 m. Its target is at 18.97 m NAP. At X −1389.99, Z 3524.30 a second pole rises from 12.82 to 18.87 m NAP using the measured 1GIS base.

## Refresh

Supply the RD New/Z layer 6 JSON response from the 1GIS source refresh or the bundled 1GIS snapshot. Keep the saved BGT snapshot for offline rebuilds.

```sh
uv run --with 'shapely>=2.1' python tools/build-ede-lamps.py \
  --save-bgt /tmp/ede-lamps-bgt.json.gz --gis /tmp/slop-ede-1gis-20261119/6.json \
  --report tools/data/ede-lamps.review.json.gz
```

For an offline rebuild, replace `--save-bgt` with `--bgt` and use the same saved files.
