# GitHub Copilot session usage webhook

`.github/hooks/copilot-usage-webhook.json` registers a Copilot CLI `agentStop`
hook. It loads the webhook sender from the public
[Copilot usage webhook Gist](https://gist.github.com/jfuerlinger/b24459aea86a5b7e0881506b360e6363)
when the hook runs. Restart Copilot CLI after cloning or changing this
repository; the CLI loads hook configuration when a session starts.

After every completed Copilot agent interaction in this repository, the hook
sends the cumulative session usage as a JSON `POST` to
[https://webhook.site/#!/view/1bc3a2d1-2761-4d7f-86ed-ff8081bc396b/f084248d-df6d-402d-aedd-1f09e79b3c97/1](https://webhook.site/#!/view/1bc3a2d1-2761-4d7f-86ed-ff8081bc396b/f084248d-df6d-402d-aedd-1f09e79b3c97/1). The payload
contains:

* The session ID, interaction timestamp, and stop reason.
* The Git working directory, repository root, sanitized `origin` URL, branch,
  and commit SHA.
* Input, output, cache, reasoning, and GitHub AI-credit values, both overall
  and per model. AI credits are rounded to two decimal places.

**The default webhook URL expires on August 27, 2026.**

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

Set `COPILOT_USAGE_WEBHOOK_URL` before starting Copilot CLI to override the
target for development or testing.

## Azure-Lösung

Die Anwendung besteht aus:

- **Azure Static Web Apps (Free):** geschütztes Dashboard und verwaltete Azure Functions.
- **Azure Function App (Consumption Plan, Y1):** optionaler eigenständiger Endpunkt für den Usage-Webhook inkl. Application Insights.
- **Azure Table Storage:** zwei sehr günstige Tabellen für Sessions und den Repository-Katalog.
- **TypeScript Azure Functions:** validieren Webhooks, speichern Sessions idempotent und aggregieren Monatswerte.

Jede Kombination aus Session und Modell wird mit einem stabilen Schlüssel gespeichert. Sendet der Hook während derselben Session erneut kumulierte Werte, wird der vorhandene Datensatz ersetzt statt doppelt gezählt. Eine Session wird dem Monat ihres zuletzt empfangenen `captured_at` zugeordnet.

Table Storage hat keinen dauerhaft garantierten Gratis-Tarif, verursacht bei diesem kleinen Datenvolumen aber üblicherweise nur minimale Kosten für Speicher und Transaktionen. Static Web Apps Free und die enthaltenen verwalteten Functions haben Nutzungslimits; aktuelle Preise und Limits stehen in der Azure-Preisliste.

### Benutzerzuordnung

Der Beispiel-Payload enthält keine Benutzeridentität. Die Function bestimmt `actor` in dieser Reihenfolge:

1. `actor` im JSON (String oder Objekt mit `login`, `name` oder `id`)
2. Query-Parameter `actor`
3. Header `x-copilot-actor`
4. `unknown`

Für den unveränderten Gist-Sender kann pro Arbeitsplatz beispielsweise folgende URL gesetzt werden:

```text
COPILOT_USAGE_WEBHOOK_URL=https://<app>.azurestaticapps.net/api/usage?actor=joe&key=<ingestion-key>
```

Ein `actor`-Feld oder Header ist vorzuziehen, weil Geheimnisse in URLs in Logs auftauchen können. Nach Änderung der Umgebungsvariable Copilot CLI neu starten.

### Bereitstellen

Voraussetzungen: Azure CLI mit Bicep-Unterstützung, eine Azure Subscription und ein GitHub-Repository.

```powershell
az login
$secret = Read-Host 'Ingestion key' -AsSecureString
.\infra\deploy.ps1 `
  -ResourceGroup copilot-usage-rg `
  -StaticWebAppName copilot-usage-<eindeutiger-suffix> `
  -StorageAccountName copilotusage<eindeutigersuffix> `
  -FunctionAppName copilot-usage-api-<eindeutiger-suffix> `
  -IngestionKey $secret
```

`deploy.ps1` gibt Hostname und Webhook-Basis-URL aus. Danach das Deployment-Token abrufen und im GitHub-Repository als Secret `AZURE_STATIC_WEB_APPS_API_TOKEN` hinterlegen:

```powershell
az staticwebapp secrets list --name copilot-usage-<eindeutiger-suffix> --query properties.apiKey -o tsv
```

Der Workflow `.github/workflows/azure-static-web-app.yml` veröffentlicht bei einem Push auf `main` den Ordner `web` und die verwalteten Functions aus `api`. Das Dashboard und seine Lese-APIs erfordern eine Anmeldung über GitHub; nur der Webhook-Endpunkt ist anonym erreichbar und zusätzlich durch `INGESTION_KEY` geschützt.

### API

| Methode | Route | Zweck |
|---|---|---|
| `POST` | `/api/usage` | Payload validieren und Session speichern/aktualisieren |
| `GET` | `/api/repositories` | bekannte Repositories auflisten |
| `GET` | `/api/reports/monthly?repository=…&from=2026-01&to=2026-12` | monatliche Werte nach Person und Modell |

### Lokal entwickeln

Azurite und Azure Functions Core Tools müssen lokal vorhanden sein. Die Beispieldatei kopieren, `INGESTION_KEY` setzen und dann starten:

```powershell
Copy-Item api\local.settings.example.json api\local.settings.json
Set-Location api
npm install
npm test
npm start
```

Das statische Frontend kann mit der Static Web Apps CLI zusammen mit der lokalen Function ausgeführt werden. Der Kern ist dependency-light; neben dem offiziellen Azure Functions SDK wird nur der offizielle Table-Storage-Client verwendet.
