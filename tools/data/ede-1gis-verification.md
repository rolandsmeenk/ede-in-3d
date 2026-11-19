# A12 and A30 1GIS pilot

Rijkswaterstaat’s Geografische Areaalregistratie replaces the previous motorway detail source. The importer requests RD New and Z data for layers 6, 13, 23, 30, 31, 44 and 45. It also uses layer 9 for hectometre markers. The source uses CC0. The bake records surveyed geometry and attributes before converting to the Oude Kerk scene frame. BGT continues to supply town-wide inventory and the existing bridge and civil geometry. [1GIS service](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer) · [1GIS licensing](https://data.overheid.nl/en/dataset/79897-rws-1gis)

Surveyed paint replaces overlapping procedural lines on its own road way. The road graph still supplies the lane centres, access and travel directions. The renderer uses the same paint material and chunk builder for both sources. In Fast mode the paint writes the color attachment. With reflections enabled it also preserves the underlying asphalt’s G-buffer. The Fast-mode fix restored the dashed and solid lines observed in the Maanderbroek preview.

NBd records match by their string identifiers, with leading zeroes preserved. The current export has 394 points inside the playable bounds and 347 with destination entries. The pilot uses the published panel drawings and surveyed 1GIS mounts. The atlas crops the panel face from each reviewed drawing. Standard traffic sign and supplementary plate art still comes from the existing NDW pipeline. [NBd downloads](https://downloads.rijkswaterstaatdata.nl/bewegwijzering/) · [NDW sign data](https://docs.ndw.nu/en/data-uitwisseling/interface-beschrijvingen/verkeersborden-api/v5/)

| Runtime input | Contents | Packed bytes |
| --- | --- | ---: |
| 1GIS detail | 1,317 paint sections, 538 barriers, 282 markers, 41 gantries, 15 railings and one noise barrier | 118,229 |
| Lamps | 15,242 placed masts, including 227 distinct 1GIS-only ground masts | 143,466 |
| NBd geometry and atlas | 32 panels, 22 on 15 1GIS gantries and 10 on standalone supports | 249,591 |
| Total | Three runtime inputs | 511,286 |

The 1GIS bake assigned 2,118 pieces to NWB sections and 170 to a fitted grade profile. It retained 791 same-level carriageway ambiguities for visual use, removed 20 coincident placements, and trimmed 17 BGT wall overlaps. Different-layer ties and unsupported raised shoulders were withheld. The game joins six coincident gantry and lamp supports. The 1GIS layer 31 coverage leaves many historical DTB boundary fences without a new survey match. [1GIS source and review notes](ede-1gis.sources.md)

At De Poortwachter, all 35 upper poles follow the bridge footprint. Consistent 1GIS mounting Z supplies 25 bases, and fitted profiles supply 10. Three level-zero source rows give two physical masts. The reference pole at X −1395.17, Z 3489.69 moved from 12.88 to 18.97 m NAP. Its baked target is also 18.97 m NAP. In the browser, sampled upper light pools targeted the bridge at about 18.7–19.2 m NAP with a range of about 11 m. Lower fixtures retained lower targets near 12.6–13.4 m NAP. Town-wide deduplication removed 87 coincident BGT placements and 22 extra overlapping 1GIS observations. [Lamp source and matching notes](ede-lamps.sources.md)

The NBd pilot reviewed 33 joined signs and withheld one multipart sign pending separate mounts. One Ede-West sign retains a raw elevation discrepancy and uses its fitted gantry beam. The sampled panels faced their intended approaches and the Ede-West sign seated on its gantry after the fit. [NBd review and refresh](ede-nbd-signs.sources.md)

## Browser checks

The positions below use scene X and Z in metres. Use the listed way for the camera’s supporting surface. The full `motorway` benchmark suite records both directions at each crossing and runs with traffic and parking active.

| View | X, Z | Way | Intended check |
| --- | --- | --- | --- |
| Maanderbroek eastbound | −4252, 2145 | `w750476158` | A12, Arnhem, Ede and Oberhausen wording and A30 exit panel |
| Maanderbroek westbound | −3804, 2410 | `w493246904` | Utrecht and Den Haag side, plus the A30 branch |
| De Poortwachter upper north | −1397, 3534 | `w6921137` | Raised mast bases and deck lighting, day and night |
| De Poortwachter upper south | −1424, 3486 | `w25551033` | Raised mast bases and deck lighting, day and night |
| De Poortwachter lower east | −1450, 3487 | `w723962252` | A12 approach and lower-surface lights, day and night |
| De Poortwachter lower west | −1386, 3481 | `w723962249` | A12 approach and lower-surface lights, day and night |
| A12 Ede eastbound | −1922, 3395 | `w1085149039` | Ede, Wageningen and Bennekom panel |
| A12 Ede westbound | −764, 3573 | `w509484015` | Opposing Ede, Wageningen and Bennekom panel |
| A12 exit 24 local approach | −1360, 3782 | `w25999048` | N781 approach and its shared portal |
| A30 Ede-Noord south approach | −3601.4, 360.6 | `w373106553` | Kievitsmeent and exit approach |
| A30 Ede-Noord north approach | −3630.2, −595.2 | `w6960155` | Ede-Noord, Renswoude and N224 panel |

## Cross-level railing audit

The audit checked 555 1GIS barrier candidates against every fitted bridge and underpass travel surface in the playable area. It reassigned 12 railing spans to upper surfaces using ten existing BGT bridge surfaces and two fitted upper profiles at Maanderdijk. One Maanderbroek span was withheld when its Z did not corroborate the upper surface and the lower placement cut through a carriageway. All 538 guardrail sections kept their assigned surface. [Records and mount evidence](ede-1gis.sources.md)

At Maanderdijk the 1GIS structure footprint supports two extensions from the fitted deck edges to the surveyed railings. The bake clips both railing ends to the structure and supplies the shoulder edges to the renderer. The player drove at least 31 m through each of the lower N224, Maanderbroek and Maanderdijk passages while staying on the fitted lower surface.

| Crossing checked | Lower way and view X, Z | Upper way and view X, Z |
| --- | --- | --- |
| N224 below A30 | `w45036439` at −3625, 75 | `w6960119` at −3598.8, 49 |
| Main crossing at Maanderbroek | `w493246904` at −4155, 2187 | `w6960104` at −4175, 2170 |
| Maanderbroek connecting ramps | `w6960114` at −3950, 2295 | `w6960110` at −3963, 2309 |
| Maanderdijk below the A12 links | `w993493475` at −1446.5, 3686 | `w1212023123` at −1430, 3642 and `w1212023126` at −1428, 3676 |

The BGT check covered all 57 imported fences and one hedge against 8,335 mapped road and path geometries. The only same-level centreline overlap of more than 0.007 m² was at X −22.17, Z 1975.87. The mapped path has `access=no`, `bicycle=no` and `foot=no`, so the fence remains in place. [OpenStreetMap access evidence](https://www.openstreetmap.org/way/225987621)

## Reproduce the benchmark

Serve the pre-change snapshot on port 8991 and the equivalent snapshot with this change applied on port 8992. The benchmark uses Chrome WebGPU at 1600 × 900, the Fast preset, fixed traffic randomness, and the same camera path and light preset per shot in both builds.

```sh
EDE_BENCH_SCENARIOS=motorway EDE_BENCH_RUNS=2 EDE_BENCH_FRAMES=60 EDE_BENCH_TRAFFIC=active \
  node tools/benchmark-ede.mjs /tmp/ede-1gis-paired.json http://127.0.0.1:8992 9297 \
  'http://127.0.0.1:8991/?perf=1' 'http://127.0.0.1:8992/?perf=1'
```

| View | Median draw calls, DTB → 1GIS | p95 frame time in ms, DTB → 1GIS |
| --- | ---: | ---: |
| Maanderbroek A12 east | 1,220 → 1,259 | 16.7–16.8 → 16.7 |
| Maanderbroek A12 west | 636 → 660 | 16.7–16.8 → 16.7 |
| De Poortwachter upper north | 2,284 → 2,301 | 33.3–33.4 → 33.3–33.4 |
| De Poortwachter upper south | 500 → 508 | 16.7–16.8 → 16.7–16.8 |
| De Poortwachter lower east | 887 → 911 | 16.7 → 16.8 |
| De Poortwachter lower west | 1,331 → 1,356 | 16.7 → 16.7 |
| A12 Ede exit approach | 804 → 816 | 16.7–16.8 → 16.8 |
| A12 Ede exit on-ramp | 1,006 → 1,022 | 16.7 → 16.7–16.8 |
| A30 Ede-Noord south | 1,128 → 1,159 | 16.7–16.8 → 16.7–16.8 |
| A30 Ede-Noord north | 629 → 649 | 16.7–16.8 → 16.7–16.8 |

Across the two pairs, median time to the first playable frame was 9.43 → 9.56 s cold and 9.46 → 9.51 s warm. The road paint build took 202–210 ms before and 251–254 ms after. The imported detail build took 59–60 ms before and 48–49 ms after. Each final load placed 877 non-paint 1GIS objects and 32 NBd panels with zero unresolved render placements. The road paint pass also received all 1,317 surveyed line sections.
