# Ede landmark exteriors

The exterior models use the existing Oude Kerk scene frame and 22.54 m NAP height datum. The meshes and shared procedural materials ship with the game. Footprints and large roof planes come from the mapped outlines and cached 3DBAG LoD 2.2 release v2025.09.03. The models use the existing AHN terrain and fitted routes. Reference photographs were used to fit trim and materials.

| Landmark | Survey and exterior evidence | Fitted or simplified details |
| --- | --- | --- |
| ENKA Westhal and Poortgebouw | BAG 0228100000062084 supplies the L-shaped hall, sawtooth roofs and connected gatehouse. The Sterkerij centreline fixes the arched opening. [Gemeente Ede](https://www.ede.nl/in-de-gemeente-ede/ede-in-ontwikkeling/westhal) · [Bouwbedrijf Kreeft restoration](https://bouwbedrijfkreeft.nl/projecten/poortgebouw-enka/) | Arch profile, frame sizes, coping, solar roof colour and individual window bays. |
| Mauritskazerne and Johan Willem Frisokazerne | BAG 0228100000004297 and 0228100000064049 supply the rooflines and three rear wings. Frisopark references fix the entrance, bands, gables and window rhythm. [Maurits register](https://monumentenregister.cultureelerfgoed.nl/monumenten/523489) · [Current Maurits exterior](https://nextvenue.nl/locaties/mauritskazerne) · [Friso register](https://monumentenregister.cultureelerfgoed.nl/monumenten/523488) | Sashes, stone profiles, emblems, dormer flashing and rear finishes. |
| Oude Kerk | BAG 0228100000030468 supplies the church roof and masonry tower. Native 0.5 m AHN DSM has a valid 69.58 m NAP return on the spire. [RCE monument register](https://monumentenregister.cultureelerfgoed.nl/monumenten/14452) · [Tower details and current references](https://www.atlasvanede.nl/mooi-ede/gebouwen/gebedshuizen/oude-kerk/de-kerktoren-van-de-oude-kerk) | Spire taper and finial above the raster return, fixed clock hands, tracery and louvre dimensions. |
| Historic Ede Centrum station | BAG 0228100000013836 and 0228100000091066 supply the station and carriage shed. Current aerial evidence and the platform view fix the canopy position. [RCE monument register](https://monumentenregister.cultureelerfgoed.nl/monumenten/14470) | Timber spans, bracket profiles, joinery and painted lettering. |
| Huis Kernhem and coach house | BAG 0228100000058265 and 0228100000005589 supply the two footprints and roofs beside the avenue. [Municipal estate history](https://kernhem.ede.nl/meer-over-kernhem/geschiedenis-kernhem) · [Manor register](https://monumentenregister.cultureelerfgoed.nl/monumenten/14459) · [Coach house exterior](https://pannenkoekenboerderijkernhem.nl/) | Window proportions, shutters, crest relief and smaller annex details. |
| De Vuurvogel | BAG 0228100000040685 supplies the school at Nachtegaallaan 49. Renovation imagery shows the glazing and the covered entrance. [School foundation report, p. 29](https://www.stichtingpallas.nl/volumes/uploads/files/Jaarverslag_2022_-Stichting-Pallas-DEF-WG.pdf) · [2025 exterior](https://www.atlasvanede.nl/toen-en-nu/dienstverlening-1/onderwijs/basisscholen-po/willem-van-oranje) | Frames, timber trim, signs and smaller rear openings. |
| Raadhuis Ede | BAG 0228100000035709 supplies the five hillside sections. The model reuses the fitted Raadhuisstraat road openings and 4.2 m clearance. [Gemeente Ede city park framework](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/1918_-_Stadspark_Ede_-_Raamwerk_2022-02-23.pdf) · [Restoration architect](https://www.broekbakema.nl/projecten/raadhuis-ede/) | Glazing bands, entry canopy trim and rooftop equipment. |
| Cultura | BAG 0228100000002319 supplies the roundabout frontage and adjoining volumes. Reference views place the glazing, red uprights and entrance. [Cultura](https://cultura-ede.nl/contact/) · [Theatre project photos](https://controllux.com/referenties/theaters/453/cultura-theater-ede) | Mullions, colours and upper cladding detail. |

## Verification

The in-game review used walking-height and elevated views. The camera checks included Torenstraat, Museumplein and the Valleilijn, the Kernhem avenue, Raadhuisplein and the Bergstraat teleport, and the Molenstraat–Telefoonweg roundabout.

The Sterkerij gate passed all four walking and cycling direction checks. Both Raadhuisstraat carriageways passed the eight supported player-controller checks for driving, walking and cycling. Van and bus checks are unverified. The separate surface samples and view rays cleared the 4.2 m openings under the town hall. The walking controller reached the station, Kernhem, Raadhuis and Cultura entrance approaches.

```sh
node tools/audit-ede-crossings.mjs /tmp/ede-landmark-passages.json http://127.0.0.1:8000 9297 'covered-passage-w494663073-470-2290,raadhuisstraat'
node --test tests/boot.test.cjs tests/building-terrain.test.cjs
```
