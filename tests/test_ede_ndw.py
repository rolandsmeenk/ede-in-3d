"""Geometry, timestamps, and lane aggregation for the Ede NDW adapter."""

import sys
import unittest
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from ede_ndw import read_observations, read_restrictions, read_sites, timestamp
from ede_traffic_geometry import RoadGraph


def edge(key, a, b, layer=0, oneway=True, lanes=(0,)):
    return dict(key=key, a=a, b=b, way=key, kind='primary', layer=layer,
                bridge=layer > 0, tunnel=layer < 0, oneway=oneway, lanes=lanes)


def graph(*edges):
    return RoadGraph(dict(bounds=[-100, -100, 100, 100], geographicBounds=[51.99, 5.66, 52.01, 5.68],
                          lonLatAffine=dict(lon0=5.67, lat0=52, x=[0, 100000, 0], z=[0, 0, -100000]),
                          edges=edges))


def feed(kind, records):
    return BytesIO(f'''
        <messageContainer xmlns="http://datex2.eu/schema/3/messageContainer"
                          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <payload xsi:type="{kind}">
            <publicationTime>2026-11-18T23:00:00Z</publicationTime>
            {records}
          </payload>
        </messageContainer>'''.encode())


def situation(effect, geometry, end='2026-11-18T23:04:00Z'):
    return f'''
      <situation><situationRecord>
        <validity>
          <validityStatus>definedByValidityTimeSpec</validityStatus>
          <validityTimeSpecification>
            <overallStartTime>2026-11-18T22:00:00Z</overallStartTime>
            <overallEndTime>{end}</overallEndTime>
          </validityTimeSpecification>
        </validity>
        <probabilityOfOccurrence>certain</probabilityOfOccurrence>
        <operatorActionStatus>implemented</operatorActionStatus>
        <complianceOption>mandatory</complianceOption>
        {effect}
        <locationReference><locationContainedInItinerary>
          <location>{geometry}</location>
        </locationContainedInItinerary></locationReference>
      </situationRecord></situation>'''


class EdeNdwTest(unittest.TestCase):
    def setUp(self):
        self.east = edge('east', [-40, 0], [40, 0], lanes=(-1, 1))
        self.west = edge('west', [40, 11], [-40, 11])
        self.graph = graph(self.east, self.west)
        self.now = timestamp('2026-11-18T23:01:00Z')

    def test_line_direction_coverage_and_level(self):
        self.assertEqual(self.graph.match_line([[-45, 0], [45, 0]]), ['east'])
        self.assertEqual(self.graph.match_line([[45, 0], [-45, 0]]), [])
        self.assertEqual(self.graph.match_line([[-45, 0], [-20, 0]]), [])
        stacked = graph(self.east, edge('deck', [-40, 0], [40, 0], layer=1))
        self.assertEqual(stacked.match_line([[-45, 0], [45, 0]]), [])
        self.assertEqual(stacked.match_line([[-45, 0], [45, 0]], layer=1), ['deck'])
        self.assertIsNone(stacked.detector(0, 0, heading=(1, 0)))
        self.assertEqual(stacked.detector(0, 0, heading=(1, 0), layer=1), 'deck')

    def test_expiry_and_unsupported_restrictions(self):
        line = '<gmlLineString srsName="WGS 84"><posList>52 5.66955 52 5.67045</posList></gmlLineString>'
        closure = '<roadOrCarriagewayOrLaneManagementType>carriagewayClosures</roadOrCarriagewayOrLaneManagementType>'
        lane = '<roadOrCarriagewayOrLaneManagementType>laneClosures</roadOrCarriagewayOrLaneManagementType>'
        point = '<pointByCoordinates><latitude>52</latitude><longitude>5.67</longitude></pointByCoordinates>'
        scoped_lane = '<supplementaryPositionalDescription><lane><laneUsage>busLane</laneUsage></lane></supplementaryPositionalDescription>'
        lane += '<numberOfOperationalLanes>0</numberOfOperationalLanes>'
        xml = (situation(closure, line) + situation(lane, line, '2026-11-18T23:02:00Z') + situation(closure, point)
               + situation(closure, line, 'invalid') + situation(closure, line + scoped_lane, '2026-11-18T23:03:00Z'))
        rows = read_restrictions(feed('SituationPublication', xml), self.graph, self.now, True)
        expires = timestamp('2026-11-18T23:04:00Z')
        self.assertEqual(rows, [dict(key='east', startsAt=timestamp('2026-11-18T22:00:00Z'), expiresAt=expires, closed=True)])
        self.assertEqual(read_restrictions(feed('SituationPublication', xml), self.graph, expires, True), [])
        speed = '<speedManagementType>speedRestrictionInOperation</speedManagementType><temporarySpeedLimit>30</temporarySpeedLimit>'
        xml = situation(speed, line, '2026-11-19T01:00:00Z')
        rows = read_restrictions(feed('SituationPublication', xml), self.graph, self.now, False)
        self.assertEqual([(row['key'], row['limitKmh'], row['expiresAt']) for row in rows],
                         [('east', 30, timestamp('2026-11-18T23:05:00Z'))])

    def test_observations_join_the_site_version_and_aggregate_lanes(self):
        properties = ''.join(
            f'<measurementSpecificCharacteristics index="{index}">'
            f'<specificMeasurementValueType>{kind}</specificMeasurementValueType>'
            f'<specificVehicleCharacteristics><vehicleType>anyVehicle</vehicleType></specificVehicleCharacteristics>'
            f'<specificLane><laneNumber>{lane}</laneNumber></specificLane>'
            '</measurementSpecificCharacteristics>'
            for index, kind, lane in [(1, 'trafficFlow', 1), (2, 'trafficFlow', 2),
                                      (3, 'trafficSpeed', 1), (4, 'trafficSpeed', 2)])
        site = f'''<measurementSite id="local" version="7">
          <measurementSiteNumberOfLanes>2</measurementSiteNumberOfLanes>
          {properties}
          <measurementSiteLocation><pointByCoordinates>
            <bearing>90</bearing><pointCoordinates><latitude>52</latitude><longitude>5.67</longitude></pointCoordinates>
          </pointByCoordinates></measurementSiteLocation>
        </measurementSite>'''
        sites = read_sites(feed('MeasurementSiteTablePublication', site), self.graph)
        quantities = ''.join(f'<physicalQuantity index="{i}">{quantity}</physicalQuantity>'
                             for i, quantity in enumerate((
                                 '<vehicleFlowRate>60</vehicleFlowRate>',
                                 '<vehicleFlowRate>180</vehicleFlowRate>',
                                 '<averageVehicleSpeed numberOfInputValuesUsed="1"><speed>30</speed></averageVehicleSpeed>',
                                 '<averageVehicleSpeed numberOfInputValuesUsed="3"><speed>50</speed></averageVehicleSpeed>'), 1))
        observed = '2026-11-18T22:57:00Z'
        measurement = f'''<siteMeasurements><measurementSiteReference id="local" version="7" />
          <measurementTimeDefault><timeValue>{observed}</timeValue></measurementTimeDefault>{quantities}
        </siteMeasurements>'''
        rows = read_observations(feed('MeasuredDataPublication', measurement), sites, self.now)
        self.assertEqual(rows, [dict(key='east', flowPerHour=240, speedKmh=45, observedAt=timestamp(observed),
                                     expiresAt=timestamp('2026-11-18T23:03:00Z'))])
        self.assertEqual(read_observations(feed('MeasuredDataPublication', measurement.replace('version="7"', 'version="8"')),
                                           sites, self.now), [])
        self.assertEqual(read_observations(feed('MeasuredDataPublication', measurement),
                                           sites, timestamp('2026-11-18T23:03:00Z')), [])


if __name__ == '__main__':
    unittest.main()
