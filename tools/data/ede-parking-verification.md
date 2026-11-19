# Parking verification

## Fixed Amsterdam clock scenarios

| Area and time | Reported capacity | Modeled occupancy at start | Completed arrivals / departures | Source |
| --- | ---: | ---: | ---: | --- |
| Parkweg street group, 18 November 2026 at 23:30 | 7 fitted | 5 | 0 / 0 | Parkweg survey profile |
| Kuiperplein, 19 November 2026 at 14:00 | 218 historical estimate, 132 fitted | 110 of 119 general-use spaces | 1 / 1 | Ede centre survey profile |
| Ede-Wageningen P+R, 30 November 2026 at 08:30 | 539 virtual | 368 | 1 / 1 | Inferred weekday commuter profile |

Counts describe completions during the controlled replays. Kuiperplein traffic used the mapped Telefoonweg driveway. One departure held when the bay path was blocked and a replay from another bay completed. At the driveway, an arrival held its position with a cyclist in the cycle lane and advanced again after the lane cleared. The P+R arrival and departure traversed their separate 173 m and 155 m access paths. The garage offered zero arrivals during the published 15–27 November closure window.

Returning to Parkweg after a 3 km camera jump reproduced the occupied space IDs and vehicle appearance seeds. A fixed exact-facility reading filled all 440 Q-Park Markt spaces and the garage offered zero arrivals. The route-search test selected a reachable alternative and rejected an illegal turn and a road closure. After the test reading expired, the garage’s source switched to inferred and the count began easing toward the modeled profile. Kuiperplein vehicle appearances stayed stable. The approach tests also reject a direct bay route across an unapproved cycle lane or at the wrong grade.

## Performance

Headless Chrome WebGPU at 960 × 537 used the offline building map. Each row contains two 75-frame passes in each condition along the same camera path. Traffic CPU measures the existing traffic update including parking. Draw calls use the renderer’s per-frame counter, including shadows and post-processing.

| Route | Median traffic CPU off → on, ms | Median frame time off → on, ms | Median draw calls off → on |
| --- | --- | --- | --- |
| Parkweg | 0.3 → 0.3 | 33.3 → 33.3 | 1,541–1,546 → 1,550–1,561 |
| Kuiperplein | 0.6–0.7 → 0.6–0.7 | 33.3 → 33.3 | 1,063–1,067 → 1,099–1,100 |
| Station | 1.1 → 1.1 | 33.3 → 33.3 | 1,533–1,535 → 1,542–1,564 |

The final moving-car counts of the sampled passes were 8 at Parkweg, 24 at Kuiperplein, and 46 at the station in both conditions. The 95th-percentile frame interval was approximately 50 ms at Parkweg and the station and 33.4 ms at Kuiperplein in both conditions. The station’s 95th-percentile traffic update went from 1.2 to 1.3 ms.
