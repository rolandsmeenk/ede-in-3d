# Ede street and motorway detail verification

The motorway measurements on this page are the historical DTB baseline. The current motorway pipeline and validation use 1GIS. [Current 1GIS verification](ede-1gis-verification.md)

The 19 November 2026 bake includes 1,201 BGT placements across the four initial sites and the added Marktplein, Proosdijpark and Rijksweg sites. It adds 1,000 Rijkswaterstaat DTB sections and fixtures along the A12 and A30. The two runtime downloads total 90,083 bytes. The game uses the existing 12 m AHN terrain, fitted grade profiles and Oude Kerk coordinates. [BGT counts and refresh](ede-bgt-detail.sources.md) · [DTB inventory and refresh](ede-dtb-detail.sources.md)

| Feature | BGT | DTB |
| --- | ---: | ---: |
| Fences | 57 | 193 |
| Hedges | 1 | |
| Benches | 2 | |
| Bike racks | 73 | |
| Bollards | 40 | |
| Bus shelters | 1 | |
| Ground cover | 535 | |
| Shrubs | 484 | |
| Water edges | 8 | |
| Guardrails and solid barriers | | 476 |
| Gantries | | 34 |
| Noise barriers | | 9 |
| Hectometre markers | | 288 |

The BGT placement recheck covered barriers and props against same-level roads, paths and 11 nearby GTFS boarding corridors. At the mapped station gate near X −281.99, Z 1910.77, the player walked through in both directions and collided with the fence on an adjacent alignment. Three fences use the fitted Albertstunnel deck. The import withheld four raised planting points where elevation evidence was insufficient. BGT contained no playground equipment in the playable area and no station shelter. The imported Rijksweg shelter has no reliable match in the shipped GTFS routes. [BGT review records](ede-bgt-detail.review.json)

DTB resolved 989 parts to NWB sections and used fitted crossing profiles for 32. The import keeps 307 potential parallel-carriageway ambiguities and 10 access overlaps as visual-only features. It trimmed overlap with existing BGT walls and removed 11 unsupported raised shoulder spans, including the guardrail beside the Edeseweg deck. Five surveyed gantry supports share a base with an existing BGT lamp. The renderer joins their geometry and keeps the five lights. [DTB matching and omissions](ede-dtb-detail.sources.md)

## In-game inspection positions

Scene coordinates are metres from Oude Kerk. The target column gives points to look toward from street level, or the indicated deck at motorway sites.

| Site | Camera X, Z | Target X, Z | Checked |
| --- | --- | --- | --- |
| Oude Kerkplein | 54, 71 | 70, 63 | Bike stands and bollard along the plaza |
| Kuiperplein | −195, 206 | −180, 213 | Connected fence alignment and open crossing on Nieuwe Stationsstraat |
| Ede-Wageningen | 208, 2167 | 188, 2180 | Polar Bearsplein fences and bus loading areas |
| Ede-Wageningen west | −334, 2003 | −356, 1997 | Bike stands along Hoog Maanen and Spindopplein |
| Proosdijpark | −1518, 638 | −1511, 645 | Mapped pond edge by the path |
| Rijksweg | −4048, 36 | −4041, 39 | BGT bus shelter and adjacent cycle path |
| Maanderbroek | −4174, 2168 | −4174, 2107 | Upper A30 rail and boundary fence, approach gantry and lights |
| A30 Ede and Ede-Noord | −3875, 1333 and −3615, 76 | −3838, 1331 and −3592, 71 | Lower approaches clear with barriers on the upper carriageways |
| A12 exit 24 Ede | −1394, 3667 | −1433, 3665 | Exit ramp gantry and lamp support |
| A12 Edeseweg | 133, 3709 | 79, 3705 | No suspended shoulder rail beyond the bridge support |

The Proosdijpark shoreline lies within roughly 2.2 m of the existing water outline at the sampled locations. The vegetated bank is visible from the documented camera. The existing park surface still obscures the pond from that view.

## Paired benchmark

The pilot met the frame-time budget before expanding the BGT coverage. Each timed pass uses the actual player controller and samples 180 frames with traffic and parking enabled. The paired run uses the archived commit `39168eb` and a copy of that commit with this change applied, on the same Apple M4 Pro. The game runs in Chromium WebGPU at 1600 × 900 with the Fast preset and fixed midday, weather, and random seed. Both variants use the same 12 m height grid.

```sh
EDE_BENCH_SCENARIOS=detail EDE_BENCH_RUNS=3 EDE_BENCH_FRAMES=90 EDE_BENCH_TRAFFIC=active \
  node tools/benchmark-ede.mjs /tmp/ede-detail-paired.json http://127.0.0.1:8992 9297 \
  'http://127.0.0.1:8991/?perf=1' 'http://127.0.0.1:8992/?perf=1'
```

Draw calls and triangles are medians across the three runs, with each run represented by its frame median. The p95 column shows the range across the runs. Each final run loaded and rendered all 2,201 placements.

| Route | Median draw calls before → after | Median triangles before → after | p95 frame time before → after | Median player distance |
| --- | ---: | ---: | ---: | ---: |
| Oude Kerkplein walk | 1,124 → 1,131 | 6,522,573 → 6,533,369 | 16.7–16.8 → 16.7 ms | 14.0 m |
| Kolkakkerweg cycle | 1,199 → 1,199 | 7,781,740 → 7,780,240 | 16.7–16.8 → 16.7 ms | 29.4 m |
| A30 Maanderbroek drive | 449 → 474 | 1,506,077 → 1,522,291 | 16.7–16.8 → 16.7 ms | 14.3 m |
| A12 Edeseweg drive | 1,628 → 1,651 | 6,822,690 → 6,831,486 | 16.7–33.4 → 16.7–16.8 ms | 14.5 m |

The median frame time was 16.7 ms on all four routes in both builds. The largest single frame on the A12 was 33.4 ms in both builds. An earlier candidate run also recorded a 33.3 ms p95 at Edeseweg. All three final candidate p95 measurements at that site fell between 16.7 and 16.8 ms.

Median time to the first playable frame was 9.39 → 9.46 s cold and 9.30 → 9.33 s warm. Cold runs ranged from 9.36 to 9.99 s before the change and 9.34 to 9.59 s after it. The detail build stage took 56–61 ms. Median warm sampled V8 heap and backing storage peaked at 2.21 → 2.23 GB. These memory measurements cover browser-side allocations and omit GPU memory.
