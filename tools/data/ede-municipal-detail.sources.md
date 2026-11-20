# Ede municipal street detail

The offline BGT command merges Ede's litter bins, ACV container positions and play-site points with the existing BGT furniture. The game's default street-detail asset carries the municipal placements separately. It can be refreshed without rebuilding the PDOK base, and the data audit records every in-bounds municipal source ID, including duplicates and holds. No source GIS service is required by the running game.

## Snapshot and coordinates

The public Ede WFS response dated **20 November 2026** supplied the three point layers. All spatial validation uses the exact playable bounds in the existing Oude Kerk frame. The ACV and playground layers declare geographic coordinates, although their numeric positions are easting and northing in RD New. The bake verifies raw RD ranges, keeps the declared CRS in the audit and projects through the pinned RDNAPTRANS2018 converter. The municipal WFS capabilities declare no service fee or access constraint. They do not specify a licence for these three layers. [Gemeente Ede WFS capabilities](https://geo.ede.nl/geoserver/Ede/wfs?service=WFS&version=2.0.0&request=GetCapabilities) · [Pinned GIS frame](ede-gis-v1.md)

| Layer | Municipality-wide | Playable records | Distinct locations |
| --- | ---: | ---: | ---: |
| `Ede:mor_afvalbakken` | 935 | 656 | 656 |
| `Ede:mor_acv_containers` | 1,107 | 907 | 748 |
| `Ede:mor_speelplekken` | 287 | 218 | 218 |

Two playground controls confirm the coordinates against current imagery and OSM geometry. De Oude Hofstede's municipal point `mor_speelplekken.96` lies in OSM playground `w85031545`. At Proosdijpark, `mor_speelplekken.150` lies west of `w1169127169`, inside the larger reviewed play area. Four controls at a mapped ACV group agree with PDOK BGT to within 0.20–0.30 m. The audit records the IDs and exact distances. [Playground placement evidence](ede-playground-pilots.json) · [PDOK BGT collections](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html)

## Placement review

The pre-existing town bake supplied 24 litter bins, 27 containers and the map supplied 119 playground outlines. The litter source points had no unique BGT bin match within 1.5 m. Eight ACV placements supersede BGT containers with an unambiguous match within 1.8 m. The 159 coincident ACV records remain under their site groups in the audit so their waste streams and source evidence can be traced.

Road and cycleway footprints, building outlines, water, deck and tunnel surfaces, station boarding corridors and fitted crossing ends constrain the footprint of each bin and container. The OSM access snapshot adds 352 entrance, gate and lowered-kerb nodes. Parking aprons retain access, with small edge overlaps accepted when a prop stays clear of the interior and adjacent travel lane. The bake uses mapped sidewalk access to orient a prop when available. A small walking-route adjustment can move a prop up to 0.4 m while keeping the same support class. Lane or cycle conflicts remain in the audit for review. [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright)

| Result | Count |
| --- | ---: |
| New street bins | 531 |
| Bin sites held for review | 125 |
| New ACV sites | 376 |
| ACV sites held for review | 372 |
| Underground ACV heads | 139 |
| Semi-underground ACV heads | 17 |
| ACV sites rendered with a generic form | 220 |
| Walking-route bin adjustments within the same support | 17 |
| Photo-verified façade bin adjustment | 1 |
| ACV sites adjusted within the same support | 4 |
| Play sites tied to an ordinary OSM outline | 72 |
| Sites with surveyed equipment layouts | 2 |
| Play-site points awaiting an outline or surveyed references | 144 |

The 18 April 2021 ground reference at HEMA on Grotestraat corroborates one split-compartment design, `mor_afvalbakken.650`. The reviewed face points west-northwest. The rendered bin is 0.45 m outward from the coincident façade edge and lies on BGT paving, clear of the door and service gate. The position-only litter records use a neutral model. [Atlas van Ede photograph](https://www.atlasvanede.nl/toen-en-nu/van-centrum-tot-buitenwijk/winkels-in-het-centrum/grotestraat-noord)

The most common held conditions were building overlaps, travel paving conflicts and parking interiors. Audit records can have several reasons. The 348 accepted ACV sites with operator matches retain waste streams, and model type is used only with corroborated physical evidence. A group can retain streams while using the generic form. Underground designs render the visible deposit head and mounting pad. [ACV public collection map](https://acv-groep.nl/kliko-s-containers-en-pmd-zakken/brenglocaties) · [ACV source crosswalk](ede-mor-acv-profile.json)

The two surveyed play sites use dated imagery to fit ten equipment placements, two safety aprons and two entrance surfaces. Elsewhere the existing ground polygons display the mapped site boundaries, and the audit preserves play-site points whose equipment is unverified. [Ede's 2026 playground programme](https://ede.begroting-2026.nl/p24838/wat-gaan-we-doen) · [Surveyed layouts and references](ede-playground-pilots.json)

## Refresh the municipal sidecar

```sh
uv run --with pyproj==3.8.0 --with shapely==2.1.2 python -B tools/build-ede-bgt-detail.py \\
  --municipal-snapshot /tmp/ede-municipal-2026-11-20 --fetch
```

Omit `--fetch` to rebuild from a previously downloaded cache. With neither Overpass endpoint available, the command uses bounded public OSM map extracts for the entrance terms. If they are unavailable, path, paving, building, boarding and crossing clearance are still checked. The dated WFS files and optional `access.json` belong in the offline cache. Source hashes and exact placement decisions are retained in the compressed review.

- [Municipal runtime asset](../../assets/ede-municipal-detail.json.gz)
- [Complete municipal placement audit](ede-municipal-detail.review.json.gz)
