import unittest
from datetime import datetime, timezone

import strategy_backtest as source


class ExchangeDailyClose(unittest.TestCase):
    def chart(self, close_hour=20):
        stamp = lambda day, hour: int(datetime(2026, 10, day, hour, 30 if hour == 13 else 0,
                                              tzinfo=timezone.utc).timestamp())
        return dict(meta=dict(symbol='SPY', currency='USD', exchangeTimezoneName='America/New_York',
                        currentTradingPeriod={'regular': {'start': stamp(13, 13), 'end': stamp(13, close_hour)}}),
                    timestamp=[stamp(12, 13), stamp(13, 13)],
                    indicators={'adjclose': [{'adjclose': [100, 101]}]})

    def normalize(self, node, hour, minute=0):
        return source.normalize_chart(node, 'SPY', 'https://finance.yahoo.com/quote/SPY/history/',
            max_day='2026-10-13', observed_at=datetime(2026, 10, 13, hour, minute, tzinfo=timezone.utc))

    def test_beijing_next_day_does_not_make_an_open_us_session_a_daily_close(self):
        result = self.normalize(self.chart(), 17)
        self.assertEqual([r['date'] for r in result['data']], ['2026-10-12'])
        self.assertEqual(result['missingObservations'][-1]['reason'], 'unclosed_exchange_session')
        self.assertTrue(result['closedSessionsOnly'])

    def test_source_exchange_close_including_early_close_makes_the_bar_available(self):
        self.assertEqual(self.normalize(self.chart(), 20, 1)['data'][-1]['date'], '2026-10-13')
        self.assertEqual(self.normalize(self.chart(close_hour=17), 17, 1)['data'][-1]['date'], '2026-10-13')

    def test_current_day_without_close_time_evidence_is_omitted(self):
        node = self.chart()
        node['meta'].pop('currentTradingPeriod')
        self.assertEqual(len(self.normalize(node, 20, 1)['data']), 1)


if __name__ == '__main__':
    unittest.main()
