# Ede in 3D performance verification

Measured on an Apple M4 Pro in Chrome WebGPU at 1600 × 900 and device scale 1. Both the original and revised builds used the 12 m AHN grid. The script fixed the service clock, midday lighting, random seed and camera path. The paired renderer runs used a fixed simulation timestep with traffic and parking active, clear weather and the public 3DBAG feed. The static server supplied local data without live traffic and weather overrides. The profiler follows Geneva's independent switches. [Geneva profiler](https://github.com/emmanpi/slop-geneva/blob/main/js/perf.js#L3-L18)

## Startup and memory

Three cold and three warm navigations per build. Cold runs clear the browser's HTTP cache. The GPU driver's shader cache is shared. Times run from navigation to the first playable frame after the GPU finishes. Transfer counts bytes reported by DevTools up to that frame. Memory tracks sampled V8 heap plus backing storage. GPU process and whole-system memory were outside the measurement.

| Measure | Original | Revised Fast |
| --- | ---: | ---: |
| Cold startup, median (range) | 11.94 s (11.47–12.15) | 9.28 s (9.25–9.31) |
| Warm startup, median (range) | 11.29 s (11.25–11.34) | 9.21 s (9.12–9.26) |
| Cold transfer before play | 80.40 MB | 23.75 MB |
| Cold peak heap plus backing storage, median (range) | 2.54 GB (2.14–2.81) | 2.20 GB (2.20–2.21) |
| Cold peak backing storage, median | 2.00 GB | 1.42 GB |

Replaying all five views used 2.37–2.50 GB peak combined V8 memory in the revised Fast build. Resident baked BAG geometry peaked at 47.8 MiB under the 48 MiB limit. The façade mask texture adds up to 10.5 MB separately. Fallback buildings, terrain, streets, textures and renderer allocations account for the rest of the game's memory.

Independent observations:

- Comparing eager BAG with streaming using the same Fast renderer and packed map cut cold startup from 11.89–11.97 s to 10.68–10.81 s. Warm startup fell from 11.44–11.53 s to 10.68–10.83 s. Cold transfer before play fell from 67.99 MB to 23.73–23.75 MB. The eager build waited for all 42 selected tiles. The cold streaming runs entered play using OSM fallback. Only two GLB downloads and one mesh build can run concurrently. Moving away evicts geometry and restores the same fallback buildings while keeping colliders in place. Façade mask generation yields between batches, with byte-identical output. [Helsinki tile prioritization and eviction](https://github.com/kinotus/slop-helsinki/blob/main/js/helsinki-tiles.js#L423-L446)
- The gzip map decodes byte-for-byte to the original map payload, preserving coordinates, IDs, polygon holes, access and levels. A seven-run isolated Chrome test measured 64 ms median map readiness versus 132 ms for the HTTP-gzipped JavaScript module. The map payload went from 15.43 MB to 2.99 MB on the raw static server. On hosts that already gzip JavaScript, the transfer sizes are about equal. [Wuhan packaging benchmark](https://raw.githubusercontent.com/LightYearZh/slop-wuhan/main/docs/LOADING_OPTIMIZATION.md)
- Retaining existing indices in homogeneous terrain batches cut geometry buffers from 76.7 MB to 38.5 MB across the same 84 terrain draws. Expanding both versions gave identical positions, normals, UVs and colors in triangle order. The isolated merge took 43–50 ms before and 15–22 ms after. The height grid and triangle layout are identical.
- A startup CPU profile put roughly 1.5 s of self time in nearest-span lookup. Indexing the nearby rail queries by cell produced identical results at 11,960 queries on the AHN and ProRail data. Six paired standalone runs fell from 272–273 ms to 61–64 ms. In the browser the stage for grade surfaces and BGT structures fell from about 1.6 s to 0.13 s. The index keeps track order on equal distances.

## Frame pacing

Each number is median / p95 frame interval in milliseconds. The isolated renderer comparison used two alternating runs per preset with 75 sampled frames per view. The final Fast column used three runs with 90 frames per view. The ranges show variation between runs. The 30 FPS budget is 33.3 ms per frame.

| View | Matched Standard | Matched Fast | Final Fast | Final worst frame |
| --- | ---: | ---: | ---: | ---: |
| Ede-Wageningen | 16.7 / 16.7–16.8 | 16.7 / 16.7–16.8 | 16.7 / 16.7 | 16.8 |
| Kuiperplein | 16.7 / 16.7 | 16.7 / 16.8 | 16.7 / 16.7 | 16.8 |
| Kolkakkerweg | 16.7 / 16.7 | 16.7 / 16.8 | 16.7 / 16.7–16.8 | 16.8 |
| Helicopter pass | 33.3 / 50.0 | 16.7 / 16.7–16.8 | 16.7 / 16.8 | 50.0 |
| Camera jump | 16.7 / 33.3–50.0 | 16.7 / 33.3 | 16.7 / 16.8–33.4 | 66.8 |

Fast skips screen-space reflections, their auxiliary attachments and multisample antialiasing. Isolated earlier passes on this Mac held bloom and color grading fixed. At Oude Kerk, the baseline, reflections off, and reflections plus MSAA off measured 50.0, 33.4 and 16.7 ms median. From above they measured 66.7, 66.6 and 33.3 ms. Dropping resolution to 75% by itself helped the aerial view and was within run variation at street level. Fast keeps full resolution and shadows. The tree update measured no more than about 1.2 ms p95 in the matching runs, so the refresh behavior stays at its existing travel-distance threshold.

The largest remaining regular cost is submitting and drawing the world. The helicopter pass recorded about 1,850 draws and 7.9 million submitted triangles including shadows. In Fast, the scene GPU timestamp was about 8–9 ms at the median and render submission reached 14–15 ms at p95. GPU pass times can overlap. The largest startup stage remains building city geometry, about 3.5 s. Aerial vertex color sampling, surface clipping, and terrain-conforming road and paving mesh construction accounted for a substantial part of that stage. Single slow frames still occur during camera jumps while new view geometry arrives.

Browser checks covered walking and driving on Kolkakkerweg, an Oude Kerk wall collision before and after an Oude Kerk → Ede-Wageningen → Oude Kerk teleport sequence, and the same collision using the fallback alone. The return teleport reproduced the original car position, and the wall response was identical in all three states. The profiling switch test also kept SSR enabled with MSAA, bloom, shadows, vegetation and BAG disabled. Visible frozen traffic and hidden moving traffic both worked. All 347 JavaScript tests passed. Python reported 21 passes and three dependency-related skips.

## Budget for future terrain patches

The camera-jump p95 already reaches the 30 FPS budget. Keep future high-resolution AHN tiles off the first-playable path and avoid synchronous tile work on the jump frame. Start with at most 1 ms p95 of added steady-frame work and 16 MiB of resident decoded terrain geometry, less than half the measured terrain buffer savings. Repeat the same five views before accepting a patch. Steady p95 must stay within 33.3 ms, and the jump p95, worst-frame interval, cold startup and peak memory should stay within the measured variation.
