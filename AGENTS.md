@/Users/ajin/.codex/RTK.md

## Workflow

- Commit every completed change. Prefer one independent change per Git commit; keep its required tests, data and documentation together, and avoid combining unrelated changes.
- In this project, push immediately after every commit. Committing without pushing is not a completed delivery.
- Before pushing, fetch and integrate any remote updates, including scheduled data refreshes. Preserve their changes and do not force-push over them.
- Finish the necessary local checks, then commit and push. Do not inspect, poll, or wait for GitHub Actions / GitHub Pages publication status or logs unless the user explicitly asks.
- Do not perform post-deployment checks of the live website or its resources unless explicitly requested. Leave automatic deployment to GitHub after pushing; it is not a required verification step for task completion.

## Product UI

- Before changing the cross-border money flow, read `docs/money-flow-requirements.md`. Keep all user feedback, reopened regressions, validation evidence and remaining work in that single checklist; do not treat a previously rejected implementation or passing automated tests as user acceptance.
- Keep each screen self explanatory through clear labels, visual hierarchy and direct controls. Do not turn product pages into instruction manuals.
- Keep methodology, audit trails, long caveats and implementation notes in repository docs or a dedicated detail view. Show a short warning in the interface only when it changes how a user should interpret or act on a result.
- Give each research topic one clear navigation path. Do not repeat calls to action for the same destination on the same page.
- Keep return period and annualized/cumulative controls consistent across index, fund and stock pages.
- Prioritize the desktop layout. The primary display is 27 inches at 4K resolution.

## Data integrity

- Name the exact missing evidence in status labels. Do not hide unresolved data gaps or replace one index with another series.
- Separate index values, ETF prices and fund net values; label each return basis and date.
