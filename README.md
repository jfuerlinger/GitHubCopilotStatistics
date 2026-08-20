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
{"event": "copilot.agent_stop", "session": {"id": "fe2e8da1-c625-4d80-9a0b-92434572e33a"}, "interaction": {"captured_at": 1787255589057, "stop_reason": "end_turn"}, "repository": {"cwd": "/Users/joe/Projects/Privat/GitHubCopilotStatistics", "root": "/Users/joe/Projects/Privat/GitHubCopilotStatistics", "remote_origin": "https://github.com/jfuerlinger/GitHubCopilotStatistics.git", "branch": "main", "commit": "3dcdca4760ea3eae883863ebfc02242a75737b0e"}, "usage": {"source": "session-store", "tokens": {"input_tokens": 985375, "output_tokens": 8504, "cache_read_tokens": 915891, "cache_write_tokens": 39282, "reasoning_tokens": 3248, "github_ai_credits": 35.96}, "by_model": [{"model": "gpt-5.6-terra", "input_tokens": 791527, "output_tokens": 5029, "cache_read_tokens": 752179, "cache_write_tokens": 39282, "reasoning_tokens": 1520, "github_ai_credits": 30.91}, {"model": "mai-code-1-flash-picker", "input_tokens": 193848, "output_tokens": 3475, "cache_read_tokens": 163712, "cache_write_tokens": 0, "reasoning_tokens": 1728, "github_ai_credits": 5.05}]}}
```

Usage values are read from Copilot's local `session-store.db` via Python's
standard-library SQLite client. If that store has not been updated by the time
the hook fires, the script falls back to the session event log and sends the
available output-token counts with `"source": "events-jsonl-output-only"`.

Set `COPILOT_USAGE_WEBHOOK_URL` before starting Copilot CLI to override the
target for development or testing.
