# Rijkswaterstaat 1GIS motorway detail

The 19 November 2026 extraction used the public production MapServer. It preserves the supplied RD New coordinates (EPSG:28992) and Z samples in metres NAP. The query requests `returnZ=true` and rejects a truncated response. The offline snapshot keeps the source points, paths and polygon rings with their dates, object and GlobalIDs, native types and relative levels. The runtime asset projects them into the existing Oude Kerk frame. The source layers are published by Rijkswaterstaat under CC0 1.0. [Rijkswaterstaat 1GIS](https://www.rijkswaterstaat.nl/zakelijk/zakendoen-met-rijkswaterstaat/werkwijzen/werkwijze-in-gww/data-eisen-rijkswaterstaatcontracten/1gis) · [MapServer](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer) · [Lighting licence](https://data.overheid.nl/dataset/83397-geografische-areaalregistratie-licht-punten) · [Marking licence](https://data.overheid.nl/dataset/80488-geografische-areaalregistratie-markering-lijnen) · [Furniture licence](https://data.overheid.nl/dataset/79146-geografische-areaalregistratie-meubilair-lijnen) · [Structure licence](https://data.overheid.nl/dataset/80494-geografische-areaalregistratie-kunstwerk-vlakken)

| 1GIS layer | Ede extent | Within corridor | Use |
| --- | ---: | ---: | --- |
| 6 Lights | 446 | 423 | Evidence for the separate BGT and 1GIS lamp bake |
| 9 Road chainage | 315 | 311 | 282 surveyed hectometre markers |
| 13 Point furniture | 1,058 | 1,033 | NBd panel and gantry-height evidence. Standard sign faces come from NDW |
| 23 Guide construction | 591 | 578 | 538 rail and solid-barrier sections |
| 30 Line markings | 1,237 | 1,210 | 1,317 surveyed paint sections after splitting at way and level boundaries |
| 31 Line furniture | 73 | 72 | 41 gantries and 15 fences or parapet rails |
| 44 Structure polygons | 58 | 53 | Bridge and underpass footprint evidence |
| 45 Structure-part polygons | 227 | 216 | Deduplication evidence and one new noise barrier |

The corridor extends 50 m from the A12 and A30 carriageways and ramps within the playable bounds. The gantry and panel inventory also covers the two N781 approaches to exit 24. Source geometries crossing the clip remain intact in the offline snapshot and the bake clips their renderable parts. Numeric GISObjectIDs can repeat across distinct survey rows. Those runtime identities also retain the distinct ObjectID, and all identities are checked for uniqueness. The bake uses valid survey, update, inspection, handover or construction dates in that order and filters distant-year placeholders.

The 118,229-byte motorway asset contains 2,194 pieces. OSM and NWB evidence associates 2,118 pieces with an NWB road section, and 170 have a fitted grade profile. The same-level review group includes 791 parts with two plausible carriageway matches, including 481 paint sections. Because their surveyed placement stays on the same modeled level, they can be drawn. Unresolved different-level ties are withheld, as are barriers that would float beyond a deck shoulder. The report records 23 unsupported shoulder sections, 38 unmatched rail/structure sections, and 439 unmatched or too-short paint sections. Four barrier alignments intersect mapped local access and use visual geometry only.

The crossing audit checks all 555 candidate motorway barriers against the fitted bridge and underpass travel surfaces. It moved 12 mixed-Z railing sections onto the upper decks at the N224, Maanderbroek and Maanderdijk. Ten use the exact BGT deck surface. Two at Maanderdijk use the fitted ramp profiles, verified against the 1GIS underpass footprint and railing elevations near 15.3 m NAP. Their visual deck shoulders follow layer 44 footprint `2102726474`, with rail ends clipped to supported spans of 15.30 and 15.20 m. The N224 railing followed the upper BGT edge within 0.05 m, even where the middle survey vertices dropped to road level. Maanderbroek railing `1gis:31:2102710985@13345` was withheld near scene X −4169.44, Z 2177.63. The fitted crossing conflicts with its surveyed 8.31–9.25 m NAP and the upper deck is approximately 15 m NAP. The report's `crossingBarriers` array gives each corrected or withheld identity, fitted profile and scene position.

The importer removed 20 coincident 1GIS placements and trimmed 17 BGT wall overlaps. It checked 269 structure and structure-component polygons, of which 157 overlap existing BGT structures by at least 40 percent. Existing BGT models and fitted civil surfaces serve the covered structures. The 1GIS footprints alone do not establish new model heights for all of the other components. Most DTB boundary fences have no equivalent in layer 31, whose local records mainly describe railings and portals.

The marking style retains surveyed widths and published dash and block dimensions. Pattern phase follows the original line distance across clip boundaries. Generic or transverse marks with no reliable longitudinal layout, including calibration and triangle marks, remain in the survey and review. The existing traffic lane graph retains authority for vehicle position, access and turning.

The 1GIS portal Z may mark the footprint or the suspended span. Five gantries have plausible surveyed span heights. Seventeen have nearby elevated 1GIS wayfinder points, and the other nineteen use an estimated 5.85 m above the fitted or accepted local surface. The exit 24 N781 combi portal `2102710371` uses the surveyed panel elevation of 19.116 m NAP. The physical portal type is preserved for checking panel roles against the source standard. [Rijkswaterstaat VDC specifications](https://www.rijkswaterstaat.nl/zakelijk/werken-aan-infrastructuur/bouwrichtlijnen-infrastructuur/portalen-en-uithouders)

| Site | Scene X, Z metres | Guardrail sections | Gantries | Paint sections |
| --- | --- | ---: | ---: | ---: |
| Maanderbroek | −4100, 2210 | 61 | 2 | 61 |
| De Poortwachter | −1405, 3506 | 40 | 5 | 178 |
| A12 Ede exit 24 | −1400, 3667 | 17 | 4 | 101 |
| A30 Ede-Noord | −3600, 71 | 17 | 4 | 181 |
| A30 Ede | −3850, 1327 | 11 | 3 | 135 |

The site counts include geometry within 180 m of the indicated view position. The report generated by the importer lists omitted source IDs and overlap ratios per structure.

## Refresh

Rebuild with the bundled 529,894-byte survey snapshot and the existing BGT, NWB and grade assets.

```sh
uv run --with pyproj --with 'shapely>=2.1' python tools/build-ede-1gis.py --report /tmp/ede-1gis-report.json
```

To refresh the public survey and replace the offline source snapshot, download the latest source at the same RD bounds.

```sh
uv run --with pyproj --with 'shapely>=2.1' python tools/build-ede-1gis.py /tmp/ede-1gis --fetch \
  --save-snapshot tools/data/ede-1gis.snapshot.json.gz --report /tmp/ede-1gis-report.json
```
