# Façades along Ede’s east–west railway

The survey follows the Utrecht–Arnhem line across the playable boundary and through Ede-Wageningen. It samples three modeled through alignments every 12 m and uses a viewpoint 2.2 m above each fitted railhead. Sightlines to walls within 100 m account for AHN ground, other buildings and mapped solid barriers. Seasonal foliage and temporary obstacles can hide walls in the game. The separate Valleilijn is outside this survey. [3DBAG archive](https://data.3dbag.nl/) · [PDOK BAG](https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand) · [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)

The façade layer supplies 3,553 wall layouts across 575 BAG buildings and 2,167 edge assignments across 625 OSM footprints. The two inventories overlap. The bake preserves the authored buildings, including the five rail-side replacements below. The base, A12 and A30 indexes stay in use. The railway data adds 28 streamed tiles totaling 152,743 bytes plus 29,463 bytes for the OSM fallback. The BAG attributes come from the PDOK snapshot dated 20 November 2026.

| Reference site from the original façade survey | Rail-facing detail |
| --- | --- |
| Akulaan H2 and H4 | Pale masonry, horizontal glass gallery screens and slab bands. The layout uses the architect’s completed-project photographs and north gallery references. [MIX architectuur](https://www.mix-architectuur.nl/werk/ede-enka/) |
| Parkveste | Warm masonry, tall glazing, regular bays and selected shallow recesses fitting the stepped shell. Balcony depths and railings are approximated. [Facade supplier photos](https://www.rockpanel.com/nl/inspiratie/appartementencomplex-parkveste-ede/) · [Architect](https://zaakvannn.nl/ede-parkweg-noord/) |
| De Blokken | Warm red brick and aligned two-storey openings with pale trim. [Coare Architectuur](https://www.coarearchitectuur.nl/projecten/woningen-park-blokken/) |
| Ernst Casimirlaan | A shared three-storey opening rhythm across four apartment blocks. Opening measurements are approximate. [Atlas van Ede, February 2023 rail-side view](https://www.atlasvanede.nl/thema-s/stadsontwikkeling/verleden-1900-nu/1960-1980/flats-ede-zuid) |

## Custom rail-side exteriors

All five sites appear in map search. Fallback meshes are replaced by their OSM IDs and streamed building meshes by their BAG IDs. The original terrain stays in the Oude Kerk scene frame. Window sizes, trim and exterior fittings use fitted dimensions from the references.

| Site | Replacement and fit |
| --- | --- |
| Ulu Camii | BAG `0228100000078834` and OSM `w403848575`. LoD 2.2 anchors the two rotated wings and the open entrance court. The 2026 orthophoto locates the steel-ribbed glass dome and the 25 m minaret. The pattern and glazing tint are approximations. [Coare Architectuur](https://www.coarearchitectuur.nl/projecten/turkse-moskee/) · [Braat dome reference](https://braatglasconstructies.nl/projecten/moskee-ede/) |
| Kop van de Parkweg | BAG `0228100000084730` and OSM `w1056707753`. AHN6 places the main three roof levels at about 32.7, 35.75 and 38.75 m NAP. The model follows the stepped roof terraces, darker brick, rail-side balconies and entrance bays. Balcony and glazing details are fitted from the published views. [Architect’s elevation](https://zaakvannn.nl/zaakvannn.nl/ede-kop-van-de-parkweg/) · [Completed building photos](https://www.atlasvanede.nl/mooi-ede/gebouwen/appartementen/2021-2025/op-de-kop) |
| ’t Hartogshof | BAG `0228100000088255` and OSM `w1332609140`. The BAG envelope, 2026 aerial imagery and dated photos define individual wings, stepped corners, the open court, loggias and the raised garden. The available AHN capture predates completion, so floor and roof heights for this site use photo and storey estimates. [MIX architectuur](https://www.mix-architectuur.nl/werk/ede-enka-hartogshof/) · [Atlas van Ede station walk](https://www.atlasvanede.nl/verken-ede/short-walks/ede-wageningen-1/rondje-station-46) |
| Akulaan H2/H4 | BAG `0228100000086250` and `0228100000086249`, OSM `w972654587` and `w972654586`. The two surveyed shells preserve the roof breaks and spacing between blocks. Recessed galleries use diffuse glazing, with separate entrances and brick bays. The garage apron extends beyond the above-ground shell, so the solid survey rings govern collision there. [MIX architectuur](https://www.mix-architectuur.nl/werk/ede-enka/) |
| Parkveste | BAG `0228100000082617` and OSM `w684424226`. The 3DBAG shell maintains the stepped roof and triangular plan. The model adds balcony recesses, timber-tone reveals, tall windows and simplified patterned railings. [Architect](https://zaakvannn.nl/ede-parkweg-noord/) · [Material and completion photos](https://www.rockpanel.com/nl/inspiratie/appartementencomplex-parkveste-ede/) |

The Ernst Casimirlaan flats retain their shared façade layout. One reusable balcony and gallery model could serve all four blocks in a later pass.

## Original façade layer verification

Before the custom exteriors were added, paired fixed-camera views used Chrome WebGPU at 1200 × 720 with winter vegetation, midday lighting, shadows disabled and traffic paused. Each sample used 60 frames after the scene settled. The two configurations used the same local 3DBAG cache and camera positions. The comparison used a targeted preview startup that skipped whole-town shader warmup.

| View | Frame time p95 before → after | Median draw calls before → after |
| --- | ---: | ---: |
| De Blokken | 18.6 → 18.9 ms | 797 → 797 |
| Ernst Casimirlaan | 28.1 → 26.7 ms | 1,245 → 1,249 |
| Parkveste | 18.5 → 18.5 ms | 791 → 791 |
| Akulaan | 18.5 → 18.3 ms | 695 → 697 |

The largest sampled increase in resident façade masks was 0.70 MB at Ernst Casimirlaan. An earlier updated run at that site measured 36.0 ms p95. The repeated check gives a fixed-view comparison and leaves continuous-route performance with traffic and shadows enabled unverified. All 28 rail tiles reproduced byte for byte. The fallback assignments match the original directed footprint edges.

## Custom exterior verification

All five Teleport menu entries landed at their intended ground positions in the game. I checked approach and aerial views, exact replacement IDs, and the passage into the Ulu Camii court. The Hartogshof stair check sampled 624 positions across the approach, with a maximum fitted step of 0.174 m.

The paired Chrome WebGPU preview used the Fast preset with shadows disabled, fixed midday lighting, paused traffic and a 1200 × 720 viewport. Each row covers 60 frames after the camera settled. The preview starts at a targeted view, so its startup skips the usual whole-town shader warmup.

| Site | Frame time p95 before → after | Median draw calls before → after |
| --- | ---: | ---: |
| Ulu Camii | 18.9 → 19.4 ms | 1,330 → 1,337 |
| Kop van de Parkweg | 18.4 → 17.9 ms | 760 → 763 |
| ’t Hartogshof | 18.4 → 18.1 ms | 606 → 609 |
| Akulaan H2/H4 | 18.1 → 18.1 ms | 771 → 774 |
| Parkveste | 19.4 → 19.0 ms | 1,181 → 1,184 |

## Refresh

Reuse the dated BAG attribute snapshot and the 3DBAG archive cache. Omit `--fetch` once the cache has the required tiles. Regenerate the surveyed Parkveste and Akulaan shells from the same cache with `uv run --python 3.12 --with pyproj==3.8.0 python -B tools/build-ede-rail-apartment-survey.py /tmp/ede-rail-visibility`.

```sh
uv run --python 3.12 --with 'shapely>=2.1' --with pyproj==3.8.0 --with flatgeobuf --with numpy \
  python -B tools/build-ede-a12-visibility.py /tmp/ede-rail-visibility /tmp/ede-rail-walls.json.gz \
  --rail --date 2026-11-21 --fetch
python3 -B tools/build-ede-a12-facades.py /tmp/ede-rail-walls.json.gz \
  tools/data/ede-rail-pand-2026-11-21.json.gz --rail --report /tmp/ede-rail-facades-report.json
```
