# Ede façade verification

The city catalogue uses the pinned 3DBAG LoD 2.2 release and the CBS 2025 neighbourhoods. The bake links reviewed appearances to an individual BAG wall and records the source views and confidence in the offline observation file. For other walls it fits supported profiles to the wall's proportions. Shared walls receive a blank layout. The procedural material handles exposed walls outside the profile coverage. [3DBAG data](https://docs.3dbag.nl/en/) · [CBS Wijk- en Buurtkaart 2025](https://www.cbs.nl/nl-nl/dossier/nederland-regionaal/geografische-data/wijk-en-buurtkaart-2025)

The old rectified review provided calibrated source proportions for the Oude Kerk west portal and Torenstraat. The church window uses an ogival head, four vertical lights and modeled tracery. The portal has a two-leaf dark door and a projecting surround. The right storefront uses a continuous transom height and separates the door, the over-door glazing and the display bays. These reviews use wall-local measurements from the rectified imagery with surface-colour judgement under the visible exposure. Recess depths remain estimates. They are 0.28 m for the church door, 0.18 m for the tower glazing and 0.16 m for the reviewed storefront sections. [Source view credits](../../assets/ede-facades.SOURCES.md)

The renderer reuses the existing BAG tile queue, batches and replacement logic. It fetches layout data in 384 m cells that overlap nearby BAG tiles. A shared repeating masonry and cladding texture supplies the surface detail. A material mask separates stone, brick, doors, translucent-looking opaque glazing, frames and sills. The game retains the existing PDOK roof tint and building alignments.

Selected measured openings have geometry for reveals, projecting trim and sills. The full depth is visible within 18 m, and the geometry flattens progressively out to 42 m. Material grain fades between 35 and 95 m, and the semantic opening masks fade between 100 and 220 m. The ordinary streaming mode caps the per-tile mask allocation at 262,144 base pixels plus mipmaps, all resident masks and finish palettes at 8 MiB, and resident building geometry at 48 MiB.

## Coverage and held-out observations

The city catalogue contains **40,909 buildings and 370,267 wall segments**. Before the square reviews, the parameter bake exported **11 observed walls**, **32,130 inferred walls**, and **90,112 blank shared walls**. The original procedural shading covered the other **248,014 walls**. The 6,808-byte manifest indexed 190 compressed layout tiles totalling 4,184,338 bytes. The largest tile is about 143 kB compressed. An independent bake from the final catalogue reproduced every tile, the manifest and the report byte for byte. [Per-neighbourhood, building type and wall-role coverage](ede-facade-coverage.json)

| CBS neighbourhood | Reviewed building type | Distinct BAG buildings |
| --- | --- | ---: |
| Centrum Ede | Shop | 2 |
| Centrum Ede | Landmark | 1 |
| Vogelbuurt | Terraced | 4 |
| Vogelbuurt | Detached | 1 |
| Bloemenbuurt | Apartments | 1 |

The existing Mapillary records and the offline landmark crops were available for this release. The calibrated refresh for additional Mapillary views requires a client token or a local image and camera-metadata cache. A neighbourhood and an Ede-wide profile meet the distinct-building threshold for terraced street walls. The apartment and detached observations remain individual. Semi-detached and mixed-use classifications are present in the census and use procedural shading where their types lack training coverage.

The leave-one-building-out evaluation removes every wall of a building from training together. All nine reviewed BAG buildings have a holdout entry. Four terraced houses have sufficient independent samples for opening-layout comparisons.

| Holdout measure | Buildings with comparable evidence | Median absolute error | Worst error |
| --- | ---: | ---: | ---: |
| Window count | 4 | 0 | 1 |
| Opening centre | 4 | 0.374 m | 0.649 m |
| Storey spacing | 3 | 0.300 m | 0.450 m |
| Wall colour | 4 | 5.685 sRGB distance | 72.23 sRGB distance |

## Browser performance

The browser evidence uses fixed walks 1.65 m above the ground with changing oblique angle. It verifies that a resident BAG mesh covers each camera target. The Fast preset, 1600 × 900 viewport, midday light, seeded traffic, parking and camera path are the same for each comparison. Startup is navigation to the first playable GPU frame. Reported façade texture bytes are estimated resident GPU allocations for the masks, palettes and shared surface, plus the photo atlas in the original build. They exclude other scene textures.

Two independent cold and warm pairs were measured in Chrome 152 WebGPU on Apple Silicon. The startup medians were **9.60 → 9.45 s cold** and **9.59 → 9.37 s warm**. Every shot had resident 3DBAG geometry at its target. Median frame time was 16.7 ms on all five walks.

| Site | Frame p95 before → after | Median draw calls before → after | Façade texture memory before → after |
| --- | ---: | ---: | ---: |
| Kolkakkerweg terraced houses | 16.7–16.8 → 16.8 ms | 1,112–1,117 → 1,152–1,155 | 13.31 → 5.44 MB |
| Kolkakkerweg apartments | 16.8 → 16.7 ms | 1,389 → 1,428–1,431 | 10.51 → 6.83 MB |
| Torenstraat storefront | 33.3–33.4 → 33.4 ms | 2,114–2,120 → 2,147–2,150 | 13.31 → 4.19 MB |
| Oude Kerk west portal | 16.7–16.8 → 16.7–16.8 ms | 1,158–1,161 → 1,222–1,225 | 16.10 → 4.19 MB |
| Shopping street | 33.3–33.4 → 33.3–33.4 ms | 2,132–2,141 → 2,163–2,172 | 16.10 → 4.19 MB |

Before pacing the new tile builds, one Torenstraat run reached 66.6 ms p95 and a 150.1 ms maximum. A separate trace recorded a 140 ms main-thread task in the same frame as a BAG tile completion. Splitting mesh conversion, wall matching, roof colouring and fallback coverage into cancellable slices brought the delivered Torenstraat runs to 33.4 ms p95 and a 33.5 ms worst frame. The measurements are short samples on one device. One repeated pilot navigation stalled and was recovered in a fresh browser profile.

The paired oblique views confirmed the west portal reveal and pointed tracery, the storefront transom and recessed bays, smooth opaque glazing, and the terraced house frames and sills. The candidate requested the local parameter index and 51 of the 190 gzip cells across the five walks. All façade asset requests were for parameters. The original browser session also requested the façade photo atlas.

```sh
EDE_BENCH_SCENARIOS=facades EDE_BENCH_RUNS=1 EDE_BENCH_TRAFFIC=active \
  EDE_BENCH_SCREENSHOTS=/tmp/ede-facades-qa/screens \
  node tools/benchmark-ede.mjs /tmp/ede-facades-qa/after-paced.json http://127.0.0.1:8993 9303 'perf=1'
```

Use the same command with the pre-change checkout served on another port for comparison. Use a separate isolated WebGPU browser profile for each repeat if a browser stalls after multiple navigations.

All 377 JavaScript tests passed. The offline Python suite reported 33 passes and three skips. The extractor resolved all 11 original calibrated review frames against the refreshed catalogue.

## Marktplein, Kuiperplein and Museumplein

| Square | Reviewed BAG buildings | Wall segments | Openings | Largest wall-plane offset in the streamed geometry |
| --- | ---: | ---: | ---: | ---: |
| Marktplein | 3 | 19 | 88 | 2.6 cm |
| Kuiperplein | 5 | 8 | 158 | 1.8 cm |
| Museumplein | 5 | 8 | 90 | 5.0 cm |

The square bake updates two compressed cells and adds 6.2 KiB. All 35 segments matched triangles in the pinned 3DBAG tiles. Four Kuiperplein rows also matched Cultura’s custom mesh, which owns the Brouwerstraat wall. The reviewed openings fit in the existing mask allocation after lowering the mask resolution on crowded tiles. The second bake reproduced both cells byte for byte.

The walking-height and oblique WebGPU views showed the stepped Marktplein bays, the Brouwerstraat shopfronts and the Museumplein café row. Awnings, trees and viewing angle obscure some openings. The review notes mark the corresponding layout, colour and depth estimates. Other frontages use the existing building materials. [Reference credits](../../assets/ede-facades.SOURCES.md) · [Review coverage](ede-facade-coverage.json)
