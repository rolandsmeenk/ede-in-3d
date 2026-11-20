# NIZO and Ziekenhuis Gelderse Vallei landmark sources

## Shared survey

The building shells use the 3DBAG LoD 2.2 solid roofs and walls, with holes and original face indices preserved. The bake reads the declared Dutch compound coordinate reference system (EPSG:7415), uses RD New for the horizontal coordinates, and exports through `tools/ede_gis.py` to the existing Oude Kerk scene. NAP heights are handled separately with the AHN origin of 22.54 m. Position precision in the output is 1 cm. The 12 m runtime DTM supplies pavement and threshold height. Narrow skirts cover local gaps between the surveyed building bases and the terrain. The published roof shapes and heights stay intact. © 3DBAG by tudelft3d and 3DGI, adapted under CC BY 4.0. [3DBAG API](https://docs.3dbag.nl/en/delivery/webservices/) · [3DBAG attribution and licence](https://docs.3dbag.nl/en/copyright/) · [AHN](https://www.ahn.nl/dataroom) · [PDOK aerial photo WMS](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0)

Fetch or refresh the CityJSONFeature files into an offline cache and bake the numbered shells.

```sh
uv run --no-project --with pyproj==3.8.0 python tools/build-ede-research-survey.py /path/to/research-survey-cache --fetch
```

Review the numbered wall assignments against the source photos when updating the 3DBAG release, as the solid can be reported with a different face order. The reference photos remain in the offline cache. The blue-grey, brick and buff tones with different gloss values are authored vertex materials. The lettering uses separate small local canvases.

## NIZO Food Research

- Matched the original research building and four connected pilot volumes to the 2026 PDOK orthophoto and the campus layout. Original means the prominent 1950s research building in its current visible form. The pilot roofs, heights and spacing come from the survey. The original wings' windows, entrance steps and raised canopy have fitted dimensions. The built-condition campus aerial published 5 February 2026 corroborates the dark rooflines and extended shades. The 14 April 2019 photographs and 29 January 2022 panorama inform the original entrance and window rhythm. [Operator address and pilot plant](https://www.nizo.com/contact-us/) · [Atlas van Ede exterior references](https://www.atlasvanede.nl/mooi-ede/gebouwen/architectuur/architectuur-1945-1965) · [ROOTS campus aerial and photos](https://rootshub.nl/en/our-location/nizo/)
- Exact replacements are BAG `0228100000013349`, `0228100000031240`, `0228100000033892`, `0228100000036731`, `0228100000070061` and OSM ways `271586838`, `271586774`, `271588010`, `271588469`, `271586695`. The standalone auxiliary building and surrounding site objects retain their existing geometry. The June 2026 redevelopment announcement describes future work. [Development announcement](https://www.nizo.com/news/collaboration-schipperbosch-nizofoodresearch/)
- The spiral stair and the two painted wall sections sit on the courtyard side of pilot building F. The stair rise, radius, treads and handrail are fitted from a single oblique photograph. The separate mural tile contains visible paint from the 743 × 476 photograph published 29 January 2026. The photo's capture date and artist remain unverified. Branches and the area occupied by the stair are masked. [Photograph and publication metadata](https://rootshub.nl/wp-json/wp/v2/media/1311) · [Mural placement and credits](ede-murals-structures.json)

```sh
uv run --no-project --with pillow python tools/build-ede-nizo-mural.py /path/to/roots-original.jpg
node tools/build-ede-murals.mjs
```

## Ziekenhuis Gelderse Vallei

- BAG `0228100000006511` matches the connected OSM hospital building relation `13089665`. The east public forecourt, glazed public entrance and adjacent newer wings were checked against the operator's 2025 anniversary building aerial, operator site plan and consulting engineer's extension photographs. The independent parking garage and surrounding buildings retain their existing geometry. [Hospital aerial](https://www.geldersevallei.nl/over-zgv/25-jaar-ziekenhuis-gelderse-vallei/het-gebouw) · [Hospital site plan](https://www.geldersevallei.nl/contact/locatie/ede) · [Entrance extension photographs](https://www.aronsohn.nl/project/uitbreiding-ziekenhuis-gelderse-vallei/)
- The west emergency entrance follows the mapped access ending at the ambulance area. The awning, glazing subdivisions and sign proportions are fitted. Most secondary façades use simplified window bands for the visible floor rhythm. The original graph and parking layout still provide the forecourt and emergency approaches. [Emergency visitor information](https://www.huisartsengeldersevallei.nl/assets/uploads/HAP/Folders/Folder_Huisartsenspoedpost-Gelderse-Vallei_new-v4.0.pdf)

## Reproducible views

These Chrome WebGPU views use scene X/Z and camera heights above local terrain.

| View | Camera X, height, Z | Target X, height, Z |
| --- | --- | --- |
| NIZO entrance | −625, 1.67, −650 | −620, 4.60, −668 |
| NIZO mural and outer stair | −649, 1.67, −781 | −657, 5.10, −794 |
| NIZO from above | −552, 75, −642 | −646, 7, −737 |
| Hospital main entrance | −1727, 1.67, 2648 | −1759, 4.40, 2644 |
| Hospital emergency entrance | −1871, 1.67, 2608 | −1845, 3, 2607 |
| Hospital from above | −1580, 86, 2700 | −1782, 10, 2620 |

The streamed campus shells give way to the custom geometry at both sites. The ground-level views show contact along the approaches. The mast and separate paint panels fit within the NIZO stair recess and adjacent walls. The hospital forecourt and ambulance access remain visible between the fitted wings. Both campus shells use one base material batch each, with the window framing, signage and spiral detail culled at range. The stair is exterior scenery. The mural's 38 kB WebP occupies an estimated 1 MiB when resident, including mipmaps.

Walking checks covered about 10 m at the research entrance, 8 m at the hospital public entrance, and 12 m on the ambulance approach. NIZO's two modeled entrance steps also register as raised walk surfaces, with a matching obstacle at the exterior door.
