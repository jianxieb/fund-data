"""A-share cash dividends on the unadjusted quote's as-of share basis.

Only implemented, already disclosed actions can change the share count. The
provider's cash amount is per ten shares before that event, not an adjusted
price or a reinvested return. Keep the original cash beside its conversion.
"""
import math
from datetime import date
from update import add_years


YIELD_BASIS = '近12月已实施税前现金分红，按截至日已实施送转折为当前每股 / 同日未复权股价'


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def source_day(value, field):
    result = str(value or '')[:10]
    try:
        date.fromisoformat(result)
    except ValueError as exc:
        raise ValueError('缺有效的' + field) from exc
    return result


def source_split_factor(row):
    """BONUS_IT_RATIO is the total, not another addition to BONUS_RATIO + IT_RATIO.

    In this endpoint a present null ratio means no such distribution. Missing
    columns, invalid values or a plan that says otherwise are not zero evidence.
    """
    ratios = {}
    for key in ('BONUS_RATIO', 'IT_RATIO', 'BONUS_IT_RATIO'):
        if key not in row:
            continue
        raw = row[key]
        value = 0.0 if raw is None else number(raw)
        if value is None or value < 0:
            raise ValueError('送转比例无效：' + key)
        ratios[key] = value
    components = all(key in ratios for key in ('BONUS_RATIO', 'IT_RATIO'))
    total = ratios.get('BONUS_IT_RATIO')
    if components:
        component_total = ratios['BONUS_RATIO'] + ratios['IT_RATIO']
        if total is not None and not math.isclose(total, component_total, abs_tol=1e-8):
            raise ValueError('送转总比例与送股、转增分项不一致')
        total = component_total
    if total is None:
        raise ValueError('缺已实施送股、转增比例')
    plan = str(row.get('IMPL_PLAN_PROFILE') or '')
    if total == 0 and any(word in plan for word in ('送', '转')) and '不分配不转增' not in plan:
        raise ValueError('方案含送转但缺对应比例')
    return 1 + total / 10


def source_cash(row):
    raw = row.get('PRETAX_BONUS_RMB')
    cash = number(raw)
    if cash is not None and cash >= 0:
        return cash / 10
    # The endpoint represents a pure bonus/capitalization with a null cash
    # column. The explicit implementation plan must corroborate no cash leg.
    plan = str(row.get('IMPL_PLAN_PROFILE') or '')
    if raw is None and plan and '派' not in plan and (
            '不分配不转增' in plan or (('送' in plan or '转' in plan) and source_split_factor(row) > 1)):
        return 0.0
    raise ValueError('缺已实施每10股税前现金分红金额')


def eastmoney_dividend_summary(rows, asof, price, code=None):
    """Return trailing cash yield and fiscal payout count without future actions.

    A cash payment made on a bonus ex-date uses the pre-action share count and
    therefore includes that day's share factor. Actions before a payment do not
    adjust it; actions after the requested cutoff never adjust any payment.
    """
    date.fromisoformat(asof)
    if number(price) is None or price <= 0:
        raise ValueError('股息率需要同日未复权正股价')
    cutoff = add_years(asof, -1)
    current_year = int(asof[:4])
    paid = {}
    for row in rows:
        if code is not None and str(row.get('SECURITY_CODE')) != code:
            raise ValueError('分红证券身份不符：' + code)
        if not row.get('ASSIGN_PROGRESS'):
            raise ValueError('缺分红实施状态')
        if row.get('ASSIGN_PROGRESS') != '实施分配':
            continue
        ex_date = source_day(row.get('EX_DIVIDEND_DATE'), '分红除权日')
        if ex_date > asof:
            continue
        notice = source_day(row.get('NOTICE_DATE'), '分红实施公告日')
        if notice > asof:
            continue
        fiscal = source_day(row.get('REPORT_DATE'), '分红所属报告期')
        if fiscal > asof:
            continue
        if ex_date <= cutoff and int(fiscal[:4]) < current_year - 5:
            continue
        cash = source_cash(row)
        # Old ratios outside the cash window cannot change any trailing payment.
        factor = source_split_factor(row) if ex_date > cutoff else 1.0
        event = {'exDate': ex_date, 'fiscalPeriod': fiscal, 'cashPerShare': cash, 'splitFactor': factor}
        key = (ex_date, fiscal)
        if key in paid and paid[key] != event:
            raise ValueError('同一除权日及报告期的分红/送转记录冲突')
        paid[key] = event
    actions = {}
    for row in paid.values():
        if row['splitFactor'] == 1:
            continue
        day, factor = row['exDate'], row['splitFactor']
        if day in actions and not math.isclose(actions[day], factor, abs_tol=1e-10):
            raise ValueError('同日送转比例冲突，无法确定股数转换')
        # One share-count change must not be multiplied once per fiscal record.
        actions[day] = factor
    records = []
    for row in sorted(paid.values(), key=lambda r: (r['exDate'], r['fiscalPeriod'])):
        if not cutoff < row['exDate'] <= asof:
            continue
        factor = math.prod(value for day, value in actions.items() if row['exDate'] <= day <= asof)
        records.append({**row, 'adjustmentFactor': factor, 'currentCashPerShare': row['cashPerShare'] / factor})
    cash12 = sum(row['currentCashPerShare'] for row in records)
    years = {row['fiscalPeriod'][:4] for row in paid.values()
             if row['cashPerShare'] > 0 and current_year - 5 <= int(row['fiscalPeriod'][:4]) < current_year}
    return {'yield12': round(cash12 / price * 100, 2), 'divYears': len(years),
            'cashDividend12': cash12, 'dividendBasis': YIELD_BASIS,
            'dividendCashRecords': records,
            'dividendShareActions': [{'exDate': day, 'factor': factor} for day, factor in sorted(actions.items())],
            'dividendMissing': None}


def missing_dividend_summary(reason):
    return {'yield12': None, 'divYears': None, 'cashDividend12': None,
            'dividendBasis': YIELD_BASIS, 'dividendCashRecords': [],
            'dividendShareActions': [], 'dividendMissing': str(reason)}


def yahoo_dividend_summary(dividends, splits, asof, price):
    """Do not re-adjust Yahoo cash without verified per-event share basis.

    Its adjusted close is already used for total returns elsewhere. Changing
    that history, or adding dividend yield to those returns, would double count.
    """
    date.fromisoformat(asof)
    cutoff = add_years(asof, -1)
    missing = None
    if any(cutoff < row['date'] <= asof for row in splits):
        missing = '近12月有拆股或送转，Yahoo分红缺统一股本口径'
    amounts = [number(row.get('amount')) for row in dividends if cutoff < row['date'] <= asof]
    if any(value is None or value < 0 for value in amounts):
        missing = 'Yahoo缺有效的每股现金分红金额'
    cash12 = sum(amounts) if missing is None else None
    return {'yield12': round(cash12 / price * 100, 2) if cash12 is not None else None,
            'divYears': None, 'cashDividend12': cash12,
            'dividendBasis': 'Yahoo近12月现金分红 / 未复权股价；窗口内无已收录拆股或送转',
            'dividendMissing': missing}


def update_dividend_fields(row, summary):
    """Only the dividend result and dependent high-dividend label may change."""
    row.update(summary)
    styles = [style for style in row.get('style', []) if style != '高股息']
    if (summary['yield12'] is not None and summary['yield12'] >= 3.2
            and summary['divYears'] is not None and summary['divYears'] >= 4):
        styles.append('高股息')
    row['style'] = styles
    return row
