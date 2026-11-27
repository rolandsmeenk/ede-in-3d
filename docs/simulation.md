# Simulation and live feeds

Traffic, weather, parking and public transport in Ede in 3D. [Hosting and feed availability](running.md#github-pages-and-live-data) · [Traffic pilot and verification](../tools/data/ede-traffic-pilot.md)

## Environment

In **Environment → Live**, the scene follows the date and time in Europe/Amsterdam. The same mode enables live weather and Frankeneng gauge readings. The toolbar shows Ede’s clock. Open the menu to see the date, weather source and update time, and gauge coverage.

**Environment → Custom** starts in Golden Hour with the current season selected. Choose the time of day, season and weather independently. Snow is available in Winter. Choosing a warmer season while Snow is selected sets Weather to **Lighting default**. Summer represents late August with heather in bloom. Custom and Photo scenes use bundled water levels. Return to **Custom** to restore your own settings after viewing a Photo scene or switching to Live.

The Schuttersveld skating oval in Ede and the outdoor court beside the De Zanding pool in Otterlo can show ice. Live mode estimates coverage from 48 hours of modeled outdoor temperatures. Ice forms in patches during frost and recedes during a thaw. The Winter preset uses a simulated cold spell. Bare rink and pond ice reflect the scene when screen-space reflections are enabled. Coverage is a visual estimate of rink conditions. [Edese IJsvereniging track](https://eijvarchief.nl/content/nieuws/nieuws.asp?Nummer=1294&v_titel=algemene+info+inline+skaten) · [De Zanding rink](https://storage.pubble.nl/96897487/pdf/barneveldsekrant20240111lr_74048.pdf) · [Open-Meteo hourly temperatures](https://open-meteo.com/en/docs)

### Date previews, routines and the agenda

In **Environment → Custom**, enter a date and time in Ede and select **Preview**. The scene freezes that Amsterdam time for the sun, season, landmark clocks, outdoor activities, decorations and advertisements. Choose the weather independently. Turn off the preview to return to your manual time and season presets. Live transit, observed traffic and parking, and temporary road restrictions keep following actual time.

At weekday rush hours, more trips head toward schools, workplaces and Ede-Wageningen station in the morning and toward homes in the afternoon. Marktplein gets more foot traffic during the Monday and Saturday markets. On Friday and Saturday evenings, nightlife concentrates around Astrant, Kuiperplein and Museumplein, tapering after 02:00. Holiday and weather adjustments affect the ambient simulation. [Municipal market hours](https://zoek.officielebekendmakingen.nl/gmb-2024-241322.html) · [Astrant programme](https://astrant-ede.nl/) · [Dutch public holidays](https://www.government.nl/home/question-and-answer/work/public-holidays-in-the-netherlands)

Open **Menu → Agenda** for the next twelve months of bundled events. **Preview** sets the event date and moves to its venue where the loaded map includes it. To add a confirmed edition, edit [the event calendar](../js/ede-event-calendar.js). Each entry has published dates, a venue and source, optional local hours, and a zone used to place extra foot traffic. Use `centrum` or `ginkelse-heide` for the existing areas. The simulation uses 12:00–22:00 for general festival attendance when individual hours vary. Add a campaign palette to promote major occasions on ads. Campaigns have a separate 14-day lead-up and run through the final event day.

On Ginkelse Heide, dry daylight and a steady breeze can bring out one kite flyer on weekdays and up to three on spring and summer weekend afternoons. Severe gusts, unsuitable weather and the active Airborne programme keep the site clear. In Live, kite attendance requires an available weather reading. For a Custom preview, **Clear** supplies a suitable breeze.

### Outdoor sports

Mapped football fields, tennis courts and athletics tracks host camera-local practice sessions. Expect football and tennis in the afternoon and on weekends, and track sessions in the morning as well. Actual schedules are simulated and vary by venue and date. To preview, choose a dry summer Saturday afternoon and visit DTS Ede, Tesqua or Climax.

Schuttersveld and De Zanding host skaters in daylight when the rendered rink is almost fully frozen. Snowfall, rain and thawing end the session. Try a clear winter date preview around noon to see a rink after a simulated cold spell.

### Clouds

Volumetric clouds progress from scattered cumulus through stratocumulus to a low overcast deck as coverage increases. Cloud shapes evolve and drift with Ede’s wind. Sunlight and the local Moon light the clouds, while the same layer masks the Sun, the Moon, stars and aurora and defines the gaps for the Sunbeams scene. The cloud shader runs on WebGPU and WebGL 2, with fewer samples on the compact graphics profile and when baking reflections. [Slop Toronto cloud renderer](https://github.com/johnfewell/slop-toronto/blob/18eafe3ce22c14f512ab4763429f93b44b6da0ea/js/sky-clouds.js)

### Night lighting

Live mode follows the Sun and Moon at Oude Kerk. The Moon appears at its local azimuth and elevation with its current sunlit phase and apparent size. Terrain, buildings and clouds can hide it. The Moon’s position is calculated in the browser. [Lunar position method](https://stjarnhimlen.se/comp/ppcomp.html#13)

As dusk ends, the scene settles into the Night preset’s sky colors and cool fill. Window lights fade in after sunset and follow a separate Europe/Amsterdam schedule. Homes peak around 21:00 and taper off overnight. Offices begin switching off after the workday and have fewer lit windows at weekends. Golden Hour and Midday have unlit windows. Blue Hour and Night have fixed window profiles. The same local hour can have lit windows in winter and full daylight in summer.

The window simulation uses building uses from the public BAG register. A 64 KB offline asset matches those uses to 25,470 of the map's footprints, including 22,820 homes and 501 office or education matches. OpenStreetMap tags cover additional buildings, with a conservative profile where use is unknown. Windows are emissive surfaces on the existing façade meshes. Their pattern is seeded per building and changes as the schedule fades. These are illustrative schedules. [Kadaster building-use definitions](https://catalogus.kadaster.nl/bag/nl/page/Gebruiksdoel) · [PDOK BAG](https://www.pdok.nl/ogc-apis/-/article/basisregistratie-adressen-en-gebouwen-ba-1)

The streetlights use BGT and 1GIS fixture locations. The public inventory provides positions and available fixture details. Ede documents energy-saving dimming in its municipal plan, and the game estimates which lights are on. Satellite night-light data measures the combined light of a broad area. [Streetlight inventory](../tools/data/ede-lamps.sources.md) · [Ede CO₂ management plan](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/CO2_Communicatie_2023.pdf) · [NASA Black Marble](https://blackmarble.gsfc.nasa.gov/)

To rebuild the window-use asset from a cached BAG snapshot made by the parcel-detail import:

```sh
uv run --with pyproj==3.8.0 --with 'shapely>=2.1' python tools/build-ede-window-uses.py /path/to/parcel-cache
```

## Live road traffic

The live server caches the national NDW DATEX II v3 and OVapi GTFS-Realtime feeds and serves only matches within the Ede map. NDW readings change demand and cruising speed on their matched direction. Posted or applicable temporary limits cap speed. Valid closures block new entry. The camera-local simulation uses Amsterdam time-of-day demand and the timetable when live data expires. See the [traffic data notes](../tools/data/ede-traffic-sources.md) for coverage, fallbacks, and the frame-time measurements.

## Vehicle mix

Ambient cars use hatchbacks, estates, SUVs, saloons, MPVs and a few dark taxis with blue plates. The simulator uses the national passenger-car fleet as its baseline for body styles and 2025 kilometres driven for the share of commercial traffic. Compact delivery vans are more common than high-roof vans. Pickups have a 0.3% weight among light vehicles. The hatchback and estate weights are estimates because the RDW body labels include some SUVs. [BOVAG/RAI fleet tables](https://cdn.sanity.io/files/j02l2p79/production_mijnbovag/89062e3999d78c28c2da0e75c479fde5e2475e33.pdf#page=8) · [CBS kilometres by vehicle type](https://www.cbs.nl/nl-nl/cijfers/detail/86373NED)

Rigid box trucks use major through roads. Tractor-semitrailers use the A12 and A30 and their connecting motorway ramps. Both follow mapped lane access, clearance limits, matched truck closure signs and the lower of the posted limit and 80 km/h. The spawn model uses about 9% freight on the sampled N224, N304 and N781 corridors and estimates for unmeasured roads. The semi moves as a single body. [Gelderland 2025 traffic counts](https://desktop.gelderland.nl/wegwerkzaamheden/gelders-verkeer) · [CBS road type by vehicle](https://www.cbs.nl/nl-nl/longread/rapportages/2025/wegtypeverdeling-voor-vrachtvoertuigen-en-personenauto-s/3-resultaten) · [Dutch motorway speed limits](https://www.rijksoverheid.nl/themas/verkeer-en-vervoer/wegen/vraag-en-antwoord/verkeersveiligheid/wat-is-de-maximumsnelheid-voor-auto-s-op-de-snelweg)

## Weather and road traffic

Road drivers slow down, leave more following distance and overtake less readily in rain, fog, frost and snow. They take bends more slowly on wet and icy roads. Cyclists also slow down. Live uses the current Ede weather reading. Custom and Photo scenes use the selected weather and treat winter as −4 °C.

Simulated Rijkswaterstaat salt spreaders with flashing amber beacons appear on nearby motorway lanes around the A12 and A30 at freezing temperatures, in freezing rain or while it snows. The local traffic pool aims for one spreader in frost and up to two in snow, subject to available lanes and room in traffic. [Rijkswaterstaat winter operations](https://www.rijkswaterstaat.nl/wegen/wegbeheer/winter-op-de-weg/strooien-en-zout)

The public Strooikaart reads its current map time from `/map-cache/now.txt` and truck positions from `/map-cache/timedContent/<time>/trucks.json`. The GeoJSON contains longitude, latitude, heading and activity state. A server can derive a local active count by filtering each snapshot by area and activity state. The cache sends no cross-origin access header, so browsers block direct requests from GitHub Pages. Rijkswaterstaat's published response lists no documented API for reuse. Live uses weather to trigger simulated spreaders. [Strooikaart](https://rijkswaterstaatstrooit.nl/) · [Open-data request for active spreaders](https://data.overheid.nl/community/datarequest/rws-actieve-strooiauto-s)

## Tractor and ambulance traffic

Tractors use a rural subset of the road network. Routing checks vehicle clearances, mapped agricultural access, matched NDW closure signs and Gelderland's N304 agricultural vehicle ban. The simulation keeps tractors outside town centres and lets them leave the road at five mapped farm or field entrances. One farm tractor can be active at a time, with a 45-second pause before it can return after leaving the simulation. The NDW counters used for live road traffic group vehicles by length. [NDW traffic counts](https://docs.ndw.nu/en/handleidingen/DEXTER/intensiteiten-en-snelheden/) · [Gelderland traffic restrictions](https://geoportaal.gelderland.nl/gisserver/rest/services/Infra/Infra/MapServer/28)

Ambulances run simulated trips from the Breelaan and Argonstraat bases via fictional pickup stops to the public-road approach to the emergency entrance at Ziekenhuis Gelderse Vallei. They use the regular traffic and signal simulation. [Ambulance service area](https://ambulancezorggm.nl/over-ambulancezorg/werkgebied) · [Hospital access](https://www.geldersevallei.nl/contact/locatie/ede)

## Live emergency dispatches

The live server checks the public Municipality of Ede P2000 feed once per minute. Recent police, ambulance and fire dispatches can trigger a simulated response within a kilometre of the player. The game targets a nearby road using the street name when available and an approximate town centre otherwise. Alerts expire after ten minutes and each accepted alert triggers one response per game session. Vehicle positions, routes and arrival times are simulated. [Ede P2000 feed](https://112-nu.nl/regio/gemeente-ede/alles/0) · [Feed reuse terms](https://112-nu.nl/rss.html)

## Fuel price estimates

Roadside signs show simulated fuel prices rounded to the nearest euro cent. The game combines the latest published Dutch average with regional adjustments. [Fuel price data sources and calculations](../tools/data/ede-fuel-prices.sources.md)

## Frankeneng water levels

The upstream reach and a short stretch of the downstream ditch at the Frankeneng weir follow gauges `WS000610` and `WS000611` in Live mode. The browser checks the waterschap every five minutes while the game is visible. The feed dates the layer as a whole. A failed request, a layer publication older than 45 minutes, or an unusable value restores the affected reach to its bundled level of 6.65 m NAP upstream or 6.25 m NAP downstream. [Waterschap surface-water map](https://storymaps.arcgis.com/stories/bff91946a94c4b7bb22a340c0dc262f0) · [Gauge feature service](https://services1.arcgis.com/ug8NBKcLHVNmdmdt/arcgis/rest/services/1ee052d2-43ba-4c3c-8e80-40bcea8c6405/FeatureServer/0)

The upstream surface uses the existing shoreline. The downstream outline takes the part of active BGT waterdeel `15747567-3938-5819-9832-219e997593e6` within 25 m of its gauge, simplified to 20 cm. The two surfaces stay inside those outlines and use fixed bank faces fitted to the local AHN terrain. The covered link at the weir stays below ground. [BGT waterdeel](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/waterdeel/items/15747567-3938-5819-9832-219e997593e6) · [PDOK weir KST-1106](https://api.pdok.nl/hwh/waterschappen-kunstwerken-imwa/ogc/v2/collections/stuw/items/64bf15fa-ee25-59ee-9c2d-15d510ae0261)

## Weather

Choose **Environment → Live** to use current model estimates for Oude Kerk. The Environment menu shows the source and model update time in Europe/Amsterdam.

The game requests an update about every 15 minutes while visible. The local server shares one cached reading across clients. Static hosting requests the same conditions from Open-Meteo when the server endpoint is absent. A reading is marked stale after 30 minutes. When a reading is unavailable or is more than an hour old, the scene uses the lighting mode’s default weather.

In **Environment → Photo scenes**, choose misty dawn, hoar frost, a rainbow shower, sunbeams, storm light, snow in sunlight, a starry night or northern lights. Each scene has a fixed season, lighting and weather, shown in the summary below the dropdown. **Snow in sunlight** and **Hoar frost** always use Winter. For the rainbow, look away from the Sun. Frost coats exposed paths, grass, trees and heather. Teleport to Ginkelse Heide to see the frost on heather in the Hoar frost scene. Clouds can obscure the procedural stars and the Moon. [Rainbow optics](https://www.nesdis.noaa.gov/about/k-12-education/optical-phenomena/what-causes-rainbow) · [Sunbeams through cloud gaps](https://science.nasa.gov/earth/earth-observatory/crepuscular-rays-and-light-scattering-150090/)

In **Live**, fresh Open-Meteo conditions control the effects near Oude Kerk. Low sunlight can reveal mist and sunbeams, showers can produce a rainbow, cold damp air can leave frost, and thunderstorms darken the sky. Occasional distant lightning is simulated and follows the browser’s reduced-motion preference. The star field fades with twilight, cloud and moonlight. Northern lights use NOAA's short-range OVATION forecast to estimate the direction and strength of aurora around Ede, with visibility reduced by twilight and cloud. The offline Northern lights preset sets a clear night with the display toward the north. These visual effects use modeled conditions as cues. [Bert Temme’s photogenic weather rules](https://x.com/berttemme/status/2125861962961879406/photo/1) · [NOAA aurora forecast](https://www.spaceweather.gov/products/aurora-30-minute-forecast)

Concordiamolen, De Keetmolen and Doesburgermolen use the 10 m reading by Oude Kerk. The Maanderbroek turbines use model wind at the wind farm, interpolated between 80 m and 120 m. The Environment menu shows the town wind and the modeled wind at the 99.5 m hubs when available. Preset weather supplies its own wind. Lighting default and unavailable live readings use a simulated 18 km/h southwesterly breeze.

Concordiamolen has a steady evening wash. The **Winter** season previews De Keetmolen’s Christmas star and parks its sails. Choose **Autumn** with **Blue Hour** or **Night** to preview Doesburgermolen’s event floodlights. Live mode uses the documented 6–7 November 2026 event and repeats De Keetmolen’s observed 12 December–9 January display window each year. [Concordiamolen lighting](https://www.edestad.nl/lokaal/lokaal/69852/concordiamolen-van-wrak-naar-pareltje-443083) · [De Keetmolen’s Christmas star](https://www.keetmolen.nl/nieuws/) · [Doesburgermolen event schedule](https://www.edestad.nl/lokaal/activiteiten/1323373/duik-in-de-geschiedenis-van-molens-tijdens-de-gelderse-molendagen)

The Maanderbroek Siemens SWT-3.2-101 turbines have a 3 m/s cut-in speed and a 25 m/s cut-out speed at hub height. Siemens lists a 6.5–19 RPM operating range. The game approximates the controller’s speed curve within that range. If the wind farm forecast is unavailable, it estimates wind at the hubs from a 10 m reading with the 1/7 power law. Both nacelles flash in sync, white through daylight and twilight and red at night. The simulation approximates the flash cadence and the changeover as the sky darkens. [LVNL obstacle register, entry 453](https://eaip.lvnl.nl/AIRAC%20AMDT%2011-2026_2026_10_29/eAIP/EH-ENR%205.4-en-GB.html) · [Wind farm construction record](https://verwaard-bv.nl/raedthuys-windpark-a30-a12-maanderbroek/) · [Siemens datasheet](https://datasheet.datasheetarchive.com/originals/crawler/siemens.com/d1ee0e9960c2d8b87e5d46af432194c2.pdf) · [Wind shear reference](https://docs.nrel.gov/docs/fy15osti/63696.pdf)

The three historic mills show canvas on their wooden lattices as they turn. At Doesburgermolen, the timber body and access steps turn with the sails above the fixed thatched base. The game shortens the canvas in stronger winds and shows bare lattices in high wind or at rest. The wind thresholds approximate a miller’s sail settings. [Gilde van Molenaars handbook](https://gildevanmolenaars.nl/f/files/download/opleidingen/lesmateriaal/handboek-windmolenaar/hoofdstuk-7-de-praktijk-dl-1-vs-23.pdf)

The Raadhuis flags and the Lukkien windsock trail downwind. The weather vanes at Oude Kerk, Beatrixkerk and the Evangelisch-Lutherse Kerk point into the same town wind used by the historic mills. [Raadhuis photo](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Zienswijze__bezwaar_of_beroep/Jaarverslag_commissie_voor_de_bezwaarschriften_2023.pdf) · [Oude Kerk vane](https://indebuurt.nl/ede/genieten-van/mysteries/mysterie-opgelost-dit-betekenen-die-bol-kruis-en-haan-op-de-toren-van-de-oude-kerk~85582/) · [Beatrixkerk vane](https://www.kerkvaan.nl/115-ede.html) · [Lutherse Kerk vane](https://edesemonumenten.nl/fiets-en-wandelroute/)

Rain and snow drift downwind with the town wind. Stronger winds tilt rain streaks more, and snowflakes drift farther as they fall more slowly. Both effects use one camera-local draw with at most 1,200 particles. The effect is suppressed below mapped tunnel roofs, bridge decks and open sheds. Rain darkens the ground and gives roads and paving a broad wet sheen. Small puddles collect in low spots during rain. The wet sheen dries gradually once the rain ends. Snow builds into a continuous blanket on exposed ground, sports fields, bridge decks, roofs, tree branches and parked cars, with subtle shading for thickness. It stays after snowfall stops in freezing weather and melts faster as the air warms above 0 °C. Water develops ice below 0 °C and thaws above it. Newly frozen water and outdoor rinks start with bare ice. Snow accumulates on ice during snowfall and persists in freezing weather. Colder air freezes water faster. The Winter preset uses −4 °C and takes about a minute to freeze open water. The timestamped live reading and freshness status are available through `window.__slopwaw.weather`.

[Open-Meteo](https://open-meteo.com/en/docs) supplies the weather estimates. [Isometric Warsaw](https://bedirhanyildirim.com/warsaw-izo/) and [Slop Geneva](https://github.com/emmanpi/slop-geneva/blob/HEAD/js/weather.js) are references for the weather controls and camera-local precipitation.

In headless Chrome WebGPU at 960 × 537, two 100-frame passes along the same street-level route had a median frame interval of 16.7 ms with rain hidden and with roughly 1,200 particles visible. The 95th percentile was 16.7 ms with rain hidden and 16.7–16.8 ms with rain visible. Both runs were near the browser’s 60 Hz frame limit.

## Refresh the bus routes

The game loads a local timetable and lane matches for bus services with stops in Gemeente Ede, including both directions of Ede lines 1–4, 103 and 303. Stop signs use the GTFS boarding coordinates and platform letters. Buses display the GTFS trip headsign, and dwell at stops they can reach on connected lanes. Fresh OVapi positions guide the same scheduled actor along its route. Buses approach and leave the camera area at their current route positions. If no service is running at startup, the simulation opens at the next mapped departure.

```sh
curl -fL https://gtfs.ovapi.nl/nl/gtfs-nl.zip -o /tmp/ede-gtfs.zip
python3 tools/import-ede-gtfs.py /tmp/ede-gtfs.zip /tmp/ede-gtfs.json
node tools/export-ede-bus-road-graph.mjs > /tmp/ede-bus-graph.json
node tools/build-ede-bus-routes.mjs /tmp/ede-gtfs.json /tmp/ede-bus-graph.json assets/ede-bus-routes.json /tmp/ede-bus-match-report.json
```

The match report lists gaps by variant, including coordinates and affected boarding points. Matching uses actual graph turns, with separate edges for the mapped busways and selected underpasses. Buses are hidden inside tunnels whose interiors are outside the terrain model. Sections with no reliable connected lane are omitted from the driving simulation.

OVapi feed 9712 includes 184 variants from 29 route IDs. The matcher found playable segments for 167 variants and boarding lanes for 320 of 339 local stop IDs, including stops in Bennekom, Harskamp and De Valk. See the [junction and route audit](../tools/data/ede-junction-route-audit.md) for checks at the station forecourt, Oosttunnel and Stadspoort.

## Mountain bikers

Helmeted mountain bikers follow the signed Ede, Kinderroute Ede, Lunteren and Otterlo loops. They use the corresponding local forest paths and cycle facilities, ride in the signed direction, and reuse the cyclist crossing checks and camera-local pool. The number of riders depends on nearby trail length and time of day, with a cap of five mountain bikers within the existing 96-bike pool. Only mountain-bike NPCs use the signed forest paths and tracks. Public road and cycleway sections of the routes are shared. Trail gaps and shared motor roads without a cycle facility break the simulated route.

The offline data stores directed OpenStreetMap way IDs. The rebuild checks those ways against the bundled map and bicycle access. Run `node tools/build-ede-mtb-routes.mjs` to refresh them. [Trail operator](https://mtbzuidveluwe.nl/routes/) · [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)

## Parking simulation

Parking uses 18,193 fitted spaces in 1,562 areas, in the same horizontal and vertical datum as the street scene. The bake merges mapped bays and estimates row capacity from BGT surfaces, WKD roadside coverage, and OpenStreetMap data. The [parking inventory notes](../tools/data/ede-parking-sources.md) document sources, fit counts, restrictions, clearances, and the rebuild command.

Parkweg and Kuiperplein use local survey anchors. Other streets use Amsterdam time-of-day and weekday profiles. The station P+R has a weekday commuter profile and honours its published closure through 27 November 2026. Each garage has virtual spaces and separate access routes where mapped. The [demand notes](../tools/data/ede-parking-demand.md) explain the source and dwell assumptions.

Parked cars use reusable instance tiles. Departures replace ambient spawns and arrivals divert cars already in the traffic pool. Up to four nearby cars can reserve spaces or manoeuvre at once. Cars yield at the Kuiperplein driveway, and the approach checker rejects curb movements across protected paths without a verified opening.

The local server supplies `/api/ede-parking`. Exact Q-Park readings require authorised NPR credentials in `EDE_NPR_USERNAME` and `EDE_NPR_PASSWORD` on the server. The simulation places cars in the mapped spaces or at garage entrances and exits. Readings expire after three minutes and occupancy eases into the local profile. Parkweg, Kuiperplein and the new station garage use surveyed or inferred occupancy. [NPR data access](https://www.nationaalparkeerregister.nl/downloads/certificaten-en-aanvraagformulieren)

For profiling, append `?parking=off` to the game URL. The debug API `window.__slopwaw.trafficSystem.parking.summary()` reports local capacity, occupancy, source, and completed arrivals and departures by area. The [parking verification report](../tools/data/ede-parking-verification.md) records the fixed-time checks and performance comparison.

### Bicycle parking

The simulation uses PDOK BGT bicycle racks and samples fitted to mapped OpenStreetMap parking areas. It includes Dulon College, Het Streek College, Pallas Athene College, Noordplein at Ede-Wageningen, Ede Centrum, Kuiperplein and the racks at Stationsplein, the south side of Veenendaal-De Klomp and the nearby Stationsweg crossing. The positions represent estimated display capacity. For example, the Noordplein rows model 73 outdoor positions within a facility of 1,600 spaces. [Ede’s bicycle parking programme](https://www.ede.nl/in-de-gemeente-ede/ede-fietst/verbeteren-fietsenstallingen) · [Pallas Athene’s courtyard parking](https://www.pallasathenecollege.nl/dinsdag-6-januari/) · [Noordplein capacity](https://www.spoorzone-ede.nl/nieuws/opening-westtunnel-en-fietsenstalling-station-ede-wageningen)

Occupancy follows Europe/Amsterdam profiles for schools, stations, shops, sports grounds and public racks. Parked bikes use camera-local instances with stable appearances. At Dulon College, Het Streek College, Pallas Athene College and Noordplein, cyclists can finish a cycle-network trip at a vacant space with a checked same-level approach. Departures keep the bike’s style and use a slot in the existing moving cyclist pool. The final walking transfer between the path and the rack happens outside the close view. The other sites show parked bikes according to their occupancy profile. The simulation works offline. Append `?bikeParking=off` to compare, or inspect `window.__slopwaw.trafficSystem.bikeParking.stats` for local rendering and turnover totals.

The full map includes all six White Bike locations at De Hoge Veluwe. Search for **White Bikes** or a specific location on the map. The routes use a 75% White Bike share for new riders on eligible paved paths in the park. That share is a simulation setting. The local clock follows the park’s monthly opening hours. Trips build after opening, with riders heading toward the museum, Sint Hubertus and Marchantplein. Marchantplein attracts more riders around lunch. In the afternoon, riders head back toward the entrances. Simulated White Bike stock shifts from entrance racks toward the highlights, then back toward the entrances. Riders using their own bikes ride through the entrance areas. White Bike routes stay within the mapped park boundary. Schaarsbergen has its own map arrival on the existing terrain. [White Bike locations](https://hogeveluwe.nl/en/plan-your-trip/experience-the-park/cycling) · [Park opening hours](https://hogeveluwe.nl/plan-je-bezoek/openingstijden)

The simulation targets an estimated 8% fatbike share for secondary-school and vocational-school trips and racks, and 4% elsewhere. The 2025 national roadside count found 4% fatbikes overall. RIVM found that 29% of Dutch cyclists aged 12–17 used an e-bike in 2025, and about a quarter of that group used a fatbike. Public bicycle-parking data can supply locations and some capacity or occupancy readings. Ede’s 2022 centre survey counted bicycles together and recorded mopeds separately. The available data leaves the bike-type mix at individual Ede schools and streets unmeasured. [National roadside count, table 5](https://open.overheid.nl/documenten/59161a38-741d-4d9b-98cf-9dc526630b41/file) · [RIVM youth usage](https://www.rivm.nl/nieuws/forse-stijging-van-aantal-jongeren-en-jongvolwassenen-dat-elektrisch-fietst) · [VeiligStallen data](https://ntm.ndw.nu/publicaties/1a4ad51e-8a3d-4d4c-a62a-bc9ecffdce50) · [Ede centre survey](https://open.ede.nl/woo-verzoeken/woo/publicatie/c32e83a0-71c4-46df-a186-bdc1e747213d?cHash=f1112c11c60c2a7ba7ee252f366835e3)

## Passenger trains

NS services follow the Utrecht–Arnhem main line through Ede-Wageningen. RRReis RS34 follows the Valleilijn through Lunteren and Ede Centrum and reverses at Ede-Wageningen. The trains use the same mapped rails, turnouts and elevation profiles as the track renderer. Berth centers are estimated from the mapped platforms. The simulator keeps up to eight nearby trains in a reusable pool and shows the closest train’s number, data status and track when known.

At Lunteren, timetable trains use platform 1 toward Ede-Wageningen and platform 2 toward Amersfoort. The passing loop holds opposing trains before they enter a shared single-track section. The north extension adds 14 ProRail public level crossings and the separately mapped Boslaan footway crossing. Platform and access geometry uses the ProRail Transfer survey. [Northern rail sources and height fitting](../tools/data/ede-north-rail.sources.md)

The server publishes local services at `/api/ede-trains`. NS position reports come from NDOV’s key-free stream. To enable that stream, install `pyzmq` in the server’s Python environment or start with `uv run --with pyzmq python tools/serve-ede.py`. The default GPS prediction window is 32 seconds and can be changed with `data-train-prediction-seconds` in `index.html`. The browser advances each train along the matched track and brakes for the next confirmed stop. After the window, a matched service continues on a timetable estimate aligned with the last predicted position. An unmatched service retires when its prediction expires. [NDOV real-time feeds](https://govi.nu/realtime.html)

OVapi supplies RS34 delays, changes to station times and platforms, skipped stops and cancellations. The server polls every minute. After three minutes, timing switches to a timetable estimate. The server retains dated cancellations through feed gaps. Train status reads **GPS**, **estimated from live updates**, or **timetable**. Service dates follow Europe/Amsterdam, including trips continuing after midnight, regardless of the lighting mode. [OVapi rail updates](https://gtfs.ovapi.nl/nl/)

The bundled timetable contains 2,497 scheduled trips from 21 November 2026 through 11 December 2027. Offline mode and static hosting use that timetable for both operators. Outside the bundled dates, the simulator reuses the closest bundled service pattern for the same weekday. Refresh the local asset from the [OVapi GTFS archive](https://gtfs.ovapi.nl/nl/).

```sh
python3 tools/import-ede-trains.py ./gtfs-nl.zip assets/ede-train-timetable.json
```

The final WebGPU check in headless Chrome at 960 × 537 ran two 100-frame passes with two trains drawn and two passes along the same camera route with train drawing hidden. All four passes measured 16.7 ms at the median and 95th percentile. An earlier pair of runs measured 33.4 ms at the 95th percentile in both conditions. The train update itself measured 0.1 ms at the 95th percentile. These tests used the offline map.
