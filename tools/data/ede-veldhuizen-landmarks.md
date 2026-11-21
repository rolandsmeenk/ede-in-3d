# Bellestein and Laathof

The models use the Ede scene affine and a vertical origin of 22.54 m NAP. The bake links 20 Bellestein and 28 Laathof 3DBAG records to individual OpenStreetMap footprints. The scene uses the surveyed exteriors and omits the matching generic building instances. [3DBAG data and licence](https://docs.3dbag.nl/en/copyright/) · [OpenStreetMap data and licence](https://www.openstreetmap.org/copyright)

## Bellestein

The six principal volumes at Bellestein and the 14 service garages follow LoD 2.2. The visible pale masonry, stepped tile roofs, dark timber, shop fronts, terrace walls, pavement and globe lamps follow the Bouwarchief Ede elevations and public exterior photographs. The 2026 orthophoto anchors the courtyard edges and raised connections. Ground-level routing continues along the existing open-air shopping street and around the major plazas. [Post65 exterior photos and original drawings](https://post65.nl/winkelcentrum-bellestein-ede/) · [Dutch Cultural Heritage Agency survey, pp. 33–35](https://www.cultureelerfgoed.nl/site/binaries/site-content/collections/documents/2026/01/01/post-65-winkelcentra-ontwikkeling-en-voorbeelden-1965-1990/post-65-winkelcentra-rce.pdf#page=33) · [PDOK orthophoto](https://www.pdok.nl/introductie/-/article/luchtfoto-pdok)

The west ramp, courtyard stair, and three raised crossings use a combination of measured deck elevations, 2026 aerial alignment, AHN surface checks and photographic profiles. Rendered access surfaces share the platform heights used by the pedestrian controller. Stair treads, threshold shapes, storefront divisions and rail placement are exterior reconstructions from the references. [AHN via PDOK](https://www.pdok.nl/introductie/-/article/actueel-hoogtebestand-nederland-ahn-)

| Walk check | Scene position in metres |
| --- | --- |
| West ramp | Start at x −1894.65, z 499.02. Walk towards x −1897.85, z 483.71 to reach y −4.43, then continue north onto the surveyed terrace. |
| Courtyard stair | Start at x −1891.23, z 427.62. Walk towards x −1885.90, z 434.30 to reach y −4.49, then turn south to z 437. |
| South crossing | Walk from x −1885.40, z 470.10 towards x −1869.55, z 476.09. The bridge deck is near y −4.48, and the public path beneath it is near y −8.2. |

## Laathof

The two terraced blocks and their stair towers follow the individual BAG shells. Four park-facing tiers use the survey’s measured slab positions. White concrete dividers and slab noses, alternating gravel-aggregate planters and metal railings, dark brick at ground level, restrained planting and window treatments follow the published exterior photographs. Both the park-side path and the north-side parking access retain their existing map geometry. [Post65 exterior photographs and survey](https://post65.nl/terrasflat-laathof-ede/)

## Rebuild

```sh
uv run --python 3.12 --with pyproj==3.8.0 python -B tools/build-ede-veldhuizen-survey.py /tmp/slop-ede-veldhuizen-landmarks --fetch
```
