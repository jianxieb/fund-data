import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_portfolio_data as portfolio
import stock_screen


class HistoryFreshnessTests(unittest.TestCase):
    def test_refresh_replaces_a_valid_but_old_stock_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / '.tmp-snap/stocks/600000.json'
            path.parent.mkdir(parents=True)
            old = {'meta': {'symbol': '600000.SS', 'currency': 'CNY'},
                   'basis': 'yahoo_adjusted_close', 'series': [['2026-10-23', 1], ['2026-10-26', 2]]}
            path.write_text(json.dumps(old))
            def renewed(code):
                data = {**old, 'series': [*old['series'], ['2026-10-28', 2.1]]}
                path.write_text(json.dumps(data))
                return data
            asset = dict(code='600000', sourceUrl='https://example.com', knownThrough='2026-10-29')
            with patch.object(portfolio, 'ROOT', root), patch.object(portfolio, 'END', '2026-10-28'), \
                    patch.object(stock_screen, 'yahoo_stock', side_effect=renewed) as fetch:
                self.assertEqual(portfolio.stock_history(asset, refresh=True)[0][-1][0], '2026-10-28')
                self.assertEqual(portfolio.stock_history(asset, refresh=True)[0][-1][0], '2026-10-28')
            fetch.assert_called_once_with('600000')

    def test_online_etf_refresh_does_not_accept_an_old_cache_as_current(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'spy.json'
            path.write_text(json.dumps({'symbol': 'SPY', 'currency': 'USD', 'source': 'fixture'}))
            old = {'2026-10-23': 1, '2026-10-26': 2}
            new = {**old, '2026-10-28': 2.1}
            with patch.object(portfolio, 'END', '2026-10-28'), \
                    patch.object(portfolio.strategy_backtest, 'cache_path', return_value=str(path)), \
                    patch.object(portfolio.strategy_backtest, 'load_history', side_effect=[old, new]) as load:
                self.assertEqual(portfolio.overseas_history('SPY', refresh=True)[0][-1][0], '2026-10-28')
            self.assertEqual(load.call_args.kwargs, {'refresh': True, 'offline': False})
            with patch.object(portfolio.strategy_backtest, 'cache_path', return_value=str(path)), \
                    patch.object(portfolio.strategy_backtest, 'load_history', return_value=old) as load:
                portfolio.overseas_history('SPY', offline=True, refresh=True)
            self.assertEqual(load.call_count, 1)


if __name__ == '__main__':
    unittest.main()
