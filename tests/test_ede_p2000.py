"""Verify P2000 date handling, routing inputs and filtering."""

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from xml.etree.ElementTree import Element, SubElement, tostring


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from ede_p2000 import read_p2000_xml, recent_p2000


def ms(hour, minute, second=0):
    return int(datetime(2026, 11, 22, hour, minute, second, tzinfo=timezone.utc).timestamp() * 1000)


def item(category, path, message='', date='Sun, 22 Nov 2026 21:15:48 Z'):
    return {'category': category, 'link': 'https://112-nu.nl/melding/' + path,
            'pubDate': date, 'title': message}


def feed(*items):
    root = Element('rss')
    channel = SubElement(root, 'channel')
    for row in items:
        entry = SubElement(channel, 'item')
        for tag, content in row.items():
            SubElement(entry, tag).text = content
    return tostring(root)


class P2000Test(unittest.TestCase):
    def test_only_reports_coarse_location_for_fresh_alerts(self):
        xml = feed(
            item('AMB', '1/ede/ambulance.html', 'A1 Ambu 07119 - Ede Rit 123456'),
            item('AMB', '2/harskamp/ambulance.html', 'A2 Ambu 07119 VWS Rit 123457'),
            item('AMB', '3/ede/ambulance.html', 'A1 Ambu 07119 Rit 123456', 'Sun, 22 Nov 2026 21:16:00 Z'),
            item('AMB', '4/ede/ambulance.html', 'B1 Ambu 07119 Ede Rit 123458'),
            item('POL', '5/ede/straat-77/politie.html', 'P1 Melding 77'),
            item('BRA', '6/lunteren/edeseweg/brandweer.html', 'P1 Gebouw B1'),
            item('BRA', '7/lunteren/edeseweg/brandweer.html', 'Intrekken Alarm'),
            item('POL', '8/ede/politie.html', date='Sun, 22 Nov 2026 21:00:00 Z'),
            item('POL', '9/ede/politie.html', date='Sun, 22 Nov 2026 22:15:48 Z'),
            item('POL', '10/arnhem/politie.html'),
            item('LFL', '11/ede/heli.html'),
        )
        alerts = read_p2000_xml(xml, ms(20, 18))
        self.assertEqual([{k: v for k, v in alert.items() if k != 'id'} for alert in alerts], [
            {'service': 'ambulance', 'place': 'ede', 'publishedAt': ms(20, 15, 48)},
            {'service': 'police', 'place': 'ede', 'publishedAt': ms(20, 15, 48)},
            {'service': 'fire', 'place': 'lunteren', 'street': 'edeseweg', 'publishedAt': ms(20, 15, 48)},
        ])
        self.assertEqual(len({alert['id'] for alert in alerts}), 3)
        self.assertFalse(recent_p2000(alerts[0]['publishedAt'], ms(20, 25, 49)))

    def test_explicit_rss_offset_and_encoded_street(self):
        xml = feed(item('BRA', '1/ede/caf%C3%A9straat/brandweer.html', date='Sun, 22 Nov 2026 21:18:00 +0100'))
        alert, = read_p2000_xml(xml, ms(20, 18))
        self.assertEqual(alert['publishedAt'], ms(20, 18))
        self.assertEqual(alert['street'], 'caféstraat')
