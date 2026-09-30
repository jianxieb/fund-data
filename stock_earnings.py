"""Accounting bridges, not estimates of permanent earnings or causal price effects.

Amounts are CNY yuan. A unit bridge requires comparable SALES quantities and a
price/cost in yuan per the same unit; production cannot stand in for sales.
"""
import math


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def margin_bridge(previous, current):
    """Exact revenue-scale / gross-margin identity, with current revenue weighting."""
    values = [r.get(k) for r in (previous, current) for k in ('revenue', 'cost')]
    if not all(finite(v) for v in values) or min(previous['revenue'], current['revenue']) <= 0:
        return None
    r0, c0, r1, c1 = values
    m0, m1 = (r0 - c0) / r0, (r1 - c1) / r1
    return {'previousGrossProfit': r0 - c0, 'currentGrossProfit': r1 - c1,
            'revenueScaleEffect': (r1 - r0) * m0,
            'marginEffect': r1 * (m1 - m0), 'grossProfitChange': r1 - c1 - r0 + c0}


def unit_bridge(record):
    """Volume at old unit margin, price/mix and unit cost at current sales volume."""
    if record.get('quantityBasis') != 'sales' or not record.get('comparable'):
        return None
    if record.get('quantityUnit') != record.get('priceQuantityUnit'):
        return None
    a, b = record.get('previous', {}), record.get('current', {})
    values = [r.get(k) for r in (a, b) for k in ('quantity', 'price', 'unitCost')]
    if not all(finite(v) for v in values) or min(a['quantity'], b['quantity']) <= 0:
        return None
    q0, p0, c0, q1, p1, c1 = values
    gp0, gp1 = q0 * (p0 - c0), q1 * (p1 - c1)
    return {'label': record['label'], 'volumeEffect': (q1 - q0) * (p0 - c0),
            'priceMixEffect': q1 * (p1 - p0), 'unitCostEffect': -q1 * (c1 - c0),
            'previousGrossProfit': gp0, 'currentGrossProfit': gp1, 'grossProfitChange': gp1 - gp0}


def profit_bridge(previous, current):
    """Reconcile GP to core parent profit; never call GP growth net-profit growth."""
    keys = ('revenue', 'cost', 'profitBeforeTax', 'incomeTax', 'netProfit', 'deductedProfit')
    if not all(finite(r.get(k)) for r in (previous, current) for k in keys):
        return None
    def parts(r):
        gp = r['revenue'] - r['cost']
        consolidated_net = r['profitBeforeTax'] - r['incomeTax']
        return [gp, r['profitBeforeTax'] - gp, -r['incomeTax'],
                r['netProfit'] - consolidated_net, r['deductedProfit'] - r['netProfit']]
    changes = [b - a for a, b in zip(parts(previous), parts(current))]
    return {'grossProfitChange': changes[0], 'otherProfitEffect': changes[1],
            'taxEffect': changes[2], 'minorityEffect': changes[3], 'nonRecurringEffect': changes[4],
            'coreProfitChange': current['deductedProfit'] - previous['deductedProfit']}


def contribution_residual(total, contribution, previous):
    """Subtract a disclosed attributable contribution; never apply ownership twice."""
    if not all(finite(v) for v in (total, contribution, previous)):
        return None
    residual = total - contribution
    return {'residual': residual, 'growth': (residual / previous - 1) * 100 if previous > 0 else None}
