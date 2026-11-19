# Ede BGT street detail

The 2026-11-19 snapshot uses the LV-BGT collections for vegetation objects, separations, street furniture, poles, planted terrain and water. The importer selects active source records, uses the existing Oude Kerk transform and keeps the BGT relative level and registration date. Surveyed lines and footprints set the placement. Model dimensions and the orientation of point furniture are estimates. [PDOK BGT collections](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html) · [IMGeo data catalogue](https://www.geonovum.nl/uploads/standards/downloads/IMGeoGegevenscatalogus211.pdf)

```sh
uv run --with 'shapely>=2.1' python tools/build-ede-bgt-detail.py /tmp/ede-bgt-detail --coverage expanded --date 2026-11-19 --fetch
uv run --offline --with 'shapely>=2.1' python tools/build-ede-bgt-detail.py /tmp/ede-bgt-detail --coverage expanded --date 2026-11-19
```

`--coverage pilot` selects Oude Kerkplein, Kuiperplein, Ede-Wageningen and Kolkakkerweg. Expanded coverage also samples Marktplein, Proosdijpark and the Rijksweg shelter. The compressed runtime asset can be rebuilt offline from the saved GeoJSON and gate snapshots. `--output` and `--review` can select temporary destinations while comparing imports. The [machine-readable review](ede-bgt-detail.review.json) records the source dates, site bounds, placement counts, affected road and gate IDs, and withheld positions.

| Feature | Active native records | Placed pieces or samples |
| --- | ---: | ---: |
| Fence | 70 | 57 |
| Hedge | 1 | 1 |
| Bench | 2 | 2 |
| Bike rack | 83 | 73 |
| Bollard | 57 | 40 |
| Bus shelter | 1 | 1 |
| Playground equipment | 0 | 0 |
| Shrub | 204 | 484 |
| Ground cover | 393 | 535 |
| Water edge | 3 | 8 |

- **Access clearance.** The exporter trims fences and hedges where their geometry overlaps a same-layer route buffer. It reserves mapped cycle lanes and sidewalk offsets as well as road centrelines and same-level GTFS boarding corridors. It holds back conflicting point furniture. The latest import flags 17 trimmed route conflicts and 26 point props with route overlap. Five barriers were trimmed against existing civil geometry and one point prop was withheld for an existing-asset overlap. A geometric recheck of the placed barriers found no overlap larger than 0.007 m² with same-level travel surfaces or the 11 nearby GTFS boarding corridors.
- **Gates.** Ten mapped gate or entrance nodes fall in these sites from the 2026-11-19 OSM extract. One, node `44925795`, lines up with Ede-Wageningen fence `L0004.8bf0e125047d40eab5c4411b924b03da`. The importer splits its geometry at the mapped opening. Gate width follows the OSM tag when usable, with defaults of 3.2 m for vehicle gates and 1.5 m for pedestrian openings. [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- **Decks.** Three station fence pieces are on BGT deck `G0228.fb4f59fbd4b440dea6e4074e91013155` at Albertstunnel and use that deck’s fitted surface. Four raised ground-cover samples near Hartogspad and Kuiperplein were withheld until there is an applicable surveyed footprint or height. Kuiperplein fences `G0228.d9ec9ab56a224fba8e08aa009b08665b` and `L0004.127d5fac783545bcb5d80ab14851ee17` meet at one endpoint.
- **Furniture coverage.** The dated station window includes 67 racks and two benches. PDOK returned zero station shelters and zero mapped playground equipment across the playable bounds. The single Rijksweg shelter is at local `(-4040.96, 38.78)` and has no reliable match among the locally shipped GTFS stops. Furniture coverage reflects the optional IMGeo classes supplied by the source custodians. [PDOK street furniture](https://api.pdok.nl/lv/bgt/ogc/v1/collections/straatmeubilair)
- **Planting and shorelines.** New planting samples stay inside native low vegetation and ground-cover polygons, with mapped routes and existing trees kept clear. Proosdijpark and Rijksweg contain verified BGT water edges near mapped routes. The importer uses source shorelines and removes overlapping civil walls and redundant water edges.
