'use strict';

// Only infrastructure loss may retry a refresh, once, on the unchanged main.
// Calculation, source, test, timeout and deployment failures remain visible.
module.exports = async function retryRefreshRunner({ github, context, core }) {
  const { owner, repo } = context.repo;
  const runId = context.payload.workflow_run.id;
  const params = { owner, repo, run_id: runId };
  const skip = reason => { core.info(reason); return { retried: false, reason }; };
  const getRun = async () => (await github.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', params)).data;
  const eligible = run => run.status === 'completed' && run.conclusion === 'failure'
    && run.run_attempt === 1 && run.head_branch === 'main'
    && run.head_repository?.full_name === owner + '/' + repo
    && ['schedule', 'workflow_dispatch'].includes(run.event);
  const run = await getRun();
  if (!eligible(run)) return skip('Not an eligible first-attempt refresh failure.');

  const workflow = (await github.request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}',
    { owner, repo, workflow_id: 'refresh-data.yml' })).data;
  if (run.workflow_id !== workflow.id) return skip('This is not the data refresh workflow.');
  const mainSha = async () => (await github.request('GET /repos/{owner}/{repo}/branches/{branch}',
    { owner, repo, branch: 'main' })).data.commit.sha;
  if (await mainSha() !== run.head_sha) return skip('Main changed after this run; do not rerun old code.');

  const jobs = await github.paginate('GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs',
    { ...params, attempt_number: 1, per_page: 100 });
  const refresh = jobs.find(job => job.name === 'refresh' && job.conclusion === 'failure');
  if (!refresh || !Array.isArray(refresh.steps)
    || refresh.steps.some(step => ['failure', 'timed_out', 'cancelled'].includes(step.conclusion))) {
    return skip('No isolated refresh runner loss; ordinary failures are not retried.');
  }
  const checkId = Number(refresh.check_run_url?.match(/\/check-runs\/(\d+)$/)?.[1]);
  if (!Number.isSafeInteger(checkId) || checkId <= 0) return skip('Missing check-run identity for the failed job.');
  const annotations = await github.paginate('GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations',
    { owner, repo, check_run_id: checkId, per_page: 100 });
  if (!annotations.some(row => row.annotation_level === 'failure'
    && typeof row.message === 'string'
    && row.message.startsWith('The hosted runner lost communication with the server.'))) {
    return skip('GitHub did not report a hosted runner communication failure.');
  }

  // A manual retry or source push may have happened while inspecting the job.
  const latest = await getRun();
  if (!eligible(latest) || latest.head_sha !== run.head_sha || await mainSha() !== run.head_sha) {
    return skip('Run or main changed while checking; leave the newer work alone.');
  }
  await github.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs', params);
  core.notice('Retrying refresh run ' + runId + ' once after a hosted runner communication failure.');
  return { retried: true, runId };
};
