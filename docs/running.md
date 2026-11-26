# Running Ede in 3D

Local setup, GitHub Pages behavior and browser profiling. [Simulation and live feeds](simulation.md) · [Map and asset builds](map-and-assets.md)

## Run locally

Run the local server and open [localhost:8000](http://localhost:8000). Live road data matching uses Node.js 22 or later.

```sh
python3 tools/serve-ede.py
```

Add `--offline` to skip upstream traffic, rail and weather feeds. A plain static server such as `python3 -m http.server 8000` also runs the offline traffic model. Three.js, OpenStreetMap geometry, posted limits, and the timetable are local. The simulator streams LoD 2.2 buildings when 3DBAG is reachable and uses OpenStreetMap footprints otherwise.

## GitHub Pages and live data

GitHub Pages serves the game and its bundled assets. Live features that use Ede in 3D’s server require a separate deployment. [GitHub Pages hosting model](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

| Feature | On GitHub Pages |
| --- | --- |
| Environment clock and seasons | Live calculates the sun position and seasonal date in the browser and displays the current date and time in Europe/Amsterdam. |
| Weather | Live fetches current Ede conditions directly from Open-Meteo if the game’s weather endpoint is absent. Preset weather works offline. |
| Frankeneng water levels | Live fetches the waterschap’s gauge values directly. Preset mode and unavailable readings use bundled levels. |
| Fuel prices | Street-side signs show estimates from the latest published CBS national average. The browser refreshes the reference hourly while visible and uses a dated bundled value offline. |
| Road traffic | Uses bundled posted speed limits and Amsterdam time-of-day demand. Live NDW counts, speeds, closures and temporary limits require the feed server. |
| Emergency responses | Live P2000 dispatches require the traffic feed server. Ambulances continue their simulated rounds while it is unavailable. |
| Buses and trains | Follow bundled timetables. Level-crossing barriers respond to timetable-based trains. Live bus positions, NS GPS and RS34 service updates require the feed server. |
| Parking | Uses local occupancy profiles. Live readings for supported garages require the feed server and authorised NPR credentials. |

The game can stay on GitHub Pages while the feed server runs separately over HTTPS. For live road traffic, buses and P2000, start the server with `--cors-origin https://yourname.github.io` and set `data-traffic-endpoint="https://feeds.example.org/api/ede-traffic"` on `#canvas-container` in `index.html`. To try a feed server without editing the page, append `?trafficApi=https://feeds.example.org/api/ede-traffic` to the game URL. The train and parking endpoints use the game's own origin.

## Graphics and profiling

**Graphics quality** in the **Menu** offers **Fast** and **Standard**. Both presets use screen-space reflections and color grading. Fast is the default and renders reflections at a lower resolution with shorter rays. Standard adds multisample antialiasing. Both presets use the 12 m AHN town grid and stream the outer terrain down to 5 m spacing.

The camera draws up to 2.6 km at street level and gradually extends its range to 13 km by 320 m above local terrain. Terrain and scenery use coarser geometry as their projected detail gets smaller, with a larger pixel error budget in flight.

Fast keeps bloom and dynamic shadows on desktop. On iPhone and iPad, both presets use WebGL 2 for startup reliability. Fast on those devices uses a lower internal resolution, sparser woodland, and fallback buildings in town, with bloom and dynamic shadows disabled.

Append `?debug=1` and choose **Debug → Traffic lanes** to see the motor traffic graph near the camera. `?laneDebug=on` opens the game with the overlay enabled. Arrows show the travel direction, thin lines show junction connections, cyan marks fitted paths, amber marks fallback paths, and purple marks paths used only by scheduled buses.

Append `?perf=1` to collect a rolling frame history. Open the browser console and run `await __slopwaw.perf.report()` for median and p95 frame time, subsystem CPU time, and render pass statistics. Pass `{frames: true}` for individual samples. GPU times are available on WebGPU devices with timestamp queries. `__slopwaw.perf.reset()` starts a fresh sample.

In profiling mode, append any of `shadows`, `ssr`, `bloom`, `msaa`, `buildingDetail`, `vegetation`, `murals`, `trafficDraw` and `trafficUpdates` with `=on` or `=off` to override one setting. `scale=0.75` tests a lower internal resolution, and `bag=eager` restores the original all-tiles startup path for comparison. You can freeze existing traffic with `__slopwaw.perf.setTrafficUpdates(false)` and independently hide it with `__slopwaw.perf.setTrafficDraw(false)`.

On the test device, serve the game locally and start a separate Chrome profile with `--remote-debugging-port=9297`. The script replays the station, Kuiperplein, Kolkakkerweg, helicopter and camera-jump views at 1600 × 900. Use the offline server to fix external traffic, weather and parking observations. The public 3DBAG tiles remain enabled. The script fixes the random seed, simulation timestep and service clock. It reports network bytes from DevTools and sampled V8 heap plus backing storage. Browser/GPU process memory is a separate metric.

```sh
EDE_BENCH_TRAFFIC=active node tools/benchmark-ede.mjs /tmp/ede-benchmark.json http://127.0.0.1:8000 9297 'perf=1&quality=standard' 'perf=1'
```

The frame budget is 33.3 ms for 30 FPS. Use p95 for recurring dips and the maximum interval for single-frame jumps. The [performance report](../tools/data/ede-performance.md) records the comparison and terrain budget.

Run the expansion suite with active traffic to check the 800-draw average for each view. It includes the shadow and post-processing passes. The report also records peak streamed geometry and p95 frame time. The delay option exercises terrain and canopy fallback during loading.

```sh
EDE_BENCH_SCENARIOS=expansion EDE_BENCH_TRAFFIC=active EDE_BENCH_CACHE=cold \
  EDE_BENCH_TILE_DELAY_MS=600 EDE_BENCH_RUNS=1 \
  node tools/benchmark-ede.mjs /tmp/ede-expansion.json http://127.0.0.1:8000 9297 'perf=1'
```

The municipality suite covers newly playable villages, the former cutoff, the eastern terrain edge and the Veenendaal building fringe. It reports one draw count and triangle count for the terrain each frame. Set `EDE_BENCH_BACKEND=webgl` to check fallback initialization and rendering.

```sh
EDE_BENCH_SCENARIOS=municipality-coverage EDE_BENCH_TRAFFIC=active EDE_BENCH_RUNS=1 \
  node tools/benchmark-ede.mjs /tmp/ede-municipality.json http://127.0.0.1:8000 9297 'perf=1&quality=fast'
```

Use a second variant with `forestCanopy=off` to compare the individual-tree rendering.
