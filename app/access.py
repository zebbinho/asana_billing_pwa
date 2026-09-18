"""Small shared-login gate for the internal hosted trial."""
import base64
import binascii
import hmac
import os
from urllib.parse import urlsplit
from starlette.responses import JSONResponse


def hosted():
    return os.getenv('APP_ENV') == 'hosted' or os.getenv('RENDER', '').lower() == 'true'


async def trial_access(request, call_next):
    if request.url.path == '/healthz':
        return JSONResponse({'ok': True})
    if hosted():
        user = os.getenv('TEST_USERNAME', '')
        password = os.getenv('TEST_PASSWORD', '')
        if not user or len(password) < 24:
            return JSONResponse({'detail': 'Testzugang ist noch nicht eingerichtet.'}, status_code=503, headers={'Cache-Control':'no-store'})
        try:
            scheme, encoded = request.headers.get('authorization','').split(' ',1)
            if scheme.lower() != 'basic':
                raise ValueError()
            supplied_user, supplied_password = base64.b64decode(encoded,validate=True).decode('utf-8').split(':',1)
        except (ValueError, UnicodeError, binascii.Error):
            supplied_user = supplied_password = ''
        valid_user = hmac.compare_digest(supplied_user.encode(),user.encode())
        valid_password = hmac.compare_digest(supplied_password.encode(),password.encode())
        if not (valid_user and valid_password):
            return JSONResponse({'detail':'Bitte mit dem Testzugang anmelden.'},status_code=401,headers={'WWW-Authenticate':'Basic realm="apenio Mitarbeitertest", charset="UTF-8"','Cache-Control':'no-store'})
        if request.method not in ('GET','HEAD','OPTIONS'):
            origin = request.headers.get('origin','')
            expected = os.getenv('APP_ORIGIN','').rstrip('/')
            same_origin = origin == expected if expected else urlsplit(origin).netloc == request.headers.get('host') and urlsplit(origin).scheme == 'https'
            if not same_origin:
                return JSONResponse({'detail':'Anfrage bitte direkt in der Testanwendung ausführen.'},status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['Referrer-Policy'] = 'same-origin'
    if hosted():
        response.headers['Strict-Transport-Security'] = 'max-age=31536000'
    return response
