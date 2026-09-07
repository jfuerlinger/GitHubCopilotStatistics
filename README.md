# GitHub Copilot session usage webhook

`.github/hooks/copilot-usage-webhook.json` registers a Copilot CLI `agentStop`
hook. It runs the sender script that is checked into this repository at
`.github/hooks/scripts/send-copilot-session-usage.py` (originally published in
the [Copilot usage webhook Gist](https://gist.github.com/jfuerlinger/b24459aea86a5b7e0881506b360e6363)),
so no code is downloaded at runtime. The script only uses the Python standard
library and `curl`, and it runs with a locally installed Python
(`COPILOT_USAGE_PYTHON`, `python`, `python3`, `py`, or an interpreter that `uv`
already has installed); if none is present the hook stops with a clear error
instead of downloading a runtime. Set `COPILOT_USAGE_SCRIPT`
to run the script from another path.

After every completed Copilot agent interaction in this repository, the hook
sends the cumulative session usage as a JSON `POST`. By default it targets the
standalone Azure Function App at
`https://app-gcstatistics-poc.azurewebsites.net/api/usage`; the destination can
be overridden with `COPILOT_USAGE_WEBHOOK_URL`. The payload contains:

* The session ID, interaction timestamp, and stop reason.
* The Git working directory, repository root, sanitized `origin` URL, branch,
  and commit SHA.
* Input, output, cache, reasoning, and GitHub AI-credit values, both overall
  and per model. AI credits are rounded to two decimal places.

The endpoint requires the shared ingestion key. Set
`COPILOT_USAGE_INGESTION_KEY` before starting Copilot CLI; the hook appends it
as the URL-encoded `key` query parameter (see "Azure solution" below for the
alternative header-based option and both endpoint variants).

> **Note:** Restart Copilot CLI after cloning this repository or after
> changing any hook-related environment variable (`COPILOT_USAGE_WEBHOOK_URL`,
> `COPILOT_USAGE_ACTOR`,
> `COPILOT_USAGE_INGESTION_KEY`) — the CLI only loads hook configuration when a
> session starts.

For example, the webhook receives a payload like:

```json
{
  "event": "copilot.agent_stop",
  "session": {
    "id": "fe2e8da1-c625-4d80-9a0b-92434572e33a"
  },
  "interaction": {
    "captured_at": 1787255589057,
    "stop_reason": "end_turn"
  },
  "repository": {
    "cwd": "/Users/joe/Projects/Privat/GitHubCopilotStatistics",
    "root": "/Users/joe/Projects/Privat/GitHubCopilotStatistics",
    "remote_origin": "https://github.com/jfuerlinger/GitHubCopilotStatistics.git",
    "branch": "main",
    "commit": "3dcdca4760ea3eae883863ebfc02242a75737b0e"
  },
  "usage": {
    "source": "session-store",
    "tokens": {
      "input_tokens": 985375,
      "output_tokens": 8504,
      "cache_read_tokens": 915891,
      "cache_write_tokens": 39282,
      "reasoning_tokens": 3248,
      "github_ai_credits": 35.96
    },
    "by_model": [
      {
        "model": "gpt-5.6-terra",
        "input_tokens": 791527,
        "output_tokens": 5029,
        "cache_read_tokens": 752179,
        "cache_write_tokens": 39282,
        "reasoning_tokens": 1520,
        "github_ai_credits": 30.91
      },
      {
        "model": "mai-code-1-flash-picker",
        "input_tokens": 193848,
        "output_tokens": 3475,
        "cache_read_tokens": 163712,
        "cache_write_tokens": 0,
        "reasoning_tokens": 1728,
        "github_ai_credits": 5.05
      }
    ]
  }
}
```

Usage values are read from Copilot's local `session-store.db` via Python's
standard-library SQLite client. If that store has not been updated by the time
the hook fires, the script falls back to the session event log and sends the
available output-token counts with `"source": "events-jsonl-output-only"`.

## Azure solution

The application consists of:

- **Azure Static Web Apps (Free):** A protected dashboard and a managed copy of
  the Functions for dashboard and API access.
- **Azure Function App (Consumption plan, Y1):** A standalone ingestion endpoint
  used by the hook by default, including Application Insights and a Log
  Analytics workspace.
- **Azure Table Storage:** The `CopilotUsage` table for session/model values and
  the `CopilotRepositories` table for the repository catalog.
- **TypeScript Azure Functions:** Validate webhooks, store sessions
  idempotently, and aggregate monthly values.

Both the Static Web App's managed Functions and the standalone Function App use
the same source code from `api`, the same ingestion key, and the same storage
tables. This provides two possible endpoints:

| Variant | URL | Usage |
|---|---|---|
| Standalone Function App | `https://<function-app>.azurewebsites.net/api/usage` | Default hook target; separate monitoring through Application Insights |
| Static Web App | `https://<static-web-app>.azurestaticapps.net/api/usage` | Alternative when ingestion and the dashboard should use the same host |

For both endpoints, the key can be sent as the `key` query parameter or in the
`x-ingestion-key` header. By default, the hook sends
`COPILOT_USAGE_INGESTION_KEY` as a query parameter. For development, testing,
or the Static Web App variant, the complete destination URL can be overridden
with `COPILOT_USAGE_WEBHOOK_URL`.

Each session/model combination is stored with a stable key. If the hook sends
updated cumulative values during the same session, the existing record is
replaced instead of counted twice. A session is assigned to the month of its
most recently received `captured_at` value.

Table Storage does not have a permanently guaranteed free tier, but at this
small data volume it usually incurs only minimal storage and transaction costs.
Static Web Apps Free and its included managed Functions have usage limits; see
the Azure pricing documentation for current prices and limits.

### User attribution

The sender script automatically determines the actor and includes it in the
payload's `actor` field. It searches the matching session first in the Copilot
CLI `session-store.db`/`local-session.db`, then in the VS Code and VS Code
Insiders `local-session.db`/`session-store.db` files. Editor user-data paths are
detected for Windows (`%APPDATA%`), macOS (`~/Library/Application Support`) and
Linux (`$XDG_CONFIG_HOME` or `~/.config`). The first matching store is used, so
copied or synchronized databases cannot duplicate usage. The Function determines
`actor` in this order:

1. `actor` in the JSON (a string or an object with `login`, `name`, or `id`) —
   the sender script populates it automatically using this precedence:
   `COPILOT_USAGE_ACTOR` environment variable → `GITHUB_ACTOR` (for example,
   when set in GitHub Actions) → local `git config user.name` →
   `git config user.email`.
2. The `actor` query parameter.
3. The `x-copilot-actor` header.
4. `unknown` if none of the above is available, for example when there is no
   local Git identity.

To override the actor manually, for example to use a different display name,
set `COPILOT_USAGE_ACTOR` before starting Copilot CLI:

```powershell
$env:COPILOT_USAGE_ACTOR = "joe"
```

Alternatively, the actor can be forced through the destination URL. Headers
are preferable for secrets because query parameters may appear in logs:

```text
COPILOT_USAGE_WEBHOOK_URL=https://<app>.azurestaticapps.net/api/usage?actor=joe&key=<ingestion-key>
```

See the restart note above after changing any of these environment variables.

### Deployment

Prerequisites: Azure CLI with Bicep support, an Azure subscription, and a
GitHub repository.

Resource names are predefined in `infra/main.bicepparam`, and the resource
group is predefined in `infra/deploy.ps1`. Therefore, the following is
sufficient:

```powershell
az login
.\infra\deploy.ps1
```

Only the ingestion key is requested securely. For automated deployments, it
can optionally be supplied through `COPILOT_USAGE_INGESTION_KEY` or the
`-IngestionKey` parameter; it is not stored in the parameter file.

`deploy.ps1` outputs the hostname and webhook base URL. Then add the deployment
credentials to the GitHub repository:

```powershell
az staticwebapp secrets list --name stapp-githubcopilotstatistics-poc --query properties.apiKey -o tsv
```

Store the result as the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret. In addition,
retrieve the publish profile for the standalone Function App and store its
complete XML output as the `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` secret:

```powershell
az functionapp deployment list-publishing-profiles `
  --name app-gcstatistics-poc `
  --resource-group rg-githubcopilotstatistics-poc `
  --xml
```

On a push to `main`, the `.github/workflows/azure-static-web-app.yml` workflow
deploys both the `web` directory with the managed Functions and the compiled
standalone Azure Function App `app-gcstatistics-poc`. Each deployment runs only
when its corresponding sources have changed: the standalone Function App is
deployed for changes under `api/**`, while the Static Web App is deployed for
changes under `web/**` or `api/**` because it also deploys the managed
Functions. A manual `workflow_dispatch` always deploys both targets. The
dashboard and its read APIs require GitHub authentication; only the webhook
endpoint is accessible anonymously, and it is additionally protected by
`INGESTION_KEY`.

### API

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/usage` | Validate the payload and store or update the session |
| `GET` | `/api/repositories` | List known repositories |
| `GET` | `/api/reports/monthly?from=2026-01&to=2026-12` | Return cross-repository values per day (`date`, plus its `month`), person and model, along with AI credits per month and repository (`repository` is optional) |

### Local development

Prerequisites are Node.js 22 or later, Azurite, and Azure Functions Core Tools.
Copy the example settings, replace `INGESTION_KEY` with a local shared secret,
and then install, test, and start the API:

```powershell
Copy-Item api\local.settings.example.json api\local.settings.json
Set-Location api
npm ci
npm test
npm start
```

The Functions host exposes the API locally at `http://localhost:7071/api`.
Start the static frontend with the Static Web Apps CLI to proxy its relative API
requests to the local Functions host. The core is dependency-light: besides the
official Azure Functions SDK, it uses only the official Table Storage client.
