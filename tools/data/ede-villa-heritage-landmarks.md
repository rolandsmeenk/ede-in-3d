# Oranjestaete and Villa Sterrenberg

Oranjestaete occupies Oude Bennekomseweg 11–79, [OSM way 271377156](https://www.openstreetmap.org/way/271377156) and [BAG building 0228100000020191](https://bag.basisregistraties.overheid.nl/bag/id/pand/0228100000020191). Allard Bijlsma's 27 August 2026 photographs show the curved, stepped south side, silver-grey fascia, smoke-brown rail panels with thin yellow rails, sloped brick partitions and dark penthouse cladding. The terraces and glazing are modelled from the photos and survey elevations. [Atlas van Ede exterior photographs](https://www.atlasvanede.nl/mooi-ede/gebouwen/appartementen/1981-1995/oranjestaete)

Villa Sterrenberg occupies Bergstraat 2, 2A and 2B, [OSM way 271603284](https://www.openstreetmap.org/way/271603284) and [BAG building 0228100000020466](https://bag.basisregistraties.overheid.nl/bag/id/pand/0228100000020466). The façade facing the public path is based on Bijlsma's 2025 photograph. It has five bays with tall divided sashes, cream casings, lined corner quoins, dark eaves, and the name over the central double door with its tall transom. The annex remains part of the surveyed shell. [Atlas van Ede exterior photographs](https://www.atlasvanede.nl/ede-toen/historische-plekken/historische-gebouwen/huis-sterrenberg)

The walls, roofs and collision footprints derive from 3DBAG LoD 2.2 under CC BY 4.0. The exterior photographs inform hand-authored details. [3DBAG attribution](https://docs.3dbag.nl/en/copyright/)

```sh
uv run --python 3.12 --with pyproj==3.8.0 python -B tools/build-ede-villa-heritage-survey.py /tmp/ede-villas --fetch
```
