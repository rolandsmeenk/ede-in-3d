# Municipal street-detail verification

## Coverage

The 20 November 2026 snapshot contains 656 litter-bin points, 907 container records at 748 distinct positions, and 218 play-site points inside the playable boundary. ACV and playground coordinates were validated as RD New and transformed through the existing Oude Kerk frame. The review archive records source IDs, raw positions, coincident records, equipment evidence, and placement decisions. [Import sources, counts and refresh command](ede-municipal-detail.sources.md) · [Per-record audit](ede-municipal-detail.review.json.gz)

| Feature | Municipal placements | Notes |
| --- | ---: | --- |
| Street litter bins | 531 | The 24 existing BGT bins were retained, for 555 in total. |
| Collection sites | 376 | 139 underground heads, 17 semi-underground containers and 220 generic forms. Eight replace BGT objects, leaving 395 sites in total. |
| Play equipment | 10 | Seven pieces at De Oude Hofstede and three at Proosdijpark. |
| Playground surfaces | 4 | One safety apron and one entrance surface at each pilot. |

Held for placement review are 125 litter-bin points and 372 collection sites. Common conflicts include building footprints, travel paving and parking access. The Bellestein textile cabinets are photo-verified and held for parking-apron clearance. Of the 216 play sites awaiting equipment evidence, 72 already have ordinary OSM outlines and 144 await a verified outline. Existing mapped surfaces represent the sites with outlines. [ACV matching evidence](ede-mor-acv.sources.md) · [Playground site and equipment records](ede-playground-pilots.json)

## In-game checks

Both playgrounds were inspected at walking height and from above. The player controller reached both mapped approaches at each site, within 0.66 m of the last waypoint. The controller recorded a height step of about 0.22 m on the De Oude Hofstede approaches. Equipment was positioned against the spring 2026 PDOK aerials and dated ground references. Model dimensions and finishes are approximate. Changes after the latest reviewed imagery remain unverified at both sites. [Survey references and approach coordinates](ede-playground-pilots.json) · [Ede's 2026 playground programme](https://ede.begroting-2026.nl/p24838/wat-gaan-we-doen)

The residential check used the bin at scene x −853.07, z 783.97. The Grotestraat check used the HEMA bin, 0.45 m out from its source point to clear the façade. At Kuiperplein, two ACV records at one point retained both waste records and rendered one prop in a row of collection fixtures. The bake matches fixture bodies and colliders to their support surfaces. [Placement and photo evidence](ede-municipal-detail.sources.md)

## Paired benchmark

Chrome 152 on an M4 Pro, 1080 × 640, with the same camera paths, frozen clock and paused traffic updates. Traffic continued to draw. Each variant ran twice in alternating order, with 64 measured frames per path in each run. Draw counts show the median per run. BGT-only uses the profiling switch with the same build.

| Camera route | BGT-only p95, ms | With municipal p95, ms | BGT-only draws | With municipal draws |
| --- | ---: | ---: | ---: | ---: |
| De Oude Hofstede walk | 16.7–16.8 | 16.7–16.8 | 632–638 | 635–648 |
| De Oude Hofstede aerial | 16.7 | 16.7–16.8 | 768–771 | 773–784 |
| Proosdijpark walk | 16.7–16.8 | 16.7–16.8 | 1,414–1,420 | 1,421 |
| Proosdijpark aerial | 16.7 | 16.7 | 1,109–1,125 | 1,121 |
| Residential litter bins | 16.8 | 16.7 | 1,352–1,353 | 1,355–1,367 |
| HEMA shopping walk | 16.7–16.8 | 16.7 | 1,039–1,044 | 1,051–1,057 |
| Kuiperplein ACV cluster | 33.4 | 33.4 | 2,166–2,168 | 2,165–2,168 |

Median frame time was 16.7 ms on all routes in both variants. Kuiperplein remained close to the 30 fps budget at p95. There was no consistent startup-time difference in these warm runs. First playable frame took 11.31–11.48 s with BGT only and 11.41–11.60 s with the municipal layer. The runtime sidecar is 17,990 bytes compressed. Both enabled runs loaded 921 features and reported zero runtime exceptions. The runtime and review files rebuilt byte for byte from the saved snapshot. All 400 JavaScript tests and the three focused Python tests passed.

Reproduce with the local game at port 8993 and a Chrome DevTools session at port 9377.

```sh
EDE_BENCH_WARM_ONLY=1 EDE_BENCH_RUNS=2 EDE_BENCH_FRAMES=64 \
EDE_BENCH_SCENARIOS=municipal EDE_BENCH_VIEWPORT=1080x640 \
node tools/benchmark-ede.mjs /tmp/ede-municipal-paired.json http://127.0.0.1:8993 9377 \
  'perf=1&municipalDetail=off&treeSeason=summer' 'perf=1&treeSeason=summer'
```
