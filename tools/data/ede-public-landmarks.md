# Civic landmarks in Ede

The models use exterior roof and wall surfaces from [3DBAG](https://3dbag.nl/en), surveyed as CityJSON LoD 2.2 in EPSG:7415 and retrieved 2026-11-20. Address points come from the [PDOK BAG Locatieserver](https://api.pdok.nl/bzk/locatieserver/search/v3_1). OSM IDs come from the checked-in Ede map snapshot. The bake applies the repository’s pinned RDNAPTRANS2018 transform, the Oude Kerk affine and the 22.54 m NAP scene datum. Roof forms and exterior boundaries use the survey. Glazing, colors and signs are modeled from public exterior photographs.

| Landmark | BAG building, OSM footprint | Exterior evidence and modeled features |
| --- | --- | --- |
| Stadskantoor De Doelen, Raadhuisplein 2 | 0228100000002872, w271606066 | The former Marnix College brick wing, copper-clad addition at Achterdoelen and glazed junction. The adjacent Raadhuis has its own building record (0228100000035709, w271602720). The two separately mapped wings south of De Doelen retain their existing footprints (w271602784 and w271603309). [Gemeente Ede address](https://www.ede.nl/bestuur-en-organisatie/gemeenteraadsverkiezingen-2026/stemlokalen-gemeenteraadsverkiezingen-2026) · [AAARCHITECTEN description and exterior gallery](https://architectenweb.nl/projecten/project.aspx?id=22469) |
| Politiebureau Ede, Breelaan 2 | 0228100000047804, w271573810 | Red-brick street front, dark blue posts, projecting dark canopy and tall divided glazing. The separately mapped former station at Breelaan 2A retains its own footprint (w271574301). [Politie address](https://www.politie.nl/mijn-buurt/politiebureaus/02/politie-ede.html) · [Allard Bijlsma’s current-building photograph](https://edesevos.nl/hoe-actief-reageert-de-politie-in-ede-op-meldingen-van-criminaliteit/) |
| Brandweerkazerne Ede-Centrum, Breelaan 4 | 0228100000057063, w271573850 | Tan masonry vehicle hall, pale yellow sectional doors with dark panes, red-accented wing and red mast above the roof. The mast’s open lattice follows the silhouette in the source photos. [Gemeente Ede project and current address](https://www.ede.nl/in-de-gemeente-ede/ede-in-ontwikkeling/brandweerkazerne-ede) · [VGGM exterior reference](https://cms.vggm.nl/sites/default/files/2021-05/20210120_Agendabundel_AB__Verdeelsleutels_.pdf) · [Dennis Kempers and Ramon Versteeg’s street photographs](https://brandbase.hetbrandweerforum.nl/kazernes/07-27-ede-centrum/) |
| Het Kernhuis, Parkrand 60 | 0228100000077293, w374720963, nested OSM building parts w990432479 and w990432480 | Stepped red-brick volumes with light metal coping, tall paired window stacks, glazed entry and a colored roundel beside the name. [Stichting Het Kernhuis address](https://hetkernhuis.nl/over-ons/contact/) · [Street photograph](https://ede.nieuws.nl/nieuws/het-kernhuis-staat-voor-ontmoeting-ontplooiing-en-verbinding) |

The [2025 PDOK orthophoto](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0) aligns the photographed elevations with the survey. Sign artwork and exact glass and trim colors are approximations. The meshes contain public exterior detail and solid footprint collision.

Rebuild against cached CityJSON responses with the pinned GIS environment. Add `--fetch` to obtain a current survey, and refit the face-indexed details if the geometry changes.

```sh
uv run --python 3.12 --with pyproj==3.8.0 python tools/build-ede-public-survey.py /path/to/cache
```

© 3DBAG by tudelft3d and 3DGI. The scene adapts the source data through reprojection, filtering to exterior wall and roof surfaces, and hand-modeled façade detail. [3DBAG CC BY 4.0 terms](https://docs.3dbag.nl/en/copyright/)
