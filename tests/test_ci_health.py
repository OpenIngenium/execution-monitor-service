import xmlrunner
import os
import sys
import unittest
import requests
import json
import random
from config import shared_dict, logger



class HealthTest(unittest.TestCase):
    def setUp(self):
        pass

    def tearDown(self):
        pass

    def test_health(self):
        url = '{0}/health'.format(shared_dict['host'])

        logger.debug('GET url=%s', url)
        headers = {'Content-Type': 'application/json',
                      'Accept': 'application/json'}

        result = requests.get(url, headers=headers)
        logger.debug('result.text: %s', result.text)
        self.assertEqual(result.status_code, 200)
        res_dict = json.loads(result.text)
        json.dumps(res_dict, indent=4)
        self.assertEqual(res_dict['status'], 'OK')

if __name__ == '__main__':
    unittest.main(testRunner=xmlrunner.XMLTestRunner(output="./test-reports/"))
