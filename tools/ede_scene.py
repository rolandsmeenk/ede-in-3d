"""The stored Oude Kerk affine, usable by importers and live feeds without PROJ."""

SCENE_NAP_ORIGIN = 22.54


class SceneAffine:
    """Map geographic longitude and latitude to scene X east and Z south."""

    def __init__(self, affine):
        self.lon0 = affine['lon0']
        self.lat0 = affine['lat0']
        self.x0, self.x_lon, self.x_lat = affine['x']
        self.z0, self.z_lon, self.z_lat = affine['z']
        self.determinant = self.x_lon * self.z_lat - self.x_lat * self.z_lon
        if not self.determinant:
            raise ValueError('The Oude Kerk affine is singular')

    def lon_lat_to_scene(self, lon, lat):
        dl, dp = lon - self.lon0, lat - self.lat0
        return (self.x0 + self.x_lon * dl + self.x_lat * dp,
                self.z0 + self.z_lon * dl + self.z_lat * dp)

    def scene_to_lon_lat(self, x, z):
        dx, dz = x - self.x0, z - self.z0
        return (self.lon0 + (dx * self.z_lat - dz * self.x_lat) / self.determinant,
                self.lat0 + (dz * self.x_lon - dx * self.z_lon) / self.determinant)

    def shapely_coefficients(self):
        return (self.x_lon, self.x_lat, self.z_lon, self.z_lat,
                self.x0 - self.lon0 * self.x_lon - self.lat0 * self.x_lat,
                self.z0 - self.lon0 * self.z_lon - self.lat0 * self.z_lat)

    def geographic_bounds(self, bounds):
        """Return the west, south, east and north bounds enclosing a scene box."""
        x0, z0, x1, z1 = bounds
        lons, lats = zip(*(self.scene_to_lon_lat(x, z) for x in (x0, x1) for z in (z0, z1)))
        return min(lons), min(lats), max(lons), max(lats)
