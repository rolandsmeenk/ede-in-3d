# Lunteren primary school exteriors

Ede’s *Integraal Huisvestingsplan 2026–2045* lists six primary schools in Lunteren and confirms that CNS De Triangel uses four classrooms at Marterlaan 20, the former De Sprong, as a second site. This yields seven physical sites. Five are inside the current scene. [Ede housing plan, §6.10](https://bouwstenen.nl/sites/default/files/uploads/Bijlage%201%20Integraal%20Huisvestingsplan%202026-2045%20%287%29.pdf)

| School | Address | BAG pand | OSM building |
| --- | --- | --- | --- |
| De Bron | Postweg 7 | 0228100000070828 | [271717868](https://www.openstreetmap.org/way/271717868) |
| De Wegwijzer | Kerkhoflaan 27 | 0228100000065881 | [271717869](https://www.openstreetmap.org/way/271717869) |
| CNS De Triangel | Kerkhoflaan 29 | 0228100000005202 | [271720279](https://www.openstreetmap.org/way/271720279) |
| CNS De Triangel, Marterlaan | Marterlaan 20 | 0228100000021961 | [271717896](https://www.openstreetmap.org/way/271717896) |
| CBS Nederwoud | Kruisbeekweg 45 | 0228100000057010 | [271591225](https://www.openstreetmap.org/way/271591225) |

The school addresses were matched in the [PDOK Locatieserver](https://www.pdok.nl/introductie/-/article/pdok-locatieserver) and each 3DBAG footprint overlaps the corresponding OSM building by at least 99.8%. Nederwoud’s OSM building is in the northern source snapshot, outside the narrower zone where the map bakes generic OSM building shells. Its exact BAG ID is still needed for streamed meshes. The selected approaches are exterior viewpoints from adjacent public streets or paths. Shapes and wall/roof elevations use [3DBAG BAG footprints and LoD 2.2](https://api.3dbag.nl/collections/pand). The [2025 PDOK aerials](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?service=WMS&request=GetCapabilities) identify the road sides and visible temporary structures.

- De Bron’s school photo shows the dark upper façade, brick base, framed classrooms and glazed gable. The surveyed roof includes the low skylight referred to in the opening coverage. The viewpoint sits on the Otterlaan footpath (BGT G0228.fe246f2db22bd6d6e0400a0a35020533) beside the entrance square. [School photo and virtual tour](https://www.debronlunteren.nl/) · [Opening coverage](https://www.edestad.nl/zakelijk/nieuws/487237/burgemeester-opent-school-de-bron-in-lunteren)
- De Wegwijzer’s school guide shows its tall dark curtain wall, stepped mullions, wood-toned entrance and a green sign on the brick end wall. The adjoining gym remains a separate building. [School guide, PDF page 14](https://www.dewegwijzerlunteren.nl/wp-content/uploads/2025/10/De-Wegwijzer_Schoolgids_2025-2026-V1b.pdf) · [School contact and address](https://www.dewegwijzerlunteren.nl/contact/)
- De Triangel’s guide cover shows the round tan lower façade and red brick above the upper ribbon glazing. The guide’s history explains the 2009 partial rebuild of the school. [School guide, cover and §1.2](https://mobilecms.blob.core.windows.net/appfiles/app_2191/File/Schoolgids_2022-2023_-_definitief.pdf) · [School contact and address](https://cnsdetriangel-lunteren.nl/locations/contact/)
- The Marterlaan campus retains the hexagonal 1970s fabric of De Sprong, with wide classroom windows, light trim and colored posts. [Post65 exterior photo, plan and description](https://post65.nl/basisschool-de-sprong-lunteren/)
- Nederwoud depicts the current school with its stacked white-framed classroom bands and different brick wings. Kleissen’s project page shows photographs of the existing building alongside the replacement proposal. The photographs of the existing building were used for this model. [Kleissen’s existing building photographs](https://www.kleissen.nl/projecten/vervangende-nieuwbouw-voor-ikc-nederwoud-te-lunteren/) · [School site](https://www.nederwoudlunteren.nl/)

Window layouts and trim on façades with incomplete photographic coverage are approximate. School grounds, temporary classroom units and rooftop equipment beyond the surveyed shells are outside this bake.

## Coverage beyond the map

Ruitenbeekschool’s current building at Ruitenbeekweg 111 is at approximately scene `(-2567, -8578)`, and De Valk at Hoge Valkseweg 37 is at approximately `(859, -8119)`. The playable northern boundary is `z = -7680.7`. The build contains no school geometry or pins at those addresses. [Ruitenbeek’s 2022 build](https://bouwbedrijfkreeft.nl/projecten/nieuwbouw-ruitenbeekschool-lunteren/) · [De Valk contact and address](https://www.schooldevalk.nl/contact/)

## Reproduce the survey bake

```sh
uv run --python 3.12 --with pyproj==3.8.0 python -B \
  tools/build-ede-lunteren-school-survey.py /tmp/ede-school-lunteren --fetch
uv run --python 3.12 --with pyproj==3.8.0 python -B \
  tools/build-ede-lunteren-school-survey.py /tmp/ede-school-lunteren --check
```

3DBAG items are CC BY 4.0. OSM building IDs reference data © OpenStreetMap contributors under ODbL. Photographs are references for manually authored façade features. See [the pinned RD New transformation](ede-gis-v1.md) for the scene frame.
