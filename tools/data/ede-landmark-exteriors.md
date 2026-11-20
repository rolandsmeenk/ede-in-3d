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

## Exterior survey catalogue

This catalogue covers the playable area in [the map snapshot](../../assets/ede-map-v1.json.gz), from 52.012° to 52.0605° N and 5.5925° to 5.7005° E. The survey lists buildings and grounds for exterior reference work. Custom models already in the game appear in [the landmark registry](../../js/ede-landmark-sites.js) and [the latest landmark batch](ede-landmark-batch.md).

### Requested sites

All six addresses fall inside the playable area. The current map footprint contains the address point from the [PDOK Locatieserver](https://www.pdok.nl/introductie/-/article/pdok-locatieserver-1). For campuses and estates, check the surrounding buildings and entrances against aerial imagery before modelling the complete site.

| Site | Address | Map footprint at address | What to photograph |
| --- | --- | --- | --- |
| Tesqua Sport & Healthclub | Horsterweg 3, Ede | `w272136145` | Main entrance and sign, sports-hall roofline and clubhouse in relation to the outdoor courts. [Tesqua](https://tesqua.nl/openingstijden/) |
| NIZO Food Research / Food Innovation Park | Kernhemseweg 2, Ede | `w271586838` | Original research building, present-day entrance and separate pilot plant volumes. Photograph the mural and spiral stair separately. Date the reference photos because the campus is being redeveloped. [NIZO](https://www.nizo.com/contact-us/) · [Campus redevelopment](https://schipperbosch.nl/ontwikkeling/food-innovation-park/) · [Mural reference](https://rootshub.nl/en/our-location/nizo/) |
| Buitenzorg | Amsterdamseweg 19, Ede | `w271549976` | Historic street frontage, roofline, lettering and the junction with later additions. Municipal monument GM051. [Buitenzorg](https://www.buitenzorg.nl/) |
| Ziekenhuis Gelderse Vallei | Willy Brandtlaan 10, Ede | `r13089665` | Main entrance from the forecourt, the heights and connections of the wings, and the rear emergency entrance. [Hospital and site plan](https://www.geldersevallei.nl/contact/locatie/ede) |
| De ReeHorst | Bennekomseweg 24, Ede | `w271472015` | Main entrance, sign, hotel wing and the massing of the congress and theatre halls. [ReeHorst](https://www.reehorst.nl/zakelijke-events) |
| Kasteel Hoekelum | Edeseweg 124, Bennekom | `w271473106` | Entrance steps and crest, roof turret and moat-facing side. Survey the coach house, bridge and park as part of the same estate. [Main house 514038](https://monumentenregister.cultureelerfgoed.nl/monumenten/514038) · [Estate 514040](https://monumentenregister.cultureelerfgoed.nl/complexen/514040) |

### Notable company buildings

| Site | Address | What to photograph |
| --- | --- | --- |
| Johannus Orgelbouw | Keplerlaan 2, Ede | Neoclassical frontage, symmetrical entrance and the workshop behind it. [Johannus](https://www.johannus.com/nl/over-ons) |
| Delektro / Van van Ee showroom | Jennerstraat 7, Ede | Broad roof, planted end wall and the separate showrooms under the shared roof. [Delektro](https://www.delektro.nl/over-ons/) · [Architect's project account](https://architectenweb.nl/projecten/project.aspx?id=39987) |
| Toyota Material Handling Nederland | Stevinlaan 4, Ede | Expanded-metal screen, signage and the change in height from the office to the workshop. [Toyota](https://toyota-forklifts.nl/klantenservice/contactpagina2/contactpagina2/) · [Architect's project account](https://architectenweb.nl/projecten/project.aspx?id=44622) |
| ABB factory | Frankeneng 15, Ede | Office frontage, entrance sign and production hall from Frankeneng. [ABB](https://new.abb.com/benelux/fr/a-propos-abb/ou-nous-trouver/ede) |

Plantion, Lukkien and the Riedel silos already have custom models. For schools, start with Technova College’s glazed workshop frontage, the two Marnix sites and Het Streek. At De Vuurvogel, capture the trunk and crown of the large tree in relation to the main entrance. Further heritage photo priorities are De Eder Kuil, Villa Sterrenberg, the Gasfabriek and the ENKA and barracks buildings still awaiting custom models. Use photographs to establish the window and door layout, material colours, signage and trim for geometry and shared materials.

### Schools and education sites

The list contains 56 school registrations, campuses and teaching locations at 53 distinct addresses in Ede. The addresses were checked against PDOK. Use one photo stop per shared address and record any separate entrances. For Cavaljé, the school publishes Veenderweg 2 and the address search located it at 2A. Vocational teaching locations also use operator sources. [DUO primary schools](https://www.duo.nl/open_onderwijsdata/primair-onderwijs/scholen-en-adressen/schoolvestigingen-basisonderwijs.jsp) · [DUO special education](https://duo.nl/open_onderwijsdata/primair-onderwijs/scholen-en-adressen/hoofd-nevenvestigingen-sbo-vso.jsp) · [DUO secondary schools](https://www.duo.nl/open_onderwijsdata/voortgezet-onderwijs/adressen/vestigingen.jsp) · [DUO vocational education locations](https://www.duo.nl/open_onderwijsdata/middelbaar-beroepsonderwijs/aantal-studenten/studenten-mbo-rio.jsp) · [DUO higher education](https://duo.nl/open_onderwijsdata/hoger-onderwijs/adressen/hogescholen-en-universiteiten.jsp)

| Type | School or programme | Address | DUO ID or site note |
| --- | --- | --- | --- |
| PO | Koning Davidschool | Ceelman van Ommerenweg 5 | 11XK00 |
| PO | Franciscusschool | Mesdagstraat 5 | 12GU00 |
| PO | Basisschool Groene Vallei | Groenendaal 7–9 | 17JX00 |
| PO | De Panta Rhei | Palmedreef 4 | 23PR00 |
| PO | De Kleine Prins | Balgzand 4 | 32LH00 |
| PO | Edese Schoolvereniging | Zuidelijke Spoorstraat 8 | 04NP00 |
| PO | De Triangel | Tollenburg 15 | 22KY00 |
| PO | EBS De Rots | Apolstraat 1 | 30FV00 |
| PO | EBS De Tamboerijn | Distelberg 1 | 32HH00 |
| PO | De Vuurvogel | Nachtegaallaan 49 | 09PH00 · Custom model |
| PO | Calluna-School | Sijsseltselaan 16 | 18VW00 |
| PO | De Lettertuin | De Ruyterstraat 1 | 18WV00 |
| PO | De Bongerd | Lindenhorst 1 | 19BA00 |
| PO | OBS Uniek | Nicolaas Maesstraat 7 | 19BP00 |
| PO | Montessorischool Ede | Prof. Oudpark 4 | 23PV00 |
| PO | De Kern | Kleine Houtplein 1 | 27MH00 |
| PO | Al Amana Ede-Noord | Goudenstein 9 | 24ER00 |
| PO | Al Amana Ede-Zuid | Verlengde Parkweg 47B | 31EC00 |
| PO | Stadhouder Willem 3 | Veldhuizerbrink 24 | 06LA00 |
| PO | CNS Cavaljé | Veenderweg 2 | 05NO00 · [School address](https://www.cavalje.cnsede.nl/contact/) |
| PO | CNS De Caleidoscoop | Hofbeeklaan 41 | 11CT00 |
| PO | CNS Prins Floris | Catharinadaal 70 | 11PJ00 |
| PO | CNS Koningin Beatrix | Mondriaanstraat 22 | 12AM00 |
| PO | CNS Het Startpunt | Wulplaan 9 | 12JT00 |
| PO | CNS Louise de Coligny | Ceelman van Ommerenweg 11 | 12YY00 |
| PO | CNS De Ontdekking | Sterkerij 14 | 13KG00 · Shares the ENKA was-, kleed- en schaftlokaal address |
| PO | CNS De Brugge | Wilsondreef 45 | 23PT00 |
| PO | CNS De Vlinderboom | Spinozastate 1 | 23PU00 |
| PO | CNS De Vuursteen | Balgzand 2 | 30JU00 |
| PO | Kindcentrum De Koepel | Nieuwe Maanderbuurtweg 2 | 05NP00 · Shares the address with De Schakel |
| PO | Veldhuizerschool | Kraatsweg 11 | 07YC00 |
| PO | Paasbergschool | Kleefsehoek 1A | 09BT00 |
| PO | Nieuwkomersschool De Schakel | Nieuwe Maanderbuurtweg 2 | [School address](https://scholenopdekaart.nl/basisscholen/ede/20438/nieuwkomersschool-de-schakel/contact) |
| SO / SBO / VSO | Meza College | Asakkerweg 5 | 16QF00 |
| SO / SBO / VSO | Vester College | Hendrik Stafweg 2 | 23GK05 |
| SO / SBO / VSO | CNS-SBO De Regenboog | Generaal Spoorlaan 2–4 | 14RX00 |
| SO / SBO / VSO | De Fonkel | Jachtlaan 14 | 01JE01 |
| SO / SBO / VSO | De Wegwijzer | Bunschoterweg 2A | 22NX00 |
| SO / SBO / VSO | De Wegwijzer, De Zuiderpoort | Kerkweg 19 | GM077 · [School locations](https://www.wegwijzer-ede.nl/onze-school/locaties/) |
| SO / SBO / VSO | De Wegwijzer, Het Panorama | Horalaan 3A | [School locations](https://www.wegwijzer-ede.nl/onze-school/locaties/) |
| VO | Het Streek Lyceum | Bovenbuurtweg 1 | 25GE00 |
| VO | Het Streek College, vmbo and mavo | Zandlaan 25 | 25GE02 |
| VO | Het Streek College, praktijkonderwijs | Zandlaan 25 | 26HV00 · Shares the vmbo and mavo address |
| VO | Het Streek College, ISK | Zandlaan 29A | [School guide](https://www.hetstreek.nl/wp-content/uploads/250578-het-streek-college-schoolgids-2025-2026-web.pdf) |
| VO | Aeres VMBO Ede | Zandlaan 31 | 25GV05 |
| VO | Van Lodenstein College, praktijkonderwijs | Verlengde Parkweg 49 | 26MV00 |
| VO | Al Amana College Ede | Bovenbuurtweg 27 | 32KL00 · Shares the address with Aeres MBO |
| VO | Pallas Athene College | Koekeltse Boslaan 21 | 19KZ00 |
| VO | Marnix College | Prins Bernhardlaan 30 | 02UP00 |
| VO | Marnix College | Prins Bernhardlaan 25 | 02UP01 |
| MBO | Technova College | Bovenbuurtweg 7 | [College](https://www.technovacollege.nl/bovenbuurtweg-7-ede) · [Architect](https://www.cepezed.nl/actueel/oplevering-technova-college-ede/) |
| MBO / VAVO | Dulon College | Reehorsterweg 80 | [College](https://www.duloncollege.nl/hoofdlocatie-dulon-college) |
| MBO | Dulon College, Sport en Bewegen | Burgemeester Cees van der Knaapweg 10 | Custom Van der Knaaphal model · [College](https://www.duloncollege.nl/opendag) |
| MBO | Aeres MBO Ede | Bovenbuurtweg 27 | [College](https://www.aeresmbo.nl/locaties/ede) · [Shared location](https://www.ede.nl/in-de-gemeente-ede/ede-in-ontwikkeling/al-amana-college) |
| MBO | Aeres Tech / Aventus practical training site | Zandlaan 29 | [Aeres Tech course location](https://www.aerestech.nl/opleidingen-en-trainingen/opleidingen/monteur-mobiele-werktuigen-voor-volwassenen) |
| HO | Christelijke Hogeschool Ede | Oude Kerkweg 100 | 25BA · Custom campus model |

### National monuments

The national register has 77 built heritage records in the scene, including listed grounds and structures. The register may give a representative address for large or multipart sites. The linked entries carry the complete addresses and designation details. [RCE map layers](https://www.cultureelerfgoed.nl/onderwerpen/r/rijksmonumentenregister/rijksmonumenten-kaartlagen)

#### Standalone monuments

| Register ID | Monument or component | Register address or site |
| --- | --- | --- |
| [14451](https://monumentenregister.cultureelerfgoed.nl/monumenten/14451) | Boerderij De Driehoek | Driehoek 32, 6711 DJ te Ede |
| [14452](https://monumentenregister.cultureelerfgoed.nl/monumenten/14452) | Oude Kerk · Custom model | Grotestraat 58, 6711 AN te Ede |
| [14455](https://monumentenregister.cultureelerfgoed.nl/monumenten/14455) | Boerderij Engelenhove | Kernhemseweg 6, 6718 ZB te Ede |
| [14458](https://monumentenregister.cultureelerfgoed.nl/monumenten/14458) | Boerderij op landgoed Kernhem | Kernhemseweg 3, 6718 ZB te Ede · Kernhemseweg 5, 6718 ZB te Ede |
| [14459](https://monumentenregister.cultureelerfgoed.nl/monumenten/14459) | Huis Kernhem · Custom model | Kernhemseweg 7, 6718 ZB te Ede |
| [14460](https://monumentenregister.cultureelerfgoed.nl/monumenten/14460) | Boerderij Pothoven | Lunterseweg 40, 6718 WE te Ede |
| [14462](https://monumentenregister.cultureelerfgoed.nl/monumenten/14462) | Woonhuis Notaris Fischerstraat 25 | Notaris Fischerstraat 25, 6711 BB te Ede |
| [14463](https://monumentenregister.cultureelerfgoed.nl/monumenten/14463) | Fischerhuis | Notaris Fischerstraat 27, 6711 BB te Ede |
| [14464](https://monumentenregister.cultureelerfgoed.nl/monumenten/14464) | Huis De Linden | Notaris Fischerstraat 29, 6711 BB te Ede |
| [14465](https://monumentenregister.cultureelerfgoed.nl/monumenten/14465) | Gedenkzuil Anna Maria Moens | Paasberg, Ede |
| [14467](https://monumentenregister.cultureelerfgoed.nl/monumenten/14467) | Boerderij De Slijpkruik | Slijpkruikweg 54, 6712 DL te Ede |
| [14468](https://monumentenregister.cultureelerfgoed.nl/monumenten/14468) | De Keetmolen · Custom model | Stationsweg 118 A, Ede |
| [14470](https://monumentenregister.cultureelerfgoed.nl/monumenten/14470) | Station Ede Centrum · Custom model | Museumplein 7, 6711 NA te Ede |
| [523576](https://monumentenregister.cultureelerfgoed.nl/monumenten/523576) | Transformatorhuisje met tegeltableau | Asakkerweg 4 A, Ede |
| [523577](https://monumentenregister.cultureelerfgoed.nl/monumenten/523577) | Smeedijzeren gaslantaarn | Bij Nieuwe Stationsstraat 36, 6711 AG te Ede |
| [523578](https://monumentenregister.cultureelerfgoed.nl/monumenten/523578) | Nieuwe Kerk · Custom model | Verlengde Maanderweg 33, 6713 LD te Ede |
| [532041](https://monumentenregister.cultureelerfgoed.nl/monumenten/532041) | Mausoleum en plantsoen | Vossenakker, Ede |

#### [Hoekelum](https://monumentenregister.cultureelerfgoed.nl/complexen/514040)

| Register ID | Monument or component | Register address or site |
| --- | --- | --- |
| [514038](https://monumentenregister.cultureelerfgoed.nl/monumenten/514038) | Huis Hoekelum | Edeseweg 124, 6721 KE te Bennekom |
| [514041](https://monumentenregister.cultureelerfgoed.nl/monumenten/514041) | Huis Noordereng | Edeseweg 128, 6721 KE te Bennekom |
| [514042](https://monumentenregister.cultureelerfgoed.nl/monumenten/514042) | Historische tuin- en parkaanleg | Bij Edeseweg 124, 6721 KE te Bennekom |
| [514044](https://monumentenregister.cultureelerfgoed.nl/monumenten/514044) | Theehuis, dienstwoning en schuur | Edeseweg 157, 6717 LZ te Ede |
| [514045](https://monumentenregister.cultureelerfgoed.nl/monumenten/514045) | Koetshuis Hoekelum | Near Edeseweg 124, Bennekom |
| [514046](https://monumentenregister.cultureelerfgoed.nl/monumenten/514046) | Dienstwoning zuidelijke oprijlaan | Edeseweg 120, 6721 KE te Bennekom |
| [514047](https://monumentenregister.cultureelerfgoed.nl/monumenten/514047) | Moestuinmuur | Bij Edeseweg 130, 6721 KE te Bennekom |
| [514048](https://monumentenregister.cultureelerfgoed.nl/monumenten/514048) | Bakhuis | Bij Edeseweg 122, Bennekom |
| [514049](https://monumentenregister.cultureelerfgoed.nl/monumenten/514049) | Kinderhuisje | Bij Edeseweg 124, Bennekom |
| [514050](https://monumentenregister.cultureelerfgoed.nl/monumenten/514050) | Koetshuis Noordereng | Edeseweg 136, 6721 KE te Bennekom |
| [514051](https://monumentenregister.cultureelerfgoed.nl/monumenten/514051) | Stal | Bij Edeseweg 122, Bennekom |
| [514052](https://monumentenregister.cultureelerfgoed.nl/monumenten/514052) | Boerderij | Edeseweg 122, 6721 KE te Bennekom |
| [514053](https://monumentenregister.cultureelerfgoed.nl/monumenten/514053) | Houten paviljoen | Bij Edeseweg 124, Bennekom |
| [514054](https://monumentenregister.cultureelerfgoed.nl/monumenten/514054) | IJskelder | Bij Edeseweg 124, Bennekom |
| [527126](https://monumentenregister.cultureelerfgoed.nl/monumenten/527126) | Obelisk | Bij Edeseweg 124, Bennekom |
| [527127](https://monumentenregister.cultureelerfgoed.nl/monumenten/527127) | Rondboogbrug | Bij Edeseweg 124, 6721 KE te Bennekom |

#### [De Eder Kuil open-air theatre](https://monumentenregister.cultureelerfgoed.nl/complexen/526098)

| Register ID | Monument or component | Register address or site |
| --- | --- | --- |
| [526099](https://monumentenregister.cultureelerfgoed.nl/monumenten/526099) | Speelveld en toneelgebouw | Van Pabstlaan 1A, Ede |
| [526100](https://monumentenregister.cultureelerfgoed.nl/monumenten/526100) | Parkaanleg | Bij van Pabstlaan 1 A, 6711 JW te Ede |
| [526101](https://monumentenregister.cultureelerfgoed.nl/monumenten/526101) | Muziekpodium | van Pabstlaan 1 A, 6711 JW te Ede |
| [526102](https://monumentenregister.cultureelerfgoed.nl/monumenten/526102) | Orkestbak | van Pabstlaan 1 A, 6711 JW te Ede |
| [526103](https://monumentenregister.cultureelerfgoed.nl/monumenten/526103) | Toeschouwerstribune | van Pabstlaan 1 A, 6711 JW te Ede |
| [526104](https://monumentenregister.cultureelerfgoed.nl/monumenten/526104) | Kleedgebouw | van Pabstlaan 1 A, 6711 JW te Ede |
| [526105](https://monumentenregister.cultureelerfgoed.nl/monumenten/526105) | Oostelijk kaartverkoopgebouw | van Pabstlaan 1 A, 6711 JW te Ede |
| [526106](https://monumentenregister.cultureelerfgoed.nl/monumenten/526106) | Westelijk kaartverkoopgebouw | van Pabstlaan 1 A, 6711 JW te Ede |
| [526107](https://monumentenregister.cultureelerfgoed.nl/monumenten/526107) | Kaartverkoopgebouw bij zuidoostelijke entree | van Pabstlaan 1 A, 6711 JW te Ede |
| [526108](https://monumentenregister.cultureelerfgoed.nl/monumenten/526108) | Oostelijk toiletgebouw | van Pabstlaan 1 A, 6711 JW te Ede |
| [528816](https://monumentenregister.cultureelerfgoed.nl/monumenten/528816) | Westelijk toiletgebouw | van Pabstlaan 1 A, 6711 JW te Ede |
| [528817](https://monumentenregister.cultureelerfgoed.nl/monumenten/528817) | Gedenkteken | van Pabstlaan 1 A, 6711 JW te Ede |

#### [Elias Beeckmankazerne](https://monumentenregister.cultureelerfgoed.nl/complexen/523490)

| Register ID | Monument or component | Register address or site |
| --- | --- | --- |
| [523491](https://monumentenregister.cultureelerfgoed.nl/monumenten/523491) | Kazernegebouw met cellen (1) | Nieuwe Kazernelaan 10 D 5, 6711 JC te Ede · Elias Beeckmanlaan 3, 6711 VS te Ede · more in register |
| [523492](https://monumentenregister.cultureelerfgoed.nl/monumenten/523492) | Kazernegebouw (2) | Elias Beeckmanlaan 19, 6711 VS te Ede |
| [523493](https://monumentenregister.cultureelerfgoed.nl/monumenten/523493) | Kazernegebouw (3) | Elias Beeckmanlaan 21, 6711 VS te Ede |
| [523494](https://monumentenregister.cultureelerfgoed.nl/monumenten/523494) | Legeringsgebouw (5) | Elias Beeckmanlaan 18, 6711 VS te Ede · Elias Beeckmanlaan 36, 6711 VS te Ede · more in register |
| [523495](https://monumentenregister.cultureelerfgoed.nl/monumenten/523495) | Legeringsgebouw (4) | Elias Beeckmanlaan 88, 6711 VS te Ede · Elias Beeckmanlaan 90, 6711 VS te Ede · more in register |
| [523496](https://monumentenregister.cultureelerfgoed.nl/monumenten/523496) | Legeringsgebouw (8) | Elias Beeckmanlaan 40, 6711 VS te Ede · Elias Beeckmanlaan 68, 6711 VS te Ede · more in register |
| [523497](https://monumentenregister.cultureelerfgoed.nl/monumenten/523497) | Legeringsgebouw (6) | Elias Beeckmanlaan 202, 6711 VS te Ede · Elias Beeckmanlaan 208, 6711 VS te Ede · more in register |
| [523498](https://monumentenregister.cultureelerfgoed.nl/monumenten/523498) | Keuken en mess (10) | Elias Beeckmanlaan 110, 6711 VS te Ede · Elias Beeckmanlaan 114, 6711 VS te Ede · more in register |
| [523499](https://monumentenregister.cultureelerfgoed.nl/monumenten/523499) | Legeringsgebouw (7) | Elias Beeckmanlaan 234, 6711 VS te Ede · Elias Beeckmanlaan 248, 6711 VS te Ede · more in register |
| [523500](https://monumentenregister.cultureelerfgoed.nl/monumenten/523500) | Legeringsgebouw (9) | Elias Beeckmanlaan 274, 6711 VS te Ede · Elias Beeckmanlaan 276, 6711 VS te Ede · more in register |

#### [ENKA](https://monumentenregister.cultureelerfgoed.nl/complexen/527062)

| Register ID | Monument or component | Register address or site |
| --- | --- | --- |
| [527063](https://monumentenregister.cultureelerfgoed.nl/monumenten/527063) | Schoorsteen bij ketelhuis · Custom model | ENKA terrain, near former boiler house |
| [527064](https://monumentenregister.cultureelerfgoed.nl/monumenten/527064) | Westvleugel en Poortgebouw · Custom model | Akulaan 10 A, 6717 XN te Ede · Akulaan 2, 6717 XN te Ede · more in register |
| [527065](https://monumentenregister.cultureelerfgoed.nl/monumenten/527065) | Schoorsteen bij spinnerij · Custom model | Tegenover Grote Schoorsteenplein 11, 6717 ZR te Ede |
| [527066](https://monumentenregister.cultureelerfgoed.nl/monumenten/527066) | Bitterzoutmagazijn | Enkalaan 1, 6717 ZA te Ede · Enkalaan 3, 6717 ZA te Ede · more in register |
| [527067](https://monumentenregister.cultureelerfgoed.nl/monumenten/527067) | Herinneringsbank | ENKA terrain, former factory forecourt |
| [527068](https://monumentenregister.cultureelerfgoed.nl/monumenten/527068) | Fontein | ENKA terrain, former factory forecourt |
| [527069](https://monumentenregister.cultureelerfgoed.nl/monumenten/527069) | Gebouw geneeskundige dienst | Sterkerij 125, 6717 XR te Ede · Sterkerij 133, 6717 XR te Ede · more in register |
| [527070](https://monumentenregister.cultureelerfgoed.nl/monumenten/527070) | Was-, kleed- en schaftlokaal | Sterkerij 14, 6717 XR te Ede |

#### [Concordia](https://monumentenregister.cultureelerfgoed.nl/complexen/527720)

| Register ID | Monument or component | Register address or site |
| --- | --- | --- |
| [14469](https://monumentenregister.cultureelerfgoed.nl/monumenten/14469) | Concordiamolen · Custom model | Accesweg 2, 6712 CZ te Ede |
| [527721](https://monumentenregister.cultureelerfgoed.nl/monumenten/527721) | Hallehuisboerderij bij de molen | Bij Telefoonweg 32, 6712 GC te Ede |
| [527722](https://monumentenregister.cultureelerfgoed.nl/monumenten/527722) | Hallehuisschuur | Bij Telefoonweg 32, 6712 GC te Ede |
| [527723](https://monumentenregister.cultureelerfgoed.nl/monumenten/527723) | Maalschuur | Bij Telefoonweg 32, 6712 GC te Ede |
| [527724](https://monumentenregister.cultureelerfgoed.nl/monumenten/527724) | Maalderij | Telefoonweg 32, 6712 GC te Ede |
| [527725](https://monumentenregister.cultureelerfgoed.nl/monumenten/527725) | Accesweg | Bij Telefoonweg 32, 6712 GC te Ede |

#### [Ede-West barracks](https://monumentenregister.cultureelerfgoed.nl/complexen/523484)

| Register ID | Monument or component | Register address or site |
| --- | --- | --- |
| [523485](https://monumentenregister.cultureelerfgoed.nl/monumenten/523485) | P.L. Bergansiuskazerne | Verbindelaarsweg 55 K, 6711 VD te Ede · Verbindelaarsweg 53 F, 6711 VD te Ede · more in register |
| [523486](https://monumentenregister.cultureelerfgoed.nl/monumenten/523486) | Van Essenkazerne | Van Essenkwartier 61, 6711 VL te Ede · Van Essenkwartier 59, 6711 VL te Ede · more in register |
| [523487](https://monumentenregister.cultureelerfgoed.nl/monumenten/523487) | Arthur Koolkazerne | Arthur Koolkwartier 2, 6711 VH te Ede · Arthur Koolkwartier 4, 6711 VH te Ede · more in register |
| [523488](https://monumentenregister.cultureelerfgoed.nl/monumenten/523488) | Johan Willem Friso-kazerne · Custom model | Frisopark 4, 6711 WZ te Ede |
| [523489](https://monumentenregister.cultureelerfgoed.nl/monumenten/523489) | Mauritskazerne · Custom model | Frisopark 2, 6711 WZ te Ede |

#### [Gasfabriek](https://monumentenregister.cultureelerfgoed.nl/complexen/510042)

| Register ID | Monument or component | Register address or site |
| --- | --- | --- |
| [507525](https://monumentenregister.cultureelerfgoed.nl/monumenten/507525) | Hoofdgebouw gasfabriek | Diamantstraat 5, 6713 TL te Ede · Diamantstraat 7, 6713 TL te Ede |
| [510043](https://monumentenregister.cultureelerfgoed.nl/monumenten/510043) | Zuiverhuis | Diamantstraat 1 A, 6713 TL te Ede · Diamantstraat 1 B, 6713 TL te Ede · more in register |
| [510044](https://monumentenregister.cultureelerfgoed.nl/monumenten/510044) | Dienstwoning gasbaas | Schaapsweg 2 B, 6713 BC te Ede |

### Municipal monuments

The municipal Cultuurhistorische Waardenkaart identifies 103 protected entries inside the playable area. Names and addresses follow the register, with multi-address listings combined. The Daggelderswoning on Fred Bantinglaan sits just south of the map. [Gemeente Ede monument register](https://www.ede.nl/aanvragen-en-regelen/monument-opknappen-of-verbouwen)

| Register ID | Monument | Address in Ede |
| --- | --- | --- |
| GM050 | Noorderkerk · Custom model | Amsterdamseweg 9, 13 |
| GM051 | Buitenzorg | Amsterdamseweg 19B, 19A, 19 |
| GM052 | Winkel-woonhuis met tuin | Amsterdamseweg 20 |
| GM053 | Middenstandswoning met tuin | Amsterdamseweg 21 |
| GM054 | Berkenroode | Arnhemseweg 39 |
| GM055 | De Hooge Paaschberg- landhuis, tuin, hek | Arnhemseweg 57 |
| GM056 | Woningcomplex gehuwde militairen | Artillerielaan, Klinkenbergerweg 18, 20, 22, 24, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 63, 64, 65 |
| GM057 | Grafmonument H.F.R. Brandts Buys | Asakkerweg |
| GM058 | Beatrixkerk · Custom model | Beatrixlaan, Willem de Zwijgerlaan 4A, 54 |
| GM059 | Villa | Bennekomseweg 22 |
| GM060 | Onder 't Stroodak, landhuis met tuin | Bennekomseweg 38 |
| GM061 | Villa Sterrenberg | Bergstraat 2A, 2B, 2 |
| GM062 | Grafmonument F.A.R. Padberg | Prins Bernhardlaan |
| GM063 | Bettekamp | Bettekamp 15 |
| GM064 | Evangelisch Lutherse kerk | Beukenlaan 12 |
| GM065 | Oude Hofstede, boerderij met bijgebouwen | Bovenbuurtweg 35A, 35 |
| GM066 | Woonhuis | Buitenzorgpad 7 |
| GM067 | Boerderij | Doesburgerdijk 22 |
| GM068 | Boerderijcomplex Groot Haverkamp | Erasmusstate 87A, 87, 87B |
| GM070 | Winkel-woonhuis | Grotestraat, Nieuwe Stationsstraat 1, 2 |
| GM071 | (deel van) Winkelwoonhuis | Grotestraat 68 |
| GM072 | Winkel-woonhuis | Grotestraat 87 |
| GM073 | Villa | Grotestraat 123, 123A |
| GM074 | Villa Klinkenberg | Heuvelsepad 62 |
| GM075 | (helft) Dubbele villa met tuin en garage | Julianalaan, Oranjelaan 1, 5 |
| GM076 | Kalverkamp, boerderijcomplex | Kalverkampweg 1 |
| GM077 | School De Zuiderpoort met tuin | Blotenberglaan, Kerkweg 1, 19 |
| GM078 | Zwarte schuur BY koetshuis op Kernhem | Kernhemseweg 3 |
| GM079 | Hooiberg bij Engelenhove | Kernhemseweg 6 |
| GM080 | Boerderijcomplex De Lange Weide | Langeweideweg 24, 26 |
| GM081 | Bouwhuis, boerderij met bakhuis en eik | Kernhemseweg 15 |
| GM082 | Zonnehuis, villa met tuin | Lindelaan 5 |
| GM083 | Villa Ebina | Lindelaan 46 |
| GM084 | Zuiderkruis, villa met tuin | Lindelaan 54 |
| GM088 | Boerderij met bakhuis en schuur | Maanderdijk 10, 10A |
| GM089 | Boerderij met aangebouwd bakhuis | Maanderdijk 18 |
| GM090 | (deel van) Winkelwoonhuis | Maandereind, Nieuwe Stationsstraat 45, 50 |
| GM091 | Boerderijcomplex | Meentdijk 2 |
| GM092 | Transformatorhuisje | Oranjelaan 2 |
| GM093 | 't Hoveke, landhuis met garage en tuin | Oude Arnhemseweg 19 |
| GM094 | Villa Oase met garage | Oude Bennekomseweg 14 |
| GM095 | Oud Ede Zuid - Tuindorp Vooruit | Blokkenweg, Kerkweg, Poortlaan, Poortplein 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 |
| GM096 | Boerderij Klein Hees | Prof. Oudpark 72 |
| GM097 | Marnixcollege | Achterdoelen, Gildestraat, Raadhuisplein 2, 4, 5, 6E, 6D, 6C, 6A, 6B, 6F, 8C, 8A, 8B, 10Z, 10F, 10E, 10D, 1 |
| GM098 | Bijgebouwen en erf De Slijpkruik | Slijpkruikweg 54 |
| GM099 | Villa Moni Alendo | Stationsweg 21A, 21 |
| GM100 | Villa By Honck | Stationsweg 27 |
| GM101 | Villa Regina | Stationsweg 31, 33, 35 |
| GM102 | Ça Ira, villa met tuin en muurtje | Stationsweg 63 |
| GM103 | Herenhuis Rustoord | Stationsweg 71, 71A |
| GM104 | Berg en Dal, villa met tuin en hek | Stationsweg 74 |
| GM105 | Landhuis met garage en tuin | Stationsweg 75 |
| GM106 | Villa Berg-Oord | Stationsweg 76 |
| GM107 | (helft van) Dubbele villa Ararat | Stationsweg 83, 85 |
| GM108 | Villa Nescio | Stationsweg 88 |
| GM109 | Villa met tuin en hek | Stationsweg 90 |
| GM111 | Villa met tuin en hekwerk | Stationsweg 95 |
| GM112 | Piermont, villa met tuin | Stationsweg 99 |
| GM113 | Invernia, villa met tuin en hek | Stationsweg 100 |
| GM114 | Richmond, villa met tuin | Stationsweg 102 |
| GM115 | (deel van) Paludana, villa met hek | Stationsweg 106 |
| GM116 | R.K. kerk St. Antonius van Padua · Custom model | Stationsweg 110 |
| GM117 | Molenaarswoning | Stationsweg 118 |
| GM118 | Villa Rose Cottage | Telefoonweg 4 |
| GM121 | Ede-West - geb.26 - paardenstal | Verbindelaarsweg 90, 92 |
| GM122 | Pastorie bij R.K kerk St. Ant. van Padua | Stationsweg 112 |
| GM172 | Villa met tuin | Stationsweg 93 |
| GM175 | Onderofficierswoningen - Berkenlaan 2 | Berkenlaan 2 |
| GM179 | winkels en bovenwoningen | Soembalaan 21, 2, 41, 4, 61, 6, 81, 101, 10, 12, 121 |
| GM184 | Nederlands hervormde 'Bethelkerk' | Jan Th. Tooroplaan 133 |
| GM192 | Openbare ULO 'De Wissel' | Bettekamp 99 |
| GM193 | NH lagere school 'De Vuurvogel' · Custom model | Nachtegaallaan 49 |
| GM194 | RK lagere school 'St. Maartenschool' | Korhoenlaan 6 |
| GM195 | Het Oude Politiebureau | Breelaan 2A |
| GM196 | Hersteld Apostolische kerk | Regentesseplein 1 |
| GM197 | Landhuis 'De Bunte' | Amsterdamseweg 34A, 34C, 34E, 34B |
| GM200 | VVV-bank | Bergstraat |
| GM201 | Ketelhuis kazerne (gebouw 44) | Nieuwe Kazernelaan 2D44 |
| GM203 | dubbele bedrijfswoning A.K.U. | Reehorsterweg 4, 6 |
| GM212 | Villa | Diepenbrocklaan 20 |
| GM214 | Villa ‘De Stenen Schuur’ | Schralenhouw 4 |
| GM215 | Bungalow 'Het Halster' | Bezuidenhout 16 |
| GM216 | Bungalow | van Heeckerenlaan 1 |
| GM217 | Bungalow | Arnhemseweg 108 |
| GM218 | Villa 'LIBRA' | Beatrixlaan 47 |
| GM219 | Villa fabrikant Olthof | Stationsweg 58 |
| GM228 | Ziekenbarakken MGD (complexonderdeel 2) | van Heutszlaan 2C, 2D |
| GM229 | Ede-West - geb.27 - hoefsmederij | Verbindelaarsweg 100, 102 |
| GM230 | Ede-West - geb.28 - magazijn | Verbindelaarsweg 110 |
| GM231 | woonhuis | Berkenlaan 4 |
| GM232 | woonhuis | Berkenlaan 8 |
| GM233 | woonhuis | Berkenlaan 10 |
| GM234 | woonhuis | Berkenlaan 16 |
| GM235 | woonhuis | Berkenlaan 18 |
| GM239 | Ede-West - Bureelgebouw (KMAR-gebouw) | Verbindelaarsweg 105 |
| GM244 | Ede-West - geb.21 - manege | Drafveld - Arthur Koolkwartier 2 t/m 14 (Drafveld) en 83 t/m 95 (Arthur Koolkwartier) |
| GM245 | Ede-West - geb.22 - paardenstal | Arthur Koolkwartier D22 |
| GM246 | Ede-West - geb.23 - paardenstal | Arthuur Koolkwartier 51 |
| GM247 | Ede-West - geb.24 | Arthur Koolkwartier 19 t/m 35 |
| GM248 | Ede-West - geb. 25 | Arthur Koolkwartier - Nieuwe Kazernelaan 1 t/m 17 - 2 D 25 |
| GM249 | Ede-West - gebouw 8 - kantinegebouw | Kazernelaan, Nieuwe Kazernelaan, Verbindelaarsweg 59A t/m H, 2D8, 59Z |
| GM254 | Wester Wetering | Rijksweg 31 |
| GM256 | Vijzelgemaal met verdeeltoren | Dwarsweg BY 5 |
