import sys
sys.path.insert(0, './backend')
from api.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
try:
    response = client.get('/api/products?limit=1')
    print('STATUS:', response.status_code)
    print('TEXT:', response.text)
except Exception as e:
    import traceback
    traceback.print_exc()
