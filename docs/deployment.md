# Atlas releases

Atlas has three Vercel projects in the `sync-labs` team. All three are connected to `synchronicity-labs/atlas`, with `main` as the production branch.

| Service | Vercel project | Root directory | Public health check |
| --- | --- | --- | --- |
| Frontend | `atlas` | `apps/app` | `https://atlas.pr.sync.so/sign-in` |
| API and KPI schedules | `atlas-api` | `apps/api` | `https://atlas-api.pr.sync.so/health` |
| Ingestion and queued agent jobs | `agent` | `apps/agent` | `https://agent.pr.sync.so/eve/v1/health` |

The ingestion project was connected to GitHub on August 27, 2026. It previously required a manual Vercel deployment. A merge now creates a deployment for each affected project. Vercel may skip a project if none of its files or shared dependencies changed. When verifying a release across all three projects, deploy any skipped project at that same commit before running the check.

## Release order

1. Run type checks, lint, tests, and `bun run release:test` before merging.
2. For a schema change, deploy only additive migrations first, using `bun run db:deploy` with the intended Doppler configuration. Keep old columns and behavior while both old and new code can run. Never use `db:push` or a database reset for a hosted release.
3. Merge reviewed code to `main`. Vercel builds the API, frontend, and ingestion service independently. New API and schema changes must remain compatible with the previous frontend and ingestion version during this window. Gate a breaking feature until all required services are ready; remove old schema support only in a later release.
4. Check the three Vercel deployment checks on the GitHub commit. A failed build leaves the previous production deployment serving traffic. Fix and merge, or redeploy the same commit after fixing a build-environment problem.
5. Run `bun run release:check <full-commit-sha>` from a Vercel-authenticated terminal. The command checks the deployment behind each public alias, requires the expected commit, and calls the public health endpoint. It prints service names, commit IDs, and failure summaries only. It does not print environment variables or deployment metadata.
6. Check a bounded sync run and its saved result separately. Service health proves that the service is reachable, not that every external source is current or every metric is verified.

## Schedules

The API builds its KPI schedules in `apps/api/scripts/build-func.mjs`. The ingestion app builds its schedules from `apps/agent/agent/schedules`: customer sync every six hours, a bounded PostHog user sync hourly, and queued job dispatch every minute. Do not add a second scheduler for these jobs when deploying.

The Modal cost collector on Rudy is a separate host-side integration. Vercel deployments do not update that collector. Changes to its host scripts or timer still require an explicit deployment to Rudy; the resulting snapshots are imported by Atlas.

## Retry and rollback

Use the existing project's Vercel deployment page to redeploy the selected Git commit. Do not create a new project or change the public aliases. For an urgent rollback, promote the last known good production deployment for the affected service, then check health and compatibility with the still-deployed database schema. Additive migrations stay in place. Do not roll back shared data or edit saved metric snapshots.

Vercel CLI authentication and the existing project environment are sufficient for the release check and deployment. Runtime secrets remain in Doppler and the service environment. Do not put credentials in source files or publish the full Vercel API response.
