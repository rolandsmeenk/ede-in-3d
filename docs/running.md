# Running Slop Ede

Local setup, GitHub Pages behavior and browser profiling. [Simulation and live feeds](simulation.md) · [Map and asset builds](map-and-assets.md)

## Run locally

Run the local server and open [localhost:8000](http://localhost:8000). Live road data matching uses Node.js 22 or later.

```sh
python3 tools/serve-ede.py
```

Add `--offline` to skip upstream traffic, rail and weather feeds. A plain static server such as `python3 -m http.server 8000` also runs the offline traffic model. Three.js, OpenStreetMap geometry, posted limits, and the timetable are local. The simulator streams LoD 2.2 buildings when 3DBAG is reachable and uses OpenStreetMap footprints otherwise.

## GitHub Pages and live data

GitHub Pages serves the game and its bundled assets. Live features that use Slop Ede’s server require a separate deployment. [GitHub Pages hosting model](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

| Feature | On GitHub Pages |
| --- | --- |
| Live Time | Calculates the sun position in the browser and displays the current time in Europe/Amsterdam. |
| Live Weather | When enabled, fetches current Ede conditions directly from Open-Meteo if the game’s weather endpoint is absent. |
| Road traffic | Uses bundled posted speed limits and Amsterdam time-of-day demand. Live NDW counts, speeds, closures and temporary limits require the feed server. |
| Buses and trains | Follow bundled timetables. Level-crossing barriers respond to timetable-based trains. Live bus positions, NS GPS and RS34 service updates require the feed server. |
| Parking | Uses local occupancy profiles. Live readings for supported garages require the feed server and authorised NPR credentials. |

The game can stay on GitHub Pages if the feed server is deployed separately over HTTPS. The client currently requests the API on the same origin. A separate deployment requires configuring the client to use that server and allowing requests from the Pages origin.

## Graphics and profiling

The **Graphics** menu offers **Fast** and **Standard**. Fast is the default and keeps bloom and color grading. Standard enables screen-space reflections and multisample antialiasing. The terrain uses the same 12 m AHN grid in both presets.

Append `?perf=1` to collect a rolling frame history. Open the browser console and run `await __slopwaw.perf.report()` for median and p95 frame time, subsystem CPU time, and render pass statistics. Pass `{frames: true}` for individual samples. GPU times are available on WebGPU devices with timestamp queries. `__slopwaw.perf.reset()` starts a fresh sample.

In profiling mode, append any of `shadows`, `ssr`, `bloom`, `msaa`, `buildingDetail`, `vegetation`, `murals`, `trafficDraw` and `trafficUpdates` with `=on` or `=off` to override one setting. `scale=0.75` tests a lower internal resolution, and `bag=eager` restores the original all-tiles startup path for comparison. You can freeze existing traffic with `__slopwaw.perf.setTrafficUpdates(false)` and independently hide it with `__slopwaw.perf.setTrafficDraw(false)`.

On the test device, serve the game locally and start a separate Chrome profile with `--remote-debugging-port=9297`. The script replays the station, Kuiperplein, Kolkakkerweg, helicopter and camera-jump views at 1600 × 900. Use the offline server to fix external traffic, weather and parking observations. The public 3DBAG tiles remain enabled. The script fixes the random seed, simulation timestep and service clock. It reports network bytes from DevTools and sampled V8 heap plus backing storage. Browser/GPU process memory is a separate metric.

```sh
EDE_BENCH_TRAFFIC=active node tools/benchmark-ede.mjs /tmp/ede-benchmark.json http://127.0.0.1:8000 9297 'perf=1&quality=standard' 'perf=1'
```

The frame budget is 33.3 ms for 30 FPS. Use p95 for recurring dips and the maximum interval for single-frame jumps. The [performance report](../tools/data/ede-performance.md) records the comparison and terrain budget.
