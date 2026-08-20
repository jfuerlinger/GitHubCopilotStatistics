# Copilot instructions for this repository

## Repository purpose

This repository collects Copilot CLI session-usage data and forwards it to a webhook. The main flow is:

- `.github/hooks/copilot-usage-webhook.json` registers a Copilot CLI `agentStop` hook.
- The hook loads and runs the sender from the public
  [Copilot usage webhook Gist](https://gist.github.com/jfuerlinger/b24459aea86a5b7e0881506b360e6363)
  when a Copilot session ends.
- The script reads the hook payload from stdin, gathers repository metadata and usage stats, and POSTs a JSON payload to a webhook.

The code is intentionally small and focused: read the hook config and the
linked Gist together to understand the end-to-end behavior.

## Commands

There is no formal build, test, or lint pipeline configured for this repository.

Useful commands for this repo:

- Run the Gist-hosted sender directly:
  - `python3 <(curl --fail --silent --show-error --location https://gist.githubusercontent.com/jfuerlinger/b24459aea86a5b7e0881506b360e6363/raw/send-copilot-session-usage.py)`
- Inspect or validate the hook registration:
  - `.github/hooks/copilot-usage-webhook.json`

When changing behavior, validate it by feeding the script a representative JSON payload on stdin and checking the resulting POST payload/output. The script is designed to be exercised this way.

## Architecture and data flow

The key pieces are:

1. Hook registration
   - `.github/hooks/copilot-usage-webhook.json` defines the Copilot CLI hook.
   - The hook is executed with the repository root as `cwd` and downloads the
     Python source from the Gist before running it.
   - After changing the hook config, remind users to restart Copilot CLI because the CLI loads hook configuration when a session starts.

2. Session usage sender
   - The public Gist is the single implementation point for payload generation.
   - It expects JSON from stdin and extracts:
     - `sessionId` or `session_id`
     - `cwd`
     - `timestamp`
     - `stopReason`
   - It then builds a payload containing:
     - repository metadata (`root`, `remote_origin`, `branch`, `commit`)
     - usage totals and per-model breakdowns, including AI credits rounded to
       two decimal places
     - interaction metadata

3. Usage source selection
   - The script first tries to read Copilot's local SQLite usage store at `~/.copilot/session-store.db`.
   - If that is unavailable, it falls back to the session event log at `~/.copilot/session-state/<session-id>/events.jsonl`.
   - This fallback only provides output-token counts, so the payload includes the `source` field to make that explicit.

## Conventions specific to this repository

- Keep the script dependency-light and standard-library only. The current implementation uses `sqlite3`, `subprocess`, `json`, `pathlib`, and `typing`.
- Preserve the existing behavior of sanitizing Git remotes before sending them in the payload. The `sanitized_remote()` helper exists for that reason.
- Prefer small helper functions over large inline logic blocks. The script is organized around focused helpers such as `git_value()`, `repository_metadata()`, and `query_usage_store()`.
- Keep environment-variable based overrides intact. `COPILOT_USAGE_WEBHOOK_URL` is the supported override for the destination webhook.
- Report `github_ai_credits` in whole AI-credit units, rounded to two decimal
  places; do not expose the underlying nano-AIU value in the webhook payload.
- Preserve compatibility with both the current `agentStop` hook input and the older `session_id` field name. The script accepts either.
- Avoid introducing new external dependencies unless the repository already has a clear need for them.

## Notes for changes

- If you change what is sent in the payload, keep the structure compatible with the existing webhook consumer expectations.
- If you change the hook command or path, ensure the hook still runs from the repository root and still passes the expected stdin payload.
- If you change repository metadata collection, keep the Git commands robust to repositories that do not have a remote or a current branch.
