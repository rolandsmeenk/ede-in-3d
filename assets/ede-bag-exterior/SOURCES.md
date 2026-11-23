# Exterior BAG buildings

The gray context buildings use the complete active pand footprints from the
[PDOK BAG Features API](https://www.pdok.nl/ogc-apis/-/article/basisregistratie-adressen-en-gebouwen-ba-1),
retrieved on 23 November 2026 in EPSG:28992. The active statuses include
buildings in use, under construction or renovation, and out of use. BAG data
is provided under the [Public Domain Mark](https://www.kadaster.nl/zakelijk/producten/adressen-en-gebouwen/bag-ogc-api-s).

© 3DBAG by tudelft3d and 3DGI. [Source and CC BY 4.0 license](https://docs.3dbag.nl/en/copyright/).
The exterior meshes are adapted from the [v2025.09.03 CityJSON release](https://3dbag.nl/en/download).
The bake selects the highest available level of detail per building part,
projects and triangulates the roofs and walls, and quantizes them to
centimeters in the scene frame. The renderer applies gray materials and seats
the buildings on the [AHN terrain](https://www.ahn.nl/dataroom). The
player collision polygons preserve the surveyed footprints and courtyards.
Their upper limits follow the highest available roof height.

The selection uses the official Ede municipality boundary buffered by 500 m in
RD coordinates. Every qualifying building keeps its entire footprint. An
official footprint with at least half of its area in Ede belongs to Ede. The
exterior meshes use lower LoDs or measured heights from 3DBAG or AHN where
detailed geometry is unavailable. Buildings without a measured height use a
3 m placeholder.

The exterior BAG building 0228100000068408 overlaps 184.45 m² of the
226.76 m² OSM footprint w271597062. The BAG footprint and LoD 2.2 mesh
cover this building in the exterior layers.

Regenerate with `tools/build-ede-bag-exterior.py GM0228.geojson CACHE --ahn AHN_CACHE`.
The source data stays in the cache. Use the AHN DSM and DTM tiles in the cache
for measured height fallbacks.

