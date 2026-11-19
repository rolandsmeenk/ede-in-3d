# Ede crossing discovery

The [crossing catalogue](ede-crossing-sites.json) covers the playable rectangle from X −5,412.3 m to 1,981.8 m and Z −1,613.8 m to 3,785.2 m. Coordinates use the scene frame, with X east and Z south. The first 29 entries follow the named inventory. Each entry records the individual upper and lower ways and the points where their centrelines cross. A site can contain parallel carriageways, paths and tracks or several decks. The Keesomtunnel rail crossing and the two adjoining road decks retain their distinct spans.

The scan found 73 additional mapped sites, including 40 bridges, 31 covered passages and two short underpasses. Water geometry intersects 34 of the bridges. The remaining 16 observations need review. Five have a BGT deck footprint without an aligned route, one has an OSM layer mismatch without a mapped structure, and ten have a route that crosses a building or roof footprint without an explicit cover tag.

- **Confirmed** requires an OSM bridge, tunnel or cover tag, or a BGT footprint that aligns with mapped transport. This confirms the source shows a structure. The group's access tags still apply. For example, the Arendshorst bridge record includes a road tagged `access=no` and two cycleways.
- **Candidate** indicates incomplete evidence for how the surfaces meet. A path inside a footprint may run indoors, against a facade or under an overhang. An unmatched BGT deck may have an unmapped private path.
- **Existing profile** and **known unfitted** describe the fit coverage of the 29 named sites in the grade asset at generation time. The catalogue records geometry evidence without inferring floor elevations, deck heights or signed clearances.
- The 14 published public AHOB crossings match all 25 OSM rail crossing nodes in the supplementary extracts. Divided roads and multimode or multitrack crossings account for several nodes at one site. [ProRail Basiskaart layer 0](https://maps.prorail.nl/arcgis/rest/services/ProRail_basiskaart/FeatureServer/0)

The checked-in scene supplies 8,555 road and path ways, 45 rail ways, 44,844 footprint records and 177 water polygons. The Geofabrik Gelderland and Utrecht extracts timestamped November 18, 2026 at 21:21 UTC supply 474 linear waterways, including separately tagged culverts, along with OSM roof polygons and structural ways. The scan retains open-water evidence and skips tagged culverts when looking for bridges. Unmapped narrow watercourses and unmapped indoor passages can still be absent. [OpenStreetMap attribution and ODbL terms](https://www.openstreetmap.org/copyright), [Geofabrik Netherlands extracts](https://download.geofabrik.de/europe/netherlands.html)

The November 18, 2026 PDOK snapshot supplies 55 groups of bridge deck polygons from the [BGT scene asset](../../assets/ede-bgt.json) and 11 active [tunnel polygons](ede-crossing-tunnels.geojson). Multiple BGT pieces can describe one roof or deck. The scan compares source polygons, mapped layers and road and path alignment, then groups neighboring observations with a shared structure, side-by-side tags or a common crossing. [PDOK BGT feature collections, CC0](https://api.pdok.nl/lv/bgt/ogc/v1/collections?f=html)

## Overlapping layers

The OSM test buffered route centrelines to their BGT width where available, otherwise to their scene width or 2.9 m for ways without a width. Flat-ended buffers are clipped to the playable rectangle. The test found **zero** areas larger than 0.01 m² shared by three distinct mapped traffic layers. The independent BGT test found **zero** across 26,236 level-zero, 90 level-one and 32 level-minus-one road and path polygons. The tests use recorded layers and horizontal geometry. Numerical layer labels describe ordering, so the two routable surfaces at Stadspoort remain two surfaces even though their labels are +1 and −2.

At Knooppunt Maanderbroek, A30 way `6960104` crosses both A12 carriageways at X approximately −4,175 m. The A12 connector `6960110` crosses three level-zero motorway ways at X approximately −3,964 m. Each elevated way lies at layer +1 and their decks do not intersect.

## Reproduce

Run the scan from the repository root using the checked-in inputs and Shapely 2.1 or newer.

```sh
uv run --with 'shapely>=2.1' python tools/audit-ede-crossings-scan.py
```

Supply local Gelderland and Utrecht PBF extracts to rebuild the OSM supplement. Use an existing BGT road snapshot directory to include the optional independent overlap test in a temporary report.

```sh
uv run --with 'shapely>=2.1' --with osmium python tools/audit-ede-crossings-scan.py \
  --refresh-osm gelderland.osm.pbf utrecht.osm.pbf
uv run --with 'shapely>=2.1' python tools/audit-ede-crossings-scan.py \
  --bgt-road-snapshot /tmp/ede-bgt-roads --output /tmp/ede-crossing-surfaces.json
```

The dated tunnel query used the playable geographic rectangle. [PDOK query](https://api.pdok.nl/lv/bgt/ogc/v1/collections/tunneldeel/items?bbox=5.5925%2C52.012%2C5.7005%2C52.0605&datetime=2026-11-18T00%3A00%3A00Z&limit=1000&f=json)
