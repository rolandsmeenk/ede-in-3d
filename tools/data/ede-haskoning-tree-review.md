# Haskoning Ede tree inventory review

The public ArcGIS item `BJ2780_Ede_GOWB_Bomen` belongs to `907215_rhdhv`. It was published and last modified on 4 August 2023. The point layer is layer 9, which declares EPSG:28992. The publisher’s item leaves `licenseInfo` and `accessInformation` empty, and the feature service leaves `copyrightText` empty. Public access allowed the comparison below. Redistribution terms remain unresolved, so the game bundle contains none of these records or their attributes. [ArcGIS item](https://www.arcgis.com/home/item.html?id=eada82dd162d4d948421f19b99290a6c) · [Primary item metadata](https://www.arcgis.com/sharing/rest/content/items/eada82dd162d4d948421f19b99290a6c?f=json) · [Feature service layer](https://services.arcgis.com/zmBQLV64TsFvEpV0/arcgis/rest/services/BJ2780_Ede_GOWB_Bomen/FeatureServer/9)

## Sample matched on 20 November 2026

The ArcGIS query returned 46,373 IDs within the enclosing RD New rectangle. It used the scene bounds converted through the pinned GIS frame and padded by 5 m. We sampled 512 sorted object IDs using Python’s `random.Random(20261120).sample`, then retained 510 after exact clipping in the Oude Kerk scene frame. The comparison used the BGT-backed entries in the shipped inventory and the contemporaneous municipal `mor_bomen` response. It matched nearest trunks within 2.5 m in RD New. A runner-up within 0.5 m of the first distance was ambiguous. Each reference trunk could match only once per sample.

| Current reference | Reference trunks in playable area | Sample with a trunk within 2.5 m | One-to-one sample matches | Median and p95 distance |
| --- | ---: | ---: | ---: | --- |
| BGT-backed shipped inventory | 48,190 | 326 | 324 | 0.104 m and 1.283 m |
| `Ede:mor_bomen` | 52,638 | 475 | 475 | 0 m and 0 m |

467 of the 475 `mor_bomen` matches were within 5 mm. The identifiers use different namespaces. Both sources matched 314 sampled trees. In 37 of those, the two reference locations differed by over 0.75 m. Two BGT candidates were ambiguous, and 25 sample records matched neither source.

Species names were populated on 504 of 510 sampled rows. There were 486 height classes and 455 trunk-diameter classes. Crown width had no usable values. Inspection dates in the sample ranged from 2012 to 2022. Among the 324 BGT-backed matches, 261 could supply each of the missing height and diameter classes. Each class would supply a bound or an estimate if the data becomes available for redistribution. The 37 location disagreements and the inspection age make a matched enrichment preferable to using the 2023 layer as an additional placement source.

The enclosing rectangle for the ID query was `169074.148484,447085.740288,176513.877702,452518.205764`. The service query used `geometryType=esriGeometryEnvelope`, `inSR=28992`, `where=1=1` and `returnIdsOnly=true`. The sample requested `outSR=28992` and the source fields `OBJECTID`, `id`, `boomsoort_`, `boomhoogte`, `diameter`, `kroondiame`, `plantjaar` and `inspectied`. [Pinned GIS frame](ede-gis-v1.md)
