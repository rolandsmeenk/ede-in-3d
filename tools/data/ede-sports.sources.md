# Ede pitch and court sources

The baked inventory contains 169 outdoor pitch, court and athletics footprints in the playable area. The 20 November 2026 OpenStreetMap API tiles supply 158 footprints. The existing Tesqua survey supplies 11 individual courts across seven surveyed pads and supersedes ten overlapping OSM court outlines. The map stores 48 soccer and 18 basketball entries, with four courts counted in both sports. It includes 32 tennis courts, three Moorfielders diamonds, three field hockey pitches and 19 athletics surfaces. [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) · [Pitch tagging](https://wiki.openstreetmap.org/wiki/Tag:leisure=pitch) · [Tesqua survey](../../js/ede-next-survey.js)

The bake preserves OSM IDs and available sport, surface and lane tags. It clips polygons to the playable boundary and preserves holes in multipolygons. Building footprints and indoor tags exclude enclosed courts. Markings within OSM outlines use sport templates. Their exact painted positions and equipment dimensions can vary on location.

The Moorfielders diamonds use home-plate positions and centre-line directions estimated from the 2026 PDOK aerial image. The smaller western diamond uses the softball template while retaining its source sport tag. The northeastern training diamond shares the baseball template at a reduced size. [PDOK aerial imagery](https://www.pdok.nl/introductie/-/article/pdok-luchtfoto-rgb-open-) · [Moorfielders club](https://www.moorfielders.nl/wie-zijn-wij)

## Football home kits

The home kits use published club colors and simplified shirt patterns. Pitch assignments use the municipal venue list, the mapped footprints and the club site plans. Ede/Victoria and FC Jeugd rotate on shared fields at Hoekelumse Eng. [Municipal sports leases](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Bekendmakingen_Didam_arest/240528_publicatie_tekst_gemeentelijke_website_-_Uniciteit_.pdf) · [Inschoten field plan](https://www.dtsede.nl/wp-content/uploads/dtsede/DTS35-Ede-informatie-JO15-1-2023.pdf) · [Hoekelumse Eng field plan](https://www.edestadschoolvoetbaltoernooi.nl/inhoud2026/pdf/ProgrammaboekjeFinale17april2026.pdf)

- DTS '35 Ede, Blauw Geel '55 and VV Bennekom. [DTS club details](https://www.dtsede.nl/contact) · [Blauw Geel kit](https://www.blauwgeel55.nl/1/1292/sponsoren-steken-blauw-geel-55-in-het-nieuw/) · [VV Bennekom team photos](https://website.storage/Data/Bennekom/RTE/Bestanden/NieuwsItem/2168/VVB_Presentatiegids_250915lr_spreads_1.pdf)
- KSV Fortissimo, Ede/Victoria and FC Jeugd. [Fortissimo club newsletter](https://website.storage/Data/Fortissimo/RTE/Bestanden/NieuwsItem/258/nieuwsbrief_Fortissimo_13-05-2025.pdf) · [Ede/Victoria club history](https://www.ede-victoria.nl/246/historie/) · [FC Jeugd opponent guide](https://website.storage/Data/Vriendens/RTE/Bestanden/NieuwsItem/4695/TEGENSTANDERS_EERSTE_ELFTAL_SEIZOEN_2016-17.pdf)
- VV Lunteren, Advendo '57, SDS '55, SV Otterlo and SV Harskamp. [Lunteren club regulations](https://website.storage/Data/Lunteren/RTE/Bestanden/Algemeen/Beleid/Verenigingsplan_V__V__Lunteren2016.pdf) · [Advendo club guide](https://www.slideshare.net/slideshow/advendo-57-presentatiegids-2017-2018-118687178/118687178) · [SDS kit requirements](https://www.sds55.nl/wp-content/uploads/2023/09/Mutatieformulier-voetbal-2023-2024.pdf) · [SV Otterlo club supplier](https://sportted.nl/onze-clubs/sv-otterlo/) · [SV Harskamp club supplier](https://sportted.nl/onze-clubs/sv-harskamp/)

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
