import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts import build_condition_vix as vix

RAW = ('DATE,OPEN,HIGH,LOW,CLOSE\n'
       '01/02/1990,17.240000,17.240000,17.240000,17.240000\n'
       '01/03/1990,18.190000,18.190000,18.190000,18.190000\n'
       '01/04/1990,19.220000,19.220000,19.220000,19.220000\n')
AFTER_CLOSE = datetime(1990, 1, 4, 23, tzinfo=timezone.utc)  # 18:00 in New York


def saved(raw=RAW, fetched=AFTER_CLOSE):
    return {'sourceUrl': vix.SOURCE_URL, 'fetchedAt': fetched.isoformat(), 'sha256': vix.digest(raw), 'raw': raw}


class ConditionVixTests(unittest.TestCase):
    def test_closes_keep_cboe_dates_and_values_and_bad_rows_are_named(self):
        series, missing = vix.parse('﻿' + RAW + '01/05/1990,1,1,1,\n', datetime(1990, 1, 6, tzinfo=timezone.utc))
        self.assertEqual(series, [['1990-01-02', 17.24], ['1990-01-03', 18.19], ['1990-01-04', 19.22]])
        self.assertEqual(missing, [{'date': '1990-01-05', 'reason': 'missing_or_invalid_close'}])
        for bad, message in [(RAW.replace('CLOSE', 'SETTLE'), '表头'), (RAW + '01/03/1990,1,1,1,1\n', '倒序'),
                             (RAW + '13/40/1990,1,1,1,1\n', '日期'), (RAW + '01/08/1990,1,1\n', '字段数'),
                             ('DATE,OPEN,HIGH,LOW,CLOSE\n01/02/1990,1,1,1,1\n', '少于两个')]:
            with self.assertRaisesRegex(ValueError, message):
                vix.parse(bad, datetime(1990, 2, 1, tzinfo=timezone.utc))

    def test_a_row_for_the_fetch_day_waits_until_the_close_has_settled(self):
        before = datetime(1990, 1, 4, 20, tzinfo=timezone.utc)  # 15:00 in New York
        self.assertEqual(vix.parse(RAW, before)[0][-1][0], '1990-01-03')
        self.assertEqual(vix.parse(RAW, AFTER_CLOSE)[0][-1][0], '1990-01-04')

    def test_build_publishes_a_verified_file_and_an_unchanged_recheck_keeps_the_original_time(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.multiple(vix, ROOT=root, OUT=root / 'data' / 'condition-study', CACHE=root / 'cache'):
                with patch.object(vix, 'source', return_value=saved()):
                    first = vix.build(refresh=True)
                self.assertEqual((first['status'], first['first'], first['asOf'], first['observations']), ('available', '1990-01-02', '1990-01-04', 3))
                self.assertEqual(vix.check(), first)
                history = json.loads((root / first['historyUrl']).read_text())
                self.assertEqual(history['series'][-1], ['1990-01-04', 19.22])
                self.assertEqual(history['sourceSha256'], vix.digest(RAW))
                later = saved(fetched=datetime(1990, 1, 5, 1, tzinfo=timezone.utc))
                with patch.object(vix, 'source', return_value=later):
                    again = vix.build(refresh=True)
                self.assertEqual(again, first)
                grown = saved(RAW + '01/05/1990,20.110000,20.110000,20.110000,20.110000\n', datetime(1990, 1, 6, tzinfo=timezone.utc))
                with patch.object(vix, 'source', return_value=grown):
                    newer = vix.build(refresh=True)
                self.assertEqual(newer['asOf'], '1990-01-05')
                self.assertFalse((root / first['historyUrl']).exists(), 'a superseded file is removed after the new catalog')

    def test_failed_or_shrunken_refresh_keeps_the_last_closes_their_times_and_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.multiple(vix, ROOT=root, OUT=root / 'data' / 'condition-study', CACHE=root / 'cache'):
                with patch.object(vix, 'source', return_value=saved()):
                    original = vix.build(refresh=True)
                path = root / original['historyUrl']
                before = path.read_bytes()
                with patch.object(vix, 'source', side_effect=TimeoutError('source timed out')):
                    kept = vix.build(refresh=True)
                self.assertEqual((kept['sha256'], kept['asOf'], kept['fetchedAt']), (original['sha256'], original['asOf'], original['fetchedAt']))
                self.assertIn('timed out', kept['refreshMissing'])
                shrunk = saved(RAW.replace('01/03/1990,18.190000,18.190000,18.190000,18.190000\n', ''))
                with patch.object(vix, 'source', return_value=shrunk):
                    kept = vix.build(refresh=True)
                self.assertIn('缺少已保存', kept['refreshMissing'])
                self.assertEqual(path.read_bytes(), before)
                vix.check()
                path.write_text('{}')
                with patch.object(vix, 'source', side_effect=TimeoutError('source timed out')):
                    broken = vix.build(refresh=True)
                self.assertEqual(broken['status'], 'unavailable')
                self.assertIn('旧记录无效', broken['missing'])

    def test_saved_raw_evidence_must_match_its_hash_and_source(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            with patch.object(vix, 'CACHE', cache):
                with self.assertRaisesRegex(ValueError, '缺已保存'):
                    vix.source(offline=True)
                record = saved()
                (cache / vix.CACHE_NAME).write_text(json.dumps(record))
                self.assertEqual(vix.source(offline=True)['raw'], RAW)
                (cache / vix.CACHE_NAME).write_text(json.dumps({**record, 'raw': RAW + '01/05/1990,1,1,1,1\n'}))
                with self.assertRaisesRegex(ValueError, '哈希'):
                    vix.source(offline=True)


if __name__ == '__main__':
    unittest.main()
