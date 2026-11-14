import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import market_history as mh
from scripts import publish_refresh


class MarketHistoryPublicationTests(unittest.TestCase):
    def setUp(self):
        self.published = json.loads(mh.OUTPUT.read_text())

    def test_referenced_sources_require_a_complete_hex_sha256(self):
        section = self.published['markets'][0]
        metric = next(m for m in section['metrics'] if m['id'] == 'pe')
        sources = {metric['source'], *metric.get('dependencies', []),
                   section['prices']['source'], *self.published['crossChecks'][0]['sources']}
        for key in sources:
            for digest in (None, '', 'a' * 63, 'a' * 65, 'g' * 64, 123, 'a' * 64 + '\n'):
                with self.subTest(source=key, digest=digest):
                    data = copy.deepcopy(self.published)
                    data['sources'][key]['sha256'] = digest
                    with self.assertRaisesRegex(ValueError, '(?:source|publication evidence) SHA-256'):
                        mh.validate(data)
        data = copy.deepcopy(self.published)
        del data['sources'][metric['source']]['sha256']
        with self.assertRaisesRegex(ValueError, '(?:source|publication evidence) SHA-256'):
            mh.validate(data)

    def test_close_source_is_checked_even_without_a_metric_dependency(self):
        data = copy.deepcopy(self.published)
        data['markets'][0]['close']['source'] = 'independent-close'
        data['sources']['independent-close'] = {'sha256': None}
        with self.assertRaisesRegex(ValueError, 'independent-close: source SHA-256'):
            mh.validate(data)
        data['sources']['independent-close']['sha256'] = 'ABCDEF0123456789' * 4
        # Unused catalogue entries are not part of the published evidence.
        data['sources']['unused-source'] = {'sha256': None}
        mh.validate(data)

    def test_publication_runs_the_real_history_check_and_stops_on_invalid_evidence(self):
        run_command = publish_refresh.command
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            for name in ('market_history.py', 'market_history_pe.py', 'data_status.py', 'scripts/collect_portfolio_benchmark_pe.py'):
                destination = root / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(mh.ROOT / name, destination)
            for valid in (True, False):
                data = copy.deepcopy(self.published)
                if not valid:
                    key = data['markets'][0]['metrics'][0]['source']
                    data['sources'][key]['sha256'] = ''
                (root / 'data/market-history.json').write_text(json.dumps(data))
                calls = []

                def run_history_only(args, command_root):
                    calls.append(args)
                    if args[1:] == ['market_history.py', '--check']:
                        return run_command(args, command_root, capture=True)

                with self.subTest(valid=valid), patch.object(publish_refresh, 'command', side_effect=run_history_only), \
                        patch.object(publish_refresh, 'test_generated_data'):
                    if valid:
                        publish_refresh.validate_outputs(root)
                        self.assertIn(['npm', 'run', 'check'], calls)
                    else:
                        with self.assertRaisesRegex(RuntimeError, '(?:source|publication evidence) SHA-256'):
                            publish_refresh.validate_outputs(root)
                        self.assertNotIn(['npm', 'run', 'version-assets'], calls)
                    self.assertEqual(sum(args[1:] == ['market_history.py', '--check'] for args in calls), 1)


if __name__ == '__main__':
    unittest.main()
