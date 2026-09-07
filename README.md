# GitHub Copilot session usage webhook

`.github/hooks/copilot-usage-webhook.json` registers a Copilot CLI `agentStop`
hook. It loads the webhook sender from the public
[Copilot usage webhook Gist](https://gist.github.com/jfuerlinger/b24459aea86a5b7e0881506b360e6363)
when the hook runs.

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
as the URL-encoded `key` query parameter (see "Azure-Lösung" below for the
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

## Azure-Lösung

Die Anwendung besteht aus:

- **Azure Static Web Apps (Free):** geschütztes Dashboard sowie eine verwaltete
  Kopie der Functions für Dashboard- und API-Zugriffe.
- **Azure Function App (Consumption Plan, Y1):** standardmäßig vom Hook
  verwendeter, eigenständiger Ingestion-Endpunkt inklusive Application Insights
  und Log-Analytics-Workspace.
- **Azure Table Storage:** die Tabellen `CopilotUsage` für Session-/Modellwerte
  und `CopilotRepositories` für den Repository-Katalog.
- **TypeScript Azure Functions:** validieren Webhooks, speichern Sessions
  idempotent und aggregieren Monatswerte.

Sowohl die verwalteten Functions der Static Web App als auch die eigenständige
Function App verwenden denselben Quellcode aus `api`, denselben Ingestion Key
und dieselben Storage-Tabellen. Dadurch stehen zwei mögliche Endpunkte bereit:

| Variante | URL | Verwendung |
|---|---|---|
| Eigenständige Function App | `https://<function-app>.azurewebsites.net/api/usage` | Standardziel des Hooks; separates Monitoring über Application Insights |
| Static Web App | `https://<static-web-app>.azurestaticapps.net/api/usage` | Alternative, wenn Ingestion und Dashboard über denselben Host laufen sollen |

Für beide Endpunkte kann der Schlüssel als Query-Parameter `key` oder im Header
`x-ingestion-key` gesendet werden. Der Hook verwendet standardmäßig
`COPILOT_USAGE_INGESTION_KEY` als Query-Parameter. Für Entwicklung, Tests oder
die Static-Web-App-Variante lässt sich die vollständige Ziel-URL über
`COPILOT_USAGE_WEBHOOK_URL` überschreiben.

Jede Kombination aus Session und Modell wird mit einem stabilen Schlüssel gespeichert. Sendet der Hook während derselben Session erneut kumulierte Werte, wird der vorhandene Datensatz ersetzt statt doppelt gezählt. Eine Session wird dem Monat ihres zuletzt empfangenen `captured_at` zugeordnet.

Table Storage hat keinen dauerhaft garantierten Gratis-Tarif, verursacht bei diesem kleinen Datenvolumen aber üblicherweise nur minimale Kosten für Speicher und Transaktionen. Static Web Apps Free und die enthaltenen verwalteten Functions haben Nutzungslimits; aktuelle Preise und Limits stehen in der Azure-Preisliste.

### Benutzerzuordnung

Der Gist-Sender ermittelt den Actor automatisch und setzt ihn als `actor`-Feld
im Payload. Die Function bestimmt `actor` in dieser Reihenfolge:

1. `actor` im JSON (String oder Objekt mit `login`, `name` oder `id`) — der
   Gist-Sender füllt dies automatisch, in dieser Reihenfolge:
   `COPILOT_USAGE_ACTOR`-Umgebungsvariable → `GITHUB_ACTOR` (z. B. in GitHub
   Actions gesetzt) → lokaler `git config user.name` → `git config user.email`.
2. Query-Parameter `actor`
3. Header `x-copilot-actor`
4. `unknown` (falls nichts davon verfügbar ist, z. B. ohne lokale Git-Identität)

Um den Actor manuell zu überschreiben, z. B. für einen abweichenden Anzeigenamen,
genügt es, `COPILOT_USAGE_ACTOR` vor dem Start von Copilot CLI zu setzen:

```powershell
$env:COPILOT_USAGE_ACTOR = "joe"
```

Alternativ lässt sich der Actor auch über die Ziel-URL erzwingen (Query-Parameter
oder Header sind gegenüber dem in der URL sichtbaren Query-Parameter vorzuziehen,
weil Geheimnisse in URLs in Logs auftauchen können):

```text
COPILOT_USAGE_WEBHOOK_URL=https://<app>.azurestaticapps.net/api/usage?actor=joe&key=<ingestion-key>
```

(siehe Neustart-Hinweis oben, nachdem eine dieser Umgebungsvariablen geändert wurde).

### Bereitstellen

Voraussetzungen: Azure CLI mit Bicep-Unterstützung, eine Azure Subscription und ein GitHub-Repository.

Die Ressourcennamen sind in `infra/main.bicepparam` und die Resource Group in `infra/deploy.ps1` vorbelegt. Daher genügt:

```powershell
az login
.\infra\deploy.ps1
```

Nur der Ingestion Key wird sicher abgefragt. Optional kann er für automatisierte Deployments über `COPILOT_USAGE_INGESTION_KEY` oder mit `-IngestionKey` übergeben werden; er wird nicht in der Parameterdatei gespeichert.

`deploy.ps1` gibt Hostname und Webhook-Basis-URL aus. Danach die Deployment-Zugangsdaten im GitHub-Repository hinterlegen:

```powershell
az staticwebapp secrets list --name stapp-githubcopilotstatistics-poc --query properties.apiKey -o tsv
```

Das Ergebnis als Secret `AZURE_STATIC_WEB_APPS_API_TOKEN` speichern. Zusätzlich das Publish Profile der eigenständigen Function App abrufen und dessen vollständige XML-Ausgabe als Secret `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` speichern:

```powershell
az functionapp deployment list-publishing-profiles `
  --name app-gcstatistics-poc `
  --resource-group rg-githubcopilotstatistics-poc `
  --xml
```

Der Workflow `.github/workflows/azure-static-web-app.yml` veröffentlicht bei einem Push auf `main` sowohl den Ordner `web` und die verwalteten Functions als auch die kompilierte eigenständige Azure Function App `app-gcstatistics-poc`. Das Dashboard und seine Lese-APIs erfordern eine Anmeldung über GitHub; nur der Webhook-Endpunkt ist anonym erreichbar und zusätzlich durch `INGESTION_KEY` geschützt.

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
