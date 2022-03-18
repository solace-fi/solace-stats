from api.utils import *

def getTotalSupply():
    w3 = Web3(Web3.HTTPProvider("https://eth-mainnet.alchemyapi.io/v2/{}".format(alchemy_key)))
    xsolace = w3.eth.contract(address=xSOLACEv1_ADDRESS, abi=erc20Json)
    supply = xsolace.functions.totalSupply().call()
    supplyNormalized = supply / ONE_ETHER
    return supplyNormalized

def handler(event, context):
    try:
        supply = getTotalSupply()
        return {
            "statusCode": 200,
            "body": supply,
            "headers": headers
        }
    except InputException as e:
        return handle_error(event, e, 400)
    except Exception as e:
        return handle_error(event, e, 500)
