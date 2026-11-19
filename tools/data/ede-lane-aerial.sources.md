# PDOK imagery for the Ede lane fit

The lane bake uses 15 manually reviewed lines and exclusion rings from 2026 high-resolution RGB orthophotos. The review used `2026_orthoHR` from the PDOK WMS on 19 November 2026. The individual flight date is unavailable in the WMS response. The ten crops were requested in RD New at 10–18 cm per output pixel. [Beeldmateriaal Nederland via PDOK, CC BY 4.0](https://www.pdok.nl/-/hoge-resolutie-luchtfoto-2026-nu-beschikbaar-bij-pdok)

[`ede-lane-aerial-traces.json`](ede-lane-aerial-traces.json) records the exact WMS request, JPEG checksum, dimensions and affine transform. The WMS bounds use easting, northing axis order. Each digitized pixel centre is converted through the same CRS module used by the bake and rounded to 1 cm in RD. The largest residual against the unrounded raster transform is 0.0066 m. That checks export precision. The image resolution, edge visibility and digitizing uncertainty determine how closely a line represents the surface.

| Review site | Observations |
| --- | --- |
| Maanderbroek | The upper A30 deck shows two lanes. The secondary crop shows a painted A12 merge exclusion. The upper deck and shadow interrupt the view of the lower carriageways. |
| A12 exit 24 | Separate exclusions on the upper N781 and lower A12. The southern ramp crop has visible block lines and turning arrows between queued vehicles. |
| Akulaan | Three dividers and a median curb locate the bus lane and general turn movements. Parked vehicles hide part of the outside curb. |
| Nachtegaallaan and Kolkakkerweg | Both reviewed stretches are unmarked. Parking, paths and islands remain separate from the usable carriageway. |
| Frans Halslaan | A solid divider and a cycleway curb are visible on the upper deck. Shadow obscures the lower carriageways through the span. |
| Albertstunnel and Noorder Parallelweg | Albertstunnel has visible lane dashes on two exposed approaches. The railway and station obscure the central tunnel. The upper Noorder Parallelweg deck is unmarked. |

The eight aerial samples along Maanderbroek’s eastbound A12 block line are a median 0.69 m and a maximum 1.09 m from the corresponding 1GIS line (`gisobjid 2102849616`). The comparison uses the same declared level and RD coordinates in both sources. The six overlapping interior samples on the upper A30 divider are a median 0.26 m and a maximum 0.31 m from 1GIS `gisobjid 2102853267`. Around the ends of that divider and the outer edges, the correspondence is less certain.

## Recreate the comparison overlays

The figure renderer draws the shipped BGT motor-surface polygons, raw 1GIS marking lines, manual aerial observations, and recorded lane and vehicle positions on the same photo in both panels. The vehicle paths come from the runtime evidence for each phase. A panel says how many traces were actually recorded. [PDOK BGT](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html) · [Rijkswaterstaat 1GIS](https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/geografische_areaalregistratie/MapServer)

```sh
uv run --python 3.12 --with pyproj==3.8.0 --with rasterio --with pillow --with shapely \
  python tools/render-ede-lane-overlays.py before.json after.json \
  --fetch --cache /tmp/ede-lane-aerial --out /tmp/ede-lane-overlays
```

Repeat `--site` to select specific crops. Use the local cache to recreate the overlays offline. The figures are map views, so lines may project over each other at bridges and underpasses. Lower route lines use dashes. `pose-coverage.json` checks the oriented vehicle footprint against same-level BGT pavement, mapped non-motor areas and reviewed exclusion rings. A small BGT boundary discrepancy is a review candidate. A coverage gap leaves the pose unverified. Aerial photos and generated overlays are stored outside the game assets.
