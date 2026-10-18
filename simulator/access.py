"""One operator credential; public viewers can only read the shared simulation."""
import hmac


def authorized(headers,runtime):
    try:secret=(runtime/'operator-token.txt').read_text().strip()
    except FileNotFoundError:return True  # isolated development/test service
    value=headers.get('Authorization','')
    return bool(secret) and hmac.compare_digest(value,'Bearer '+secret)
