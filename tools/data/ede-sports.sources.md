# Ede pitch and court sources

The baked inventory contains 169 outdoor pitch, court and athletics footprints in the playable area. The 20 November 2026 OpenStreetMap API tiles supply 158 footprints. The existing Tesqua survey supplies 11 individual courts across seven surveyed pads and supersedes ten overlapping OSM court outlines. The map stores 48 soccer and 18 basketball entries, with four courts counted in both sports. It includes 32 tennis courts, three Moorfielders diamonds, three field hockey pitches and 19 athletics surfaces. [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) · [Pitch tagging](https://wiki.openstreetmap.org/wiki/Tag:leisure=pitch) · [Tesqua survey](../../js/ede-next-survey.js)

The bake preserves OSM IDs and available sport, surface and lane tags. It clips polygons to the playable boundary and preserves holes in multipolygons. Building footprints and indoor tags exclude enclosed courts. Markings within OSM outlines use sport templates. Their exact painted positions and equipment dimensions can vary on location.

The Moorfielders diamonds use home-plate positions and centre-line directions estimated from the 2026 PDOK aerial image. The smaller western diamond uses the softball template while retaining its source sport tag. The northeastern training diamond shares the baseball template at a reduced size. [PDOK aerial imagery](https://www.pdok.nl/introductie/-/article/pdok-luchtfoto-rgb-open-) · [Moorfielders club](https://www.moorfielders.nl/wie-zijn-wij)

## Refresh

Save this Overpass query as a JSON response with geometry.

```text
[out:json][timeout:60][bbox:52.012,5.5925,52.0605,5.7005];
(
  wr["leisure"~"^(pitch|practice_pitch)$"];
  wr["leisure"="track"]["sport"="athletics"];
);
out geom;
```

Run the bake from the repository root with the acquisition date.

```sh
uv run --with shapely==2.2.0 python -B tools/build-ede-sports.py /tmp/ede-sports.json \
  --date 2026-11-20
```

The same bake accepts an OSM API XML tile set. Request small, adjoining rectangles from the map endpoint until the XML tiles cover the playable bounds. The bake used eighteen cached tiles after larger Overpass requests timed out. [OpenStreetMap API map endpoint](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box)

```sh
uv run --with shapely==2.2.0 python -B tools/build-ede-sports.py /tmp/ede-osm-tiles/*.xml \
  --date 2026-11-20
```
