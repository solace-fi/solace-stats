from api.utils import *
from datetime import datetime, timedelta

CACHE = {
    "tvl_usd": 0,
    "tvl_eth": 0,
    "lastAccess": None
}

def is_cache_available():
    if CACHE["lastAccess"] is None:
        return False
    last_access = datetime.strptime(CACHE["lastAccess"], "%Y/%m/%d, %H:%M:%S")
    delta = timedelta(hours=1)
    last_access = last_access + delta
    if datetime.now() > last_access:
        return False
    return True

def get_tvl():
    if is_cache_available() and CACHE["tvl_usd"] != 0 and CACHE["tvl_eth"] != 0:
        return {"tvl_usd": CACHE["tvl_usd"], "tvl_eth": CACHE["tvl_eth"]}
    tvl = json.loads(s3_get(S3_TVL_FILE))
    CACHE["lastAccess"] = get_timestamp()
    CACHE["tvl_usd"] = tvl["tvl_usd"]
    CACHE["tvl_eth"] = tvl["tvl_eth"]
    return tvl    

def handler(event, context):
    try:
        result = get_tvl()
        return {
            "statusCode": 200,
            "body": json.dumps(result),
            "headers": headers
        }
    except InputException as e:
        return handle_error(event, e, 400)
    except Exception as e:
        return handle_error(event, e, 500)
