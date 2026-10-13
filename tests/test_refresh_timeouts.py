import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import refresh


class RefreshTimeouts(unittest.TestCase):
    def test_large_portfolio_has_its_own_budget_without_relaxing_other_stages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / 'data'
            calls = []

            def execute(dataset, command, timeout, offline):
                calls.append((dataset, timeout))
                return dict(dataset=dataset, status='completed', exitCode=0, seconds=0)

            with patch.object(refresh, 'ROOT', root), patch.object(refresh, 'DATA', data), \
                 patch.object(refresh, 'execute', side_effect=execute), \
                 patch('scripts.build_portfolio_data.prune'), \
                 patch('sys.argv', ['refresh.py', '--datasets', 'funds,research_funds,indices,portfolio',
                       '--timeout', '420', '--funds-timeout', '900', '--portfolio-timeout', '1200']):
                self.assertEqual(refresh.main(), 0)
            self.assertEqual(calls, [('funds', 900), ('research_funds', 900), ('indices', 420),
                                    ('portfolio', 1200), ('quality', 420)])
            self.assertFalse((root / '.tmp-snap/refresh.lock').exists())


if __name__ == '__main__':
    unittest.main()
