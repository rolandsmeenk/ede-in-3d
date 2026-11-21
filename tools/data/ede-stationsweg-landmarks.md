# Stationsweg landmarks

The eight sites use thirteen surveyed BAG buildings. The bake reads 3DBAG LoD 2.2 in RD New and NAP (EPSG:7415) and uses the existing Oude Kerk scene frame. The registry replaces the matching BAG and OSM buildings by ID. Each site batches the survey shell and the nearby exterior details. The exterior photos informed painted materials and modeled details. [3DBAG attribution and licence](https://docs.3dbag.nl/en/copyright/) · [Exact survey registry](../../js/ede-stationsweg-survey.js)

| Site | Exterior details and references |
| --- | --- |
| Stationsweg 27, 31, 33 and 35 | By Honck has a street bay and balcony. Regina, Sonnevanck and Zuiderhoek each have their own gable treatments, window divisions and stained transoms. [Vereniging Edese Monumenten](https://edesemonumenten.nl/fiets-en-wandelroute/) · [Atlas van Ede street photos](https://www.atlasvanede.nl/mooi-ede/gebouwen/architectuur/architectuur-aan-de-stationsweg) · [Museum photograph](https://www.collectiegelderland.nl/historischmuseumede/object/87cf7022-4d76-712e-e9cd-7555b5b1dbcf) |
| Moeke, Breelaan 2A | Stone entrance, cream muntins and cornices, four front dormers and the courtyard terrace with seating, umbrellas and steel stair. The exterior uses generic restaurant signage. [Former police station](https://www.atlasvanede.nl/toen-en-nu/historische-plekken/historische-gebouwen/politiebureau) · [Operator terrace photo](https://moeke.nl/app/uploads/sites/2/2026/02/Moeke-Ede_250603-Moeke-Ede-VY2963WEB.jpg) |
| Berg en Dal and Berg-Oord, Stationsweg 74 and 76 | Chalet eaves, sunroom, shallow recessed loggia and iron fence at Berg en Dal. Dark balcony rails and amber and green Art Nouveau glazing at Berg-Oord. [Atlas van Ede exterior photographs](https://www.atlasvanede.nl/mooi-ede/gebouwen/architectuur/architectuur-aan-de-stationsweg) |
| Molenaarswoning, Stationsweg 118 | Shuttered sash windows, rendered gable and doors beside De Keetmolen. [Current exterior](https://www.atlasvanede.nl/mooi-ede/must-see/21-30-in-ede/21-statige-huizen-aan-de-stationsweg/stationsweg-even-huis-voor-huis) · [Museum photograph](https://www.collectiegelderland.nl/historischmuseumede/object/16a5f4fc-e118-d45e-d21c-3f3be15023e2) |
| Villa Ça Ira, Stationsweg 63 | Dark timber on the front gable, shuttered sashes, a wraparound sunroom and balustrade. The low plinth and iron fence follow the garden boundary visible in the 2026 orthophoto. [Exterior reference](https://bomentoer.jouwweb.nl/nieuw-monumentale-villa-s-in-ede-en-omgeving) · [PDOK aerial imagery](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0) |
| Villa Richmond, Stationsweg 102 | Rebuilt villa with red tile roof, coloured bands, painted name, oriel and glazed sunroom. The rear wing has grey masonry, larger grouped windows and charcoal roofing. [Completed project](https://www.thuismakers.nl/projecten/september-ede-stationsweg-villa-richmond) · [Contractor exterior photos](https://www.bouwbedrijfnap.nl/portfolio/verbouw-villa-richmond-te-ede/) |
| Moni Alendo, Stationsweg 21 | Expressionist massing with light roof rakes, a split-gable fanlight, a horizontal picture window and a recessed-looking entrance. [Exterior photograph](https://bomentoer.jouwweb.nl/nieuw-monumentale-villa-s-in-ede-en-omgeving) · [Architecture reference](https://www.dbnl.org/tekst/sten009monu05_01/sten009monu05_01_0068.php) |
| Former Edesche Courant and adjacent fronts, Stationsweg 36–40, and the MULO on Beukenlaan 4 | Pediment, casements, bays and balcony at the historic street fronts. The MULO has paired windows and diamond spandrels. The rear volumes follow the surveyed state visible in the PDOK 2026 aerial imagery. [Street and school photos](https://www.atlasvanede.nl/thema-s/stadsontwikkeling/heden/stationsweg-1/stationsweg-36-40) · [PDOK aerial imagery](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0) |

Opening sizes, trim colours and some side and rear elevations are estimates from the public references. Fence placement is approximate where tree cover obscures it. The redevelopment at Stationsweg 36–40 should be surveyed again once the as-built exterior can be compared with the current shell.

## Refresh

Reuse the saved CityJSON item responses to reproduce the building geometry. Use `--fetch` to populate a new cache. If newer surveys change face ordering or wall segmentation, check authored placement against the refreshed model before publishing.

```sh
uv run --python 3.12 --with pyproj==3.8.0 python -B tools/build-ede-stationsweg-survey.py /tmp/slop-ede-stationsweg --fetch
```
