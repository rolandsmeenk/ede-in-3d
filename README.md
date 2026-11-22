# Ede in 3D

Explore Ede, the Netherlands, in a 3D browser game built around its real streets, landscapes and landmarks. Wander from Oude Kerk to Marktplein, cycle out to Huis Kernhem, watch the Valleilijn trains at Lunteren, or fly a helicopter over the ENKA factory.

**[Play Ede in 3D](https://rolandsmeenk.github.io/ede-in-3d/)**

![Oude Kerk rising above the rooftops of Ede town centre](assets/screenshots/oude-kerk.webp)

## Find your way around Ede

- **Walk the town centre.** Explore the shops and squares around Grotestraat, see Cultura and Raadhuis Ede, and look for street art at Astrant and the Van Eekelenflat.
- **Cycle or drive across town.** Follow mapped cycle routes, pass buses on local streets, and watch the trains at Ede-Wageningen, Ede Centrum and Lunteren.
- **Jump to a major area or find a landmark.** Use **Teleport** for areas such as Centrum, ENKA, Ginkelse Heide and Lunteren. Open **Map** and search for an individual landmark, such as De Eder Kuil, Groot Zonneoord or De Valenberg, then click its pin to teleport.

## Ede by the numbers

| Feature | Count or coverage |
| --- | ---: |
| Playable area inside Gemeente Ede | 179 km² |
| Teleport menu areas | 14 |
| Custom landmark models | 252 |
| Mapped building footprints | 60,950 |
| Street litter bins | 663 |
| Waste collection sites | 438 |
| Mapped playground outlines | 144 |
| Municipal play-site locations | 254 |
| Playgrounds with surveyed equipment | 2 |
| Outdoor sports pitches, courts and tracks | 262 |
| Timetable bus-stop records | 248 |
| Rendered bus-stop signs | 218 |
| Bus stops with generated boarding areas | 109 |
| Bus shelters | 62 |
| Mapped traffic-light locations | 293 |
| Lamp posts | 18,300 |
| Mapped tree records in the default inventory | 104,141 |
| Mapped roads and paths | 2,305 km |
| Mapped railway tracks | 38 km |
| Modeled parking spaces | 18,193 |

Counts come from the bundled map, placement assets and landmark registry. The landmark total includes 248 registered sites, Ede-Wageningen station, the Sherman Tank monument and the two Chico and Chica sculptures. The tree inventory counts imported trunks before clearance checks and procedural woodland. Municipal play-site points can overlap mapped playground outlines. Each traffic-light location is a mapped signal point, and each waste collection site counts as one placement even if it serves several waste streams. Lengths sum the mapped ways, including separate carriageways and parallel tracks. [Municipal coverage and sources](docs/map-and-assets.md#municipal-coverage)

Bus-stop signs combine timetable records that share a boarding point. The shelter count includes 61 generated shelters and one surveyed model. [Bus-stop models and sources](docs/map-and-assets.md#bus-stop-design-references)

### Outdoor sports areas by type

The expanded map adds 93 outdoor sports areas. Across the full map, 147 areas get sport-specific layouts and 115 show the playing surface only.

| Sport or use | Mapped areas | Sport or use | Mapped areas |
| --- | ---: | --- | ---: |
| Equestrian | 89 | Baseball and softball | 3 |
| Football | 61 | Field hockey | 3 |
| Tennis | 45 | Padel | 3 |
| Basketball | 22 | Korfball | 2 |
| Athletics | 19 | Pickleball | 2 |
| Table tennis | 5 | Boules | 1 |
| Multi-sport | 4 | Ice skating | 1 |
| Skateboarding | 4 | Unspecified | 2 |

Four courts count toward both football and basketball. [Bundled sports inventory](assets/ede-sports.json)

## Screenshots

| ENKA Westhal and Poortgebouw | Station Ede-Wageningen | Huis Kernhem |
| --- | --- | --- |
| ![Sawtooth factory roofs and twin chimneys at ENKA](assets/screenshots/enka-westhal.webp) | ![Railway tracks beneath the timber canopy at Ede-Wageningen](assets/screenshots/ede-wageningen.webp) | ![Tree-lined approach to Huis Kernhem](assets/screenshots/huis-kernhem.webp) |

| Kasteel Hoekelum | De Eder Kuil | Lukkien’s rooftop helideck |
| --- | --- | --- |
| ![Bridge across the moat in front of Kasteel Hoekelum](assets/screenshots/kasteel-hoekelum.webp) | ![Curved seating and the covered stage at De Eder Kuil](assets/screenshots/de-eder-kuil.webp) | ![Marked rooftop helideck on the Lukkien studio complex](assets/screenshots/lukkien-helideck.webp) |

| Noorderkerk | Astrant mural | NIZO Food Research |
| --- | --- | --- |
| ![Noorderkerk with its centered stained-glass window beneath a symmetrical gable and its brick tower extending to ground level](assets/screenshots/noorderkerk.webp) | ![Studio Giftig’s Muzikanten mural across Kuiperplein](assets/screenshots/astrant-mural.webp) | ![Brick and glass frontage at NIZO Food Research](assets/screenshots/nizo.webp) |

[Browse the landmark screenshot gallery](docs/landmarks.md).

[See the in-game prop gallery](docs/map-and-assets.md#in-game-prop-gallery) for road signs, traffic lights, sports grounds, fuel stations, bins, and transformer houses.

## See Ede in a different light

Open **Environment** and choose **Live** to follow Ede’s local clock, seasons, weather and Frankeneng water levels. In **Preset**, set the time of day, season and weather yourself. Try a windy autumn rain, a snowy winter night or summer on the purple heath. [Environment and data sources](docs/simulation.md#environment)

## Documentation

- [Run locally or host the game](docs/running.md) including what works live on GitHub Pages, feed-server requirements, and profiling.
- [How the simulation works](docs/simulation.md) including weather, road traffic, bus and train timetables, and parking.
- [Map sources and asset builds](docs/map-and-assets.md) including rebuild commands, landmark references, and data attribution.

## Make it your own

Fork it, remix it, or use it to make a game, animation, film or experiment. Explore other cities in [Slop Cities](https://github.com/zz85/slop-cities).

Ede in 3D is forked from [Slop Utrecht](https://github.com/bertt/slop-utrecht), based on [Slop New York](https://github.com/mrdoob/slop-newyork). The code is available under the [MIT License](LICENSE). See [License and data](docs/map-and-assets.md#license-and-data) for map and imagery credits.
