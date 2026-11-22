# Westhoffhuis in Lunteren

Westhoffhuis is the community centre and Cultura library at Dorpsstraat 28, with apartments above. The model follows the building opened in 2014. The front includes the five brick entrance bays, the open white terrace frame, zinc returns, the library colonnade and stairs from Meester Scheepstraplein. [Cultura location](https://cultura-ede.nl/bibliotheek/openingstijden/) · [Synargio exterior photographs](https://architectenweb.nl/projecten/project.aspx?id=27544) · [Current entrance photograph](https://www.lunterencentrum.nl/etenenhoreca/het-westhoffhuis%2Fdorpshuis)

The 3DBAG shell belongs to BAG pand `0228100000075047`, recorded as built in 2013. It matches the bundled OSM footprint `w271720127` to 99.74% intersection over union. The model uses 3DBAG’s measured roof surfaces and BAG ground footprint for collision. Windows, lettering, columns and railings are exterior photo estimates. Four walkable stair treads fit the coarse AHN terrain at the approach, so their rise varies along the façade. [3DBAG building record](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.0228100000075047) · [OSM footprint](https://www.openstreetmap.org/way/271720127)

```sh
uv run --with 'pyproj==3.8.0' python tools/build-ede-westhoffhuis.py /tmp/ede-westhoffhuis --fetch
node --test tests/ede-westhoffhuis.test.cjs
```

Omit `--fetch` to reuse the cached survey. The exterior uses batched procedural geometry and a generated text atlas.
