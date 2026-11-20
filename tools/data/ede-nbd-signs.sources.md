# Ede motorway directional signs

The rebuild used the NBd downloads retrieved on 20 November 2026. The coordinates file reported a 19 November publication. The import concatenates textual `kpnr` and `wwnr` and joins the result to `nummer`, retaining IDs such as `05146006`. `WW.TXT` supplies the original sign-form code. The published drawings supply actual face wording, arrows, route shields and panel layout. The public-domain NBd dataset metadata links directly to the download directory. [NBd public downloads](https://downloads.rijkswaterstaatdata.nl/bewegwijzering/) · [National Road Sign Register metadata](https://data.overheid.nl/en/dataset/43337-nationale-bewegwijzering---052016)

The dated map clip contains **394 NBd locations** and **347 with destination entries**. The first pass reviews 33 of those joins. It renders **32 faces**, 22 on 15 surveyed 1GIS portals and 10 with standalone supports. Of the 347 joined locations, 314 fall outside the pilot review. See the [reviewed approaches, source drawings and mounts](ede-nbd-signs.review.json).

1GIS layer 13 supplies the points and surveyed Z in metres NAP. Layer 31 supplies portal positions and joins to the rendered motorway structures. Road centreline elevations come from the existing grade profiles where available and AHN elsewhere. Provider distance and approach/portal checks use RD New metres. Each reviewed face looks toward drivers on the named directed OSM approach. Where a portal is present, its surveyed horizontal axis sets the turn of the face. The runtime panel keeps at least 4.65 m clearance above the selected road surface. Standalone signs use the surveyed roadside location, the drawing's clearance when available and a lightweight support. Where a drawing omits a dimension, the bake fits a nominal width and the cropped aspect ratio. Mounts and source heights remain traceable by ID in the baked data. [1GIS layer 13](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer/13) · [1GIS layer 31](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer/31)

| Location | Reproducible face | Approach and view |
| --- | --- | --- |
| Maanderbroek | `65137003` at X −4217.84, Z 2165.54 | A12 eastbound `w750476158`. Oberhausen, Arnhem, Ede, A12 and E35. |
| Maanderbroek | `65137018` at X −3832.80, Z 2392.75 | A12 westbound `w493246904`. Den Haag, Utrecht, A12 and E35. |
| Ede-West | `65138005` at X −3821.43, Z 1286.46 | A30 northbound `w6960070`. Exit 1 Ede-West. |
| Ede-Noord | `65141024` at X −3624.74, Z −563.42 and `65141029` at X −3575.32, Z 106.33 | A30 southbound `w6960155` and northbound `w373106553`. Exit 2 Ede-Noord and Renswoude. |
| Ede A12 exit 24 | `05146006` at X 393.60, Z 3730.90 and `05146030` at X −3762.51, Z 2465.23 | Both A12 approach directions. Ede exit countdown boards. |
| Ede A12 exit 24 | `05146072` at X −1369.40, Z 3744.36 | Northbound Dr. Willem Dreeslaan `w25999048`. Four directional panels share one portal. |

`65141013` has two separate detour plates and was withheld pending separate mounts. `65138005` has a 1GIS point height of 25.38 m NAP and a fitted gantry beam at 21.84 m NAP. Its panel fits the beam at 21.98 m NAP and retains the raw point height for review. The pilot excludes other unresolved formats, including two Maanderbroek boards whose 1GIS third-party IDs appear swapped and layouts with separate route plates. The official face can include wording absent from the CSV and resolves abbreviated CSV fragments. Matching found no existing BGT wayfinder or NDW K/L sign within 8 m of a pilot panel. Standard signs and supplementary plates use the existing NDW atlas. [Maanderbroek source drawing](https://downloads.rijkswaterstaatdata.nl/bewegwijzering/65000/65137/65137003S.PNG) · [NDW traffic sign data](https://docs.ndw.nu/en/data-uitwisseling/interface-beschrijvingen/verkeersborden-api/v5/)

Use the bundled 1GIS snapshot or keep the raw layer 13 and 31 ArcGIS JSON cache from the 1GIS detail build. Then fetch and bake the NBd data. Supply the publication date of the CSV snapshot used by the command.

```sh
uv run --with pyproj==3.8.0 --with 'pillow>=12.1' python tools/build-ede-nbd-signs.py \
  /tmp/ede-nbd tools/data/ede-1gis.snapshot.json.gz --date 2026-11-19 --fetch
```

Omit `--fetch` to reuse saved CSVs and drawings. The 244,073-byte PNG contains cropped sign faces. Pure-blue drawing backgrounds use the same traffic blue as the Maanderbroek faces. The 5,515-byte metadata asset contains the panel geometries, UVs, source IDs and review counts. Both files are served locally. The official drawing sheets stay in the offline input cache.
