# A12 façades in Ede in 3D

The offline visibility survey follows the A12 in both directions and includes its mapped junction links. It samples a driver's eye at 1.2 m above the fitted lane or road surface and considers walls in front of the driver or out the side windows, within 1.5 km. It tests lane viewpoints every 12 m within 500 m of a wall, then groups candidate viewpoints into 42 m cells by direction, lane and grade. The rays use the 12 m AHN ground, 3DBAG building occluders and mapped BGT and 1GIS barriers. They omit covered travel, foliage, traffic and temporary objects. A wall on the resulting list can be hidden by trees or a vehicle in the game. Small features below the angular thresholds stay procedural. [3DBAG](https://docs.3dbag.nl/en/copyright/) · [OpenStreetMap](https://www.openstreetmap.org/copyright) · [AHN](https://www.ahn.nl/dataroom) · [Rijkswaterstaat 1GIS](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer)

The layout bake uses exact BAG wall geometry and uses building use, age, observed height and storeys to fit the unphotographed walls. It retains a wall's individual colour and shared brick, cement, panel or ribbed steel finish. Warehouse and utility faces generally stay solid. A simplified finish and window profile is linked to an OSM edge where the outlines align. The existing building stream and positional evidence determine which geometry is visible. [PDOK BAG building register](https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand?f=html)

The 20 November 2026 run sampled 57 ways and 5,482 lane viewpoints. It retained 20,365 wall segments across 6,779 buildings. The renderer uses 19,384 inferred BAG walls, 54 photo-informed BAG walls on 16 buildings, and 452 wall segments from the existing authored landmarks. All 475 walls with OSM geometry alone received a matched fallback. Overall, 12,482 OSM edges carry a fallback finish. Some split or recessed BAG walls have no equivalent edge in OSM. The local runtime data totals 1.16 MB compressed across 114 streamed tiles and the fallback snapshot.

## Photo review

The reference photos inform repeatable geometry and materials. Their crops and advertising artwork stay outside the runtime assets. Some aperture sizes, colours, seams and brand details are estimates.

| Group | Details and references |
| --- | --- |
| Maanderbroek | Toyota's Corten wrap, recessed motorway showroom glazing and clerestory are fitted to its photographed south elevation. BERG's warehouse has diagonal graphite bands and rust-coloured panels, and its older office has red masonry and glazing. [Toyota façade supplier](https://www.metadecor.eu/projects/toyota-material-handling-nederland-ede/) · [Toyota extension architect](https://remptvanderdonk.nl/extension-tmhnl/) · [BERG warehouse architect](https://www.vanmiddendorp.nl/projecten/berg-toys) |
| West of the A30 | Delektro and Van van Ee share dark cladding but have contrasting opaque and glazed showrooms. Boylestraat 26–28 has a projecting frame around its glazed office. NatureGreen, Van Mourik, InnovaN and Albers have separate panel, colour and window treatments. [Delektro and Van van Ee architect](https://www.coarearchitectuur.nl/projecten/nieuwbouw-delektro-en-van-van-ee/) · [Boylestraat listing](https://www.cmcbedrijfsmakelaars.nl/nieuws/kantoorruimte-ede-op-absolute-zichtlocatie-met-hoge-attentiewaarde) · [NatureGreen](https://www.naturegreen.nl/over-ons/) · [Business park exterior directory](https://www.bta12.nl/gevestigde-bedrijven.html) |
| Heestereng | Maxwellstraat 55 has a dark warehouse with strip glazing and a lighter framed office. Maxwellstraat 51 has an orange brick office frontage with glass bands. Schipper and Kreeft have their own cladding and glazing layouts. The ITN façade description remains available for a future building source update. [Maxwellstraat 55 broker](https://activast.nl/objecten/maxwellstraat-55/) · [Maxwellstraat 51 property](https://dunoair.com/properties/maxwellstraat-51-ede/) · [Schipper exterior](https://schipper-ede.nl/wp-content/uploads/2019/05/schipper-ede-gebouw-v1.jpg) · [Kreeft](https://bouwbedrijfkreeft.nl/projecten/kreeft-2020/) · [ITN](https://bouwbedrijfkreeft.nl/projecten/bedrijfspand-itn/) |
| Ede exit and cinema | Lukkien's studio has its corner wordmarks above the silver belt. Pathé's red projection boxes carry framed programme panels with house branding. Nearby Valley Center has a dark base and glazed brick grid on the surveyed walls. [Lukkien studio exterior](https://www.veldkampadviesburo.nl/projecten/studio-lukkien) · [Pathé architect](https://www.dp6.nl/en/projects/cinemec) · [Pathé panel lighting](https://lightsupply.nl/projecten/pathe-bioscoop-ede/) · [Valley Center architect](https://www.coarearchitectuur.nl/projecten/valley-center-west/) |

## In-game verification

Chrome WebGPU used the fast preset, a 1,200 × 720 viewport and fixed midday views at the surveyed driver-eye heights. Traffic motion was paused. Each position used 70 frames after a camera settle. The first playable frame took 11.41 s before and 11.61 s after in one localhost cold run. Resident façade mask textures peaked at 3.14 MB before and 4.07 MB after across the recorded views. The existing texture budget stays in force.

| View | p95 before, ms | p95 after, ms | Median draw calls before | Median draw calls after |
| --- | ---: | ---: | ---: | ---: |
| Van van ee | 23.5 | 26.2 | 2,018 | 2,041 |
| Boylestraat | 20.4 | 20.3 | 1,944 | 1,951 |
| Toyota | 24.5 | 25.3 | 2,330 | 2,375 |
| Berg | 26.0 | 28.0 | 2,417 | 2,464 |
| Maxwell | 25.5 | 26.6 | 2,236 | 2,268 |
| Lukkien | 26.3 | 25.9 | 2,257 | 2,281 |
| Pathe | 28.1 | 27.6 | 2,431 | 2,470 |
| Exit24 | 24.7 | 24.1 | 2,169 | 2,215 |
| East farm | 18.1 | 18.5 | 465 | 507 |
| East residential | 27.7 | 36.1 | 2,459 | 2,497 |

The eastern residential view exceeded the 33.3 ms target in the full sequence. A shorter repeat through exit 24 measured 27.5 ms at that view with fewer 3DBAG walls resident. This comparison has one full run per build and does not establish an uninterrupted 30 fps floor during streaming.

## Refresh

Reuse the pinned 3DBAG cache and the BAG attribute snapshot for a repeatable refresh. The snapshot keeps official building-use and construction-year fields only for the surveyed IDs. If the inventory adds new IDs, refresh their current building records through the PDOK BAG Pand collection. The second command writes the A12 overlay into the existing façade tile index and regenerates the compact fallback asset.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 --with flatgeobuf --with numpy \
  python -B tools/build-ede-a12-visibility.py /tmp/ede-a12-visibility /tmp/ede-a12-walls.json.gz \
  --date 2026-11-20 --fetch
python3 -B tools/build-ede-a12-facades.py /tmp/ede-a12-walls.json.gz \
  tools/data/ede-a12-pand-2026-11-20.json.gz --report /tmp/ede-a12-facades-report.json
```
