from api.utils import *

skip_addresses = [
    "0x5efC0d9ee3223229Ce3b53e441016efC5BA83435", # underwriting pool
    "0x501ACe81445C57fC438B358F861d3774199cE13c", # bond depo
]

def getCirculatingSupply():
    w3 = Web3(Web3.HTTPProvider("https://eth-mainnet.alchemyapi.io/v2/{}".format(alchemy_key)))
    solace = w3.eth.contract(address=SOLACE_ADDRESS, abi=erc20Json)
    supply = solace.functions.totalSupply().call()
    for addr in skip_addresses:
        supply -= solace.functions.balanceOf(addr).call()
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
