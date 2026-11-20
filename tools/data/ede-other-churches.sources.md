# Additional church shell bake

The local shell module uses individual 3DBAG CityJSON features retrieved on 2026-11-20. Each landmark references one exact BAG building and the matching fallback OSM way. The bake keeps LoD 2.2 roof and wall rings, the BAG footprint and its holes, and centimetre precision. It converts EPSG:7415 horizontal coordinates with the pinned Oude Kerk frame. Vertex elevations and base heights stay in metres above NAP until the renderer places the model. [3DBAG web services](https://docs.3dbag.nl/en/delivery/webservices/) · [3DBAG CC BY 4.0 attribution](https://docs.3dbag.nl/en/copyright/) · [Oude Kerk GIS frame](ede-gis-v1.md)

Street approaches use the closest mapped ground-level segment on the selected street. For motor roads, the bake places the approach 1.5 m beyond the estimated carriageway edge on the building side. These are street-level viewing and teleport positions. Exterior references provide entrance placement. District labels were checked against CBS's 2025 neighbourhood boundaries. [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) · [PDOK CBS Wijken en Buurten 2025](https://api.pdok.nl/cbs/wijken-en-buurten-2025/ogc/v1/collections?f=html) · [Exterior references](ede-other-churches.md)

## Rebuild

Fetch the listed BAG records into a cache and run the offline converter from the repository root. Keep the dated cache for repeatable rebuilds.

```sh
mkdir -p /tmp/ede-other-churches
rg -o --no-filename "[0-9]{16}" tools/build-ede-other-churches.py |
  sort -u |
  xargs -P 4 -I '{}' curl --fail --silent --show-error --location \
    'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.{}' \
    --output '/tmp/ede-other-churches/{}.json'
uv run --with pyproj==3.8.0 python -B tools/build-ede-other-churches.py /tmp/ede-other-churches
```

All 27 exported footprints were valid. The intersection-over-union against their corresponding map outlines ranged from 0.962 to 0.999. Every approach lay outside the existing map's building footprints, including the two separate small buildings beside Elim and the Schaapsweg church. A second bake from the same cache produced identical bytes.
