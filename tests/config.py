import requests
import json
import time
import os
import jwt

from ingenium_client import shared_dict, logger, ingenium_server

# Do not use ingenium_server which may be using the host name.
server = os.environ.get('EXECUTION_MONITOR_URL', 'http://127.0.0.1:3000') 
api_path = '{0}/api/v2'.format(server)
logger.debug('api_path: %s', api_path)
shared_dict['host'] = api_path


