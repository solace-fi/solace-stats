from api.utils import *

def getCirculatingSupply():
    w3 = Web3(Web3.HTTPProvider("https://eth-mainnet.alchemyapi.io/v2/{}".format(alchemy_key)))
    solace = w3.eth.contract(address=SOLACE_ADDRESS, abi=erc20Json)
    blocknum = w3.eth.blockNumber
    supply = solace.functions.totalSupply().call(block_identifier=blocknum)
    skip_addresses = json.loads(s3_get("SOLACE/circulatingSupply/skip_addresses.json", cache=True))
    for addr in skip_addresses:
        supply -= solace.functions.balanceOf(addr).call(block_identifier=blocknum)
    supplyNormalized = supply / ONE_ETHER
    return supplyNormalized

def handler(event, context):
    try:
        supply = getCirculatingSupply()
        return {
            "statusCode": 200,
            "body": supply,
            "headers": headers
        }
    except InputException as e:
        return handle_error(event, e, 400)
    except Exception as e:
        return handle_error(event, e, 500)
