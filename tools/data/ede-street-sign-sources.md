# Ede sign sources

The checked-in snapshot was retrieved on 19 November 2026 at 00:59 CET. It contains 6,276 placed NDW signs from 18 overlapping-boundary queries across the playable bounds, 225 BGT board records including historical records, and the 2,358 NWB road sections referenced by the NDW signs that could be found in the current NWB extract. The downloader deduplicates by source ID and prefers the latest registration if a feature changes during a refresh. There were zero duplicate NDW IDs in this snapshot. [NDW v5 documentation](https://docs.ndw.nu/data-uitwisseling/interface-beschrijvingen/verkeersborden-api/v5/) · [NDW open-data terms](https://docs.ndw.nu/algemeen/data-gebruiksvoorwaarden/) · [PDOK BGT](https://api.pdok.nl/kadaster/bgt/ogc/v1?f=html) · [PDOK NWB](https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1?f=html)

Each NDW record keeps its RVV code, recorded printed value, mounting, zone status, supplementary plates, conditions and exemptions. `sourceBearing` preserves the NDW compass angle, which follows the road user's viewing direction. `bearing` is the sign's front normal in degrees clockwise from north. For 5,143 signs, the linked NWB road ID still resolves in the downloaded centerline data and provides a nearest line point and offset. The line direction together with NDW's `FORTH` or `BACK` yields `appliesBearing` for 4,533 signs. NWB geometry can predate or postdate the sign's last recorded NWB version. Road attributes unavailable from the sources are absent. [George user guide](https://docs.ndw.nu/handleidingen/George/verkeersborden/#bewerken-plaatsen-verkeersborden) · [NDW API schema](https://wegkenmerken.ndw.nu/api/open-api/api-docs/v5) · [NWB road sections](https://docs.ndw.nu/handleidingen/nwb/nwb-producten/nwb-wegen/)

The BGT Bord collection reported 69 active wayfinder locations in bounds and zero street-name signs. It supplied relative levels for the wayfinders. The available board schema provides neither the wording nor the face direction. BGT OpenbareRuimteLabel locations are points for drawing map labels. [BGT Bord collection](https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/bord) · [BGT data catalogue](https://docs.geostandaarden.nl/imgeo/catalogus/bgt/#openbareruimtelabel)

The atlas covers 5,958 NDW signs with 135 face variants. Face detail follows documented sign designs with locally rendered source values. The snapshot keeps 248 signs that NDW calls `onbekend`, 68 variable lane-information signs whose exact layouts are unavailable, and two A2 signs without a printed value. These 318 records have no atlas face. [Atlas artwork credits](../../assets/ede-street-sign-faces.LICENSE.md)

NDW records distinguish roadside and overhead mounting, with optional external asset references. This Ede snapshot has no populated external references. BGT records boards and supports as separate features. The renderer groups co-located roadside boards on a shared post and can reuse a lamp post or gantry upright within 35 cm when its level, roadside clearance and mounting space agree. The November 2026 browser check found 219 boards on 190 lamp posts and three boards on three gantry uprights. These mounts are inferred from the mapped positions and modeled hardware. [NDW v5 schema](https://docs.ndw.nu/data-uitwisseling/interface-beschrijvingen/verkeersborden-api/v5/) · [BGT board](https://geonovum.github.io/IMGeo-objectenhandboek/bord) · [BGT pole](https://geonovum.github.io/IMGeo-objectenhandboek/paal)

## Refresh and rebuild

Use Python 3.9 or later. The command reads the saved source data when run without `--fetch`.

```sh
python3 tools/build-ede-street-signs.py --output /tmp/ede-street-signs.json
```

Add `--fetch` to refresh the source snapshot from NDW and PDOK. To regenerate face art, obtain the pinned catalogue and the E8c sample before running the atlas builder. The builder works offline once those files and its Python packages are available.

```sh
revision=24d3c1aa0e3dc14ff50cb58916efd82db4cbbd31
art_dir=/tmp/ede-sign-art
mkdir -p "$art_dir"
curl -fsSL "https://codeload.github.com/ndwnu/qgis-verkeersborden-style/zip/$revision" -o "$art_dir/ndw.zip"
unzip -qo "$art_dir/ndw.zip" -d "$art_dir"
catalogue="$art_dir/qgis-verkeersborden-style-$revision/svg_verkeersborden"
curl -fsSL https://zoek.officielebekendmakingen.nl/stb-2022-413-003.png -o "$catalogue/E8c.png"
uv run --with 'Pillow==13.0.0' --with 'CairoSVG==2.9.1' python tools/build-ede-street-sign-faces.py /tmp/ede-street-signs.json "$catalogue"
python3 tools/build-ede-street-signs.py --output /tmp/ede-street-signs.json
```
