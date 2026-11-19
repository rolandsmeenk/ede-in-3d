# Ede town detail and shoreline verification

The November 19, 2026 bake covers the full 7.39 × 5.40 km playable rectangle. The street stage places 40,136 pieces and planting samples. The infrastructure stage adds 219 pieces, including 26 guardrails, eight balustrades, 71 gutters, 61 drains, 51 bins and containers, and two sections of a station canopy. The final stage adds a separate 2 m land-cover mask with blended colour edges on existing geometry. The 12 m AHN runtime elevation asset is byte-identical to the baseline. [BGT inventory, coverage and refresh](ede-bgt-detail.sources.md)

The shoreline audit went from 22 fully and seven partly covered water polygons to zero of either. Victoriavijver, Kikker- en Paddenpoel, and both affected Veldhuizerbos ponds are visible from the bank and above. Kamelenvijver served as the visible comparison. The street map, movement contact and 3D world use the same outlines. The atlas also checks them before drawing an off-road connection to the GPS route. The 18 remaining surveyed paving overlaps total 37.98 m². The reviewed larger cases are a projecting fishing platform, a small bridge, a quay and bridge approaches. Two paths under tree cover need a field check. The 304 GTFS route sections still match the directed road graph. [Shoreline positions and aerial review](ede-shorelines.md)

The offline clearance audit tested 1,497 barriers. It found no same-level route or boarding overlap larger than 0.007 m². The bake preserved 23 mapped gate openings and removed a duplicate 1GIS barrier. All 36,261 mapped planting centres are outside the final water outlines. The station has one canopy in two AHN6 roof sections at 27.04 and 28.64 m NAP. Its three fitted column positions use the project imagery and preserve pedestrian, cycle and boarding clearance. Four canopy candidates were withheld and the station tiles supplied zero landings or entrance steps. [Placement decisions](ede-bgt-detail.review.json)

## In-game access and levels

| Site | Verification |
| --- | --- |
| Polar Bearsplein | The station forecourt walk stayed clear of fences and the GTFS boarding lanes. |
| Albertstunnel | Two existing level-1 fences mounted to a deck that had fallen back to lower approach terrain. Two fitted rail samples keep the rail-only deck at about 20.93 m NAP, which raises the fences by about 4 m. The controller rerun passed all eight previously blocked car, cycle and foot traversals. The site had 20 passing route checks and four unverified van or bus runs. |
| Sysseltsepad | Cycle and foot traversals from approach to exit passed in both directions. Four modelled train passes kept their level below the deck. |
| De Poortwachter | The checked car, foot and cycle traversals passed on both levels. Fourteen van and bus traversals remain unverified. |

The grade check found zero wrong-level junctions at these three crossings. The tested travel and traffic inspections can be reproduced with the normal controller and the crossing audit.

```sh
node tools/audit-ede-crossings.mjs /tmp/ede-bgt-crossings.json http://127.0.0.1:8995 9297 \
  'albertstunnel,sysseltsepad,de-poortwachter'
```

## Staged benchmark

The Mac mini with Apple M4 Pro ran Chromium WebGPU at 1600 × 900 in the Fast preset. Each stage had two cold HTTP-cache starts and two warm starts, with the same midday presets, seeded random state, traffic and parking enabled. Each warm route sampled 120 rendered frames. Startup values are medians. The p95 ranges include all recorded routes and repeats. The street and infrastructure stages share the compressed prop file and build only their selected records. The land stage separately downloads its mask.

| Stage | Compressed detail and shoreline assets | Cold startup | Warm startup | Route p95 range |
| --- | ---: | ---: | ---: | ---: |
| Seven-site pilot | 24.7 KiB | 9.65 s | 9.59 s | 16.7–16.8 ms |
| Shared shorelines | 122.6 KiB | 9.54 s | 9.47 s | 16.7–16.8 ms |
| Town street detail | 858.4 KiB | 9.80 s | 9.77 s | 16.7–16.8 ms |
| Roadside and station infrastructure | 858.4 KiB | 9.81 s | 9.70 s | 16.7–16.8 ms |
| Land cover | 1,499.3 KiB | 9.72 s | 9.72 s | 16.7–16.8 ms |

The first town stage also includes the Albertstunnel deck correction. Render counts below are the medians of the per-run frame medians. The last column shows the p95 range across the two runs of each endpoint build.

| Route | Median draw calls, pilot → shorelines → street → infrastructure → land | Median triangles in millions, same stage order | p95, pilot → complete |
| --- | --- | ---: | ---: |
| Oude Kerkplein walk | 1,132 → 1,124 → 1,110 → 1,144 → 1,135 | 6.557 → 6.542 → 6.544 → 6.584 → 6.561 | 16.8 → 16.7 ms |
| Victoriavijver bank walk | 1,274 → 1,275 → 1,278 → 1,281 → 1,281 | 7.653 → 7.661 → 7.681 → 7.681 → 7.682 | 16.7 → 16.7 ms |
| Kolkakkerweg cycle | 1,280 → 1,276 → 1,274 → 1,280 → 1,276 | 7.788 → 7.786 → 7.781 → 7.788 → 7.783 | 16.7–16.8 → 16.8 ms |
| Polar Bearsplein walk | 1,114 → 1,108 → 1,113 → 1,113 → 1,110 | 5.418 → 5.389 → 5.408 → 5.403 → 5.390 | 16.8 → 16.7 ms |
| Albertstunnel cycle | 1,192 → 1,180 → 1,184 → 1,191 → 1,190 | 5.758 → 5.701 → 5.726 → 5.723 → 5.731 | 16.7–16.8 → 16.7–16.8 ms |
| Albertstunnel drive | 1,223 → 1,210 → 1,216 → 1,222 → 1,219 | 5.853 → 5.795 → 5.814 → 5.823 → 5.807 | 16.7 → 16.7–16.8 ms |
| Sysseltsepad bridge cycle | 984 → 986 → 990 → 988 → 987 | 3.749 → 3.752 → 3.751 → 3.752 → 3.750 | 16.7–16.8 → 16.7 ms |
| A30 Maanderbroek drive | 510 → 514 → 518 → 514 → 521 | 1.611 → 1.625 → 1.630 → 1.626 → 1.633 | 16.7 → 16.7–16.8 ms |

The warm runs use the actual player controller. The full approach-to-exit checks above independently verify both levels of the selected crossings.

```sh
EDE_BENCH_SCENARIOS=town-detail EDE_BENCH_RUNS=2 EDE_BENCH_FRAMES=60 EDE_BENCH_TRAFFIC=active \
  node tools/benchmark-ede.mjs /tmp/ede-bgt-stages.json http://127.0.0.1:8995 9297 \
  'perf=1&bgtStage=street' 'perf=1&bgtStage=infrastructure' 'perf=1&bgtStage=all'
```

Run the same suite with only `perf=1` on the preserved pilot build and then on that build with only the shoreline changes to measure the two reference stages.
