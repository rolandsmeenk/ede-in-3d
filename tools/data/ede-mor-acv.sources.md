# ACV collection-site evidence

The 20 November 2026 snapshot of ACV's published Ede collection map contained 926 active public records. After excluding mobile collection stops and clipping with the shared RD New frame, 748 records at 586 sites remained. The import matched 707 map records to 555 of the 748 distinct municipal ACV points. A match requires a distance of at most 0.15 m and at least a 0.25 m advantage over a nearby competing municipal point. Coincident municipal IDs remain grouped. [ACV collection map](https://acv-groep.nl/kliko-s-containers-en-pmd-zakken/brenglocaties) · [Ede municipal WFS](https://geo.ede.nl/geoserver/Ede/wfs)

Physical profiles use the numbered residual-waste designations in Annex 2, effective 1 January 2021, where the current ACV number matches the table and the positions agree within 2 m. This yields 228 underground sites, 31 semi-underground sites and one above-ground site. Street photography adds a second above-ground site. The remaining 294 matched sites have verified waste streams and use a generic physical profile if placed. The exposed geometry uses approximate dimensions. [Ede waste collection designation](https://lokaleregelgeving.overheid.nl/CVDR652271/1)

At Telefoonweg beside Cultura, WFS site `mor_acv_containers.331` matches glass E076B, paper E076C and residual E076A, with an underground designation for E076A. The neighbouring `mor_acv_containers.690` matches organic E411A and E411B. At the Bellestein car park, the photo published 18 November 2026 confirms the above-ground Restore cabinets that match E17 and E17-A at coincident municipal site `mor_acv_containers.1009` and `.1010`. Review individual cabinet footprints and parking apron clearance before placing that group. [Bellestein photo, EdeStad](https://www.edestad.nl/lokaal/overig/1328565/fotoquiz-edestad-nl-hoe-goed-ken-jij-ede-310-)

At HEMA on Grotestraat, an 18 April 2021 photo shows the twin-stream litter bin at the window column near the door marked 50. The column, facade orientation and pedestrian paving locate the bin at the present `mor_afvalbakken.650` record. The model approximates the anthracite perforated body, shallow hood and paired deposit labels. The city map supplies location and the photo supplies design. [Atlas van Ede, Grotestraat](https://www.atlasvanede.nl/toen-en-nu/van-centrum-tot-buitenwijk/winkels-in-het-centrum/grotestraat-noord) · [Reviewed litter model](ede-mor-bin-profile.json)

## Refresh

Open the public ACV collection map for Ede. The service asks for a street address. The public municipality address at Bergstraat 4, 6711 DD, returns the Ede map. In the browser network panel, save the `GetContainerLocations` JSON response as `acv-map.json`. Save the designation page as HTML and use the dated municipal WFS snapshot for the matching date.

```sh
uv run --with pyproj==3.8.0 python -B tools/build-ede-acv-profiles.py \
  /tmp/ede-municipal-2026-11-20/mor_acv_containers.json \
  /tmp/ede-municipal-2026-11-20/acv-map.json \
  /tmp/ede-municipal-2026-11-20/ede-designation.html
```

The output is [the crosswalk consumed by the street-detail bake](ede-mor-acv-profile.json). Its 20 November 2026 inputs have SHA-256 `f9b04c4d21e5a9dfb7d8c61b512a174259eaca20a30cecc6f6ebe76186ab2771` (ACV map) and `5c23ec76a2a435767a1a3eacc7075ac843f5bf9b85d63f8d64da3d25be05b187` (Annex 2 HTML). The source web responses and review photos remain offline.
