import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import publish_refresh as publisher


class RefreshPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.remote = self.folder / 'origin.git'
        self.runner = self.folder / 'runner'
        self.editor = self.folder / 'editor'
        self.run_git(self.folder, 'init', '--bare', str(self.remote))
        self.run_git(self.folder, 'init', '-b', 'main', str(self.runner))
        self.run_git(self.runner, 'config', 'user.name', 'Test editor')
        self.run_git(self.runner, 'config', 'user.email', 'test@example.invalid')
        for name, value in {
            'index.html': 'original page\n', 'data/snapshot.js': 'old data\n',
            'data/portfolio/old.json': 'old history\n', 'AGENTS.md': 'old instructions\n',
            'README.md': 'old readme\n', 'collector.py': 'old source\n',
        }.items():
            self.write(self.runner, name, value)
        self.run_git(self.runner, 'add', '.')
        self.run_git(self.runner, 'commit', '-m', 'initial')
        self.run_git(self.runner, 'remote', 'add', 'origin', str(self.remote))
        self.run_git(self.runner, 'push', '-u', 'origin', 'main')
        self.run_git(self.folder, 'clone', '--branch', 'main', str(self.remote), str(self.editor))
        self.run_git(self.editor, 'config', 'user.name', 'Test editor')
        self.run_git(self.editor, 'config', 'user.email', 'test@example.invalid')
        self.write(self.runner, 'data/snapshot.js', 'fresh data\n')
        self.write(self.runner, 'data/portfolio/new.json', 'new history\n')
        (self.runner / 'data/portfolio/old.json').unlink()
        self.write(self.runner, 'index.html', 'original page with generated hash\n')
        self.validations = []
        self.recomputations = []

    @staticmethod
    def run_git(root, *args):
        return subprocess.run(['git', *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()

    @staticmethod
    def write(root, name, value):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    def remote_commit(self, name, value):
        self.write(self.editor, name, value)
        self.run_git(self.editor, 'add', name)
        self.run_git(self.editor, 'commit', '-m', 'concurrent ' + name)
        self.run_git(self.editor, 'push', 'origin', 'main')

    def validate(self, root):
        self.validations.append(self.run_git(root, 'rev-parse', 'HEAD'))
        self.assertTrue((root / 'data/snapshot.js').read_text().startswith('fresh'))
        page = (root / 'index.html').read_text()
        self.write(root, 'index.html', page + 'validated asset hash\n')

    def recompute(self, root):
        self.recomputations.append(self.run_git(root, 'rev-parse', 'HEAD'))
        self.assertEqual((root / 'data/snapshot.js').read_text(), 'old data\n')
        self.assertFalse((root / 'data/portfolio/new.json').exists())
        self.assertTrue((root / 'data/portfolio/old.json').exists())
        self.write(root, 'data/snapshot.js', 'fresh data from new source\n')

    def publish(self, **kwargs):
        return publisher.publish(self.runner, validate=kwargs.pop('validate', self.validate),
                                 recompute=kwargs.pop('recompute', self.recompute),
                                 run_id='test-run', **kwargs)

    def remote_file(self, name):
        return self.run_git(self.folder, '--git-dir=' + str(self.remote), 'show', 'main:' + name)

    def test_two_document_commits_during_validation_preserve_data_and_both_edits(self):
        self.remote_commit('AGENTS.md', 'new instructions\n')

        def validate(root):
            self.validate(root)
            if len(self.validations) == 1:
                self.remote_commit('README.md', 'new readme\n')

        self.assertTrue(self.publish(validate=validate))
        self.assertEqual(self.recomputations, [])
        self.assertEqual(len(self.validations), 2)
        self.assertEqual(self.remote_file('AGENTS.md'), 'new instructions')
        self.assertEqual(self.remote_file('README.md'), 'new readme')
        self.assertEqual(self.remote_file('data/snapshot.js'), 'fresh data')
        self.assertEqual(self.remote_file('data/portfolio/new.json'), 'new history')
        self.assertEqual(self.run_git(self.runner, 'status', '--porcelain'), '')

    def test_latest_page_is_preserved_and_its_hashes_are_regenerated(self):
        self.remote_commit('index.html', 'new page layout\n')
        self.assertTrue(self.publish())
        self.assertEqual(self.recomputations, [])
        self.assertEqual(self.remote_file('index.html'), 'new page layout\nvalidated asset hash')

    def test_source_change_discards_only_unpublished_outputs_then_recomputes(self):
        self.write(self.runner, '.tmp-snap/source-cache.json', 'retained cache\n')
        self.remote_commit('collector.py', 'new source\n')
        self.assertTrue(self.publish())
        self.assertEqual(len(self.recomputations), 1)
        self.assertEqual(self.remote_file('collector.py'), 'new source')
        self.assertEqual(self.remote_file('data/snapshot.js'), 'fresh data from new source')
        self.assertEqual((self.runner / '.tmp-snap/source-cache.json').read_text(), 'retained cache\n')

    def test_remote_data_change_is_never_overwritten_by_old_calculations(self):
        self.remote_commit('data/snapshot.js', 'new remote research\n')

        def recompute(root):
            self.assertEqual((root / 'data/snapshot.js').read_text(), 'new remote research\n')
            self.write(root, 'data/snapshot.js', 'fresh data retaining new remote research\n')

        self.assertTrue(self.publish(recompute=recompute))
        self.assertEqual(self.remote_file('data/snapshot.js'), 'fresh data retaining new remote research')

    def test_push_race_is_retried_without_force_or_losing_the_new_commit(self):
        original = publisher.git
        pushes = []

        def git(*args, **kwargs):
            if args[0] == 'push':
                pushes.append(args)
                if len(pushes) == 1:
                    self.remote_commit('AGENTS.md', 'instructions changed at push\n')
            return original(*args, **kwargs)

        with patch.object(publisher, 'git', side_effect=git):
            self.assertTrue(self.publish())
        self.assertEqual(len(pushes), 2)
        self.assertTrue(all('--force' not in args for args in pushes))
        self.assertEqual(self.remote_file('AGENTS.md'), 'instructions changed at push')
        self.assertEqual(self.remote_file('data/snapshot.js'), 'fresh data')
        self.assertEqual(self.run_git(self.runner, 'status', '--porcelain'), '')

    def test_validation_failure_keeps_the_remote_data_unchanged(self):
        self.remote_commit('AGENTS.md', 'new instructions\n')

        def reject(root):
            raise RuntimeError('missing source evidence')

        with self.assertRaisesRegex(RuntimeError, 'missing source evidence'):
            self.publish(validate=reject)
        self.assertEqual(self.remote_file('data/snapshot.js'), 'old data')
        self.assertEqual(self.remote_file('AGENTS.md'), 'new instructions')

    def test_repeated_source_changes_cannot_publish_previous_calculations(self):
        self.remote_commit('collector.py', 'new source\n')

        def validate(root):
            self.validate(root)
            self.remote_commit('collector.py', 'another source revision\n')

        with self.assertRaisesRegex(RuntimeError, 'inputs changed again'):
            self.publish(validate=validate)
        self.assertEqual(self.remote_file('data/snapshot.js'), 'old data')
        self.assertEqual(self.remote_file('collector.py'), 'another source revision')

    def test_inputs_and_evidence_are_not_mistaken_for_display_only_changes(self):
        for name in ('assets/model.js', 'collector.py', 'data/snapshot.js', 'data/catalog.json',
                     'requirements.txt', '.github/workflows/refresh-data.yml',
                     'docs/evidence/source.md', 'docs/evidence/source.json'):
            with self.subTest(path=name):
                self.assertFalse(publisher.reusable_change(name))
        for name in ('AGENTS.md', 'README.md', 'docs/maintenance.md', 'assets/styles.css',
                     'index.html', 'tests/test_refresh_publish.py'):
            with self.subTest(path=name):
                self.assertTrue(publisher.reusable_change(name))


if __name__ == '__main__':
    unittest.main()
