import asyncio
import base64
from starlette.requests import Request
from starlette.responses import Response
from app.access import trial_access


def call(path='/',auth=None,method='GET',origin=None):
    headers=[(b'host',b'test.example')]
    if auth: headers.append((b'authorization',auth.encode()))
    if origin: headers.append((b'origin',origin.encode()))
    request=Request({'type':'http','method':method,'path':path,'headers':headers,'scheme':'https','server':('test.example',443),'query_string':b''})
    async def downstream(req): return Response('protected')
    return asyncio.run(trial_access(request,downstream))


def credentials():
    return 'Basic '+base64.b64encode(b'tester:abcdefghijklmnopqrstuvwxyz123456').decode()


def test_cloud_requires_config_and_login(monkeypatch):
    monkeypatch.setenv('APP_ENV','hosted')
    monkeypatch.delenv('TEST_PASSWORD',raising=False)
    assert call().status_code==503
    assert call('/healthz').status_code==200
    monkeypatch.setenv('TEST_USERNAME','tester')
    monkeypatch.setenv('TEST_PASSWORD','abcdefghijklmnopqrstuvwxyz123456')
    for path in ('/','/api/range','/api/download/a/b/c','/api/preview/a/b/0','/docs'):
        assert call(path).status_code==401
        assert call(path,auth='Basic invalid').status_code==401
        result=call(path,auth=credentials())
        assert result.status_code==200
        assert result.headers['cache-control']=='no-store'


def test_cloud_post_checks_origin(monkeypatch):
    monkeypatch.setenv('APP_ENV','hosted')
    monkeypatch.setenv('TEST_USERNAME','tester')
    monkeypatch.setenv('TEST_PASSWORD','abcdefghijklmnopqrstuvwxyz123456')
    monkeypatch.delenv('APP_ORIGIN',raising=False)
    assert call(auth=credentials(),method='POST').status_code==403
    assert call(auth=credentials(),method='POST',origin='https://evil.example').status_code==403
    assert call(auth=credentials(),method='POST',origin='https://test.example').status_code==200


def test_local_remains_usable(monkeypatch):
    monkeypatch.delenv('APP_ENV',raising=False)
    monkeypatch.delenv('RENDER',raising=False)
    assert call().status_code==200
