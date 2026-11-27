# Ede skyline survey

The apartment shells and the two E.J. Bos mill volumes use 3DBAG LoD 2.2 CityJSON in the Oude Kerk scene frame. The generator pins each BAG identifier and the corresponding OpenStreetMap fallback. 3DBAG roof maxima include equipment and lift overruns, which accounts for the difference between the 45.83 m Mariëndaal model and the municipality’s 42 m figure. [3DBAG attribution](https://docs.3dbag.nl/en/copyright/) · [Municipal high-rise survey](https://www.ede.nl/fileadmin/ede.nl/Pdf-en/Contourennotitie_Ontwikkelkader_Ede-Stad.pdf)

The gallery rails, glazing, and cladding are reconstructed from photographs and repeated by facade type. The Merlijnflat is present in the recorded game period. The existing Fred Battle artwork on Groot Derxsgoed uses the mapped east-wall paint plane. The car-park approach comes from the mural catalogue. [Housing association records](https://www.woonstede.nl/media/2454/jaarstukken-2024.pdf) · [Ede-Zuid photo survey](https://www.atlasvanede.nl/ede-nu/stadsontwikkeling/heden/ede-zuid-3/afbraak-flats) · [Steni Langenhorst reference](https://www.youtube.com/watch?v=1bdQBaMe-mM) · [Groot Derxsgoed mural placement](ede-murals-flats.json)

Street photographs taken on 27 November 2026 informed the gallery rails and brick end bands at Veldzicht and both Groenendaal blocks, the diagonal panels on Groenendaal Noord, and the cladding grid and entrances at Langenhorst. Both Groenendaal blocks use Noord’s façade design. Zuid carries the separately placed Bellefleur mural. Leeuwenhorst uses BAG `0228100000071622` for the joined blocks. Its west end follows the photographed seven window rows and recessed balconies. Window dimensions and cladding colours are estimates. [Leeuwenhorst 3DBAG survey](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.0228100000071622)

The World Food Center tower and its low companion share BAG `0228100000086507`. The surveyed geometry captures construction. The two OpenStreetMap plans, 11 and four floors, and the architectural photographs establish the rebuilt silhouette. Terrace depths, glazing, planters, and setbacks are approximated from the photographs. [MIX architectuur project](https://www.mix-architectuur.nl/werk/ede-wfc-de-veluwse-proeftuin/) · [Tower map outline](https://www.openstreetmap.org/way/1056707757) · [Companion map outline](https://www.openstreetmap.org/way/1547295471)

The E.J. Bos tank centers and radii come from BGT features `G0228.5857de7e3ebb4cb08504234ed05f6e53`, `G0228.8bc89f8fb2104ef2b81318339cb820cd` and `G0228.c1766ba685424f96be8ad98d0c4104e0`. Roof heights came from the 0.5 m AHN surface. The two stack proportions are approximated from the orthophoto and the surveyed roof. [E.J. Bos permit](https://repository.officiele-overheidspublicaties.nl/externebijlagen/exb-2022-35164/1/bijlage/exb-2022-35164.pdf) · [BGT OGC](https://api.pdok.nl/lv/bgt/ogc/v1/collections/overigbouwwerk) · [AHN elevation service](https://service.pdok.nl/rws/ahn/wcs/v1_0)

```sh
uv run --python 3.12 --with pyproj==3.8.0 python -B \
  tools/build-ede-skyline-survey.py /path/to/skyline-survey-cache --fetch
```
