"""Prospective quality vetoes; positive historical cash is not a renewal decision."""
from company_quality import finite

FROM = '2026-10-23'


def operating_trend(quarters, period, basis):
    """Compare adjacent single quarters with their own prior-year quarters."""
    rows = sorted((q for q in quarters if q['period'] <= period), key=lambda q: q['period'])[-2:]
    month = lambda p: int(p[:4]) * 12 + int(p[5:7])
    complete = (len(rows) == 2 and rows[-1]['period'] == period
                and month(rows[1]['period']) - month(rows[0]['period']) == 3)
    missing = [] if complete else ['缺截至' + period + '的两个相邻单季核心盈利记录']
    observations = []
    for q in rows:
        for key, label in [('profit', basis), ('revenue', '营业收入'),
                           ('profitPrevious', '上年同季' + basis), ('revenuePrevious', '上年同季营业收入')]:
            if not finite(q.get(key)):
                missing.append(q['period'] + '缺' + label)
            elif q[key] <= 0:
                missing.append(q['period'] + label + '非正')
        if all(finite(q.get(k)) and q[k] > 0 for k in ('profit', 'revenue', 'profitPrevious', 'revenuePrevious')):
            margin = q['profit'] / q['revenue'] * 100
            previous_margin = q['profitPrevious'] / q['revenuePrevious'] * 100
            observations.append({**q, 'profitGrowth': (q['profit'] / q['profitPrevious'] - 1) * 100,
                                 'margin': margin, 'previousMargin': previous_margin,
                                 'marginChangePp': margin - previous_margin})
    deteriorating = complete and len(observations) == 2 and all(
        q['profitGrowth'] < 0 and q['marginChangePp'] < 0 for q in observations)
    reason = '；'.join(dict.fromkeys(missing)) if missing else (
        '连续两季核心盈利与利润率均同比下降：' + '；'.join(
            '%s盈利%+.2f%%、利润率%+.2f个百分点' % (q['period'], q['profitGrowth'], q['marginChangePp'])
            for q in observations) if deteriorating else None)
    return {'basis': basis, 'period': period, 'quarters': observations,
            'status': 'missing' if missing else 'deteriorating' if deteriorating else 'clear',
            'qualified': not missing and not deteriorating, 'reason': reason}


def quality_checks(record, trend, asof, source_urls):
    unresolved = []
    for challenge in record.get('qualityChallenges', []):
        resolved = (challenge.get('status') == 'resolved' and challenge.get('resolution')
                    and challenge.get('openedAt', '') <= challenge.get('resolvedAt', '') <= asof
                    and bool(challenge.get('resolutionSourceUrls'))
                    and set(challenge['resolutionSourceUrls']) <= source_urls)
        if not resolved:
            unresolved.append(challenge.get('question') or '缺重大竞争风险的具体问题及关闭证据')
    ok = bool(trend) and trend['qualified']
    return [
        {'label': '最近两季核心盈利及利润率可比，未连续同时同比下降', 'pass': ok,
         'reason': None if ok else (trend or {}).get('reason') or '缺最近两季核心盈利、收入及上年同季金额'},
        {'label': '已登记的重大竞争与经营质疑均有本期关闭证据', 'pass': not unresolved,
         'reason': '尚未解决：' + '；'.join(unresolved) if unresolved else None},
    ]
