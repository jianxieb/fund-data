"""Current-rate expense addback scenarios. Published NAV is already net of fees."""
import json
import math
from datetime import datetime
from pathlib import Path

CATALOG = json.loads((Path(__file__).parent / 'data/overseas-etf-catalog.json').read_text(encoding='utf-8'))
ETFS = {item['symbol']: item for item in CATALOG['products']}


def fee_metadata(symbol):
    product = ETFS[symbol]
    # Product facts must not overwrite the market-data source on a return row.
    facts = {key: value for key, value in product.items() if key != 'sourceUrl'}
    return {**facts, 'identityUrl': product['sourceUrl'], 'feeCheckedAt': CATALOG['checkedAt'],
            'feeSourceUrl': product['sourceUrl'], 'feesEmbedded': True,
            'feeEstimateMethod': 'current_rate_daily_accrual_scenario'}


def addback_factor(rate_percent, start, end):
    """Undo daily expense drag over actual calendar days; this is an estimate.

    Fixed 365.2425-day scenario shared with the browser model. No subtraction
    from already-net prices. It does not restore financing or trading costs.
    """
    if not isinstance(rate_percent, (int, float)) or not math.isfinite(rate_percent) or not 0 <= rate_percent < 100:
        raise ValueError('缺有效持续年费率')
    days = (datetime.strptime(end, '%Y-%m-%d') - datetime.strptime(start, '%Y-%m-%d')).days
    if days < 0:
        raise ValueError('费率估算区间无效')
    return math.exp(-days * math.log1p(-rate_percent / 100 / 365.2425))


def before_fee_prices(dates, prices, symbol):
    product = ETFS[symbol]
    rate = product.get('feeAddbackRate', product['expenseRatio'])
    return [price * addback_factor(rate, dates[0], day) for day, price in zip(dates, prices)]
