# Ede coordinate conversion verification

The runtime still uses the Oude Kerk affine from map metadata. X goes east, Z goes south, and Y is measured from 22.54 m NAP. Offline geographic and projected inputs use the shared affine and the pinned RDNAPTRANS2018 pipeline for RD New measurements. Browser positions, GTFS and live positions use the stored affine. [Frame, pins and source axis order](ede-gis-v1.md)

The 3DBAG stream composes the glTF node hierarchy, y-up to z-up rotation and inherited 3D Tiles transforms. It projects every transformed ECEF vertex into the shared scene affine during decoding. Bounding boxes use the same projection. Building relief uses ellipsoid-height differences, while building bases use terrain or surveyed NAP. Tile frustum bounds use a terrain-based vertical envelope. [OGC transform order](https://docs.ogc.org/cs/22-025r4/22-025r4.html) · [3DBAG delivery and source datum](https://docs.3dbag.nl/en/delivery/webservices/)

## Horizontal controls

Independent PROJ EPSG:4978 positions for these controls use an ellipsoid height of 75 m. Residuals measure distance to the stored scene affine before mesh rounding.

| Control | Tangent-plane residual | Corrected residual |
| --- | ---: | ---: |
| Oude Kerk origin | 0.000 m | <1 µm |
| Northwest corner | 3.418 m | <1 µm |
| Northeast corner | 0.745 m | <1 µm |
| Southwest corner | 5.090 m | <1 µm |
| Southeast corner | 1.569 m | <1 µm |
| Concordiamolen | 0.017 m | <1 µm |
| Ede-Wageningen | 0.042 m | <1 µm |
| Maanderbroek | 2.537 m | <1 µm |
| De Poortwachter | 1.021 m | <1 µm |
| Kernhem | 0.948 m | <1 µm |

The 34 published CRS84/RD station pairs have a **16.3 mm mean and 31.4 mm maximum** residual. The independent ETRS89 observation differs by **0.13 mm**. Scene → RD → scene closes within **3 nm**. JavaScript and Python agree within **0.1 nm** on the shared affine fixtures. Rounding the 34 projected controls to 1 mm adds at most **0.69 mm**, and storing the tested ECEF projections as Float32 adds at most **0.21 mm**. [Published controls and source precision](ede-gis-controls.json)

## Real buildings and decode time

LoD 2.2 roof and wall vertices were paired by BAG ID with the corresponding RD New CityJSON records. Heights are compared above each source’s lowest building vertex. The decoded ellipsoid minima are 43.43–43.46 m above the CityJSON NAP minima at these four sites. The remaining vertex differences include provider quantization and geometry encoding.

| Building | Horizontal vertex p95 before → after | Relative-height p95 before → after |
| --- | ---: | ---: |
| Raadhuis | 32 → 28 mm | 21 → 20 mm |
| Concordia maalderij | 28 → 20 mm | 8 → 8 mm |
| ENKA Westhal | 215 → 26 mm | 56 → 12 mm |
| Bospoorttunnel pilot house | 29 → 25 mm | 18 → 18 mm |

In Node 25 on an M4 Pro, five cached GLBs with 73,121–288,091 vertices were parsed and baked six times per variant after warm-up. Median parse plus synchronous mesh bake took **51.8 → 70.2 ms**. The mesh-bake portion took **49.5 → 68.1 ms**. Requests and streaming waits are outside that measurement.

Chrome 152 on the same machine ran three alternating 270-frame passes per variant at 1080 × 640, with identical time, graphics settings and cached GLBs. Every pass started with one resident BAG tile. Further tiles were requested during the pass. Frame time stayed at **16.7 ms median and 33.4 ms p95** in both variants. The longest completed BAG work slice was **3.6 → 4.0 ms**, across those runs. Reproduce using `EDE_BENCH_SCENARIOS=bag` in [the benchmark harness](../benchmark-ede.mjs).

## Rebuilt assets and site checks

| Path | Result |
| --- | --- |
| BGT and 1GIS lamps, NBd panels, WKD speeds and cycle strips, NDW street features | Rebuilt from saved and recovered snapshots with source IDs and dates. The old RD polynomial differed by **0.295–0.322 m** at the origin and corners. All 32 NBd panel IDs, 6,345 standard sign IDs and 201 crossing IDs were retained. Three crossing centres moved 1.22–1.91 m when different source coverage won the geometric match. The lamps export on a 20 cm horizontal grid, with at most 13.6 cm measured rounding in the bridge audit. [Lamp sources](ede-lamps.sources.md) · [NBd sources](ede-nbd-signs.sources.md) · [Traffic sources and refresh](ede-traffic-sources.md) |
| AHN, PDOK aerial imagery and trees | Rebuilt the 12 m terrain, aerial texture and palettes, baseline and expanded trees, and targeted AHN surfaces. The terrain kept its origin and dimensions. Its pinned sampling centres moved **0.005–0.033 m** at the checked controls. In-bounds terrain height changes were **0.02 m p95**, with larger changes beside native raster gaps. Baseline tree packing rounds to 0.20 m per coordinate. [Raster and tree verification and refresh](ede-raster-tree-gis-verification.md) |
| Parking heights | Re-seated 8,179 ground bays to the rebuilt AHN grid. Fitted levels, IDs and access were retained. A complete parking refresh requires the historical OSM and WKD extracts. [Parking rebase check](ede-raster-tree-gis-verification.md) |
| Ede-Wageningen | Rechecked the two BGT canopy pieces from the dated BGT footprint and AHN6 extracts. Roof samples changed from 27.04/28.64 to **27.04/28.63 m NAP** on the same inputs. The canopy footprints and three support pads were retained. [Canopy source notes](ede-bgt-detail.sources.md) |
| Shared geographic inputs | OSM, GTFS, live buses and trains, and browser helpers use the same metadata coefficients. The old OSM scale formula differs by at most **1.15 µm** at the map corners, below the 0.1 m map export grid. The full historical OSM and GTFS extracts were unavailable, so their published geometries and source dates were retained. |

At **De Poortwachter**, the tracked upper lamp is inside the level-1 BGT footprint. Its packed base is 19.14 m NAP and its target sits on the 18.97 m fitted profile. The 0.17 m difference is between the survey and the fitted deck. The lower route and fixtures remain separate. At **Maanderbroek**, two sampled sets of rendered paint lie within 0.025 m of the archived 1GIS source lines horizontally. The upper divider’s source Z differs from the fitted deck by 0.14–0.37 m. The independent aerial trace differs from the 1GIS divider by up to 0.31 m in their reviewed overlap. [Lamp source and mount audit](ede-lamps.sources.md) · [Aerial marking evidence](ede-lane-aerial.sources.md)

The pinned **1GIS detail** candidate used the existing 19 November survey and preserved the levels of shared IDs. It removed six rendered pieces, added three and changed 24 way associations. The current reviewed rendering remains in place pending those match checks. The Maanderbuurtweg profiles also retain their reviewed fit because the native raster test could not corroborate four sections. Concealed floors and soffits still need independent measurements. [Motorway evidence](ede-1gis-verification.md) · [AHN pilot limitations](ede-ahn-pilot.md)

Verification passed all 414 JavaScript tests and all 47 Python tests. The final browser site check loaded the new assets and reported no runtime exceptions.
