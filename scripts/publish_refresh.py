#!/usr/bin/env python3
"""Publish a validated refresh without losing concurrent main-branch edits."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATHS = ('index.html', ':(top,glob)data/*.js', ':(top,glob)data/*.json',
                'data/portfolio', 'data/return-comparison')
MEANINGFUL_PATHS = (
    'data/snapshot.js', 'data/overseas-stocks.js', 'data/indices.js', 'data/index-history.json',
    'data/market-history.json', 'data/screening.js', 'data/fund-actions.json', 'data/crossborder.js',
    'data/etf-distributions.js', 'data/money-flow-quotes.js', ':(top,glob)data/*validation.json',
    ':(top,glob)data/verification*.json', ':(top,glob)data/*reconciliation.json', 'data/portfolio', 'data/return-comparison',
    'data/financial-events-history.json',
)
# These files configure/render the browser calculator. Neither the nine refresh
# collectors nor their post-refresh builders read them; the full test suite does.
CLIENT_ONLY_FILES = frozenset(('assets/money-flow.js', 'assets/money-flow-model.js',
                               'data/money-flow.js'))


def command(args, root=ROOT, capture=False, check=True):
    result = subprocess.run(args, cwd=root, text=True, capture_output=capture, check=False)
    if check and result.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(args[:3]) +
                           ('\n' + result.stderr.strip() if capture and result.stderr else ''))
    return result


def git(*args, root=ROOT, check=True):
    return command(['git', *args], root, capture=True, check=check)


def paths(result):
    return [path for path in result.stdout.split('\0') if path]


def reusable_change(path):
    """Only known non-input files may reuse the already calculated data.

    Unlisted Python/JavaScript (including assets/model.js), data, source evidence,
    dependencies and workflow changes conservatively require a new calculation.
    Changed tests and documentation are still checked against the final data.
    """
    p = Path(path)
    return (path in ('AGENTS.md', 'README.md', 'index.html') or path in CLIENT_ONLY_FILES or
            path.startswith('tests/') or
            (path.startswith('docs/evidence/money-flow-feedback/') and p.suffix in ('.json', '.png', '.md')) or
            (path.startswith('docs/') and not path.startswith('docs/evidence/') and p.suffix == '.md') or
            (path.startswith('assets/') and p.suffix in
             ('.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2')))


def generated_files(root):
    return sorted(set(paths(git('ls-files', '-z', '--modified', '--deleted', '--others',
                                '--exclude-standard', '--', *OUTPUT_PATHS, root=root))))


def discard_generated(root):
    """Discard only this disposable runner's unpublished generated changes."""
    pending = set(generated_files(root))
    tracked = set(paths(git('ls-files', '-z', '--', *OUTPUT_PATHS, root=root)))
    restore = sorted(pending & tracked)
    if restore:
        git('restore', '--source=HEAD', '--staged', '--worktree', '--', *restore, root=root)
    for name in sorted(pending - tracked):
        (root / name).unlink()


def test_generated_data(root):
    # Full code regression already runs on source pushes (pages.yml). Daily
    # publication checks the contracts whose inputs actually changed: the data.
    command([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests',
             '-p', 'test_company_selection.py', '-q'], root)
    command(['node', '--test', 'tests/model.test.cjs', 'tests/us-stocks.test.cjs',
             'tests/stock-view.test.cjs'], root)


def validate_outputs(root):
    command([sys.executable, 'scripts/check_refresh.py'], root)
    test_generated_data(root)
    command(['npm', 'run', 'version-assets'], root)
    command(['npm', 'run', 'check'], root)


def recompute_outputs(root):
    command([sys.executable, 'refresh.py', '--daily', '--timeout', '90',
             '--funds-timeout', '90', '--portfolio-timeout', '90'], root)
    command([sys.executable, 'scripts/post_refresh.py'], root)


def publish(root=ROOT, validate=validate_outputs, recompute=recompute_outputs,
            max_attempts=5, max_recomputations=1, run_id=None):
    """The initial data and checks are supplied by the workflow's earlier steps.

    Repeated non-input commits reuse those data, followed by full validation.
    A source/input change discards only generated work and calculates anew.
    A normal push is the final concurrency check; a rejected push is retried
    from its current remote parent, never with --force or stale data overlays.
    """
    root = Path(root)
    recomputations = 0
    for attempt in range(max_attempts):
        base = git('rev-parse', 'HEAD', root=root).stdout.strip()
        git('fetch', 'origin', 'main', root=root)
        remote = git('rev-parse', 'origin/main', root=root).stdout.strip()
        if remote != base:
            if git('merge-base', '--is-ancestor', base, remote, root=root, check=False).returncode:
                raise RuntimeError('Remote main is not a fast-forward; refusing to overwrite history.')
            changed = paths(git('diff', '--name-only', '-z', base, remote, root=root))
            reusable = all(reusable_change(path) for path in changed)
            if reusable:
                print('Main advanced in non-input files; retaining calculated data and validating the merged result.', flush=True)
                # Regenerate asset hashes against the latest HTML, preserving UI edits.
                git('restore', '--source=HEAD', '--staged', '--worktree', '--', 'index.html', root=root)
            else:
                if recomputations >= max_recomputations:
                    raise RuntimeError('Refresh inputs changed again after a full recomputation; refusing to publish stale calculations.')
                print('Main changed refresh inputs; recalculating against the new source: ' + ', '.join(changed), flush=True)
                discard_generated(root)
            git('merge', '--ff-only', '--no-stat', remote, root=root)
            if not reusable:
                recomputations += 1
                recompute(root)
            validate(root)
            # A new commit during validation is handled by the same loop.
            continue

        meaningful = git('diff', '--quiet', '--', *MEANINGFUL_PATHS, root=root, check=False)
        if meaningful.returncode not in (0, 1):
            raise RuntimeError('Cannot inspect generated data changes.')
        if meaningful.returncode == 0:
            print('No research data or evidence changed; keeping the published snapshot.', flush=True)
            return False
        pending = generated_files(root)
        git('add', '--all', '--', *pending, root=root)
        git('-c', 'user.name=github-actions[bot]', '-c',
            'user.email=41898282+github-actions[bot]@users.noreply.github.com',
            'commit', '-m', 'Refresh research data (' + str(run_id or os.environ.get('GITHUB_RUN_ID', 'manual')) + ')', root=root)
        committed = git('rev-parse', 'HEAD', root=root).stdout.strip()
        pushed = git('push', 'origin', 'HEAD:main', root=root, check=False)
        if pushed.returncode == 0:
            return True
        git('fetch', 'origin', 'main', root=root)
        remote = git('rev-parse', 'origin/main', root=root).stdout.strip()
        if remote == committed:
            return True  # The server accepted the push but the response was lost.
        # Uncommit only our just-created, unpublished commit; preserve its files.
        git('reset', '--mixed', base, root=root)
        if remote == base:
            raise RuntimeError('Data push failed without a concurrent main update:\n' + pushed.stderr.strip())
        print('Main advanced during the push; integrating it before retrying.', flush=True)
    raise RuntimeError('Main kept changing through the bounded publication attempts; nothing was force-pushed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-attempts', type=int, default=5)
    args = parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        parser.error('This publisher operates only in a disposable GitHub Actions checkout.')
    if args.max_attempts < 1:
        parser.error('--max-attempts must be positive')
    try:
        changed = publish(max_attempts=args.max_attempts)
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write('changed=' + str(changed).lower() + '\n')
        return 0
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
