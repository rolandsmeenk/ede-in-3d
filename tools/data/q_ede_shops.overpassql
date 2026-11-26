[out:json][timeout:60];
(
  nwr["shop"]["name"](51.978,5.505,52.148,5.885);
  nwr["amenity"~"^(cafe|restaurant|fast_food|bank|pharmacy)$"]["name"](51.978,5.505,52.148,5.885);
);
out center;
