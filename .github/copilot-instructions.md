# Copilot instructions for this repository

## Build, test, and run commands

The maintained application is the Node.js 22/TypeScript Azure Functions project in `api` plus the static frontend in `web`.

Run these commands from `api`:

- Install reproducibly: `npm ci`
- Compile TypeScript: `npm run build`
- Run all tests: `npm test`
- Run one test by name: `npm run clean; npm run build; node --test --test-name-pattern="aggregates by month" dist/test/reports.test.js`
- Start the Functions host: `npm start`

For local API development, run Azurite, copy `api\local.settings.example.json` to `api\local.settings.json`, and set `INGESTION_KEY`. Azure Functions Core Tools must be installed. There is no lint command configured.

Deploy the Azure resources from the repository root with `az login` followed by `.\infra\deploy.ps1`. The deployment script securely prompts for the ingestion key unless `COPILOT_USAGE_INGESTION_KEY` or `-IngestionKey` is supplied.

## Architecture and data flow

1. `.github/hooks/copilot-usage-webhook.json` registers an `agentStop` hook. It executes the standard-library-only Python sender that lives in the repository at `.github/hooks/scripts/send-copilot-session-usage.py`. Nothing is downloaded at runtime: the hook only uses a locally installed Python (`COPILOT_USAGE_PYTHON`, `python`, `python3`, `py`, or an already installed `uv python list --only-installed` interpreter) and fails with a clear message when none is available. The sender reads the hook JSON from stdin, searches Copilot CLI, VS Code, and VS Code Insiders local session databases, falls back to the CLI session `events.jsonl`, adds Git metadata, and posts the resulting payload.
2. The hook normally posts to the standalone Azure Function App `/api/usage`; `COPILOT_USAGE_WEBHOOK_URL` overrides the complete destination and `COPILOT_USAGE_INGESTION_KEY` supplies the shared key.
3. `api/src/functions` contains the HTTP entry points. `usage.ts` authenticates and validates ingestion, while `repositories.ts` and `reports.ts` expose dashboard data. Shared validation, storage, response, and aggregation logic lives in `api/src/lib`.
4. `api/src/lib/storage.ts` persists data in Azure Table Storage. `CopilotUsage` stores one row per session/model and `CopilotRepositories` is the repository catalog. Monthly reports group those rows by month, actor, and model.
5. `web` is a dependency-free static dashboard. It calls relative `/api/repositories` and `/api/reports/monthly` routes. `web/staticwebapp.config.json` requires GitHub authentication for the dashboard and read APIs, but leaves `POST /api/usage` anonymous because ingestion performs its own key check.
6. `infra/main.bicep` provisions shared Table Storage, a Static Web App with managed Functions, and a separate Y1 Function App with Application Insights. Both Function deployments use the same `api` source, storage tables, and ingestion key. `.github/workflows/azure-static-web-app.yml` deploys both targets.

## Repository-specific conventions

- TypeScript uses strict NodeNext ESM. Keep `.js` suffixes on relative imports in `.ts` files so compiled modules resolve correctly.
- Keep webhook payload compatibility with `event: "copilot.agent_stop"`, the nested `session`, `interaction`, `repository`, and `usage` objects, and non-negative finite token/credit values.
- Preserve idempotency: the usage row key is derived from session ID plus model and is written with `Replace`. Repeated cumulative updates for the same session/model must replace rather than add another stored row.
- Repository identity is the normalized remote URL, falling back to the repository root. It is lowercased and SHA-256 hashed for the Table Storage partition key; row and partition keys must remain compatible with Azure Table restrictions.
- A session belongs to the UTC `YYYY-MM` month of its latest `interaction.captured_at`. Reports count distinct session IDs and round aggregated `githubAiCredits` to two decimals.
- Actor precedence is payload `actor`, query parameter `actor`, `x-copilot-actor` header, then `unknown`. Ingestion authentication accepts `key` or `x-ingestion-key` and compares it with `INGESTION_KEY`.
- `USAGE_STORAGE_CONNECTION_STRING` overrides `AzureWebJobsStorage`. Keep both local Azurite and deployed Azure Storage scenarios working.
- The sender script (`.github/hooks/scripts/send-copilot-session-usage.py`) must continue sanitizing credential-bearing Git remotes, accept both `sessionId` and legacy `session_id`, search Copilot CLI, VS Code, and VS Code Insiders local session stores without double-counting copied stores, and report AI credits in whole credit units rather than nano-AIU.
- After changing `.github/hooks/copilot-usage-webhook.json` or its environment variables, remind users to restart Copilot CLI; hook configuration is loaded when a session starts.
- Infrastructure names are parameterized in `infra/main.bicepparam`, while the workflow currently references the deployed Function App name and the `AZURE_STATIC_WEB_APPS_API_TOKEN` and `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` repository secrets.
