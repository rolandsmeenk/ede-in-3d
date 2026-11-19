# Rijkswaterstaat DTB motorway detail

The 2026-11-19 Rijkswaterstaat snapshot queries all three DTB collections over the playable bounds. The API returned 2,830 lines, 3,150 points and 2,122 polygons. Its collection metadata lists 2026-02-03 as the latest update. Survey or revision dates carried by the imported records range from 2004-07-30 to 2026-01-09. PDOK publishes the dataset under CC0 1.0. [PDOK DTB collections](https://api.pdok.nl/rws/digitaal-topografisch-bestand/ogc/v1/collections?f=html) · [DTB licence](https://api.pdok.nl/rws/digitaal-topografisch-bestand/ogc/v1?f=html&lang=en)

| Detail | Raw DTB codes | Raw records | Records in corridor | Renderable parts |
| --- | --- | ---: | ---: | ---: |
| Guardrails and solid barriers | R030103, R030101 lines | 477 | 471 | 476 |
| Boundary fences | T0105, T010501, T030101 lines | 221 | 205 | 193 |
| Full and half gantries | R61, MD11 lines | 53 | 52 | 34 |
| Hectometre markers | R5107 points | 305 | 303 | 288 |
| Noise barriers | R2503 lines | 46 | 46 | 9 |
| Noise barrier footprints | R2503 polygons | 47 | 47 | Used to check coverage |

The 1,000 parts carry the source UUID in `id`, with a suffix when a line is split. They also retain the DTB object ID, source code, survey date and relative layer. The import clips to 50 m around the A12 and A30 carriageways and ramps within the playable bounds. It uses the saved simulator lane matches and directed NWB sections to resolve carriageway and side. The resulting 989 NWB matches and 32 fitted crossing-profile attachments are recorded in the asset. [NWB roads](https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1/collections/wegvakken) · [Current lane pipeline](ede-motorway-lanes.sources.md)

Gantry spans retain surveyed beam heights in metres NAP when they cross a mapped carriageway at plausible clearance. Missing or inconsistent span and support evidence accounts for 18 omitted gantries. Marker labels come from the DTB `hecto` field. Marker facing comes from the directed carriageway because all local DTB marker angles are zero. For ground-mounted lines and markers, the existing AHN terrain and fitted road profiles set the base height. The surveyed Z is retained as placement evidence because the object-specific height reference can vary. [DTB survey model](https://www.gdmc.nl/publications/reports/NCG_52.pdf#page=76)

The bake removed overlapping portions of 63 line sections already covered by BGT walls. Of 47 noise footprints, 46 touch existing BGT structures, and all touch a retained DTB noise line or an existing BGT structure. The 9 added noise sections fill gaps in the BGT coverage. Existing BGT lamps and structures and NDW traffic signs keep their established placements. [BGT structure importer](../build-ede-bgt.py)

The review report records 307 parts with an ambiguous parallel-carriageway match and 10 alignments that intersect mapped local access. These lines are visual only. The bake omits 55 spans with insufficient height or carriageway evidence and 11 raised shoulder spans without a supporting deck or ground. The latter include an approach at the Edeseweg viaduct near `[125, 3700]` in scene coordinates. The BGT deck starts closer to the abutment than the fitted road shoulder and the AHN ground falls away below it.

## Coverage checks

Counts below are within 400 m of the given scene coordinates in metres around Oude Kerk.

| Site | X, Z | Guardrails and barriers | Fences | Gantries | Markers | Noise sections |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Maanderbroek | -4175, 2183 | 106 | 10 | 2 | 38 | 0 |
| A30 exit 1 Ede | -3854, 1327 | 27 | 22 | 2 | 25 | 5 |
| A30 exit 2 Ede-Noord | -3601, 68 | 21 | 20 | 5 | 25 | 2 |
| A12 exit 24 Ede | -1386, 3667 | 37 | 13 | 5 | 23 | 0 |

The Maanderbroek upper guardrails and boundary fences are separate surveyed lines about 0.6–0.9 m apart. The lower motorway retains its own ground-level barriers. [A30 and A12 exit numbering](https://zoek.officielebekendmakingen.nl/stcrt-2024-11143.pdf)

## Refresh

Rebuild offline from the bundled snapshot. It retains the relevant source geometries and properties for this bake.

```sh
uv run --with 'shapely>=2.1' python tools/build-ede-dtb.py --report /tmp/ede-dtb-review.json
```

The live PDOK DTB service is scheduled to retire on 2026-12-31. Until then, refresh the raw inputs and save a replacement snapshot with the following command. Rijkswaterstaat's 1GIS is the successor. [PDOK retirement notice](https://www.pdok.nl/-/uitfasering-dataset-digitaal-topografisch-bestand-eu)

```sh
uv run --with 'shapely>=2.1' python tools/build-ede-dtb.py /tmp/ede-dtb --fetch \
  --save-snapshot tools/data/ede-dtb-detail.snapshot.json.gz --report /tmp/ede-dtb-review.json
```

Supply `--date YYYY-MM-DD` to preserve a raw snapshot's retrieval date and `--output /tmp/ede-dtb-detail.json` to inspect uncompressed output. A second PDOK download for the same date and the bundled offline snapshot both produced the same 64,807-byte runtime asset.
