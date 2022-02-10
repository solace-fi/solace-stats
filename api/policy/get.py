from api.utils import *


def verify_chainID(params):
    if  "chainID" not in params:
        raise InputException("Chain id must be provided")
    return str(params["chainID"])

def verify_policyID(params):
    if "policyID" not in params:
        # safe casing
        if "policyid" in params:
            params["policyID"] = params["policyid"]
        else:
            raise InputException("missing policyID") # check policy id exists
    try:
        return int(params["policyID"]) # check policy id is int
    except ValueError as e:
        raise InputException("invalid policyID '{}'".format(params["policyID"]))

def verify_params(params):
    if params is None:
        raise InputException("missing params")
    return {
        "chainID": verify_chainID(params),
        "policyID": verify_policyID(params)
    }

def get_soteria_descriptor(chainID, policyID):
    cfg = get_config(chainID)
    if cfg is None:
        return json.dumps({"description": "", "image": "https://assets.solace.fi/spt.svg", "name": f"Policy {policyID}", "attributes": []})
    
    block_number = cfg['w3'].eth.block_number
    policy_count = cfg['soteriaContract'].functions.policyCount().call(block_identifier=block_number)
   
    if policyID == 0 or policyID > policy_count:
        return json.dumps({"description": "", "image": "https://assets.solace.fi/spt.svg", "name": f"Policy {policyID}", "attributes": []})
    
    policyholder = cfg['soteriaContract'].functions.ownerOf(policyID).call(block_identifier=block_number)
    coverlimit = cfg['soteriaContract'].functions.coverLimitOf(policyID).call(block_identifier=block_number)
    balance = cfg['soteriaContract'].functions.balanceOf(policyholder).call(block_identifier=block_number)
    policy_status = cfg['soteriaContract'].functions.policyStatus(policyID).call(block_identifier=block_number)
    return json.dumps({"description": "A Solace Coverage Policy that covers user wallet", "image": "https://assets.solace.fi/spt.svg", "name": f"Policy {policyID}", "attributes": [{"policyholder": policyholder, "coverlimit": coverlimit, "account_balance": balance, "policy_status": "active" if policy_status else "passive"}]})


def handler(event, context):
    try:
        params = verify_params(event["queryStringParameters"])
        result = get_soteria_descriptor(params["chainID"], params["policyID"])
        return {
            "statusCode": 200,
            "body": result,
            "headers": headers
        }
    except InputException as e:
        return handle_error(event, e, 400)
    except Exception as e:
        return handle_error(event, e, 500)
