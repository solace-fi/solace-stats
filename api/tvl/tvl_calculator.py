from api.utils import *
import asyncio

DATA = {
    "mainnet": {
        "uwp": ["0x5efC0d9ee3223229Ce3b53e441016efC5BA83435"],
        "xslocker": ["0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"],
        "soteria": ["0x501ACEbe29eabc346779BcB5Fd62Eaf6Bfb5320E"]
    },
    "polygon": {
        "uwp": ["0xd1108a800363c262774b990e9df75a4287d5c075"],
        "xslocker": ["0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"],
        "soteria": ["0x501AcEC83d440c00644cA5C48d059e1840852a64"]
    },
    "aurora": {
        "uwp": ["0x4A6B0f90597e7429Ce8400fC0E2745Add343df78"],
        "xslocker": ["0x501Ace47c5b0C2099C4464f681c3fa2ECD3146C1"],
        "soteria": []
    }
}

ETH_PRICE = 0
SOLACE_PRICE = 0

def fetch_solace_price():
    global SOLACE_PRICE

    if SOLACE_PRICE != 0:
        return SOLACE_PRICE

    w3 = Web3(Web3.HTTPProvider("https://eth-mainnet.alchemyapi.io/v2/{}".format(alchemy_key)))
    usdc_pool = w3.eth.contract(address=w3.toChecksumAddress(SOLACE_USDC_POOL), abi=sushiswap_lp_abi)
    result = usdc_pool.functions.getReserves().call()
    usdc_amount = result[1] // 10**6
    solace_amount = result[0] // 10**18
    solace_price_usd = usdc_amount / solace_amount
    SOLACE_PRICE = solace_price_usd
    return SOLACE_PRICE

def fetch_eth_price():
    global ETH_PRICE
    
    if ETH_PRICE != 0:
        return ETH_PRICE

    for i in range(5):
        try:
            url = "https://api.zapper.fi/v1/prices/0x0000000000000000000000000000000000000000?network=ethereum&timeFrame=hour&currency=USD&api_key=96e0cc51-a62e-42ca-acee-910ea7d2a241"
            response = requests.get(url, timeout=600)
            response.raise_for_status()
            res = response.json()
            # gives prices over the last hour, average
            prices = res["prices"]
            count = 0
            s = 0
            for price in prices:
                count += 1
                s += price[1]
            price = s / count
            if price <= 1000 or price >= 10000:
                raise("price out of range")
            ETH_PRICE = price
            return ETH_PRICE
        except Exception as e:
            print(e)
    raise Exception("error fetching data")

def fetch_positions(address):
    for i in range(5):
        try:
            api_key = "96e0cc51-a62e-42ca-acee-910ea7d2a241" # only key key, public
            url = f"https://api.zapper.fi/v1/balances?api_key={api_key}&addresses[]={address}"
            response = requests.get(url, timeout=600)
            response.raise_for_status()
            return response.text
        except Exception as e:
            print(e)
    raise Exception("error fetching data")

def parse_positions(s):
    try:
        balances = []
        while True:
            index = s.find('{')
            index2 = s.find('}\n')
            if index == -1 or index2 == -1:
                break
            position = json.loads(s[index:index2+1])
            balances.append(position)
            s = s[index2+1:]
        return balances
    except Exception as e:
        raise Exception(f"Error parsing data. Error: {e}")

def clean_positions(positions, account):
    eth_price = fetch_eth_price()
    try:
        clean_positions = []
        account = account.lower()
        for position in positions:
            if 'balances' not in position:
                continue

            # filter out zero balance positions
            if len(position["balances"][account]["products"]) == 0:
                continue
            
            if position["appId"] != "tokens":
                continue
            # flatten
            balanceUSD = 0
            for pos in position["balances"][account]["products"]:
                for asset in pos["assets"]:
                    balanceUSD += asset["balanceUSD"]
            position["balanceUSD"] = balanceUSD
            position["balanceETH"] = balanceUSD / eth_price
            position.pop("balances", None)
            clean_positions.append(position)
        return clean_positions
    except Exception as e:
        raise Exception(f"error cleaning positions data. Error {e}")

def get_tvl_by_zapper(address):
    try:
        tvl_usd = 0
        tvl_eth = 0
 
        positions = fetch_positions(address)
        parsed_positions = parse_positions(positions)
        cleaned_positions = clean_positions(parsed_positions, address)
      
        for position in cleaned_positions:
            tvl_usd += position["balanceUSD"]
            tvl_eth += position["balanceETH"]
        return {"tvl_usd": tvl_usd, "tvl_eth": tvl_eth}
    except Exception as e:
        raise Exception(f"Error occurred while getting tvl value. Error: {e}")

def get_solace_balance(network, address):
    if network == "mainnet":
        w3 = Web3(Web3.HTTPProvider("https://eth-mainnet.alchemyapi.io/v2/{}".format(alchemy_key)))
        solace = w3.eth.contract(address=SOLACE_ADDRESS, abi=erc20Json)
        balance = solace.functions.balanceOf(address).call()
        balance_normalized = balance / ONE_ETHER
        return {"tvl_usd": balance_normalized * SOLACE_PRICE, "tvl_eth": (balance_normalized * SOLACE_PRICE) / ETH_PRICE}
    elif network == "polygon":
        # TODO: implemement
        return {"tvl_usd": 0, "tvl_eth": 0}
    elif network == "aurora":
        # TODO: implement
        return {"tvl_usd": 0, "tvl_eth": 0}
    else:
        return {"tvl_usd": 0, "tvl_eth": 0}

async def get_soteria_tvl(chain, addresses):
    try:
        if len(addresses) == 0:
            return {"tvl_usd": 0, "tvl_eth": 0}

        print("\n################# Soteria TVL Calculation #################")
        tvl_usd = 0
        tvl_eth = 0
        # ethereum and polygon tvl calculation via zapper api
        # TODO: need to implement for aurora
        for v in addresses:
            if chain == "aurora":
                continue

            print(f"\nCalculating tvl for Soteria address {v} in {chain} started")
            result = get_tvl_by_zapper(v)
            tvl_usd += result["tvl_usd"]
            tvl_eth += result["tvl_eth"]
            print(f"{chain}({v}): usd: {result['tvl_usd']} eth: {result['tvl_eth']}")
        return {"tvl_usd": tvl_usd, "tvl_eth": tvl_eth}  
    except Exception as e:
        raise Exception(f"Error occurred while getting tvl values for Soteria. Error: {e}")

async def get_uwp_tvl(chain, addresses):
    try:
        if len(addresses) == 0:
            return {"tvl_usd": 0, "tvl_eth": 0}

        print("\n################# Underwriting Pool TVL Calculation #################")
        tvl_usd = 0
        tvl_eth = 0
        # ethereum and polygon tvl calculation via zapper api
        # TODO: need to implement for aurora
        for v in addresses:
            if chain == "aurora":
                continue

            print(f"\nCalculating tvl for underwriting pool address {v} in {chain} started")
            result = get_tvl_by_zapper(v)
            tvl_usd += result["tvl_usd"]
            tvl_eth += result["tvl_eth"]

            solace_result = {"tvl_usd": 0, "tvl_eth": 0}
            if chain == "mainnet":
                solace_result = get_solace_balance(chain, v)
                tvl_usd += solace_result["tvl_usd"]
                tvl_eth += solace_result["tvl_eth"]
            print(f"{chain}({v}): usd: {result['tvl_usd'] + solace_result['tvl_usd']} eth: {result['tvl_eth'] + solace_result['tvl_eth']}")

        return {"tvl_usd": tvl_usd, "tvl_eth": tvl_eth}  
    except Exception as e:
        raise Exception(f"Error occurred while getting tvl values for underwriting pool. Error: {e}")

async def get_stacked_tvl(chain, addresses):
    try:
        if len(addresses) == 0:
            return {"tvl_usd": 0, "tvl_eth": 0}

        print("\n################# Staked SOLACE TVL Calculation #################")
        tvl_usd = 0
        tvl_eth = 0

        for v in addresses:
            print(f"\nCalculating tvl for staked solace address {v} in {chain} started")
            result = get_solace_balance(chain, v)
          
            print(f"{chain}({v}): usd: {result['tvl_usd']} eth: {result['tvl_eth']}")
            tvl_usd += result["tvl_usd"]
            tvl_eth += result["tvl_eth"]
        return {"tvl_usd": tvl_usd, "tvl_eth": tvl_eth}  
    except Exception as e:
        raise Exception(f"Error occurred while getting tvl values for staked solace. Error: {e}")

async def get_tvl(chain, apps: dict):
    tvl_usd = 0
    tvl_eth = 0
    for k, v in apps.items():
        result = {"tvl_usd": 0, "tvl_eth": 0}
        if k == "uwp":
            result = await get_uwp_tvl(chain, v)
        elif k == "xslocker":
            result = await get_stacked_tvl(chain, v)
        elif k == "soteria":
            result = await get_soteria_tvl(chain, v)
        else:
            print(f"Unsupported tvl operation for {k}")
            continue
        tvl_usd += result["tvl_usd"]
        tvl_eth += result["tvl_eth"]
    return {"chain": chain, "tvl_usd": tvl_usd, "tvl_eth": tvl_eth}

async def calculate_tvl():
    global ETH_PRICE
    global SOLACE_PRICE
    try:
        print("Calculating tvl has been started...")
        ETH_PRICE = fetch_eth_price()
        SOLACE_PRICE = fetch_solace_price()
        tvl_info = {}
        tasks = []
        for chain, addresses in DATA.items():
            tvl_info[chain] = {"tvl_usd": 0, "tvl_eth": 0}
            tasks.append(asyncio.create_task(get_tvl(chain, addresses)))

        completed_tasks, _ = await asyncio.wait(tasks)
        for completed_task in completed_tasks:
            result = completed_task.result()
            chain = result["chain"]
            tvl_info[chain]["tvl_usd"] += result["tvl_usd"]
            tvl_info[chain]["tvl_eth"] += result["tvl_eth"]
        print("Calculating tvl has been finished.\n")

        ETH_PRICE = 0
        SOLACE_PRICE = 0
        print(tvl_info)
        s3_put(S3_TVL_FILE, json.dumps(tvl_info))

    except Exception as e:
        print(f"Error occurred while calculating tvl: Error: {e}")

def main(event, context):
    asyncio.run(calculate_tvl())

if __name__ == '__main__':
   # main(None, None)
   chain = "x"
   tvl = json.loads(s3_get(S3_TVL_FILE))
   if chain:
       if chain in tvl:
            print({"tvl_usd": tvl[chain]["tvl_usd"], "tvl_eth": tvl[chain]["tvl_eth"]})
       else:
            print({"tvl_usd": 0, "tvl_eth": 0})
   else:
        tvl_usd = 0
        tvl_eth = 0
        for k in tvl.keys():
            tvl_usd += tvl[k]["tvl_usd"]
            tvl_eth += tvl[k]["tvl_eth"]
        print( {"tvl_usd": tvl_usd, "tvl_eth": tvl_eth})
