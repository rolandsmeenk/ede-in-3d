# Brandweerkazerne Lunteren

Zilvervoslaan 29 uses BAG pand `0228100000009538` and replaces OSM building `w271720889`. The 172.00 m² survey outline covers 99.1% of the prior fallback footprint. The 3DBAG LoD 2.2 shell retains both roof levels, with a maximum roof height of 17.96 m NAP and base at 13.37 m NAP. RD New coordinates pass through the pinned Ede conversion and keep the scene’s 22.54 m NAP vertical origin. [3DBAG station survey](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.0228100000009538) · [OSM building](https://www.openstreetmap.org/way/271720889) · [Brandweer Lunteren](https://www.brandweer.nl/kazerne/lunteren/)

The public-facing bay has a silver frame, red cap and lettering, a single broad red sectional door with a six-column glazed grid, and a separate red entrance under a dark canopy. The August 2026 photo shows the closed front and the official 2023 image shows the underlying opening. The badge graphic, trim dimensions and unphotographed wall finishes are approximate. Exterior details share one near-view batch and the lettering uses the existing landmark sign renderer. [Official exterior photo](https://www.brandweer.nl/wp-content/uploads/2021/08/Brandweer2023_Lunteren_09-1600x800.jpg) · [Dated closed-door view](https://brandbase.hetbrandweerforum.nl/kazernes/07-24-lunteren/)

The walking arrival uses the open forecourt beside the mapped Zilvervoslaan approach, at scene `(-3743.8, -4311.1)`. AHN places the point at 13.47 m NAP. The collision footprint follows the building outline and leaves the forecourt clear. [PDOK 2026 aerial crop](https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=2026_orthoHR&STYLES=&CRS=EPSG%3A28992&FORMAT=image%2Fjpeg&WIDTH=720&HEIGHT=720&BBOX=170682%2C455155%2C170754%2C455227) · [OSM service approach](https://www.openstreetmap.org/way/673077543)

## Reproduce the station bake

```sh
uv run --with pyproj==3.8.0 python -B tools/build-ede-lunteren-fire.py /tmp/ede-lunteren-fire --fetch
node --test tests/ede-lunteren-fire.test.cjs
```
