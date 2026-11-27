# Electricity houses and cabinets

The 21 November 2026 Liander snapshot contained **311 medium-voltage and 97 low-voltage station points** inside the original playable Ede rectangle. These layers describe station locations. Several kinds of equipment can share a site, and an indoor or open-air installation does not supply a building exterior. The published package uses **64 verified freestanding footprints** and **two active BGT electrical cabinets**. [Alliander Open Data Elektra, CC BY 4.0](https://www.arcgis.com/home/item.html?id=11b7bcf1b78b4462b91db0dff234cf78) · [BGT catalogue](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections?f=html)

The bake used 44,235 standing BAG footprints and compatible OpenStreetMap footprints. It required a unique BAG footprint of 4–100 m² at the station point or within 0.8 m. When a fallback building overlapped, its geometry had to agree and any published `ref:bag` had to match. Every emitted building has a verified BAG and OSM identity. Matches that pointed to ordinary buildings or had ambiguous overlaps stayed out of the exterior asset. [PDOK BAG](https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand?f=html) · [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright)

All 148 candidate footprints were checked in individual **PDOK 2026 high-resolution** aerial crops. The 64 emitted exteriors have separate, visible roofs or corroborating street-level evidence. The brick and prefab finishes approximate likely exterior families where only aerial evidence exists. Ericalaan was checked against ground photographs showing a brick shell, pitched tile roof and two recessed metal doors. Its model uses one representative door. [Aerial imagery, Beeldmateriaal / PDOK](https://www.pdok.nl/-/hoge-resolutie-luchtfoto-2026-nu-beschikbaar-bij-pdok) · [Ericalaan street photographs](https://www.ededoet.nl/verslag/2001)

Of the 64 ordinary houses, 63 have 3DBAG height measurements and 15 ship with a simplified pitched roof. The remaining unit uses a documented default height. Heights use the existing Oude Kerk NAP datum. The cabinets use generic dimensions and both footprints clear mapped travel surfaces, walks, crossings, boarding areas, existing buildings and open water. The two historic footprints are held by the separate landmark models. [3DBAG data and attribution](https://docs.3dbag.nl/en/copyright/)

| Placement review | Count |
| --- | ---: |
| Freestanding brick-style houses | 46 |
| Freestanding prefab-style houses | 18 |
| Confirmed electrical cabinets | 2 |
| No unique detached footprint | 230 |
| Footprint outside ordinary enclosure size or shape | 21 |
| Likely indoor or ordinary building | 4 |
| Ambiguous OSM footprint overlap | 1 |
| Historic custom models | 2 |
| Aerial review leaves detachment or roof unclear | 84 |

The [placement audit](ede-utility-detail.audit.json) retains match IDs, image dates and crop bounds, exterior style evidence and rejected candidates. [Manual review](ede-utility-review.json) records the decisions. The replay asset is 4,200 compressed bytes. The source snapshot, photos and measured 3DBAG responses stay in the local offline cache.

## Full municipality refresh

The 23 November 2026 snapshot covers the full GM0228 polygon. It matched 670 medium-voltage and 171 low-voltage station points against 96,743 standing BAG footprints. The importer follows Liander's pages and requests BAG tiles around the station points. It reuses native RD New footprint tiles and subdivides slow requests.

The expanded asset contains **83 utility houses and 22 electrical cabinets**. All 66 previously reviewed placements and their original audit rows carry forward unchanged. The refresh added 19 houses with separate roofs visible in 2026 aerial imagery and exact OSM BAG references. Eighteen use measured 3DBAG heights and one uses the generic height. Nine have simplified pitched roofs. The exterior finishes are approximate. Twenty additional active BGT cabinets passed the ground-level travel, building and water clearance checks. Both historic custom models retain their separate placement. The new replay asset is 6,085 compressed bytes. [Placement audit](ede-utility-detail.audit.json) · [Aerial review ledger](ede-utility-review.json)

Use a separate dated cache. Review the new aerial sheets and record approvals before running the second command. For staged output, set `--asset` and `--report` to files outside the checked-in inventories.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 --with pillow \
  python -B tools/build-ede-utility-detail.py /tmp/ede-full-utility \
  --date 2026-11-23 --municipality --fetch --contact-sheets \
  --osm-source /tmp/ede-expansion/osm-gm0228-detail.json
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 \
  python -B tools/build-ede-utility-detail.py /tmp/ede-full-utility \
  --date 2026-11-23 --municipality --fetch-roofs \
  --preserve assets/ede-utility-detail.json.gz \
  --preserve-report tools/data/ede-utility-detail.audit.json
```

## Original rectangle replay

Use the 21 November 2026 snapshots and review ledger to reproduce the original city-rectangle bake.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 --with pillow \
  python -B tools/build-ede-utility-detail.py /tmp/ede-utility-review \
  --date 2026-11-21 --fetch --contact-sheets
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 \
  python -B tools/build-ede-utility-detail.py /tmp/ede-utility-review \
  --date 2026-11-21 --fetch-roofs
uv run --offline --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 \
  python -B tools/build-ede-utility-detail.py /tmp/ede-utility-review --date 2026-11-21
```

## Liander cabinet review

On 27 November 2026, the Liander low-voltage station layer returned 171 points classified as `Kast` within GM0228. Two station points matched existing BGT electrical cabinets within 12 m. The remaining 169 points were checked in 2026 aerial crops. Six new locations showed distinct cabinet-sized rectangles in both 2025 and 2026. Current ground-level BGT polygons confirm the grass verges, shrub bed or paved apron at the photographed footprints. The dated site review records each ground feature and both imagery layers. The selected points are within 0.6 m of their Liander source positions. [Liander electrical data, CC BY 4.0](https://www.arcgis.com/home/item.html?id=11b7bcf1b78b4462b91db0dff234cf78) · [PDOK BGT](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections) · [Beeldmateriaal and PDOK imagery, CC BY 4.0](https://www.pdok.nl/ogc-webservices/-/article/pdok-luchtfoto-rgb-open-) · [Site review](ede-liander-cabinets.review.json)

The game uses the fitted footprint and orientation with its standard cabinet height. The clearance check includes mapped traffic, paths, boarding areas, buildings, water, the existing cabinets and custom painted cabinets. The utility asset now holds 83 houses and 28 cabinets. The six additions have BGT ground identifiers and Liander cabinet identifiers. [Placement audit](ede-utility-detail.audit.json)

Replay the cabinet review against the existing utility asset and audit. This command uses the municipal boundary and the checked-in review.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 \
  python -B tools/build-ede-utility-detail.py /tmp/ede-liander-cabinets --reviewed-cabinets-only
```
