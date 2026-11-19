# Ede street art and exterior models

Run `node tools/build-ede-murals.mjs` from the repository root to rebake the placements. Each source catalogue records the artwork, artist, reference date, source URLs, and wall assignment. The bake produces the local placement index and the fitted structural wall data. Source photos and review intermediates stay in the offline cache. WebP decals contain the fitted painted areas and transparency for masked details. The Astrant and Pegasus images are the two approved generated reconstructions. Credit for each original artwork and reference belongs to the listed creators.

| Site | Assignment and verified coverage | Remaining uncertainty |
| --- | --- | --- |
| Bospoorttunnel | October 2026 *Wij eisen de nacht op* photographs, both lower walls and the visible Otterloseweg approaches. The photographed groups follow the two fitted path walls below the N224. [Source catalogue](ede-murals-tunnels.json) | Exact distances between the photographed groups and the flared wooded wing. |
| Keesomtunnel | June 2025 festival photographs, separate pieces on the raised east and west paths below the railway and viaducts. Paint ends at deck joints. [Source catalogue](ede-murals-tunnels.json) | Partial coverage through the covered span and near the west entrance. |
| A30 Hall of Fame | June 20, 2022 photo series along Langekamppad. The north wall follows BGT retaining lines. Four south faces use fitted supports beneath the overpass. [Source catalogue](ede-murals-tunnels.json) | Hidden wall heights, exact support dimensions and margins between photographed pieces. The separate wall across the track remains bare. |
| Groot Derxsgoed | Fred Battle on the east end facing the Willem Marislaan car park. The BAG wall is 37.05 m high. [Source catalogue](ede-murals-flats.json) | Branches and a foreground lamppost are masked. |
| Bellefleur | Iota on the end facing Heyendaal. The surveyed wall is 28.48 m, with about 26.2 m of paint above the plinth. [Source catalogue](ede-murals-flats.json) | The published 30 m height is approximate. Foreground branches are masked. |
| Tuin van veren | GOMAD on the rear elevation of Bataljonlaan 1. The current BAG ID is 0228100000088557. The fitted paint uses the fallback OSM wall while the local LoD 2.2 release lacks this building. [Source catalogue](ede-murals-flats.json) | Both panels have partial coverage. The lower west panel and the outer east paint remain bare. |
| Slotlaan and Vanenburg | Nean on Vanenburg, VAAF on Sterkenburg, Nina Valkhoff on Pollenstein, and Kitsune Jolene on Weerdestein. Each decal is assigned to its own end wall. [Source catalogue](ede-murals-flats.json) | Foliage, glazing and missing upper or lower portions are masked where applicable. Sterkenburg's streamed wall is slightly nonplanar. |
| Riedel silos | Four curved paint decals on individual modeled tanks, ordered east to west as frog, hand, rainbow paint and owl. The ring heights use AHN DSM. [Source catalogue](ede-murals-structures.json) | Unseen rear arcs, hidden lower paint and exact seam angles. |
| Kappa Docie | Erwtje’s train from the June 2025 station panorama on the café's west wall. The modeled openings and trim remain clear. [Source catalogue](ede-murals-structures.json) | The area hidden by the air conditioner stays bare. |
| Astrant | Studio Giftig’s *Muzikanten* on the two modeled brick wings either side of the glazed entry. [Source catalogue](ede-murals-centre.json) | The approved reconstruction approximates fine details. |
| Van Eekelenflat | Nina Valkhoff’s *Pegasus (Airborne)*, assisted by SMOK, fitted to the existing 11 × 33 m end-wall assignment. [Source catalogue](ede-murals-centre.json) | The approved reconstruction approximates the smaller parachutes and brushwork. |
| Marktstraat | Klaas Lageweg’s *Guide to Moorland* on the Marktsteeg wall and Nina Paintina’s *Leeuwen* on the freestanding cabinet at De Wiek. [Source catalogue](ede-murals-centre.json) | The cabinet position and height are fitted from aerial and street references. Capture dates are unavailable. |

All requested outdoor sites had usable references. The Pathé garage and its interior murals are outside this release.

## Exterior models

- **Stadspoort** uses BAG 0228100000029361 with the modeled glazing and fitted entrance canopy. The existing grade profiles cut the visual mesh and the building colliders. In the running crossing audit, all 12 supported player walking, cycling and car checks passed. Vans and buses were unverified. The canopy height and shopfront subdivisions are approximate. [Building reference](https://hermandegroot.nl/projecten/winkelcentrum-stadspoort/)
- **Pathé Ede** uses BAG 0228100000046614 for the cinema envelope. The red projection volumes, glazed lobby, cladding and entry canopy are modeled. The grass berm is classified against the PDOK aerial photo. The lobby glazing divisions and lettering are fitted from exterior photos. [Architect's reference](https://www.dp6.nl/en/projects/cinemec)

## Browser checks and cost

Street-height and oblique checks used the local game in Chrome WebGPU. Tunnel upper-route views were checked for paint at the wrong level. Both cycling directions passed on the 59.5 m Hall of Fame test route, with each run reaching within 6 cm of its planned exit. The mural group uses at most two concurrent texture requests. It evicts artwork outside the camera-local radius with hysteresis. The summed mipmapped RGBA estimate is capped at 32 MiB. Nearby murals can share an atlas texture while retaining separate backing-wall assignments.

The performance run replayed three camera paths at Astrant, Marktsteeg and De Wiek. It used 1080 × 650, the Fast preset, fixed midday and simulation clock, and paused and hid traffic in both conditions. Each run sampled 108 frames after warming each view. The machine was an Apple M4 Pro.

| Paint | Median frame | p95 frame | Median total draw calls | Estimated resident paint texture memory |
| --- | ---: | ---: | ---: | ---: |
| Off, two runs | 16.7 ms | 33.3–33.4 ms | 1,117–1,125 | 0 |
| On, two runs | 16.7 ms | 33.3–33.4 ms | 1,120 | 6.2 MiB |

Total draws moved with nearby building batches as they streamed. Each visible paint atlas batch adds one scene draw and no shadow-map draw. These measurements isolate the live paint layer on the same exterior models.

A second comparison used 1200 × 675 and three alternating pairs of 52 frames on each tunnel route. The Fast preset, midday and traffic conditions stayed fixed. Entries are medians across trials.

| Tunnel | p95 off → on | Median draws off → on | Peak resident paint textures |
| --- | ---: | ---: | ---: |
| Bospoort | 33.4 → 33.4 ms | 2,590 → 2,594 | 6.0 MiB |
| Keesom | 16.8 → 16.7 ms | 1,072 → 1,071 | 6.9 MiB, including nearby Riedel |
| A30 Hall of Fame | 16.7 → 16.8 ms | 765 → 767 | 6.0 MiB |

The 16 sites use 13 shared WebPs totaling 1.78 MB. The local placement index adds about 58 kB. The Keesom west view still shows the existing grey abutment and overhanging railing near scene position `(-1760, -10, 1482)`.
