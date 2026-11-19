# Ede traffic pilot

The pilot runs by default. Append `?trafficPilot=off` to compare with the previous ambient behavior on the same map. The comparison shares the rebuilt lane graph, OSM turn restrictions and bus timetable in both variants.

## Routes, controls and evidence

Grotestraat, Markt, Kuiperplein and Ede-Wageningen station each have separate approaches for motors, bicycles and pedestrians. Nearby residential streets and the mapped school sites at Telefoonweg and Zandlaan supply additional destinations. The bundled destinations are projected once onto same-level graph edges at load. Route searches use the existing directed links, connections and access rules. Grotestraat motor trips use public approaches such as Driehoek. Markt motor trips approach the mapped Q-Park entrance from Molenstraat. Foot trips can enter the pedestrian areas.

The destination weights are simulation assumptions. Schools and the station are favored on weekday mornings, shops and parking during shopping hours, and residential streets overnight. The game evaluates those weights in Europe/Amsterdam. Fresh NDW counts still control the contribution of the measured road direction to the motor population target. Unmeasured directions sample up to two alternatives to favor less recently used local roads. Fresh count-calibrated directions retain their original area-weighted draw. Parking departures occupy moving-car slots. Arrivals divert existing cars and reserve spaces through the parking system. If a trip reaches a full facility, it can continue on a legal road and be offered another reachable space by the ordinary parking scheduler. [NDW demand and expiry](ede-traffic-sources.md) · [Parking assumptions](ede-parking-demand.md)

The pilot limits planning requests to three per frame, reserves one of those requests for closures, and shares a bounded cache. Each search has separate bounds for nodes and distance. Routes are chosen at spawn and rechecked at a closure. A failed plan leaves ambient actors on their existing local routing. A bus detour must rejoin its scheduled lane before its next boarding stop. If the bus cannot do that, it holds before the closure. The original local spawn budgets, simulation radii and actor pools apply.

Mapped humps and tables slow cars, vans and buses before the footprint. An explicit stop line requires a 1.25-second standing stop. Drivers yield to circulating vehicles on verified roundabout approaches, and yield to people approaching or occupying a zebra when the pedestrian link and directed road crossing agree. Uncertain controls keep their review entries. The signal records identify locations and crossing controls. They lack lane-to-signal-group assignments and verified timing, so traffic uses the existing simulated cycle. [Directed control sources and review](ede-driving-controls.sources.md)

The [junction and route audit](ede-junction-route-audit.md) records restrictions, connected approaches, and the remaining route gaps independently by level. The November feeds matched seven boarding IDs in the forecourt and three at Stadspoort. Twenty-one short gaps remain south of the forecourt. The Hartogspad ramp reconnects to the surface cycling and walking routes. The Oosttunnel passage is continuous at its own level. Platform stairs and lifts still need a fitted connection with surveyed grades.

All 14 mapped public rail sites use the train system's shared GPS, live-estimated or scheduled progress. Warnings, arms and the mode-specific stop queries use the same crossing phase. An approaching second train holds the warning. Reopening starts after the last carriage has cleared. Warning durations are simulated. [Rail and crossing evidence](ede-grade-sources.md) · [ProRail level crossing guidance](https://www.prorail.nl/veiligheid/overwegen/veilig-oversteken)

## Running game checks

The offline Chrome WebGPU runs used a fixed November 19, 2026 date, an America/Los_Angeles browser time zone, and local game assets. External requests were blocked. Road closures and occupancy were injected as dated feed fixtures.

| Case | Observed |
| --- | --- |
| Molenstraat raised zebra | A car started 19.75 m before the hump at 30.0 km/h. It was down to 22.6 km/h four metres before the footprint and 19.7 km/h on approach to its leading edge. With a pedestrian on the linked approach, it stopped short of the stripes and resumed when clear. |
| Asakkerweg and Doctor Willem Dreeslaan | The staged car stood for about 1.35 seconds at each directed stop before proceeding. |
| Telefoonweg roundabout | The entering car waited for the circulating vehicle, then entered the ring without conflict. |
| Temporary directional closure | Closing directed edge 1340 on OSM way 6953559 triggered a legal route to Markt via edge 1339. |
| Station bus-only approach | Four scheduled buses moved through the signed bus-only lanes in the forecourt. Two boarding stop IDs were observed in dwell. All 304 schedule sections passed the lane-leg check, and the signed lanes had no ambient car access. |
| Full Q-Park Markt | A fresh 440-of-440 capacity reading offered zero eligible arrivals. |
| Stadspoort | The upper footway and lower passage stayed on layers 1 and −2 with about 4 m separation across the tested tracks. They produced no junction between levels. |
| Telefoonweg and Brouwerstraat level crossings | Offline RS34 train 31319 activated the red lamps and barriers. The staged Telefoonweg car and cyclist waited, then crossed after reopening. Two pedestrians did the same at Brouwerstraat. The automated Dwarsweg check verifies that a second approaching train holds the crossing. |

## Performance and routing

Headless Chrome WebGPU on macOS used the same four terrain-relative camera movements at 960 × 680. The traffic profile was 09:30 Amsterdam, with 160 frames per view and a separate 110-second centre replay using 0.05-second simulation steps. Both builds used the same baked roads, scenery and timetable. Traffic CPU is wall time around the vehicle, bicycle, pedestrian and parking update, in milliseconds. Frame interval includes render and GPU pacing. Median populations count active cars, bicycles, pedestrians and scheduled buses, in that order.

| View | Traffic CPU p50 / p95 off | Traffic CPU p50 / p95 on | Frame p95 off / on | Median actors off / on | Directed edges off / on |
| --- | ---: | ---: | ---: | ---: | ---: |
| Grotestraat and Markt | 0.5 / 0.7 | 0.5 / 0.8 | 16.8 / 16.7 | 25 / 20 / 73 / 0 both | 27 / 30 |
| Kuiperplein | 0.4 / 0.6 | 0.5 / 0.7 | 16.7 / 16.8 | 24 / 19 / 71 / 0 both | 26 / 34 |
| Station forecourt | 0.6 / 0.7 | 0.7 / 0.9 | 16.8 / 16.7 | 35 / 30 / 59 / 3 both | 36 / 38 |
| Jump from station to Stadspoort | 0.5 / 0.7 | 0.5 / 0.7 | 16.8 / 33.3 | 35 / 28 / 38 / 0 both | 30 / 36 |

Across the offline runs, completed trips reached all four named destinations. The final moving-camera views followed by the centre replay recorded 49 motor, 10 cycling and 46 walking plans, with 29, 28 and 29 failed searches respectively. A failure means none of the sampled destinations could be reached within the planning bounds. Actors that recycled or were still in progress account for the difference between successful plans and arrivals.

All four short views sampled more distinct directed roads with the pilot. The separate 110-second centre replay sampled 115 with the pilot and 125 with ambient routing. Coverage therefore depends on the route and observation window. The jump showed a higher p95 frame interval in the paired run even though its traffic CPU p95 stayed at 0.7 ms. Both variants ran from the same asset snapshot in separate Chrome processes.

The Node suite covers lane and turn legality, dated demand, closure detours, hump and zebra matching, barrier warning and release, grade-separated links and bus boarding. The Python Ede suite validates data and feed processing.

```sh
node --test tests/*.test.cjs tests/*.test.mjs
uv run --with 'shapely>=2.1' --with osmium python3 -B -m unittest discover -s tests -p 'test_ede*.py'
```
