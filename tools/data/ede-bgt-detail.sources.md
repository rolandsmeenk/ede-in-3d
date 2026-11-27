# Ede BGT street detail

The November 19, 2026 snapshot covers the 39.92 km² playable rectangle in 12 request tiles. The downloader follows every PDOK page, keeps the latest active version of each local source ID, and transforms the geometry to the existing Oude Kerk frame. The seven original preview areas remain available through `--coverage expanded`. [PDOK BGT catalogue](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html) · [IMGeo data catalogue](https://www.geonovum.nl/uploads/standards/downloads/IMGeoGegevenscatalogus211.pdf)

## Refresh

Download the Gelderland and Utrecht OSM province extracts for gate locations, then run the dated fetch. Keep the saved files to rebuild offline. The shoreline asset should be baked first so the planting and land classification use the same water boundary as the game.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with osmium --with rasterio --with pyproj==3.8.0 \
  python tools/build-ede-bgt-detail.py /tmp/ede-bgt-town --coverage town \
  --date 2026-11-19 --fetch --station-ahn --osm gelderland.osm.pbf utrecht.osm.pbf
uv run --offline --python 3.12 --with 'shapely>=2.1' --with rasterio --with pyproj==3.8.0 \
  python tools/build-ede-bgt-detail.py /tmp/ede-bgt-town --coverage town --date 2026-11-19
```

`--output`, `--land-output` and `--review` select temporary destinations while comparing variants. The runtime benchmark stages use `?perf=1&bgtStage=street` for furniture, fences, hedge, shoreline and planting, `bgtStage=infrastructure` to add road detail and station roofs, and `bgtStage=all` to add the land texture. The geometry asset is 778,665 bytes compressed and the land texture is 656,305 bytes compressed.

## Inventory

The machine-readable [placement review](ede-bgt-detail.review.json) includes each tile’s matched counts, affected road and gate IDs, and records with uncertain height or access clearance. The two counts below distinguish physical source features from the pieces or instances they produced after clipping and simplification.

| Feature | Active mapped records | Placed pieces or instances |
| --- | ---: | ---: |
| Fence | 1,507 | 1,425 |
| Hedge | 47 | 38 |
| Bench | 31 | 30 |
| Bike rack | 104 | 91 |
| Bollard | 162 | 126 |
| Bus shelter | 1 | 1 |
| Playground equipment | 0 | 0 |
| Shrub | 4,431 | 13,754 |
| Ground cover | 12,539 | 22,507 |
| Shore edge | 2,914 | 2,164 |
| Balustrade | 15 | 8 |
| Guardrail | 29 | 26 |
| Gutter | 73 | 71 |
| Drain and grate | 61 | 61 |
| Bin | 26 | 24 |
| Container | 31 | 27 |
| Station canopy | 5 | 2 |
| Station landings and steps | 0 | 0 |

- **Access.** The bake trims barriers against same-level travel strips, including mapped cycle lanes, sidewalk offsets and GTFS boarding corridors. It recorded 298 route trims, 55 withheld point placements, one overlap with an existing asset and 33 trims against existing civil geometry. It used 301 mapped gate points and recorded 23 gate openings. The gate snapshot is dated November 18, 2026. The geometric recheck found no barrier overlaps larger than 0.007 m² with a same-level travel strip or boarding corridor. The mapped Rijksweg shelter has no confident GTFS stop match. [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- **Decks and drainage.** Three fences, two balustrades and two guardrails use verified positive-level mount footprints or fitted profiles. The bake withheld 16 unsupported elevated or depressed placements. It removed one matching barrier segment covered by 1GIS. The surveyed gutter, drain and grate geometry is drawn close to the surface and only visible at short range. Point drain and cover records were absent. [PDOK Weginrichtingselement](https://api.pdok.nl/lv/bgt/ogc/v1/collections/weginrichtingselement_lijn) · [Rijkswaterstaat 1GIS](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer)
- **Station canopy pilot.** The 20 November 2026 resampling kept the 19 November BGT footprint `G0228.4a117f153d1842c2a12559eca57dc532`, its two piece IDs and the same split. The two AHN6 roof sections are 27.04 and 28.63 m NAP after pixel-centre interpolation. On the same AHN6 extracts, the previous nearest-pixel sampler gave 27.04 and 28.64 m NAP and a DTM median of 17.85 m NAP. The new DTM median is 17.83 m NAP. The 15 cm modeled slab thickness is estimated. Three slim column positions were fitted from the published entrance and architect imagery. Their pads clear the mapped travel and boarding strips and their feet meet the existing rendered plaza. [ProRail entrance illustration](https://www.prorail.nl/nieuws/contouren-nieuw-station-ede-wageningen-zichtbaarder) · [Haskoning station project](https://www.haskoning.nl/nl-NL/projecten/indrukwekkend-nieuw-station-ede-wageningen-multifunctioneel-en-toekomstbestendig) Four other mapped canopies lacked usable roof heights, and the station window supplied no landing or entrance-step records. [PDOK Gebouwinstallatie](https://api.pdok.nl/lv/bgt/ogc/v1/collections/gebouwinstallatie) · [AHN6 DSM and DTM, CC BY 4.0](https://www.ahn.nl/eerste-deel-ahn-6-beschikbaar)
- **Land and shore.** The 3,698 × 2,700 material mask samples woodland, heath, grass, planting beds and yards from active BGT terrain parts at 2 m spacing. The runtime shades the existing 12 m terrain with this mask and aerial tint. The bake clears water cells and keeps planting clear of the shared water outline. The geometric recheck found zero shrub or ground-cover placement centres inside the shared water polygons. The bake uses mapped banks near travel routes and trims them around existing civil walls. [PDOK terrain and water collections](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html)

## Planting categories

The November 23, 2026 vegetation snapshot supplies the physical appearance category for each matched planting placement. The renderer uses distinct models for ornamental shrubs, natural scrub, shrub roses, woodland understory, ornamental plants, ground cover, and grass and herbs. Woodland understory uses wider spacing than shrub beds. Positions are sampled from planting polygons after access, tree and water clearance checks. [PDOK vegetated terrain](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/begroeidterreindeel) · [IMGeo data catalogue, §8.6](https://www.geonovum.nl/uploads/standards/downloads/IMGeoGegevenscatalogus211.pdf)

## Paving and land cover in the 500 m exterior

The 23 November 2026 PDOK snapshot supplies 9,725 paving records outside Gemeente Ede and within 500 m of the municipal boundary. It covers carriageways, cycleways, footways, paved verges, parking and 12 railway beds. The bake matches 1,674 ways in the extended OSM road graph. Two surveyed local carriageway polygons intersect the Huttopia grounds. The atlas uses the polygons directly. The 3D view builds nearby 500 m batches in short frame slices while the existing AHN terrain remains visible. It retains up to 48 pavement batches around the camera.

The separate 12 m land-cover mask covers 215,186 cells in the exterior. It shades woodland, heath, grass, planting beds and courtyards on the existing terrain meshes. The compressed mask is 49 KB. Municipality shading continues to use the original mask. [PDOK BGT collections](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html)

Bake the expanded travel graph first, then run these commands. Reuse the same dated directories and omit `--fetch` for an offline rebuild.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 \
  python -B tools/build-ede-corridor-paving.py /tmp/ede-fringe-paving \
  --date 2026-11-23 --fringe --fetch
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 --with numpy \
  python -B tools/build-ede-corridor-paving.py /tmp/ede-fringe-land \
  --date 2026-11-23 --fringe-land --fetch
```
