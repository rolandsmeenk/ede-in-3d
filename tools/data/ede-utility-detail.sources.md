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

## Refresh

Fetch the dated source snapshot and review the generated aerial contact sheets. Retain the imagery and sources locally. Update the review ledger for changed footprints and new approvals before rebuilding. The current import uses the original Ede bounds with verified utility records, so covered railway and terrain-only extensions keep their existing scenery.

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
