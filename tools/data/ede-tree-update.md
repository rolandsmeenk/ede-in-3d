# Ede tree inventory, flight detail and seasons

## Controls and profiling

**Season** selects Today or a seasonal preview independently of lighting and weather. Today follows the civil calendar in Europe/Amsterdam and updates across midnight. **Graphics → Tree quality** offers Auto and High. Both use 200 m cells for visibility and terrain-relative flight detail. Settled distant crowns outside the tree shadow range share 800 m batches by species and crown variant. Each crown keeps the same geometry, transform and seasonal data through batch handoffs. Nearby trees and active fades use the 200 m draws. Auto targets a sustained 30 fps budget and reduces distant density, detail and shadows before touching nearby or surveyed crowns. The lower quality settles after sustained pressure and recovers more slowly. The implementation uses the existing canopy geometry and a shared seasonal palette, with the same leaf coverage applied to the scene and shadow passes. [Singapore graphics settings](https://github.com/zz85/slop-singapore/blob/gh-pages/js/graphics-settings.js) · [Geneva seasons](https://github.com/emmanpi/slop-geneva/blob/main/js/seasons.js) · [Geneva phenology](https://github.com/emmanpi/slop-geneva/blob/main/js/phenology.js) · [De Natuurkalender](https://www.naturetoday.com/intl/nl/observations/natuurkalender)

**Season → Heather bloom** previews late August without changing the lighting. In Today mode, common heather blooms gradually around mid-August to mid-September. The terrain shader uses an offline mask from OSM heath polygons and BGT land cover, so the purple patches follow mapped heath at Ginkelse Heide, Planken Wambuis and elsewhere. The bloom represents typical timing and intensity. [Ginkelse Heide bloom period](https://www.bezoek-ede.nl/natuur-actief/natuurgebieden/natuurgebied-ginkelse-heide) · [Planken Wambuis](https://www.natuurmonumenten.nl/natuurgebieden/planken-wambuis)

Open the game with `?perf=1` to select each part independently.

| URL parameter | Values |
| --- | --- |
| `treeInventory` | `expanded` (default) or `baseline` |
| `treeQuality` | `legacy`, `high` or `auto` |
| `treeSeason` | `off`, `today`, `spring`, `summer`, `heather-bloom`, `autumn` or `winter` |

`treeSeason=off` uses the material without the seasonal shader path. `vegetation=off` removes the tree draw and updates for a whole-pass GPU reference. In the profiler, **Vegetation** is the CPU update stage. The tree counters report instance upload bytes, planned and visible cells, LODs, transitions and batches eligible for shadows. GPU timestamps belong to the whole scene or sun shadow passes.

The old view switched the visible ranges at 40 m in scene coordinates. The adaptive view blends its ranges between 23 and 94 m above local terrain, uses projected crown width and prepares nearby cells along one second of predicted movement. Actual camera view controls draw eligibility. Coarse crowns remain during replacement, with complementary dither during the brief overlap. The count and volume of instance updates are bounded per frame. Winter drops leaf cards while retaining branches and evergreen foliage. Unknown recorded tree species use generic broadleaf phenology. Seasonal dates and colours approximate the local growing season.

## Benchmark and rollout

The expanded inventory loads by default. Use `?perf=1&treeInventory=baseline` to compare the original inventory. The game also falls back to the original inventory if the expanded asset fails to load. The Fast preset on the test Mac stayed near the 30 fps budget at p95. The full summer variant spent more of the woodland landing at about 30 fps. [Expanded inventory and WFS terms](ede-tree-inventory.md)

| Tree count | Baseline | Expanded |
| --- | ---: | ---: |
| Packed inventory | 50,352 | 70,125 |
| Mapped trunks after the world checks | 50,272 | 70,045 |
| Procedural woodland after fill | 30,822 | 29,408 |
| Planted trunks after renderer clearance | 80,255 | 98,713 |

The expanded inventory adds **19,773 mapped positions**, displaces **1,414 procedural positions** before renderer clearance and yields **18,458 more planted trees**. The expansion added 973 provincial height and diameter classes. An eight-cell canopy/AHN pilot added 36 isolated height and crown estimates and guides fill in five sampled woodland cells. The default inventory transfers 632,296 bytes, compared with 453,177 bytes for the baseline. The 105-byte coverage file contains area fractions. [Source counts, confidence, audit and refresh](ede-tree-inventory.md)

The benchmark used Apple M4 Pro, Chrome 152 WebGPU, Fast, 1080 × 640, fixed midday lighting, the same initial traffic and parking, and paused traffic updates during timed paths. Each warmed route sampled 90 frames. The legacy-inventory and data-only variants were checked separately. Fixed adaptive High and Auto ran with the seasonal shader off. The two final full runs used expanded data, Auto, and Summer. Frame p95 and worst frame use actual browser frame intervals. The draw counts are whole-scene medians. The baseline draw column is the last matched legacy run with the original inventory.

| Route | Baseline p95 → full p95 | Full worst frame | Draws baseline → full |
| --- | ---: | ---: | ---: |
| Low helicopter pass | 16.8 → 16.7 ms | 16.8 ms | 990 → 949–958 |
| Climb through old cutoff | 16.7 → 16.8 ms | 16.8 ms | 1,278 → 905–926 |
| Fast sideways pan | 33.4 → 33.4 ms | 33.4 ms | 1,007 → 757–784 |
| Woodland landing | 33.4 → 33.4 ms | 33.5 ms | 2,767 → 2,414–2,491 |
| De Vuurvogel walk | 16.8 → 16.8 ms | 16.8 ms | 1,375 → 1,380–1,394 |
| N224 provincial trees | 16.8 → 16.7 ms | 16.8 ms | 1,015 → 945–981 |
| Summer-to-winter switch | 16.8 → 16.7–16.8 ms | 16.8 ms | 1,368 → 1,369–1,371 |

- **Inventory alone.** Legacy with expanded data held the baseline p95 across the tested paths, with a 50.0 ms worst frame on the fast pan. Peak climb uploads rose from 3.08 MB to 3.41 MB per frame.
- **Adaptive canopy.** The full climb peaked at 85–154 kB per frame. The largest change in eligible trees on a single climb frame fell from 24,797 to 101–210. A fast view change can still reveal several distant cells before they are drawn. Distant silhouettes lagged during the climb and filled when the camera held its final pose. A pure climb above the old cutoff retains the ground-relative blend.
- **CPU and shadows.** Vegetation CPU p95 fell from 0.8 to 0.3–0.4 ms on the climb and from 1.1 to 0.3–0.4 ms on the landing. Median climb batches eligible for tree shadows fell from 2,424 to 183–184. The time queried for the whole Scene GPU pass was 7.79 ms p95 on the baseline climb and 6.89–8.10 ms in the full runs. The far sun shadow pass was 3.15 ms p95 baseline and 3.27–3.59 ms full. These passes include buildings, other objects, and changes in camera visibility.
- **Auto under controlled load.** An additional 42 ms of artificial CPU work per frame pushed a held woodland view to Medium after 2.95 s and Low after 8.05 s. After removing the load, it recovered one step after 12.4 s. A deterministic test exercises recovery to High and verifies that nearby crowns stay in full detail.
- **Season and UI.** The switch frame took 16.6–16.7 ms in the timed Summer-to-Winter check. Each of the five season buttons triggered zero instance-upload bytes on a settled school view. Golden Hour, Midday, Blue Hour and Night each retained their lighting preset through a season change. A 390 px mobile viewport kept all five choices inside the screen. The pedestrian controller walked 6.47 m on the school approach, with the surveyed mature trunk visible at the same position in summer and winter.

Run the matched variants with the regular profiler runner and local server. Set `EDE_BENCH_SCREENSHOTS` to a folder for matched captures.

```sh
EDE_BENCH_SCENARIOS=trees EDE_BENCH_RUNS=2 EDE_BENCH_FRAMES=90 EDE_BENCH_VIEWPORT=1080x640 \
  node tools/benchmark-ede.mjs /tmp/ede-trees-benchmark.json http://127.0.0.1:8993 9377 \
  'perf=1&treeInventory=baseline&treeQuality=legacy&treeSeason=off' \
  'perf=1&treeInventory=expanded&treeQuality=legacy&treeSeason=off' \
  'perf=1&treeInventory=expanded&treeQuality=high&treeSeason=off' \
  'perf=1&treeInventory=expanded&treeQuality=auto&treeSeason=off' \
  'perf=1&treeInventory=expanded&treeQuality=auto&treeSeason=summer'
```

All 394 Node tests and the eight focused Python tree and GIS tests passed.

## Manual monumental tree review

The RCE WFS returned 16 points inside the exact playable bounds on 20 November 2026. The WFS records identify the 4 March 2025 version of the national register. Each point was checked in the 2025 PDOK orthophoto against nearby BGT-backed inventory and current municipal `mor_bomen` positions. The report retains each species and planting-year range. A matched crown confirms the register identity near an existing placement. Dense foliage, positional ambiguity and uncertain ground points stay in the review queue. The review made no automatic placements or map labels. [RCE national register, CC BY 4.0](https://data.overheid.nl/dataset/82033-kaart-landelijke-register-van-monumentale-bomen) · [PDOK orthophoto](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0)

| Register ID | Species | Planting years | Inventory and orthophoto review |
| --- | --- | --- | --- |
| 1683098 | *Quercus robur* | 1700–1750 | Matched manually to the isolated garden crown. BGT and MOR agree 4.4 m from the register pin. |
| 1683100 | *Sequoiadendron giganteum* | 1880–1890 | Matched the single distinctive evergreen crown. The baseline point is 3.2 m from the pin. |
| 1684850 | *Gleditsia triacanthos* | 1900–1910 | Canopies overlap beside the railway. The only MOR candidate is 5.4 m away. Needs a ground check. |
| 1684851 | *Quercus robur* | 1870–1880 | Matched the isolated square tree. BGT and MOR agree within 0.7 m of the pin. |
| 1684852 | *Fagus sylvatica* | 1880–1890 | Several aligned roadside crowns. The nearest candidate is 3.3 m away. |
| 1684854 | *Quercus robur* | 1830–1840 | An open-grown crown is visible. The candidate is 5.5 m away and the trunk position needs inspection. |
| 1684855 | *Quercus robur* | 1830–1840 | Garden canopy and a building shadow meet at the pin. A trunk could not be confirmed. |
| 1684856 | *Fagus sylvatica* ‘Atropunicea’ | 1830–1840 | A crown crosses a path at the pin. No inventory position within 9 m. |
| 1684857 | *Fagus sylvatica* ‘Atropunicea’ | 1880–1890 | The MOR trunk 2.3 m from the pin sits at the centre of the photographed bare crown. |
| 1684864 | *Quercus petraea* ‘Mespilifolia’ | 1880–1890 | Matched the isolated trunk beside the path, about 1.8 m from the pin. |
| 1684865 | *Fagus sylvatica* | 1860–1870 | Multiple mature crowns and candidates. Retain as a field-review record. |
| 1684866 | *Quercus robur* | 1860–1870 | Large canopy beside a route. No inventory point within 9 m. |
| 1691404 | *Fagus sylvatica* | 1820–1830 | Forest canopy cannot identify the trunk. No nearby inventory point. |
| 1694741 | *Fagus sylvatica* | 1930–1940 | BGT and MOR agree on a nearby garden tree 5.5 m away. The roof-side canopy is ambiguous. |
| 1695137 | *Fagus sylvatica* ‘Atropunicea’ | 1850–1860 | Matched the western of the two adjacent garden crowns to the baseline trunk at 2.3 m. |
| 1695138 | *Fagus sylvatica* | 1920–1930 | Matched the eastern crown to the separate baseline trunk at 1.5 m. |

The separately reviewed 2023 Haskoning inventory is a good candidate for height and diameter classes. Its publisher did not specify redistribution terms. [Haskoning item, sample match and terms](ede-haskoning-tree-review.md)
