const { test } = require('node:test');
const assert = require('node:assert/strict');
const retry = require('../scripts/retry_refresh_runner.cjs');

function harness() {
  const state = {
    run: { status: 'completed', conclusion: 'failure', run_attempt: 1, head_branch: 'main',
      head_repository: { full_name: 'owner/fund-data' }, event: 'schedule', workflow_id: 42, head_sha: 'current' },
    jobs: [{ id: 123, check_run_url: 'https://api.github.com/repos/owner/fund-data/check-runs/456', name: 'refresh', conclusion: 'failure', steps: [
      { name: 'Test calculations and source guards', conclusion: 'success' },
      { name: 'Refresh all scheduled datasets', conclusion: null }
    ] }],
    annotations: [{ annotation_level: 'failure', message: 'The hosted runner lost communication with the server. Details.' }],
    main: 'current', writes: [], reads: 0
  };
  const github = {
    request: async (route, params) => {
      assert.equal(params.owner, 'owner');
      assert.equal(params.repo, 'fund-data');
      if (route.startsWith('POST ')) { state.writes.push({ route, params }); return { status: 201 }; }
      if (route.endsWith('/runs/{run_id}')) {
        state.reads++;
        return { data: structuredClone(state.reads > 1 && state.latest || state.run) };
      }
      if (route.endsWith('/workflows/{workflow_id}')) {
        assert.equal(params.workflow_id, 'refresh-data.yml');
        return { data: { id: 42 } };
      }
      if (route.endsWith('/branches/{branch}')) {
        assert.equal(params.branch, 'main');
        return { data: { commit: { sha: state.reads > 1 && state.latestMain || state.main } } };
      }
      throw new Error('Unexpected route: ' + route);
    },
    paginate: async (route, params) => {
      if (route.endsWith('/jobs')) { assert.equal(params.attempt_number, 1); return state.jobs; }
      assert.ok(route.endsWith('/annotations'));
      assert.equal(params.check_run_id, 456);
      return state.annotations;
    }
  };
  state.execute = () => retry({ github, context: { repo: { owner: 'owner', repo: 'fund-data' },
    payload: { workflow_run: { id: 99 } } }, core: { info() {}, notice() {} } });
  return state;
}

test('a confirmed first-attempt refresh runner loss retries only failed jobs once', async () => {
  for (const event of ['schedule', 'workflow_dispatch']) {
    const state = harness(); state.run.event = event;
    assert.equal((await state.execute()).retried, true);
    assert.deepEqual(state.writes, [{ route: 'POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs',
      params: { owner: 'owner', repo: 'fund-data', run_id: 99 } }]);
    state.run.run_attempt = 2;
    assert.equal((await state.execute()).retried, false);
    assert.equal(state.writes.length, 1);
  }
});

test('success, cancellation, timeouts, later attempts, forks and other workflows cannot retry', async () => {
  for (const patch of [
    { status: 'in_progress' }, { conclusion: 'success' }, { conclusion: 'cancelled' },
    { conclusion: 'timed_out' }, { run_attempt: 2 }, { run_attempt: null },
    { head_branch: 'feature' }, { head_repository: { full_name: 'outside/fund-data' } },
    { head_repository: null }, { event: 'pull_request' }, { workflow_id: 9 }
  ]) {
    const state = harness(); Object.assign(state.run, patch);
    assert.equal((await state.execute()).retried, false, JSON.stringify(patch));
    assert.equal(state.writes.length, 0);
  }
});

test('source and test failures, missing diagnosis, and deployment failures do not auto-retry', async () => {
  for (const patch of [
    { annotations: [] }, { annotations: [{ annotation_level: 'failure', message: 'AssertionError' }] },
    { annotations: [{ annotation_level: 'notice', message: 'The hosted runner lost communication with the server.' }] },
    { jobs: [{ id: 123, name: 'refresh', conclusion: 'failure', steps: [] }] },
    { jobs: [{ id: 123, name: 'refresh', conclusion: 'failure' }] },
    { jobs: [{ id: 123, name: 'deploy', conclusion: 'failure', steps: [] }] },
    ...['failure', 'timed_out', 'cancelled'].map(conclusion => ({ jobs: [{ id: 123, name: 'refresh',
      conclusion: 'failure', steps: [{ name: 'Refresh all scheduled datasets', conclusion }] }] }))
  ]) {
    const state = harness(); Object.assign(state, patch);
    assert.equal((await state.execute()).retried, false);
    assert.equal(state.writes.length, 0);
  }
});

test('a new main commit or a concurrent manual retry prevents restarting superseded work', async () => {
  for (const patch of [{ main: 'new-main' }, { latestMain: 'new-main' },
    { latest: { ...harness().run, run_attempt: 2 } },
    { latest: { ...harness().run, status: 'in_progress' } }]) {
    const state = harness(); Object.assign(state, patch);
    assert.equal((await state.execute()).retried, false);
    assert.equal(state.writes.length, 0);
  }
});
