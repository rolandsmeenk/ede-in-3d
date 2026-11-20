# A30 façades in Ede in 3D

The 20 November 2026 visibility survey followed the A30 from Maanderbroek to the northern map boundary. It sampled 94 mapped ways at 3,175 driver-eye positions, including 1,020 northbound, 1,209 southbound and 946 on ramps and interchange links. It skipped six covered positions. Of the remaining viewpoints, 2,293 used fitted lane positions and 882 used nominal lane centres. The bake considers views up to 1.5 km away and uses the 12 m AHN terrain, LoD 2.2 buildings and 35 BGT and 1GIS barriers to test sightlines. It leaves out foliage, traffic and temporary obstructions. [3DBAG](https://docs.3dbag.nl/en/copyright/) · [OpenStreetMap](https://www.openstreetmap.org/copyright) · [AHN](https://www.ahn.nl/dataroom) · [Rijkswaterstaat 1GIS](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer)

The survey found 15,772 walls across 5,755 buildings. Of those walls, 11,579 were absent from the A12 inventory. The runtime layer contains 14,796 inferred walls and 29 photo-informed walls on six buildings. Another 119 surveyed walls belong to existing custom landmarks, including Plantion. OSM fallback buildings use 10,407 matched edge treatments. The 130 streamed façade tiles and fallback data total 881,564 bytes compressed (861 KiB). Many walls have more than one route witness. The survey found 6,658 northbound, 9,842 southbound and 10,275 ramp-visible walls.

The inferred walls use exact LoD 2.2 dimensions and BAG building use, construction year and address counts. The 20 November 2026 attribute snapshot covers all 5,343 surveyed BAG IDs. It preserves the current register status, including 60 buildings marked demolished whose geometry is still present in the pinned September 2025 3DBAG release. OSM fallback styling requires a corresponding surveyed edge. Split, overhanging or recessed walls sometimes have no OSM equivalent. [PDOK BAG building register](https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand?f=html)

## Exterior references

The photos were used offline to fit materials and openings to the surveyed walls. The game uses shared materials and opening masks. Opening sizes, colours and material seams are estimates.

| Site | Details applied |
| --- | --- |
| Plantion | The existing model now has the patterned concrete plinth along the motorway and rail sides. The placement and repeat spacing of the leaf relief are approximate. [Breddels Architecten](https://www.breddels.nl/projecten/werken/bloemenveiling-plantion-ede/) · [Kreeft extension](https://bouwbedrijfkreeft.nl/projecten/plantion-ede/) |
| A.S. Watson, Celsiusstraat 37 | Raised office glazing and contrasting silver hall panels fitted to separate wall heights. [Architectuurgids](https://www.architectuurgids.nl/project/item/prj_id/2240) |
| Celsiusstraat 34–38 | Brick piers, dark bands, horizontal windows and tall entrance glazing on the main west-facing office elevation. [FlexOffiz](https://flexoffiz.nl/kantoorruimte-huren-ede/) · [ActiVast](https://activast.nl/vastgoedbeleggingen-transacties/) |
| Galvanistraat 119 / Celsiusstraat 18 | Slate warehouse walls and contrasting north and west office panels with paired glazing rows. [CityLink](https://citylink-logistics.com/citylink-buys-business-building-on-business-park-heestereng-in-ede-2/) |
| Bruil, Neonstraat 31 | Dark panel treatment on the surveyed east-facing industrial walls. The translucent corner in the gallery faces Neonstraat on the west side. [Bruil](https://www.bruil.nl/projecten/uitbreiding-bruil-beton-en-mix) |
| Autobedrijf G. Braber, Dwarsweg 20 | Two rows of showroom glazing and a light roof band on the Galvanistraat side. The exact overhang thickness and signs are omitted. [G. Braber](https://www.autobraber.nl/over-ons/) |
| Henk Scholten Volvo, Neonstraat 19 | The north-facing showroom uses pale green-grey vertical paneling and glazing. Its projecting clock and branding are omitted. [Rodeca](https://rodeca.nl/ede-volvodealer-henk-scholten/) · [Henk Scholten Volvo](https://www.henkscholten.nl/volvo/henk-scholten-ede/) |

Westeneng and the new HEKO buildings were reviewed but had no verified visible LoD 2.2 wall matches in the survey. They need a source geometry refresh or a separate measured model.

## In-game verification

Chrome WebGPU used the fast preset, a 1,200 × 720 viewport, fixed midday lighting and paused traffic motion. Each timing uses 70 frames from the same surveyed driver-eye position after a camera settle. The final comparison reached its first playable frame in 12.64 s before and 11.70 s after on localhost. Peak resident façade mask memory was 3.60 MB before and 3.64 MB after across these views.

| View | p95 before, ms | p95 after, ms | Median draw calls before | Median draw calls after |
| --- | ---: | ---: | ---: | ---: |
| Plantion, southbound | 19.4 | 18.0 | 693 | 777 |
| Bruil, southbound | 19.4 | 18.8 | 739 | 794 |
| Braber, Ede-West ramp | 35.2 | 25.4 | 2,387 | 2,388 |
| Galvanistraat, northbound | 26.5 | 27.3 | 2,488 | 2,475 |
| A.S. Watson, northbound | 25.4 | 24.5 | 2,356 | 2,342 |
| Celsiusstraat 34–38, northbound | 23.2 | 24.3 | 2,039 | 2,066 |
| Neonstraat, Ede-Noord ramp | 17.8 | 17.9 | 977 | 1,033 |
| Maanderbroek, ramp | 17.9 | 17.4 | 1,684 | 1,772 |

All eight updated views stayed below 33.3 ms p95 in this run. An earlier pass measured 34.0 ms at Celsiusstraat 34–38. The measurements are fixed-camera samples with a cold page load and do not establish a continuous 30 fps floor on a live drive. Rendered vegetation and roadside barriers can screen a wall that the survey found. A roadside barrier screens the northbound camera at Galvanistraat. An oblique view from the Ede-West ramp shows the fitted CityLink office windows.

The 130 A30 tiles reproduce byte for byte. The A12 tiles and baseline town tile index were checked against the pre-A30 build.

## Refresh

Reuse the pinned 3DBAG cache and BAG attribute snapshot for a repeatable bake. If the inventory adds new BAG IDs, refresh those building records from the PDOK Pand collection. The second command updates the A30 tiles and fallback asset.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 --with flatgeobuf --with numpy \
  python -B tools/build-ede-a12-visibility.py /tmp/ede-motorway-visibility /tmp/ede-a30-walls.json.gz \
  --motorway A30 --date 2026-11-20 --fetch
python3 -B tools/build-ede-a12-facades.py /tmp/ede-a30-walls.json.gz \
  tools/data/ede-a30-pand-2026-11-20.json.gz --motorway A30 --report /tmp/ede-a30-facades-report.json
```
