# Marnix College main building

The model represents the active school at Prins Bernhardlaan 30. The replacement uses BAG `0228100000004719` and OSM `w271510315`. The 22 November 2026 survey download has a 3DBAG LoD 2.2 footprint and roof planes derived from AHN4 observations in 2022. The PDOK 2026 orthophoto confirms the roof arrangement and entrance court. The model fits the survey in the Oude Kerk scene frame and extends its foundation to the game’s AHN terrain. [School locations](https://www.marnixcollege.nl/onze-locatie) · [BAG address lookup](https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=Prins%20Bernhardlaan%2030%20Ede&fq=type%3Aadres) · [3DBAG survey](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.0228100000004719) · [PDOK 2026 orthophoto](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A28992&FORMAT=image%2Fjpeg&BBOX=173985%2C449160%2C174125%2C449300&WIDTH=1400&HEIGHT=1400)

Atlas van Ede’s 3 and 16 September 2026 photographs guide the classroom glazing, terracotta infill and timber belt courses. The February 2022 panorama and April 2019 oblique images show the glazed main entrance with red doors, projected canopy and folded timber-clad hall. Bay widths, canopy projection and the sloping glass line are fitted to the survey. Temporary classrooms and the separately permitted replacement at number 25 remain outside the custom model. [Atlas van Ede current photographs](https://www.atlasvanede.nl/ede-nu/stadsontwikkeling/heden/rond-centrum/marnix-college-1) · [Atlas van Ede panorama and oblique photographs](https://www.atlasvanede.nl/ede-nu/werk/dienstverlening-nu/onderwijsinstellingen/voortgezet-onderwijs) · [Number 25 permit](https://zoek.officielebekendmakingen.nl/gmb-2026-469761.html)

The offline survey is an adaptation of 3DBAG data by tudelft3d and 3DGI under CC BY 4.0. Rebuild and verify it from a dated local cache. [3DBAG attribution](https://docs.3dbag.nl/en/copyright/)

```sh
uv run --with 'pyproj==3.8.0' python tools/build-ede-marnix-survey.py /tmp/ede-marnix-main --fetch
uv run --with 'pyproj==3.8.0' python tools/build-ede-marnix-survey.py /tmp/ede-marnix-main --check
node --test tests/ede-marnix-landmark.test.cjs
```
