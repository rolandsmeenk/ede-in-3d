# Slop Ede

Explore Ede in 3D, from Oude Kerk and Marktplein to Kernhem, Rietkampen, Maandereng, Veluwse Poort, and the western business parks. Travel on foot, by car, bicycle, cargo bike, or helicopter.

Forked from [Slop Utrecht](https://github.com/bertt/slop-utrecht), based on [Slop New York](https://github.com/mrdoob/slop-newyork).

## Run locally

Serve the repository over HTTP and open [localhost:8000](http://localhost:8000).

```sh
python3 -m http.server 8000
```

The checked-in OpenStreetMap data works without an Overpass request at startup. The simulator streams LoD 2.2 buildings from the nationwide 3DBAG tileset and uses OpenStreetMap footprints if the tiles are unavailable.

## Refresh the Ede map

Use Node.js 22 or later.

```sh
bash tools/overpass.sh tools/data/osm_ede.json tools/data/q_ede.overpassql
node tools/build-ede-geodata.mjs
node tools/build-ede-shops.mjs
```

The roughly 7.4 × 5.4 km extraction covers Ede’s built-up town. The coordinate origin is Oude Kerk. Use **Show all of Ede** in the street atlas for the town-wide view. Building geometry from 3DBAG is projected into the same coordinate system and seated on the AHN terrain.

## Refresh the AHN terrain

Terrain comes from the PDOK AHN ground model (DTM). The input raster uses RD New (EPSG:28992) horizontally and metres NAP vertically. The checked-in asset samples it every 12 m across the map and its surroundings. Scene Y is relative to the AHN height at Oude Kerk, 22.54 m NAP in this asset. The existing true-north scene X/Z and saved map positions keep their coordinates.

With Python 3 and GDAL on your PATH:

```sh
curl -fsSG https://service.pdok.nl/rws/ahn/wcs/v1_0 \
  --data-urlencode service=WCS --data-urlencode request=GetCoverage \
  --data-urlencode version=2.0.1 --data-urlencode coverageId=dtm_05m \
  --data-urlencode format=image/tiff \
  --data-urlencode 'subset=x(168650,176950)' \
  --data-urlencode 'subset=y(446650,452950)' \
  --data-urlencode 'scalesize=x(1384),y(1050)' -o /tmp/ede-ahn-rd.tif
python3 tools/build-ede-terrain.py /tmp/ede-ahn-rd.tif
```

Existing OSM street, cycleway, park and water outlines follow the terrain. AHN is a ground model, so bridge decks and tunnels still use the existing map treatment. The browser loads the local terrain asset and can fall back to level ground if the file is unavailable.

## Refresh the tree inventory

PDOK BGT supplies individual tree locations. Ede’s municipal inventory enriches nearby points with species groups and height and trunk-diameter ranges. OpenStreetMap contributes additional tree locations. The build joins the sources in RD New, then writes one compact asset for the current scene grid. Missing sizes and species receive deterministic estimates, and woodland outside mapped clusters still gets procedural trees.

```sh
python3 tools/fetch-ede-trees.py /tmp/ede-tree-sources --date 2026-11-18
python3 tools/build-ede-trees.py /tmp/ede-tree-sources/pdok.geojson /tmp/ede-tree-sources/municipal.geojson --osm tools/data/osm_ede.json
```

The builder requires GDAL on your PATH. The optional OpenStreetMap snapshot is produced by the map refresh command. The browser samples AHN at each planted location and renders the trees with shared, instanced geometry in 200 m × 200 m tiles. Detail and visibility update with camera distance.

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

Explore other cities and community remixes in [Slop Cities](https://github.com/zz85/slop-cities).

## License and data

- Project code is available under the [MIT License](LICENSE).
- Streets, parks, water, trees, shops, and fallback building footprints are © OpenStreetMap contributors under [ODbL](https://www.openstreetmap.org/copyright).
- Building geometry is © 3DBAG by tudelft3d and 3DGI under [CC BY 4.0](https://docs.3dbag.nl/en/copyright/).
- District labels are based on the [CBS Wijk- en Buurtkaart 2025](https://www.cbs.nl/nl-nl/dossier/nederland-regionaal/geografische-data/wijk-en-buurtkaart-2025).
- The logo is from the [official Gemeente Ede website](https://www.ede.nl/).
- Terrain uses the [AHN ground model via PDOK](https://www.pdok.nl/introductie/-/article/actueel-hoogtebestand-nederland-ahn).
- Tree locations are from [PDOK BGT](https://api.pdok.nl/kadaster/bgt/ogc/v1?f=html&lang=nl) (CC0). Tree attributes are from the [municipal Ede inventory](https://data.overheid.nl/dataset/39339aa2-a7dc-4f52-bcdb-f1eff423b69f) (public domain).
