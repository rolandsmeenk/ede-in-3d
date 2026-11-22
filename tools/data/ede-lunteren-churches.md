# Lunteren church exteriors

These five sites supplement the separately surveyed Oude Kerk Lunteren. The village directory lists six congregations with distinct buildings. Museum Lunteren’s 2018 exhibition also included Sint Antonius Abt. The parish ceased services there in 2019 and the municipality adopted a residential plan for its Kerkhoflaan site in 2022. The congregations’ current addresses resolve two differences in older records. Maranathakerk is at Hertenlaan 37, and the Protestantse Gemeente Lunteren Oranjestraat uses Oranjestraat 33. The Bethelkerk at De Haverkamp replaces the former building on Schaepmanstraat. [Lunteren church directory](https://www.lunteren.com/maatschappelijk/kerken/) · [Museum Lunteren exhibition](https://museumlunteren.nl/2018/09/18/religie-in-lunteren-door-de-eeuwen-heen/) · [Municipal residential plan](https://zoek.officielebekendmakingen.nl/gmb-2022-434595.html) · [Museum record for the former Bethelkerk](https://www.collectiegelderland.nl/historischmuseumede/object/1d3c0017-156f-a497-8955-021cecfaa800)

| Site | Current address | BAG building | OSM outline | Exterior reference |
| --- | --- | --- | --- | --- |
| Bethelkerk Lunteren | De Haverkamp 1 | 0228100000079981 | [509492266](https://www.openstreetmap.org/way/509492266) | [Congregation](https://www.hhglunteren.nl/bethelkerk) · [Builder’s photographs](https://www.bouwbedrijfnap.nl/portfolio/nieuwbouw-kerkgebouw-te-lunteren/24/) |
| Maranathakerk Lunteren | Hertenlaan 37 | 0228100000054252 | [271717893](https://www.openstreetmap.org/way/271717893) | [Congregation](https://maranathakerk.net/contactgegevens/) · [Service stream exterior photograph](https://kerkdienstgemist.nl/stations/349-Maranathakerk-Lunteren) |
| Protestantse Gemeente Lunteren Oranjestraat | Oranjestraat 33 | 0228100000053639 | [271717265](https://www.openstreetmap.org/way/271717265) | [Congregation](https://pglunteren.nl/) · [Service stream exterior photograph](https://kerkdienstgemist.nl/stations/599/events/live) |
| Het Witte Kerkje | Dokter Kimmijserlaan 28 | 0228100000055059 | [271724140](https://www.openstreetmap.org/way/271724140) | [Congregation](https://www.vrijzinniglunteren.nl/wie-zijn-wij/) · [Clock close-up](https://www.uitagenda.nl/locaties/het-witte-kerkje) |
| Molukse Evangelische Kerk Lunteren | Van Limburg Stirumstraat 25 | 0228100000010672 | [271849707](https://www.openstreetmap.org/way/271849707) | [Provincie Gelderland exterior photograph](https://www.gelderland.nl/nieuws/bezoek-ans-mol-molukse-kerk) |

The source bake uses the 3DBAG LoD 2.2 roof and wall rings and the exact BAG footprint from the individual 3DBAG responses retrieved 22 November 2026. Each footprint overlaps its northern map outline with an intersection over union between 0.970 and 0.998. Arrivals use ground-level sidewalks and paths with a clear view of the facade from the approach street. [PDOK location server](https://www.pdok.nl/restful-api/-/article/pdok-locatieserver-1) · [3DBAG API](https://docs.3dbag.nl/en/delivery/webservices/) · [3DBAG attribution](https://docs.3dbag.nl/en/copyright/) · [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)

The authored details approximate materials and trim from exterior photos. They restore the twin bells and opening on the Maranathakerk tower and the painted gable belfry of Het Witte Kerkje. Windows, doors and trim use the existing church façade builder and render within 175 metres. The two visible belfries remain in the distant silhouette. The photos are dimensional and visual references, and the game does not include copies of them.

Rebuild from the dated source cache. If using newer 3DBAG responses, check the facade face indices against the new rings.

```sh
mkdir -p /tmp/ede-lunteren-churches
rg -o --no-filename '[0-9]{16}' tools/build-ede-lunteren-churches.py |
  xargs -P 4 -I '{}' curl --fail --silent --show-error --location \
    'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.{}' \
    --output '/tmp/ede-lunteren-churches/{}.json'
uv run --with pyproj==3.8.0 python -B tools/build-ede-lunteren-churches.py /tmp/ede-lunteren-churches
```
