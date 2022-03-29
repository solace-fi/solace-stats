from api.utils import *

def get_tvl(chain):
    tvl = json.loads(s3_get(S3_TVL_FILE))
    print(tvl)
    print(chain)
    if chain:
        if chain in tvl:
            return {"tvl_usd": tvl[chain]["tvl_usd"], "tvl_eth": tvl[chain]["tvl_eth"]}
        return {"tvl_usd": 0, "tvl_eth": 0}
    else:
        tvl_usd = 0
        tvl_eth = 0
        for k in tvl.keys():
            tvl_usd += tvl[k]["tvl_usd"]
            tvl_eth += tvl[k]["tvl_eth"]
        return {"tvl_usd": tvl_usd, "tvl_eth": tvl_eth}

def handler(event, context):
    try:
        params = event["queryStringParameters"]
        result: any
        if params and "chain" in params:
            result = get_tvl(params["chain"])
        else:
            result = get_tvl(None)

        return {
            "statusCode": 200,
            "body": json.dumps(result),
            "headers": headers
        }
    except InputException as e:
        return handle_error(event, e, 400)
    except Exception as e:
        return handle_error(event, e, 500)
