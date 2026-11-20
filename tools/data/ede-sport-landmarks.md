# Ede sports venue exteriors

The venue shells use the 20 November 2026 3DBAG LoD 2.2 snapshot. Each retains the surveyed roof and wall faces in the Oude Kerk scene frame. OSM footprint IDs and BAG building IDs identify the generic shells the landmarks replace. The pitches, markings and existing pitch equipment use the existing sports inventory. Building signs are redrawn for the scene. Window, trim and furniture dimensions are approximations. [3DBAG](https://3dbag.nl/en/viewer) · [PDOK address search](https://www.pdok.nl/pdok-viewer) · [PDOK aerial imagery](https://www.pdok.nl/introductie/-/article/pdok-luchtfoto-rgb-open-) · [OSM attribution](https://www.openstreetmap.org/copyright) · [Sports field sources](ede-sports.sources.md)

| Site | Exterior fit |
| --- | --- |
| BSV Moorfielders, Kanonnenpad 4 | The club photo provides the gabled Hustle In entrance, grey palette, blue sign and paved forecourt. The 2026 aerial places the fieldside shelters, backstops and double cage. Shelter and fence heights are estimates. [Club exterior photo](https://go.clubdiensten.nl/clubsdata/0011/img/1562941642_Panoramavisie_Openingswoord_Voorzitter_webversie.jpg) · [Club facilities](https://www.moorfielders.nl/wie-zijn-wij) · [Cage installer](https://www.rassports.nl/featured_item/slagkooi/) |
| Atletiekvereniging Climax, Sportparkweg 20 | The shell, trackside approach and rooftop arrays follow BAG and the 2026 aerial. Entry glazing and the club sign are schematic. [Municipal sports leases](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Bekendmakingen_Didam_arest/240528_publicatie_tekst_gemeentelijke_website_-_Uniciteit_.pdf) |
| VV Ede/Victoria, Sportparkweg 8 | The signed entrance faces the mapped access lane. Glazing and canopy placement are approximations within the surveyed frontage. [Club history](https://www.ede-victoria.nl/246/historie/) · [Municipal sports leases](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Bekendmakingen_Didam_arest/240528_publicatie_tekst_gemeentelijke_website_-_Uniciteit_.pdf) |
| FC Jeugd ’90, Sportparkweg 12 | The pitchside frontage and adjoining building use the surveyed massing, with schematic glazing and the array shown on the 2026 aerial. [Club address](https://www.fcjeugd.nl/2/contact/) |
| DTS ’35, Inschoterweg 2 | The 2023 tournament booklet shows the central mast, suspended boards and circular crests. The club photograph shows the blue and white seats, blue frame, access stairs and curved dugouts. The sign location and pitches use the access apron and structure positions from the 2026 aerial. [Tournament booklet](https://www.dtsede.nl/wp-content/uploads/dtsede/DTS35-Ede-informatie-JO15-1-2023.pdf) · [Club facilities photograph](https://www.dtsede.nl/accommodatie) |
| Sporthal ’t Riet and Dick’s Inn, Laan der Verenigde Naties 84–86 | One BAG shell contains the hall and café. The model distinguishes the hall, the lower curved café frontage and the rooftop solar array. Glazing and sign placement are approximate. [Hall operator](https://sportservicedevallei.nl/locatie/sporthal-t-riet/) · [Café](https://www.dicksinn.nl/) · [RietZon array](https://valleienergie.nl/gerealiseerde-projecten/) |
| Wielervereniging Ede, Horsterweg 5 | The club photo shows the dark timber Finhouse building, white glazing, rail and plaza. The start marking is a schematic cue by the club terrace. [Clubhouse](https://www.wvede.nl/clubhuis) · [Parcours and medal plaza](https://www.wvede.nl/parcours) |

## WVEde paved circuit

The 2016 and 2021 PDOK aerials resolve both paved strips and both hairpins. The 2026 imagery confirms the retained route. The separate permanent ribbon measures 878 m between the two hairpins. The event organizer reports a 1.2 km race lap that also uses Tesqua's existing parking area. This model traces the visible permanent pavement. The documented asphalt and pavers are represented with the existing asphalt and paver materials. The assignment of materials across the wooded stretches is inferred from the club photograph and the visible return strip. [WVEde parcours](https://www.wvede.nl/parcours) · [2026 Ronde van Ede](https://rondevanede.nl/evenement/mkbtr-ronde-van-ede/)

The west crop is RD New (172276, 449502)–(172472, 449596) at 6 px/m. The main crop is (172284, 449410)–(172734, 449573) at 4 px/m. Native 0.5 m AHN DTM supplies a 2 m scene grid along the paved ribbon with a 4 m sample footprint. The refined grid blends into the town terrain beyond the shoulders and uses it where the native DTM has gaps. Native data covers 99.2% of the pavement samples. Both the rendered track and bike ground sampling use this grid. [AHN](https://www.ahn.nl/) · [Terrain source service](https://service.pdok.nl/rws/ahn/wcs/v1_0?SERVICE=WCS&REQUEST=GetCapabilities)

Four older BGT tree points would place trunks within 1.25 m of the traced return centreline. The same trees are placed on the south verge at 2.55 m from the centreline. The fitted scene XZ pairs are (−2026.4, 1366.6) → (−2025.55, 1369.06), (−2023.2, 1364.6) → (−2022.38, 1368.19), (−2018.6, 1365.0) → (−2018.28, 1367.49) and (−2013.2, 1363.6) → (−2013.03, 1367.01).

## Refresh

Use a cache directory outside the checkout. The bakes use the repository’s pinned horizontal GIS transform.

```sh
uv run --with pyproj==3.8.0 python -B tools/build-ede-sport-landmark-survey.py /tmp/ede-sport-landmarks --fetch
uv run --python 3.14 --with pyproj==3.8.0 --with rasterio==1.5.2 python -B \
  tools/build-ede-wvede-circuit.py /tmp/ede-sport-landmarks/wvede-loop-dtm.tif --fetch
```

If a 3DBAG refresh changes face indices, check the entrance windows, signs and roofing against the updated shell before using the new bake.
