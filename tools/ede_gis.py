"""Pinned horizontal GIS conversions in Ede in 3D’s offline pipeline."""

from functools import cache
from hashlib import sha256
from pathlib import Path
import struct

from pyproj import CRS, Transformer, __version__ as pyproj_version, proj_version_str
from pyproj.enums import TransformDirection

from ede_scene import SCENE_NAP_ORIGIN, SceneAffine

VERSION = 1
PYPROJ_VERSION = '3.8.0'
PROJ_VERSION = '9.8.1'
GRID = Path(__file__).resolve().parent / 'data/proj/nl_nsgi_rdtrans2018.tif'
GRID_SHA256 = '7653831191b424e715a906468962fc60071cfb71a3186b2a58f098bab8bf41de'
RD = 'EPSG:28992'
# EPSG's Amersfoort to ETRS89 (9), with visual lon/lat output.
RD_TO_ETRS89 = ('+proj=pipeline +step +inv +proj=sterea +lat_0=52.1561605555556 '
                '+lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 '
                '+ellps=bessel +step +proj=hgridshift +grids="{grid}" '
                '+step +proj=unitconvert +xy_in=rad +xy_out=deg')
WEB_MERCATOR_TO_DEGREES = ('+proj=pipeline +step +inv +proj=webmerc +ellps=WGS84 '
                           '+step +proj=unitconvert +xy_in=rad +xy_out=deg')


@cache
def rd_pipeline():
    if (pyproj_version, proj_version_str) != (PYPROJ_VERSION, PROJ_VERSION):
        raise RuntimeError(f'Ede GIS v{VERSION} requires pyproj {PYPROJ_VERSION} with PROJ {PROJ_VERSION}')
    if not GRID.is_file() or sha256(GRID.read_bytes()).hexdigest() != GRID_SHA256:
        raise RuntimeError(f'Missing or invalid pinned RDNAPTRANS2018 grid: {GRID}')
    return Transformer.from_pipeline(RD_TO_ETRS89.format(grid=GRID))


@cache
def geographic_pipeline():
    return Transformer.from_pipeline(WEB_MERCATOR_TO_DEGREES)


@cache
def horizontal_crs(value):
    crs = CRS.from_user_input(value)
    if crs.is_compound:
        crs = next((part for part in crs.sub_crs_list if part.is_projected or part.is_geographic), None)
    if crs is None or not (crs.is_projected or crs.is_geographic):
        raise ValueError(f'Expected a horizontal CRS, got {value!r}')
    return crs.to_2d()


def source_crs(document, *, default=None):
    """Read the source CRS declaration or the caller's explicit format default."""
    declaration = (document.get('horizontalCrs') or document.get('spatialReference')
                   or document.get('crs') or document.get('coordRefSys') or document.get('referenceSystem')
                   or document.get('coordinateSystem'))
    if isinstance(declaration, dict):
        declaration = (declaration.get('latestWkid') or declaration.get('wkid')
                       or declaration.get('wkt') or declaration.get('properties', {}).get('name')
                       or declaration.get('properties', {}).get('code'))
        if not declaration:
            raise ValueError('Unrecognized source CRS declaration')
    if declaration is not None:
        return horizontal_crs(declaration)
    if default is not None:
        return horizontal_crs(default)
    if document.get('type') in {'FeatureCollection', 'Feature'} and 'coordRefSys' not in document:
        # An RFC 7946 document without a foreign CRS declaration uses CRS84.
        return horizontal_crs('OGC:CRS84')
    raise ValueError('Missing source CRS declaration')


@cache
def crs_axes_and_code(value):
    crs = horizontal_crs(value)
    directions = tuple(axis.direction for axis in crs.axis_info[:2])
    # CRS84 has WGS84 coordinates in lon/lat order, but no equivalent EPSG code.
    epsg = 4326 if crs.to_authority() == ('OGC', 'CRS84') else crs.to_epsg()
    return directions, epsg


def to_rd(x, y, crs, *, axis_order=None):
    """Return RD easting/northing. Formats with x/y order must name that order."""
    directions, epsg = crs_axes_and_code(crs)
    if axis_order is None:
        if directions == ('east', 'north'):
            axis_order = 'xy'
        elif directions == ('north', 'east'):
            axis_order = 'yx'
    if axis_order == 'yx':
        x, y = y, x
    elif axis_order != 'xy':
        raise ValueError(f'Unsupported axis order {axis_order!r} for {crs}')
    if epsg == 28992:
        return x, y
    if epsg == 3857:
        x, y = geographic_pipeline().transform(x, y, errcheck=True)
    elif epsg not in {4258, 4326}:
        raise ValueError(f'Unsupported horizontal CRS for Ede GIS v{VERSION}: {crs}')
    # Public WGS84 snapshots lack a realization or observation epoch. For this
    # bake they use the ETRS89-aligned geographic coordinates of the source.
    return rd_pipeline().transform(x, y, direction=TransformDirection.INVERSE, errcheck=True)


def raster_pixel_to_rd(dataset, col, row, *, center=True):
    """Map pixel coordinates through the declared raster CRS and full affine."""
    if not dataset.crs:
        raise ValueError('The raster must declare its CRS')
    offset = 0.5 if center else 0
    x, y = dataset.transform * (col + offset, row + offset)
    # Rasterio stores affine x/y, regardless of the CRS authority axis order.
    return to_rd(x, y, dataset.crs.to_wkt(), axis_order='xy')


class Frame(SceneAffine):
    """Bridge RD measurements and the map's unchanged Oude Kerk affine."""

    to_rd = staticmethod(to_rd)
    raster_pixel_to_rd = staticmethod(raster_pixel_to_rd)

    def scene_to_rd(self, x, z):
        lon, lat = self.scene_to_lon_lat(x, z)
        return to_rd(lon, lat, 'OGC:CRS84')

    def rd_to_scene(self, easting, northing):
        lon, lat = rd_pipeline().transform(easting, northing, errcheck=True)
        return self.lon_lat_to_scene(lon, lat)

    def to_scene(self, x, y, crs, *, axis_order=None):
        return self.rd_to_scene(*to_rd(x, y, crs, axis_order=axis_order))



def geopackage_crs(connection, table, column='geom'):
    row = connection.execute(
        '''SELECT c.srs_id, s.organization, s.organization_coordsys_id, s.definition
           FROM gpkg_geometry_columns AS c JOIN gpkg_spatial_ref_sys AS s USING(srs_id)
           WHERE c.table_name = ? AND c.column_name = ?''', (table, column),
    ).fetchone()
    if row is None:
        raise ValueError(f'Missing GeoPackage CRS for {table}.{column}')
    srs_id, authority, code, definition = row
    crs = horizontal_crs(f'{authority}:{code}' if authority.upper() not in ('NONE', '') else definition)
    return srs_id, crs


def geopackage_wkb(blob, srs_id):
    if blob[:2] != b'GP' or int.from_bytes(blob[4:8], 'little' if blob[3] & 1 else 'big', signed=True) != srs_id:
        raise ValueError('GeoPackage geometry SRS ID does not match the column declaration')
    envelope = (blob[3] >> 1) & 7
    if envelope > 4:
        raise ValueError('Invalid GeoPackage geometry envelope')
    return memoryview(blob)[8 + (0, 32, 48, 48, 64)[envelope]:]


def geopackage_linestring(blob, srs_id):
    wkb = geopackage_wkb(blob, srs_id)
    endian = '<' if wkb[0] == 1 else '>'
    geometry_type, count = struct.unpack_from(endian + 'II', wkb, 1)
    if geometry_type != 2:
        raise ValueError('Expected a 2D LineString')
    return struct.unpack_from(endian + 'dd' * count, wkb, 9)
