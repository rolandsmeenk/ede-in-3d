# A12 and A30 lane evidence in Ede

The motorway lane asset uses the Rijkswaterstaat WEGGEG lane collection and matching NWB road sections, both CC0. The source snapshot includes the Ede bounding box, retrieval time, original geometries and properties, and OpenStreetMap route and carriageway tags for the scene's motorway and ramp ways. OSM road data is © OpenStreetMap contributors under ODbL. [WEGGEG lane collection](https://api.pdok.nl/rws/weggegevens/ogc/v1/collections/wegvak_rijstroken), [NWB road sections](https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1/collections/wegvakken), [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).

```bash
python3 tools/build-ede-motorway-lanes.py --fetch  # refresh public sources and build
python3 tools/build-ede-motorway-lanes.py          # rebuild from the checked-in snapshot
python3 tools/build-ede-motorway-lanes.py --check   # verify the checked-in build offline
```

The importer joins each WEGGEG record by NWB road-section ID and start date, then checks the published metre offsets against the section's geometry. Its OSM match uses travel direction and centreline proximity, plus route and carriageway identifiers where OSM supplies them. Normalized intervals follow the OSM point order, including for reversed travel. Each applied interval links to the WEGGEG record with its original NWB offsets and start and end counts.

WEGGEG's lane count can exclude block-marked divergence and turn lanes. Aerial samples show this on the A30 and at both A12 interchanges in the scene. The `review` entries preserve count disagreements and ambiguous matches. WEGGEG tapers are ranges in which the lane count changes. The three corroborated ranges use the existing OSM join as the simulation's lane-count boundary. Chapter 19 of the WEGGEG handbook explains the registration rules. [Rijkswaterstaat WEGGEG handbook](https://downloads.rijkswaterstaatdata.nl/weggeg/productinfo/beschrijvende_documentatie/Gebruikersinformatie%20WEGGEG%20v2.5.pdf).

The 2026 PDOK high-resolution orthophoto comes from Beeldmateriaal Nederland under CC BY 4.0. The imagery review records the exact crops and visible markings for every WEGGEG record with unequal start and end counts, along with cross-sections for representative records whose constant count differs from the mapped full carriageway. [2026 PDOK high-resolution orthophoto](https://www.pdok.nl/-/hoge-resolutie-luchtfoto-2026-nu-beschikbaar-bij-pdok), [imagery review](ede-motorway-lanes.review.json).

| Verified transition | Positions in the simulation | NWB section | Published offsets |
| --- | --- | --- | --- |
| A12 to A30 connector widens from one lane to two between OSM ways 6960084 and 636835435 | X −3847.7 m, Z 2473.2 m | 341296004 | 77–124 m |
| A12 to A30 connector narrows from two lanes to one between OSM ways 663875342 and 6960093 | X −4006.3 m, Z 2124.9 m | 341296004 | 662–704 m |
| A30 toward A12 narrows from two lanes to one between OSM ways 6960067 and 1092588591 | X −3541.9 m, Z 2633.1 m | 340297005 | 1225–1297 m |

The A30 toward A12 record publishes `1 -> 2`. The digitized offset direction and aerial markings show two lanes narrowing to one in travel order. The asset keeps both observations and their provenance.
