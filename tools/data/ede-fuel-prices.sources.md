# Fuel price data sources

The roadside displays show estimated prices to the nearest euro cent, with a Dutch decimal comma. They show the fuel, unit, and rounded amount. A dash indicates an unavailable estimate, including CNG, which is priced per kilogram.

## National baseline

CBS StatLine table 80416ENG contains nationwide weighted daily pump-price averages for Euro 95, diesel, and LPG, including VAT and excise. CBS publishes the daily observations weekly. The browser checks for a newer observation at startup and hourly while the game is visible. An outage retains the last valid observation for the session. An offline start uses the bundled observation from 16 November 2026. [CBS and Travelcard daily series](https://www.cbs.nl/nl-nl/cijfers/detail/80416ENG) · [CC BY 4.0 license](https://data.overheid.nl/dataset/4424-pumpprices-motor-fuels--per-type--per-day)

## Local adjustments

On 22 November 2026, a calibration sample of 16 Ede and Lunteren stations was compared with ANWB Onderweg's national averages. The adjustments are group medians rounded to 2.5 cents per litre. The game fetches the CBS baseline and applies these fixed adjustments before rounding the displayed amount. [ANWB station interface](https://api.anwb.nl/routing/points-of-interest/v3/all?type-filter=FUEL_STATION&bounding-box-filter=52.012,5.565,52.115,5.805) · [ANWB national reference](https://api.anwb.nl/routing/points-of-interest/v3/fuel-prices)

| Station group | E10 adjustment | Diesel adjustment |
| --- | ---: | ---: |
| Ede discount stations | −5¢/L | −2.5¢/L |
| Other Ede stations | −2.5¢/L | 0¢/L |
| Lunteren | −2.5¢/L | −5¢/L |

LPG uses the national reference where offered. Station groups and available fuels are defined in the station inventory. [Station inventory](../../js/ede-fuel-sites.js) · [Baseline and adjustments](../../js/ede-fuel-prices.js)
