@/Users/ajin/.codex/RTK.md

## Workflow

- Commit every completed change. Prefer one independent change per Git commit; keep its required tests, data and documentation together, and avoid combining unrelated changes.
- In this project, push immediately after every commit. Committing without pushing is not a completed delivery.
- Before pushing, fetch and integrate any remote updates, including scheduled data refreshes. Preserve their changes and do not force-push over them.

## Product UI

- Keep each screen self explanatory through clear labels, visual hierarchy and direct controls. Do not turn product pages into instruction manuals.
- Keep methodology, audit trails, long caveats and implementation notes in repository docs or a dedicated detail view. Show a short warning in the interface only when it changes how a user should interpret or act on a result.
- Give each research topic one clear navigation path. Do not repeat calls to action for the same destination on the same page.
- Keep return period and annualized/cumulative controls consistent across index, fund and stock pages.
- Prioritize the desktop layout. The primary display is 27 inches at 4K resolution.

## Data integrity

- Name the exact missing evidence in status labels. Do not hide unresolved data gaps or replace one index with another series.
- Separate index values, ETF prices and fund net values; label each return basis and date.
