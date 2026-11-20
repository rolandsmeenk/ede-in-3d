# Simulation and live feeds

Traffic, weather, parking and public transport in Slop Ede. [Hosting and feed availability](running.md#github-pages-and-live-data) · [Traffic pilot and verification](../tools/data/ede-traffic-pilot.md)

## Live road traffic

The live server caches the national NDW DATEX II v3 and OVapi GTFS-Realtime feeds and serves only matches within the Ede map. NDW readings change demand and cruising speed on their matched direction. Posted or applicable temporary limits cap speed. Valid closures block new entry. The camera-local simulation uses Amsterdam time-of-day demand and the timetable when live data expires. See the [traffic data notes](../tools/data/ede-traffic-sources.md) for coverage, fallbacks, and the frame-time measurements.

## Live Weather

Turn on **Live Weather** in the toolbar to use current model estimates for Oude Kerk. The weather card shows the source and model update time in Europe/Amsterdam. You can use Live Weather with any preset or Live Time. Turning it off restores the selected lighting mode’s weather settings.

The game requests an update about every 15 minutes while visible. The local server shares one cached reading across clients. Static hosting requests the same conditions from Open-Meteo when the server endpoint is absent. A reading is marked stale after 30 minutes and fades back to the selected mode after an hour. When no reading is available, the selected mode supplies the weather settings.

Concordiamolen, De Keetmolen and both Maanderbroek turbines turn into the wind using the 10 m reading shown in the Live Weather card. Preset weather supplies a simulated 18 km/h southwesterly breeze when Live Weather is off or a reading is unavailable.

The Maanderbroek Siemens SWT-3.2-101 turbines have a 3 m/s cut-in speed and a 25 m/s cut-out speed at hub height. Siemens lists a 6.5–19 RPM operating range. The game estimates wind at the 99.5 m hubs with the 1/7 power law and approximates the controller’s speed curve within that range. [Wind farm construction record](https://verwaard-bv.nl/raedthuys-windpark-a30-a12-maanderbroek/) · [Siemens datasheet](https://datasheet.datasheetarchive.com/originals/crawler/siemens.com/d1ee0e9960c2d8b87e5d46af432194c2.pdf) · [Wind shear reference](https://docs.nrel.gov/docs/fy15osti/63696.pdf)

Concordiamolen and De Keetmolen show canvas on their wooden lattices as they turn. The game shortens the canvas in stronger winds and shows bare lattices in high wind or at rest. The wind thresholds approximate a miller’s sail settings. [Gilde van Molenaars handbook](https://gildevanmolenaars.nl/f/files/download/opleidingen/lesmateriaal/handboek-windmolenaar/hoofdstuk-7-de-praktijk-dl-1-vs-23.pdf)

Rain and snow use one camera-local draw with at most 1,200 particles. The effect is suppressed below mapped tunnel roofs, bridge decks and open sheds. Rain wets the roads and the surface dries gradually as rain stops. The timestamped reading and freshness status are available through `window.__slopwaw.weather`.

[Open-Meteo](https://open-meteo.com/en/docs) supplies the weather estimates. [Isometric Warsaw](https://bedirhanyildirim.com/warsaw-izo/) and [Slop Geneva](https://github.com/emmanpi/slop-geneva/blob/HEAD/js/weather.js) are references for the weather controls and camera-local precipitation.

In headless Chrome WebGPU at 960 × 537, two 100-frame passes along the same street-level route had a median frame interval of 16.7 ms with rain hidden and with roughly 1,200 particles visible. The 95th percentile was 16.7 ms with rain hidden and 16.7–16.8 ms with rain visible. Both runs were near the browser’s 60 Hz frame limit.

## Refresh the bus routes

The game loads a local timetable and lane matches for both directions of Ede lines 1–4, 103 and 303. Stop signs use the GTFS boarding coordinates and platform letters. Buses display the GTFS trip headsign, and dwell at stops they can reach on connected lanes. Fresh OVapi positions guide the same scheduled actor along its route. Buses approach and leave the camera area at their current route positions. If no service is running at startup, the simulation opens at the next mapped departure.

```sh
curl -fL https://gtfs.ovapi.nl/nl/gtfs-nl.zip -o /tmp/ede-gtfs.zip
python3 tools/import-ede-gtfs.py /tmp/ede-gtfs.zip /tmp/ede-gtfs.json
node tools/export-ede-bus-road-graph.mjs > /tmp/ede-bus-graph.json
node tools/build-ede-bus-routes.mjs /tmp/ede-gtfs.json /tmp/ede-bus-graph.json assets/ede-bus-routes.json /tmp/ede-bus-match-report.json
```

The match report lists gaps by variant, including coordinates and affected boarding points. Matching uses actual graph turns, with separate edges for the mapped busways and selected underpasses. Buses are hidden inside tunnels whose interiors are outside the terrain model. Sections with no reliable connected lane are omitted from the driving simulation.

The November 2026 snapshot contains 81 variants, 64 of which enter the playable map. Of the 125 marked GTFS boarding locations, 121 have a reliable driving-lane match. See the [junction and route audit](../tools/data/ede-junction-route-audit.md) for checks at the station forecourt, Oosttunnel and Stadspoort.

## Parking simulation

Parking uses 18,193 fitted spaces in 1,562 areas, in the same horizontal and vertical datum as the street scene. The bake merges mapped bays and estimates row capacity from BGT surfaces, WKD roadside coverage, and OpenStreetMap data. The [parking inventory notes](../tools/data/ede-parking-sources.md) document sources, fit counts, restrictions, clearances, and the rebuild command.

Parkweg and Kuiperplein use local survey anchors. Other streets use Amsterdam time-of-day and weekday profiles. The station P+R has a weekday commuter profile and honours its published closure through 27 November 2026. Each garage has virtual spaces and separate access routes where mapped. The [demand notes](../tools/data/ede-parking-demand.md) explain the source and dwell assumptions.

Parked cars use reusable instance tiles. Departures replace ambient spawns and arrivals divert cars already in the traffic pool. Up to four nearby cars can reserve spaces or manoeuvre at once. Cars yield at the Kuiperplein driveway, and the approach checker rejects curb movements across protected paths without a verified opening.

The local server supplies `/api/ede-parking`. Exact Q-Park readings require authorised NPR credentials in `EDE_NPR_USERNAME` and `EDE_NPR_PASSWORD` on the server. The simulation places cars in the mapped spaces or at garage entrances and exits. Readings expire after three minutes and occupancy eases into the local profile. Parkweg, Kuiperplein and the new station garage use surveyed or inferred occupancy. [NPR data access](https://www.nationaalparkeerregister.nl/downloads/certificaten-en-aanvraagformulieren)

For profiling, append `?parking=off` to the game URL. The debug API `window.__slopwaw.trafficSystem.parking.summary()` reports local capacity, occupancy, source, and completed arrivals and departures by area. The [parking verification report](../tools/data/ede-parking-verification.md) records the fixed-time checks and performance comparison.

## Passenger trains

NS services follow the Utrecht–Arnhem main line through Ede-Wageningen. RRReis RS34 follows the Valleilijn through Ede Centrum and reverses at Ede-Wageningen. The trains use the same mapped rails, turnouts and elevation profiles as the track renderer. Berth centers are estimated from the mapped platforms. The simulator keeps up to eight nearby trains in a reusable pool and shows the closest train’s number, data status and track when known.

The server publishes local services at `/api/ede-trains`. NS position reports come from NDOV’s key-free stream. To enable that stream, install `pyzmq` in the server’s Python environment or start with `uv run --with pyzmq python tools/serve-ede.py`. The default GPS prediction window is 32 seconds and can be changed with `data-train-prediction-seconds` in `index.html`. The browser advances each train along the matched track and brakes for the next confirmed stop. After the window, a matched service continues on a timetable estimate aligned with the last predicted position. An unmatched service retires when its prediction expires. [NDOV real-time feeds](https://govi.nu/realtime.html)

OVapi supplies RS34 delays, changes to station times and platforms, skipped stops and cancellations. The server polls every minute. After three minutes, timing switches to a timetable estimate. The server retains dated cancellations through feed gaps. Train status reads **GPS**, **estimated from live updates**, or **timetable**. Service dates follow Europe/Amsterdam, including trips continuing after midnight, regardless of the lighting mode. [OVapi rail updates](https://gtfs.ovapi.nl/nl/)

The bundled timetable covers 18 November 2026 through 11 December 2027. Offline mode and static hosting use that timetable for both operators. Outside the bundled dates, the simulator reuses the closest bundled service pattern for the same weekday. Refresh the local asset from the [OVapi GTFS archive](https://gtfs.ovapi.nl/nl/).

```sh
python3 tools/import-ede-trains.py ./gtfs-nl.zip assets/ede-train-timetable.json
```

The final WebGPU check in headless Chrome at 960 × 537 ran two 100-frame passes with two trains drawn and two passes along the same camera route with train drawing hidden. All four passes measured 16.7 ms at the median and 95th percentile. An earlier pair of runs measured 33.4 ms at the 95th percentile in both conditions. The train update itself measured 0.1 ms at the 95th percentile. These tests used the offline map.
