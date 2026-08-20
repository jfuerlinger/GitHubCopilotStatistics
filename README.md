# GitHub Copilot session usage webhook

`.github/hooks/copilot-usage-webhook.json` registers a Copilot CLI `agentStop`
hook. Restart Copilot CLI after cloning or changing this repository; the CLI
loads hook configuration when a session starts.

After every completed Copilot agent interaction in this repository, the hook
sends the cumulative session usage as a JSON `POST` to
`https://webhook.site/1bc3a2d1-2761-4d7f-86ed-ff8081bc396b`. The payload
contains:

* The session ID, interaction timestamp, and stop reason.
* The Git working directory, repository root, sanitized `origin` URL, branch,
  and commit SHA.
* Input, output, cache, reasoning, and GitHub AI-credit values, both overall
  and per model. AI credits are rounded to two decimal places.

Usage values are read from Copilot's local `session-store.db` via Python's
standard-library SQLite client. If that store has not been updated by the time
the hook fires, the script falls back to the session event log and sends the
available output-token counts with `"source": "events-jsonl-output-only"`.

Set `COPILOT_USAGE_WEBHOOK_URL` before starting Copilot CLI to override the
target for development or testing.
