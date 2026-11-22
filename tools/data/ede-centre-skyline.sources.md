# Central Ede skyline survey

The building shells use 3DBAG LoD 2.2 CityJSON in the Oude Kerk scene frame. Each model replaces its exact BAG feature and matching OpenStreetMap footprint. Windows, projecting balconies and trim are reconstructed as geometry, with one near-detail draw per landmark. [3DBAG attribution](https://docs.3dbag.nl/en/copyright/)

| Landmark | BAG and OpenStreetMap | Visible details and references |
| --- | --- | --- |
| De Griek | `0228100000019061`, `w271573184` | Staggered roof levels, dark masonry, ochre recesses, and projecting concrete balconies. [TVA architecten](https://www.tva-architecten.nl/project/de-griek-ede/) |
| De Halte · Gelria | `0228100000043988`, `w271573593` | Rust-red commercial frontage, glazed shop bays, and timber tones on the court-side gallery. The surveyed address footprint provides the high wing and adjoining lower section. [AGS Architects](https://www.agsarchitects.net/portfolio-item/gelria-terrein-ede/) |
| De Kleefsehof | `0228100000019138`, `w271603190`; `0228100000007949`, `w271603321`; `0228100000061035`, `w271603371` | Three wings with stepped and pitched roof sections, recessed balconies, and rust awnings. PDOK placed house numbers 246–366, 368–420 and 448–488 in the three respective parts. The 368 address identifies the middle entry on the map. [Woonstede reference](https://www.youtube.com/watch?v=A-2jSuC3Dx8) · [Atlas van Ede street photographs](https://www.atlasvanede.nl/ede-toen/van-centrum-tot-buitenwijk/centrum-noord/kleefseweg-en-hoek) |
| De Witte Hinde | `0228100000068966`, `w271515175` | Pale masonry, stepped terraces and projecting glazed balconies, a few green awnings, and approximate solar-panel rows. [Atlas van Ede building photographs](https://www.atlasvanede.nl/mooi-ede/gebouwen/appartementen/1981-1995/de-witte-hinde) |

```sh
uv run --python 3.12 --with pyproj==3.8.0 python -B \
  tools/build-ede-centre-skyline-survey.py /path/to/centre-skyline-cache --fetch
```
